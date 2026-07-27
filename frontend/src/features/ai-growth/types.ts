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

export interface AcquisitionUsageDto {
  requests: number;
  results: number;
  amountMinor: number;
  durationSeconds: number;
}

export interface AcquisitionBudgetDto {
  billingCurrency: string;
  maxRequests: number;
  maxResults: number;
  maxAmountMinor: number;
  maxDurationSeconds: number;
}

export interface AcquisitionProviderConnectionDto {
  connectionId: string;
  providerId: string;
  kind: "search" | "content_fetch" | "import";
  status: "active" | "inactive" | "disabled";
  credentialVersion: number;
}

export interface AcquisitionPlanOperationDto {
  operationId: string;
  subjectChannel: "organization" | "individual";
  kind: "search" | "content_fetch" | "import_rows";
  connectionId: string;
  query?: string;
  sourceRef?: string;
  allocatedBudget: AcquisitionUsageDto;
}

/**
 * The public plan-create request. Immutable model snapshots are server-bound
 * and therefore deliberately absent from this DTO.
 */
export interface AcquisitionPlanCreateDto {
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
  providerConnections: AcquisitionProviderConnectionDto[];
  operations: AcquisitionPlanOperationDto[];
  budgetSnapshot: AcquisitionBudgetDto;
  stopConditions: {
    stopWhenBudgetExhausted: boolean;
    stopWhenNoMoreResults: boolean;
  };
  modelConnectionId?: string | null;
}

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

export type CandidateStatus =
  | "discovered"
  | "unresolvable"
  | "normalized"
  | "qualified"
  | "pending_review"
  | "approved"
  | "rejected"
  | "do_not_contact"
  | "needs_research"
  | "converted_to_lead";

export interface RunDto {
  id: string;
  status: AcquisitionRunStatus;
  etag: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProviderShardDto {
  shardId: string;
  connectionId: string;
  providerId: string;
  status: AcquisitionShardStatus;
  rawResultCount: number;
  acceptedResultCount: number;
  duplicateResultCount: number;
  failedResultCount: number;
  errorCode: string | null;
  retryAfterAt: string | null;
}

export interface FinancialAmountDto {
  currency: string;
  amountMinor: number;
}

export interface ExecutiveSummaryDto {
  sourcesSearched: number;
  pagesAnalyzed: number;
  organizationsFound: number;
  dedupedCandidates: number;
  validOpportunities: number;
  highIntent: number;
  financialEvaluatedHighIntentCount: number;
  financialPendingHighIntentCount: number;
  expectedRevenueByCurrency: FinancialAmountDto[];
}

export type QualificationGrade = "S" | "A" | "B" | "C" | "D";

export type HardGateFailure =
  | "missing_original_source"
  | "identity_unresolved"
  | "do_not_contact"
  | "explicit_rejection"
  | "non_public_or_sensitive_data"
  | "stale_evidence"
  | "schema_invalid";

export interface QualificationDto {
  id: string;
  candidateId: string;
  decisionVersion: string;
  decisionEngine: "model" | "rules";
  grade: QualificationGrade;
  score: number;
  recommendedAction:
    | "priority_review"
    | "public_response"
    | "nurture"
    | "observe"
    | "do_not_contact";
  evidence: Array<{ evidenceId: string; excerpt: string }>;
  positiveSignals: Array<{ name: string; score: number }>;
  negativeSignals: Array<{ name: string; score: number }>;
  reasons: string[];
  confidence: number;
  ruleVersion: string;
  promptVersion: string | null;
  modelProvider: string | null;
  model: string | null;
  hardGateFailures: HardGateFailure[];
  createdAt: string;
}

export interface FinancialValueDto {
  id: string;
  candidateId: string;
  qualificationDecisionId: string;
  version: string;
  grade: QualificationGrade;
  score: number;
  currency: string;
  expectedRevenueMinor: number;
  expectedGrossProfitMinor: number;
  expectedContributionMinor: number;
  factors: {
    profitability: number;
    cashFlow: number;
    creditQuality: number;
    repeatPotential: number;
    referralPotential: number;
    closeProbability: number;
  };
  createdAt: string;
}

export interface CandidatePresentationDto {
  id: string;
  subjectKind: "organization" | "individual";
  displayName: string;
  industry: string | null;
  region: string | null;
  domain: string | null;
  status: CandidateStatus;
  updatedAt: string;
}

export interface CandidatePresentationEventDto {
  eventId: string;
  createdAt: string;
  candidateId: string;
  candidate: CandidatePresentationDto;
  qualification: QualificationDto | null;
  financialValue: FinancialValueDto | null;
  sourcePlatforms: string[];
  evidenceCount: number;
}

export interface RunPresentationDto {
  run: RunDto;
  providers: ProviderShardDto[];
  summary: ExecutiveSummaryDto;
  candidateEvents: CandidatePresentationEventDto[];
  nextAfter: string;
  hasMore: boolean;
}

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
