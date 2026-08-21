import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import { canonicalBusinessReportInput } from "./business-advisor/domain.js";
import {
  FINANCIAL_COUNCIL_RUN_STATUSES,
  applyFinancialCouncilTransition,
  createFinancialCouncilRunEvent,
  financialCouncilAggregateHash,
  financialCouncilCanonicalJson,
  financialCouncilCanonicalHash,
  financialCouncilError,
  financialCouncilTransitionIsAllowed,
  immutableFinancialCouncilInput,
  immutableFinancialCouncilValue,
  type FinancialCouncilRun,
  type FinancialCouncilRunEvent,
  type FinancialCouncilTransitionKind,
  type FinancialSnapshotRecord
} from "./financial-council-domain.js";
import {
  validateFinancialSnapshot,
  validateFinancialSnapshotForRun,
  type FinancialSnapshot
} from "./financial-council-snapshot.js";
import type { FinancialCouncilModelBinding } from
  "./financial-council-model-port.js";
import {
  assertFinancialCouncilSpecialistResultAuthorized,
  type AuthorizedFinancialCouncilSpecialistResult
} from "./financial-council-finding-validator.js";
import { MODEL_PROVIDER_IDS } from "./model-providers/types.js";
import type {
  FinancialCouncilAgentRole,
  FinancialCouncilCandidateAction,
  FinancialCouncilFinding
} from "./growth-contract-types.js";

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

export type FinancialCouncilSpecialistPhase = "analyze" | "rebut";

export interface VerifiedFinancialCouncilRunSnapshot {
  readonly run: FinancialCouncilRun;
  readonly snapshot: FinancialSnapshot;
}

export interface FinancialCouncilSpecialistResult {
  readonly resultId: `sha256:${string}`;
  readonly workspaceId: string;
  readonly runId: string;
  readonly snapshotId: string;
  readonly snapshotHash: `sha256:${string}`;
  readonly role: FinancialCouncilAgentRole;
  readonly phase: FinancialCouncilSpecialistPhase;
  readonly attempt: number;
  readonly outputHash: `sha256:${string}`;
  readonly modelBinding: FinancialCouncilModelBinding;
  readonly repaired: boolean;
  readonly providerRequestId: string | null;
  readonly findings: readonly FinancialCouncilFinding[];
  readonly actions: readonly FinancialCouncilCandidateAction[];
  readonly createdAt: string;
  readonly resultHash: `sha256:${string}`;
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
  getVerifiedRunSnapshot(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<VerifiedFinancialCouncilRunSnapshot | null>;
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
  storeSpecialistResult(
    context: ActiveWorkspaceContext,
    result: AuthorizedFinancialCouncilSpecialistResult
  ): Promise<FinancialCouncilCommandResult<
  AuthorizedFinancialCouncilSpecialistResult>>;
  getSpecialistResult(
    context: ActiveWorkspaceContext,
    runId: string,
    role: FinancialCouncilAgentRole,
    phase: FinancialCouncilSpecialistPhase
  ): Promise<FinancialCouncilSpecialistResult | null>;
  listSpecialistResults(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilSpecialistResult[]>;
}

interface StoredSpecialistFinding {
  readonly role: FinancialCouncilAgentRole;
  readonly phase: FinancialCouncilSpecialistPhase;
  readonly value: FinancialCouncilFinding;
}

interface StoredSpecialistAction {
  readonly role: FinancialCouncilAgentRole;
  readonly phase: FinancialCouncilSpecialistPhase;
  readonly value: FinancialCouncilCandidateAction;
}

const HASH = /^sha256:[0-9a-f]{64}$/u;
const TRANSITION_KINDS = new Set<string>(
  FINANCIAL_COUNCIL_RUN_STATUSES.filter((status) => status !== "created")
);
const SPECIALIST_ROLES = new Set<string>([
  "finance", "profit", "cost", "cashflow", "tax"
]);
const SPECIALIST_PHASES = new Set<string>(["analyze", "rebut"]);
const SPECIALIST_ACTION_KINDS = new Set<string>([
  "collect_receivable", "review_loss_product_pricing",
  "reduce_cost_anomaly", "prepare_cash_reserve_budget",
  "complete_financial_data", "schedule_tax_review"
]);
const SPECIALIST_ACTION_RULES = Object.freeze({
  collect_receivable: {
    role: "cashflow", explanation: "collect_receivable_hypothesis",
    formulaVersion: "eligible-overdue-receivable.v1", durationDays: 30,
    confidenceBps: 7_500, subject: "optional", impact: "cash"
  },
  review_loss_product_pricing: {
    role: "profit", explanation: "review_loss_product_pricing_hypothesis",
    formulaVersion: "loss-product-pricing-gap.v1", durationDays: 14,
    confidenceBps: 7_000, subject: "optional", impact: "profit"
  },
  reduce_cost_anomaly: {
    role: "cost", explanation: "reduce_cost_anomaly_hypothesis",
    formulaVersion: "verified-avoidable-cost.v1", durationDays: 30,
    confidenceBps: 6_500, subject: "null", impact: "profit"
  },
  prepare_cash_reserve_budget: {
    role: "cashflow", explanation: "prepare_cash_reserve_budget_hypothesis",
    formulaVersion: "cash-shortfall.v1", durationDays: 7,
    confidenceBps: 8_000, subject: "null", impact: "negative_cash"
  },
  complete_financial_data: {
    role: "finance", explanation: "complete_financial_data_hypothesis",
    formulaVersion: "financial-data-gaps.v1", durationDays: 14,
    confidenceBps: 9_000, subject: "null", impact: "risk"
  },
  schedule_tax_review: {
    role: "tax", explanation: "税务风险筛查动作；需专业人员复核",
    formulaVersion: "tax-risk.v1", durationDays: 14,
    confidenceBps: 6_000, subject: "null", impact: "risk"
  }
} as const);
const MODEL_PROVIDERS = new Set<string>(MODEL_PROVIDER_IDS);

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

function specialInvalid(): never {
  throw financialCouncilError("financial_council_specialist_result_invalid");
}

function specialExact(
  value: unknown,
  required: readonly string[]
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some((key) => typeof key !== "string")) {
    specialInvalid();
  }
  const keys = Reflect.ownKeys(value) as string[];
  if (keys.length !== required.length
    || required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !required.includes(key))) specialInvalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) specialInvalid();
  }
}

