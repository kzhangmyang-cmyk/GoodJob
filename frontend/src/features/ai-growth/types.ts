import type { components, paths } from "./generated/ai-acquisition.js";

export type AdvisorMode = "demo" | "real";

export type AdvisorStatus =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "partial_success"
  | "completed"
  | "cancelled"
  | "connection_required"
  | "empty"
  | "failed";

export type IndustryTemplateId =
  | "enterprise-services"
  | "export-manufacturing"
  | "renovation"
  | "beauty"
  | "education"
  | "custom";

/**
 * The public plan-create request. Immutable model snapshots are server-bound
 * and therefore deliberately absent from this DTO.
 */
export type AcquisitionPlanCreateDto =
  paths["/api/v1/acquisition/plans"]["post"]["requestBody"]["content"]["application/json"];
export type AcquisitionUsageDto =
  AcquisitionPlanCreateDto["operations"][number]["allocatedBudget"];
export type AcquisitionBudgetDto = AcquisitionPlanCreateDto["budgetSnapshot"];
export type AcquisitionProviderConnectionDto =
  AcquisitionPlanCreateDto["providerConnections"][number];
export type AcquisitionPlanOperationDto =
  AcquisitionPlanCreateDto["operations"][number];

type GeneratedRunPresentationDto =
  components["schemas"]["AcquisitionRunPresentation"];
type GeneratedProviderShardDto =
  GeneratedRunPresentationDto["providers"][number];
type GeneratedCandidatePresentationEventDto =
  GeneratedRunPresentationDto["candidateEvents"][number];

export type RunDto = GeneratedRunPresentationDto["run"];
export type AcquisitionRunStatus = RunDto["status"];
export type AcquisitionShardStatus =
  components["schemas"]["AcquisitionOperationShard"]["status"];
export type ProviderShardDto = Omit<GeneratedProviderShardDto, "status"> & {
  status: AcquisitionShardStatus;
};
export type ExecutiveSummaryDto = GeneratedRunPresentationDto["summary"];
export type FinancialAmountDto =
  ExecutiveSummaryDto["expectedRevenueByCurrency"][number];
export type CandidateStatus =
  components["schemas"]["OrganizationCandidate"]["status"];
export type CandidatePresentationDto = Omit<
  GeneratedCandidatePresentationEventDto["candidate"],
  "status"
> & {
  status: CandidateStatus;
};
export type CandidatePresentationEventDto = Omit<
  GeneratedCandidatePresentationEventDto,
  "candidate"
> & {
  candidate: CandidatePresentationDto;
};
export type QualificationDto = NonNullable<
  CandidatePresentationEventDto["qualification"]
>;
export type QualificationGrade = QualificationDto["grade"];
export type HardGateFailure = QualificationDto["hardGateFailures"][number];
export type FinancialValueDto = NonNullable<
  CandidatePresentationEventDto["financialValue"]
>;
export type RunPresentationDto = Omit<
  GeneratedRunPresentationDto,
  "providers" | "candidateEvents"
> & {
  providers: ProviderShardDto[];
  candidateEvents: CandidatePresentationEventDto[];
};

interface CandidateDtoCommon {
  id: string;
  status: CandidateStatus;
  latestDecisionVersion: string | null;
  approvedDecisionVersion: string | null;
  updatedAt: string;
  evidenceIds: string[];
}

export interface OrganizationCandidateDto extends CandidateDtoCommon {
  subjectKind: "organization";
  name: string;
  domain: string | null;
  region: string | null;
  creditCode: string | null;
  createdAt: string;
}

