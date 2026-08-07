import type { AcquisitionTaskDetail } from "./runtime-api";
export type { AcquisitionTaskDetail } from "./runtime-api";

export type AcquisitionGrade = "S" | "A" | "B" | "C" | "D";
export type AcquisitionRecommendedAction =
  | "priority_review"
  | "public_response"
  | "nurture"
  | "observe"
  | "do_not_contact";
export type AcquisitionHardGateFailure =
  | "missing_original_source"
  | "identity_unresolved"
  | "do_not_contact"
  | "explicit_rejection"
  | "non_public_or_sensitive_data"
  | "stale_evidence"
  | "schema_invalid";

export interface CandidateQualification {
  id: string;
  candidateId: string;
  decisionVersion: string;
  decisionEngine: "model" | "rules";
  grade: AcquisitionGrade;
  score: number;
  recommendedAction: AcquisitionRecommendedAction;
  evidence: Array<{ evidenceId: string; excerpt: string }>;
  positiveSignals: Array<{ name: string; score: number }>;
  negativeSignals: Array<{ name: string; score: number }>;
  reasons: string[];
  confidence: number;
  ruleVersion: string;
  promptVersion: string | null;
  modelProvider: string | null;
  model: string | null;
  hardGateFailures: AcquisitionHardGateFailure[];
  createdAt: string;
}

