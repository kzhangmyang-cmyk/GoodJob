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
  acquisitionCandidateIdentityResolved
} from "./acquisition-domain.js";
import {
  AcquisitionCandidateProcessingPipeline
} from "./acquisition-candidate-processing-pipeline.js";
import {
  AcquisitionCandidateIntelligenceOperationService,
  InMemoryAcquisitionCandidateIntelligenceOperationRepository,
  type AcquisitionCandidateIntelligenceOperationRepository
} from "./acquisition-candidate-intelligence-operations.js";
import {
  createAcquisitionCandidateIntelligenceOperationsRouter
} from "./acquisition-candidate-intelligence-operations-router.js";
import {
  AcquisitionCandidateIntelligenceRecoverySweeper
} from "./acquisition-candidate-intelligence-recovery-sweeper.js";
import {
  AcquisitionDouyinIdentityResolutionOperationService,
  InMemoryAcquisitionDouyinIdentityResolutionOperationRepository,
  type AcquisitionDouyinIdentityResolutionOperationRepository,
  type AcquisitionDouyinIdentityResolutionScope
} from "./acquisition-douyin-identity-resolution-operations.js";
import {
  AcquisitionDouyinIdentityResolutionRecoverySweeper
} from "./acquisition-douyin-identity-resolution-recovery-sweeper.js";
import {
  createAcquisitionDouyinIdentityResolutionRouter
} from "./acquisition-douyin-identity-resolution-router.js";
import {
  ensureAcquisitionDouyinIdentityResolutionMysqlSchema,
  MysqlAcquisitionDouyinIdentityResolutionOperationRepository
} from "./acquisition-douyin-identity-resolution-mysql-repository.js";
import {
  createAcquisitionDouyinPublicProfileDiscovery,
  type AcquisitionDouyinPublicProfileDiscoveryPort
} from "./acquisition-douyin-public-profile-discovery.js";
import {
  ensureAcquisitionCandidateIntelligenceMysqlSchema,
  MysqlAcquisitionCandidateIntelligenceOperationRepository
} from "./acquisition-candidate-intelligence-mysql-repository.js";
import {
  AcquisitionCandidateResearchService
} from "./acquisition-candidate-research.js";
import {
  InMemoryAcquisitionDomainRepository,
  type AcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  AcquisitionDomainService
} from "./acquisition-domain-service.js";
import {
  AcquisitionDiscoveryOperationService,
  ControlledPublicContentFetcher,
  InMemoryAcquisitionDiscoveryOperationRepository,
  type AcquisitionContentFetcherPort,
  type AcquisitionDiscoveryOperationRepository
} from "./acquisition-discovery-operations.js";
import {
  createAcquisitionDiscoveryOperationsRouter
} from "./acquisition-discovery-operations-router.js";
import {
  AcquisitionDiscoveryRecoverySweeper
} from "./acquisition-discovery-recovery-sweeper.js";
import {
  ensureAcquisitionDiscoveryMysqlSchema,
  MysqlAcquisitionDiscoveryOperationRepository
} from "./acquisition-discovery-mysql-repository.js";
import {
  ACQUISITION_SEARCH_PROVIDER_IDS,
  isTrustedAcquisitionSystemConnection
} from "./acquisition-discovery-providers.js";
import {
  AcquisitionContentFetchShardProcessor,
  AcquisitionImportRowsShardProcessor
} from "./acquisition-discovery-shard-processors.js";
import {
  createAcquisitionJudgmentPort,
  createAcquisitionJudgmentSessionResolver
} from "./acquisition-judgment-port.js";
import {
  AcquisitionCrmLeadConversionPort
} from "./acquisition-lead-conversion-port.js";
import {
  AcquisitionPrivateDomainHandoffService
} from "./acquisition-private-domain-handoff.js";
import {
  AcquisitionLeadConversionReconciliationService
} from "./acquisition-lead-conversion-reconciliation.js";
import {
  AcquisitionCandidateRunAttributionResolver,
  AcquisitionCrmOutcomeReconciliationService
} from "./acquisition-crm-outcome-reconciliation.js";
import {
  AcquisitionCrmOutcomeReconciliationWorker
} from "./acquisition-crm-outcome-reconciliation-worker.js";
import {
  AcquisitionPerformanceQueryService
} from "./acquisition-performance-query.js";
import {
  createAcquisitionPerformanceRouter
} from "./acquisition-performance-router.js";
import {
  AcquisitionLeadConversionRecoverySweeper
} from "./acquisition-lead-conversion-recovery-sweeper.js";
import {
  AcquisitionIdentityResolutionService
} from "./acquisition-identity-resolution-service.js";
import {
  AcquisitionIndividualSignalIngestionService
} from "./acquisition-individual-signal-ingestion.js";
import {
  ACQUISITION_MODEL_CONTENT_HASHES,
  ACQUISITION_MODEL_PROMPT_VERSION,
  ACQUISITION_MODEL_SCHEMA_VERSION,
  acquisitionModelContentForSnapshot
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
  AcquisitionPlanExecutionRecoverySweeper
} from "./acquisition-plan-execution-recovery-sweeper.js";
import {
  createAcquisitionPlanRouter
} from "./acquisition-plan-router.js";
import {
  createAcquisitionTaskOverviewRouter
} from "./acquisition-task-overview-router.js";
import {
  createAcquisitionPlanDraftGenerator,
  type AcquisitionActiveSearchConnectionDirectory,
  type AcquisitionPlanDraftGenerator
} from "./acquisition-plan-draft.js";
import {
  acquisitionProviderConnectionVersion
} from "./acquisition-provider-connection-version.js";
import {
  createAcquisitionProviderConnectionsRouter
} from "./acquisition-provider-connections-router.js";
import {
  InMemoryAcquisitionPlanRunRepository,
  type AcquisitionModelSnapshotRef,
  type AcquisitionProviderConnectionSnapshot,
  type AcquisitionPlanPayload,
  type AcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";
import {
  AcquisitionPlanRunService
} from "./acquisition-plan-run-service.js";
import {
  AcquisitionRunPresentationService
} from "./acquisition-run-presentation.js";
import {
  AcquisitionTaskOverviewService
} from "./acquisition-task-overview.js";
import {
  createPiAcquisitionCopilotRunner,
  createRoutedAcquisitionCopilotRunner
} from "./acquisition-copilot-runner.js";
import {
  AcquisitionCopilotService,
  InMemoryAcquisitionCopilotRepository,
  type AcquisitionCopilotRunner,
  type AcquisitionCopilotRepository,
  type AcquisitionCopilotScope
} from "./acquisition-copilot-service.js";
import {
  AcquisitionCopilotRecoverySweeper
} from "./acquisition-copilot-recovery-sweeper.js";
import {
  acquisitionPiModelSnapshotFromStored,
  bindActiveAcquisitionModelSnapshot,
  createAcquisitionModelGatewayForSnapshot,
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
  GrowthCommercialToolPorts
} from "./growth-commercial-application.js";
import type { GrowthTemporalBarrier } from "./growth-temporal-barrier.js";
import type {
  GrowthAcquisitionWorkspaceResolver
} from "./growth-workspace-context.js";

export {
  acquisitionProviderConnectionVersion
} from "./acquisition-provider-connection-version.js";

type IdFactory = (prefix: string) => string;

function isExecutableAcquisitionSearchProvider(
  store: Pick<CrmStore, "providerCatalog">,
  providerId: string
) {
  if (!ACQUISITION_SEARCH_PROVIDER_IDS.includes(
    providerId as (typeof ACQUISITION_SEARCH_PROVIDER_IDS)[number]
  )) {
    return false;
  }
  return store.providerCatalog.some((catalog) =>
    catalog.code === providerId
    && catalog.status === "active"
    && catalog.accessMode === "api"
    && catalog.licensePolicy.requiresKey === true
  );
}

export function createAcquisitionActiveSearchConnectionDirectory(
  store: Pick<
    CrmStore,
    "providerCatalog" | "providerConnections" | "readBarrier"
  >
): AcquisitionActiveSearchConnectionDirectory {
  return {
    async list(scope) {
      await store.readBarrier();
      return store.providerConnections
        .filter((connection) =>
          connection.ownerId === scope.ownerId
          && connection.teamId === scope.teamId
          && connection.scope === "personal"
          && connection.status === "active"
          && isExecutableAcquisitionSearchProvider(
            store,
            connection.providerId
          )
        )
        .sort((left, right) =>
          left.providerId < right.providerId
            ? -1
            : left.providerId > right.providerId
              ? 1
              : left.id < right.id
                ? -1
                : left.id > right.id
                  ? 1
                  : 0
        )
        .map((connection) => ({
          connectionId: connection.id,
          providerId: connection.providerId,
          kind: "search" as const,
          status: "active" as const,
          credentialVersion:
            acquisitionProviderConnectionVersion(connection)
        }));
    }
  };
}

export interface CreateAcquisitionApplicationOptions {
  store: CrmStore;
  masterSecret: string;
  /** C0 forward seams; production supplies the one Growth runtime identities. */
  growthToolPorts?: GrowthCommercialToolPorts;
  acquisitionWorkspace?: GrowthAcquisitionWorkspaceResolver;
  growthTemporalBarrier?: GrowthTemporalBarrier;
  quoteProjectedDocumentAuthority?: never;
  databaseUrl?: string;
  searchPort?: SearchPublicSourcesPort;
  contentFetcher?: AcquisitionContentFetcherPort;
  modelGatewayFactory?: (
    snapshot: StoredAiJobModelSnapshot,
    contentBundle: ModelContentBundle
  ) => AcquisitionPiGatewayPort;
  mysqlPoolFactory?: (databaseUrl: string) => mysql.Pool;
  workerConcurrency?: number;
  planExecutionRecoveryIntervalMs?: number;
  copilotRecoveryIntervalMs?: number;
  discoveryRecoveryIntervalMs?: number;
  conversionRecoveryIntervalMs?: number;
  outcomeReconciliationIntervalMs?: number;
  outcomeReconciliationBatchSize?: number;
  candidateIntelligenceRecoveryIntervalMs?: number;
  candidateIntelligenceRecoveryBatchSize?: number;
  candidateIntelligenceLeaseDurationMs?: number;
  douyinIdentityResolutionRecoveryIntervalMs?: number;
  douyinIdentityResolutionRecoveryBatchSize?: number;
  douyinIdentityResolutionLeaseDurationMs?: number;
  discoveryLeaseDurationMs?: number;
  domainRepository?: AcquisitionDomainRepository;
  discoveryRepository?: AcquisitionDiscoveryOperationRepository;
  candidateIntelligenceRepository?:
    AcquisitionCandidateIntelligenceOperationRepository;
  douyinIdentityResolutionRepository?:
    AcquisitionDouyinIdentityResolutionOperationRepository;
  douyinPublicProfileDiscovery?:
    AcquisitionDouyinPublicProfileDiscoveryPort;
  planRunRepository?: AcquisitionPlanRunRepository;
  shutdownTimeoutMs?: number;
  idFactory?: IdFactory;
  now?: () => string;
  nowMs?: () => number;
}

export interface AcquisitionApplicationRuntime
extends AcquisitionHttpRuntime {
  planDraftGenerator: AcquisitionPlanDraftGenerator;
}

interface AcquisitionRepositorySet {
  domain: AcquisitionDomainRepository;
  copilot: AcquisitionCopilotRepository;
  planRun: AcquisitionPlanRunRepository;
  discovery: AcquisitionDiscoveryOperationRepository;
  candidateIntelligence:
    AcquisitionCandidateIntelligenceOperationRepository;
  douyinIdentityResolution:
    AcquisitionDouyinIdentityResolutionOperationRepository;
}

const GRADE_RANK = Object.freeze({
  S: 1,
  A: 2,
  B: 3,
  C: 4,
  D: 5
});

function unresolvedDouyinCandidate(candidate: AcquisitionCandidate) {
  return candidate.partyType === "individual"
    && candidate.partyRef.partyType === "individual"
    && candidate.profile.kind === "individual"
    && candidate.profile.sourcePlatform.toLocaleLowerCase("en-US")
      === "douyin"
    && !acquisitionCandidateIdentityResolved(candidate);
}

function automaticDouyinIdentityKey(input: {
  source: string;
  candidateId: string;
  candidateVersion: number;
  sourceEvidenceIds: string[];
}) {
  return `douyin-identity:operation:${createHash("sha256")
    .update(canonicalJsonStringify(input) ?? "")
    .digest("hex")}`;
}

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
      || !isExecutableAcquisitionSearchProvider(
        store,
        connection.providerId
      )
      || snapshot.credentialVersion
        !== acquisitionProviderConnectionVersion(connection)
    ) {
      throw new Error("ACQUISITION_PROVIDER_SNAPSHOT_MISMATCH");
    }
  }
}

