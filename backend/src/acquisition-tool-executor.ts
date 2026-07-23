import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AcquisitionCandidate,
  BattleCardInput,
  DiscoveryEvidence,
  DiscoveryEvidenceInput,
  FinancialValueInput,
  OutcomeEventType,
  QualificationInput
} from "./acquisition-domain.js";
import {
  AcquisitionDomainError,
  type AcquisitionActorScope,
  AcquisitionDomainService
} from "./acquisition-domain-service.js";
import {
  ACQUISITION_AGENT_TOOL_NAMES,
  type AcquisitionAgentToolExecutor,
  type AcquisitionToolExecutionInput
} from "./acquisition-pi-tools.js";

const TOOL_NAMES = new Set<string>(ACQUISITION_AGENT_TOOL_NAMES);
const GRADE_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 } as const;
const STRATEGY_VERSION = "acquisition-agent-tool.v1";

type SubjectKind = "organization" | "individual";
type Grade = keyof typeof GRADE_RANK;

export type AcquisitionToolExecutorErrorCode =
  | "ABORTED"
  | "INVALID_IDENTITY"
  | "INVALID_PAYLOAD"
  | "UNKNOWN_TOOL"
  | "SEARCH_ALL_PROVIDERS_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE"
  | "HARD_GATE_BLOCKED"
  | "EVIDENCE_REQUIRED"
  | "STALE_DECISION"
  | "CONVERSION_FAILED"
  | "REVIEW_TASK_NOT_APPROVED"
  | "TOOL_EXECUTION_FAILED";

export class AcquisitionToolExecutorError extends Error {
  constructor(public readonly code: AcquisitionToolExecutorErrorCode) {
    super(code);
    this.name = "AcquisitionToolExecutorError";
  }
}

export interface SearchPublicSourcesRequest {
  ownerId: string;
  teamId: string;
  actorId: string;
  sessionId: string;
  providerConnectionId: string;
  query: string;
  subjectKinds: SubjectKind[];
  maxResults: number;
  signal?: AbortSignal;
}

export type SearchPublicSourceSubject =
  | {
      kind: "organization";
      name: string;
      domain: string | null;
      region: string | null;
      creditCode: string | null;
      organizationId?: string | null;
    }
  | {
      kind: "individual";
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
      individualPartyId?: string | null;
    };

export interface SearchPublicSourceResult {
  sourceUrl: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
  locale: string;
  rawArtifactHash: string;
  accessStatus:
    | "indexed_summary"
    | "public_content"
    | "access_restricted";
  subject: SearchPublicSourceSubject;
}

export interface SearchPublicSourcesResponse {
  providerConnectionId: string;
  provider: string;
  requestId: string | null;
  results: SearchPublicSourceResult[];
}

/**
 * This port must resolve only connections authorized for ownerId/teamId.
 * Implementations receive one selected connection per call so that one
 * provider failure cannot hide successful results from other providers.
 */
export interface SearchPublicSourcesPort {
  search(input: SearchPublicSourcesRequest): Promise<SearchPublicSourcesResponse>;
}

export interface AcquisitionCandidateIndexEntry {
  ownerId: string;
  teamId: string;
  candidateId: string;
  dedupeKey: string;
  partyType: SubjectKind;
  indexedAt: string;
}

/**
 * The directory is an index, never an authorization source. Every candidate
 * returned by it is re-read through AcquisitionDomainService under tenant scope.
 */
export interface AcquisitionCandidateDirectoryPort {
  findByDedupeKey(
    scope: { ownerId: string; teamId: string },
    dedupeKey: string
  ): Promise<AcquisitionCandidateIndexEntry | null>;
  indexCandidate(
    entry: AcquisitionCandidateIndexEntry,
    idempotencyKey: string
  ): Promise<void>;
  listCandidates(
    scope: { ownerId: string; teamId: string },
    input: {
      subjectKinds?: SubjectKind[];
      limit: number;
    }
  ): Promise<AcquisitionCandidateIndexEntry[]>;
}

export type AcquisitionReviewTaskStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed";

export interface AcquisitionReviewTask {
  id: string;
  ownerId: string;
  teamId: string;
  actorId: string;
  sessionId: string;
  candidateId: string;
  proposedAction:
    | "public_reply"
    | "private_domain_invitation"
    | "phone_call"
    | "email"
    | "meeting"
    | "convert";
  rationale: string;
  idempotencyKey: string;
  status: AcquisitionReviewTaskStatus;
  createdAt: string;
}

/**
 * create() must implement durable idempotency on
 * ownerId/teamId/idempotencyKey. This port creates review work only; it has no
 * capability to send a message, place a call, add a friend, or convert a lead.
 */
export interface AcquisitionReviewTaskPort {
  create(
    input: Omit<AcquisitionReviewTask, "id" | "status" | "createdAt">
  ): Promise<AcquisitionReviewTask>;
  get(
    scope: { ownerId: string; teamId: string },
    reviewTaskId: string
  ): Promise<AcquisitionReviewTask | null>;
}

export interface AcquisitionResearchResult {
  summary: string;
  findings: Array<{
    label: string;
    content: string;
    evidenceIds: string[];
    confidence: number | null;
  }>;
  newEvidence?: DiscoveryEvidenceInput[];
}

export interface AcquisitionConnectionDraft {
  channel:
    | "public_reply"
    | "enterprise_wechat"
    | "phone"
    | "email"
    | "referral"
    | "meeting";
  draft: string;
  rationale: string;
}

