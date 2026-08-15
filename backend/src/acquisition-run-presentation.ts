import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import {
  acquisitionCandidateIdentityResolved,
  type AcquisitionCandidate,
  type FinancialValueDecision,
  type QualificationDecision
} from "./acquisition-domain.js";
import type {
  AcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  classifyDouyinCommentIntent,
  type DouyinCommentIntentBand
} from "./acquisition-douyin-comment-ingestion.js";
import type {
  AcquisitionDouyinCommentEventRepository,
  DouyinRunCommentPresentationProjection
} from "./acquisition-douyin-comment-events.js";
import {
  AcquisitionPlanRunError,
  type AcquisitionScope
} from "./acquisition-plan-run-service.js";
import type {
  AcquisitionPlanRunRepository,
  AcquisitionRunEvent,
  AcquisitionRunStatus,
  AcquisitionShardStatus,
  AcquisitionOperationShard,
  AcquisitionRunPresentationExecution
} from "./acquisition-plan-run-repository.js";

export type AcquisitionAutomationStepId =
  | "discover_video_urls"
  | "resolve_video_ids"
  | "fetch_public_comment_samples"
  | "normalize_platform_events"
  | "aggregate_actor_signals"
  | "qualify_candidates"
  | "refresh_run_presentation";

export interface AcquisitionAutomationStep {
  id: AcquisitionAutomationStepId;
  status: "pending" | "running" | "succeeded"
    | "partial_success" | "failed" | "skipped";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  processedCount: number;
  errorCode: string | null;
  message: string;
}

interface RunPresentationCursorPayload {
  v: 1;
  endpoint: "acquisition-run-presentation";
  ownerId: string;
  teamId: string;
  actorId: string;
  runId: string;
  createdAt: string;
  eventId: string;
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
    status: AcquisitionCandidate["status"];
    version: number;
    identityResolved: boolean;
    updatedAt: string;
  };
  qualification: {
    id: string;
    candidateId: string;
    decisionVersion: string;
    decisionEngine: "model" | "rules";
    grade: "S" | "A" | "B" | "C" | "D";
    score: number;
    recommendedAction: QualificationDecision["recommendedAction"];
    evidence: QualificationDecision["evidence"];
    positiveSignals: QualificationDecision["positiveSignals"];
    negativeSignals: QualificationDecision["negativeSignals"];
    reasons: string[];
    confidence: number;
    ruleVersion: string;
    promptVersion: string | null;
    modelProvider: string | null;
    model: string | null;
    hardGateFailures: QualificationDecision["hardGateFailures"];
    createdAt: string;
  } | null;
  financialValue: {
    id: string;
    candidateId: string;
    qualificationDecisionId: string;
    version: string;
    grade: "S" | "A" | "B" | "C" | "D";
    score: number;
    currency: string;
    expectedRevenueMinor: number;
    expectedGrossProfitMinor: number;
    expectedContributionMinor: number;
    factors: FinancialValueDecision["factors"];
    createdAt: string;
  } | null;
  sourcePlatforms: string[];
  evidenceCount: number;
}

export interface AcquisitionRunPresentation {
  run: {
    id: string;
    status: AcquisitionRunStatus;
    etag: string;
    updatedAt: string;
    completedAt: string | null;
  };
  providers: Array<{
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
    discoveredVideos: number;
    commentsSampled: number;
    validDemandSignals: number;
    unresolvedActors: number;
    highPotentialSignals: number;
  };
  automationSteps: AcquisitionAutomationStep[];
  commentSignals: Array<{
    eventId: string;
    candidateId: string;
    displayName: string;
    handle: string | null;
    text: string;
    occurredAt: string;
    likeCount: number;
    replyCount: number;
    ipLabel: string | null;
    sourceUrl: string;
    intentBand: DouyinCommentIntentBand;
    reasons: string[];
    confidence: number;
    identityStatus: "resolved" | "needs_research";
    evidenceId: string;
  }>;
  candidateEvents: RunCandidatePresentationEvent[];
  nextAfter: string;
  hasMore: boolean;
}

