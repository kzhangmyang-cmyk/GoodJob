import { createHash } from "node:crypto";

export interface AcquisitionScope {
  ownerId: string;
  teamId: string;
}

export interface DouyinCommentEvent {
  eventId: string;
  platform: "douyin";
  eventType: "comment";
  platformEventId: string;
  videoId: string;
  parentCommentId: null;
  text: string;
  textHash: string;
  occurredAt: string;
  capturedAt: string;
  likeCount: number;
  replyCount: number;
  ipLabel: string | null;
  actor: {
    displayName: string;
    handle: string | null;
    secUid: string | null;
  };
  sourceUrl: string;
  coverage: "public_top_level_sample";
  accessStatus: "public_content";
  providerVersion: string;
  rawArtifactHash: string;
}

export interface DouyinCommentObservation {
  observationId: string;
  eventId: string;
  capturedAt: string;
  likeCount: number;
  replyCount: number;
  observedTextHash: string;
  providerVersion: string;
  rawArtifactHash: string;
}

export interface AppendDouyinCommentObservationInput {
  scope: AcquisitionScope;
  observationId: string;
  event: DouyinCommentEvent;
}

export interface DouyinCommentEventLink {
  linkId: string;
  eventId: string;
  observationId: string;
  runId: string | null;
  shardId: string | null;
  discoveryOperationId: string | null;
  candidateId: string | null;
  evidenceId: string | null;
}

export interface LinkDouyinCommentEventInput {
  scope: AcquisitionScope;
  eventId: string;
  observationId: string;
  runId: string | null;
  shardId: string | null;
  discoveryOperationId: string | null;
  candidateId: string | null;
  evidenceId: string | null;
}

export type DouyinCommentFetchAttemptTerminalStatus =
  | "succeeded"
  | "partial_success"
  | "failed"
  | "no_public_comments";

export interface DouyinCommentFetchAttempt {
  attemptId: string;
  runId: string | null;
  shardId: string | null;
  discoveryOperationId: string | null;
  sourceUrl: string;
  videoId: string | null;
  status: "running" | DouyinCommentFetchAttemptTerminalStatus;
  errorCode: string | null;
  requestedCount: number;
  returnedCount: number;
  reportedCommentCount: number | null;
  pagesFetched: number;
  startedAt: string;
  completedAt: string | null;
}

export interface StartDouyinCommentFetchAttemptInput {
  scope: AcquisitionScope;
  attemptId: string;
  runId: string | null;
  shardId: string | null;
  discoveryOperationId: string | null;
  sourceUrl: string;
  videoId: string | null;
  requestedCount: number;
  startedAt: string;
}

export interface FinishDouyinCommentFetchAttemptInput {
  status: DouyinCommentFetchAttemptTerminalStatus;
  errorCode: string | null;
  returnedCount: number;
  reportedCommentCount: number | null;
  pagesFetched: number;
  completedAt: string;
}

export interface DouyinRunCommentSignal {
  event: DouyinCommentEvent;
  latestObservation: DouyinCommentObservation;
  link: DouyinCommentEventLink;
}

export interface DouyinRunCommentSummary {
  linkedEventCount: number;
  observationCount: number;
  fetchAttemptCount: number;
  returnedCommentCount: number;
}

export interface AcquisitionDouyinCommentEventRepository {
  appendObservation(input: AppendDouyinCommentObservationInput): Promise<{
    event: DouyinCommentEvent;
    observation: DouyinCommentObservation;
    eventCreated: boolean;
    contentChanged: boolean;
  }>;
  linkEvent(input: LinkDouyinCommentEventInput): Promise<{
    link: DouyinCommentEventLink;
    created: boolean;
  }>;
  startFetchAttempt(input: StartDouyinCommentFetchAttemptInput): Promise<{
    attempt: DouyinCommentFetchAttempt;
    created: boolean;
  }>;
  finishFetchAttempt(
    scope: AcquisitionScope,
    attemptId: string,
    terminal: FinishDouyinCommentFetchAttemptInput
  ): Promise<DouyinCommentFetchAttempt>;
  listRunCommentSignals(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ): Promise<DouyinRunCommentSignal[]>;
  getRunCommentSummary(
    scope: AcquisitionScope,
    runId: string
  ): Promise<DouyinRunCommentSummary>;
  listFetchAttempts(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ): Promise<DouyinCommentFetchAttempt[]>;
}

function cloned<T>(value: T): T {
  return structuredClone(value);
}

function scopeKey(scope: AcquisitionScope) {
  return `${scope.ownerId}\u0000${scope.teamId}`;
}

