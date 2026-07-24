import {
  createHash,
  createHmac,
  randomUUID
} from "node:crypto";
import { Router, type RequestHandler } from "express";
import mysql from "mysql2/promise";
import type {
  AcquisitionCandidate
} from "./acquisition-domain.js";
import {
  InMemoryAcquisitionDomainRepository,
  type AcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  AcquisitionDomainService
} from "./acquisition-domain-service.js";
import {
  createAcquisitionJudgmentPort,
  createAcquisitionJudgmentSessionResolver
} from "./acquisition-judgment-port.js";
import {
  AcquisitionCrmLeadConversionPort
} from "./acquisition-lead-conversion-port.js";
import {
  ACQUISITION_MODEL_CONTENT_BUNDLE,
  ACQUISITION_MODEL_CONTENT_HASHES,
  ACQUISITION_MODEL_PROMPT_VERSION,
  ACQUISITION_MODEL_SCHEMA_VERSION
} from "./acquisition-model-content.js";
import {
  canonicalJsonStringify
} from "./canonical-json.js";
import {
  createMysqlAcquisitionRepositories,
  ensureAcquisitionMysqlSchema
} from "./acquisition-mysql-repositories.js";
import {
  AcquisitionPlanExecutionWorker,
  AcquisitionShardProcessorRegistry
} from "./acquisition-plan-execution-worker.js";
import {
  createAcquisitionPlanRouter
} from "./acquisition-plan-router.js";
import {
  InMemoryAcquisitionPlanRunRepository,
  type AcquisitionProviderConnectionSnapshot,
  type AcquisitionPlanPayload,
  type AcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";
import {
  AcquisitionPlanRunService
} from "./acquisition-plan-run-service.js";
import {
  createPiAcquisitionCopilotRunner
} from "./acquisition-copilot-runner.js";
import {
  AcquisitionCopilotService,
  InMemoryAcquisitionCopilotRepository,
  type AcquisitionCopilotRunner,
  type AcquisitionCopilotRepository,
  type AcquisitionCopilotScope
} from "./acquisition-copilot-service.js";
import {
  acquisitionPiModelSnapshotFromStored,
  bindActiveAcquisitionModelSnapshot,
  createAcquisitionPiRuntimeFactory
} from "./acquisition-pi-runtime-factory.js";
import type {
  AcquisitionPiGatewayPort
} from "./acquisition-pi-gateway-runtime.js";
import {
  createAcquisitionPublicSearchPort
} from "./acquisition-public-search-port.js";
import type {
  AcquisitionHttpRuntime
} from "./acquisition-runtime-bridge.js";
import {
  AcquisitionSearchShardProcessor
} from "./acquisition-search-shard-processor.js";
import {
  ProductionAcquisitionAgentToolExecutor,
  type AcquisitionActionExecutionPort,
  type AcquisitionPriorityCandidatePort,
  type AcquisitionPriorityCandidateRow,
  type SearchPublicSourcesPort
} from "./acquisition-tool-executor.js";
import {
  InMemoryAcquisitionCandidateDirectory,
  InMemoryAcquisitionReviewTaskRepository,
  InMemoryAcquisitionToolAuditLedgerAdapter,
  InMemoryAcquisitionToolResultLedger,
  MysqlAcquisitionActionExecutionRepository,
  MysqlAcquisitionCandidateDirectory,
  MysqlAcquisitionPriorityCandidateRepository,
  MysqlAcquisitionReviewTaskRepository,
  MysqlAcquisitionToolAuditStore,
  MysqlAcquisitionToolResultLedger,
  ensureAcquisitionToolSupportMysqlSchema
} from "./acquisition-tool-support-repositories.js";
import {
  createAcquisitionV1Router
} from "./acquisition-v1-router.js";
import {
  MODEL_PROVIDER_IDS,
  type StoredAiJobModelSnapshot
} from "./model-providers/types.js";
import type {
  ModelContentBundle
} from "./model-providers/gateway.js";
import type {
  CrmStore
} from "./store.js";
import type {
  ProviderConnection
} from "./types.js";

type IdFactory = (prefix: string) => string;

export interface CreateAcquisitionApplicationOptions {
  store: CrmStore;
  masterSecret: string;
  databaseUrl?: string;
  searchPort?: SearchPublicSourcesPort;
  modelGatewayFactory?: (
    snapshot: StoredAiJobModelSnapshot,
    contentBundle: ModelContentBundle
  ) => AcquisitionPiGatewayPort;
  mysqlPoolFactory?: (databaseUrl: string) => mysql.Pool;
  workerConcurrency?: number;
  shutdownTimeoutMs?: number;
  idFactory?: IdFactory;
  now?: () => string;
  nowMs?: () => number;
}

interface AcquisitionRepositorySet {
  domain: AcquisitionDomainRepository;
  copilot: AcquisitionCopilotRepository;
  planRun: AcquisitionPlanRunRepository;
}

const GRADE_RANK = Object.freeze({
  S: 1,
  A: 2,
  B: 3,
  C: 4,
  D: 5
});

function requireMasterSecret(secret: string) {
  if (
    typeof secret !== "string"
    || !secret.trim()
    || Buffer.byteLength(secret.trim(), "utf8") < 32
  ) {
    throw new TypeError(
      "masterSecret must contain at least 32 non-whitespace bytes"
    );
  }
  return secret;
}

function shutdownTimeout(value: number | undefined) {
  const timeout = value ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 10 || timeout > 300_000) {
    throw new TypeError(
      "shutdownTimeoutMs must be an integer between 10 and 300000"
    );
  }
  return timeout;
}

