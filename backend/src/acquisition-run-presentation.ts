import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import type {
  AcquisitionCandidate,
  FinancialValueDecision,
  QualificationDecision
} from "./acquisition-domain.js";
import type {
  AcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  AcquisitionPlanRunError,
  type AcquisitionScope
} from "./acquisition-plan-run-service.js";
import type {
  AcquisitionOperationShard,
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

function countValue(
  event: AcquisitionRunEvent | undefined,
  field:
    | "rawResultCount"
    | "acceptedResultCount"
    | "duplicateResultCount"
    | "failedResultCount"
) {
  const value = event?.data[field];
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

function stringValue(
  event: AcquisitionRunEvent | undefined,
  field: "errorCode" | "retryAfterAt"
) {
  const value = event?.data[field];
  return typeof value === "string" && value ? value : null;
}

function latestShardPresentation(
  shard: AcquisitionOperationShard,
  events: AcquisitionRunEvent[]
) {
  return events
    .filter((event) =>
      event.shardId === shard.id
      && [
        "shard.succeeded",
        "shard.succeeded_empty",
        "shard.partial_success",
        "shard.failed",
        "shard.cancelled"
      ].includes(event.type)
    )
    .sort((left, right) =>
      right.at.localeCompare(left.at) || right.id.localeCompare(left.id)
    )
    .at(0);
}

function isCurrentHighIntent(qualification: QualificationDecision | null) {
  return qualification?.grade === "S" || qualification?.grade === "A";
}

function isCurrentValidOpportunity(
  candidate: AcquisitionCandidate,
  qualification: QualificationDecision | null
) {
  return Boolean(
    qualification
    && ["S", "A", "B"].includes(qualification.grade)
    && qualification.hardGateFailures.length === 0
    && candidate.status !== "do_not_contact"
  );
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

    const [shards, runEvents, auditEvents] = await Promise.all([
      this.planRuns.listRunShards(runId),
      this.planRuns.listRunEvents(runId),
      this.domain.listAuditEvents(scope, null)
    ]);
    const discoveries = runEvents
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
      );
    const firstDiscoveryByCandidate = new Map<string, PresentationEventRef>();
    for (const { event, candidateId } of discoveries) {
      const ref = {
        eventId: event.id,
        createdAt: event.at,
        candidateId
      };
      const existing = firstDiscoveryByCandidate.get(candidateId);
      if (!existing || eventOrder(ref, existing) < 0) {
        firstDiscoveryByCandidate.set(candidateId, ref);
      }
    }

    const candidateSnapshots = new Map<
      string,
      {
        candidate: AcquisitionCandidate;
        qualification: QualificationDecision | null;
        financial: FinancialValueDecision | null;
        sourcePlatforms: string[];
      }
    >();
    await Promise.all([...firstDiscoveryByCandidate.keys()].map(
      async (candidateId) => {
        const candidate = await this.domain.findCandidate(scope, candidateId);
        if (!candidate) return;
        const qualification = candidate.latestDecisionId
          ? await this.domain.findQualificationDecision(
              scope,
              candidateId,
              candidate.latestDecisionId
            )
          : null;
        const financial = qualification
          ? (await this.domain.listFinancialValues(scope, candidateId))
              .filter((value) =>
                value.qualificationDecisionId === qualification.id
              )
              .sort((left, right) =>
                left.createdAt.localeCompare(right.createdAt)
                || left.id.localeCompare(right.id)
              )
              .at(-1) ?? null
          : null;
        const evidence = await Promise.all(candidate.evidenceIds.map(
          (evidenceId) => this.domain.findEvidence(scope, evidenceId)
        ));
        candidateSnapshots.set(candidateId, {
          candidate,
          qualification,
          financial,
          sourcePlatforms: [
            ...new Set(evidence
              .flatMap((item) => item?.sourcePlatform ?? [])
            )
          ].sort()
        });
      }
    ));

    const presentationEvents: PresentationEventRef[] = discoveries
      .filter(({ candidateId }) => candidateSnapshots.has(candidateId))
      .map(({ event, candidateId }) => ({
        eventId: event.id,
        createdAt: event.at,
        candidateId
      }));
    for (const audit of auditEvents) {
      if (!audit.candidateId || !candidateSnapshots.has(audit.candidateId)) {
        continue;
      }
      const discovery = firstDiscoveryByCandidate.get(audit.candidateId)!;
      const ref = {
        eventId: audit.id,
        createdAt: audit.createdAt,
        candidateId: audit.candidateId
      };
      if (eventOrder(ref, discovery) > 0) {
        presentationEvents.push(ref);
      }
    }
    presentationEvents.sort(eventOrder);
    const remaining = cursor
      ? presentationEvents.filter((event) => eventOrder(event, {
          createdAt: cursor.createdAt,
          eventId: cursor.eventId
        }) > 0)
      : presentationEvents;
    const page = remaining.slice(0, query.limit);
    const hasMore = remaining.length > page.length;
    const candidateEvents = page.map((event): RunCandidatePresentationEvent => {
      const snapshot = candidateSnapshots.get(event.candidateId)!;
      return {
        eventId: event.eventId,
        createdAt: event.createdAt,
        candidateId: event.candidateId,
        candidate: publicCandidate(snapshot.candidate),
        qualification: publicQualification(snapshot.qualification),
        financialValue: publicFinancialValue(snapshot.financial),
        sourcePlatforms: [...snapshot.sourcePlatforms],
        evidenceCount: snapshot.candidate.evidenceIds.length
      };
    });

    const sources = new Set<string>();
    for (const shard of shards) {
      if (runEvents.some((event) =>
        event.shardId === shard.id && event.type === "shard.started"
      )) {
        sources.add(
          `${shard.connection.providerId}\u0000${shard.connection.connectionId}`
        );
      }
    }
    const snapshots = [...candidateSnapshots.values()];
    const highIntent = snapshots.filter((snapshot) =>
      isCurrentHighIntent(snapshot.qualification)
    );
    const revenue = new Map<string, number>();
    for (const snapshot of highIntent) {
      if (!snapshot.financial) continue;
      revenue.set(
        snapshot.financial.currency,
        (revenue.get(snapshot.financial.currency) ?? 0)
          + snapshot.financial.expectedRevenueMinor
      );
    }
    const last = page.at(-1);

    return {
      run: {
        id: run.id,
        status: run.status,
        etag: run.etag,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt
      },
      providers: shards.map((shard) => {
        const event = latestShardPresentation(shard, runEvents);
        return {
          shardId: shard.id,
          connectionId: shard.connection.connectionId,
          providerId: shard.connection.providerId,
          status: shard.status,
          rawResultCount: countValue(event, "rawResultCount"),
          acceptedResultCount: countValue(event, "acceptedResultCount"),
          duplicateResultCount: countValue(event, "duplicateResultCount"),
          failedResultCount: countValue(event, "failedResultCount"),
          errorCode: stringValue(event, "errorCode"),
          retryAfterAt: stringValue(event, "retryAfterAt")
        };
      }),
      summary: {
        sourcesSearched: sources.size,
        pagesAnalyzed: shards.reduce(
          (total, shard) => total + shard.consumedBudget.results,
          0
        ),
        organizationsFound: snapshots.filter(
          (snapshot) => snapshot.candidate.profile.kind === "organization"
        ).length,
        dedupedCandidates: snapshots.length,
        validOpportunities: snapshots.filter((snapshot) =>
          isCurrentValidOpportunity(
            snapshot.candidate,
            snapshot.qualification
          )
        ).length,
        highIntent: highIntent.length,
        financialEvaluatedHighIntentCount: highIntent.filter(
          (snapshot) => snapshot.financial !== null
        ).length,
        financialPendingHighIntentCount: highIntent.filter(
          (snapshot) => snapshot.financial === null
        ).length,
        expectedRevenueByCurrency: [...revenue.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([currency, amountMinor]) => ({ currency, amountMinor }))
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