function eventKey(scope: AcquisitionScope, platformEventId: string) {
  return `${scopeKey(scope)}\u0000douyin\u0000${platformEventId}`;
}

function entityKey(scope: AcquisitionScope, id: string) {
  return `${scopeKey(scope)}\u0000${id}`;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nonEmpty(value: unknown, maximum = 255) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function nullableNonEmpty(value: unknown) {
  return value === null || nonEmpty(value);
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validInstant(value: unknown) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

export function canonicalDouyinCommentInstant(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_INSTANT");
  }
  return date.toISOString();
}

function validDigest(value: unknown) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

export function assertAppendDouyinCommentObservationInput(
  input: AppendDouyinCommentObservationInput
) {
  const event = input?.event;
  let validUrl = false;
  try {
    validUrl = Boolean(event && new URL(event.sourceUrl));
  } catch {
    validUrl = false;
  }
  if (!input
    || !nonEmpty(input.scope?.ownerId, 100)
    || !nonEmpty(input.scope?.teamId, 100)
    || !nonEmpty(input.observationId, 160)
    || !event
    || !nonEmpty(event.eventId, 160)
    || event.platform !== "douyin"
    || event.eventType !== "comment"
    || !nonEmpty(event.platformEventId)
    || !nonEmpty(event.videoId)
    || event.parentCommentId !== null
    || !nonEmpty(event.text, 10_000)
    || !validDigest(event.textHash)
    || !validInstant(event.occurredAt)
    || !validInstant(event.capturedAt)
    || !nonNegativeInteger(event.likeCount)
    || !nonNegativeInteger(event.replyCount)
    || !nullableNonEmpty(event.ipLabel)
    || !nonEmpty(event.actor?.displayName)
    || !nullableNonEmpty(event.actor?.handle)
    || !nullableNonEmpty(event.actor?.secUid)
    || !validUrl
    || event.sourceUrl.length > 4_000
    || event.coverage !== "public_top_level_sample"
    || event.accessStatus !== "public_content"
    || !nonEmpty(event.providerVersion)
    || !validDigest(event.rawArtifactHash)) {
    throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_EVENT");
  }
}

export function assertStartDouyinCommentFetchAttemptInput(
  input: StartDouyinCommentFetchAttemptInput
) {
  let validUrl = false;
  try {
    validUrl = Boolean(input && new URL(input.sourceUrl));
  } catch {
    validUrl = false;
  }
  if (!input
    || !nonEmpty(input.scope?.ownerId, 100)
    || !nonEmpty(input.scope?.teamId, 100)
    || !nonEmpty(input.attemptId, 160)
    || !nullableNonEmpty(input.runId)
    || !nullableNonEmpty(input.shardId)
    || !nullableNonEmpty(input.discoveryOperationId)
    || !validUrl
    || input.sourceUrl.length > 4_000
    || !nullableNonEmpty(input.videoId)
    || !nonNegativeInteger(input.requestedCount)
    || !validInstant(input.startedAt)) {
    throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_FETCH_ATTEMPT");
  }
}

export function assertFinishDouyinCommentFetchAttemptInput(
  input: FinishDouyinCommentFetchAttemptInput
) {
  const statuses = new Set([
    "succeeded", "partial_success", "failed", "no_public_comments"
  ]);
  if (!input
    || !statuses.has(input.status)
    || !nullableNonEmpty(input.errorCode)
    || !nonNegativeInteger(input.returnedCount)
    || (input.reportedCommentCount !== null
      && !nonNegativeInteger(input.reportedCommentCount))
    || !nonNegativeInteger(input.pagesFetched)
    || !validInstant(input.completedAt)) {
    throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_FETCH_ATTEMPT");
  }
}

export function assertLinkDouyinCommentEventInput(
  input: LinkDouyinCommentEventInput
) {
  if (!input
    || !nonEmpty(input.scope?.ownerId, 100)
    || !nonEmpty(input.scope?.teamId, 100)
    || !nonEmpty(input.eventId, 160)
    || !nonEmpty(input.observationId, 160)
    || !nullableNonEmpty(input.runId)
    || !nullableNonEmpty(input.shardId)
    || !nullableNonEmpty(input.discoveryOperationId)
    || !nullableNonEmpty(input.candidateId)
    || !nullableNonEmpty(input.evidenceId)) {
    throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_LINK");
  }
}

function deterministicLink(input: LinkDouyinCommentEventInput) {
  const identity = JSON.stringify([
    input.scope.ownerId,
    input.scope.teamId,
    input.eventId,
    input.observationId,
    input.runId,
    input.shardId,
    input.discoveryOperationId,
    input.candidateId,
    input.evidenceId
  ]);
  return `douyin-comment-link:${createHash("sha256")
    .update(identity)
    .digest("hex")}`;
}

function positiveLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_LIMIT");
  }
  return limit;
}