/**
 * Optional model/rule extension point. Absence never causes optimistic
 * invention: the executor falls back to explicit conservative rules.
 */
export interface AcquisitionJudgmentPort {
  research?(input: {
    scope: AcquisitionActorScope;
    sessionId: string;
    candidate: AcquisitionCandidate;
    evidence: DiscoveryEvidence[];
    depth: "standard" | "deep";
    researchQuestions: string[];
    signal?: AbortSignal;
  }): Promise<AcquisitionResearchResult>;
  qualify?(input: {
    scope: AcquisitionActorScope;
    sessionId: string;
    candidate: AcquisitionCandidate;
    evidence: DiscoveryEvidence[];
    policyVersion: string;
    signal?: AbortSignal;
  }): Promise<{
    qualification: QualificationInput;
    financial: FinancialValueInput;
  }>;
  buildBattleCard?(input: {
    scope: AcquisitionActorScope;
    sessionId: string;
    candidate: AcquisitionCandidate;
    evidence: DiscoveryEvidence[];
    templateVersion: string;
    signal?: AbortSignal;
  }): Promise<BattleCardInput>;
  draftConnectionStrategy?(input: {
    scope: AcquisitionActorScope;
    sessionId: string;
    candidate: AcquisitionCandidate;
    evidence: DiscoveryEvidence[];
    targetRole: string;
    channels: AcquisitionConnectionDraft["channel"][];
    signal?: AbortSignal;
  }): Promise<AcquisitionConnectionDraft[]>;
}

export interface ProductionAcquisitionAgentToolExecutorOptions {
  domain: AcquisitionDomainService;
  search: SearchPublicSourcesPort;
  candidateDirectory: AcquisitionCandidateDirectoryPort;
  reviewTasks: AcquisitionReviewTaskPort;
  judgments?: AcquisitionJudgmentPort;
  now?: () => string;
}

const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

const subjectKindsSchema = z.array(
  z.enum(["organization", "individual"])
).min(1).max(2).refine(
  (values) => new Set(values).size === values.length
);

const schemas = {
  search_public_sources: z.object({
    query: z.string().trim().min(2).max(1_000),
    providerConnectionIds: z.array(z.string().trim().min(1).max(255))
      .min(1).max(10).refine(
        (values) => new Set(values).size === values.length
      ),
    subjectKinds: subjectKindsSchema,
    maxResults: z.number().int().min(1).max(100)
  }).strict(),
  get_candidate_evidence: z.object({
    candidateId: z.string().trim().min(1).max(255)
  }).strict(),
  research_candidate: z.object({
    candidateId: z.string().trim().min(1).max(255),
    depth: z.enum(["standard", "deep"]),
    researchQuestions: z.array(z.string().trim().min(2).max(500))
      .max(12).optional()
  }).strict(),
  qualify_candidate: z.object({
    candidateId: z.string().trim().min(1).max(255),
    policyVersion: z.string().trim().min(1).max(100)
  }).strict(),
  build_battle_card: z.object({
    candidateId: z.string().trim().min(1).max(255),
    templateVersion: z.string().trim().min(1).max(100).optional()
  }).strict(),
  estimate_financial_value: z.object({
    candidateId: z.string().trim().min(1).max(255),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    policyVersion: z.string().trim().min(1).max(100).optional()
  }).strict(),
  draft_connection_strategy: z.object({
    candidateId: z.string().trim().min(1).max(255),
    targetRole: z.string().trim().min(1).max(100),
    channels: z.array(z.enum([
      "public_reply",
      "enterprise_wechat",
      "phone",
      "email",
      "referral",
      "meeting"
    ])).min(1).max(6).refine(
      (values) => new Set(values).size === values.length
    )
  }).strict(),
  list_priority_candidates: z.object({
    subjectKinds: subjectKindsSchema.optional(),
    minimumGrade: z.enum(["S", "A", "B", "C", "D"]).optional(),
    limit: z.number().int().min(1).max(100)
  }).strict(),
  create_review_task: z.object({
    candidateId: z.string().trim().min(1).max(255),
    proposedAction: z.enum([
      "public_reply",
      "private_domain_invitation",
      "phone_call",
      "email",
      "meeting",
      "convert"
    ]),
    rationale: z.string().trim().min(2).max(2_000)
  }).strict(),
  record_outcome: z.object({
    candidateId: z.string().trim().min(1).max(255),
    reviewTaskId: z.string().trim().min(1).max(255),
    outcome: z.enum([
      "contacted",
      "replied",
      "qualified",
      "converted",
      "won",
      "lost",
      "do_not_contact"
    ]),
    occurredAt: z.string().datetime({ offset: true }),
    amount: z.number().finite().nonnegative().max(10_000_000_000).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
    notes: z.string().max(2_000).optional()
  }).strict().superRefine((value, context) => {
    if ((value.amount === undefined) !== (value.currency === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount and currency must be provided together"
      });
    }
  })
} as const;

const organizationSubjectSchema = z.object({
  kind: z.literal("organization"),
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(255).nullable(),
  region: z.string().trim().max(120).nullable(),
  creditCode: z.string().trim().max(50).nullable(),
  organizationId: z.string().trim().min(1).max(100).nullable().optional()
}).strict();