function specialId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value
    || value.length < 1 || value.length > 255) specialInvalid();
}

function specialHash(value: unknown): asserts value is `sha256:${string}` {
  if (typeof value !== "string" || !HASH.test(value)) specialInvalid();
}

function specialTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string") specialInvalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    specialInvalid();
  }
}

function specialInteger(
  value: unknown,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER
): asserts value is number {
  if (!Number.isSafeInteger(value)
    || Number(value) < minimum || Number(value) > maximum) specialInvalid();
}

function specialIds(value: unknown, minimum = 0): asserts value is string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 100) {
    specialInvalid();
  }
  for (const item of value) specialId(item);
  if (new Set(value).size !== value.length) specialInvalid();
}

function assertSpecialistEvidence(value: unknown): void {
  specialExact(value, ["source", "sourceId", "contentHash"]);
  if (!["crm", "quote", "financial_fact", "acquisition_cost", "roi",
    "business_report"].includes(String(value.source))) specialInvalid();
  specialId(value.sourceId);
  specialHash(value.contentHash);
}

function assertSpecialistGap(value: unknown): void {
  specialExact(value, ["code", "source", "sourceId", "description"]);
  if (!["unverified_cost", "unverified_financial_fact", "missing_cogs",
    "unmatched_payment", "missing_commercial_binding",
    "import_requires_review"].includes(String(value.code))
    || !["crm", "quote", "financial_fact", "acquisition_cost", "roi",
      "business_report"].includes(String(value.source))) specialInvalid();
  if (value.sourceId !== null) specialId(value.sourceId);
  specialId(value.description);
}

