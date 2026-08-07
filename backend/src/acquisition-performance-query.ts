import type {
  AcquisitionPresentationCandidateSnapshot,
  AcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import type {
  AcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";
import type {
  AcquisitionOutcomeReconciliationDiagnostic
} from "./types.js";

export interface AcquisitionPerformanceQuery {
  platform?: "douyin" | "web";
  from: string;
  to: string;
}

export interface AcquisitionPerformanceFact {
  metricId: string;
  text: string;
  evidenceRefs: string[];
}

export interface AcquisitionPerformanceDto {
  counts: {
    discovered: number;
    highIntent: number;
    approved: number;
    converted: number;
    contacted: number;
    quoted: number;
    won: number;
    lost: number;
  };
  rates: {
    highIntentRate: number | null;
    approvalRate: number | null;
    crmConversionRate: number | null;
    contactRate: number | null;
    quoteRate: number | null;
    winRate: number | null;
  };
  valuesByCurrency: Array<{
    currency: string;
    estimatedPipelineMinor: number;
    quotedMinor: number;
    wonContractMinor: number;
  }>;
  cost: {
    status: "available" | "not_aggregatable";
    executionCostMinor: number | null;
    currency: string | null;
    coverage: "recorded_api_execution_only";
  };
  roi: {
    status: "not_computable";
    reason: "channel_cost_or_verified_margin_unavailable";
  };
  dataQuality: {
    missingAttribution: number;
    missingFinancial: number;
    truncated: boolean;
    lastReconciledAt: string | null;
  };
  briefingFacts: {
    headlines: AcquisitionPerformanceFact[];
    risks: AcquisitionPerformanceFact[];
    actions: AcquisitionPerformanceFact[];
    metricIds: string[];
  };
}

interface PerformanceReconciler {
  runOnce(): Promise<{ lastReconciledAt: string | null }>;
}

interface PerformanceCheckpoint {
  ownerId: string;
  teamId: string;
  updatedAt: string;
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function inWindow(value: string, from: string, to: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time)
    && time >= new Date(from).getTime()
    && time <= new Date(to).getTime();
}

function moneyValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const amount = value as { amountMinor?: unknown; currency?: unknown };
  if (!Number.isSafeInteger(amount.amountMinor)
    || Number(amount.amountMinor) < 0
    || typeof amount.currency !== "string"
    || !/^[A-Z]{3}$/.test(amount.currency.toUpperCase())) return null;
  return {
    amountMinor: Number(amount.amountMinor),
    currency: amount.currency.toUpperCase()
  };
}

function fact(
  metricId: string,
  text: string,
  evidenceRefs: string[]
): AcquisitionPerformanceFact {
  return { metricId, text, evidenceRefs };
}

export class AcquisitionPerformanceQueryService {
  readonly #planRuns: Pick<
    AcquisitionPlanRunRepository,
    "listRuns" | "getPlanVersion" | "listRunEvents"
  >;
  readonly #domain: Pick<
    AcquisitionDomainRepository,
    | "getPresentationCandidateSnapshots"
    | "listQualificationDecisions"
    | "listOutcomes"
    | "listAuditEvents"
  >;
  readonly #diagnostics: AcquisitionOutcomeReconciliationDiagnostic[];
  readonly #checkpoints: PerformanceCheckpoint[];

  constructor(options: {
    planRuns: Pick<
      AcquisitionPlanRunRepository,
      "listRuns" | "getPlanVersion" | "listRunEvents"
    >;
    domain: Pick<
      AcquisitionDomainRepository,
      | "getPresentationCandidateSnapshots"
      | "listQualificationDecisions"
      | "listOutcomes"
      | "listAuditEvents"
    >;
    diagnostics: AcquisitionOutcomeReconciliationDiagnostic[];
    checkpoints?: PerformanceCheckpoint[];
    /** Accepted temporarily for backwards-compatible composition; never called. */
    reconcile?: PerformanceReconciler;
  }) {
    this.#planRuns = options.planRuns;
    this.#domain = options.domain;
    this.#diagnostics = options.diagnostics;
    this.#checkpoints = options.checkpoints ?? [];
  }

  async get(
    scope: { ownerId: string; teamId: string },
    query: AcquisitionPerformanceQuery
  ): Promise<AcquisitionPerformanceDto> {
    const lastReconciledAt = this.#checkpoints
      .filter((item) =>
        item.ownerId === scope.ownerId && item.teamId === scope.teamId)
      .map((item) => item.updatedAt)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
    const scopedRuns = (await this.#planRuns.listRuns(scope)).filter((run) =>
      run.ownerId === scope.ownerId && run.teamId === scope.teamId);
    const selectedRuns = (await Promise.all(scopedRuns.map(async (run) => ({
      run,
      version: await this.#planRuns.getPlanVersion(run.planVersionId)
    })))).filter(({ version }) =>
      !query.platform || version?.payload.targetPlatform === query.platform);
    const allDiscoveryEvents = (await Promise.all(selectedRuns.map(
      async ({ run }) => (await this.#planRuns.listRunEvents(run.id))
        .filter((event) =>
          event.runId === run.id
          && event.ownerId === scope.ownerId
          && event.teamId === scope.teamId
          && event.type === "candidate.discovered"
          && typeof event.data.candidateId === "string"
          && event.data.candidateId)
    ))).flat();
    const discoveryEvents = allDiscoveryEvents.filter((event) =>
      inWindow(event.at, query.from, query.to));
    const fromMs = new Date(query.from).getTime();
    const toMs = new Date(query.to).getTime();
    const windowDurationMs = toMs - fromMs + 1;
    const previousFrom = new Date(fromMs - windowDurationMs).toISOString();
    const previousTo = new Date(fromMs - 1).toISOString();
    const previousDiscoveryEvents = allDiscoveryEvents.filter((event) =>
      inWindow(event.at, previousFrom, previousTo));
    const candidateEvent = new Map<string, (typeof discoveryEvents)[number]>();
    for (const event of discoveryEvents.sort((left, right) =>
      left.at.localeCompare(right.at) || left.id.localeCompare(right.id))) {
      candidateEvent.set(String(event.data.candidateId), event);
    }
    const candidateIds = [...candidateEvent.keys()].sort();
    const snapshots = candidateIds.length
      ? await this.#domain.getPresentationCandidateSnapshots(scope, candidateIds)
      : [];
    const scopedSnapshots = snapshots.filter((snapshot) =>
      candidateEvent.has(snapshot.candidate.id)
      && snapshot.candidate.ownerId === scope.ownerId
      && snapshot.candidate.teamId === scope.teamId);
    const qualificationByCandidate = new Map((await Promise.all(
      candidateIds.map(async (candidateId) => {
        const decisions = (await this.#domain.listQualificationDecisions(
          scope,
          candidateId
        )).filter((decision) =>
          decision.candidateId === candidateId
          && decision.ownerId === scope.ownerId
          && decision.teamId === scope.teamId
          && inWindow(decision.createdAt, query.from, query.to))
          .sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt)
            || right.id.localeCompare(left.id));
        return [candidateId, decisions[0] ?? null] as const;
      })
    )));
    const outcomes = (await Promise.all(candidateIds.map(async (candidateId) =>
      (await this.#domain.listOutcomes(scope, candidateId)).filter((outcome) =>
        outcome.candidateId === candidateId
        && outcome.ownerId === scope.ownerId
        && outcome.teamId === scope.teamId
        && inWindow(outcome.occurredAt, query.from, query.to))
    ))).flat();
    const auditEvents = (await Promise.all(candidateIds.map(
      async (candidateId) =>
        (await this.#domain.listAuditEvents(scope, candidateId)).filter((event) =>
          event.candidateId === candidateId
          && event.ownerId === scope.ownerId
          && event.teamId === scope.teamId
          && inWindow(event.createdAt, query.from, query.to))
    ))).flat();
    const candidatesForOutcome = (eventType: string) => new Set(outcomes
      .filter((outcome) => outcome.eventType === eventType)
      .map((outcome) => outcome.candidateId));
    const highIntent = [...qualificationByCandidate.values()].filter(
      (decision) => decision && ["S", "A"].includes(decision.grade)
    ).length;
    const approved = new Set(auditEvents.filter((event) =>
      event.toStatus === "approved").map((event) => event.candidateId)).size;
    const converted = new Set(auditEvents.filter((event) =>
      event.toStatus === "converted_to_lead")
      .map((event) => event.candidateId)).size;
    const contacted = candidatesForOutcome("contacted").size;
    const quoted = candidatesForOutcome("quoted").size;
    const won = candidatesForOutcome("won").size;
    const lost = candidatesForOutcome("lost").size;
    const counts = {
      discovered: candidateIds.length,
      highIntent,
      approved,
      converted,
      contacted,
      quoted,
      won,
      lost
    };
    const rates = {
      highIntentRate: rate(highIntent, counts.discovered),
      approvalRate: rate(approved, counts.discovered),
      crmConversionRate: rate(converted, approved),
      contactRate: rate(contacted, converted),
      quoteRate: rate(quoted, contacted),
      winRate: rate(won, quoted)
    };
    const byCurrency = new Map<string, {
      estimatedPipelineMinor: number;
      quotedMinor: number;
      wonContractMinor: number;
    }>();
    const currency = (code: string) => {
      const key = code.toUpperCase();
      const current = byCurrency.get(key) ?? {
        estimatedPipelineMinor: 0,
        quotedMinor: 0,
        wonContractMinor: 0
      };
      byCurrency.set(key, current);
      return current;
    };
    for (const snapshot of scopedSnapshots) {
      if (!snapshot.financial
        || !qualificationByCandidate.get(snapshot.candidate.id)) {
        continue;
      }
      currency(snapshot.financial.currency).estimatedPipelineMinor +=
        snapshot.financial.expectedRevenueMinor;
    }
    const stableMonetaryOutcomes = new Map<string, (typeof outcomes)[number]>();
    for (const outcome of outcomes.filter((item) =>
      item.eventType === "quoted" || item.eventType === "won")) {
      const key = `${outcome.candidateId}\u001f${outcome.eventType}`;
      const previous = stableMonetaryOutcomes.get(key);
      if (!previous
        || outcome.occurredAt.localeCompare(previous.occurredAt) > 0
        || (outcome.occurredAt === previous.occurredAt
          && outcome.id.localeCompare(previous.id) > 0)) {
        stableMonetaryOutcomes.set(key, outcome);
      }
    }
    for (const outcome of stableMonetaryOutcomes.values()) {
      const amount = moneyValue(outcome.amount);
      if (!amount) continue;
      if (outcome.eventType === "quoted") {
        currency(amount.currency).quotedMinor += amount.amountMinor;
      }
      if (outcome.eventType === "won") {
        currency(amount.currency).wonContractMinor += amount.amountMinor;
      }
    }
    const valuesByCurrency = [...byCurrency.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currencyCode, values]) => ({
        currency: currencyCode,
        ...values
      }));
    const costByCurrency = new Map<string, number>();
    for (const { run } of selectedRuns) {
      if (!inWindow(run.createdAt, query.from, query.to)) continue;
      const code = run.billingCurrency.toUpperCase();
      costByCurrency.set(
        code,
        (costByCurrency.get(code) ?? 0) + run.consumedBudget.amountMinor
      );
    }
    const costEntries = [...costByCurrency.entries()];
    const cost: AcquisitionPerformanceDto["cost"] = costEntries.length <= 1
      ? {
          status: "available",
          executionCostMinor: costEntries[0]?.[1] ?? 0,
          currency: costEntries[0]?.[0] ?? "CNY",
          coverage: "recorded_api_execution_only"
        }
      : {
          status: "not_aggregatable",
          executionCostMinor: null,
          currency: null,
          coverage: "recorded_api_execution_only"
        };
    const missingFinancial = scopedSnapshots.filter((snapshot) =>
      snapshot.financial === null).length;
    const missingAttribution = this.#diagnostics.filter((item) =>
      item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
      && ["attribution_missing", "attribution_invalid", "attribution_cross_tenant"]
        .includes(item.code)
      && inWindow(item.occurredAt, query.from, query.to)).length;
    const headlineRefs = discoveryEvents.map((event) => event.id);
    const previousCandidates = new Set(previousDiscoveryEvents.map((event) =>
      String(event.data.candidateId)));
    const discoveredDelta = counts.discovered - previousCandidates.size;
    const signedDelta = discoveredDelta > 0
      ? `+${discoveredDelta}`
      : String(discoveredDelta);
    const headlines = [
      fact(
        "funnel.discovered",
        `本期发现 ${counts.discovered} 个去重候选，高意向 ${counts.highIntent} 个。`,
        headlineRefs
      ),
      fact(
        "funnel.discovered.delta",
        `本期去重候选较前一可比窗口变化 ${signedDelta}（前期 ${previousCandidates.size}，本期 ${counts.discovered}）。`,
        [...headlineRefs, ...previousDiscoveryEvents.map((event) => event.id)]
      ),
      fact(
        "funnel.won",
        `本期成交 ${counts.won} 个候选；金额仅表示成交合同额。`,
        outcomes.filter((item) => item.eventType === "won").map((item) => item.id)
      )
    ];
    const risks = [
      fact(
        "data.missing_attribution",
        `缺失或无效获客归因 ${missingAttribution} 条。`,
        this.#diagnostics.filter((item) =>
          item.ownerId === scope.ownerId && item.teamId === scope.teamId)
          .map((item) => item.id)
      ),
      fact(
        "roi.status",
        "缺少完整渠道成本、财务核销或可验证毛利，ROI 暂不可计算。",
        selectedRuns.map(({ run }) => run.id)
      )
    ];
    const actions = [
      fact(
        "action.follow_up_converted",
        `优先检查 ${Math.max(0, converted - contacted)} 个尚无联系结果的已转 CRM 候选。`,
        candidateIds
      )
    ];
    return {
      counts,
      rates,
      valuesByCurrency,
      cost,
      roi: {
        status: "not_computable",
        reason: "channel_cost_or_verified_margin_unavailable"
      },
      dataQuality: {
        missingAttribution,
        missingFinancial,
        truncated: false,
        lastReconciledAt
      },
      briefingFacts: {
        headlines,
        risks,
        actions,
        metricIds: [...new Set([
          ...headlines,
          ...risks,
          ...actions
        ].map((item) => item.metricId))]
      }
    };
  }
}
