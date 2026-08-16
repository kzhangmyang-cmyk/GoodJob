import {
  canonicalBusinessReportInput,
  normalizeBusinessReport,
  type NormalizedBusinessReport
} from "./business-advisor/domain.js";
import type {
  BusinessAdvisorService,
  BusinessAnalysisResult
} from "./business-advisor/service.js";
import type {
  FinancialCouncilAuthorityReader,
  FinancialCouncilAuthoritySnapshot
} from "./financial-council-authority-reader.js";
import {
  financialCouncilCanonicalHash,
  immutableFinancialCouncilInput,
  immutableFinancialCouncilValue
} from "./financial-council-domain.js";
import { assertGrowthAsOfNotFuture } from "./growth-as-of.js";
import type {
  FinancialCouncilCreateInput,
  FinancialCouncilDataGap
} from "./growth-contract-types.js";
import { sealGrowthAdvisorReadCutoff } from "./growth-advisor-query.js";
import type { CommandContext } from "./growth-command-context.js";
import type { GrowthTemporalBarrier } from "./growth-temporal-barrier.js";

export type FinancialCouncilSourceKind =
  | "acquisition_cost"
  | "business_report"
  | "crm"
  | "financial_fact"
  | "quote"
  | "roi";

export interface FinancialCouncilSourceRef {
  readonly kind: FinancialCouncilSourceKind;
  readonly sourceId: string;
  readonly version: string | number;
  readonly contentHash: `sha256:${string}`;
}

export interface FinancialSnapshot {
  readonly snapshotId: string;
  readonly workspaceId: string;
  readonly dataAsOf: string;
  readonly currency: string;
  readonly report: NormalizedBusinessReport;
  readonly reportInputHash: `sha256:${string}`;
  readonly authority: FinancialCouncilAuthoritySnapshot;
  readonly formulaInputs: BusinessAnalysisResult;
  readonly dataGaps: readonly FinancialCouncilDataGap[];
  readonly sourceRefs: readonly FinancialCouncilSourceRef[];
  readonly snapshotHash: `sha256:${string}`;
}

export interface FinancialSnapshotBuilderDependencies {
  readonly temporalBarrier: GrowthTemporalBarrier;
  readonly authority: Pick<FinancialCouncilAuthorityReader, "readAt">;
  readonly businessAdvisor: Pick<BusinessAdvisorService, "analyze">;
  readonly now?: () => string;
}

