import { createHash } from "node:crypto";
import type { OutcomeAttributionInput } from "./acquisition-domain.js";
import {
  InMemoryAuthoritativeDiscoverySource,
  type InMemoryDiscoveryRow,
  type AuthoritativeDiscoverySource
} from "./acquisition-authoritative-discovery-projection.js";
import {
  DefaultAcquisitionCohortService
} from "./acquisition-cohort.js";
import {
  InMemoryAcquisitionCohortRepository
} from "./acquisition-cohort-repository.js";
import {
  FoundationRoiCommandExecutor
} from "./growth-roi-command-executor.js";
import {
  foundationServicesFixture
} from "./growth-finance-test-fixtures.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner,
  type GrowthSealedReadCutoff
} from "./growth-temporal-barrier.js";
import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import type { GrowthCapability } from "./growth-capabilities.js";
import { canonicalGrowthRequestHash } from "./growth-http-idempotency-repository.js";
import type { CanonicalSubjectMaterial } from "./acquisition-canonical-subject.js";

export interface DiscoveryRowSeed {
  eventId: string;
  candidateId: string;
  ownerId: string;
  discoveredAt: string;
  recordedAt: string;
  actorKey: string;
  planId: string;
  runId?: string;
  shardId?: string;
}

function attributionFor(seed: DiscoveryRowSeed): OutcomeAttributionInput {
  return Object.freeze({
    attributionVersion: "acquisition-run.v1",
    runId: seed.runId ?? `run-${seed.eventId}`,
    planId: seed.planId,
    planVersionId: `plan-version-${seed.planId}`,
    planVersion: 1,
    planSnapshotHash: `sha256:${"a".repeat(64)}`,
    discoveredEventId: seed.eventId,
    discoveredAt: seed.discoveredAt,
    shardId: seed.shardId ?? `shard-${seed.eventId}`,
    operationId: `operation-${seed.eventId}`,
    connectionId: `connection-${seed.eventId}`,
    providerId: `provider-${seed.eventId}`,
    evidenceIds: [`evidence-${seed.eventId}`],
    providerIds: [`provider-${seed.eventId}`],
    queryIds: [`query-${seed.eventId}`],
    strategyVersion: "strategy-1",
    qualificationDecisionId: `decision-${seed.eventId}`,
    decisionVersion: "decision-v1",
    decisionSnapshotHash: `sha256:${"b".repeat(64)}`
  });
}

function rowFor(seed: DiscoveryRowSeed): InMemoryDiscoveryRow {
  const material: CanonicalSubjectMaterial = Object.freeze({
    kind: "individual",
    platform: "douyin",
    publicActorKey: seed.actorKey,
    canonicalProfileUrl: null
  });
  return Object.freeze({
    eventId: seed.eventId,
    candidateId: seed.candidateId,
    ownerId: seed.ownerId,
    discoveredAt: seed.discoveredAt,
    sourceRecordedAt: seed.recordedAt,
    sourceTemporalSequence: 1,
    material,
    attribution: attributionFor(seed)
  });
}

export function discoverySource(
  seeds: readonly DiscoveryRowSeed[]
) {
  const source = new InMemoryAuthoritativeDiscoverySource(
    seeds.map(rowFor)
  );
  const listCalls: Array<{ cutoff: GrowthSealedReadCutoff }> = [];
  const watermarkCalls: Array<{ cutoff: GrowthSealedReadCutoff }> = [];
  const wrapped: AuthoritativeDiscoverySource & {
    listCalls: Array<{ cutoff: GrowthSealedReadCutoff }>;
    watermarkCalls: Array<{ cutoff: GrowthSealedReadCutoff }>;
    appendRows(seeds: readonly DiscoveryRowSeed[]): void;
  } = {
    listCalls,
    watermarkCalls,
    async listDiscoveries(
      workspaceId: string,
      query: Parameters<typeof source.listDiscoveries>[1]
    ) {
      listCalls.push({ cutoff: query.cutoff });
      return source.listDiscoveries(workspaceId, query);
    },
    async getWatermark(
      workspaceId: string,
      query: Parameters<typeof source.getWatermark>[1]
    ) {
      watermarkCalls.push({ cutoff: query.cutoff });
      return source.getWatermark(workspaceId, query);
    },
    appendRows(seeds: readonly DiscoveryRowSeed[]) {
      source.appendRows(seeds.map(rowFor));
    }
  };
  return wrapped;
}

export function fixtureWatermark(
  eventId: string,
  count: number
) {
  const rows = Array.from({ length: count }, (_, index) => ({
    eventId: `event-${index + 1}`,
    sourceRecordedAt: `2026-08-0${index + 1}T01:00:01.000Z`
  }));
  const last = rows.at(-1)!;
  return {
    lastSourceRecordedAt: last.sourceRecordedAt,
    lastEventId: eventId,
    lastSourceTemporalSequence: 1,
    eventCount: count,
    eventSetHash: `sha256:${createHash("sha256")
      .update(rows.map((row) =>
        `${row.eventId}\u0000${row.sourceRecordedAt}`).join("\u001f"))
      .digest("hex")}`
  };
}

export function workspaceContext(
  workspaceId: string,
  actorId = "admin-a"
): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId,
    kind: "team",
    actorId,
    role: "admin",
    teamId: workspaceId,
    capabilities: Object.freeze([
      "roi.close",
      "growth.performance.workspace.read",
      "ledger.pending.create",
      "ledger.verify"
    ]) as readonly GrowthCapability[],
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

