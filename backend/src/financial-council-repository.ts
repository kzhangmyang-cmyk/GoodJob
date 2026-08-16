import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import {
  applyFinancialCouncilTransition,
  createFinancialCouncilRunEvent,
  financialCouncilCanonicalHash,
  financialCouncilError,
  immutableFinancialCouncilValue,
  type FinancialCouncilRun,
  type FinancialCouncilRunEvent,
  type FinancialCouncilTransitionKind,
  type FinancialSnapshotRecord
} from "./financial-council-domain.js";

export interface FinancialCouncilCommandResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

export interface StoreFrozenFinancialSnapshotInput {
  readonly runId: string;
  readonly snapshot: FinancialSnapshotRecord;
  readonly occurredAt: string;
}

export interface TransitionFinancialCouncilRunInput {
  readonly runId: string;
  readonly kind: FinancialCouncilTransitionKind;
  readonly occurredAt: string;
  readonly reasonCode: string | null;
}

export interface FinancialCouncilRepository {
  createRun(
    command: CommandContext,
    aggregate: FinancialCouncilRun
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>>;
  findRun(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<FinancialCouncilRun | null>;
  listEvents(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilRunEvent[]>;
  storeFrozenSnapshot(
    command: CommandContext,
    input: StoreFrozenFinancialSnapshotInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>>;
  transitionRun(
    command: CommandContext,
    input: TransitionFinancialCouncilRunInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>>;
}

function key(workspaceId: string, id: string): string {
  return `${workspaceId}\u0000${id}`;
}

function exactRevision(command: CommandContext): number {
  if (!Number.isSafeInteger(command.expectedRevision)
    || Number(command.expectedRevision) < 1) {
    throw financialCouncilError("financial_council_revision_conflict");
  }
  return command.expectedRevision as number;
}

function assertCreate(
  command: CommandContext,
  aggregate: FinancialCouncilRun
): void {
  if (aggregate.workspaceId !== command.workspace.workspaceId
    || aggregate.requestHash !== command.requestHash
    || aggregate.status !== "created"
    || aggregate.revision !== 1
    || aggregate.snapshotId !== null
    || aggregate.snapshotHash !== null) {
    throw financialCouncilError("financial_council_create_invalid");
  }
}

export function assertFinancialSnapshotRecord(
  aggregate: FinancialCouncilRun,
  record: FinancialSnapshotRecord
): void {
  if (record.workspaceId !== aggregate.workspaceId
    || record.runId !== aggregate.runId
    || record.snapshot.snapshotId !== record.snapshotId
    || record.snapshot.runId !== record.runId
    || record.snapshot.workspaceId !== record.workspaceId
    || financialCouncilCanonicalHash(record.snapshot) !== record.snapshotHash) {
    throw financialCouncilError("financial_council_snapshot_integrity");
  }
}

export class InMemoryFinancialCouncilRepository
implements FinancialCouncilRepository {
  private readonly runs = new Map<string, FinancialCouncilRun>();
  private readonly events = new Map<string, FinancialCouncilRunEvent[]>();
  private readonly snapshots = new Map<string, FinancialSnapshotRecord>();
  private readonly creationKeys = new Map<string, string>();

  async createRun(
    command: CommandContext,
    aggregate: FinancialCouncilRun
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    assertCreate(command, aggregate);
    const creationKey = key(aggregate.workspaceId, aggregate.creationKeyHash);
    const existingId = this.creationKeys.get(creationKey);
    if (existingId) {
      const existing = this.runs.get(key(aggregate.workspaceId, existingId));
      if (!existing || existing.requestHash !== aggregate.requestHash) {
        throw financialCouncilError("financial_council_idempotency_conflict");
      }
      return { value: existing, replayed: true };
    }
    const aggregateKey = key(aggregate.workspaceId, aggregate.runId);
    if (this.runs.has(aggregateKey)) {
      throw financialCouncilError("financial_council_run_conflict");
    }
    const stored = immutableFinancialCouncilValue(aggregate);
    const event = createFinancialCouncilRunEvent(stored, {
      fromStatus: null,
      reasonCode: null,
      occurredAt: stored.createdAt,
      actorId: command.actorId
    });
    this.runs.set(aggregateKey, stored);
    this.creationKeys.set(creationKey, stored.runId);
    this.events.set(aggregateKey, [event]);
    return { value: stored, replayed: false };
  }

  async findRun(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<FinancialCouncilRun | null> {
    return this.runs.get(key(context.workspaceId, runId)) ?? null;
  }

  async listEvents(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilRunEvent[]> {
    return Object.freeze([
      ...(this.events.get(key(context.workspaceId, runId)) ?? [])
    ]);
  }

  async storeFrozenSnapshot(
    command: CommandContext,
    input: StoreFrozenFinancialSnapshotInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    const expectedRevision = exactRevision(command);
    const aggregateKey = key(command.workspace.workspaceId, input.runId);
    const current = this.runs.get(aggregateKey);
    if (!current) {
      throw financialCouncilError("financial_council_run_not_found");
    }
    if (current.revision !== expectedRevision) {
      throw financialCouncilError("financial_council_revision_conflict");
    }
    assertFinancialSnapshotRecord(current, input.snapshot);
    if (this.snapshots.has(key(current.workspaceId, input.snapshot.snapshotId))) {
      throw financialCouncilError("financial_council_snapshot_conflict");
    }
    const withSnapshot = immutableFinancialCouncilValue({
      ...current,
      snapshotId: input.snapshot.snapshotId,
      snapshotHash: input.snapshot.snapshotHash
    });
    const next = applyFinancialCouncilTransition(withSnapshot, {
      kind: "snapshot_frozen",
      occurredAt: input.occurredAt,
      actorId: command.actorId
    });
    const event = createFinancialCouncilRunEvent(next, {
      fromStatus: current.status,
      reasonCode: null,
      occurredAt: input.occurredAt,
      actorId: command.actorId
    });
    this.snapshots.set(
      key(current.workspaceId, input.snapshot.snapshotId),
      immutableFinancialCouncilValue(input.snapshot)
    );
    this.runs.set(aggregateKey, next);
    this.events.get(aggregateKey)!.push(event);
    return { value: next, replayed: false };
  }

  async transitionRun(
    command: CommandContext,
    input: TransitionFinancialCouncilRunInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    if (input.kind === "snapshot_frozen") {
      throw financialCouncilError("financial_council_transition_invalid");
    }
    const expectedRevision = exactRevision(command);
    const aggregateKey = key(command.workspace.workspaceId, input.runId);
    const current = this.runs.get(aggregateKey);
    if (!current) {
      throw financialCouncilError("financial_council_run_not_found");
    }
    if (current.revision !== expectedRevision) {
      throw financialCouncilError("financial_council_revision_conflict");
    }
    const next = applyFinancialCouncilTransition(current, {
      kind: input.kind,
      occurredAt: input.occurredAt,
      actorId: command.actorId
    });
    const event = createFinancialCouncilRunEvent(next, {
      fromStatus: current.status,
      reasonCode: input.reasonCode,
      occurredAt: input.occurredAt,
      actorId: command.actorId
    });
    this.runs.set(aggregateKey, next);
    this.events.get(aggregateKey)!.push(event);
    return { value: next, replayed: false };
  }
}
