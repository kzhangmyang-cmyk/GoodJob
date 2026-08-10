import type { Request } from "express";
import type { OutcomeAttributionInput } from "./acquisition-domain.js";
import { AcquisitionCostLedgerService, type CreatePendingCostInput } from "./acquisition-cost-ledger.js";
import type { CommercialBindingSnapshot } from "./commercial-binding-snapshot.js";
import type { CommandContext } from "./growth-command-context.js";
import type { GrowthFoundationServices } from "./growth-foundation-module.js";
import {
  canonicalGrowthRequestHash,
  InMemoryGrowthHttpIdempotencyRepository
} from "./growth-http-idempotency-repository.js";
import { commandContextFromRequest } from "./growth-http-preconditions.js";
import {
  type AcquisitionCostEntry,
  type FinancialFact,
  ledgerEntryStatus,
  type LedgerSourceHead,
  type LedgerVerificationEvent
} from "./financial-ledger-domain.js";
import {
  RepositoryVerifiedFinancialLedgerSealedReader,
  VerifiedFinancialLedgerAsOfBoundary,
  type VerifiedFinancialLedgerSealedReader
} from "./financial-ledger-as-of-reader.js";
import {
  InMemoryFinancialLedgerRepository,
  type FinancialLedgerTransaction
} from "./financial-ledger-repository.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner,
  type GrowthSealedReadCutoff,
  type GrowthTemporalBarrier
} from "./growth-temporal-barrier.js";
import {
  createGrowthAcquisitionWorkspaceResolver,
  type ActiveWorkspaceContext
} from "./growth-workspace-context.js";
import { InMemoryGrowthWorkspaceSettingsReader } from "./growth-workspace-settings.js";

const DEFAULT_NOW = "2026-08-09T03:00:00.000Z";