export interface AcquisitionRunPresentationServiceOptions {
  planRunRepository: AcquisitionPlanRunRepository;
  domainRepository: AcquisitionDomainRepository;
  commentEventRepository: AcquisitionDouyinCommentEventRepository;
  cursorSecret: string;
}

interface PresentationEventRef {
  eventId: string;
  createdAt: string;
  candidateId: string;
}

const CURSOR_FIELDS = new Set([
  "v",
  "endpoint",
  "ownerId",
  "teamId",
  "actorId",
  "runId",
  "createdAt",
  "eventId"
]);

function invalidCursor(): never {
  throw new AcquisitionPlanRunError(
    400,
    "INVALID_PRESENTATION_CURSOR",
    "运行展示游标无效或与当前访问范围不匹配"
  );
}

function publicQualification(decision: QualificationDecision | null) {
  if (!decision) return null;
  return {
    id: decision.id,
    candidateId: decision.candidateId,
    decisionVersion: decision.decisionVersion,
    decisionEngine: decision.decisionEngine,
    grade: decision.grade,
    score: decision.score,
    recommendedAction: decision.recommendedAction,
    evidence: structuredClone(decision.evidence),
    positiveSignals: structuredClone(decision.positiveSignals),
    negativeSignals: structuredClone(decision.negativeSignals),
    reasons: [...decision.reasons],
    confidence: decision.confidence,
    ruleVersion: decision.ruleVersion,
    promptVersion: decision.promptVersion,
    modelProvider: decision.modelProvider,
    model: decision.model,
    hardGateFailures: [...decision.hardGateFailures],
    createdAt: decision.createdAt
  };
}

function publicFinancialValue(decision: FinancialValueDecision | null) {
  if (!decision) return null;
  return {
    id: decision.id,
    candidateId: decision.candidateId,
    qualificationDecisionId: decision.qualificationDecisionId,
    version: decision.version,
    grade: decision.grade,
    score: decision.score,
    currency: decision.currency,
    expectedRevenueMinor: decision.expectedRevenueMinor,
    expectedGrossProfitMinor: decision.expectedGrossProfitMinor,
    expectedContributionMinor: decision.expectedContributionMinor,
    factors: structuredClone(decision.factors),
    createdAt: decision.createdAt
  };
}

function publicCandidate(candidate: AcquisitionCandidate) {
  if (candidate.profile.kind === "organization") {
    return {
      id: candidate.id,
      subjectKind: candidate.profile.kind,
      displayName: candidate.profile.name,
      industry: null,
      region: candidate.profile.region,
      domain: candidate.profile.domain,
      status: candidate.status,
      version: candidate.version,
      identityResolved: acquisitionCandidateIdentityResolved(candidate),
      updatedAt: candidate.updatedAt
    };
  }
  return {
    id: candidate.id,
    subjectKind: candidate.profile.kind,
    displayName: candidate.profile.publicDisplayName,
    industry: null,
    region: candidate.profile.locationHint || null,
    domain: null,
    status: candidate.status,
    version: candidate.version,
    identityResolved: acquisitionCandidateIdentityResolved(candidate),
    updatedAt: candidate.updatedAt
  };
}

function eventOrder(
  left: Pick<PresentationEventRef, "createdAt" | "eventId">,
  right: Pick<PresentationEventRef, "createdAt" | "eventId">
) {
  return left.createdAt.localeCompare(right.createdAt)
    || left.eventId.localeCompare(right.eventId);
}

function discoveredCandidateId(event: AcquisitionRunEvent) {
  if (event.type !== "candidate.discovered") return null;
  const candidateId = event.data.candidateId;
  return typeof candidateId === "string" && candidateId.trim()
    ? candidateId
    : null;
}

const TERMINAL_RUN_STATUSES = new Set<AcquisitionRunStatus>([
  "cancelled",
  "succeeded",
  "succeeded_empty",
  "partial_success",
  "failed",
  "budget_exhausted"
]);

const TERMINAL_SHARD_STATUSES = new Set<AcquisitionShardStatus>([
  "cancelled",
  "succeeded",
  "succeeded_empty",
  "partial_success",
  "failed"
]);