function derivedSecret(masterSecret: string, purpose: string) {
  return createHmac("sha256", masterSecret)
    .update("goodjob-acquisition-application\u0000")
    .update(purpose)
    .digest("hex");
}

export function trackAcquisitionBackgroundTask<T>(
  tasks: Set<Promise<T>>,
  task: Promise<T>
) {
  tasks.add(task);
  void task.then(
    () => tasks.delete(task),
    () => tasks.delete(task)
  );
  return task;
}

function waitWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("ACQUISITION_APPLICATION_SHUTDOWN_TIMEOUT"));
    }, timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function userMessageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (
      !item
      || typeof item !== "object"
      || (item as { type?: unknown }).type !== "text"
      || typeof (item as { text?: unknown }).text !== "string"
    ) {
      return null;
    }
    parts.push((item as { text: string }).text);
  }
  return parts.join("");
}

/**
 * pi-agent-core normalizes a text prompt into a one-element text content
 * array. The durable copilot service deliberately persists the canonical
 * wire transcript with a string user prompt, so adapt that single boundary
 * without accepting any changed or multimodal content.
 */
function canonicalCopilotRunner(
  runner: AcquisitionCopilotRunner
): AcquisitionCopilotRunner {
  return {
    async run(input) {
      const response = await runner.run(input);
      const first = response.newMessages[0];
      if (
        first?.role === "user"
        && userMessageText(first.content) === input.prompt
        && first.content !== input.prompt
      ) {
        return {
          ...response,
          newMessages: [{
            ...first,
            content: input.prompt
          }, ...response.newMessages.slice(1)]
        };
      }
      return response;
    }
  };
}

function assertApplicationStore(store: CrmStore) {
  if (!store || !["memory", "mysql"].includes(store.mode)) {
    throw new TypeError("A valid CRM store is required");
  }
  for (const key of [
    "leads",
    "leadActivities",
    "leadSourceEvents",
    "providerCatalog",
    "providerConnections",
    "providerRequestLogs",
    "aiModelConfigs",
    "modelCredentialVersions",
    "aiJobModelSnapshots",
    "pendingAiJobModelSnapshots",
    "modelCallRecords",
    "pendingModelCallRecords"
  ] as const) {
    if (!Array.isArray(store[key])) {
      throw new TypeError(`CRM store field ${key} must be an array`);
    }
  }
  if (typeof store.persist !== "function"
    || typeof store.readBarrier !== "function") {
    throw new TypeError(
      "CRM store persistence methods are required"
    );
  }
}

