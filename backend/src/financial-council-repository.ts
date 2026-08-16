import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import {
  FINANCIAL_COUNCIL_RUN_STATUSES,
  applyFinancialCouncilTransition,
  createFinancialCouncilRunEvent,
  financialCouncilCanonicalJson,
  financialCouncilCanonicalHash,
  financialCouncilError,
  immutableFinancialCouncilInput,
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

export interface CreateAndFreezeFinancialCouncilRunInput {
  readonly aggregate: FinancialCouncilRun;
  readonly snapshot: FinancialSnapshotRecord;
  readonly occurredAt: string;
}

export interface ListRunnableFinancialCouncilRunsInput {
  readonly after: {
    readonly workspaceId: string;
    readonly runId: string;
  } | null;
  readonly limit: number;
}

export interface FinancialCouncilRepository {
  createAndFreezeRun(
    command: CommandContext,
    input: CreateAndFreezeFinancialCouncilRunInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>>;
  createRun(
    command: CommandContext,
    aggregate: FinancialCouncilRun
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>>;
  findFrozenRunByCreationKey(
    context: ActiveWorkspaceContext,
    creationKeyHash: string,
    requestHash: string
  ): Promise<FinancialCouncilRun | null>;
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
  listRunnableRuns(
    input: ListRunnableFinancialCouncilRunsInput
  ): Promise<readonly FinancialCouncilRun[]>;
}

const HASH = /^sha256:[0-9a-f]{64}$/u;
const TRANSITION_KINDS = new Set<string>(
  FINANCIAL_COUNCIL_RUN_STATUSES.filter((status) => status !== "created")
);

function inputInvalid(): never {
  throw financialCouncilError("financial_council_input_invalid");
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) inputInvalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) inputInvalid();
  const keys = ownKeys as string[];
  if (required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) =>
      !required.includes(key) && !optional.includes(key))) inputInvalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) inputInvalid();
  }
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255) {
    inputInvalid();
  }
}

function hash(value: unknown): asserts value is `sha256:${string}` {
  if (typeof value !== "string" || !HASH.test(value)) inputInvalid();
}

function timestamp(value: unknown): asserts value is string {
  if (typeof value !== "string") inputInvalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    inputInvalid();
  }
}

function integer(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value)) inputInvalid();
}

function stringArray(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) inputInvalid();
  for (const item of value) identifier(item);
}

function assertWorkspace(value: unknown): void {
  exactObject(value, ["workspaceId", "kind", "actorId", "role", "teamId",
    "capabilities", "capabilityRegistryVersion"]);
  identifier(value.workspaceId);
  if (value.kind !== "team" && value.kind !== "personal") inputInvalid();
  identifier(value.actorId);
  identifier(value.role);
  identifier(value.teamId);
  stringArray(value.capabilities);
  identifier(value.capabilityRegistryVersion);
}

function assertCommand(
  value: unknown,
  revision: "null" | "required"
): asserts value is CommandContext {
  exactObject(value, ["workspace", "actorId", "idempotencyKey", "requestHash",
    "expectedRevision"]);
  assertWorkspace(value.workspace);
  identifier(value.actorId);
  identifier(value.idempotencyKey);
  hash(value.requestHash);
  if (revision === "null") {
    if (value.expectedRevision !== null) inputInvalid();
  } else if (!Number.isSafeInteger(value.expectedRevision)
    || Number(value.expectedRevision) < 1) inputInvalid();
}