const PRESENTATION_ERROR_CODES = new Set([
  "public_sample_unavailable",
  "access_restricted",
  "rate_limited",
  "video_id_unresolved",
  "source_payload_invalid",
  "no_public_comments",
  "model_output_invalid"
]);

function presentationErrorCode(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (PRESENTATION_ERROR_CODES.has(normalized)) return normalized;
  if (normalized.includes("rate_limited")) return "rate_limited";
  if (normalized.includes("access_restricted")) return "access_restricted";
  if (normalized.includes("video_id_unresolved")) return "video_id_unresolved";
  if (normalized.includes("payload_invalid")) return "source_payload_invalid";
  if (normalized.includes("model_output_invalid")) return "model_output_invalid";
  if (normalized.includes("no_public_comments")) return "no_public_comments";
  return "public_sample_unavailable";
}

function firstError(values: Array<string | null | undefined>) {
  return values.map(presentationErrorCode).find((value) => value !== null)
    ?? null;
}

function persistedLifecycleBounds(values: Array<{
  startedAt: string | null;
  completedAt: string | null;
}>) {
  const started = values.flatMap((value) =>
    value.startedAt ? [value.startedAt] : []
  ).sort();
  const completed = values.flatMap((value) =>
    value.completedAt ? [value.completedAt] : []
  ).sort();
  const startedAt = started.at(0) ?? null;
  const completedAt = values.length > 0
    && completed.length === values.length
    ? completed.at(-1)!
    : null;
  return {
    startedAt,
    completedAt,
    durationMs: startedAt && completedAt
      ? Math.max(
          0,
          new Date(completedAt).getTime() - new Date(startedAt).getTime()
        )
      : null
  };
}

function discoveryStep(
  shards: AcquisitionOperationShard[],
  providers: AcquisitionRunPresentationExecution["providers"]
): AcquisitionAutomationStep {
  const searchShards = shards.filter((shard) => shard.kind === "search");
  const searchShardIds = new Set(searchShards.map((shard) => shard.id));
  const searchProviders = providers.filter((provider) =>
    searchShardIds.has(provider.shardId)
  );
  if (searchShards.length === 0) {
    return {
      id: "discover_video_urls",
      status: "skipped",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      processedCount: 0,
      errorCode: null,
      message: "该运行没有持久化的视频发现分片"
    };
  }
  const hasActive = searchShards.some((shard) =>
    !TERMINAL_SHARD_STATUSES.has(shard.status)
  );
  const succeeded = searchProviders.filter((provider) =>
    provider.status === "succeeded"
    || provider.status === "succeeded_empty"
    || provider.status === "partial_success"
  );
  const failed = searchProviders.filter((provider) =>
    provider.status === "failed" || provider.status === "cancelled"
  );
  const status = hasActive
    ? "running"
    : succeeded.length > 0 && failed.length > 0
      ? "partial_success"
      : failed.length === searchProviders.length
        ? "failed"
        : "succeeded";
  return {
    id: "discover_video_urls",
    status,
    ...persistedLifecycleBounds(searchProviders),
    processedCount: searchProviders.reduce(
      (total, provider) => total + provider.acceptedResultCount,
      0
    ),
    errorCode: firstError(failed.map((provider) => provider.errorCode)),
    message: status === "running"
      ? "正在从已授权公开来源发现视频链接"
      : status === "partial_success"
        ? "部分来源已发现视频，另有来源未完成"
        : status === "failed"
          ? "视频链接发现未完成"
          : "已完成公开视频链接发现"
  };
}

function attemptStatus(projection: DouyinRunCommentPresentationProjection) {
  if (projection.runningAttemptCount > 0) return "running" as const;
  const hardFailureCount = projection.failedAttemptCount
    + projection.partialSuccessAttemptCount;
  const successfulCount = projection.succeededAttemptCount
    + projection.noPublicCommentsAttemptCount;
  if (hardFailureCount > 0
    && (successfulCount > 0 || projection.returnedCommentCount > 0)) {
    return "partial_success" as const;
  }
  if (hardFailureCount > 0) return "failed" as const;
  return "succeeded" as const;
}

