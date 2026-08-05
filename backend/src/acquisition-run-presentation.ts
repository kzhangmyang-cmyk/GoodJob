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
  AcquisitionPlanRunError,
  type AcquisitionScope
} from "./acquisition-plan-run-service.js";
import type {
  AcquisitionPlanRunRepository,
  AcquisitionRunEvent,
  AcquisitionRunStatus,
  AcquisitionShardStatus
} from "./acquisition-plan-run-repository.js";

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
  };
  candidateEvents: RunCandidatePresentationEvent[];
  nextAfter: string;
  hasMore: boolean;
}

export interface AcquisitionRunPresentationServiceOptions {
  planRunRepository: AcquisitionPlanRunRepository;
  domainRepository: AcquisitionDomainRepository;
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

export class AcquisitionRunPresentationService {
  private readonly planRuns: AcquisitionPlanRunRepository;
  private readonly domain: AcquisitionDomainRepository;
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
    const [execution, discoveredPage, auditPage] = await Promise.all([
      this.planRuns.getRunPresentationExecution(runId),
      this.planRuns.listRunCandidateEventsPage(runId, {
        after,
        limit: pageLimit
      }),
      this.domain.listPresentationAuditEvents(scope, {
        runId,
        after,
        limit: pageLimit
      })
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
    const [candidateSummary, snapshots] = await Promise.all([
      this.domain.getPresentationCandidateSummary(
        scope,
        runId
      ),
      this.domain.getPresentationCandidateSnapshots(
        scope,
        [...new Set(page.map((event) => event.candidateId))]
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
        ...candidateSummary
      },
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