export interface CandidateFinancialValue {
  id: string;
  candidateId: string;
  qualificationDecisionId: string;
  version: string;
  grade: AcquisitionGrade;
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

export interface RunCandidatePresentationEvent {
  eventId: string;
  createdAt: string;
  candidateId: string;
  candidate: {
    id: string;
    subjectKind: "organization" | "individual";
    displayName: string;
    industry: string | null;
    region: string | null;
    domain: string | null;
    status: AcquisitionCandidateStatus;
    version: number;
    identityResolved: boolean;
    updatedAt: string;
  };
  qualification: CandidateQualification | null;
  financialValue: CandidateFinancialValue | null;
  sourcePlatforms: string[];
  evidenceCount: number;
}

export interface AcquisitionRunPresentation {
  run: {
    id: string;
    status:
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
    etag: string;
    updatedAt: string;
    completedAt: string | null;
  };
  providers: Array<{
    shardId: string;
    connectionId: string;
    providerId: string;
    status:
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
    rawResultCount: number;
    acceptedResultCount: number;
    duplicateResultCount: number;
    failedResultCount: number;
    errorCode: string | null;
    retryAfterAt: string | null;
  }>;
  summary: {
    sourcesSearched: number;
    pagesAnalyzed: number;
    organizationsFound: number;
    dedupedCandidates: number;
    validOpportunities: number;
    highIntent: number;
    financialEvaluatedHighIntentCount: number;
    financialPendingHighIntentCount: number;
    expectedRevenueByCurrency: Array<{
      currency: string;
      amountMinor: number;
    }>;
  };
  candidateEvents: RunCandidatePresentationEvent[];
  nextAfter: string;
  hasMore: boolean;
}

export interface RunPresentationQuery {
  after?: string;
  limit?: number;
}

export type AcquisitionCandidateStatus =
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

interface CandidateCommon {
  id: string;
  evidenceIds: string[];
  status: AcquisitionCandidateStatus;
  version: number;
  identityResolved: boolean;
  latestDecisionVersion: string | null;
  approvedDecisionVersion: string | null;
  updatedAt: string;
}

export interface OrganizationCandidate extends CandidateCommon {
  subjectKind: "organization";
  name: string;
  domain: string | null;
  region: string | null;
  creditCode: string | null;
  createdAt: string;
}

export interface IndividualCandidate extends CandidateCommon {
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

export type AcquisitionCandidate =
  | OrganizationCandidate
  | IndividualCandidate;

export interface CandidateWithEtag {
  candidate: AcquisitionCandidate;
  etag: string | null;
}

export type EvidenceProvenance =
  | {
      kind: "search_result";
      provider: string;
      providerConnectionId?: string;
      requestId?: string;
      providerRecordId?: string;
      queryText: string;
      sourceUrl: string;
      resultRank: number | null;
      sourceType?: string;
    }
  | {
      kind: "user_submitted_url";
      sourceUrl: string;
      submittedBy: string;
    }
  | {
      kind: "import_artifact_row";
      importBatchId: string;
      artifactHash: string;
      sheetName: string;
      rowNumber: number;
      sourceUrl?: string;
    };

export interface CandidateEvidence {
  id: string;
  targetType: "organization" | "individual_signal";
  sourcePlatform: string;
  sourceTitle: string;
  sourceSnippet: string;
  publishedAt: string | null;
  fetchedAt: string;
  locale: string;
  rawArtifactHash: string;
  contentHash: string;
  provenance: EvidenceProvenance;
  accessStatus:
    | "indexed_summary"
    | "public_content"
    | "user_supplied"
    | "access_restricted";
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorPageQuery {
  cursor?: string;
  limit?: number;
}

export interface BattleCardClaim {
  kind: "fact" | "inference" | "unknown";
  text: string;
  evidenceIds: string[];
  confidence: number | null;
}

export type BattleCardChannel =
  | "public_reply"
  | "wecom"
  | "phone"
  | "email"
  | "referral";

interface CandidateBattleCardCommon {
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

export interface CandidateBattleCardV1 extends CandidateBattleCardCommon {
  schemaVersion: "battle-card.v1";
  sections: Array<{
    label: string;
    kind: "fact" | "inference" | "unknown";
    content: string;
    evidenceIds?: string[];
    confidence?: number;
  }>;
  intelligence: null;
}

export interface CandidateBattleCardV2 extends CandidateBattleCardCommon {
  schemaVersion: "battle-card.v2";
  intelligence: {
    accountOverview: BattleCardClaim[];
    needAssessment: BattleCardClaim[];
    supplierHypotheses: BattleCardClaim[];
    buyingCommittee: Array<{
      role: string;
      priority: 1 | 2 | 3;
      influence: "decision_maker" | "influencer" | "user" | "gatekeeper";
      concerns: string[];
      claim: BattleCardClaim;
    }>;
    procurementPreferences: BattleCardClaim[];
    connectionStrategies: Array<{
      channel: BattleCardChannel;
      targetRole: string;
      rationale: BattleCardClaim;
      openingDraft: string;
    }>;
    roleSpecificOpeners: Array<{
      role: string;
      channel: BattleCardChannel;
      text: string;
    }>;
    doNotActions: string[];
    financialSummary: {
      decisionId: string;
      decisionVersion: string;
      grade: AcquisitionGrade;
      score: number;
      currency: string;
      expectedRevenueMinor: number;
      expectedGrossProfitMinor: number;
      expectedContributionMinor: number;
      factors: CandidateFinancialValue["factors"];
    } | null;
  };
}

export type CandidateBattleCard =
  | CandidateBattleCardV1
  | CandidateBattleCardV2;

export type CandidateReviewAction =
  | "approved"
  | "rejected"
  | "do_not_contact"
  | "needs_research"
  | "reopen";

export interface CandidateReview {
  id: string;
  candidateId: string;
  decisionVersion: string;
  action: CandidateReviewAction;
  reason: string | null;
  reviewerId: string;
  idempotencyKey: string;
  createdAt: string;
}

export type CandidateIntelligenceStage =
  | "research"
  | "qualification"
  | "battle_card";

export interface CandidateIntelligenceOperation {
  id: string;
  candidateId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  currentStage: CandidateIntelligenceStage | null;
  completedStages: CandidateIntelligenceStage[];
  skippedStages: CandidateIntelligenceStage[];
  research: {
    summary: string;
    findings: Array<{
      label: string;
      content: string;
      evidenceIds: string[];
      confidence: number | null;
    }>;
  } | null;
  qualification: {
    grade: AcquisitionGrade;
    score: number;
    hardGateFailures: string[];
    financialValueId: string;
  } | null;
  battleCardId: string | null;
  failure: {
    stage: CandidateIntelligenceStage;
    errorCode: string;
  } | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
}

export interface AcquisitionDetailApiOptions {
  cookie?: string;
  cookieSource?: () => string;
}

export interface CandidateResearch {
  id: string;
  candidateId: string;
  requestReason: string;
  budgetVersion: string;
  status:
    | "pending"
    | "running"
    | "completed"
    | "no_new_evidence"
    | "access_restricted"
    | "failed";
  newEvidenceIds: string[];
  terminationReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CandidateReviewInput {
  action: CandidateReviewAction;
  decisionVersion: string;
  reason: string | null;
}

export interface CandidateReviewResult {
  candidate: AcquisitionCandidate;
  review: CandidateReview;
  research: CandidateResearch | null;
}

export interface AcquisitionDetailApi {
  getTask(planId: string): Promise<AcquisitionTaskDetail>;
  getRunPresentation(
    runId: string,
    query?: RunPresentationQuery
  ): Promise<AcquisitionRunPresentation>;
  getCandidate(candidateId: string): Promise<CandidateWithEtag>;
  getCandidateEvidence(
    candidateId: string,
    query?: CursorPageQuery
  ): Promise<CursorPage<CandidateEvidence>>;
  getCandidateQualification(
    candidateId: string
  ): Promise<CandidateQualification | null>;
  getCandidateFinancialValue(
    candidateId: string
  ): Promise<CandidateFinancialValue | null>;
  getCandidateBattleCard(
    candidateId: string
  ): Promise<CandidateBattleCard | null>;
  getCandidateReviews(
    candidateId: string,
    query?: CursorPageQuery
  ): Promise<CursorPage<CandidateReview>>;
  getLatestIntelligenceOperation(
    candidateId: string
  ): Promise<CandidateIntelligenceOperation | null>;
  startIntelligenceOperation(
    candidateId: string,
    idempotencyKey: string
  ): Promise<CandidateIntelligenceOperation>;
  reviewCandidate(
    candidateId: string,
    input: CandidateReviewInput,
    idempotencyKey: string
  ): Promise<CandidateReviewResult>;
}

interface ErrorEnvelope {
  code?: unknown;
  message?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

function errorMessage(body: ErrorEnvelope, status: number): string {
  if (typeof body.error?.message === "string" && body.error.message.trim()) {
    return body.error.message;
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  return `请求失败（HTTP ${status}）`;
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function defaultCookieSource(): string {
  return typeof document === "undefined" ? "" : document.cookie;
}

function csrfFromCookie(cookie: string): string {
  const encoded = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("gj_csrf="))
    ?.slice("gj_csrf=".length);
  if (!encoded) throw new Error("登录会话缺少 CSRF 令牌，请重新登录");
  try {
    const decoded = decodeURIComponent(encoded);
    if (!decoded) throw new Error("empty");
    return decoded;
  } catch {
    throw new Error("CSRF 令牌格式无效，请重新登录");
  }
}

function validIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error("幂等键必须为 1 到 200 个字符");
  }
  return normalized;
}

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function createAcquisitionDetailApi(
  fetchImpl: typeof fetch = fetch,
  options: AcquisitionDetailApiOptions = {}
): AcquisitionDetailApi {
  const cookieSource = options.cookieSource
    ?? (options.cookie === undefined
      ? defaultCookieSource
      : () => options.cookie ?? "");

  async function request<T>(
    path: string,
    init: RequestInit = { method: "GET" },
    allowNotFound = false
  ): Promise<{
    body: T;
    response: Response;
  } | null> {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers.set("X-CSRF-Token", csrfFromCookie(cookieSource()));
      if (init.body !== undefined) {
        headers.set("Content-Type", "application/json");
      }
    }
    const response = await fetchImpl(path, {
      ...init,
      credentials: "same-origin",
      headers
    });
    const body = await response.json().catch(() => ({})) as T & ErrorEnvelope;
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return { body, response };
  }