function resolveStep(
  projection: DouyinRunCommentPresentationProjection
): AcquisitionAutomationStep {
  if (projection.fetchAttemptCount === 0) {
    return {
      id: "resolve_video_ids",
      status: "skipped",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      processedCount: 0,
      errorCode: null,
      message: "该运行没有持久化的抖音评论读取事实"
    };
  }
  const status = projection.unresolvedVideoCount === 0
    ? "succeeded"
    : projection.resolvedVideoCount > 0 ? "partial_success" : "failed";
  return {
    id: "resolve_video_ids",
    status,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    processedCount: projection.resolvedVideoCount,
    errorCode: projection.unresolvedVideoCount > 0
      ? "video_id_unresolved"
      : null,
    message: status === "succeeded"
      ? "已从公开链接解析作品 ID"
      : status === "partial_success"
        ? "部分公开链接无法解析作品 ID"
        : "公开链接无法解析作品 ID"
  };
}

function fetchStep(
  projection: DouyinRunCommentPresentationProjection
): AcquisitionAutomationStep {
  if (projection.fetchAttemptCount === 0) {
    return {
      id: "fetch_public_comment_samples",
      status: "skipped",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      processedCount: 0,
      errorCode: null,
      message: "该运行没有执行公开评论样本读取"
    };
  }
  const status = attemptStatus(projection);
  const allEmpty = projection.noPublicCommentsAttemptCount
    === projection.fetchAttemptCount;
  return {
    id: "fetch_public_comment_samples",
    status,
    startedAt: projection.attemptStartedAt,
    completedAt: projection.attemptCompletedAt,
    durationMs: projection.attemptStartedAt && projection.attemptCompletedAt
      ? Math.max(
          0,
          new Date(projection.attemptCompletedAt).getTime()
            - new Date(projection.attemptStartedAt).getTime()
        )
      : null,
    processedCount: projection.returnedCommentCount,
    errorCode: firstError(projection.errorCodes.filter((code) =>
      presentationErrorCode(code) !== "no_public_comments"
    ))
      ?? (allEmpty ? "no_public_comments" : null),
    message: status === "running"
      ? "正在读取公开视频的公开顶层评论样本"
      : status === "partial_success"
        ? "已保留成功评论样本，部分视频读取未完成"
        : status === "failed"
          ? "公开评论样本读取未完成"
          : allEmpty
            ? "已完成读取，当前没有公开评论"
            : "已完成公开顶层评论样本读取"
  };
}

function processingStep(
  id: "normalize_platform_events" | "aggregate_actor_signals",
  projection: DouyinRunCommentPresentationProjection,
  processedCount: number,
  upstreamEventCount: number
): AcquisitionAutomationStep {
  if (projection.fetchAttemptCount === 0 && upstreamEventCount === 0) {
    return {
      id,
      status: "skipped",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      processedCount: 0,
      errorCode: null,
      message: id === "normalize_platform_events"
        ? "没有评论需要标准化为平台事件"
        : "没有平台事件需要聚合同主体信号"
    };
  }
  const running = projection.runningAttemptCount > 0;
  const allEmptyOrFailed = projection.fetchAttemptCount > 0
    && projection.fetchAttemptCount === projection.failedAttemptCount
      + projection.noPublicCommentsAttemptCount;
  const incomplete = upstreamEventCount > processedCount;
  const status = running
    ? processedCount > 0 ? "running" : "pending"
    : incomplete
      ? "partial_success"
      : processedCount > 0
        ? "succeeded"
        : allEmptyOrFailed ? "skipped" : "failed";
  return {
    id,
    status,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    processedCount,
    errorCode: incomplete || status === "failed" ? "model_output_invalid" : null,
    message: id === "normalize_platform_events"
      ? status === "succeeded"
        ? "公开评论已标准化为可审计平台事件"
        : status === "partial_success"
          ? "部分平台事件仍在完成持久化处理"
          : "平台事件标准化尚未产生可展示结果"
      : status === "succeeded"
        ? "已按公开主体聚合需求信号"
        : status === "partial_success"
          ? "部分主体需求信号仍在聚合"
          : "主体需求信号聚合尚未产生可展示结果"
  };
}