export function ledgerCommandContext(
  workspaceId: string,
  actorId: string,
  idempotencyKey = `ledger-${actorId}-0001`,
  expectedRevision: number | null = null,
  request: {
    method: "POST" | "PATCH";
    canonicalPath: string;
    pathParams: Readonly<Record<string, string>>;
    payload: unknown;
  } = {
    method: "POST",
    canonicalPath: "/test/financial-ledger",
    pathParams: Object.freeze({}),
    payload: Object.freeze({})
  }
): CommandContext {
  return Object.freeze({
    workspace: workspace(workspaceId, actorId),
    actorId,
    idempotencyKey,
    requestHash: canonicalGrowthRequestHash({
      method: request.method,
      canonicalPath: request.canonicalPath,
      pathParams: Object.fromEntries(Object.entries(request.pathParams)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
      payload: request.payload,
      expectedRevision
    }),
    expectedRevision
  });
}

function workspace(workspaceId: string, actorId = "finance-a"): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId,
    kind: "team" as const,
    actorId,
    role: "admin" as const,
    teamId: workspaceId,
    capabilities: Object.freeze([
      "ledger.pending.create" as const,
      "ledger.verify" as const,
      "roi.close" as const,
      "growth.performance.workspace.read" as const,
      "pricing.sensitive.read" as const
    ]),
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

export function foundationServicesFixture(
  overrides: Partial<GrowthFoundationServices> = {}
): GrowthFoundationServices {
  const temporalTransactions = overrides.temporalTransactions
    ?? new InMemoryGrowthTemporalTransactionRunner(DEFAULT_NOW);
  const temporalBarrier = overrides.temporalBarrier
    ?? new DefaultGrowthTemporalBarrier(temporalTransactions);
  const acquisitionWorkspace = overrides.acquisitionWorkspace
    ?? createGrowthAcquisitionWorkspaceResolver({
      async resolve(scope) {
        return {
          workspaceId: scope.teamId,
          kind: "team" as const,
          bindingRevision: "fixture.v1"
        };
      }
    });
  return Object.freeze({
    httpIdempotency: overrides.httpIdempotency
      ?? new InMemoryGrowthHttpIdempotencyRepository(),
    workspaceSettings: overrides.workspaceSettings
      ?? new InMemoryGrowthWorkspaceSettingsReader(),
    workspaceContext: overrides.workspaceContext
      ?? ((request: Request) => {
        if (!request.activeWorkspace) throw new Error("workspace_required");
        return request.activeWorkspace;
      }),
    acquisitionWorkspace,
    temporalTransactions,
    temporalBarrier,
    commandContextFactory: overrides.commandContextFactory
      ?? commandContextFromRequest
  });
}

function costEntry(overrides: Partial<AcquisitionCostEntry> = {}): AcquisitionCostEntry {
  return Object.freeze({
    id: "cost-1",
    workspaceId: "workspace-a",
    platform: "douyin",
    planId: null,
    runId: null,
    providerId: null,
    category: "media",
    amountMinor: 10_000,
    currency: "CNY",
    occurredAt: "2026-08-09T01:00:00.000Z",
    provenance: "portal_export",
    sourceRef: "portal://cost-1",
    evidenceHash: "sha256:cost-1",
    externalId: "cost-1",
    sourceIdentityRoot: "external:portal:cost-1",
    sourceVersion: 1,
    businessOccurredAt: "2026-08-09T01:00:00.000Z",
    recordedAt: "2026-08-09T01:00:00.000Z",
    temporalSequence: 1,
    correctsCostEntryId: null,
    correctionGroupId: null,
    estimateReconciliationId: null,
    createdBy: "finance-a",
    ...overrides
  });
}

function sourceHead(entry: AcquisitionCostEntry): LedgerSourceHead {
  return Object.freeze({
    workspaceId: entry.workspaceId,
    ledgerType: "cost",
    sourceIdentityRoot: entry.sourceIdentityRoot,
    currentLedgerEntryId: entry.id,
    currentSourceVersion: entry.sourceVersion,
    revision: entry.sourceVersion
  });
}

function verification(
  entry: AcquisitionCostEntry | FinancialFact,
  overrides: Partial<LedgerVerificationEvent> = {}
): LedgerVerificationEvent {
  return Object.freeze({
    id: `verify-${entry.id}`,
    workspaceId: entry.workspaceId,
    ledgerType: "platform" in entry ? "cost" : "financial",
    ledgerEntryId: entry.id,
    eventType: "verified",
    reversesEventId: null,
    eventSequence: 1,
    revision: 2,
    correctionGroupId: null,
    reason: "checked",
    decidedBy: "finance-a",
    recordedAt: "2026-08-09T02:00:00.000Z",
    temporalSequence: 1,
    ...overrides
  });
}

export function verifiedCostLedgerFixture() {
  const entry = costEntry();
  const repository = new TracingFinancialLedgerRepository({
    costEntries: [entry],
    sourceHeads: [sourceHead(entry)],
    verificationEvents: [verification(entry)],
    temporalTails: {
      "workspace-a": {
        lastRecordedAt: "2026-08-09T02:00:00.000Z",
        temporalSequence: 2
      }
    }
  }, DEFAULT_NOW);
  const foundation = foundationServicesFixture({
    temporalTransactions: repository,
    temporalBarrier: new DefaultGrowthTemporalBarrier(repository)
  });
  return {
    entry,
    repository,
    foundation,
    service: new AcquisitionCostLedgerService({ repository, foundation }),
    correctionLockTrace: () => repository.traces.find((trace) =>
      trace.some((item) => item.startsWith("source:"))) ?? []
  };
}

export function twoPendingCostEntriesFixture(ids: readonly string[]) {
  const entries = ids.map((id, index) => costEntry({
    id,
    externalId: id,
    sourceIdentityRoot: `external:portal:${id}`,
    temporalSequence: index + 1
  }));
  const repository = new InMemoryFinancialLedgerRepository({
    costEntries: entries,
    sourceHeads: entries.map(sourceHead),
    temporalTails: {
      "workspace-a": { lastRecordedAt: DEFAULT_NOW, temporalSequence: entries.length }
    }
  }, DEFAULT_NOW);
  const foundation = foundationServicesFixture({
    temporalTransactions: repository,
    temporalBarrier: new DefaultGrowthTemporalBarrier(repository)
  });
  const service = new AcquisitionCostLedgerService({ repository, foundation });
  return {
    service,
    async status(id: string) {
      const events = await repository.listVerificationEvents("workspace-a", "cost", id);
      return ledgerEntryStatus(events);
    }
  };
}

class TracingFinancialLedgerRepository extends InMemoryFinancialLedgerRepository {
  readonly traces: string[][] = [];

  override async transaction<T>(work: (tx: FinancialLedgerTransaction) => Promise<T>): Promise<T> {
    const trace: string[] = [];
    this.traces.push(trace);
    return super.transaction((tx) => work({
      ...tx,
      lockWorkspaceTemporalBarrierForUpdate: async (workspaceId) => {
        trace.push(`temporal:${workspaceId}`);
        return tx.lockWorkspaceTemporalBarrierForUpdate(workspaceId);
      },
      getSourceHeadForUpdate: async (workspaceId, ledgerType, sourceIdentityRoot) => {
        trace.push(`source:${ledgerType}:${sourceIdentityRoot}`);
        return tx.getSourceHeadForUpdate(workspaceId, ledgerType, sourceIdentityRoot);
      },
      getCostEntryForUpdate: async (workspaceId, id) => {
        trace.push(`entry:cost:${id}`);
        return tx.getCostEntryForUpdate(workspaceId, id);
      },
      listVerificationEventsForUpdate: async (workspaceId, ledgerType, entryId) => {
        trace.push(`events:${ledgerType}:${entryId}`);
        return tx.listVerificationEventsForUpdate(workspaceId, ledgerType, entryId);
      }
    }));
  }
}

export function financeTemporalBarrierFixture(input: {
  workspaceId: string;
  databaseNow: string;
}) {
  const repository = new TracingFinancialLedgerRepository({}, input.databaseNow);
  const temporalBarrier = new DefaultGrowthTemporalBarrier(repository);
  const foundation = foundationServicesFixture({
    temporalTransactions: repository,
    temporalBarrier
  });
  const service = new AcquisitionCostLedgerService({ repository, foundation });
  const newCostInput = (
    overrides: Partial<CreatePendingCostInput> = {}
  ): CreatePendingCostInput => ({
    platform: "douyin",
    planId: null,
    runId: null,
    providerId: null,
    category: "media",
    amountMinor: 10_000,
    currency: "CNY",
    businessOccurredAt: "2026-08-09T08:00:00.000Z",
    provenance: "portal_export",
    sourceRef: "portal://new-cost",
    evidenceHash: "sha256:new-cost",
    externalId: "new-cost",
    sourceIdentityRoot: "external:portal:new-cost",
    estimateReconciliationId: null,
    ...overrides
  });
  return {
    repository,
    foundation,
    service,
    workspace: workspace(input.workspaceId),
    sealedReader: new RepositoryVerifiedFinancialLedgerSealedReader(repository),
    setDatabaseNow: (value: string) => repository.setDatabaseNow(value),
    newCostInput,
    firstBusinessLockTrace: () => repository.traces.find((trace) =>
      trace.some((item) => item.startsWith("source:")))?.slice(0, 2) ?? []
  };
}

const attributionSnapshot: OutcomeAttributionInput = Object.freeze({
  attributionVersion: "acquisition-run.v1",
  runId: "run-1",
  planId: "plan-1",
  planVersionId: "plan-version-1",
  planVersion: 1,
  planSnapshotHash: "sha256:plan",
  discoveredEventId: "discovered-1",
  discoveredAt: "2026-08-01T00:00:00.000Z",
  shardId: "shard-1",
  operationId: "operation-1",
  connectionId: "connection-1",
  providerId: "provider-1",
  evidenceIds: ["evidence-1"],
  providerIds: ["provider-1"],
  queryIds: ["query-1"],
  strategyVersion: "strategy-1",
  qualificationDecisionId: "qualification-1",
  decisionVersion: "decision-1",
  decisionSnapshotHash: "sha256:decision"
});

function bindingSnapshot(bindingHash = "sha256:binding-1"): CommercialBindingSnapshot {
  return Object.freeze({
    candidateId: "candidate-1",
    handoffId: "handoff-1",
    leadId: "lead-1",
    customerId: "customer-1",
    dealId: "deal-1",
    candidateVersion: 1,
    handoffContentHash: "sha256:handoff" as `sha256:${string}`,
    dealContentHash: "sha256:deal" as `sha256:${string}`,
    bindingHashSchemaVersion: "commercial-binding.v1",
    attributionSnapshot,
    bindingHash: bindingHash as `sha256:${string}`,
    verifiedAt: "2026-08-09T01:00:00.000Z"
  });
}

function financialFact(overrides: Partial<FinancialFact> = {}): FinancialFact {
  return Object.freeze({
    id: "refund-1",
    workspaceId: "workspace-a",
    candidateId: "candidate-1",
    customerId: "customer-1",
    dealId: "deal-1",
    quoteVersionId: "quote-1",
    factType: "refund",
    amountMinor: 10_000,
    currency: "CNY",
    businessOccurredAt: "2026-08-09T01:00:00.000Z",
    recordedAt: "2026-08-09T01:00:00.000Z",
    temporalSequence: 1,
    provenance: "invoice_confirmed",
    sourceRef: "invoice://refund-1",
    evidenceHash: "sha256:refund-evidence",
    externalId: "refund-1",
    sourceIdentityRoot: "external:invoice:refund-1",
    sourceVersion: 1,
    attributionSnapshot,
    commercialBindingSnapshot: bindingSnapshot(),
    commercialAmountHash: "sha256:commercial-1",
    dealAuthorityRevision: 1,
    correctsFactId: null,
    correctionGroupId: null,
    createdBy: "finance-a",
    ...overrides
  });
}

function readerFor(initial: {
  costs?: readonly AcquisitionCostEntry[];
  facts?: readonly FinancialFact[];
  events?: readonly LedgerVerificationEvent[];
}) {
  const repository = new InMemoryFinancialLedgerRepository({
    costEntries: initial.costs,
    financialFacts: initial.facts,
    verificationEvents: initial.events
  }, DEFAULT_NOW);
  const runner = new InMemoryGrowthTemporalTransactionRunner(DEFAULT_NOW);
  const foundation = foundationServicesFixture({
    temporalTransactions: runner,
    temporalBarrier: new DefaultGrowthTemporalBarrier(runner)
  });
  const sealedReader = new RepositoryVerifiedFinancialLedgerSealedReader(repository);
  const reader = new VerifiedFinancialLedgerAsOfBoundary({
    foundation,
    sealedReader,
    now: () => DEFAULT_NOW
  });
  return { repository, foundation, sealedReader, reader };
}

export function verifiedLedgerAsOfFixture(options: {
  sameIdAcrossLedgerTypes?: string;
  verificationRecordedAt?: string;
} = {}) {
  const id = options.sameIdAcrossLedgerTypes ?? "cost-1";
  const cost = costEntry({ id, externalId: id, sourceIdentityRoot: `external:portal:${id}` });
  const fact = financialFact({ id, externalId: id, sourceIdentityRoot: `external:invoice:${id}` });
  const verifiedAt = options.verificationRecordedAt ?? "2026-08-09T02:00:00.000Z";
  const costVerification = verification(cost, { recordedAt: verifiedAt });
  const reversal = verification(cost, {
    id: `reverse-${id}`,
    eventType: "reversed",
    reversesEventId: costVerification.id,
    eventSequence: 2,
    revision: 3,
    recordedAt: "2026-08-09T04:00:00.000Z"
  });
  const events: LedgerVerificationEvent[] = options.sameIdAcrossLedgerTypes
    ? [costVerification, verification(fact, { recordedAt: verifiedAt })]
    : [costVerification, reversal];
  const state = readerFor({
    costs: [cost],
    facts: options.sameIdAcrossLedgerTypes ? [fact] : [],
    events
  });
  return {
    ...state,
    workspace: workspace("workspace-a"),
    otherWorkspace: workspace("workspace-b"),
    appendVerification: (_input: { recordedAt: string }) => undefined,
    appendReversal: (_input: { recordedAt: string }) => undefined
  };
}

export function verifiedFinancialFactAsOfFixture(input: {
  factType: FinancialFact["factType"];
  candidateId: string | null;
  customerId: string | null;
  dealId: string | null;
  quoteVersionId: string | null;
  evidenceHash: string;
  commercialBindingHash: string | null;
  commercialAmountHash: string | null;
}) {
  const fact = financialFact({
    ...input,
    commercialBindingSnapshot: input.commercialBindingHash === null
      ? null : bindingSnapshot(input.commercialBindingHash)
  });
  const state = readerFor({ facts: [fact], events: [verification(fact)] });
  return { ...state, workspace: workspace("workspace-a") };
}

export function financialFactProjectionFixture() {
  const fact = financialFact();
  return { fact, verification: verification(fact) };
}

export function verifiedLedgerReaderBoundaryFixture(options: {
  serverNow?: string;
  duplicateEntryInWorkspace?: string;
} = {}) {
  const costA = costEntry();
  const costs = [costA];
  const events = [verification(costA)];
  if (options.duplicateEntryInWorkspace) {
    const duplicate = costEntry({ workspaceId: options.duplicateEntryInWorkspace });
    costs.push(duplicate);
    events.push(verification(duplicate));
  }
  const repository = new InMemoryFinancialLedgerRepository({
    costEntries: costs,
    verificationEvents: events
  }, options.serverNow ?? DEFAULT_NOW);
  const runner = new InMemoryGrowthTemporalTransactionRunner(options.serverNow ?? DEFAULT_NOW);
  const baseBarrier = new DefaultGrowthTemporalBarrier(runner);
  let seals = 0;
  let lastEffectiveAsOf: string | null = null;
  let lastCutoff: GrowthSealedReadCutoff | null = null;
  const countingBarrier: GrowthTemporalBarrier = {
    allocateAppend: (tx, workspaceId) => baseBarrier.allocateAppend(tx, workspaceId),
    async sealReadCutoff(context, effectiveAsOf) {
      seals += 1;
      lastEffectiveAsOf = effectiveAsOf;
      lastCutoff = await baseBarrier.sealReadCutoff(context, effectiveAsOf);
      return lastCutoff;
    }
  };
  const actualSealed = new RepositoryVerifiedFinancialLedgerSealedReader(repository);
  let delegateCalls = 0;
  let delegateCutoff: GrowthSealedReadCutoff | null = null;
  const delegate: VerifiedFinancialLedgerSealedReader = {
    async getVerifiedAt(cutoff, input) {
      delegateCalls += 1;
      delegateCutoff = cutoff;
      return actualSealed.getVerifiedAt(cutoff, input);
    },
    async listVerifiedCostsAt(cutoff, input) {
      delegateCalls += 1;
      delegateCutoff = cutoff;
      return actualSealed.listVerifiedCostsAt(cutoff, input);
    },
    async listVerifiedFactsAt(cutoff, input) {
      delegateCalls += 1;
      delegateCutoff = cutoff;
      return actualSealed.listVerifiedFactsAt(cutoff, input);
    }
  };
  const foundation = foundationServicesFixture({
    temporalTransactions: runner,
    temporalBarrier: countingBarrier
  });
  const publicReader = new VerifiedFinancialLedgerAsOfBoundary({
    foundation,
    sealedReader: delegate,
    now: () => options.serverNow ?? DEFAULT_NOW
  });
  return {
    workspace: workspace("workspace-a"),
    publicReader,
    sealedReader: actualSealed,
    seal: (workspaceId: string, asOf: string) =>
      baseBarrier.sealReadCutoff(workspace(workspaceId), asOf),
    sealCallCount: () => seals,
    lastFoundationEffectiveAsOf: () => lastEffectiveAsOf,
    lastDelegateCutoff: () => delegateCutoff,
    foundationCutoff: () => lastCutoff,
    delegateCallCount: () => delegateCalls,
    internalSealCallCount: () => 0,
    foundationIssuedInvalidAllToken: () => Object.freeze({
      workspaceId: "all",
      effectiveAsOf: DEFAULT_NOW,
      temporalSequence: 1
    }) as GrowthSealedReadCutoff
  };
}