function configuredDatabaseUrl(explicit: string | undefined) {
  return explicit?.trim()
    || process.env.DATABASE_URL?.trim()
    || process.env.MYSQL_URL?.trim()
    || "";
}

/**
 * ProviderConnection does not yet expose an immutable credential version.
 * Until the provider store grows that field, updatedAt is the only
 * tenant-visible, server-controlled value that changes whenever the
 * connection is saved. Preserve its millisecond value in the immutable plan.
 */
export function acquisitionProviderConnectionVersion(
  connection: Pick<ProviderConnection, "updatedAt"> & {
    credentialVersion?: number;
  }
) {
  if (
    Number.isSafeInteger(connection.credentialVersion)
    && Number(connection.credentialVersion) > 0
  ) {
    return Number(connection.credentialVersion);
  }
  const version = Date.parse(connection.updatedAt);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("ACQUISITION_PROVIDER_VERSION_UNAVAILABLE");
  }
  return version;
}

function assertTrustedSearchConnectionSnapshots(
  store: CrmStore,
  scope: { ownerId: string; teamId: string },
  snapshots: AcquisitionProviderConnectionSnapshot[]
) {
  if (!Array.isArray(snapshots) || snapshots.length < 1) {
    throw new Error("ACQUISITION_PROVIDER_SNAPSHOT_UNAVAILABLE");
  }
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.connectionId)) {
      throw new Error("ACQUISITION_PROVIDER_SNAPSHOT_DUPLICATED");
    }
    seen.add(snapshot.connectionId);
    const connection = store.providerConnections.find((candidate) =>
      candidate.id === snapshot.connectionId
      && candidate.ownerId === scope.ownerId
      && candidate.teamId === scope.teamId
    );
    if (
      !connection
      || connection.scope !== "personal"
      || connection.status !== "active"
      || snapshot.kind !== "search"
      || snapshot.status !== "active"
      || snapshot.providerId !== connection.providerId
      || snapshot.credentialVersion
        !== acquisitionProviderConnectionVersion(connection)
    ) {
      throw new Error("ACQUISITION_PROVIDER_SNAPSHOT_MISMATCH");
    }
  }
}

function defaultMysqlPool(databaseUrl: string) {
  return mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 4,
    namedPlaceholders: true
  });
}

function comparePriorityRows(
  left: AcquisitionPriorityCandidateRow,
  right: AcquisitionPriorityCandidateRow
) {
  const leftRank = left.qualificationGrade
    ? GRADE_RANK[left.qualificationGrade]
    : 6;
  const rightRank = right.qualificationGrade
    ? GRADE_RANK[right.qualificationGrade]
    : 6;
  return leftRank - rightRank
    || (right.qualificationScore ?? -1)
      - (left.qualificationScore ?? -1)
    || (right.financialScore ?? -1)
      - (left.financialScore ?? -1)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.candidateId.localeCompare(right.candidateId);
}

class MemoryPriorityCandidateRepository
implements AcquisitionPriorityCandidatePort {
  constructor(private readonly repository: AcquisitionDomainRepository) {}

  async listPriorityCandidates(input: {
    ownerId: string;
    teamId: string;
    subjectKinds?: Array<"organization" | "individual">;
    minimumGrade?: keyof typeof GRADE_RANK;
    limit: number;
    sort: "qualification_and_financial_desc";
  }) {
    if (!Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > 100
      || input.sort !== "qualification_and_financial_desc") {
      throw new TypeError("Invalid priority candidate query");
    }
    const candidates: AcquisitionCandidate[] = [];
    let cursor: string | undefined;
    let snapshot: string | undefined;
    do {
      const page = await this.repository.listCandidates(
        input,
        {
          cursor,
          snapshot,
          limit: 100
        }
      );
      candidates.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      snapshot = page.snapshot;
    } while (cursor);

    const rows = await Promise.all(candidates
      .filter((candidate) =>
        !input.subjectKinds
        || input.subjectKinds.includes(candidate.partyType)
      )
      .map(async (candidate): Promise<AcquisitionPriorityCandidateRow> => {
        const qualification = (
          await this.repository.listQualificationDecisions(
            input,
            candidate.id
          )
        ).at(-1);
        const financial = (
          await this.repository.listFinancialValues(
            input,
            candidate.id
          )
        ).at(-1);
        return {
          candidateId: candidate.id,
          qualificationGrade: qualification?.grade ?? null,
          qualificationScore: qualification?.score ?? null,
          financialScore: financial?.score ?? null,
          updatedAt: candidate.updatedAt
        };
      }));
    return rows
      .filter((row) =>
        !input.minimumGrade
        || (
          row.qualificationGrade !== null
          && GRADE_RANK[row.qualificationGrade]
            <= GRADE_RANK[input.minimumGrade]
        )
      )
      .sort(comparePriorityRows)
      .slice(0, input.limit);
  }
}

