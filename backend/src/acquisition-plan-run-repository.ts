export type AcquisitionSubjectChannel = "organization" | "individual";
export type AcquisitionOperationKind =
  | "search"
  | "content_fetch"
  | "import_rows";
export type AcquisitionProviderKind = "search" | "content_fetch" | "import";
export type AcquisitionPlanStatus = "draft" | "approved" | "archived";
export type AcquisitionRunStatus =
  | "queued"
  | "running"
  | "pause_requested"
  | "paused"
  | "cancel_requested"
  | "cancelled"
  | "succeeded"
  | "succeeded_empty"
  | "partial_success"
  | "failed"
  | "budget_exhausted";
export type AcquisitionShardStatus =
  | "queued"
  | "running"
  | "retry_scheduled"
  | "pause_requested"
  | "paused"
  | "cancel_requested"
  | "cancelled"
  | "succeeded"
  | "succeeded_empty"
  | "partial_success"
  | "failed"
  | "budget_exhausted";

export interface AcquisitionBudgetLimit {
  maxRequests: number;
  maxResults: number;
  maxAmountMinor: number;
  maxDurationSeconds: number;
}

export interface AcquisitionBudgetSnapshot extends AcquisitionBudgetLimit {
  billingCurrency: string;
}

export interface AcquisitionBudgetUsage {
  requests: number;
  results: number;
  amountMinor: number;
  durationSeconds: number;
}

export interface AcquisitionModelSnapshotRef {
  jobSnapshotId: string;
  connectionId: string;
  credentialVersion: number;
  provider: string;
  model: string;
  capabilitySnapshotHash: string;
  promptVersion: string;
  schemaVersion: string;
  promptHash: string;
  schemaHash: string;
}

export interface AcquisitionProviderConnectionSnapshot {
  connectionId: string;
  providerId: string;
  kind: AcquisitionProviderKind;
  status: "active" | "inactive" | "disabled";
  credentialVersion: number;
}

export interface AcquisitionPlanOperation {
  operationId: string;
  subjectChannel: AcquisitionSubjectChannel;
  kind: AcquisitionOperationKind;
  connectionId: string;
  query?: string;
  sourceRef?: string;
  allocatedBudget: AcquisitionBudgetUsage;
}

export interface AcquisitionPlanPayload {
  name: string;
  objective: string;
  icp: {
    industries: string[];
    regions: string[];
    organizationCriteria: string[];
    individualCriteria: string[];
    exclusionRules: string[];
  };
  subjectChannels: {
    organization: boolean;
    individual: boolean;
  };
  providerConnections: AcquisitionProviderConnectionSnapshot[];
  operations: AcquisitionPlanOperation[];
  budgetSnapshot: AcquisitionBudgetSnapshot;
  modelSnapshotRef: AcquisitionModelSnapshotRef;
  stopConditions: {
    stopWhenBudgetExhausted: boolean;
    stopWhenNoMoreResults: boolean;
  };
}