function assertBusinessReport(value: unknown):
asserts value is FinancialCouncilRun["businessReport"] {
  exactObject(value,
    ["currency", "companyName", "period", "balanceSheet", "incomeStatement"],
    ["cashFlow", "costDetail", "taxRisk"]);
  if (value.currency !== "CNY" && value.currency !== "USD") inputInvalid();
  identifier(value.companyName);
  identifier(value.period);
  exactObject(value.balanceSheet, ["period", "cashMinor", "receivablesMinor",
    "inventoryMinor", "otherCurrentAssetsMinor", "nonCurrentAssetsMinor",
    "currentLiabilitiesMinor", "nonCurrentLiabilitiesMinor",
    "accountsPayableMinor"]);
  identifier(value.balanceSheet.period);
  for (const key of ["cashMinor", "receivablesMinor", "inventoryMinor",
    "otherCurrentAssetsMinor", "nonCurrentAssetsMinor", "currentLiabilitiesMinor",
    "nonCurrentLiabilitiesMinor", "accountsPayableMinor"] as const) {
    integer(value.balanceSheet[key]);
  }
  exactObject(value.incomeStatement,
    ["period", "revenueMinor", "costOfGoodsSoldMinor", "operatingExpensesMinor",
      "interestExpenseMinor", "taxExpenseMinor"], ["productLines", "customers"]);
  identifier(value.incomeStatement.period);
  for (const key of ["revenueMinor", "costOfGoodsSoldMinor",
    "operatingExpensesMinor", "interestExpenseMinor", "taxExpenseMinor"] as const) {
    integer(value.incomeStatement[key]);
  }
  if (value.incomeStatement.productLines !== undefined) {
    if (!Array.isArray(value.incomeStatement.productLines)) inputInvalid();
    for (const item of value.incomeStatement.productLines) {
      exactObject(item, ["name", "revenueMinor", "costOfGoodsSoldMinor",
        "afterSalesCostMinor", "shippingCostMinor", "sellingExpenseMinor",
        "allocatedOverheadMinor"]);
      identifier(item.name);
      for (const key of ["revenueMinor", "costOfGoodsSoldMinor",
        "afterSalesCostMinor", "shippingCostMinor", "sellingExpenseMinor",
        "allocatedOverheadMinor"] as const) integer(item[key]);
    }
  }
  if (value.incomeStatement.customers !== undefined) {
    if (!Array.isArray(value.incomeStatement.customers)) inputInvalid();
    for (const item of value.incomeStatement.customers) {
      exactObject(item, ["name", "revenueMinor", "grossProfitMinor",
        "serviceCostMinor", "paymentDays", "outstandingReceivableMinor"]);
      identifier(item.name);
      for (const key of ["revenueMinor", "grossProfitMinor", "serviceCostMinor",
        "paymentDays", "outstandingReceivableMinor"] as const) integer(item[key]);
    }
  }
  if (value.cashFlow !== undefined && value.cashFlow !== null) {
    exactObject(value.cashFlow, ["period", "openingCashMinor",
      "operatingInflowMinor", "operatingOutflowMinor", "investingNetMinor",
      "financingNetMinor", "expectedInflowsNext30DaysMinor",
      "expectedOutflowsNext30DaysMinor", "expectedInflowsNext31To90DaysMinor",
      "expectedOutflowsNext31To90DaysMinor"], ["receivables"]);
    identifier(value.cashFlow.period);
    for (const key of ["openingCashMinor", "operatingInflowMinor",
      "operatingOutflowMinor", "investingNetMinor", "financingNetMinor",
      "expectedInflowsNext30DaysMinor", "expectedOutflowsNext30DaysMinor",
      "expectedInflowsNext31To90DaysMinor",
      "expectedOutflowsNext31To90DaysMinor"] as const) integer(value.cashFlow[key]);
    if (value.cashFlow.receivables !== undefined) {
      if (!Array.isArray(value.cashFlow.receivables)) inputInvalid();
      for (const item of value.cashFlow.receivables) {
        exactObject(item, ["customer", "amountMinor", "daysOutstanding"]);
        identifier(item.customer);
        integer(item.amountMinor);
        integer(item.daysOutstanding);
      }
    }
  }
  if (value.costDetail !== undefined && value.costDetail !== null) {
    exactObject(value.costDetail, ["materialCostRateBps", "laborCostMinor",
      "rawMaterialCostMinor", "salesCommissionRateBps", "fixedOverheadMinor"],
    ["previousMaterialCostRateBps"]);
    for (const key of ["materialCostRateBps", "laborCostMinor",
      "rawMaterialCostMinor", "salesCommissionRateBps",
      "fixedOverheadMinor"] as const) integer(value.costDetail[key]);
    if (value.costDetail.previousMaterialCostRateBps !== undefined) {
      integer(value.costDetail.previousMaterialCostRateBps);
    }
  }
  if (value.taxRisk !== undefined && value.taxRisk !== null) {
    exactObject(value.taxRisk, ["invoiceIssues", "revenueRecognitionIssues",
      "costAuthenticityIssues", "payrollIssues", "equityIssues"]);
    stringArray(value.taxRisk.invoiceIssues);
    stringArray(value.taxRisk.revenueRecognitionIssues);
    stringArray(value.taxRisk.costAuthenticityIssues);
    stringArray(value.taxRisk.payrollIssues);
    stringArray(value.taxRisk.equityIssues);
  }
}

const RUN_KEYS = ["runId", "workspaceId", "creationKeyHash", "requestHash",
  "currency", "status", "revision", "dataAsOf", "businessReport",
  "policyVersionId", "snapshotId", "snapshotHash", "consensusReport",
  "portfolios", "latestPortfolioRevision", "approval", "createdAt",
  "updatedAt", "expiresAt"] as const;