const individualSubjectSchema = z.object({
  kind: z.literal("individual"),
  publicActorKey: z.string().trim().min(1).max(300),
  publicDisplayName: z.string().trim().min(1).max(200),
  publicProfileUrl: httpUrl,
  sourcePlatform: z.string().trim().min(1).max(100),
  demandCategory: z.string().trim().min(1).max(100),
  demandSummary: z.string().trim().min(1).max(2_000),
  locationHint: z.string().trim().max(200),
  buyingStage: z.enum([
    "awareness",
    "problem_defined",
    "solution_research",
    "comparison",
    "purchase_ready"
  ]),
  negativeSignals: z.array(z.string().trim().min(1).max(500)).max(50),
  individualPartyId: z.string().trim().min(1).max(100).nullable().optional()
}).strict();

const searchResponseSchema = z.object({
  providerConnectionId: z.string().trim().min(1).max(255),
  provider: z.string().trim().min(1).max(100),
  requestId: z.string().trim().min(1).max(500).nullable(),
  results: z.array(z.object({
    sourceUrl: httpUrl,
    title: z.string().trim().max(500),
    snippet: z.string().trim().max(4_000),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    locale: z.string().trim().min(1).max(30),
    rawArtifactHash: z.string().regex(/^sha256:[a-f0-9]{64}$/iu),
    accessStatus: z.enum([
      "indexed_summary",
      "public_content",
      "access_restricted"
    ]),
    subject: z.discriminatedUnion("kind", [
      organizationSubjectSchema,
      individualSubjectSchema
    ])
  }).strict()).max(100)
}).strict();

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown) {
  return hash(JSON.stringify(value, (_key, nested) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
      );
    }
    return nested;
  }));
}

function childIdempotencyKey(
  parent: string,
  operation: string,
  material: unknown
) {
  return `${parent}:${operation}:${hashJson(material).slice(0, 32)}`;
}