const REJECTING_ACTION_EXECUTION_PORT: AcquisitionActionExecutionPort =
  Object.freeze({
    async getVerifiedExecution() {
      return null;
    }
  });

function stableSnapshotJobId(
  store: CrmStore,
  scope: AcquisitionCopilotScope,
  connectionId: string | null
) {
  const config = connectionId
    ? store.aiModelConfigs.find((item) =>
        item.id === connectionId
        && item.ownerId === scope.ownerId
        && item.teamId === scope.teamId
        && item.enabled
      )
    : store.aiModelConfigs.find((item) =>
        item.ownerId === scope.ownerId
        && item.teamId === scope.teamId
        && item.enabled
        && MODEL_PROVIDER_IDS.includes(
          item.provider as (typeof MODEL_PROVIDER_IDS)[number]
        )
      );
  if (!config
    || !MODEL_PROVIDER_IDS.includes(
      config.provider as (typeof MODEL_PROVIDER_IDS)[number]
    )
    || !config.capabilitySnapshot?.toolCalling) {
    throw new Error("ACTIVE_ACQUISITION_MODEL_UNAVAILABLE");
  }
  const capabilitySnapshot = {
    modelListing: Boolean(config.capabilitySnapshot.modelListing),
    parallelToolCalling: Boolean(
      config.capabilitySnapshot.parallelToolCalling
    ),
    streaming: Boolean(config.capabilitySnapshot.streaming),
    structuredOutput: Boolean(
      config.capabilitySnapshot.structuredOutput
    ),
    toolCalling: Boolean(config.capabilitySnapshot.toolCalling)
  };
  const identity = createHash("sha256")
    .update(canonicalJsonStringify({
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      connectionId: config.id,
      credentialVersion: config.credentialVersion ?? 1,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl.trim().replace(/\/+$/u, ""),
      capabilitySnapshot,
      capabilityCertificationHash:
        config.capabilityCertificationHash ?? null,
      promptVersion: ACQUISITION_MODEL_PROMPT_VERSION,
      schemaVersion: ACQUISITION_MODEL_SCHEMA_VERSION,
      promptHash: ACQUISITION_MODEL_CONTENT_HASHES.promptHash,
      schemaHash: ACQUISITION_MODEL_CONTENT_HASHES.schemaHash
    }) ?? "")
    .digest("hex");
  return {
    connectionId: config.id,
    jobId: `acquisition_model_${identity}`
  };
}

function removeSnapshot(
  store: CrmStore,
  snapshot: StoredAiJobModelSnapshot
) {
  for (const values of [
    store.aiJobModelSnapshots,
    store.pendingAiJobModelSnapshots
  ]) {
    const index = values.indexOf(snapshot);
    if (index >= 0) values.splice(index, 1);
  }
}