function qualificationStep(
  runStatus: AcquisitionRunStatus,
  candidateCount: number,
  qualificationCount: number
): AcquisitionAutomationStep {
  if (candidateCount === 0) {
    return {
      id: "qualify_candidates",
      status: "skipped",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      processedCount: 0,
      errorCode: null,
      message: "没有已聚合候选需要资格研判"
    };
  }
  const incomplete = qualificationCount < candidateCount;
  const terminal = TERMINAL_RUN_STATUSES.has(runStatus);
  return {
    id: "qualify_candidates",
    status: incomplete
      ? terminal ? "partial_success" : "running"
      : "succeeded",
    startedAt: null,
    completedAt: null,
    durationMs: null,
    processedCount: qualificationCount,
    errorCode: incomplete && terminal ? "model_output_invalid" : null,
    message: incomplete
      ? "部分公开需求信号仍待资格研判"
      : "已完成公开需求信号资格研判"
  };
}

const EMPTY_COMMENT_PROJECTION: DouyinRunCommentPresentationProjection = {
  fetchAttemptCount: 0,
  discoveredVideoCount: 0,
  returnedCommentCount: 0,
  resolvedVideoCount: 0,
  unresolvedVideoCount: 0,
  runningAttemptCount: 0,
  succeededAttemptCount: 0,
  partialSuccessAttemptCount: 0,
  failedAttemptCount: 0,
  noPublicCommentsAttemptCount: 0,
  attemptStartedAt: null,
  attemptCompletedAt: null,
  terminalEventCount: 0,
  terminalEvidenceCount: 0,
  linkedEventCount: 0,
  ingestionEventCount: 0,
  pendingIngestionCount: 0,
  errorCodes: [],
  candidateIds: []
};

function skippedAutomationSteps(): AcquisitionAutomationStep[] {
  return [
    "discover_video_urls",
    "resolve_video_ids",
    "fetch_public_comment_samples",
    "normalize_platform_events",
    "aggregate_actor_signals",
    "qualify_candidates",
    "refresh_run_presentation"
  ].map((id) => ({
    id: id as AcquisitionAutomationStepId,
    status: "skipped",
    startedAt: null,
    completedAt: null,
    durationMs: null,
    processedCount: 0,
    errorCode: null,
    message: "该运行的不可变计划未启用抖音公开评论自动化"
  }));
}

function refreshStep(run: {
  status: AcquisitionRunStatus;
  updatedAt: string;
  completedAt: string | null;
}): AcquisitionAutomationStep {
  const terminal = TERMINAL_RUN_STATUSES.has(run.status);
  return {
    id: "refresh_run_presentation",
    status: terminal ? "succeeded" : "pending",
    startedAt: null,
    completedAt: null,
    durationMs: null,
    processedCount: terminal ? 1 : 0,
    errorCode: null,
    message: terminal
      ? "已刷新运行的持久化展示投影"
      : "等待运行产生终态展示事实"
  };
}

export class AcquisitionRunPresentationService {
  private readonly planRuns: AcquisitionPlanRunRepository;
  private readonly domain: AcquisitionDomainRepository;
  private readonly commentEvents: AcquisitionDouyinCommentEventRepository;
  private readonly cursorSecret: string;

  constructor(options: AcquisitionRunPresentationServiceOptions) {
    if (
      typeof options.cursorSecret !== "string"
      || Buffer.byteLength(options.cursorSecret, "utf8") < 32
    ) {
      throw new TypeError("cursorSecret must contain at least 32 bytes");
    }
    this.planRuns = options.planRunRepository;
    this.domain = options.domainRepository;
    this.commentEvents = options.commentEventRepository;
    this.cursorSecret = options.cursorSecret;
  }

