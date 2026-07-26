import type {
  AcquisitionRunStatus,
  AdvisorRunVm,
  AdvisorStatus,
  BattleCardSectionDto,
  BattleCardSectionVm,
  CandidateCardVm,
  ExecutiveSummaryDto,
  ExecutiveSummaryVm,
  FinancialAmountDto,
  FinancialAmountVm,
  FinancialValueDto,
  FinancialValueVm,
  RunPresentationDto
} from "./types.js";

function formatAmount({ currency, amountMinor }: FinancialAmountDto) {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol"
  }).format(amountMinor / 100);
  return currency === "USD" ? formatted.replace("$", "US$") : formatted;
}

function financialAmountsVm(values: FinancialAmountDto[]): FinancialAmountVm[] {
  return [...values]
    .sort((left, right) =>
      left.currency === "CNY"
        ? -1
        : right.currency === "CNY"
          ? 1
          : left.currency.localeCompare(right.currency)
    )
    .map((value) => ({ ...value, formatted: formatAmount(value) }));
}

export function financialValueVm(
  value: FinancialValueDto | null
): FinancialValueVm {
  if (value === null) {
    return { status: "pending", label: "待评估", amounts: [] };
  }
  return {
    status: "evaluated",
    label: "已评估",
    amounts: financialAmountsVm([{
      currency: value.currency,
      amountMinor: value.expectedRevenueMinor
    }])
  };
}

function summaryVm(summary: ExecutiveSummaryDto): ExecutiveSummaryVm {
  return {
    ...summary,
    expectedRevenueByCurrency: financialAmountsVm(
      summary.expectedRevenueByCurrency
    )
  };
}

function candidateVm(
  event: RunPresentationDto["candidateEvents"][number]
): CandidateCardVm {
  const qualification = event.qualification;
  const isHighIntent =
    qualification?.grade === "S" || qualification?.grade === "A";
  const isValidOpportunity = Boolean(
    qualification
    && ["S", "A", "B"].includes(qualification.grade)
    && qualification.hardGateFailures.length === 0
    && event.candidate.status !== "do_not_contact"
  );
  return {
    ...event.candidate,
    qualification,
    financialValue: financialValueVm(event.financialValue),
    sourcePlatforms: [...event.sourcePlatforms],
    evidenceCount: event.evidenceCount,
    isHighIntent,
    isValidOpportunity
  };
}

export function mergePresentation(
  previous: AdvisorRunVm,
  dto: RunPresentationDto
): AdvisorRunVm {
  const candidatesById = new Map(previous.candidatesById);
  for (const event of dto.candidateEvents) {
    candidatesById.set(event.candidateId, candidateVm(event));
  }
  return {
    run: dto.run,
    providers: dto.providers,
    summary: summaryVm(dto.summary),
    candidatesById,
    nextAfter: dto.nextAfter,
    hasMore: dto.hasMore
  };
}

export function battleCardSectionsVm(
  sections: BattleCardSectionDto[]
): BattleCardSectionVm[] {
  return sections.map((section) => ({
    label: section.label,
    kind: section.kind,
    content: section.content,
    inferenceLabel: section.kind === "inference" ? "推测" : null,
    confidence: section.confidence ?? null,
    evidenceIds: [...(section.evidenceIds ?? [])]
  }));
}

export function pageStatusForRun(
  status: AcquisitionRunStatus | "connection_required"
): AdvisorStatus {
  if (status === "connection_required") return "connection_required";
  if (status === "partial_success") return "partial_success";
  if (status === "succeeded_empty") return "empty";
  if (status === "failed" || status === "budget_exhausted") return "failed";
  if (status === "succeeded") return "completed";
  if (status === "cancelled" || status === "cancel_requested") {
    return "cancelled";
  }
  if (status === "paused" || status === "pause_requested") return "paused";
  return "running";
}