function abortError(): AcquisitionToolExecutorError {
  return new AcquisitionToolExecutorError("ABORTED");
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function toolError(
  code: AcquisitionToolExecutorErrorCode
): AcquisitionToolExecutorError {
  return new AcquisitionToolExecutorError(code);
}

function domainErrorCode(
  error: AcquisitionDomainError
): AcquisitionToolExecutorErrorCode {
  const mapping: Record<string, AcquisitionToolExecutorErrorCode> = {
    invalid_request: "INVALID_PAYLOAD",
    resource_not_found: "RESOURCE_NOT_FOUND",
    idempotency_conflict: "IDEMPOTENCY_CONFLICT",
    invalid_state: "INVALID_STATE",
    hard_gate_blocked: "HARD_GATE_BLOCKED",
    evidence_required: "EVIDENCE_REQUIRED",
    stale_decision: "STALE_DECISION",
    conversion_failed: "CONVERSION_FAILED"
  };
  return mapping[error.code] ?? "TOOL_EXECUTION_FAILED";
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function publicRecord<T extends Record<string, unknown>>(value: T) {
  const result = structuredClone(value);
  delete result.ownerId;
  delete result.teamId;
  return result;
}

function candidateDedupeKey(subject: SearchPublicSourceSubject) {
  const naturalKey = subject.kind === "organization"
    ? subject.creditCode?.trim().toLowerCase()
      || subject.domain?.trim().toLowerCase()
      || subject.organizationId?.trim().toLowerCase()
      || `${subject.name.trim().toLowerCase()}\u0000${subject.region ?? ""}`
    : subject.publicActorKey.trim().toLowerCase()
      || subject.publicProfileUrl.trim().toLowerCase();
  return `${subject.kind}:sha256:${hash(naturalKey)}`;
}

function evidenceInput(
  response: SearchPublicSourcesResponse,
  result: SearchPublicSourceResult,
  query: string,
  rank: number
): DiscoveryEvidenceInput {
  return {
    targetType: result.subject.kind === "organization"
      ? "organization"
      : "individual_signal",
    sourcePlatform: response.provider,
    sourceTitle: result.title,
    sourceSnippet: result.snippet,
    publishedAt: result.publishedAt,
    locale: result.locale,
    rawArtifactHash: result.rawArtifactHash,
    contentHash: `sha256:${hashJson({
      sourceUrl: result.sourceUrl,
      title: result.title,
      snippet: result.snippet
    })}`,
    provenance: {
      kind: "search_result",
      provider: response.provider,
      queryText: query,
      sourceUrl: result.sourceUrl,
      resultRank: rank
    },
    accessStatus: result.accessStatus,
    supersedesEvidenceId: null
  };
}

function projectCandidate(candidate: AcquisitionCandidate) {
  return publicRecord(candidate as unknown as Record<string, unknown>);
}

function projectEvidence(evidence: DiscoveryEvidence) {
  return publicRecord(evidence as unknown as Record<string, unknown>);
}

function defaultFinancial(currency = "CNY"): FinancialValueInput {
  return {
    currency,
    predictedDealAmountMinor: 0,
    grossMarginBps: 0,
    closeProbabilityBps: 1_000,
    acquisitionCostMinor: 0,
    salesCostMinor: 0,
    serviceCostMinor: 0,
    benchmarkDealAmountMinor: 1,
    collectionDays: 90,
    creditRisk: 50,
    repeatPotential: 10,
    referralPotential: 10
  };
}

function buyingStageScore(candidate: AcquisitionCandidate) {
  if (candidate.profile.kind === "organization") return 55;
  return {
    awareness: 20,
    problem_defined: 45,
    solution_research: 60,
    comparison: 75,
    purchase_ready: 90
  }[candidate.profile.buyingStage];
}

function conservativeQualification(
  candidate: AcquisitionCandidate,
  evidence: DiscoveryEvidence[],
  policyVersion: string
): QualificationInput {
  const negativeSignals = candidate.profile.kind === "individual"
    ? candidate.profile.negativeSignals
    : [];
  const explicitRejection = negativeSignals.some((value) =>
    /(?:不需要|别联系|不要联系|拒绝|勿扰)/u.test(value)
  );
  const providers = new Set(evidence.map((item) =>
    item.provenance.kind === "search_result"
      ? item.provenance.provider
      : item.sourcePlatform
  ));
  return {
    decisionEngine: "rules",
    ruleVersion: policyVersion,
    promptVersion: null,
    modelProvider: null,
    model: null,
    dimensions: {
      demandStrength: candidate.profile.kind === "individual" ? 65 : 55,
      fit: 50,
      identityConfidence: 75,
      buyingStage: buyingStageScore(candidate),
      budgetPotential: 20,
      decisionReachability: 20,
      freshness: 70,
      evidenceDiversity: Math.min(80, providers.size * 30),
      negativeSignalRisk: explicitRejection ? 100 : 10,
      contactRisk: 35
    },
    hardGates: {
      hasOriginalSource: evidence.some((item) =>
        item.provenance.kind === "search_result"
        && Boolean(item.provenance.sourceUrl)
      ),
      identityResolved: true,
      notDoNotContact: candidate.status !== "do_not_contact",
      noExplicitRejection: !explicitRejection,
      publicDataOnly: evidence.every((item) =>
        item.accessStatus !== "user_supplied"
      ),
      evidenceFresh: evidence.length > 0,
      schemaValid: true
    },
    evidenceExcerpts: Object.fromEntries(
      evidence.map((item) => [item.id, item.sourceSnippet.slice(0, 500)])
    ),
    reasons: [
      "未配置模型判断端口，采用保守规则评分；未知预算、决策链和采购偏好不会被推断为高分。"
    ]
  };
}

function defaultBattleCard(
  evidence: DiscoveryEvidence[],
  templateVersion: string
): BattleCardInput {
  const first = evidence[0];
  if (!first) throw toolError("EVIDENCE_REQUIRED");
  return {
    sections: [
      {
        label: "公开需求证据",
        kind: "fact",
        content: first.sourceSnippet || first.sourceTitle,
        evidenceIds: [first.id],
        confidence: 1
      },
      {
        label: "现有供应商",
        kind: "unknown",
        content: "公开证据不足，需由销售或后续研究核验。",
        evidenceIds: [],
        confidence: null
      },
      {
        label: "关键决策人与采购偏好",
        kind: "unknown",
        content: "当前没有足够公开商务证据，不做个人性格或私生活推断。",
        evidenceIds: [],
        confidence: null
      }
    ],
    confidence: 0.45,
    modelProvider: "rules",
    model: "conservative-template",
    promptVersion: templateVersion
  };
}

function defaultConnectionDrafts(
  channels: AcquisitionConnectionDraft["channel"][],
  targetRole: string
): AcquisitionConnectionDraft[] {
  const drafts: Record<
    AcquisitionConnectionDraft["channel"],
    { draft: string; rationale: string }
  > = {
    public_reply: {
      draft: `您好，看到贵方公开提到相关业务需求。若方便，${targetRole}可补充当前目标与使用场景，我们可以先提供一份匹配度诊断供评估。`,
      rationale: "只基于公开需求做温和澄清，不索取私密信息。"
    },
    enterprise_wechat: {
      draft: "如您愿意进一步沟通，可由您主动选择企业微信等官方渠道；建议先确认需求范围，再安排人工顾问。",
      rationale: "由客户主动选择合规私域入口，必须经人工审核。"
    },
    phone: {
      draft: "建议人工先核验公开商务号码与联系授权，再以需求确认和诊断为开场，不直接推销或报价。",
      rationale: "这里只生成销售准备建议，不拨打电话。"
    },
    email: {
      draft: "主题：关于公开业务需求的一页诊断建议\n正文：您好，我们基于贵方公开信息整理了初步诊断。如该需求仍有效，可由您回复确认，我们再提供适配建议。",
      rationale: "只生成草稿，不发送邮件。"
    },
    referral: {
      draft: `如存在已授权的共同商务联系人，可请其先确认${targetRole}是否愿意了解诊断建议，再由人工跟进。`,
      rationale: "先征得意愿，不利用非公开关系数据。"
    },
    meeting: {
      draft: "建议由人工发起一个 20 分钟需求诊断会议邀请，议程仅包含现状、目标、数据口径与下一步。",
      rationale: "只提供会议策略草稿，不创建或发送邀请。"
    }
  };
  return channels.map((channel) => ({ channel, ...drafts[channel] }));
}

function mapOutcome(
  outcome:
    | "contacted"
    | "replied"
    | "qualified"
    | "converted"
    | "won"
    | "lost"
    | "do_not_contact"
): OutcomeEventType {
  if (outcome === "qualified") return "need_confirmed";
  if (outcome === "converted") return "private_domain_entered";
  return outcome;
}

export class ProductionAcquisitionAgentToolExecutor
implements AcquisitionAgentToolExecutor {
  private readonly domain: AcquisitionDomainService;
  private readonly search: SearchPublicSourcesPort;
  private readonly directory: AcquisitionCandidateDirectoryPort;
  private readonly reviewTasks: AcquisitionReviewTaskPort;
  private readonly judgments?: AcquisitionJudgmentPort;
  private readonly now: () => string;

  constructor(options: ProductionAcquisitionAgentToolExecutorOptions) {
    this.domain = options.domain;
    this.search = options.search;
    this.directory = options.candidateDirectory;
    this.reviewTasks = options.reviewTasks;
    this.judgments = options.judgments;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async execute(input: AcquisitionToolExecutionInput): Promise<unknown> {
    try {
      this.validateIdentity(input);
      assertNotAborted(input.signal);
      if (!TOOL_NAMES.has(input.toolName)) {
        throw toolError("UNKNOWN_TOOL");
      }
      const payload = this.parsePayload(input.toolName, input.payload);
      switch (input.toolName) {
        case "search_public_sources":
          return await this.searchPublicSources(input, payload as z.infer<
            typeof schemas.search_public_sources
          >);
        case "get_candidate_evidence":
          return await this.getCandidateEvidence(input, payload as z.infer<
            typeof schemas.get_candidate_evidence
          >);
        case "research_candidate":
          return await this.researchCandidate(input, payload as z.infer<
            typeof schemas.research_candidate
          >);
        case "qualify_candidate":
          return await this.qualifyCandidate(input, payload as z.infer<
            typeof schemas.qualify_candidate
          >);
        case "build_battle_card":
          return await this.buildBattleCard(input, payload as z.infer<
            typeof schemas.build_battle_card
          >);
        case "estimate_financial_value":
          return await this.estimateFinancialValue(input, payload as z.infer<
            typeof schemas.estimate_financial_value
          >);
        case "draft_connection_strategy":
          return await this.draftConnectionStrategy(
            input,
            payload as z.infer<typeof schemas.draft_connection_strategy>
          );
        case "list_priority_candidates":
          return await this.listPriorityCandidates(
            input,
            payload as z.infer<typeof schemas.list_priority_candidates>
          );
        case "create_review_task":
          return await this.createReviewTask(input, payload as z.infer<
            typeof schemas.create_review_task
          >);
        case "record_outcome":
          return await this.recordOutcome(input, payload as z.infer<
            typeof schemas.record_outcome
          >);
        default:
          throw toolError("UNKNOWN_TOOL");
      }
    } catch (error) {
      if (error instanceof AcquisitionToolExecutorError) throw error;
      if (isAbort(error) || input.signal?.aborted) throw abortError();
      if (error instanceof AcquisitionDomainError) {
        throw toolError(domainErrorCode(error));
      }
      throw toolError("TOOL_EXECUTION_FAILED");
    }
  }

  private validateIdentity(input: AcquisitionToolExecutionInput) {
    const values = [
      input.identity.ownerId,
      input.identity.teamId,
      input.identity.actorId,
      input.identity.sessionId,
      input.toolCallId,
      input.idempotencyKey
    ];
    if (values.some((value) =>
      typeof value !== "string" || !value.trim() || value.length > 500
    )) {
      throw toolError("INVALID_IDENTITY");
    }
  }

  private parsePayload(toolName: string, payload: Record<string, unknown>) {
    const schema = schemas[toolName as keyof typeof schemas];
    if (!schema) throw toolError("UNKNOWN_TOOL");
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw toolError("INVALID_PAYLOAD");
    return parsed.data;
  }

  private scope(input: AcquisitionToolExecutionInput): AcquisitionActorScope {
    return {
      ownerId: input.identity.ownerId,
      teamId: input.identity.teamId,
      actorId: input.identity.actorId
    };
  }

  private async searchPublicSources(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.search_public_sources>
  ) {
    assertNotAborted(input.signal);
    const requests = payload.providerConnectionIds.map(
      (providerConnectionId): SearchPublicSourcesRequest => ({
        ...input.identity,
        providerConnectionId,
        query: payload.query,
        subjectKinds: [...payload.subjectKinds],
        maxResults: payload.maxResults,
        signal: input.signal
      })
    );
    const settled = await Promise.allSettled(
      requests.map((request) => this.search.search(request))
    );
    assertNotAborted(input.signal);

    const successes: SearchPublicSourcesResponse[] = [];
    const providerFailures: Array<{
      providerConnectionId: string;
      errorCode: "SEARCH_PROVIDER_FAILED" | "SEARCH_PROVIDER_INVALID_RESPONSE";
    }> = [];
    for (let index = 0; index < settled.length; index += 1) {
      const item = settled[index]!;
      const request = requests[index]!;
      if (item.status === "rejected") {
        if (isAbort(item.reason)) throw abortError();
        providerFailures.push({
          providerConnectionId: request.providerConnectionId,
          errorCode: "SEARCH_PROVIDER_FAILED"
        });
        continue;
      }
      const parsed = searchResponseSchema.safeParse(item.value);
      if (!parsed.success
        || parsed.data.providerConnectionId !== request.providerConnectionId) {
        providerFailures.push({
          providerConnectionId: request.providerConnectionId,
          errorCode: "SEARCH_PROVIDER_INVALID_RESPONSE"
        });
        continue;
      }
      successes.push(parsed.data);
    }
    if (successes.length === 0) {
      throw toolError("SEARCH_ALL_PROVIDERS_FAILED");
    }

    const scope = this.scope(input);
    const evidence: DiscoveryEvidence[] = [];
    const candidates = new Map<string, AcquisitionCandidate>();
    let acceptedResults = 0;
    for (const response of successes) {
      for (let index = 0; index < response.results.length; index += 1) {
        if (acceptedResults >= payload.maxResults) break;
        assertNotAborted(input.signal);
        const result = response.results[index]!;
        if (!payload.subjectKinds.includes(result.subject.kind)) continue;
        const dedupeKey = candidateDedupeKey(result.subject);
        const rawEvidence = evidenceInput(
          response,
          result,
          payload.query,
          index + 1
        );
        const createdEvidence = await this.domain.appendEvidence(
          scope,
          rawEvidence,
          childIdempotencyKey(input.idempotencyKey, "evidence", {
            providerConnectionId: response.providerConnectionId,
            sourceUrl: result.sourceUrl,
            targetType: rawEvidence.targetType,
            dedupeKey
          })
        );
        evidence.push(createdEvidence);

        let entry = await this.directory.findByDedupeKey(scope, dedupeKey);
        let candidate: AcquisitionCandidate;
        if (entry) {
          candidate = await this.domain.getCandidate(scope, entry.candidateId);
          candidate = await this.domain.attachEvidenceToCandidate(
            scope,
            candidate.id,
            createdEvidence.id,
            childIdempotencyKey(input.idempotencyKey, "attach-evidence", {
              candidateId: candidate.id,
              evidenceId: createdEvidence.id
            })
          );
        } else if (result.subject.kind === "organization") {
          const stable = hash(dedupeKey).slice(0, 24);
          candidate = await this.domain.createOrganizationCandidate(
            scope,
            {
              name: result.subject.name,
              domain: result.subject.domain,
              region: result.subject.region,
              creditCode: result.subject.creditCode,
              organizationId: result.subject.organizationId
                || `public-org-${stable}`,
              tenantProspectId: `prospect-${stable}`,
              evidenceIds: [createdEvidence.id]
            },
            childIdempotencyKey(input.idempotencyKey, "candidate", {
              dedupeKey,
              partyType: "organization"
            })
          );
        } else {
          const stable = hash(dedupeKey).slice(0, 24);
          candidate = await this.domain.createIndividualCandidate(
            scope,
            {
              publicActorKey: result.subject.publicActorKey,
              publicDisplayName: result.subject.publicDisplayName,
              publicProfileUrl: result.subject.publicProfileUrl,
              sourcePlatform: result.subject.sourcePlatform,
              demandSignalId: `signal-${hash(
                `${dedupeKey}\u0000${result.sourceUrl}`
              ).slice(0, 24)}`,
              demandCategory: result.subject.demandCategory,
              demandSummary: result.subject.demandSummary,
              locationHint: result.subject.locationHint,
              buyingStage: result.subject.buyingStage,
              negativeSignals: [...result.subject.negativeSignals],
              individualPartyId: result.subject.individualPartyId
                || `public-individual-${stable}`,
              evidenceIds: [createdEvidence.id]
            },
            childIdempotencyKey(input.idempotencyKey, "candidate", {
              dedupeKey,
              partyType: "individual"
            })
          );
        }
        if (!entry) {
          entry = {
            ownerId: scope.ownerId,
            teamId: scope.teamId,
            candidateId: candidate.id,
            dedupeKey,
            partyType: candidate.partyType,
            indexedAt: this.now()
          };
          await this.directory.indexCandidate(
            entry,
            childIdempotencyKey(input.idempotencyKey, "candidate-index", {
              dedupeKey,
              candidateId: candidate.id
            })
          );
        }
        candidates.set(candidate.id, candidate);
        acceptedResults += 1;
      }
      if (acceptedResults >= payload.maxResults) break;
    }
    return {
      status: providerFailures.length > 0 ? "partial" : "succeeded",
      query: payload.query,
      providers: successes.map((item) => ({
        providerConnectionId: item.providerConnectionId,
        provider: item.provider,
        requestId: item.requestId,
        status: "succeeded"
      })),
      providerFailures,
      evidence: evidence.map(projectEvidence),
      candidates: [...candidates.values()].map(projectCandidate),
      acceptedResultCount: acceptedResults,
      outreachExecuted: false
    };
  }

  private async evidenceForCandidate(
    scope: AcquisitionActorScope,
    candidate: AcquisitionCandidate
  ) {
    return Promise.all(
      candidate.evidenceIds.map((id) => this.domain.getEvidence(scope, id))
    );
  }

  private async getCandidateEvidence(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.get_candidate_evidence>
  ) {
    const scope = this.scope(input);
    const candidate = await this.domain.getCandidate(scope, payload.candidateId);
    const evidence = await this.evidenceForCandidate(scope, candidate);
    return {
      candidate: projectCandidate(candidate),
      evidence: evidence.map(projectEvidence),
      evidenceCount: evidence.length,
      outreachExecuted: false
    };
  }

  private async researchCandidate(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.research_candidate>
  ) {
    const scope = this.scope(input);
    const candidate = await this.domain.getCandidate(scope, payload.candidateId);
    const before = await this.evidenceForCandidate(scope, candidate);
    const result = this.judgments?.research
      ? await this.judgments.research({
          scope,
          sessionId: input.identity.sessionId,
          candidate,
          evidence: before,
          depth: payload.depth,
          researchQuestions: payload.researchQuestions ?? [],
          signal: input.signal
        })
      : {
          summary: "未配置研究判断端口，仅整理现有公开证据，不生成未经证实的事实。",
          findings: before.map((item) => ({
            label: item.sourceTitle || "公开来源",
            content: item.sourceSnippet,
            evidenceIds: [item.id],
            confidence: 1
          })),
          newEvidence: []
        };
    assertNotAborted(input.signal);
    const newEvidence: DiscoveryEvidence[] = [];
    for (const raw of result.newEvidence ?? []) {
      assertNotAborted(input.signal);
      const appended = await this.domain.appendEvidence(
        scope,
        raw,
        childIdempotencyKey(input.idempotencyKey, "research-evidence", raw)
      );
      await this.domain.attachEvidenceToCandidate(
        scope,
        candidate.id,
        appended.id,
        childIdempotencyKey(input.idempotencyKey, "research-attach", {
          candidateId: candidate.id,
          evidenceId: appended.id
        })
      );
      newEvidence.push(appended);
    }
    return {
      candidateId: candidate.id,
      depth: payload.depth,
      mode: this.judgments?.research ? "judgment_port" : "conservative_rules",
      summary: result.summary,
      findings: result.findings,
      newEvidence: newEvidence.map(projectEvidence),
      newEvidenceCount: newEvidence.length,
      requiresHumanVerification: true,
      outreachExecuted: false
    };
  }

  private async qualifyCandidate(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.qualify_candidate>
  ) {
    const scope = this.scope(input);
    const candidate = await this.domain.getCandidate(scope, payload.candidateId);
    const evidence = await this.evidenceForCandidate(scope, candidate);
    const decision = this.judgments?.qualify
      ? await this.judgments.qualify({
          scope,
          sessionId: input.identity.sessionId,
          candidate,
          evidence,
          policyVersion: payload.policyVersion,
          signal: input.signal
        })
      : {
          qualification: conservativeQualification(
            candidate,
            evidence,
            payload.policyVersion
          ),
          financial: defaultFinancial()
        };
    assertNotAborted(input.signal);
    const result = await this.domain.qualifyCandidate(
      scope,
      candidate.id,
      decision.qualification,
      decision.financial,
      input.idempotencyKey
    );
    return {
      candidate: projectCandidate(result.candidate),
      qualification: publicRecord(
        result.qualification as unknown as Record<string, unknown>
      ),
      financialValue: publicRecord(
        result.financialValue as unknown as Record<string, unknown>
      ),
      mode: this.judgments?.qualify ? "judgment_port" : "conservative_rules",
      outreachExecuted: false
    };
  }

  private async buildBattleCard(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.build_battle_card>
  ) {
    const scope = this.scope(input);
    const candidate = await this.domain.getCandidate(scope, payload.candidateId);
    const evidence = await this.evidenceForCandidate(scope, candidate);
    const templateVersion = payload.templateVersion ?? "battle-card.v1";
    const cardInput = this.judgments?.buildBattleCard
      ? await this.judgments.buildBattleCard({
          scope,
          sessionId: input.identity.sessionId,
          candidate,
          evidence,
          templateVersion,
          signal: input.signal
        })
      : defaultBattleCard(evidence, templateVersion);
    assertNotAborted(input.signal);
    const card = await this.domain.createBattleCard(
      scope,
      candidate.id,
      cardInput,
      input.idempotencyKey
    );
    return {
      battleCard: publicRecord(card as unknown as Record<string, unknown>),
      mode: this.judgments?.buildBattleCard
        ? "judgment_port"
        : "conservative_rules",
      requiresHumanVerification: true,
      outreachExecuted: false
    };
  }

  private async estimateFinancialValue(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.estimate_financial_value>
  ) {
    const scope = this.scope(input);
    await this.domain.getCandidate(scope, payload.candidateId);
    const values = await this.domain.listFinancialValueDecisions(
      scope,
      payload.candidateId
    );
    const financialValue = values.at(-1);
    if (!financialValue) {
      return {
        candidateId: payload.candidateId,
        persisted: false,
        status: "insufficient_data",
        currency: payload.currency,
        policyVersion: payload.policyVersion ?? "financial-rules.v1",
        conservativeAssumption: defaultFinancial(payload.currency),
        reasons: [
          "尚无与资格决定绑定的财务价值记录，不能凭空估算客单价、毛利或回款。"
        ],
        outreachExecuted: false
      };
    }
    return {
      candidateId: payload.candidateId,
      persisted: true,
      status: "available",
      requestedCurrency: payload.currency,
      currencyMismatch: financialValue.currency !== payload.currency,
      financialValue: publicRecord(
        financialValue as unknown as Record<string, unknown>
      ),
      outreachExecuted: false
    };
  }

  private async draftConnectionStrategy(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.draft_connection_strategy>
  ) {
    const scope = this.scope(input);
    const candidate = await this.domain.getCandidate(scope, payload.candidateId);
    const evidence = await this.evidenceForCandidate(scope, candidate);
    const drafts = this.judgments?.draftConnectionStrategy
      ? await this.judgments.draftConnectionStrategy({
          scope,
          sessionId: input.identity.sessionId,
          candidate,
          evidence,
          targetRole: payload.targetRole,
          channels: payload.channels,
          signal: input.signal
        })
      : defaultConnectionDrafts(payload.channels, payload.targetRole);
    assertNotAborted(input.signal);
    return {
      candidateId: candidate.id,
      targetRole: payload.targetRole,
      drafts,
      evidenceIds: evidence.map((item) => item.id),
      mode: this.judgments?.draftConnectionStrategy
        ? "judgment_port"
        : "conservative_rules",
      requiresHumanReview: true,
      outreachExecuted: false
    };
  }

  private async listPriorityCandidates(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.list_priority_candidates>
  ) {
    const scope = this.scope(input);
    const entries = await this.directory.listCandidates(scope, {
      subjectKinds: payload.subjectKinds,
      limit: Math.min(100, payload.limit * 3)
    });
    const rows: Array<{
      candidate: AcquisitionCandidate;
      qualification: Awaited<
        ReturnType<AcquisitionDomainService["listQualificationDecisions"]>
      >[number] | null;
      financialValue: Awaited<
        ReturnType<AcquisitionDomainService["listFinancialValueDecisions"]>
      >[number] | null;
    }> = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      assertNotAborted(input.signal);
      if (seen.has(entry.candidateId)) continue;
      try {
        const candidate = await this.domain.getCandidate(
          scope,
          entry.candidateId
        );
        if (payload.subjectKinds
          && !payload.subjectKinds.includes(candidate.partyType)) {
          continue;
        }
        const qualifications = await this.domain.listQualificationDecisions(
          scope,
          candidate.id
        );
        const values = await this.domain.listFinancialValueDecisions(
          scope,
          candidate.id
        );
        const qualification = qualifications.at(-1) ?? null;
        if (payload.minimumGrade
          && (!qualification
            || GRADE_RANK[qualification.grade]
              > GRADE_RANK[payload.minimumGrade])) {
          continue;
        }
        rows.push({
          candidate,
          qualification,
          financialValue: values.at(-1) ?? null
        });
        seen.add(candidate.id);
      } catch (error) {
        if (error instanceof AcquisitionDomainError
          && error.code === "resource_not_found") {
          continue;
        }
        throw error;
      }
    }
    rows.sort((left, right) => {
      const leftGrade = left.qualification?.grade ?? "D";
      const rightGrade = right.qualification?.grade ?? "D";
      return GRADE_RANK[leftGrade] - GRADE_RANK[rightGrade]
        || (right.financialValue?.score ?? 0)
          - (left.financialValue?.score ?? 0)
        || right.candidate.updatedAt.localeCompare(left.candidate.updatedAt);
    });
    return {
      candidates: rows.slice(0, payload.limit).map((row) => ({
        candidate: projectCandidate(row.candidate),
        qualification: row.qualification
          ? publicRecord(
              row.qualification as unknown as Record<string, unknown>
            )
          : null,
        financialValue: row.financialValue
          ? publicRecord(
              row.financialValue as unknown as Record<string, unknown>
            )
          : null
      })),
      requestedLimit: payload.limit,
      outreachExecuted: false
    };
  }

  private async createReviewTask(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.create_review_task>
  ) {
    const scope = this.scope(input);
    const candidate = await this.domain.getCandidate(scope, payload.candidateId);
    const reviewTask = await this.reviewTasks.create({
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      actorId: scope.actorId,
      sessionId: input.identity.sessionId,
      candidateId: candidate.id,
      proposedAction: payload.proposedAction,
      rationale: payload.rationale,
      idempotencyKey: input.idempotencyKey
    });
    if (reviewTask.ownerId !== scope.ownerId
      || reviewTask.teamId !== scope.teamId
      || reviewTask.candidateId !== candidate.id) {
      throw toolError("TOOL_EXECUTION_FAILED");
    }
    return {
      reviewTask: publicRecord(
        reviewTask as unknown as Record<string, unknown>
      ),
      requiresHumanReview: true,
      outreachExecuted: false
    };
  }

  private async recordOutcome(
    input: AcquisitionToolExecutionInput,
    payload: z.infer<typeof schemas.record_outcome>
  ) {
    const scope = this.scope(input);
    const candidate = await this.domain.getCandidate(scope, payload.candidateId);
    const reviewTask = await this.reviewTasks.get(
      scope,
      payload.reviewTaskId
    );
    if (!reviewTask
      || reviewTask.candidateId !== candidate.id
      || !["approved", "executed"].includes(reviewTask.status)) {
      throw toolError("REVIEW_TASK_NOT_APPROVED");
    }
    const decisions = await this.domain.listQualificationDecisions(
      scope,
      candidate.id
    );
    const decision = decisions.at(-1);
    if (!decision) throw toolError("STALE_DECISION");
    const evidence = await this.evidenceForCandidate(scope, candidate);
    const providerIds = [...new Set(evidence.map((item) =>
      item.provenance.kind === "search_result"
        ? item.provenance.provider
        : item.sourcePlatform
    ))];
    const queryIds = [...new Set(evidence.flatMap((item) =>
      item.provenance.kind === "search_result"
        ? [`query:sha256:${hash(item.provenance.queryText)}`]
        : []
    ))];
    const outcome = await this.domain.recordOutcome(scope, {
      leadId: candidate.leadId,
      customerId: null,
      eventType: mapOutcome(payload.outcome),
      occurredAt: payload.occurredAt,
      amount: payload.amount === undefined
        ? null
        : {
            amountMinor: Math.round(payload.amount * 100),
            currency: payload.currency!
          },
      reasonCode: `agent_recorded_${payload.outcome}`,
      reasonText: payload.notes ?? null,
      candidateId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      attribution: {
        runId: input.identity.sessionId,
        evidenceIds: evidence.map((item) => item.id),
        providerIds,
        queryIds,
        strategyVersion: STRATEGY_VERSION,
        qualificationDecisionId: decision.id,
        decisionVersion: decision.decisionVersion,
        decisionSnapshotHash: decision.snapshotHash
      }
    });
    return {
      outcome: publicRecord(outcome as unknown as Record<string, unknown>),
      reviewedByTaskId: reviewTask.id,
      actionRecordedOnly: true,
      outreachExecuted: false
    };
  }
}