export function assertFinancialCouncilRunValue(value: unknown):
asserts value is FinancialCouncilRun {
  financialCouncilCanonicalJson(value);
  exactObject(value, RUN_KEYS);
  identifier(value.runId);
  identifier(value.workspaceId);
  hash(value.creationKeyHash);
  hash(value.requestHash);
  if (value.currency !== "CNY" && value.currency !== "USD") inputInvalid();
  if (!FINANCIAL_COUNCIL_RUN_STATUSES.includes(
    value.status as FinancialCouncilRun["status"])) inputInvalid();
  integer(value.revision);
  if (value.revision < 1) inputInvalid();
  timestamp(value.dataAsOf);
  assertBusinessReport(value.businessReport);
  if (value.businessReport.currency !== value.currency) inputInvalid();
  identifier(value.policyVersionId);
  if (value.snapshotId !== null) identifier(value.snapshotId);
  if (value.snapshotHash !== null) hash(value.snapshotHash);
  if ((value.snapshotId === null) !== (value.snapshotHash === null)) inputInvalid();
  if (value.consensusReport !== null
    || !Array.isArray(value.portfolios) || value.portfolios.length !== 0
    || value.latestPortfolioRevision !== null || value.approval !== null) {
    inputInvalid();
  }
  timestamp(value.createdAt);
  timestamp(value.updatedAt);
  timestamp(value.expiresAt);
}

export function assertFinancialSnapshotRecordValue(value: unknown):
asserts value is FinancialSnapshotRecord {
  exactObject(value, ["snapshotId", "runId", "workspaceId", "snapshotHash",
    "snapshot", "createdAt"]);
  identifier(value.snapshotId);
  identifier(value.runId);
  identifier(value.workspaceId);
  hash(value.snapshotHash);
  timestamp(value.createdAt);
  financialCouncilCanonicalJson(value.snapshot);
  exactObject(value.snapshot, [
    ...Object.keys(value.snapshot as Record<string, unknown>)
  ]);
  const nestedHash = value.snapshot.snapshotHash;
  if (typeof nestedHash !== "string" || !HASH.test(nestedHash)) inputInvalid();
  const { snapshotHash: _snapshotHash, ...preimage } = value.snapshot;
  if (value.snapshot.snapshotId !== value.snapshotId
    || value.snapshot.runId !== value.runId
    || value.snapshot.workspaceId !== value.workspaceId
    || nestedHash !== value.snapshotHash
    || financialCouncilCanonicalHash(preimage) !== value.snapshotHash) {
    inputInvalid();
  }
}

export function assertFinancialCouncilCreateMutation(
  command: unknown,
  aggregate: unknown
): asserts aggregate is FinancialCouncilRun {
  assertCommand(command, "null");
  assertFinancialCouncilRunValue(aggregate);
  if (aggregate.workspaceId !== command.workspace.workspaceId
    || aggregate.requestHash !== command.requestHash
    || aggregate.status !== "created" || aggregate.revision !== 1
    || aggregate.snapshotId !== null || aggregate.snapshotHash !== null
    || aggregate.createdAt !== aggregate.updatedAt) inputInvalid();
}

export function assertFinancialCouncilStoreSnapshotMutation(
  command: unknown,
  input: unknown
): asserts input is StoreFrozenFinancialSnapshotInput {
  assertCommand(command, "required");
  exactObject(input, ["runId", "snapshot", "occurredAt"]);
  identifier(input.runId);
  timestamp(input.occurredAt);
  assertFinancialSnapshotRecordValue(input.snapshot);
}

export function assertFinancialCouncilTransitionMutation(
  command: unknown,
  input: unknown
): asserts input is TransitionFinancialCouncilRunInput {
  assertCommand(command, "required");
  exactObject(input, ["runId", "kind", "occurredAt", "reasonCode"]);
  identifier(input.runId);
  if (typeof input.kind !== "string" || !TRANSITION_KINDS.has(input.kind)) {
    inputInvalid();
  }
  timestamp(input.occurredAt);
  if (input.reasonCode !== null
    && (typeof input.reasonCode !== "string" || input.reasonCode.length < 1
      || input.reasonCode.length > 200)) inputInvalid();
}

export function validateFinancialCouncilCreateMutation(
  command: unknown,
  aggregate: unknown
): { readonly command: CommandContext; readonly aggregate: FinancialCouncilRun } {
  const stableCommand = immutableFinancialCouncilInput(command);
  const stableAggregate = immutableFinancialCouncilInput(aggregate);
  assertFinancialCouncilCreateMutation(stableCommand, stableAggregate);
  return {
    command: stableCommand as CommandContext,
    aggregate: stableAggregate
  };
}