function assertSpecialistFinding(
  value: unknown,
  outer: Pick<FinancialCouncilSpecialistResult,
  "runId" | "snapshotId" | "role">
): asserts value is FinancialCouncilFinding {
  specialExact(value, ["findingId", "runId", "snapshotId", "agentRole",
    "conclusion", "evidenceRefs", "formulaRef", "confidenceBps", "severity",
    "assumptions", "missingData", "candidateActionIds"]);
  specialId(value.findingId);
  if (value.runId !== outer.runId || value.snapshotId !== outer.snapshotId
    || value.agentRole !== outer.role) specialInvalid();
  specialId(value.conclusion);
  if (value.conclusion !== (outer.role === "tax"
    ? "税务风险需专业人员复核" : "risk_hypothesis")) specialInvalid();
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1
    || value.evidenceRefs.length > 100) specialInvalid();
  for (const ref of value.evidenceRefs) assertSpecialistEvidence(ref);
  if (value.formulaRef !== null) {
    specialExact(value.formulaRef,
      ["formulaVersion", "inputHash", "resultHash"]);
    specialId(value.formulaRef.formulaVersion);
    specialHash(value.formulaRef.inputHash);
    specialHash(value.formulaRef.resultHash);
  }
  specialInteger(value.confidenceBps, 0, 10_000);
  if (!["info", "warning", "critical"].includes(String(value.severity))) {
    specialInvalid();
  }
  specialIds(value.assumptions);
  if (outer.role === "tax" && value.assumptions.length !== 0) specialInvalid();
  if (!Array.isArray(value.missingData) || value.missingData.length > 100) {
    specialInvalid();
  }
  for (const gap of value.missingData) assertSpecialistGap(gap);
  specialIds(value.candidateActionIds);
}

function assertScenario(
  value: unknown,
  bps: boolean
): void {
  specialExact(value, ["conservative", "base", "optimistic"]);
  for (const key of ["conservative", "base", "optimistic"] as const) {
    specialInteger(value[key], bps ? 0 : Number.MIN_SAFE_INTEGER,
      bps ? 10_000 : Number.MAX_SAFE_INTEGER);
  }
  if (Number(value.conservative) > Number(value.base)
    || Number(value.base) > Number(value.optimistic)) specialInvalid();
}

function assertSpecialistAction(
  value: unknown,
  outer: Pick<FinancialCouncilSpecialistResult, "role">,
  findingsById: ReadonlyMap<string, FinancialCouncilFinding>
): asserts value is FinancialCouncilCandidateAction {
  specialExact(value, ["actionId", "kind", "sourceFindingIds", "ownerRole",
    "subjectRef", "explanation", "durationDays", "prerequisites",
    "mutuallyExclusiveWith", "cashImpact", "profitImpact",
    "riskReductionBps", "budgetCostMinor", "capacityUnits", "confidenceBps",
    "requiredCapabilities", "requiresHumanApproval"]);
  specialHash(value.actionId);
  if (!SPECIALIST_ACTION_KINDS.has(String(value.kind))) specialInvalid();
  const rule = SPECIALIST_ACTION_RULES[
    value.kind as keyof typeof SPECIALIST_ACTION_RULES
  ];
  if (!rule || value.ownerRole !== outer.role || value.ownerRole !== rule.role) {
    specialInvalid();
  }
  specialIds(value.sourceFindingIds, 1);
  const sourceFindings = value.sourceFindingIds.map((id) => {
    const finding = findingsById.get(id);
    if (!finding?.formulaRef
      || finding.formulaRef.formulaVersion !== rule.formulaVersion) {
      return specialInvalid();
    }
    return finding;
  });
  if (value.subjectRef !== null) specialId(value.subjectRef);
  if (rule.subject === "null" && value.subjectRef !== null) specialInvalid();
  specialId(value.explanation);
  if (value.explanation !== rule.explanation) specialInvalid();
  specialInteger(value.durationDays, 0);
  if (value.durationDays !== rule.durationDays) specialInvalid();
  specialIds(value.prerequisites);
  specialIds(value.mutuallyExclusiveWith);
  const formulaPrerequisites = new Set(sourceFindings.map((finding) =>
    `formula:${finding.formulaRef!.formulaVersion}:`
      + `${finding.formulaRef!.inputHash}:${finding.formulaRef!.resultHash}`));
  if (formulaPrerequisites.size !== 1 || value.prerequisites.length !== 1
    || !formulaPrerequisites.has(value.prerequisites[0]!)
    || value.mutuallyExclusiveWith.length !== 0) specialInvalid();
  assertScenario(value.cashImpact, false);
  assertScenario(value.profitImpact, false);
  assertScenario(value.riskReductionBps, true);
  specialInteger(value.budgetCostMinor, 0);
  specialInteger(value.capacityUnits, 0);
  specialInteger(value.confidenceBps, 0, 10_000);
  specialIds(value.requiredCapabilities);
  if (value.budgetCostMinor !== 0 || value.capacityUnits !== 1
    || value.confidenceBps !== rule.confidenceBps
    || value.requiredCapabilities.length !== 0
    || value.requiresHumanApproval !== true) specialInvalid();
  const cash = Object.values(value.cashImpact as Record<string, number>);
  const profit = Object.values(value.profitImpact as Record<string, number>);
  const risk = Object.values(value.riskReductionBps as Record<string, number>);
  const zero = (values: readonly number[]) => values.every((item) => item === 0);
  if ((rule.impact === "cash"
      && (!zero(profit) || !zero(risk) || cash.some((item) => item < 0)))
    || (rule.impact === "profit"
      && (!zero(cash) || !zero(risk) || profit.some((item) => item < 0)))
    || (rule.impact === "negative_cash"
      && (!zero(profit) || !zero(risk) || cash.some((item) => item > 0)))
    || (rule.impact === "risk" && (!zero(cash) || !zero(profit)))) {
    specialInvalid();
  }
}