function createModelSnapshotResolver(
  store: CrmStore
) {
  const inFlight = new Map<
    string,
    Promise<StoredAiJobModelSnapshot>
  >();
  return async (
    scope: AcquisitionCopilotScope,
    input: { connectionId: string | null }
  ) => {
    await store.readBarrier();
    const binding = stableSnapshotJobId(
      store,
      scope,
      input.connectionId
    );
    const pending = inFlight.get(binding.jobId);
    if (pending) {
      return acquisitionPiModelSnapshotFromStored(await pending);
    }
    const existing = store.aiJobModelSnapshots.find((snapshot) =>
      snapshot.jobId === binding.jobId
      && snapshot.ownerId === scope.ownerId
      && snapshot.teamId === scope.teamId
    );
    if (existing) {
      return acquisitionPiModelSnapshotFromStored(existing);
    }
    const operation = Promise.resolve().then(async () => {
      const snapshot = bindActiveAcquisitionModelSnapshot(store, {
        jobId: binding.jobId,
        ownerId: scope.ownerId,
        teamId: scope.teamId,
        connectionId: binding.connectionId
      });
      try {
        await store.persist();
        return snapshot;
      } catch (error) {
        removeSnapshot(store, snapshot);
        throw error;
      }
    });
    inFlight.set(binding.jobId, operation);
    try {
      return acquisitionPiModelSnapshotFromStored(await operation);
    } finally {
      if (inFlight.get(binding.jobId) === operation) {
        inFlight.delete(binding.jobId);
      }
    }
  };
}

function assertTrustedPlanSnapshot(
  store: CrmStore,
  scope: { ownerId: string; teamId: string },
  payload: AcquisitionPlanPayload
) {
  const ref = payload.modelSnapshotRef;
  const stored = store.aiJobModelSnapshots.find((snapshot) =>
    snapshot.jobId === ref.jobSnapshotId
    && snapshot.ownerId === scope.ownerId
    && snapshot.teamId === scope.teamId
  );
  if (!stored) {
    throw new Error("ACQUISITION_PLAN_MODEL_SNAPSHOT_UNAVAILABLE");
  }
  if (
    stored.promptVersion !== ACQUISITION_MODEL_PROMPT_VERSION
    || stored.schemaVersion !== ACQUISITION_MODEL_SCHEMA_VERSION
    || stored.promptHash !== ACQUISITION_MODEL_CONTENT_HASHES.promptHash
    || stored.schemaHash !== ACQUISITION_MODEL_CONTENT_HASHES.schemaHash
    || stored.capabilitySnapshot.toolCalling !== true
  ) {
    throw new Error("ACQUISITION_PLAN_MODEL_SNAPSHOT_UNTRUSTED");
  }
  const publicSnapshot = acquisitionPiModelSnapshotFromStored(stored);
  const matches =
    ref.connectionId === publicSnapshot.connectionId
    && ref.credentialVersion === publicSnapshot.credentialVersion
    && ref.provider === publicSnapshot.provider
    && ref.model === publicSnapshot.model
    && ref.capabilitySnapshotHash
      === publicSnapshot.capabilitySnapshotHash
    && ref.promptVersion === publicSnapshot.promptVersion
    && ref.schemaVersion === publicSnapshot.schemaVersion
    && ref.promptHash === publicSnapshot.promptHash
    && ref.schemaHash === publicSnapshot.schemaHash;
  if (!matches) {
    throw new Error("ACQUISITION_PLAN_MODEL_SNAPSHOT_MISMATCH");
  }
}