  async get(
    scope: AcquisitionScope,
    runId: string,
    query: { after?: string; limit: number }
  ): Promise<AcquisitionRunPresentation> {
    if (
      !scope.ownerId?.trim()
      || !scope.teamId?.trim()
      || !scope.actorId?.trim()
    ) {
      throw new AcquisitionPlanRunError(
        401,
        "unauthorized",
        "需要登录后访问"
      );
    }
    if (
      !Number.isSafeInteger(query.limit)
      || query.limit < 1
      || query.limit > 100
    ) {
      throw new AcquisitionPlanRunError(
        400,
        "invalid_request",
        "limit 必须为 1 到 100 的整数"
      );
    }
    const cursor = query.after?.trim()
      ? this.decodeCursor(query.after, scope, runId)
      : null;
    const run = await this.planRuns.getRun(runId);
    if (
      !run
      || run.ownerId !== scope.ownerId
      || run.teamId !== scope.teamId
    ) {
      throw new AcquisitionPlanRunError(
        404,
        "resource_not_found",
        "运行不存在或不在当前租户范围"
      );
    }
    const planVersion = await this.planRuns.getPlanVersion(
      run.planVersionId
    );
    const commentAutomationApplies = Boolean(
      planVersion
      && planVersion.id === run.planVersionId
      && planVersion.planId === run.planId
      && planVersion.ownerId === scope.ownerId
      && planVersion.teamId === scope.teamId
      && planVersion.version === run.planVersion
      && planVersion.payloadHash === run.planSnapshotHash
      && planVersion.payload.targetPlatform === "douyin"
      && planVersion.payload.douyinPublicCommentSample?.enabled === true
    );

    const after = cursor
      ? {
          createdAt: cursor.createdAt,
          eventId: cursor.eventId
        }
      : undefined;
    const pageLimit = query.limit + 1;
    const [
      execution,
      discoveredPage,
      auditPage,
      shards,
      commentProjection,
      durableCommentSignals
    ] = await Promise.all([
      this.planRuns.getRunPresentationExecution(runId),
      this.planRuns.listRunCandidateEventsPage(runId, {
        after,
        limit: pageLimit
      }),
      this.domain.listPresentationAuditEvents(scope, {
        runId,
        after,
        limit: pageLimit
      }),
      this.planRuns.listRunShards(runId),
      commentAutomationApplies
        ? this.commentEvents.getRunCommentPresentationProjection(scope, runId)
        : Promise.resolve(structuredClone(EMPTY_COMMENT_PROJECTION)),
      commentAutomationApplies
        ? this.commentEvents.listRunCommentSignalsForPresentation(
            scope,
            runId,
            { limit: 10_001 }
          )
        : Promise.resolve([])
    ]);
    if (durableCommentSignals.length > 10_000) {
      throw new Error(
        "ACQUISITION_DOUYIN_COMMENT_PRESENTATION_FACT_LIMIT_EXCEEDED"
      );
    }
    const presentationEvents: PresentationEventRef[] = discoveredPage
      .map((event) => ({
        event,
        candidateId: discoveredCandidateId(event)
      }))
      .filter((
        item
      ): item is { event: AcquisitionRunEvent; candidateId: string } =>
        item.candidateId !== null
        && item.event.ownerId === scope.ownerId
        && item.event.teamId === scope.teamId
      )
      .map(({ event, candidateId }) => ({
        eventId: event.id,
        createdAt: event.at,
        candidateId
      }));
    presentationEvents.push(...auditPage.flatMap((audit) =>
      audit.candidateId
        ? [{
            eventId: audit.id,
            createdAt: audit.createdAt,
            candidateId: audit.candidateId
          }]
        : []
    ));
    presentationEvents.sort(eventOrder);
    const page = presentationEvents.slice(0, query.limit);
    const hasMore = presentationEvents.length > page.length;
    const commentCandidateIds = [...new Set([
      ...durableCommentSignals.flatMap((signal) =>
        signal.link.candidateId ? [signal.link.candidateId] : []
      ),
      ...commentProjection.candidateIds
    ])];
    const commentEvidenceIds = [...new Set(durableCommentSignals.flatMap(
      (signal) => signal.link.evidenceId ? [signal.link.evidenceId] : []
    ))];
    const [candidateSummary, snapshots, evidenceSnapshots] = await Promise.all([
      this.domain.getPresentationCandidateSummary(
        scope,
        runId
      ),
      this.domain.getPresentationCandidateSnapshots(
        scope,
        [...new Set([
          ...page.map((event) => event.candidateId),
          ...commentCandidateIds
        ])]
      ),
      this.domain.getPresentationEvidenceSnapshots(scope, commentEvidenceIds)
    ]);
    const candidateSnapshots = new Map(
      snapshots.map((snapshot) => [snapshot.candidate.id, snapshot])
    );
    const evidenceById = new Map(
      evidenceSnapshots.map((item) => [item.id, item])
    );
    const candidateEvents = page.flatMap((
      event
    ): RunCandidatePresentationEvent[] => {
      const snapshot = candidateSnapshots.get(event.candidateId);
      if (!snapshot) return [];
      return [{
        eventId: event.eventId,
        createdAt: event.createdAt,
        candidateId: event.candidateId,
        candidate: publicCandidate(snapshot.candidate),
        qualification: publicQualification(snapshot.qualification),
        financialValue: publicFinancialValue(snapshot.financial),
        sourcePlatforms: [...snapshot.sourcePlatforms],
        evidenceCount: snapshot.candidate.evidenceIds.length
      }];
    });
    const validatedCommentSignals = durableCommentSignals.flatMap((signal) => {
      const candidateId = signal.link.candidateId;
      const evidenceId = signal.link.evidenceId;
      if (!candidateId || !evidenceId) return [];
      const decision = classifyDouyinCommentIntent(signal.event.text);
      const candidate = candidateSnapshots.get(candidateId)?.candidate;
      const evidence = evidenceById.get(evidenceId);
      if (!candidate
        || !evidence
        || !candidate.evidenceIds.includes(evidenceId)
        || evidence.targetType !== "individual_signal"
        || evidence.provenance.kind !== "platform_public_event"
        || evidence.provenance.platformEventId
          !== signal.event.platformEventId
        || evidence.provenance.sourceUrl !== signal.event.sourceUrl) {
        return [];
      }
      return [{ signal, decision, candidate, evidenceId }];
    });
    const eligibleCommentSignals = validatedCommentSignals.filter((item) =>
      item.candidate.status !== "do_not_contact"
      && !(item.candidate.profile.kind === "individual"
        && item.candidate.profile.negativeSignals.length > 0)
      && (item.decision.band === "strong_signal"
        || item.decision.band === "potential_signal")
    );
    const commentSignals = eligibleCommentSignals.slice(0, 50).map((item) => {
      const { signal, decision, candidate, evidenceId } = item;
      return {
        eventId: signal.event.eventId,
        candidateId: candidate.id,
        displayName: signal.event.actor.displayName,
        handle: signal.event.actor.handle,
        text: signal.event.text,
        occurredAt: signal.event.occurredAt,
        likeCount: signal.latestObservation.likeCount,
        replyCount: signal.latestObservation.replyCount,
        ipLabel: signal.event.ipLabel,
        sourceUrl: signal.event.sourceUrl,
        intentBand: decision.band,
        reasons: [...decision.reasons],
        confidence: decision.confidence,
        identityStatus: acquisitionCandidateIdentityResolved(candidate)
          ? "resolved" as const
          : "needs_research" as const,
        evidenceId
      };
    });
    const qualificationCandidateIds = [...new Set([
      ...commentProjection.candidateIds,
      ...validatedCommentSignals.map((item) => item.candidate.id)
    ])];
    const normalizedEventCount = Math.max(
      commentProjection.ingestionEventCount,
      commentProjection.linkedEventCount
    );
    const upstreamEventCount = Math.max(
      commentProjection.terminalEventCount,
      commentProjection.ingestionEventCount,
      commentProjection.linkedEventCount
        + commentProjection.pendingIngestionCount
    );
    const automationSteps: AcquisitionAutomationStep[] =
      commentAutomationApplies
        ? [
            discoveryStep(shards, execution.providers),
            resolveStep(commentProjection),
            fetchStep(commentProjection),
            processingStep(
              "normalize_platform_events",
              commentProjection,
              normalizedEventCount,
              upstreamEventCount
            ),
            processingStep(
              "aggregate_actor_signals",
              commentProjection,
              commentProjection.linkedEventCount,
              upstreamEventCount
            ),
            qualificationStep(
              run.status,
              qualificationCandidateIds.length,
              qualificationCandidateIds.filter((candidateId) =>
                Boolean(candidateSnapshots.get(candidateId)?.qualification)
              ).length
            ),
            refreshStep(run)
          ]
        : skippedAutomationSteps();

    const unresolvedActorKeys = new Set(eligibleCommentSignals.flatMap(
      ({ candidate }) => {
        if (acquisitionCandidateIdentityResolved(candidate)) return [];
        return candidate.profile.kind === "individual"
          ? [candidate.profile.publicActorKey]
          : [candidate.id];
      }
    ));
    const publicProviders = execution.providers.map((provider) => ({
      shardId: provider.shardId,
      connectionId: provider.connectionId,
      providerId: provider.providerId,
      status: provider.status,
      rawResultCount: provider.rawResultCount,
      acceptedResultCount: provider.acceptedResultCount,
      duplicateResultCount: provider.duplicateResultCount,
      failedResultCount: provider.failedResultCount,
      errorCode: provider.errorCode,
      retryAfterAt: provider.retryAfterAt
    }));

    const last = page.at(-1);

    return {
      run: {
        id: run.id,
        status: run.status,
        etag: run.etag,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt
      },
      providers: publicProviders,
      summary: {
        sourcesSearched: execution.sourcesSearched,
        pagesAnalyzed: execution.pagesAnalyzed,
        ...candidateSummary,
        discoveredVideos: commentProjection.discoveredVideoCount,
        commentsSampled: commentProjection.returnedCommentCount,
        validDemandSignals: eligibleCommentSignals.length,
        unresolvedActors: unresolvedActorKeys.size,
        highPotentialSignals: eligibleCommentSignals.filter((item) =>
          item.decision.band === "strong_signal"
        ).length
      },
      automationSteps,
      commentSignals,
      candidateEvents,
      nextAfter: last
        ? this.encodeCursor({
            v: 1,
            endpoint: "acquisition-run-presentation",
            ownerId: scope.ownerId,
            teamId: scope.teamId,
            actorId: scope.actorId,
            runId,
            createdAt: last.createdAt,
            eventId: last.eventId
          })
        : query.after?.trim() ?? "",
      hasMore
    };
  }