function assertModelBinding(
  value: unknown,
  outer: Pick<FinancialCouncilSpecialistResult,
  "runId" | "snapshotId" | "snapshotHash" | "role" | "phase" | "attempt">
): asserts value is FinancialCouncilModelBinding {
  specialExact(value, ["jobId", "runId", "snapshotId", "snapshotHash",
    "role", "phase", "attempt", "connectionId", "credentialVersion",
    "provider", "model", "capabilitySnapshotHash", "baseUrlFingerprint",
    "promptVersion", "schemaVersion", "contentHash", "promptHash",
    "schemaHash"]);
  for (const key of ["jobId", "connectionId", "model", "baseUrlFingerprint",
    "promptVersion", "schemaVersion"] as const) specialId(value[key]);
  for (const key of ["snapshotHash", "capabilitySnapshotHash", "contentHash",
    "promptHash", "schemaHash"] as const) specialHash(value[key]);
  specialInteger(value.credentialVersion, 1);
  if (!MODEL_PROVIDERS.has(String(value.provider))
    || value.runId !== outer.runId || value.snapshotId !== outer.snapshotId
    || value.snapshotHash !== outer.snapshotHash || value.role !== outer.role
    || value.phase !== outer.phase || value.attempt !== outer.attempt
    || value.jobId !== `financial-council:${outer.runId}:${outer.role}:`
      + `${outer.phase}:${outer.attempt}`) specialInvalid();
}

export function validateFinancialCouncilSpecialistResult(
  raw: unknown
): FinancialCouncilSpecialistResult {
  try {
    const stable = immutableFinancialCouncilInput(raw) as unknown;
    specialExact(stable, ["resultId", "workspaceId", "runId", "snapshotId",
      "snapshotHash", "role", "phase", "attempt", "outputHash",
      "modelBinding", "repaired", "providerRequestId", "findings", "actions",
      "createdAt", "resultHash"]);
    specialHash(stable.resultId);
    specialId(stable.workspaceId);
    specialId(stable.runId);
    specialId(stable.snapshotId);
    specialHash(stable.snapshotHash);
    if (!SPECIALIST_ROLES.has(String(stable.role))
      || !SPECIALIST_PHASES.has(String(stable.phase))) specialInvalid();
    specialInteger(stable.attempt, 1, 100);
    specialHash(stable.outputHash);
    specialTimestamp(stable.createdAt);
    if (typeof stable.repaired !== "boolean") specialInvalid();
    if (stable.providerRequestId !== null) specialId(stable.providerRequestId);
    const result = stable as unknown as FinancialCouncilSpecialistResult;
    assertModelBinding(result.modelBinding, result);
    if (!Array.isArray(result.findings) || result.findings.length < 1
      || result.findings.length > 24) specialInvalid();
    const findingsById = new Map<string, FinancialCouncilFinding>();
    for (const finding of result.findings) {
      assertSpecialistFinding(finding, result);
      if (findingsById.has(finding.findingId)) specialInvalid();
      findingsById.set(finding.findingId, finding);
    }
    if (!Array.isArray(result.actions) || result.actions.length > 24) {
      specialInvalid();
    }
    const actionIds = new Set<string>();
    for (const action of result.actions) {
      assertSpecialistAction(action, result, findingsById);
      if (actionIds.has(action.actionId)) specialInvalid();
      actionIds.add(action.actionId);
    }
    for (const finding of result.findings) {
      if (finding.candidateActionIds.some((id: string) => !actionIds.has(id))) {
        specialInvalid();
      }
      const expected = result.actions.filter((action) =>
        action.sourceFindingIds.includes(finding.findingId))
        .map((action) => action.actionId).sort();
      if (financialCouncilCanonicalJson(expected)
        !== financialCouncilCanonicalJson(finding.candidateActionIds)) {
        specialInvalid();
      }
    }
    const { resultHash, ...preimage } = result;
    specialHash(resultHash);
    if (financialCouncilCanonicalHash(preimage) !== resultHash) specialInvalid();
    return immutableFinancialCouncilValue(result);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code
      === "financial_council_specialist_result_invalid") throw error;
    return specialInvalid();
  }
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

