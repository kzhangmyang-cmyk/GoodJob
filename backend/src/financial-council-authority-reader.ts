import type {
  AdvisorRoiSliceView,
  FinancialDataGapView,
  GrowthAdvisorSealedQueryService,
  PendingQuoteApprovalView,
  PriorityCustomerView
} from "./growth-advisor-query.js";
import {
  financialCouncilCanonicalHash,
  immutableFinancialCouncilValue
} from "./financial-council-domain.js";
import type { FinancialFactType } from "./financial-ledger-domain.js";
import {
  assertGrowthSealedReadCutoff,
  type GrowthSealedReadCutoff
} from "./growth-temporal-barrier.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";

const MAX_UNTRUSTED_TEXT = 1_000;
const MAX_ROWS = 100;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const FACT_TYPES = new Set<string>([
  "contract_won", "payment_received", "revenue_recognized",
  "cogs_recognized", "refund", "bad_debt_written_off"
]);
const GAP_CODES = new Set<string>([
  "unverified_cost", "unverified_financial_fact", "missing_cogs",
  "unmatched_payment", "missing_commercial_binding", "import_requires_review"
]);
const GAP_SOURCES = new Set<string>([
  "cost_entry", "financial_fact", "finance_import", "commercial_binding"
]);
const EXPECTED_ROI_REASONS = new Set<unknown>([
  "cost_missing", "attribution_incomplete", "zero_estimated_cost"
]);
const ACTUAL_ROI_REASONS = new Set<unknown>([
  "cost_missing", "cost_not_closed", "gross_profit_unverified",
  "cash_reconciliation_incomplete", "attribution_incomplete",
  "multi_currency_without_fx", "zero_estimated_cost", "zero_cost",
  "query_truncated", "cohort_not_closed"
]);

export interface FinancialCouncilVerifiedFactSource {
  readonly workspaceId: string;
  readonly entryId: string;
  readonly sourceVersion: number;
  readonly factType: FinancialFactType;
  readonly amountMinor: number;
  readonly netAmountMinor: number;
  readonly currency: string;
  readonly businessOccurredAt: string;
  readonly entryRecordedAt: string;
  readonly verificationRevision: number;
  readonly verificationRecordedAt: string;
  readonly snapshotHash: `sha256:${string}`;
}

export interface FinancialCouncilVerifiedFactsReader {
  listVisibleAt(
    context: ActiveWorkspaceContext,
    input: {
      readonly currency: string;
      readonly cutoff: GrowthSealedReadCutoff;
      readonly limit: number;
    }
  ): Promise<readonly FinancialCouncilVerifiedFactSource[]>;
}

interface VerifiedFactCommon {
  readonly entryId: string;
  readonly sourceVersion: number;
  readonly factType: FinancialFactType;
  readonly currency: string;
  readonly businessOccurredAt: string;
  readonly entryRecordedAt: string;
  readonly verificationRevision: number;
  readonly verificationRecordedAt: string;
  readonly snapshotHash: `sha256:${string}`;
}

export type FinancialCouncilVerifiedFactView = VerifiedFactCommon & (
  | {
      readonly amountVisibility: "full";
      readonly amountMinor: number;
      readonly netAmountMinor: number;
    }
  | { readonly amountVisibility: "redacted" }
);

export interface FinancialCouncilAuthoritySnapshot {
  readonly workspaceId: string;
  readonly currency: string;
  readonly dataAsOf: string;
  readonly projectionLevel: "full" | "redacted";
  readonly priorityCustomers: readonly PriorityCustomerView[];
  readonly pendingQuoteApprovals: readonly PendingQuoteApprovalView[];
  readonly verifiedFinancialFacts: readonly FinancialCouncilVerifiedFactView[];
  readonly expectedRoi: readonly AdvisorRoiSliceView[];
  readonly actualRoi: readonly AdvisorRoiSliceView[];
  readonly dataGaps: readonly FinancialDataGapView[];
  readonly sourceSnapshotHash: `sha256:${string}`;
}

export interface FinancialCouncilAuthorityReaderDependencies {
  readonly advisor: Pick<GrowthAdvisorSealedQueryService, "getTodayAt">;
  readonly verifiedFacts: FinancialCouncilVerifiedFactsReader;
}

function authorityError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function text(value: unknown, code: string, max = 191): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    return authorityError(code);
  }
  return value;
}