export interface AcquisitionPlan {
  id: string;
  ownerId: string;
  teamId: string;
  status: AcquisitionPlanStatus;
  version: number;
  revision: number;
  etag: string;
  currentVersionId: string;
  approvedVersionId: string | null;
  approvedSnapshotHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  budgetSnapshot: AcquisitionBudgetSnapshot;
  payload: AcquisitionPlanPayload;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface AcquisitionPlanVersion {
  id: string;
  planId: string;
  ownerId: string;
  teamId: string;
  version: number;
  payload: AcquisitionPlanPayload;
  payloadHash: string;
  createdBy: string;
  createdAt: string;
}

export interface AcquisitionRun {
  id: string;
  ownerId: string;
  teamId: string;
  planId: string;
  planVersionId: string;
  planVersion: number;
  planSnapshotHash: string;
  parentRunId: string | null;
  status: AcquisitionRunStatus;
  terminationIntent: "cancelled" | "budget_exhausted" | null;
  revision: number;
  etag: string;
  budgetSnapshotId: string;
  budgetSnapshot: AcquisitionBudgetSnapshot;
  budgetSnapshotHash: string;
  billingCurrency: string;
  modelSnapshotRef: AcquisitionModelSnapshotRef;
  consumedBudget: AcquisitionBudgetUsage;
  evidenceCount: number;
  reason: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AcquisitionOperationShard {
  id: string;
  runId: string;
  ownerId: string;
  teamId: string;
  operationId: string;
  parentShardId: string | null;
  subjectChannel: AcquisitionSubjectChannel;
  kind: AcquisitionOperationKind;
  connection: AcquisitionProviderConnectionSnapshot;
  query: string | null;
  sourceRef: string;
  status: AcquisitionShardStatus;
  budgetSnapshotId: string;
  allocatedBudget: AcquisitionBudgetUsage;
  consumedBudget: AcquisitionBudgetUsage;
  modelSnapshotRef: AcquisitionModelSnapshotRef;
  evidenceCount: number;
  completionIdempotencyKey?: string;
  completionRequestHash?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AcquisitionPlanEvent {
  id: string;
  planId: string;
  ownerId: string;
  teamId: string;
  type: string;
  actorId: string;
  revision: number;
  at: string;
  data: Record<string, unknown>;
}

export interface AcquisitionRunEvent {
  id: string;
  runId: string;
  shardId: string | null;
  ownerId: string;
  teamId: string;
  type: string;
  actorId: string;
  revision: number;
  at: string;
  data: Record<string, unknown>;
}

export interface AcquisitionAuditEvent {
  id: string;
  ownerId: string;
  teamId: string;
  actorId: string;
  action: string;
  targetType: "plan" | "run" | "shard";
  targetId: string;
  beforeHash: string | null;
  afterHash: string | null;
  at: string;
  data: Record<string, unknown>;
}

export interface AcquisitionIdempotencyRecord {
  scopeKey: string;
  requestHash: string;
  resultType: "plan" | "run";
  resultId: string;
  createdAt: string;
}

export interface AcquisitionUsageIdempotencyRecord {
  scopeKey: string;
  requestHash: string;
  runId: string;
  createdAt: string;
}

export type AcquisitionExecutionIntentKind =
  | "enqueue"
  | "pause"
  | "resume"
  | "cancel";

export interface AcquisitionExecutionIntent {
  id: string;
  runId: string;
  ownerId: string;
  teamId: string;
  kind: AcquisitionExecutionIntentKind;
  payload: {
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  };
  status: "pending" | "dispatching" | "dispatched";
  attempts: number;
  leaseUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AcquisitionRepositoryState {
  plans: Map<string, AcquisitionPlan>;
  planVersions: Map<string, AcquisitionPlanVersion>;
  runs: Map<string, AcquisitionRun>;
  shards: Map<string, AcquisitionOperationShard>;
  planEvents: AcquisitionPlanEvent[];
  runEvents: AcquisitionRunEvent[];
  auditEvents: AcquisitionAuditEvent[];
  idempotency: Map<string, AcquisitionIdempotencyRecord>;
  usageIdempotency: Map<string, AcquisitionUsageIdempotencyRecord>;
  executionIntents: Map<string, AcquisitionExecutionIntent>;
}

function emptyState(): AcquisitionRepositoryState {
  return {
    plans: new Map(),
    planVersions: new Map(),
    runs: new Map(),
    shards: new Map(),
    planEvents: [],
    runEvents: [],
    auditEvents: [],
    idempotency: new Map(),
    usageIdempotency: new Map(),
    executionIntents: new Map()
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export interface AcquisitionPlanRunRepositoryTransaction {
  getPlan(id: string): AcquisitionPlan | null;
  putPlan(plan: AcquisitionPlan): void;
  appendPlanVersion(version: AcquisitionPlanVersion): void;
  getPlanVersion(id: string): AcquisitionPlanVersion | null;
  getRun(id: string): AcquisitionRun | null;
  putRun(run: AcquisitionRun): void;
  getShard(id: string): AcquisitionOperationShard | null;
  putShard(shard: AcquisitionOperationShard): void;
  listRunShards(runId: string): AcquisitionOperationShard[];
  appendPlanEvent(event: AcquisitionPlanEvent): void;
  appendRunEvent(event: AcquisitionRunEvent): void;
  appendAuditEvent(event: AcquisitionAuditEvent): void;
  getIdempotency(scopeKey: string): AcquisitionIdempotencyRecord | null;
  putIdempotency(record: AcquisitionIdempotencyRecord): void;
  getUsageIdempotency(
    scopeKey: string
  ): AcquisitionUsageIdempotencyRecord | null;
  putUsageIdempotency(record: AcquisitionUsageIdempotencyRecord): void;
  getExecutionIntent(id: string): AcquisitionExecutionIntent | null;
  putExecutionIntent(intent: AcquisitionExecutionIntent): void;
  listRunExecutionIntents(runId: string): AcquisitionExecutionIntent[];
}

export interface AcquisitionPlanRunRepository {
  transaction<T>(
    work: (
      transaction: AcquisitionPlanRunRepositoryTransaction
    ) => Promise<T> | T
  ): Promise<T>;
  getPlan(id: string): Promise<AcquisitionPlan | null>;
  getPlanVersion(id: string): Promise<AcquisitionPlanVersion | null>;
  listPlanVersions(planId: string): Promise<AcquisitionPlanVersion[]>;
  getRun(id: string): Promise<AcquisitionRun | null>;
  listRunShards(runId: string): Promise<AcquisitionOperationShard[]>;
  listPlanEvents(planId: string): Promise<AcquisitionPlanEvent[]>;
  listRunEvents(runId: string): Promise<AcquisitionRunEvent[]>;
  listRunExecutionIntents(
    runId: string
  ): Promise<AcquisitionExecutionIntent[]>;
  /**
   * Internal recovery scan. Implementations must return only intents that
   * still have an unresolved persisted shard transition.
   */
  listRecoverableExecutionIntents(
    now: string
  ): Promise<AcquisitionExecutionIntent[]>;
  listAuditEvents(scope: {
    ownerId: string;
    teamId: string;
  }): Promise<AcquisitionAuditEvent[]>;
}

function transactionFor(
  state: AcquisitionRepositoryState
): AcquisitionPlanRunRepositoryTransaction {
  return {
    getPlan: (id) => clone(state.plans.get(id) ?? null),
    putPlan: (plan) => {
      state.plans.set(plan.id, clone(plan));
    },
    appendPlanVersion: (version) => {
      if (state.planVersions.has(version.id)) {
        throw new Error(`Plan version already exists: ${version.id}`);
      }
      state.planVersions.set(version.id, clone(version));
    },
    getPlanVersion: (id) => clone(state.planVersions.get(id) ?? null),
    getRun: (id) => clone(state.runs.get(id) ?? null),
    putRun: (run) => {
      state.runs.set(run.id, clone(run));
    },
    getShard: (id) => clone(state.shards.get(id) ?? null),
    putShard: (shard) => {
      state.shards.set(shard.id, clone(shard));
    },
    listRunShards: (runId) => Array.from(state.shards.values())
      .filter((shard) => shard.runId === runId)
      .map(clone),
    appendPlanEvent: (event) => {
      if (state.planEvents.some((item) => item.id === event.id)) {
        throw new Error(`Plan event already exists: ${event.id}`);
      }
      state.planEvents.push(clone(event));
    },
    appendRunEvent: (event) => {
      if (state.runEvents.some((item) => item.id === event.id)) {
        throw new Error(`Run event already exists: ${event.id}`);
      }
      state.runEvents.push(clone(event));
    },
    appendAuditEvent: (event) => {
      if (state.auditEvents.some((item) => item.id === event.id)) {
        throw new Error(`Audit event already exists: ${event.id}`);
      }
      state.auditEvents.push(clone(event));
    },
    getIdempotency: (scopeKey) =>
      clone(state.idempotency.get(scopeKey) ?? null),
    putIdempotency: (record) => {
      if (state.idempotency.has(record.scopeKey)) {
        throw new Error(
          `Idempotency record already exists: ${record.scopeKey}`
        );
      }
      state.idempotency.set(record.scopeKey, clone(record));
    },
    getUsageIdempotency: (scopeKey) =>
      clone(state.usageIdempotency.get(scopeKey) ?? null),
    putUsageIdempotency: (record) => {
      if (state.usageIdempotency.has(record.scopeKey)) {
        throw new Error(
          `Usage idempotency record already exists: ${record.scopeKey}`
        );
      }
      state.usageIdempotency.set(record.scopeKey, clone(record));
    },
    getExecutionIntent: (id) =>
      clone(state.executionIntents.get(id) ?? null),
    putExecutionIntent: (intent) => {
      state.executionIntents.set(intent.id, clone(intent));
    },
    listRunExecutionIntents: (runId) =>
      Array.from(state.executionIntents.values())
        .filter((intent) => intent.runId === runId)
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt)
          || left.id.localeCompare(right.id))
        .map(clone)
  };
}

export class InMemoryAcquisitionPlanRunRepository
implements AcquisitionPlanRunRepository {
  private state = emptyState();
  private tail: Promise<void> = Promise.resolve();

  transaction<T>(
    work: (
      transaction: AcquisitionPlanRunRepositoryTransaction
    ) => Promise<T> | T
  ): Promise<T> {
    const current = this.tail.then(async () => {
      const workingState = clone(this.state);
      const result = await work(transactionFor(workingState));
      this.state = workingState;
      return clone(result);
    });
    this.tail = current.then(() => undefined, () => undefined);
    return current;
  }

  private async snapshot() {
    await this.tail;
    return clone(this.state);
  }

  async getPlan(id: string) {
    const state = await this.snapshot();
    return clone(state.plans.get(id) ?? null);
  }

  async getPlanVersion(id: string) {
    const state = await this.snapshot();
    return clone(state.planVersions.get(id) ?? null);
  }

  async listPlanVersions(planId: string) {
    const state = await this.snapshot();
    return Array.from(state.planVersions.values())
      .filter((version) => version.planId === planId)
      .sort((left, right) => left.version - right.version)
      .map(clone);
  }

  async getRun(id: string) {
    const state = await this.snapshot();
    return clone(state.runs.get(id) ?? null);
  }

  async listRunShards(runId: string) {
    const state = await this.snapshot();
    return Array.from(state.shards.values())
      .filter((shard) => shard.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id))
      .map(clone);
  }

  async listPlanEvents(planId: string) {
    const state = await this.snapshot();
    return state.planEvents
      .filter((event) => event.planId === planId)
      .map(clone);
  }

  async listRunEvents(runId: string) {
    const state = await this.snapshot();
    return state.runEvents
      .filter((event) => event.runId === runId)
      .map(clone);
  }

  async listRunExecutionIntents(runId: string) {
    const state = await this.snapshot();
    return Array.from(state.executionIntents.values())
      .filter((intent) => intent.runId === runId)
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id))
      .map(clone);
  }