export function cohortCommandContext(
  workspaceId: string,
  actorId = "admin-a",
  idempotencyKey = "cohort-0001"
): CommandContext {
  const workspace = workspaceContext(workspaceId, actorId);
  return Object.freeze({
    workspace,
    actorId,
    idempotencyKey,
    requestHash: canonicalGrowthRequestHash({
      workspaceId,
      actorId,
      idempotencyKey,
      path: "/api/v1/acquisition/cohorts"
    }),
    expectedRevision: null
  });
}

export async function sealedCutoff(
  workspace: ActiveWorkspaceContext,
  asOf: string
): Promise<GrowthSealedReadCutoff> {
  const runner = new InMemoryGrowthTemporalTransactionRunner(asOf);
  return new DefaultGrowthTemporalBarrier(runner).sealReadCutoff(
    workspace, asOf
  );
}

export function cohortServiceFixture(options: {
  repository?: InMemoryAcquisitionCohortRepository;
  discoveries?: ReturnType<typeof discoverySource>;
  temporalTransactions?: InMemoryGrowthTemporalTransactionRunner;
  ids?: { next(): string };
}) {
  const repository = options.repository
    ?? new InMemoryAcquisitionCohortRepository();
  const transactions = options.temporalTransactions
    ?? new InMemoryGrowthTemporalTransactionRunner(
      "2026-08-09T00:00:00.000Z"
    );
  const barrier = new DefaultGrowthTemporalBarrier(transactions);
  if (options.repository && options.temporalTransactions) {
    // repository already wired by the caller
  }
  const foundation = foundationServicesFixture({
    temporalTransactions: transactions,
    temporalBarrier: barrier
  });
  const service = new DefaultAcquisitionCohortService({
    repository,
    foundation,
    commandExecutor: new FoundationRoiCommandExecutor({
      foundation,
      now: () => "2026-08-09T00:00:00.000Z"
    }),
    discoveries: options.discoveries ?? discoverySource([]),
    now: () => "2026-08-09T00:00:00.000Z",
    ids: options.ids
  });
  return {
    service,
    repository,
    closureCatchUp: service,
    readCatchUp: service,
    workspace: workspaceContext("workspace-a")
  };
}

export function lateRecordedDiscoveryFixture(options: {
  initial: readonly DiscoveryRowSeed[];
  late?: readonly DiscoveryRowSeed[];
  cohorts?: Array<{
    id: string;
    from: string;
    to: string;
  }>;
  projectOnlyAfterSeal?: boolean;
}) {
  const cohorts = options.cohorts ?? [{
    id: "cohort-1",
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-08T00:00:00.000Z"
  }];
  const transactions = new InMemoryGrowthTemporalTransactionRunner(
    "2026-08-09T00:00:00.000Z"
  );
  const barrier = new DefaultGrowthTemporalBarrier(transactions);
  const repository = new InMemoryAcquisitionCohortRepository(
    transactions, barrier
  );
  const cohortIds = cohorts.map((cohort) => cohort.id);
  let cohortIndex = 0;
  const discoveries = discoverySource(options.initial);
  const fixture = cohortServiceFixture({
    repository,
    discoveries: discoveries as never,
    temporalTransactions: transactions,
    ids: {
      next: () => cohortIds[cohortIndex++] ?? `cohort-${cohortIndex}`
    }
  });
  const created = new Map<string, { id: string }>();
  const workspace = fixture.workspace;
  return {
    ...fixture,
    seal: (asOf: string) => sealedCutoff(workspace, asOf),
    appendLateRows: async () => {
      discoveries.appendRows(options.late ?? []);
    },
    catchUp: async (asOf: string) => {
      transactions.setDatabaseNow(asOf);
      const cutoff = await sealedCutoff(workspace, asOf);
      const cohort = created.values().next().value as { id: string };
      return fixture.closureCatchUp.ensureForClosure(
        cohortCommandContext("workspace-a"),
        { closureOperationId: "close-1", cohortId: cohort.id, cutoff }
      );
    },
    catchUpCohort: async (cohortId: string, cutoff: GrowthSealedReadCutoff) => {
      transactions.setDatabaseNow(cutoff.effectiveAsOf);
      return fixture.closureCatchUp.ensureForClosure(
        cohortCommandContext("workspace-a"),
        { closureOperationId: "close-1", cohortId, cutoff }
      );
    },
    listSources: async () => repository.listMemberSources("workspace-a"),
    listMembersAt: async (cohortId: string, cutoff: GrowthSealedReadCutoff) =>
      repository.listMembersAt("workspace-a", cohortId, cutoff),
    listOwnershipVersions: () =>
      repository.listMembershipVersions("workspace-a"),
    createCohorts: async () => {
      for (const cohort of cohorts) {
        const result = await fixture.service.create(
          cohortCommandContext("workspace-a", "admin-a",
            `cohort-${cohort.id}`),
          {
            platform: "douyin",
            cohortFrom: cohort.from,
            cohortTo: cohort.to,
            definitionVersion: "weekly.v1",
            firstTouchRuleVersion: "first-authoritative-discovery.v1"
          }
        );
        created.set(cohort.id, result);
      }
    }
  };
}

export function sha256Of(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex")}`;
}