export async function createAcquisitionApplication(
  options: CreateAcquisitionApplicationOptions
): Promise<AcquisitionHttpRuntime> {
  assertApplicationStore(options.store);
  const masterSecret = requireMasterSecret(options.masterSecret);
  const closeTimeoutMs = shutdownTimeout(options.shutdownTimeoutMs);
  const idFactory =
    options.idFactory ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const nowMs = options.nowMs ?? Date.now;
  let pool: mysql.Pool | null = null;
  let executionWorker: AcquisitionPlanExecutionWorker | null = null;

  try {
    let repositories: AcquisitionRepositorySet;
    let candidateDirectory;
    let priorityCandidates: AcquisitionPriorityCandidatePort;
    let reviewTasks;
    let actionExecutions: AcquisitionActionExecutionPort;
    let toolResults;
    let toolAudit;

    if (options.store.mode === "mysql") {
      const databaseUrl = configuredDatabaseUrl(options.databaseUrl);
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL or MYSQL_URL is required for acquisition MySQL mode"
        );
      }
      pool = (options.mysqlPoolFactory ?? defaultMysqlPool)(databaseUrl);
      await ensureAcquisitionMysqlSchema(pool);
      await ensureAcquisitionToolSupportMysqlSchema(pool);
      repositories = createMysqlAcquisitionRepositories(pool);
      candidateDirectory = new MysqlAcquisitionCandidateDirectory(pool, {
        now
      });
      priorityCandidates =
        new MysqlAcquisitionPriorityCandidateRepository(pool);
      reviewTasks = new MysqlAcquisitionReviewTaskRepository(pool, {
        now,
        idFactory: () => idFactory("review_task")
      });
      actionExecutions = new MysqlAcquisitionActionExecutionRepository(
        pool,
        {
          proofSecret: derivedSecret(masterSecret, "action-execution-proof")
        }
      );
      toolResults = new MysqlAcquisitionToolResultLedger(pool, { now });
      toolAudit = new MysqlAcquisitionToolAuditStore(pool);
    } else {
      repositories = {
        domain: new InMemoryAcquisitionDomainRepository(),
        copilot: new InMemoryAcquisitionCopilotRepository(),
        planRun: new InMemoryAcquisitionPlanRunRepository()
      };
      candidateDirectory = new InMemoryAcquisitionCandidateDirectory({
        now
      });
      priorityCandidates =
        new MemoryPriorityCandidateRepository(repositories.domain);
      reviewTasks = new InMemoryAcquisitionReviewTaskRepository({
        now,
        idFactory: () => idFactory("review_task")
      });
      actionExecutions = REJECTING_ACTION_EXECUTION_PORT;
      toolResults = new InMemoryAcquisitionToolResultLedger();
      toolAudit = new InMemoryAcquisitionToolAuditLedgerAdapter();
    }

    const domainService = new AcquisitionDomainService({
      repository: repositories.domain,
      leadConversionPort: new AcquisitionCrmLeadConversionPort({
        repository: repositories.domain,
        store: options.store,
        now
      }),
      idFactory,
      now
    });
    const searchPort = options.searchPort
      ?? createAcquisitionPublicSearchPort(options.store);
    const judgmentResolver = createAcquisitionJudgmentSessionResolver({
      repository: repositories.copilot,
      store: options.store,
      gatewayFactory: options.modelGatewayFactory
        ? (snapshot) => options.modelGatewayFactory!(
            snapshot,
            ACQUISITION_MODEL_CONTENT_BUNDLE
          )
        : undefined
    });
    const judgments = createAcquisitionJudgmentPort({
      resolveSession: judgmentResolver
    });
    const toolExecutor = new ProductionAcquisitionAgentToolExecutor({
      domain: domainService,
      search: searchPort,
      candidateDirectory,
      priorityCandidates,
      reviewTasks,
      actionExecutions,
      toolResults,
      judgments,
      now
    });
    const piRuntimeFactory = createAcquisitionPiRuntimeFactory({
      store: options.store,
      gatewayFactory: options.modelGatewayFactory
    });
    const copilotRunner = canonicalCopilotRunner(
      createPiAcquisitionCopilotRunner({
        runtimeFactory: piRuntimeFactory,
        toolExecutor,
        toolAudit,
        toolAuditSecret: derivedSecret(masterSecret, "tool-audit"),
        now: nowMs
      })
    );
    const copilotService = new AcquisitionCopilotService({
      repository: repositories.copilot,
      runner: copilotRunner,
      idempotencySecret: derivedSecret(
        masterSecret,
        "copilot-idempotency"
      ),
      idFactory,
      now
    });

    const searchProcessor = new AcquisitionSearchShardProcessor({
      executor: toolExecutor,
      nowMs
    });
    const trustedSearchProcessor = {
      async process(
        input: Parameters<typeof searchProcessor.process>[0]
      ) {
        await options.store.readBarrier();
        assertTrustedSearchConnectionSnapshots(
          options.store,
          input.scope,
          [input.shard.connection]
        );
        return searchProcessor.process(input);
      }
    };
    const worker = new AcquisitionPlanExecutionWorker({
      repository: repositories.planRun,
      processorRegistry: new AcquisitionShardProcessorRegistry({
        search: trustedSearchProcessor
      }),
      maxConcurrency: options.workerConcurrency ?? 2,
      workerActorId: "acquisition-plan-worker"
    });
    executionWorker = worker;
    const planService = new AcquisitionPlanRunService({
      repository: repositories.planRun,
      executionPort: worker,
      validatePlanPayloadForApproval: async (scope, payload) => {
        await options.store.readBarrier();
        assertTrustedPlanSnapshot(options.store, scope, payload);
        assertTrustedSearchConnectionSnapshots(
          options.store,
          scope,
          payload.providerConnections
        );
      },
      idFactory,
      now
    });
    worker.attachService(planService);
    await planService.recoverExecutionIntents(
      "acquisition-startup-recovery"
    );

    const activeCopilotTasks = new Set<Promise<void>>();
    let closing = false;
    const dispatchCopilotTask = (
      scope: AcquisitionCopilotScope,
      taskId: string
    ) => {
      if (closing) {
        throw new Error("ACQUISITION_APPLICATION_CLOSING");
      }
      const task = copilotService.runTask(scope, taskId).then(
        () => undefined
      );
      return trackAcquisitionBackgroundTask(activeCopilotTasks, task);
    };

    const router = Router();
    router.use(createAcquisitionV1Router({
      domainService,
      copilotService,
      queryPort: repositories.domain,
      requestIdFactory: idFactory,
      cursorSecret: derivedSecret(masterSecret, "v1-cursor"),
      dispatchCopilotTask,
      resolveCopilotModelSnapshot:
        createModelSnapshotResolver(options.store)
    }));
    router.use(createAcquisitionPlanRouter({
      service: planService,
      requestIdFactory: () => idFactory("request")
    }));

    const recoveredCopilotTasks =
      await copilotService.recoverInterruptedTasks({
        staleRunningBefore: new Date(
          nowMs() - 10 * 60 * 1_000
        ).toISOString()
      });
    const claimedRecoveredTasks: Array<{
      scope: AcquisitionCopilotScope;
      taskId: string;
    }> = [];
    for (const task of recoveredCopilotTasks) {
      const scope = {
        ownerId: task.ownerId,
        teamId: task.teamId,
        actorId: task.actorId
      };
      if (await copilotService.claimTaskDispatch(scope, task.id)) {
        claimedRecoveredTasks.push({ scope, taskId: task.id });
      }
    }
    for (const recovered of claimedRecoveredTasks) {
      void dispatchCopilotTask(
        recovered.scope,
        recovered.taskId
      ).catch(() => copilotService.markDispatchFailed(
        recovered.scope,
        recovered.taskId,
        "COPILOT_DISPATCH_FAILED"
      )).catch(() => undefined);
    }

    let closePromise: Promise<void> | null = null;
    return {
      handler: router as RequestHandler,
      close() {
        if (closePromise) return closePromise;
        closing = true;
        closePromise = (async () => {
          let settlements: PromiseSettledResult<void>[] = [];
          let gracefulFailure: unknown;
          try {
            settlements = await waitWithTimeout(
              Promise.allSettled([
                worker.close(),
                ...activeCopilotTasks
              ]),
              closeTimeoutMs
            );
          } catch (error) {
            gracefulFailure = error;
          }
          let poolFailure: unknown;
          if (pool) {
            try {
              await pool.end();
            } catch (error) {
              poolFailure = error;
            }
          }
          if (gracefulFailure) throw gracefulFailure;
          const runtimeFailure = settlements.find(
            (settlement) => settlement.status === "rejected"
          );
          if (runtimeFailure?.status === "rejected") {
            throw runtimeFailure.reason;
          }
          if (poolFailure) throw poolFailure;
        })();
        return closePromise;
      }
    };
  } catch (error) {
    if (executionWorker) {
      await waitWithTimeout(
        executionWorker.close(),
        closeTimeoutMs
      ).catch(() => undefined);
    }
    if (pool) await pool.end().catch(() => undefined);
    throw error;
  }
}