  async listRecoverableExecutionIntents(now: string) {
    const state = await this.snapshot();
    return Array.from(state.executionIntents.values())
      .filter((intent) => intentNeedsRecovery(
        intent,
        Array.from(state.shards.values()).filter(
          (shard) => shard.runId === intent.runId
        ),
        now
      ))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id))
      .map(clone);
  }

  async listAuditEvents(scope: { ownerId: string; teamId: string }) {
    const state = await this.snapshot();
    return state.auditEvents
      .filter((event) => event.ownerId === scope.ownerId
        && event.teamId === scope.teamId)
      .map(clone);
  }
}

export function intentNeedsRecovery(
  intent: AcquisitionExecutionIntent,
  shards: AcquisitionOperationShard[],
  now: string
) {
  if (intent.status === "pending") return true;
  if (intent.status === "dispatching") {
    return !intent.leaseUntil
      || Date.parse(intent.leaseUntil) <= Date.parse(now);
  }
  const selected = new Set(intent.payload.shardIds);
  const statuses = shards
    .filter((shard) => selected.has(shard.id))
    .map((shard) => shard.status);
  if (intent.kind === "enqueue" || intent.kind === "resume") {
    return statuses.some((status) =>
      status === "queued" || status === "retry_scheduled");
  }
  if (intent.kind === "pause") {
    return statuses.includes("pause_requested");
  }
  return statuses.includes("cancel_requested");
}