export function validateFinancialCouncilStoreSnapshotMutation(
  command: unknown,
  input: unknown
): {
  readonly command: CommandContext;
  readonly input: StoreFrozenFinancialSnapshotInput;
} {
  const stableCommand = immutableFinancialCouncilInput(command);
  const stableInput = immutableFinancialCouncilInput(input);
  assertFinancialCouncilStoreSnapshotMutation(stableCommand, stableInput);
  return { command: stableCommand as CommandContext, input: stableInput };
}

export function validateFinancialCouncilTransitionMutation(
  command: unknown,
  input: unknown
): {
  readonly command: CommandContext;
  readonly input: TransitionFinancialCouncilRunInput;
} {
  const stableCommand = immutableFinancialCouncilInput(command);
  const stableInput = immutableFinancialCouncilInput(input);
  assertFinancialCouncilTransitionMutation(stableCommand, stableInput);
  return { command: stableCommand as CommandContext, input: stableInput };
}

export function validateFinancialCouncilCreateAndFreezeMutation(
  command: unknown,
  input: unknown
): {
  readonly command: CommandContext;
  readonly input: CreateAndFreezeFinancialCouncilRunInput;
} {
  const stableCommand = immutableFinancialCouncilInput(command);
  const stableInput = immutableFinancialCouncilInput(input);
  exactObject(stableInput, ["aggregate", "snapshot", "occurredAt"]);
  assertFinancialCouncilCreateMutation(stableCommand, stableInput.aggregate);
  assertFinancialSnapshotRecordValue(stableInput.snapshot);
  timestamp(stableInput.occurredAt);
  assertFinancialSnapshotRecord(stableInput.aggregate, stableInput.snapshot);
  if (stableInput.snapshot.createdAt !== stableInput.occurredAt) inputInvalid();
  return {
    command: stableCommand as CommandContext,
    input: stableInput as unknown as CreateAndFreezeFinancialCouncilRunInput
  };
}

export function validateListRunnableFinancialCouncilRunsInput(
  input: unknown
): ListRunnableFinancialCouncilRunsInput {
  const stable = immutableFinancialCouncilInput(input);
  exactObject(stable, ["after", "limit"]);
  if (stable.after !== null) {
    exactObject(stable.after, ["workspaceId", "runId"]);
    identifier(stable.after.workspaceId);
    identifier(stable.after.runId);
  }
  if (!Number.isSafeInteger(stable.limit)
    || Number(stable.limit) < 1 || Number(stable.limit) > 100) inputInvalid();
  return stable as unknown as ListRunnableFinancialCouncilRunsInput;
}

function key(workspaceId: string, id: string): string {
  return `${workspaceId}\u0000${id}`;
}

function exactRevision(command: CommandContext): number {
  return command.expectedRevision as number;
}

export function assertFinancialSnapshotRecord(
  aggregate: FinancialCouncilRun,
  record: FinancialSnapshotRecord
): void {
  const { snapshotHash: _snapshotHash, ...preimage } = record.snapshot;
  if (record.workspaceId !== aggregate.workspaceId
    || record.runId !== aggregate.runId
    || record.snapshot.snapshotId !== record.snapshotId
    || record.snapshot.runId !== record.runId
    || record.snapshot.workspaceId !== record.workspaceId
    || record.snapshot.snapshotHash !== record.snapshotHash
    || financialCouncilCanonicalHash(preimage) !== record.snapshotHash) {
    inputInvalid();
  }
}