  async function get<T>(path: string): Promise<T> {
    const loaded = await request<T>(path, { method: "GET" });
    if (!loaded) throw new Error("资源不存在");
    return loaded.body;
  }

  async function getNullable<T>(path: string): Promise<T | null> {
    return (await request<T>(path, { method: "GET" }, true))?.body ?? null;
  }

  async function post<T>(
    path: string,
    body: unknown,
    idempotencyKey: string
  ): Promise<T> {
    const loaded = await request<T>(path, {
      method: "POST",
      headers: {
        "Idempotency-Key": validIdempotencyKey(idempotencyKey)
      },
      body: JSON.stringify(body)
    });
    if (!loaded) throw new Error("资源不存在");
    return loaded.body;
  }

  return {
    getTask(planId: string) {
      return get<AcquisitionTaskDetail>(
        `/api/v1/acquisition/tasks/${pathSegment(planId)}`
      );
    },
    getRunPresentation(runId: string, query: RunPresentationQuery = {}) {
      return get<AcquisitionRunPresentation>(
        `/api/v1/acquisition/runs/${pathSegment(runId)}/presentation`
        + queryString({ after: query.after, limit: query.limit })
      );
    },
    async getCandidate(candidateId: string) {
      const loaded = await request<AcquisitionCandidate>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}`,
        { method: "GET" }
      );
      if (!loaded) throw new Error("候选不存在");
      return {
        candidate: loaded.body,
        etag: loaded.response.headers.get("etag")
      };
    },
    getCandidateEvidence(candidateId: string, query: CursorPageQuery = {}) {
      return get<CursorPage<CandidateEvidence>>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}/evidence`
        + queryString({ cursor: query.cursor, limit: query.limit })
      );
    },
    getCandidateQualification(candidateId: string) {
      return getNullable<CandidateQualification>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}`
        + "/qualification"
      );
    },
    getCandidateFinancialValue(candidateId: string) {
      return getNullable<CandidateFinancialValue>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}`
        + "/financial-value"
      );
    },
    getCandidateBattleCard(candidateId: string) {
      return getNullable<CandidateBattleCard>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}`
        + "/battle-card"
      );
    },
    getCandidateReviews(candidateId: string, query: CursorPageQuery = {}) {
      return get<CursorPage<CandidateReview>>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}/reviews`
        + queryString({ cursor: query.cursor, limit: query.limit })
      );
    },
    getLatestIntelligenceOperation(candidateId: string) {
      return getNullable<CandidateIntelligenceOperation>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}`
        + "/intelligence-operation"
      );
    },
    startIntelligenceOperation(candidateId: string, idempotencyKey: string) {
      return post<CandidateIntelligenceOperation>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}`
        + "/intelligence-operations",
        {},
        idempotencyKey
      );
    },
    reviewCandidate(
      candidateId: string,
      input: CandidateReviewInput,
      idempotencyKey: string
    ) {
      return post<CandidateReviewResult>(
        `/api/v1/acquisition/candidates/${pathSegment(candidateId)}/review`,
        input,
        idempotencyKey
      );
    }
  };
}