export interface IndividualCandidateDto extends CandidateDtoCommon {
  subjectKind: "individual";
  publicActorKey: string;
  publicDisplayName: string;
  publicProfileUrl: string;
  sourcePlatform: string;
  demandCategory: string;
  demandSummary: string;
  locationHint: string;
  buyingStage:
    | "awareness"
    | "problem_defined"
    | "solution_research"
    | "comparison"
    | "purchase_ready";
  negativeSignals: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export type CandidateDto = OrganizationCandidateDto | IndividualCandidateDto;

export interface BattleCardSectionDto {
  label: string;
  kind: "fact" | "inference" | "unknown";
  content: string;
  evidenceIds?: string[];
  confidence?: number;
}

export interface BattleCardClaimDto {
  kind: "fact" | "inference" | "unknown";
  text: string;
  evidenceIds: string[];
  confidence: number | null;
}

export interface BattleCardBuyingRoleDto {
  role: string;
  priority: 1 | 2 | 3;
  influence: "decision_maker" | "influencer" | "user" | "gatekeeper";
  concerns: string[];
  claim: BattleCardClaimDto;
}

export type BattleCardConnectionChannel =
  | "public_reply"
  | "wecom"
  | "phone"
  | "email"
  | "referral";

export interface BattleCardConnectionStrategyDto {
  channel: BattleCardConnectionChannel;
  targetRole: string;
  rationale: BattleCardClaimDto;
  openingDraft: string;
}

export interface BattleCardRoleOpenerDto {
  role: string;
  channel: BattleCardConnectionChannel;
  text: string;
}

export interface BattleCardFinancialSummaryDto {
  decisionId: string;
  decisionVersion: string;
  grade: QualificationGrade;
  score: number;
  currency: string;
  expectedRevenueMinor: number;
  expectedGrossProfitMinor: number;
  expectedContributionMinor: number;
  factors: FinancialValueDto["factors"];
}

export interface BattleCardIntelligenceDto {
  accountOverview: BattleCardClaimDto[];
  needAssessment: BattleCardClaimDto[];
  supplierHypotheses: BattleCardClaimDto[];
  buyingCommittee: BattleCardBuyingRoleDto[];
  procurementPreferences: BattleCardClaimDto[];
  connectionStrategies: BattleCardConnectionStrategyDto[];
  roleSpecificOpeners: BattleCardRoleOpenerDto[];
  doNotActions: string[];
  financialSummary: BattleCardFinancialSummaryDto | null;
}

interface BattleCardDtoCommon {
  id: string;
  candidateId: string;
  qualificationDecisionId: string;
  partyType: "organization" | "individual";
  evidenceIds: string[];
  confidence: number;
  modelProvider: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export interface BattleCardV1Dto extends BattleCardDtoCommon {
  schemaVersion?: "battle-card.v1";
  sections: BattleCardSectionDto[];
  intelligence?: null;
}

export interface BattleCardV2Dto extends BattleCardDtoCommon {
  schemaVersion: "battle-card.v2";
  intelligence: BattleCardIntelligenceDto;
  sections?: never;
}

export type BattleCardDto = BattleCardV1Dto | BattleCardV2Dto;

export interface FinancialAmountVm extends FinancialAmountDto {
  formatted: string;
}

export interface FinancialValueVm {
  status: "evaluated" | "pending";
  label: "已评估" | "待评估";
  amounts: FinancialAmountVm[];
}

export interface CandidateCardVm extends CandidatePresentationDto {
  qualification: QualificationDto | null;
  financialValue: FinancialValueVm;
  sourcePlatforms: string[];
  evidenceCount: number;
  isHighIntent: boolean;
  isValidOpportunity: boolean;
}

export interface ExecutiveSummaryVm
  extends Omit<ExecutiveSummaryDto, "expectedRevenueByCurrency"> {
  expectedRevenueByCurrency: FinancialAmountVm[];
}

export interface AdvisorRunVm {
  run: RunDto;
  providers: ProviderShardDto[];
  summary: ExecutiveSummaryVm | null;
  candidatesById: Map<string, CandidateCardVm>;
  nextAfter: string;
  hasMore: boolean;
}

export interface AdvisorErrorVm {
  code: string;
  message: string;
  retryable: boolean;
}

export interface AdvisorState {
  mode: AdvisorMode;
  status: AdvisorStatus;
  taskText: string;
  templateId: IndustryTemplateId;
  planDraft: AcquisitionPlanCreateDto | null;
  runId: string | null;
  cursor: string | null;
  candidatesById: Map<string, CandidateCardVm>;
  summary: ExecutiveSummaryVm | null;
  error: AdvisorErrorVm | null;
}

export interface BattleCardSectionVm {
  label: string;
  kind: BattleCardSectionDto["kind"];
  content: string;
  evidenceIds: string[];
  confidence: number | null;
  inferenceLabel: "推测" | null;
}

export interface BattleCardClaimVm {
  kind: BattleCardClaimDto["kind"];
  content: string;
  evidenceIds: string[];
  confidence: number | null;
  inferenceLabel: "推测" | null;
}