function snapshotError(code = "financial_council_input_invalid"): never {
  throw Object.assign(new Error(code), { code });
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactCreateInput(value: unknown): FinancialCouncilCreateInput {
  const immutable = immutableFinancialCouncilInput(value) as unknown;
  if (!immutable || typeof immutable !== "object"
    || Object.getPrototypeOf(immutable) !== Object.prototype) {
    return snapshotError();
  }
  const record = immutable as Record<string, unknown>;
  const keys = Object.keys(record).sort(compare);
  if (keys.join("\u0000") !== [
    "businessReport", "currency", "dataAsOf", "policyVersionId"
  ].sort(compare).join("\u0000")
    || typeof record.currency !== "string"
    || typeof record.dataAsOf !== "string"
    || typeof record.policyVersionId !== "string"
    || record.policyVersionId.trim() === "") {
    return snapshotError();
  }
  const businessReport = canonicalBusinessReportInput(
    record.businessReport as FinancialCouncilCreateInput["businessReport"]
  );
  if (record.currency !== businessReport.currency) return snapshotError();
  return Object.freeze({
    currency: record.currency as FinancialCouncilCreateInput["currency"],
    dataAsOf: record.dataAsOf,
    businessReport,
    policyVersionId: record.policyVersionId
  });
}

function projectFormulaInputs(
  result: BusinessAnalysisResult
): BusinessAnalysisResult {
  const indicators = Object.freeze({
    grossMarginBps: result.indicators.grossMarginBps,
    netMarginBps: result.indicators.netMarginBps,
    roeBps: result.indicators.roeBps,
    roaBps: result.indicators.roaBps,
    debtRatioBps: result.indicators.debtRatioBps,
    currentRatioBps: result.indicators.currentRatioBps,
    quickRatioBps: result.indicators.quickRatioBps,
    receivableTurnover: result.indicators.receivableTurnover,
    inventoryTurnover: result.indicators.inventoryTurnover,
    interestCoverage: result.indicators.interestCoverage,
    receivableDays: result.indicators.receivableDays,
    cashCoverageMonths: result.indicators.cashCoverageMonths,
    cashCollectionRatioBps: result.indicators.cashCollectionRatioBps,
    cashProfitRatioBps: result.indicators.cashProfitRatioBps,
    revenueMinor: result.indicators.revenueMinor,
    netProfitMinor: result.indicators.netProfitMinor
  });
  const products = result.products.map((row) => Object.freeze({
    name: row.name,
    revenueMinor: row.revenueMinor,
    grossMarginBps: row.grossMarginBps,
    trueProfitMinor: row.trueProfitMinor,
    trueMarginBps: row.trueMarginBps,
    isFakeProfit: row.isFakeProfit
  })).sort((left, right) => compare(left.name, right.name));
  const customers = result.customers.map((row) => Object.freeze({
    name: row.name,
    revenueMinor: row.revenueMinor,
    trueProfitMinor: row.trueProfitMinor,
    trueMarginBps: row.trueMarginBps,
    paymentDays: row.paymentDays,
    grade: row.grade
  })).sort((left, right) => compare(left.name, right.name));
  const cashflow = Object.freeze({
    next30DaysNetMinor: result.cashflow.next30DaysNetMinor,
    next90DaysNetMinor: result.cashflow.next90DaysNetMinor,
    projectedClosingCash30DaysMinor:
      result.cashflow.projectedClosingCash30DaysMinor,
    projectedClosingCash90DaysMinor:
      result.cashflow.projectedClosingCash90DaysMinor,
    warning: Object.freeze([...result.cashflow.warning].sort(compare))
  });
  const cost = Object.freeze({
    materialCostRateBps: result.cost.materialCostRateBps,
    previousMaterialCostRateBps: result.cost.previousMaterialCostRateBps,
    materialRateChangeBps: result.cost.materialRateChangeBps,
    anomaly: Object.freeze([...result.cost.anomaly].sort(compare)),
    laborShareBps: result.cost.laborShareBps,
    variableShareBps: result.cost.variableShareBps,
    fixedShareBps: result.cost.fixedShareBps
  });
  const tax = Object.freeze({
    redCount: result.tax.redCount,
    yellowCount: result.tax.yellowCount,
    greenCount: result.tax.greenCount,
    level: result.tax.level,
    findings: Object.freeze(result.tax.findings.map((row) => Object.freeze({
      category: row.category,
      issue: row.issue.slice(0, 4_000),
      level: row.level
    })).sort((left, right) => compare(left.category, right.category)
      || compare(left.issue, right.issue)))
  });
  return immutableFinancialCouncilValue({
    indicators, products, customers, cashflow, cost, tax
  });
}

function gapSource(
  sourceType: FinancialCouncilAuthoritySnapshot["dataGaps"][number]["sourceType"]
): FinancialCouncilDataGap["source"] {
  if (sourceType === "cost_entry") return "acquisition_cost";
  if (sourceType === "commercial_binding") return "quote";
  return "financial_fact";
}

function snapshotGaps(
  report: FinancialCouncilCreateInput["businessReport"],
  authority: FinancialCouncilAuthoritySnapshot
): readonly FinancialCouncilDataGap[] {
  const gaps: FinancialCouncilDataGap[] = authority.dataGaps.map((gap) => ({
    code: gap.code,
    source: gapSource(gap.sourceType),
    sourceId: gap.sourceId,
    description: `authority:${gap.code}`
  }));
  if (!report.cashFlow) {
    gaps.push({
      code: "import_requires_review",
      source: "business_report",
      sourceId: null,
      description: "cash_flow_missing"
    });
  }
  if (authority.expectedRoi.length === 0) {
    gaps.push({
      code: "import_requires_review", source: "roi", sourceId: null,
      description: "expected_roi_missing"
    });
  } else {
    for (const row of authority.expectedRoi) {
      if (row.status === "not_computable") {
        gaps.push({
          code: "import_requires_review", source: "roi",
          sourceId: `expected:${row.cohortId}:${row.planId ?? "all"}:${row.currency}`,
          description: `expected_roi_not_computable:${row.reason}`
        });
      }
    }
  }
  if (authority.actualRoi.length === 0) {
    gaps.push({
      code: "import_requires_review", source: "roi", sourceId: null,
      description: "actual_roi_missing"
    });
  } else {
    for (const row of authority.actualRoi) {
      if (row.status === "not_computable") {
        gaps.push({
          code: "import_requires_review", source: "roi",
          sourceId: `actual:${row.cohortId}:${row.planId ?? "all"}:${row.currency}`,
          description: `actual_roi_not_computable:${row.reason}`
        });
      }
    }
  }
  return immutableFinancialCouncilValue(gaps.sort((left, right) =>
    compare(left.source, right.source)
    || compare(left.sourceId ?? "", right.sourceId ?? "")
    || compare(left.code, right.code)
    || compare(left.description, right.description)));
}

function sourceRefs(
  reportInputHash: `sha256:${string}`,
  authority: FinancialCouncilAuthoritySnapshot
): readonly FinancialCouncilSourceRef[] {
  const refs: FinancialCouncilSourceRef[] = [{
    kind: "business_report", sourceId: "business-report", version: 1,
    contentHash: reportInputHash
  }, {
    kind: "crm", sourceId: "growth-advisor-today", version: 1,
    contentHash: authority.sourceSnapshotHash
  }];
  for (const row of authority.priorityCustomers) refs.push({
    kind: "crm", sourceId: row.candidateId,
    version: row.qualificationDecisionVersion,
    contentHash: row.inputSnapshotHash
  });
  for (const row of authority.pendingQuoteApprovals) refs.push({
    kind: "quote", sourceId: row.quoteVersionId,
    version: row.quoteVersionRevision,
    contentHash: financialCouncilCanonicalHash(row)
  });
  for (const row of authority.verifiedFinancialFacts) refs.push({
    kind: "financial_fact", sourceId: row.entryId,
    version: row.sourceVersion, contentHash: row.snapshotHash
  });
  for (const [kind, rows] of [
    ["expected", authority.expectedRoi],
    ["actual", authority.actualRoi]
  ] as const) {
    for (const row of rows) refs.push({
      kind: "roi",
      sourceId: `${kind}:${row.cohortId}:${row.planId ?? "all"}:${row.currency}`,
      version: row.formulaVersion,
      contentHash: financialCouncilCanonicalHash(row)
    });
  }
  for (const gap of authority.dataGaps) refs.push({
    kind: gapSource(gap.sourceType), sourceId: gap.sourceId,
    version: 1, contentHash: gap.sourceSnapshotHash
  });
  refs.sort((left, right) => compare(left.kind, right.kind)
    || compare(left.sourceId, right.sourceId));
  const unique: FinancialCouncilSourceRef[] = [];
  for (const ref of refs) {
    const previous = unique.at(-1);
    if (previous?.kind === ref.kind && previous.sourceId === ref.sourceId) {
      if (previous.version !== ref.version
        || previous.contentHash !== ref.contentHash) return snapshotError();
      continue;
    }
    unique.push(Object.freeze({ ...ref }));
  }
  return Object.freeze(unique);
}

export class FinancialSnapshotBuilder {
  private readonly now: () => string;

  constructor(
    private readonly dependencies: FinancialSnapshotBuilderDependencies
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async freeze(
    command: CommandContext,
    rawInput: FinancialCouncilCreateInput
  ): Promise<FinancialSnapshot> {
    const input = exactCreateInput(rawInput);
    const workspaceId = command?.workspace?.workspaceId?.trim();
    if (!workspaceId || workspaceId === "all") return snapshotError();
    const effectiveAsOf = assertGrowthAsOfNotFuture(
      input.dataAsOf, this.now(), 1_000
    );
    const reportInputHash = financialCouncilCanonicalHash(
      input.businessReport
    );
    const report = immutableFinancialCouncilValue(
      normalizeBusinessReport(input.businessReport)
    );
    const formulaInputs = projectFormulaInputs(
      this.dependencies.businessAdvisor.analyze(input.businessReport)
    );
    const cutoff = await sealGrowthAdvisorReadCutoff(
      this.dependencies.temporalBarrier, command.workspace, effectiveAsOf
    );
    const authority = await this.dependencies.authority.readAt(
      command.workspace, { currency: input.currency, cutoff }
    );
    if (authority.workspaceId !== workspaceId
      || authority.currency !== input.currency
      || authority.dataAsOf !== cutoff.effectiveAsOf) {
      return snapshotError("financial_council_authority_workspace_mismatch");
    }
    const dataGaps = snapshotGaps(input.businessReport, authority);
    const refs = sourceRefs(reportInputHash, authority);
    const identity = {
      workspaceId,
      dataAsOf: cutoff.effectiveAsOf,
      currency: input.currency,
      report,
      reportInputHash,
      authority,
      formulaInputs,
      dataGaps,
      sourceRefs: refs
    };
    const snapshotId = financialCouncilCanonicalHash(identity);
    const snapshotHash = financialCouncilCanonicalHash({
      snapshotId, ...identity
    });
    return immutableFinancialCouncilValue({
      snapshotId,
      ...identity,
      snapshotHash
    });
  }
}