function assertTrustedPlanConnectionSnapshots(
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
    if (snapshot.kind === "search") {
      assertTrustedSearchConnectionSnapshots(store, scope, [snapshot]);
      continue;
    }
    if (!isTrustedAcquisitionSystemConnection(snapshot)) {
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
  connectionId: string | null,
  idempotencyKey?: string | null
) {
  const idempotentJobId = idempotencyKey
    ? `acquisition_model_${createHash("sha256")
        .update(canonicalJsonStringify({
          ownerId: scope.ownerId,
          teamId: scope.teamId,
          requestBindingHash: createHash("sha256")
            .update(idempotencyKey)
            .digest("hex")
        }) ?? "")
        .digest("hex")}`
    : null;
  if (idempotentJobId) {
    const existing = store.aiJobModelSnapshots.find((snapshot) =>
      snapshot.jobId === idempotentJobId
      && snapshot.ownerId === scope.ownerId
      && snapshot.teamId === scope.teamId
    );
    if (existing) {
      return {
        connectionId: existing.connectionId,
        jobId: existing.jobId
      };
    }
  }
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
    jobId: idempotentJobId ?? `acquisition_model_${identity}`
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
    input: {
      connectionId: string | null;
      idempotencyKey?: string;
    }
  ) => {
    await store.readBarrier();
    const binding = stableSnapshotJobId(
      store,
      scope,
      input.connectionId,
      input.idempotencyKey
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

function trustedPlanSnapshot(
  store: CrmStore,
  scope: { ownerId: string; teamId: string },
  ref: AcquisitionModelSnapshotRef
) {
  const stored = store.aiJobModelSnapshots.find((snapshot) =>
    snapshot.jobId === ref.jobSnapshotId
    && snapshot.ownerId === scope.ownerId
    && snapshot.teamId === scope.teamId
  );
  if (!stored) {
    throw new Error("ACQUISITION_PLAN_MODEL_SNAPSHOT_UNAVAILABLE");
  }
  try {
    acquisitionModelContentForSnapshot(stored);
  } catch {
    throw new Error("ACQUISITION_PLAN_MODEL_SNAPSHOT_UNTRUSTED");
  }
  if (stored.capabilitySnapshot.toolCalling !== true) {
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
  return stored;
}

function assertTrustedPlanSnapshot(
  store: CrmStore,
  scope: { ownerId: string; teamId: string },
  payload: AcquisitionPlanPayload
) {
  trustedPlanSnapshot(store, scope, payload.modelSnapshotRef);
}

export async function createAcquisitionApplication(
  options: CreateAcquisitionApplicationOptions
): Promise<AcquisitionApplicationRuntime> {
  if (process.env.NODE_ENV !== "test" && (
    !options.growthToolPorts
    || !options.acquisitionWorkspace
    || !options.growthTemporalBarrier
  )) {
    throw new Error("GROWTH_ACQUISITION_INTEGRATIONS_REQUIRED");
  }
  const growthIntegrations = options.growthToolPorts
    && options.acquisitionWorkspace
    && options.growthTemporalBarrier
    ? Object.freeze({
        toolPorts: options.growthToolPorts,
        acquisitionWorkspace: options.acquisitionWorkspace,
        temporalBarrier: options.growthTemporalBarrier
      })
    : null;
  void growthIntegrations;
  assertApplicationStore(options.store);
  const masterSecret = requireMasterSecret(options.masterSecret);
  const providerCredentialSecret = derivedSecret(
    masterSecret,
    "provider-credentials"
  );
  const closeTimeoutMs = shutdownTimeout(options.shutdownTimeoutMs);
  const idFactory =
    options.idFactory ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const nowMs = options.nowMs ?? Date.now;
  let pool: mysql.Pool | null = null;
  let executionWorker: AcquisitionPlanExecutionWorker | null = null;
  let planExecutionRecoverySweeper:
    AcquisitionPlanExecutionRecoverySweeper | null = null;
  let copilotRecoverySweeper:
    AcquisitionCopilotRecoverySweeper | null = null;
  let discoveryRecoverySweeper:
    AcquisitionDiscoveryRecoverySweeper | null = null;
  let conversionRecoverySweeper:
    AcquisitionLeadConversionRecoverySweeper | null = null;
  let outcomeReconciliationWorker:
    AcquisitionCrmOutcomeReconciliationWorker | null = null;
  let candidateIntelligenceRecoverySweeper:
    AcquisitionCandidateIntelligenceRecoverySweeper | null = null;
  let douyinIdentityResolutionRecoverySweeper:
    AcquisitionDouyinIdentityResolutionRecoverySweeper | null = null;

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
      await ensureAcquisitionDiscoveryMysqlSchema(pool);
      await ensureAcquisitionCandidateIntelligenceMysqlSchema(pool);
      await ensureAcquisitionDouyinIdentityResolutionMysqlSchema(pool);
      repositories = {
        ...createMysqlAcquisitionRepositories(pool),
        discovery:
          new MysqlAcquisitionDiscoveryOperationRepository(pool),
        candidateIntelligence:
          new MysqlAcquisitionCandidateIntelligenceOperationRepository(pool),
        douyinIdentityResolution:
          new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
            pool
          )
      };
      candidateDirectory = new MysqlAcquisitionCandidateDirectory(pool, {
        now,
        identityAliases: repositories.domain
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
      const planRun = new InMemoryAcquisitionPlanRunRepository();
      repositories = {
        domain: new InMemoryAcquisitionDomainRepository(planRun),
        copilot: new InMemoryAcquisitionCopilotRepository(),
        planRun,
        discovery:
          new InMemoryAcquisitionDiscoveryOperationRepository(),
        candidateIntelligence:
          new InMemoryAcquisitionCandidateIntelligenceOperationRepository(),
        douyinIdentityResolution:
          new InMemoryAcquisitionDouyinIdentityResolutionOperationRepository()
      };
      candidateDirectory = new InMemoryAcquisitionCandidateDirectory({
        now,
        identityAliases: repositories.domain
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
    if (options.discoveryRepository) {
      repositories.discovery = options.discoveryRepository;
    }
    if (options.candidateIntelligenceRepository) {
      repositories.candidateIntelligence =
        options.candidateIntelligenceRepository;
    }
    if (options.douyinIdentityResolutionRepository) {
      repositories.douyinIdentityResolution =
        options.douyinIdentityResolutionRepository;
    }
    if (options.planRunRepository) {
      repositories.planRun = options.planRunRepository;
    }
    if (options.domainRepository) {
      repositories.domain = options.domainRepository;
      candidateDirectory = options.store.mode === "mysql"
        ? new MysqlAcquisitionCandidateDirectory(pool!, {
            now,
            identityAliases: repositories.domain
          })
        : new InMemoryAcquisitionCandidateDirectory({
            now,
            identityAliases: repositories.domain
          });
    }
    if (
      repositories.domain instanceof InMemoryAcquisitionDomainRepository
    ) {
      repositories.domain.bindPresentationRunRepository(
        repositories.planRun
      );
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
    const candidateRunAttribution =
      new AcquisitionCandidateRunAttributionResolver({
        planRuns: repositories.planRun
      });
    const privateDomainHandoffService =
      new AcquisitionPrivateDomainHandoffService({
        repository: repositories.domain,
        domainService,
        store: options.store,
        attributionResolver: candidateRunAttribution,
        now
      });
    const identityResolutionService =
      new AcquisitionIdentityResolutionService({
        domain: domainService
      });
    const conversionReconciliation =
      new AcquisitionLeadConversionReconciliationService({
        domainService
      });
    const outcomeReconciliation =
      new AcquisitionCrmOutcomeReconciliationService({
        store: options.store,
        outcomeRecorder: domainService,
        planRuns: repositories.planRun,
        now
      });
    const performanceQuery = new AcquisitionPerformanceQueryService({
      planRuns: repositories.planRun,
      domain: repositories.domain,
      diagnostics:
        options.store.acquisitionOutcomeReconciliationDiagnostics,
      checkpoints:
        options.store.acquisitionOutcomeReconciliationCheckpoints
    });
    const searchPort = options.searchPort
      ?? createAcquisitionPublicSearchPort(options.store, {
        credentialSecret: providerCredentialSecret
      });
    const individualSignals =
      new AcquisitionIndividualSignalIngestionService({
        domain: domainService,
        candidateDirectory
      });
    const discoveryOperations = new AcquisitionDiscoveryOperationService({
      repository: repositories.discovery,
      evidence: domainService,
      individualSignals,
      fetcher: options.contentFetcher
        ?? new ControlledPublicContentFetcher(),
      masterSecret: derivedSecret(masterSecret, "discovery-artifacts"),
      workerId: idFactory("discovery-worker"),
      leaseDurationMs: options.discoveryLeaseDurationMs,
      idFactory,
      now
    });
    const copilotJudgmentResolver =
      createAcquisitionJudgmentSessionResolver({
        repository: repositories.copilot,
        store: options.store,
        gatewayFactory: options.modelGatewayFactory
          ? (snapshot) => options.modelGatewayFactory!(
              snapshot,
              acquisitionModelContentForSnapshot(snapshot)
            )
          : undefined
      });
    const judgmentResolver: Parameters<
      typeof createAcquisitionJudgmentPort
    >[0]["resolveSession"] = async (input) => {
      const prefix = "acquisition-plan:";
      if (!input.sessionId.startsWith(prefix)) {
        return copilotJudgmentResolver(input);
      }
      const runId = input.sessionId.slice(prefix.length);
      const run = runId
        ? await repositories.planRun.getRun(runId)
        : null;
      if (!run
        || run.ownerId !== input.ownerId
        || run.teamId !== input.teamId) {
        throw new Error("MODEL_SNAPSHOT_UNAVAILABLE");
      }
      const snapshot = trustedPlanSnapshot(
        options.store,
        input,
        run.modelSnapshotRef
      );
      return {
        snapshot,
        gateway: options.modelGatewayFactory
          ? options.modelGatewayFactory(
              snapshot,
              acquisitionModelContentForSnapshot(snapshot)
            )
          : createAcquisitionModelGatewayForSnapshot(
              options.store,
              snapshot
            )
      };
    };
    const judgments = createAcquisitionJudgmentPort({
      resolveSession: judgmentResolver
    });
    const activeSearchConnections =
      createAcquisitionActiveSearchConnectionDirectory(options.store);
    const planDraftGenerator = createAcquisitionPlanDraftGenerator({
      resolveSession: judgmentResolver,
      connections: activeSearchConnections,
      idFactory
    });
    const toolExecutor = new ProductionAcquisitionAgentToolExecutor({
      domain: domainService,
      search: searchPort,
      searchConnections: {
        async listActiveConnectionIds(scope) {
          await options.store.readBarrier();
          return options.store.providerConnections
            .filter((connection) =>
              connection.ownerId === scope.ownerId
              && connection.teamId === scope.teamId
              && connection.scope === "personal"
              && connection.status === "active"
              && ACQUISITION_SEARCH_PROVIDER_IDS.includes(
                connection.providerId as
                  (typeof ACQUISITION_SEARCH_PROVIDER_IDS)[number]
              )
            )
            .sort((left, right) =>
              right.updatedAt.localeCompare(left.updatedAt)
              || right.id.localeCompare(left.id)
            )
            .map((connection) => connection.id);
        }
      },
      candidateDirectory,
      priorityCandidates,
      reviewTasks,
      actionExecutions,
      toolResults,
      individualSignals,
      judgments,
      performance: performanceQuery,
      now
    });
    const piRuntimeFactory = createAcquisitionPiRuntimeFactory({
      store: options.store,
      gatewayFactory: options.modelGatewayFactory
    });
    const assistantRunner = canonicalCopilotRunner(
      createPiAcquisitionCopilotRunner({
        runtimeFactory: piRuntimeFactory,
        toolExecutor,
        toolAudit,
        toolAuditSecret: derivedSecret(masterSecret, "tool-audit"),
        now: nowMs
      })
    );
    const copilotRunner = createRoutedAcquisitionCopilotRunner({
      assistantRunner,
      planDraftGenerator
    });
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
    const resolveModelSnapshot =
      createModelSnapshotResolver(options.store);
    const candidateIntelligenceOperations =
      new AcquisitionCandidateIntelligenceOperationService({
        repository: repositories.candidateIntelligence,
        candidates: {
          getCandidate(scope, candidateId) {
            return repositories.domain.findCandidate(scope, candidateId);
          }
        },
        sessionFactory: {
          async createSession(input) {
            const snapshot = await resolveModelSnapshot(input.scope, {
              connectionId: null,
              idempotencyKey: input.idempotencyKey
            });
            const session = await copilotService.createSession(
              input.scope,
              snapshot,
              input.idempotencyKey
            );
            return { sessionId: session.id };
          }
        },
        executor: toolExecutor,
        workerId: idFactory("candidate-intelligence-worker"),
        leaseDurationMs: options.candidateIntelligenceLeaseDurationMs,
        idFactory: () => idFactory("candidate-intelligence"),
        now
      });
    const douyinIdentityResolutionOperations =
      new AcquisitionDouyinIdentityResolutionOperationService({
        repository: repositories.douyinIdentityResolution,
        evidence: domainService,
        candidates: {
          getCandidate(scope, candidateId) {
            return repositories.domain.findCandidate(scope, candidateId);
          }
        },
        discovery: options.douyinPublicProfileDiscovery
          ?? createAcquisitionDouyinPublicProfileDiscovery(),
        search: searchPort,
        validateSearchConnection: async (input) => {
          await options.store.readBarrier();
          assertTrustedSearchConnectionSnapshots(
            options.store,
            input.scope,
            [input.connection]
          );
        },
        identityResolution: identityResolutionService,
        candidateIntelligence: candidateIntelligenceOperations,
        workerId: idFactory("douyin-identity-worker"),
        leaseDurationMs: options.douyinIdentityResolutionLeaseDurationMs,
        idFactory: () => idFactory("douyin-identity-resolution"),
        now
      });

    const candidateResearch = new AcquisitionCandidateResearchService({
      domain: domainService,
      search: searchPort,
      validateConnection: async (input) => {
        await options.store.readBarrier();
        assertTrustedSearchConnectionSnapshots(
          options.store,
          input.scope,
          [input.connection]
        );
      }
    });
    const candidatePipeline = new AcquisitionCandidateProcessingPipeline({
      executor: toolExecutor,
      research: candidateResearch,
      identityResolutionStage: {
        async resolveBeforeIntelligence(input) {
          const planSessionId = `acquisition-plan:${input.run.id}`;
          const owned = await douyinIdentityResolutionOperations
            .findSucceededForCandidateAndPlanSession(
              input.scope,
              input.candidateId,
              planSessionId
            );
          if (owned?.intelligenceOperationId) {
            return {
              status: "completed",
              operationId: owned.id,
              intelligence: await candidateIntelligenceOperations.get(
                input.scope,
                owned.intelligenceOperationId
              )
            };
          }
          const candidate = await domainService.getCandidate(
            input.scope,
            input.candidateId
          );
          if (!unresolvedDouyinCandidate(candidate)) {
            return { status: "not_required" };
          }
          const sourceEvidenceIds = [...candidate.evidenceIds];
          if (sourceEvidenceIds.length === 0) {
            return {
              status: "requires_review",
              operationId: "unavailable",
              errorCode: "not_found"
            };
          }
          const operation = await douyinIdentityResolutionOperations.create(
            input.scope,
            {
              candidateId: candidate.id,
              expectedCandidateVersion: candidate.version,
              sourceEvidenceIds,
              searchConnections: [input.shard.connection],
              planSessionId
            },
            automaticDouyinIdentityKey({
              source: `${input.run.id}:${input.shard.id}`,
              candidateId: candidate.id,
              candidateVersion: candidate.version,
              sourceEvidenceIds
            })
          );
          const completed =
            await douyinIdentityResolutionOperations.execute(
              input.scope,
              operation.id,
              input.signal
            );
          if (completed.status !== "succeeded"
            || !completed.intelligenceOperationId) {
            return {
              status: "requires_review",
              operationId: completed.id,
              errorCode: completed.outcome ?? "provider_unavailable"
            };
          }
          return {
            status: "completed",
            operationId: completed.id,
            intelligence: await candidateIntelligenceOperations.get(
              input.scope,
              completed.intelligenceOperationId
            )
          };
        }
      }
    });
    const searchProcessor = new AcquisitionSearchShardProcessor({
      executor: toolExecutor,
      candidatePipeline,
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
    const contentFetchProcessor =
      new AcquisitionContentFetchShardProcessor({
        operations: discoveryOperations,
        nowMs
      });
    const importRowsProcessor = new AcquisitionImportRowsShardProcessor({
      operations: discoveryOperations,
      nowMs
    });
    const worker = new AcquisitionPlanExecutionWorker({
      repository: repositories.planRun,
      processorRegistry: new AcquisitionShardProcessorRegistry({
        search: trustedSearchProcessor,
        content_fetch: contentFetchProcessor,
        import_rows: importRowsProcessor
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
        assertTrustedPlanConnectionSnapshots(
          options.store,
          scope,
          payload.providerConnections
        );
      },
      idFactory,
      now
    });
    const runPresentationService = new AcquisitionRunPresentationService({
      planRunRepository: repositories.planRun,
      domainRepository: repositories.domain,
      cursorSecret: derivedSecret(
        masterSecret,
        "run-presentation-cursor"
      )
    });
    const taskOverviewService = new AcquisitionTaskOverviewService({
      repository: repositories.planRun,
      now
    });
    worker.attachService(planService);
    planExecutionRecoverySweeper =
      new AcquisitionPlanExecutionRecoverySweeper({
        service: planService,
        intervalMs: options.planExecutionRecoveryIntervalMs
      });
    await planExecutionRecoverySweeper.start();

    const activeCopilotTasks = new Set<Promise<void>>();
    const activeDiscoveryTasks = new Set<Promise<void>>();
    const activeCandidateIntelligenceTasks = new Set<Promise<void>>();
    const activeDouyinIdentityTasks = new Set<Promise<void>>();
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
    const dispatchDiscoveryTask = (
      taskFactory: () => Promise<unknown>
    ) => {
      if (closing) {
        throw new Error("ACQUISITION_APPLICATION_CLOSING");
      }
      const task = trackAcquisitionBackgroundTask(
        activeDiscoveryTasks,
        Promise.resolve()
          .then(taskFactory)
          .then(() => undefined)
      );
      void task.catch(() => undefined);
      return Promise.resolve();
    };
    const dispatchCandidateIntelligenceTask = (
      scope: AcquisitionCopilotScope,
      operationId: string
    ) => {
      if (closing) {
        throw new Error("ACQUISITION_APPLICATION_CLOSING");
      }
      const task = trackAcquisitionBackgroundTask(
        activeCandidateIntelligenceTasks,
        Promise.resolve()
          .then(() => candidateIntelligenceOperations.execute(
            scope,
            operationId
          ))
          .then(() => undefined)
      );
      void task.catch(() => undefined);
      return Promise.resolve();
    };
    const dispatchDouyinIdentityTask = (
      scope: AcquisitionDouyinIdentityResolutionScope,
      operationId: string
    ) => {
      if (closing) {
        throw new Error("ACQUISITION_APPLICATION_CLOSING");
      }
      const task = trackAcquisitionBackgroundTask(
        activeDouyinIdentityTasks,
        Promise.resolve()
          .then(() => douyinIdentityResolutionOperations.execute(
            scope,
            operationId
          ))
          .then(() => undefined)
      );
      void task.catch(() => undefined);
      return Promise.resolve();
    };
    const submitDirectDouyinCandidates = async (
      scope: AcquisitionDouyinIdentityResolutionScope,
      source: string,
      candidateIds: string[]
    ) => {
      if (candidateIds.length === 0) return;
      const searchConnections = await activeSearchConnections.list(scope);
      for (const candidateId of candidateIds) {
        const candidate = await domainService.getCandidate(scope, candidateId);
        if (!unresolvedDouyinCandidate(candidate)
          || candidate.evidenceIds.length === 0) {
          continue;
        }
        const operation = await douyinIdentityResolutionOperations.create(
          scope,
          {
            candidateId,
            expectedCandidateVersion: candidate.version,
            sourceEvidenceIds: candidate.evidenceIds,
            searchConnections,
            planSessionId: null
          },
          automaticDouyinIdentityKey({
            source,
            candidateId,
            candidateVersion: candidate.version,
            sourceEvidenceIds: candidate.evidenceIds
          })
        );
        await dispatchDouyinIdentityTask(scope, operation.id);
      }
    };
    const executeContentFetchAndSubmitIdentity = async (
      scope: AcquisitionDouyinIdentityResolutionScope,
      operationId: string
    ) => {
      const completed =
        await discoveryOperations.executeContentFetchOperation(
          scope,
          operationId
        );
      await submitDirectDouyinCandidates(
        scope,
        `content-fetch:${operationId}`,
        completed.candidateIds
      );
      return completed;
    };
    const executeImportAndSubmitIdentity = async (
      scope: AcquisitionDouyinIdentityResolutionScope,
      operationId: string
    ) => {
      const completed = await discoveryOperations.executeImportOperation(
        scope,
        operationId
      );
      await submitDirectDouyinCandidates(
        scope,
        `import:${operationId}`,
        completed.candidateIds
      );
      return completed;
    };
    const router = Router();
    router.use(createAcquisitionProviderConnectionsRouter({
      store: options.store,
      credentialSecret: providerCredentialSecret,
      requestIdFactory: idFactory,
      idFactory,
      now,
      connectionTester: async ({ scope, connection }) => {
        try {
          const result = await searchPort.search({
            ownerId: scope.ownerId,
            teamId: scope.teamId,
            actorId: scope.ownerId,
            sessionId: idFactory("provider_connection_test"),
            providerConnectionId: connection.id,
            query: "公开采购需求",
            subjectKinds: ["organization"],
            maxResults: 1
          });
          return {
            ok: true,
            message: "数据源连接测试通过",
            errorCode: null,
            retryable: false,
            retryAfterAt: null,
            usage: `测试返回 ${result.results.length} 条公开结果`
          };
        } catch (error) {
          const failure = error as {
            code?: unknown;
            retryable?: unknown;
            retryAfterAt?: unknown;
          };
          return {
            ok: false,
            message: "数据源连接测试失败",
            errorCode: typeof failure.code === "string"
              ? failure.code
              : "PROVIDER_CONNECTION_TEST_FAILED",
            retryable: failure.retryable === true,
            retryAfterAt: typeof failure.retryAfterAt === "string"
              ? failure.retryAfterAt
              : null,
            usage: ""
          };
        }
      }
    }));
    router.use(createAcquisitionDiscoveryOperationsRouter({
      service: discoveryOperations,
      requestIdFactory: () => idFactory("request"),
      dispatchContentFetchOperation: (scope, operationId) =>
        dispatchDiscoveryTask(() => executeContentFetchAndSubmitIdentity(
          scope,
          operationId
        )),
      dispatchImportOperation: (scope, operationId) =>
        dispatchDiscoveryTask(() => executeImportAndSubmitIdentity(
          scope,
          operationId
        ))
    }));
    router.use(createAcquisitionCandidateIntelligenceOperationsRouter({
      service: candidateIntelligenceOperations,
      dispatchOperation: dispatchCandidateIntelligenceTask,
      requestIdFactory: () => idFactory("request")
    }));
    router.use(createAcquisitionDouyinIdentityResolutionRouter({
      operations: {
        findIdempotentReplay(scope, candidateId, idempotencyKey) {
          return douyinIdentityResolutionOperations.findIdempotentReplay(
            scope,
            candidateId,
            idempotencyKey
          );
        },
        findLatestForCandidate(scope, candidateId) {
          return douyinIdentityResolutionOperations.findLatestForCandidate(
            scope,
            candidateId
          );
        },
        create(scope, input, idempotencyKey) {
          return douyinIdentityResolutionOperations.createWithResult(
            scope,
            input,
            idempotencyKey
          );
        }
      },
      candidates: {
        getCandidate(scope, candidateId) {
          return repositories.domain.findCandidate(scope, candidateId);
        }
      },
      searchConnections: activeSearchConnections,
      candidateIsResolved: (candidate) => acquisitionCandidateIdentityResolved(
        candidate as AcquisitionCandidate
      ),
      dispatchOperation: dispatchDouyinIdentityTask,
      requestIdFactory: () => idFactory("request")
    }));
    router.use(createAcquisitionPerformanceRouter({
      query: performanceQuery,
      requestIdFactory: () => idFactory("request")
    }));
    router.use(createAcquisitionV1Router({
      domainService,
      identityResolutionService,
      copilotService,
      queryPort: repositories.domain,
      requestIdFactory: idFactory,
      cursorSecret: derivedSecret(masterSecret, "v1-cursor"),
      dispatchCopilotTask,
      resolveCopilotModelSnapshot: resolveModelSnapshot,
      privateDomainHandoffService
    }));
    router.use(createAcquisitionPlanRouter({
      service: planService,
      presentationService: runPresentationService,
      resolveModelSnapshot: async (scope, input) => {
        const snapshot = await resolveModelSnapshot(scope, input);
        return {
          jobSnapshotId: snapshot.jobId,
          connectionId: snapshot.connectionId,
          credentialVersion: snapshot.credentialVersion,
          provider: snapshot.provider,
          model: snapshot.model,
          capabilitySnapshotHash: snapshot.capabilitySnapshotHash,
          promptVersion: snapshot.promptVersion,
          schemaVersion: snapshot.schemaVersion,
          promptHash: snapshot.promptHash,
          schemaHash: snapshot.schemaHash
        };
      },
      requestIdFactory: () => idFactory("request")
    }));
    router.use(createAcquisitionTaskOverviewRouter({
      overviewService: taskOverviewService,
      planService,
      presentationService: runPresentationService,
      requestIdFactory: () => idFactory("request")
    }));

    copilotRecoverySweeper = new AcquisitionCopilotRecoverySweeper({
      service: copilotService,
      dispatchTask: dispatchCopilotTask,
      intervalMs: options.copilotRecoveryIntervalMs,
      nowMs
    });
    await copilotRecoverySweeper.start();
    discoveryRecoverySweeper =
      new AcquisitionDiscoveryRecoverySweeper({
        service: discoveryOperations,
        dispatchContentFetchOperation: (scope, operationId) =>
          dispatchDiscoveryTask(() =>
            executeContentFetchAndSubmitIdentity(
              scope,
              operationId
            )
          ),
        dispatchImportOperation: (scope, operationId) =>
          dispatchDiscoveryTask(() =>
            executeImportAndSubmitIdentity(
              scope,
              operationId
            )
          ),
        intervalMs: options.discoveryRecoveryIntervalMs,
        nowMs
      });
    await discoveryRecoverySweeper.start();
    candidateIntelligenceRecoverySweeper =
      new AcquisitionCandidateIntelligenceRecoverySweeper({
        service: candidateIntelligenceOperations,
        dispatch: dispatchCandidateIntelligenceTask,
        intervalMs: options.candidateIntelligenceRecoveryIntervalMs,
        batchSize: options.candidateIntelligenceRecoveryBatchSize
      });
    await candidateIntelligenceRecoverySweeper.start();
    douyinIdentityResolutionRecoverySweeper =
      new AcquisitionDouyinIdentityResolutionRecoverySweeper({
        service: douyinIdentityResolutionOperations,
        dispatch: dispatchDouyinIdentityTask,
        intervalMs: options.douyinIdentityResolutionRecoveryIntervalMs,
        batchSize: options.douyinIdentityResolutionRecoveryBatchSize
      });
    await douyinIdentityResolutionRecoverySweeper.start();
    conversionRecoverySweeper =
      new AcquisitionLeadConversionRecoverySweeper({
        service: conversionReconciliation,
        intervalMs: options.conversionRecoveryIntervalMs
      });
    await conversionRecoverySweeper.start();
    outcomeReconciliationWorker =
      new AcquisitionCrmOutcomeReconciliationWorker({
        service: outcomeReconciliation,
        listTenantScopes: () => options.store.acquisitionCustomerHandoffs.map(
          ({ ownerId, teamId }) => ({ ownerId, teamId })
        ),
        intervalMs: options.outcomeReconciliationIntervalMs,
        batchSize: options.outcomeReconciliationBatchSize
      });
    await outcomeReconciliationWorker.start();

    let closePromise: Promise<void> | null = null;
    return {
      handler: router as RequestHandler,
      planDraftGenerator,
      close() {
        if (closePromise) return closePromise;
        closing = true;
        closePromise = (async () => {
          let settlements: PromiseSettledResult<void>[] = [];
          let gracefulFailure: unknown;
          try {
            settlements = await waitWithTimeout(
              Promise.allSettled([
                copilotRecoverySweeper?.close() ?? Promise.resolve(),
                discoveryRecoverySweeper?.close()
                  ?? Promise.resolve(),
                (async () => {
                  await candidateIntelligenceRecoverySweeper?.stop();
                  await Promise.all([
                    ...activeCandidateIntelligenceTasks
                  ]);
                })(),
                (async () => {
                  await douyinIdentityResolutionRecoverySweeper?.stop();
                  await Promise.all([
                    ...activeDouyinIdentityTasks
                  ]);
                })(),
                conversionRecoverySweeper?.close()
                  ?? Promise.resolve(),
                outcomeReconciliationWorker?.close()
                  ?? Promise.resolve(),
                (async () => {
                  await planExecutionRecoverySweeper?.close();
                  await worker.close();
                })(),
                ...activeCopilotTasks,
                ...activeDiscoveryTasks
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
    if (douyinIdentityResolutionRecoverySweeper) {
      await douyinIdentityResolutionRecoverySweeper.stop()
        .catch(() => undefined);
    }
    if (candidateIntelligenceRecoverySweeper) {
      await candidateIntelligenceRecoverySweeper.stop()
        .catch(() => undefined);
    }
    if (conversionRecoverySweeper) {
      await conversionRecoverySweeper.close().catch(() => undefined);
    }
    if (outcomeReconciliationWorker) {
      await outcomeReconciliationWorker.close().catch(() => undefined);
    }
    if (discoveryRecoverySweeper) {
      await discoveryRecoverySweeper.close().catch(() => undefined);
    }
    if (copilotRecoverySweeper) {
      await copilotRecoverySweeper.close().catch(() => undefined);
    }
    if (planExecutionRecoverySweeper) {
      await planExecutionRecoverySweeper.close().catch(() => undefined);
    }
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