function untrustedText(value: unknown): string {
  if (typeof value !== "string") return authorityError("financial_council_authority_invalid");
  return value.slice(0, MAX_UNTRUSTED_TEXT);
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    return authorityError("financial_council_authority_invalid");
  }
  return value as number;
}

function bps(value: unknown): number {
  const result = safeInteger(value);
  if (result < 0 || result > 10_000) {
    return authorityError("financial_council_authority_invalid");
  }
  return result;
}

function hash(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !HASH.test(value)) {
    return authorityError("financial_council_authority_invalid");
  }
  return value as `sha256:${string}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectPriority(row: PriorityCustomerView): PriorityCustomerView {
  return Object.freeze({
    candidateId: text(row.candidateId, "financial_council_authority_invalid"),
    customerId: row.customerId === null ? null
      : text(row.customerId, "financial_council_authority_invalid"),
    dealId: row.dealId === null ? null
      : text(row.dealId, "financial_council_authority_invalid"),
    displayName: untrustedText(row.displayName),
    priorityScoreBps: bps(row.priorityScoreBps),
    qualificationDecisionId: text(
      row.qualificationDecisionId, "financial_council_authority_invalid"
    ),
    qualificationDecisionVersion: text(
      row.qualificationDecisionVersion, "financial_council_authority_invalid"
    ),
    inputSnapshotHash: hash(row.inputSnapshotHash)
  });
}

function projectApproval(
  row: PendingQuoteApprovalView,
  sensitive: boolean
): PendingQuoteApprovalView {
  if (row.approvalKind !== "confirmation" && row.approvalKind !== "exception") {
    return authorityError("financial_council_authority_invalid");
  }
  const common = {
    approvalId: text(row.approvalId, "financial_council_authority_invalid"),
    quoteVersionId: text(row.quoteVersionId, "financial_council_authority_invalid"),
    quoteVersionRevision: safeInteger(row.quoteVersionRevision),
    quoteCaseId: text(row.quoteCaseId, "financial_council_authority_invalid"),
    approvalKind: row.approvalKind,
    requiredCapabilities: Object.freeze(row.requiredCapabilities
      .map((capability) => text(capability, "financial_council_authority_invalid"))
      .sort(compare)),
    submittedAt: text(row.submittedAt, "financial_council_authority_invalid", 35),
    expiresAt: row.expiresAt === null ? null
      : text(row.expiresAt, "financial_council_authority_invalid", 35)
  } as const;
  if (!sensitive) return Object.freeze(common);
  if (row.currency === undefined || row.quotedAmountMinor === undefined
    || row.estimatedGrossProfitMinor === undefined
    || row.estimatedContributionMinor === undefined
    || row.grossMarginBps === undefined) {
    return authorityError("financial_council_authority_invalid");
  }
  return Object.freeze({
    ...common,
    currency: text(row.currency, "financial_council_authority_invalid", 3),
    quotedAmountMinor: safeInteger(row.quotedAmountMinor),
    estimatedGrossProfitMinor: safeInteger(row.estimatedGrossProfitMinor),
    estimatedContributionMinor: safeInteger(row.estimatedContributionMinor),
    grossMarginBps: safeInteger(row.grossMarginBps)
  });
}

function projectExpected(
  row: AdvisorRoiSliceView,
  sensitive: boolean
): AdvisorRoiSliceView {
  if (!("reason" in row) || !("quoteVersionIds" in row)
    || !("probabilityAssessmentIds" in row) || !("costEstimateIds" in row)) {
    return authorityError("financial_council_authority_invalid");
  }
  if ((row.status !== "computed" && row.status !== "not_computable")
    || (row.status === "computed" && row.reason !== null)
    || (row.status === "not_computable"
      && !EXPECTED_ROI_REASONS.has(row.reason))) {
    return authorityError("financial_council_authority_invalid");
  }
  const common = {
    cohortId: text(row.cohortId, "financial_council_authority_invalid"),
    planId: row.planId === null ? null
      : text(row.planId, "financial_council_authority_invalid"),
    currency: text(row.currency, "financial_council_authority_invalid", 3),
    status: row.status,
    reason: row.reason,
    roiBps: row.roiBps === null ? null : safeInteger(row.roiBps),
    formulaVersion: "expected-gross-profit-roi.v1" as const,
    quoteVersionIds: [...row.quoteVersionIds].sort(compare),
    probabilityAssessmentIds: [...row.probabilityAssessmentIds].sort(compare),
    costEstimateIds: [...row.costEstimateIds].sort(compare)
  };
  if (!sensitive) {
    return Object.freeze({ ...common, amountVisibility: "redacted" as const });
  }
  if (row.amountVisibility !== "full") {
    return authorityError("financial_council_authority_invalid");
  }
  return Object.freeze({
    ...common,
    amountVisibility: "full" as const,
    probabilityWeightedGrossProfitMinor:
      row.probabilityWeightedGrossProfitMinor === null ? null
        : safeInteger(row.probabilityWeightedGrossProfitMinor),
    attributedEstimatedCostMinor:
      row.attributedEstimatedCostMinor === null ? null
        : safeInteger(row.attributedEstimatedCostMinor)
  });
}

function projectActual(
  row: AdvisorRoiSliceView,
  sensitive: boolean
): AdvisorRoiSliceView {
  const identity = {
    cohortId: text(row.cohortId, "financial_council_authority_invalid"),
    planId: row.planId === null ? null
      : text(row.planId, "financial_council_authority_invalid"),
    currency: text(row.currency, "financial_council_authority_invalid", 3)
  };
  if (row.status !== "computed" && row.status !== "not_computable") {
    return authorityError("financial_council_authority_invalid");
  }
  if (row.status === "not_computable") {
    if (!("closureVersionId" in row) || !("closureAsOf" in row)) {
      return authorityError("financial_council_authority_invalid");
    }
    if (!ACTUAL_ROI_REASONS.has(row.reason)) {
      return authorityError("financial_council_authority_invalid");
    }
    return Object.freeze({
      ...identity,
      status: "not_computable" as const,
      reason: row.reason,
      closureVersionId: row.closureVersionId,
      closureAsOf: row.closureAsOf,
      formulaVersion: "verified-gross-profit-roi.v1" as const
    });
  }
  if (!("basis" in row) || !("costCoverageBps" in row)) {
    return authorityError("financial_council_authority_invalid");
  }
  const common = {
    ...identity,
    status: "computed" as const,
    basis: "verified_gross_profit" as const,
    roiBps: safeInteger(row.roiBps),
    costCoverageBps: bps(row.costCoverageBps),
    marginCoverageBps: bps(row.marginCoverageBps),
    cashCoverageBps: bps(row.cashCoverageBps),
    attributionCoverageBps: bps(row.attributionCoverageBps),
    closureVersionId: text(row.closureVersionId, "financial_council_authority_invalid"),
    closureAsOf: text(row.closureAsOf, "financial_council_authority_invalid", 35),
    formulaVersion: "verified-gross-profit-roi.v1" as const
  };
  if (!sensitive) {
    return Object.freeze({ ...common, amountVisibility: "redacted" as const });
  }
  if (row.amountVisibility !== "full") {
    return authorityError("financial_council_authority_invalid");
  }
  return Object.freeze({
    ...common,
    amountVisibility: "full" as const,
    verifiedGrossProfitMinor: safeInteger(row.verifiedGrossProfitMinor),
    verifiedAcquisitionCostMinor: safeInteger(row.verifiedAcquisitionCostMinor)
  });
}

function projectFact(
  row: FinancialCouncilVerifiedFactSource,
  sensitive: boolean
): FinancialCouncilVerifiedFactView {
  if (!FACT_TYPES.has(row.factType)) {
    return authorityError("financial_council_authority_invalid");
  }
  const common: VerifiedFactCommon = {
    entryId: text(row.entryId, "financial_council_authority_invalid"),
    sourceVersion: safeInteger(row.sourceVersion),
    factType: row.factType,
    currency: text(row.currency, "financial_council_authority_invalid", 3),
    businessOccurredAt: text(row.businessOccurredAt, "financial_council_authority_invalid", 35),
    entryRecordedAt: text(row.entryRecordedAt, "financial_council_authority_invalid", 35),
    verificationRevision: safeInteger(row.verificationRevision),
    verificationRecordedAt: text(row.verificationRecordedAt, "financial_council_authority_invalid", 35),
    snapshotHash: hash(row.snapshotHash)
  };
  return sensitive
    ? Object.freeze({
        ...common,
        amountVisibility: "full" as const,
        amountMinor: safeInteger(row.amountMinor),
        netAmountMinor: safeInteger(row.netAmountMinor)
      })
    : Object.freeze({ ...common, amountVisibility: "redacted" as const });
}

function projectGap(row: FinancialDataGapView): FinancialDataGapView {
  if (!GAP_CODES.has(row.code) || !GAP_SOURCES.has(row.sourceType)) {
    return authorityError("financial_council_authority_invalid");
  }
  return Object.freeze({
    code: row.code,
    sourceType: row.sourceType,
    sourceId: text(row.sourceId, "financial_council_authority_invalid"),
    sourceSnapshotHash: hash(row.sourceSnapshotHash),
    cohortId: row.cohortId === null ? null
      : text(row.cohortId, "financial_council_authority_invalid"),
    currency: text(row.currency, "financial_council_authority_invalid", 3),
    asOf: text(row.asOf, "financial_council_authority_invalid", 35)
  });
}

export class FinancialCouncilAuthorityReader {
  constructor(
    private readonly dependencies: FinancialCouncilAuthorityReaderDependencies
  ) {}

  async readAt(
    context: ActiveWorkspaceContext,
    input: { readonly currency: string; readonly cutoff: GrowthSealedReadCutoff }
  ): Promise<FinancialCouncilAuthoritySnapshot> {
    if (!context.workspaceId.trim() || context.workspaceId === "all") {
      return authorityError("financial_council_authority_workspace_mismatch");
    }
    const cutoff = assertGrowthSealedReadCutoff(
      input.cutoff, context.workspaceId
    );
    const [today, factRows] = await Promise.all([
      this.dependencies.advisor.getTodayAt(context, {
        currency: input.currency, cutoff
      }),
      this.dependencies.verifiedFacts.listVisibleAt(context, {
        currency: input.currency, cutoff, limit: MAX_ROWS
      })
    ]);
    if (today.workspaceId !== context.workspaceId
      || today.dataAsOf !== cutoff.effectiveAsOf
      || factRows.some((row) => row.workspaceId !== context.workspaceId)) {
      return authorityError("financial_council_authority_workspace_mismatch");
    }
    const sensitive = context.capabilities.includes("pricing.sensitive.read");
    const priorityCustomers = today.priorityCustomers.slice(0, MAX_ROWS)
      .map(projectPriority).sort((left, right) =>
        compare(left.candidateId, right.candidateId));
    const pendingQuoteApprovals = today.pendingQuoteApprovals
      .slice(0, MAX_ROWS).map((row) => projectApproval(row, sensitive))
      .sort((left, right) => compare(left.quoteVersionId, right.quoteVersionId)
        || compare(left.approvalId, right.approvalId));
    const verifiedFinancialFacts = factRows
      .filter((row) => row.currency === input.currency)
      .slice(0, MAX_ROWS).map((row) => projectFact(row, sensitive))
      .sort((left, right) => compare(left.entryId, right.entryId));
    const expectedRoi = today.expectedRoi.filter((row) =>
      row.currency === input.currency).slice(0, MAX_ROWS)
      .map((row) => projectExpected(row, sensitive))
      .sort((left, right) => compare(left.cohortId, right.cohortId)
        || compare(left.planId ?? "", right.planId ?? ""));
    const actualRoi = today.actualRoi.filter((row) =>
      row.currency === input.currency).slice(0, MAX_ROWS)
      .map((row) => projectActual(row, sensitive))
      .sort((left, right) => compare(left.cohortId, right.cohortId)
        || compare(left.planId ?? "", right.planId ?? ""));
    const dataGaps = today.dataGaps.filter((row) =>
      row.currency === input.currency).slice(0, MAX_ROWS).map(projectGap)
      .sort((left, right) => compare(left.sourceType, right.sourceType)
        || compare(left.sourceId, right.sourceId) || compare(left.code, right.code));
    const projection = {
      workspaceId: context.workspaceId,
      currency: input.currency,
      dataAsOf: cutoff.effectiveAsOf,
      projectionLevel: sensitive ? "full" as const : "redacted" as const,
      priorityCustomers,
      pendingQuoteApprovals,
      verifiedFinancialFacts,
      expectedRoi,
      actualRoi,
      dataGaps
    };
    return immutableFinancialCouncilValue({
      ...projection,
      sourceSnapshotHash: financialCouncilCanonicalHash(projection)
    });
  }
}