  private encodeCursor(payload: RunPresentationCursorPayload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8")
      .toString("base64url");
    const signature = createHmac("sha256", this.cursorSecret)
      .update(body)
      .digest("base64url");
    return `${body}.${signature}`;
  }

  private decodeCursor(
    cursor: string,
    scope: AcquisitionScope,
    runId: string
  ): RunPresentationCursorPayload {
    const [body, signature, extra] = cursor.split(".");
    if (!body || !signature || extra !== undefined) invalidCursor();
    const actual = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", this.cursorSecret)
      .update(body)
      .digest();
    if (
      actual.length !== expected.length
      || !timingSafeEqual(actual, expected)
    ) {
      invalidCursor();
    }
    let value: unknown;
    try {
      value = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8")
      );
    } catch {
      invalidCursor();
    }
    if (
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.keys(value).length !== CURSOR_FIELDS.size
      || Object.keys(value).some((field) => !CURSOR_FIELDS.has(field))
    ) {
      invalidCursor();
    }
    const payload = value as Partial<RunPresentationCursorPayload>;
    if (
      payload.v !== 1
      || payload.endpoint !== "acquisition-run-presentation"
      || payload.ownerId !== scope.ownerId
      || payload.teamId !== scope.teamId
      || payload.actorId !== scope.actorId
      || payload.runId !== runId
      || typeof payload.createdAt !== "string"
      || !Number.isFinite(Date.parse(payload.createdAt))
      || typeof payload.eventId !== "string"
      || !payload.eventId
    ) {
      invalidCursor();
    }
    return payload as RunPresentationCursorPayload;
  }
}
