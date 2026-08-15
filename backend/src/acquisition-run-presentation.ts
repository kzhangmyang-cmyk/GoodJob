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
  DouyinCommentFetchAttempt
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
  AcquisitionOperationShard
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

function timeBounds(values: Array<{
  startedAt: string;
  completedAt: string | null;
}>) {
  if (values.length === 0) {
    return { startedAt: null, completedAt: null, durationMs: null };
  }
  const startedAt = values.map((value) => value.startedAt).sort().at(0)!;
  const completedValues = values.flatMap((value) =>
    value.completedAt ? [value.completedAt] : []
  ).sort();
  const completedAt = completedValues.length === values.length
    ? completedValues.at(-1)!
    : null;
  return {
    startedAt,
    completedAt,
    durationMs: completedAt
      ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime())
      : null
  };
}

function shardBounds(shards: AcquisitionOperationShard[]) {
  return timeBounds(shards.map((shard) => ({
    startedAt: shard.createdAt,
    completedAt: shard.completedAt
  })));
}

function discoveryStep(
  shards: AcquisitionOperationShard[],
  providers: AcquisitionRunPresentation["providers"]
): AcquisitionAutomationStep {
  if (shards.length === 0) {
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
  const hasActive = shards.some((shard) =>
    !TERMINAL_SHARD_STATUSES.has(shard.status)
  );
  const succeeded = providers.filter((provider) =>
    provider.status === "succeeded"
    || provider.status === "succeeded_empty"
    || provider.status === "partial_success"
  );
  const failed = providers.filter((provider) =>
    provider.status === "failed" || provider.status === "cancelled"
  );
  const status = hasActive
    ? "running"
    : succeeded.length > 0 && failed.length > 0
      ? "partial_success"
      : failed.length === providers.length
        ? "failed"
        : "succeeded";
  return {
    id: "discover_video_urls",
    status,
    ...shardBounds(shards),
    processedCount: providers.reduce(
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

function attemptStatus(attempts: DouyinCommentFetchAttempt[]) {
  const running = attempts.some((attempt) => attempt.status === "running");
  const hardFailures = attempts.filter((attempt) =>
    attempt.status === "failed"
    || attempt.status === "partial_success"
  );
  const successes = attempts.filter((attempt) =>
    attempt.status === "succeeded"
    || attempt.status === "no_public_comments"
    || (attempt.status === "partial_success" && attempt.returnedCount > 0)
  );
  if (running) return "running" as const;
  if (hardFailures.length > 0 && successes.length > 0) {
    return "partial_success" as const;
  }
  if (hardFailures.length > 0) return "failed" as const;
  return "succeeded" as const;
}

function resolveStep(attempts: DouyinCommentFetchAttempt[]): AcquisitionAutomationStep {
  if (attempts.length === 0) {
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
  const resolved = attempts.filter((attempt) => attempt.videoId !== null);
  const unresolved = attempts.filter((attempt) => attempt.videoId === null);
  const status = unresolved.length === 0
    ? "succeeded"
    : resolved.length > 0 ? "partial_success" : "failed";
  return {
    id: "resolve_video_ids",
    status,
    ...timeBounds(attempts),
    processedCount: new Set(resolved.map((attempt) => attempt.videoId)).size,
    errorCode: unresolved.length > 0 ? "video_id_unresolved" : null,
    message: status === "succeeded"
      ? "已从公开链接解析作品 ID"
      : status === "partial_success"
        ? "部分公开链接无法解析作品 ID"
        : "公开链接无法解析作品 ID"
  };
}

function fetchStep(attempts: DouyinCommentFetchAttempt[]): AcquisitionAutomationStep {
  if (attempts.length === 0) {
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
  const status = attemptStatus(attempts);
  const errors = attempts.filter((attempt) =>
    attempt.status === "failed" || attempt.status === "partial_success"
  ).map((attempt) => attempt.errorCode);
  const allEmpty = attempts.every((attempt) =>
    attempt.status === "no_public_comments"
  );
  return {
    id: "fetch_public_comment_samples",
    status,
    ...timeBounds(attempts),
    processedCount: attempts.reduce(
      (total, attempt) => total + attempt.returnedCount,
      0
    ),
    errorCode: firstError(errors) ?? (allEmpty ? "no_public_comments" : null),
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
  attempts: DouyinCommentFetchAttempt[],
  processedCount: number,
  upstreamEventCount: number
): AcquisitionAutomationStep {
  if (attempts.length === 0) {
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
  const running = attempts.some((attempt) => attempt.status === "running");
  const allEmptyOrFailed = attempts.every((attempt) =>
    attempt.status === "failed" || attempt.status === "no_public_comments"
  );
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
    ...timeBounds(attempts),
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
  attempts: DouyinCommentFetchAttempt[],
  candidateCount: number,
  qualificationCount: number
): AcquisitionAutomationStep {
  if (candidateCount === 0) {
    return {
      id: "qualify_candidates",
      status: attempts.length === 0 ? "skipped" : "skipped",
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
    ...timeBounds(attempts),
    processedCount: qualificationCount,
    errorCode: incomplete && terminal ? "model_output_invalid" : null,
    message: incomplete
      ? "部分公开需求信号仍待资格研判"
      : "已完成公开需求信号资格研判"
  };
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
    startedAt: terminal ? run.updatedAt : null,
    completedAt: terminal ? run.completedAt : null,
    durationMs: terminal && run.completedAt
      ? Math.max(
          0,
          new Date(run.completedAt).getTime() - new Date(run.updatedAt).getTime()
        )
      : null,
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
      commentSummary,
      durableCommentSignals,
      fetchAttempts
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
      this.commentEvents.getRunCommentSummary(scope, runId),
      this.commentEvents.listRunCommentSignals(scope, runId, { limit: 50 }),
      this.commentEvents.listFetchAttempts(scope, runId, { limit: 100 })
    ]);
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
      ...fetchAttempts.flatMap((attempt) =>
        attempt.terminalProjection?.candidateIds ?? []
      )
    ])];
    const [candidateSummary, snapshots] = await Promise.all([
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
      )
    ]);
    const candidateSnapshots = new Map(
      snapshots.map((snapshot) => [snapshot.candidate.id, snapshot])
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
    const commentSignals = durableCommentSignals.flatMap((signal) => {
      const candidateId = signal.link.candidateId;
      const evidenceId = signal.link.evidenceId;
      if (!candidateId || !evidenceId) return [];
      const decision = classifyDouyinCommentIntent(signal.event.text);
      const candidate = candidateSnapshots.get(candidateId)?.candidate;
      return [{
        eventId: signal.event.eventId,
        candidateId,
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
        identityStatus: candidate
          && acquisitionCandidateIdentityResolved(candidate)
          ? "resolved" as const
          : "needs_research" as const,
        evidenceId
      }];
    });
    const terminalProjections = fetchAttempts.flatMap((attempt) =>
      attempt.terminalProjection ? [attempt.terminalProjection] : []
    );
    const automationSteps: AcquisitionAutomationStep[] = [
      discoveryStep(shards, execution.providers),
      resolveStep(fetchAttempts),
      fetchStep(fetchAttempts),
      processingStep(
        "normalize_platform_events",
        fetchAttempts,
        commentSummary.linkedEventCount,
        terminalProjections.reduce(
          (total, projection) => total + projection.eventCount,
          0
        )
      ),
      processingStep(
        "aggregate_actor_signals",
        fetchAttempts,
        commentSummary.validDemandSignalCount,
        commentSummary.validDemandSignalCount
      ),
      qualificationStep(
        run.status,
        fetchAttempts,
        new Set(commentCandidateIds).size,
        new Set(commentCandidateIds.filter((candidateId) =>
          Boolean(candidateSnapshots.get(candidateId)?.qualification)
        )).size
      ),
      refreshStep(run)
    ];

    const last = page.at(-1);

    return {
      run: {
        id: run.id,
        status: run.status,
        etag: run.etag,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt
      },
      providers: execution.providers,
      summary: {
        sourcesSearched: execution.sourcesSearched,
        pagesAnalyzed: execution.pagesAnalyzed,
        ...candidateSummary,
        discoveredVideos: commentSummary.discoveredVideoCount,
        commentsSampled: commentSummary.returnedCommentCount,
        validDemandSignals: commentSummary.validDemandSignalCount,
        unresolvedActors: commentSummary.unresolvedActorCount,
        highPotentialSignals: commentSummary.strongSignalCount
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