function assertCanonicalBusinessReport(value: unknown):
asserts value is FinancialCouncilRun["businessReport"] {
  try {
    const canonical = canonicalBusinessReportInput(
      value as FinancialCouncilRun["businessReport"]
    );
    if (financialCouncilCanonicalJson(canonical)
      !== financialCouncilCanonicalJson(value)) inputInvalid();
  } catch {
    inputInvalid();
  }
}

function policyVersionId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === ""
    || [...value].length > 255) inputInvalid();
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
  assertCanonicalBusinessReport(value.businessReport);
  if (value.businessReport.currency !== value.currency) inputInvalid();
  policyVersionId(value.policyVersionId);
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
  const snapshot = validateFinancialSnapshot(value.snapshot);
  const nestedHash = snapshot.snapshotHash;
  const { snapshotHash: _snapshotHash, ...preimage } = snapshot;
  if (snapshot.snapshotId !== value.snapshotId
    || snapshot.runId !== value.runId
    || snapshot.workspaceId !== value.workspaceId
    || nestedHash !== value.snapshotHash
    || financialCouncilCanonicalHash(preimage) !== value.snapshotHash) {
    inputInvalid();
  }
}

function historyIntegrity(): never {
  throw financialCouncilError("financial_council_integrity");
}

function assertFinancialCouncilRunEventValue(
  value: unknown
): asserts value is FinancialCouncilRunEvent {
  exactObject(value, ["eventId", "runId", "workspaceId", "revision",
    "fromStatus", "toStatus", "reasonCode", "occurredAt", "actorId",
    "aggregateSnapshotHash", "aggregateSnapshot"]);
  identifier(value.eventId);
  identifier(value.runId);
  identifier(value.workspaceId);
  integer(value.revision);
  if (value.fromStatus !== null
    && !FINANCIAL_COUNCIL_RUN_STATUSES.includes(
      value.fromStatus as FinancialCouncilRun["status"]
    )) inputInvalid();
  if (!FINANCIAL_COUNCIL_RUN_STATUSES.includes(
    value.toStatus as FinancialCouncilRun["status"]
  )) inputInvalid();
  if (value.reasonCode !== null
    && (typeof value.reasonCode !== "string" || value.reasonCode.length < 1
      || value.reasonCode.length > 200)) inputInvalid();
  timestamp(value.occurredAt);
  identifier(value.actorId);
  hash(value.aggregateSnapshotHash);
  assertFinancialCouncilRunValue(value.aggregateSnapshot);
}