type Scoped<T> = { scope: AcquisitionScope; value: T };

export class InMemoryAcquisitionDouyinCommentEventRepository
implements AcquisitionDouyinCommentEventRepository {
  private readonly eventsByBoundary = new Map<string, Scoped<DouyinCommentEvent>>();
  private readonly eventsById = new Map<string, Scoped<DouyinCommentEvent>>();
  private readonly observations = new Map<string, Scoped<DouyinCommentObservation>>();
  private readonly links = new Map<string, Scoped<DouyinCommentEventLink>>();
  private readonly attempts = new Map<string, Scoped<DouyinCommentFetchAttempt>>();

  async appendObservation(input: AppendDouyinCommentObservationInput) {
    assertAppendDouyinCommentObservationInput(input);
    const boundary = eventKey(input.scope, input.event.platformEventId);
    const stored = this.eventsByBoundary.get(boundary);
    const normalizedEvent: DouyinCommentEvent = {
      ...cloned(input.event),
      occurredAt: canonicalDouyinCommentInstant(input.event.occurredAt),
      capturedAt: canonicalDouyinCommentInstant(input.event.capturedAt)
    };
    const event = stored?.value ?? normalizedEvent;
    const eventCreated = !stored;
    const eventIdKey = entityKey(input.scope, event.eventId);
    if (eventCreated) {
      if (this.eventsById.has(eventIdKey)) {
        throw new Error("ACQUISITION_DOUYIN_COMMENT_EVENT_ID_CONFLICT");
      }
    }
    const observation: DouyinCommentObservation = {
      observationId: input.observationId,
      eventId: event.eventId,
      capturedAt: normalizedEvent.capturedAt,
      likeCount: input.event.likeCount,
      replyCount: input.event.replyCount,
      observedTextHash: input.event.textHash,
      providerVersion: input.event.providerVersion,
      rawArtifactHash: input.event.rawArtifactHash
    };
    const observationKey = entityKey(input.scope, input.observationId);
    const existingObservation = this.observations.get(observationKey)?.value;
    if (existingObservation && !same(existingObservation, observation)) {
      throw new Error("ACQUISITION_DOUYIN_COMMENT_OBSERVATION_ID_CONFLICT");
    }
    if (eventCreated) {
      const scoped = { scope: cloned(input.scope), value: event };
      this.eventsByBoundary.set(boundary, scoped);
      this.eventsById.set(eventIdKey, scoped);
    }
    if (!existingObservation) {
      this.observations.set(observationKey, {
        scope: cloned(input.scope),
        value: cloned(observation)
      });
    }
    return cloned({
      event,
      observation: existingObservation ?? observation,
      eventCreated,
      contentChanged: event.textHash !== observation.observedTextHash
    });
  }

  async linkEvent(input: LinkDouyinCommentEventInput) {
    assertLinkDouyinCommentEventInput(input);
    if (!this.eventsById.has(entityKey(input.scope, input.eventId))) {
      throw new Error("ACQUISITION_DOUYIN_COMMENT_EVENT_NOT_FOUND");
    }
    const observation = this.observations.get(
      entityKey(input.scope, input.observationId)
    )?.value;
    if (!observation || observation.eventId !== input.eventId) {
      throw new Error("ACQUISITION_DOUYIN_COMMENT_OBSERVATION_NOT_FOUND");
    }
    const link: DouyinCommentEventLink = {
      linkId: deterministicLink(input),
      eventId: input.eventId,
      observationId: input.observationId,
      runId: input.runId,
      shardId: input.shardId,
      discoveryOperationId: input.discoveryOperationId,
      candidateId: input.candidateId,
      evidenceId: input.evidenceId
    };
    const key = entityKey(input.scope, link.linkId);
    const existing = this.links.get(key)?.value;
    if (existing && !same(existing, link)) {
      throw new Error("ACQUISITION_DOUYIN_COMMENT_LINK_ID_CONFLICT");
    }
    if (!existing) {
      this.links.set(key, { scope: cloned(input.scope), value: cloned(link) });
    }
    return cloned({ link: existing ?? link, created: !existing });
  }

  async startFetchAttempt(input: StartDouyinCommentFetchAttemptInput) {
    assertStartDouyinCommentFetchAttemptInput(input);
    const attempt: DouyinCommentFetchAttempt = {
      attemptId: input.attemptId,
      runId: input.runId,
      shardId: input.shardId,
      discoveryOperationId: input.discoveryOperationId,
      sourceUrl: input.sourceUrl,
      videoId: input.videoId,
      status: "running",
      errorCode: null,
      requestedCount: input.requestedCount,
      returnedCount: 0,
      reportedCommentCount: null,
      pagesFetched: 0,
      startedAt: canonicalDouyinCommentInstant(input.startedAt),
      completedAt: null
    };
    const key = entityKey(input.scope, input.attemptId);
    const existing = this.attempts.get(key)?.value;
    if (existing) {
      const immutableReplay = existing.status === "running"
        ? existing
        : { ...existing, status: "running", errorCode: null,
            returnedCount: 0, reportedCommentCount: null, pagesFetched: 0,
            completedAt: null } as DouyinCommentFetchAttempt;
      if (!same(immutableReplay, attempt)) {
        throw new Error("ACQUISITION_DOUYIN_COMMENT_FETCH_ATTEMPT_CONFLICT");
      }
      return cloned({ attempt: existing, created: false });
    }
    this.attempts.set(key, { scope: cloned(input.scope), value: cloned(attempt) });
    return cloned({ attempt, created: true });
  }

  async finishFetchAttempt(
    scope: AcquisitionScope,
    attemptId: string,
    terminal: FinishDouyinCommentFetchAttemptInput
  ) {
    assertFinishDouyinCommentFetchAttemptInput(terminal);
    const normalizedTerminal = {
      ...terminal,
      completedAt: canonicalDouyinCommentInstant(terminal.completedAt)
    };
    const key = entityKey(scope, attemptId);
    const stored = this.attempts.get(key);
    if (!stored) throw new Error("ACQUISITION_DOUYIN_COMMENT_FETCH_ATTEMPT_NOT_FOUND");
    const finished: DouyinCommentFetchAttempt = {
      ...stored.value,
      ...normalizedTerminal
    };
    if (stored.value.status !== "running") {
      if (!same(stored.value, finished)) {
        throw new Error("ACQUISITION_DOUYIN_COMMENT_FETCH_ATTEMPT_CONFLICT");
      }
      return cloned(stored.value);
    }
    stored.value = cloned(finished);
    return cloned(finished);
  }

  async listRunCommentSignals(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ) {
    const limit = positiveLimit(options.limit);
    const scopedPrefix = `${scopeKey(scope)}\u0000`;
    const snapshots = [...this.links.entries()]
      .filter(([key, item]) => key.startsWith(scopedPrefix)
        && item.value.runId === runId)
      .flatMap(([, item]) => {
        const link = item.value;
        const event = this.eventsById.get(
          entityKey(scope, link.eventId)
        )?.value;
        const latestObservation = this.observations.get(
          entityKey(scope, link.observationId)
        )?.value;
        return event && latestObservation
          && latestObservation.eventId === event.eventId
          ? [{ event, latestObservation, link }]
          : [];
      })
      .sort((left, right) =>
        right.latestObservation.capturedAt.localeCompare(
          left.latestObservation.capturedAt
        )
        || right.latestObservation.observationId.localeCompare(
          left.latestObservation.observationId
        )
        || right.link.linkId.localeCompare(left.link.linkId));
    const seenEvents = new Set<string>();
    return snapshots
      .filter((snapshot) => {
        if (seenEvents.has(snapshot.event.eventId)) return false;
        seenEvents.add(snapshot.event.eventId);
        return true;
      })
      .slice(0, limit)
      .map(cloned);
  }

  async getRunCommentSummary(scope: AcquisitionScope, runId: string) {
    const runLinks = [...this.links.values()]
      .filter((item) => same(item.scope, scope) && item.value.runId === runId)
      .map((item) => item.value);
    const linkedEventIds = new Set(runLinks.map((link) => link.eventId));
    const observationCount = new Set(
      runLinks.map((link) => link.observationId)
    ).size;
    const attempts = [...this.attempts.values()]
      .filter((item) => same(item.scope, scope) && item.value.runId === runId)
      .map((item) => item.value);
    return {
      linkedEventCount: linkedEventIds.size,
      observationCount,
      fetchAttemptCount: attempts.length,
      returnedCommentCount: attempts.reduce(
        (total, attempt) => total + attempt.returnedCount,
        0
      )
    };
  }

  async listFetchAttempts(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ) {
    const limit = positiveLimit(options.limit);
    return [...this.attempts.values()]
      .filter((item) => same(item.scope, scope) && item.value.runId === runId)
      .map((item) => cloned(item.value))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt)
        || left.attemptId.localeCompare(right.attemptId))
      .slice(0, limit);
  }
}