export class InMemoryFinancialCouncilRepository
implements FinancialCouncilRepository {
  private state = {
    runs: new Map<string, FinancialCouncilRun>(),
    events: new Map<string, FinancialCouncilRunEvent[]>(),
    snapshots: new Map<string, FinancialSnapshotRecord>(),
    creationKeys: new Map<string, string>()
  };

  private get runs() { return this.state.runs; }
  private get events() { return this.state.events; }
  private get snapshots() { return this.state.snapshots; }
  private get creationKeys() { return this.state.creationKeys; }

  async createAndFreezeRun(
    command: CommandContext,
    input: CreateAndFreezeFinancialCouncilRunInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    ({ command, input } = validateFinancialCouncilCreateAndFreezeMutation(
      command, input
    ));
    const { aggregate, snapshot, occurredAt } = input;
    const creationKey = key(aggregate.workspaceId, aggregate.creationKeyHash);
    const existing = this.readFrozenRunByCreationKey(
      command.workspace, aggregate.creationKeyHash, aggregate.requestHash
    );
    if (existing) {
      return { value: existing, replayed: true };
    }
    const aggregateKey = key(aggregate.workspaceId, aggregate.runId);
    const snapshotKey = key(aggregate.workspaceId, snapshot.snapshotId);
    if (this.runs.has(aggregateKey)) {
      throw financialCouncilError("financial_council_run_conflict");
    }
    if (this.snapshots.has(snapshotKey)) {
      throw financialCouncilError("financial_council_snapshot_conflict");
    }
    const created = immutableFinancialCouncilValue(aggregate);
    const withSnapshot = immutableFinancialCouncilValue({
      ...created,
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash
    });
    const frozen = applyFinancialCouncilTransition(withSnapshot, {
      kind: "snapshot_frozen", occurredAt, actorId: command.actorId
    });
    const createdEvent = createFinancialCouncilRunEvent(created, {
      fromStatus: null, reasonCode: null,
      occurredAt: created.createdAt, actorId: command.actorId
    });
    const frozenEvent = createFinancialCouncilRunEvent(frozen, {
      fromStatus: "created", reasonCode: null,
      occurredAt, actorId: command.actorId
    });
    const nextState = {
      runs: new Map(this.runs),
      events: new Map(this.events),
      snapshots: new Map(this.snapshots),
      creationKeys: new Map(this.creationKeys)
    };
    nextState.runs.set(aggregateKey, frozen);
    nextState.events.set(aggregateKey, [createdEvent, frozenEvent]);
    nextState.snapshots.set(
      snapshotKey, immutableFinancialCouncilValue(snapshot)
    );
    nextState.creationKeys.set(creationKey, frozen.runId);
    this.state = nextState;
    return { value: frozen, replayed: false };
  }

  async findFrozenRunByCreationKey(
    context: ActiveWorkspaceContext,
    creationKeyHash: string,
    requestHash: string
  ): Promise<FinancialCouncilRun | null> {
    return this.readFrozenRunByCreationKey(
      context, creationKeyHash, requestHash
    );
  }

  private readFrozenRunByCreationKey(
    context: ActiveWorkspaceContext,
    creationKeyHash: string,
    requestHash: string
  ): FinancialCouncilRun | null {
    hash(creationKeyHash);
    hash(requestHash);
    const existingId = this.creationKeys.get(key(
      context.workspaceId, creationKeyHash
    ));
    if (!existingId) return null;
    const existing = this.runs.get(key(context.workspaceId, existingId));
    if (!existing) throw financialCouncilError("financial_council_integrity");
    if (existing.requestHash !== requestHash) {
      throw financialCouncilError("financial_council_idempotency_conflict");
    }
    if (existing.status !== "snapshot_frozen" || existing.revision !== 2
      || existing.snapshotId === null) {
      throw financialCouncilError("financial_council_integrity");
    }
    const snapshot = this.snapshots.get(key(
      context.workspaceId, existing.snapshotId
    ));
    const events = this.events.get(key(context.workspaceId, existing.runId));
    if (!snapshot || events?.length !== 2
      || events[0]?.revision !== 1 || events[0].fromStatus !== null
      || events[0].toStatus !== "created"
      || events[1]?.revision !== 2 || events[1].fromStatus !== "created"
      || events[1].toStatus !== "snapshot_frozen"
      || financialCouncilCanonicalJson(events[1].aggregateSnapshot)
        !== financialCouncilCanonicalJson(existing)) {
      throw financialCouncilError("financial_council_integrity");
    }
    assertFinancialSnapshotRecord(existing, snapshot);
    return existing;
  }

  async createRun(
    command: CommandContext,
    aggregate: FinancialCouncilRun
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    ({ command, aggregate } = validateFinancialCouncilCreateMutation(
      command, aggregate
    ));
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
    ({ command, input } = validateFinancialCouncilStoreSnapshotMutation(
      command, input
    ));
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
    if (current.snapshotId !== null) {
      throw financialCouncilError("financial_council_snapshot_conflict");
    }
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
    ({ command, input } = validateFinancialCouncilTransitionMutation(
      command, input
    ));
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

  async listRunnableRuns(
    input: ListRunnableFinancialCouncilRunsInput
  ): Promise<readonly FinancialCouncilRun[]> {
    input = validateListRunnableFinancialCouncilRunsInput(input);
    return Object.freeze([...this.runs.values()]
      .filter((run) => run.status === "snapshot_frozen"
        && (input.after === null
          || run.workspaceId > input.after.workspaceId
          || (run.workspaceId === input.after.workspaceId
            && run.runId > input.after.runId)))
      .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)
        || left.runId.localeCompare(right.runId))
      .slice(0, input.limit));
  }
}