export function assertFinancialCouncilRunHistory(
  run: FinancialCouncilRun,
  events: readonly FinancialCouncilRunEvent[],
  fail: () => never = historyIntegrity
): void {
  try {
    assertFinancialCouncilRunValue(run);
    for (const event of events) assertFinancialCouncilRunEventValue(event);
  } catch {
    fail();
  }
  if (events.length === 0) fail();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const previous = events[index - 1];
    if (event.eventId !== `${run.runId}:${index + 1}`
      || event.runId !== run.runId || event.workspaceId !== run.workspaceId
      || event.revision !== index + 1
      || event.aggregateSnapshot.runId !== run.runId
      || event.aggregateSnapshot.workspaceId !== run.workspaceId
      || event.aggregateSnapshot.revision !== event.revision
      || event.aggregateSnapshot.status !== event.toStatus
      || event.aggregateSnapshot.updatedAt !== event.occurredAt
      || event.aggregateSnapshotHash
        !== financialCouncilAggregateHash(event.aggregateSnapshot)
      || (index === 0 && (event.toStatus !== "created"
        || event.fromStatus !== null
        || event.aggregateSnapshot.createdAt !== event.occurredAt))
      || (previous && (event.fromStatus !== previous.toStatus
        || event.toStatus === "created"
        || !financialCouncilTransitionIsAllowed(
          previous.toStatus,
          event.toStatus as FinancialCouncilTransitionKind
        )))) fail();
    if (previous) {
      const transitionBase = event.toStatus === "snapshot_frozen"
        ? immutableFinancialCouncilValue({
            ...previous.aggregateSnapshot,
            snapshotId: event.aggregateSnapshot.snapshotId,
            snapshotHash: event.aggregateSnapshot.snapshotHash
          })
        : previous.aggregateSnapshot;
      const expected = applyFinancialCouncilTransition(transitionBase, {
        kind: event.toStatus as FinancialCouncilTransitionKind,
        occurredAt: event.occurredAt,
        actorId: event.actorId
      });
      if (financialCouncilCanonicalJson(expected)
          !== financialCouncilCanonicalJson(event.aggregateSnapshot)
        || (event.toStatus === "snapshot_frozen"
          && event.actorId !== previous.actorId)) fail();
    }
  }
  const latest = events.at(-1)!;
  if (financialCouncilCanonicalJson(latest.aggregateSnapshot)
      !== financialCouncilCanonicalJson(run)
    || latest.aggregateSnapshotHash !== financialCouncilAggregateHash(run)
    || latest.revision !== run.revision || latest.toStatus !== run.status) {
    fail();
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
  validateFinancialSnapshotForRun(record.snapshot, aggregate);
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

export function assertFinancialSnapshotFreezeTime(
  record: FinancialSnapshotRecord,
  events: readonly FinancialCouncilRunEvent[],
  fail: () => never = historyIntegrity
): void {
  const frozenEvents = events.filter((event) =>
    event.toStatus === "snapshot_frozen");
  if (frozenEvents.length !== 1
    || frozenEvents[0]!.occurredAt !== record.createdAt) fail();
}

export class InMemoryFinancialCouncilRepository
implements FinancialCouncilRepository {
  private state = {
    runs: new Map<string, FinancialCouncilRun>(),
    events: new Map<string, FinancialCouncilRunEvent[]>(),
    snapshots: new Map<string, FinancialSnapshotRecord>(),
    creationKeys: new Map<string, string>(),
    specialistResults: new Map<string, FinancialCouncilSpecialistResult>(),
    specialistFindings: new Map<string, StoredSpecialistFinding>(),
    specialistActions: new Map<string, StoredSpecialistAction>()
  };

  private get runs() { return this.state.runs; }
  private get events() { return this.state.events; }
  private get snapshots() { return this.state.snapshots; }
  private get creationKeys() { return this.state.creationKeys; }
  private get specialistResults() { return this.state.specialistResults; }
  private get specialistFindings() { return this.state.specialistFindings; }
  private get specialistActions() { return this.state.specialistActions; }

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
      creationKeys: new Map(this.creationKeys),
      specialistResults: new Map(this.specialistResults),
      specialistFindings: new Map(this.specialistFindings),
      specialistActions: new Map(this.specialistActions)
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
    if (existing.status === "created" || existing.revision < 2
      || existing.snapshotId === null || existing.snapshotHash === null) {
      historyIntegrity();
    }
    this.assertStoredRun(existing);
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
      if (!existing) {
        throw financialCouncilError("financial_council_integrity");
      }
      this.assertStoredRun(existing);
      if (existing.requestHash !== aggregate.requestHash) {
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
    const run = this.runs.get(key(context.workspaceId, runId)) ?? null;
    if (run) this.assertStoredRun(run);
    return run;
  }

  async getVerifiedRunSnapshot(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<VerifiedFinancialCouncilRunSnapshot | null> {
    const run = this.runs.get(key(context.workspaceId, runId)) ?? null;
    if (!run) return null;
    this.assertStoredRun(run);
    if (run.snapshotId === null) historyIntegrity();
    const record = this.snapshots.get(key(run.workspaceId, run.snapshotId));
    if (!record) historyIntegrity();
    return immutableFinancialCouncilValue({
      run,
      snapshot: validateFinancialSnapshotForRun(record.snapshot, run)
    });
  }

  async listEvents(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilRunEvent[]> {
    const run = this.runs.get(key(context.workspaceId, runId));
    const events = this.events.get(key(context.workspaceId, runId)) ?? [];
    if (!run) {
      if (events.length) historyIntegrity();
      return Object.freeze([]);
    }
    this.assertStoredRun(run);
    return Object.freeze([...events]);
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
    const runs = [...this.runs.values()];
    for (const run of runs) this.assertStoredRun(run);
    return Object.freeze(runs
      .filter((run) => run.status === "snapshot_frozen"
        && (input.after === null
          || utf8ByteCompare(run.workspaceId, input.after.workspaceId) > 0
          || (run.workspaceId === input.after.workspaceId
            && utf8ByteCompare(run.runId, input.after.runId) > 0)))
      .sort((left, right) => utf8ByteCompare(
        left.workspaceId, right.workspaceId
      ) || utf8ByteCompare(left.runId, right.runId))
      .slice(0, input.limit));
  }

  async storeSpecialistResult(
    context: ActiveWorkspaceContext,
    rawResult: AuthorizedFinancialCouncilSpecialistResult
  ): Promise<FinancialCouncilCommandResult<
  AuthorizedFinancialCouncilSpecialistResult>> {
    assertFinancialCouncilSpecialistResultAuthorized(rawResult);
    const result = validateFinancialCouncilSpecialistResult(rawResult);
    if (result.workspaceId !== context.workspaceId) specialInvalid();
    const verified = await this.getVerifiedRunSnapshot(context, result.runId);
    if (!verified) {
      throw financialCouncilError("financial_council_run_not_found");
    }
    if (verified.snapshot.snapshotId !== result.snapshotId
      || verified.snapshot.snapshotHash !== result.snapshotHash
      || Date.parse(result.createdAt) < Date.parse(verified.run.updatedAt)
      || Date.parse(result.createdAt) > Date.parse(verified.run.expiresAt)
      || Date.parse(result.createdAt) > Date.now() + 1_000) {
      specialInvalid();
    }
    const resultKey = specialistKey(result.workspaceId, result.runId,
      result.role, result.phase);
    const existing = this.specialistResults.get(resultKey);
    if (existing) {
      const parsed = this.assertStoredSpecialistResult(existing);
      if (financialCouncilCanonicalJson(parsed)
        !== financialCouncilCanonicalJson(result)) {
        throw financialCouncilError("financial_council_specialist_conflict");
      }
      return { value: rawResult, replayed: true };
    }
    if ([...this.specialistResults.values()].some((candidate) =>
      candidate.workspaceId === result.workspaceId
      && candidate.resultId === result.resultId)) {
      throw financialCouncilError("financial_council_specialist_conflict");
    }
    const nextState = {
      runs: new Map(this.runs),
      events: new Map(this.events),
      snapshots: new Map(this.snapshots),
      creationKeys: new Map(this.creationKeys),
      specialistResults: new Map(this.specialistResults),
      specialistFindings: new Map(this.specialistFindings),
      specialistActions: new Map(this.specialistActions)
    };
    for (const finding of result.findings) {
      const findingKey = key(result.workspaceId,
        `${result.runId}\u0000${result.role}\u0000${result.phase}`
          + `\u0000${finding.findingId}`);
      if (nextState.specialistFindings.has(findingKey)) {
        throw financialCouncilError("financial_council_specialist_conflict");
      }
      nextState.specialistFindings.set(findingKey, Object.freeze({
        role: result.role, phase: result.phase, value: finding
      }));
    }
    for (const action of result.actions) {
      const actionKey = key(result.workspaceId,
        `${result.runId}\u0000${result.role}\u0000${result.phase}`
          + `\u0000${action.actionId}`);
      if (nextState.specialistActions.has(actionKey)) {
        throw financialCouncilError("financial_council_specialist_conflict");
      }
      nextState.specialistActions.set(actionKey, Object.freeze({
        role: result.role, phase: result.phase, value: action
      }));
    }
    nextState.specialistResults.set(resultKey, result);
    this.state = nextState;
    return { value: rawResult, replayed: false };
  }

  async getSpecialistResult(
    context: ActiveWorkspaceContext,
    runId: string,
    rawRole: FinancialCouncilAgentRole,
    rawPhase: FinancialCouncilSpecialistPhase
  ): Promise<FinancialCouncilSpecialistResult | null> {
    if (!SPECIALIST_ROLES.has(rawRole) || !SPECIALIST_PHASES.has(rawPhase)) {
      specialInvalid();
    }
    const result = this.specialistResults.get(specialistKey(
      context.workspaceId, runId, rawRole, rawPhase
    )) ?? null;
    if (!result) return null;
    const parsed = this.assertStoredSpecialistResult(result);
    if (parsed.workspaceId !== context.workspaceId || parsed.runId !== runId
      || parsed.role !== rawRole || parsed.phase !== rawPhase) {
      historyIntegrity();
    }
    const verified = await this.getVerifiedRunSnapshot(context, runId);
    if (!verified || parsed.snapshotId !== verified.snapshot.snapshotId
      || parsed.snapshotHash !== verified.snapshot.snapshotHash) {
      historyIntegrity();
    }
    return parsed;
  }

  async listSpecialistResults(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilSpecialistResult[]> {
    const verified = await this.getVerifiedRunSnapshot(context, runId);
    const prefix = `${context.workspaceId}\u0000${runId}\u0000`;
    if (!verified) {
      if ([...this.specialistResults].some(([storedKey, result]) =>
        storedKey.startsWith(prefix)
        || (result.workspaceId === context.workspaceId
          && result.runId === runId))) {
        historyIntegrity();
      }
      return Object.freeze([]);
    }
    const results = [...this.specialistResults]
      .filter(([storedKey, result]) => storedKey.startsWith(prefix)
        || (result.workspaceId === context.workspaceId
          && result.runId === runId))
      .map(([storedKey, result]) => {
        const parsed = this.assertStoredSpecialistResult(result);
        if (storedKey !== specialistKey(parsed.workspaceId, parsed.runId,
          parsed.role, parsed.phase)) historyIntegrity();
        return parsed;
      })
      .sort((left, right) => compareSpecialist(left, right));
    for (const result of results) {
      if (result.snapshotId !== verified.snapshot.snapshotId
        || result.snapshotHash !== verified.snapshot.snapshotHash) {
        historyIntegrity();
      }
    }
    return Object.freeze(results);
  }

  private assertStoredSpecialistResult(
    raw: FinancialCouncilSpecialistResult
  ): FinancialCouncilSpecialistResult {
    try {
      const result = validateFinancialCouncilSpecialistResult(raw);
      const prefix = `${result.workspaceId}\u0000${result.runId}\u0000`
        + `${result.role}\u0000${result.phase}\u0000`;
      const storedFindings = [...this.specialistFindings]
        .filter(([storedKey]) => storedKey.startsWith(prefix))
        .map(([, stored]) => stored.value);
      const storedActions = [...this.specialistActions]
        .filter(([storedKey]) => storedKey.startsWith(prefix))
        .map(([, stored]) => stored.value);
      if (financialCouncilCanonicalJson(storedFindings.sort((left, right) =>
          utf8ByteCompare(left.findingId, right.findingId)))
          !== financialCouncilCanonicalJson([...result.findings]
            .sort((left, right) => utf8ByteCompare(
              left.findingId, right.findingId
            )))
        || financialCouncilCanonicalJson(storedActions.sort((left, right) =>
          utf8ByteCompare(left.actionId, right.actionId)))
          !== financialCouncilCanonicalJson([...result.actions]
            .sort((left, right) => utf8ByteCompare(
              left.actionId, right.actionId
            )))) historyIntegrity();
      return result;
    } catch {
      historyIntegrity();
    }
  }

  private assertStoredRun(run: FinancialCouncilRun): void {
    const aggregateKey = key(run.workspaceId, run.runId);
    const events = this.events.get(aggregateKey) ?? [];
    assertFinancialCouncilRunHistory(run, events);
    if (run.snapshotId !== null) {
      const snapshot = this.snapshots.get(key(run.workspaceId, run.snapshotId));
      if (!snapshot) historyIntegrity();
      try {
        assertFinancialSnapshotRecordValue(snapshot);
        assertFinancialSnapshotRecord(run, snapshot);
        assertFinancialSnapshotFreezeTime(snapshot, events);
      } catch {
        historyIntegrity();
      }
    } else if (run.status !== "created") {
      historyIntegrity();
    }
  }
}

function specialistKey(
  workspaceId: string,
  runId: string,
  role: FinancialCouncilAgentRole,
  phase: FinancialCouncilSpecialistPhase
): string {
  return `${workspaceId}\u0000${runId}\u0000${role}\u0000${phase}`;
}

function compareSpecialist(
  left: FinancialCouncilSpecialistResult,
  right: FinancialCouncilSpecialistResult
): number {
  const roleOrder = ["finance", "profit", "cost", "cashflow", "tax"];
  return roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role)
    || left.phase.localeCompare(right.phase);
}

function utf8ByteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
