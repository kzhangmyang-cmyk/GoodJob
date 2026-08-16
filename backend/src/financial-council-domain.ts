import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "./canonical-json.js";
import type {
  BusinessCurrency,
  BusinessReportInput
} from "./business-advisor/domain.js";
import type {
  ConsensusReport,
  FinancialCouncilActionPortfolio,
  FinancialCouncilApproval,
  FinancialCouncilRunStatus
} from "./growth-contract-types.js";

export const FINANCIAL_COUNCIL_RUN_STATUSES = Object.freeze([
  "created",
  "snapshot_frozen",
  "analyzing",
  "auditing",
  "synthesizing",
  "optimizing",
  "awaiting_approval",
  "approved",
  "rejected",
  "expired",
  "failed",
  "not_computable"
] as const satisfies readonly FinancialCouncilRunStatus[]);

export type FinancialCouncilTransitionKind = Exclude<
  FinancialCouncilRunStatus,
  "created"
>;

export interface FinancialCouncilRun {
  readonly runId: string;
  readonly workspaceId: string;
  readonly creationKeyHash: `sha256:${string}`;
  readonly requestHash: `sha256:${string}`;
  readonly currency: BusinessCurrency;
  readonly status: FinancialCouncilRunStatus;
  readonly revision: number;
  readonly dataAsOf: string;
  readonly businessReport: BusinessReportInput;
  readonly policyVersionId: string;
  readonly snapshotId: string | null;
  readonly snapshotHash: `sha256:${string}` | null;
  readonly consensusReport: ConsensusReport | null;
  readonly portfolios: readonly FinancialCouncilActionPortfolio[];
  readonly latestPortfolioRevision: number | null;
  readonly approval: FinancialCouncilApproval | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface FinancialCouncilTransitionInput {
  readonly kind: FinancialCouncilTransitionKind;
  readonly occurredAt: string;
  readonly actorId: string;
}

export interface FinancialCouncilRunEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly fromStatus: FinancialCouncilRunStatus | null;
  readonly toStatus: FinancialCouncilRunStatus;
  readonly reasonCode: string | null;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly aggregateSnapshotHash: `sha256:${string}`;
  readonly aggregateSnapshot: FinancialCouncilRun;
}

export interface FinancialSnapshotRecord {
  readonly snapshotId: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly snapshotHash: `sha256:${string}`;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

const PROGRESSIVE_TRANSITIONS: Readonly<
  Partial<Record<FinancialCouncilRunStatus, FinancialCouncilRunStatus>>
> = Object.freeze({
  created: "snapshot_frozen",
  snapshot_frozen: "analyzing",
  analyzing: "auditing",
  auditing: "synthesizing",
  synthesizing: "optimizing",
  optimizing: "awaiting_approval"
});

const TERMINAL_STATUSES = new Set<FinancialCouncilRunStatus>([
  "approved", "rejected", "expired", "failed", "not_computable"
]);

export function financialCouncilError(
  code: string
): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function immutableFinancialCouncilValue<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function financialCouncilCanonicalHash(
  value: unknown
): `sha256:${string}` {
  const encoded = canonicalJsonStringify(value);
  if (typeof encoded !== "string") {
    throw financialCouncilError("financial_council_invalid_json");
  }
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

export function financialCouncilAggregateHash(
  aggregate: FinancialCouncilRun
): `sha256:${string}` {
  return financialCouncilCanonicalHash(aggregate);
}

export function applyFinancialCouncilTransition(
  current: FinancialCouncilRun,
  input: FinancialCouncilTransitionInput
): FinancialCouncilRun {
  if (TERMINAL_STATUSES.has(current.status)) {
    throw financialCouncilError("financial_council_transition_invalid");
  }
  const progressive = PROGRESSIVE_TRANSITIONS[current.status];
  const allowed = input.kind === progressive
    || (current.status === "awaiting_approval"
      && ["approved", "rejected", "expired"].includes(input.kind))
    || input.kind === "failed"
    || input.kind === "not_computable";
  if (!allowed) {
    throw financialCouncilError("financial_council_transition_invalid");
  }
  return immutableFinancialCouncilValue({
    ...current,
    status: input.kind,
    revision: current.revision + 1,
    updatedAt: input.occurredAt
  });
}

export function createFinancialCouncilRunEvent(
  aggregate: FinancialCouncilRun,
  input: {
    readonly fromStatus: FinancialCouncilRunStatus | null;
    readonly reasonCode: string | null;
    readonly occurredAt: string;
    readonly actorId: string;
  }
): FinancialCouncilRunEvent {
  return immutableFinancialCouncilValue({
    eventId: `${aggregate.runId}:${aggregate.revision}`,
    runId: aggregate.runId,
    workspaceId: aggregate.workspaceId,
    revision: aggregate.revision,
    fromStatus: input.fromStatus,
    toStatus: aggregate.status,
    reasonCode: input.reasonCode,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    aggregateSnapshotHash: financialCouncilAggregateHash(aggregate),
    aggregateSnapshot: aggregate
  });
}
