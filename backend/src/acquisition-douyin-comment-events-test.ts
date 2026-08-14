import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryAcquisitionDouyinCommentEventRepository,
  type AppendDouyinCommentObservationInput
} from "./acquisition-douyin-comment-events.js";

const scopeA = { ownerId: "owner-a", teamId: "team-a" };
const scopeB = { ownerId: "owner-b", teamId: "team-b" };

function observation(
  overrides: Partial<AppendDouyinCommentObservationInput> = {}
): AppendDouyinCommentObservationInput {
  return {
    scope: scopeA,
    observationId: "observation-1",
    event: {
      eventId: "event-1",
      platform: "douyin",
      eventType: "comment",
      platformEventId: "cid-1",
      videoId: "video-1",
      parentCommentId: null,
      text: "原始公开评论",
      textHash: `sha256:${"a".repeat(64)}`,
      occurredAt: "2026-08-15T01:00:00.000Z",
      capturedAt: "2026-08-15T02:00:00.000Z",
      likeCount: 2,
      replyCount: 1,
      ipLabel: "上海",
      actor: {
        displayName: "公开用户",
        handle: "public-user",
        secUid: "sec-1"
      },
      sourceUrl: "https://www.douyin.com/video/123",
      coverage: "public_top_level_sample",
      accessStatus: "public_content",
      providerVersion: "douyin-public-comment-provider-v1",
      rawArtifactHash: `sha256:${"b".repeat(64)}`
    },
    ...overrides
  };
}

test("comment events are tenant-idempotent while every capture is observed", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();

  const first = await repository.appendObservation(observation());
  const replay = await repository.appendObservation(observation({
    observationId: "observation-2",
    event: {
      ...observation().event,
      capturedAt: "2026-08-15T03:00:00.000Z",
      likeCount: 7,
      replyCount: 3
    }
  }));
  const otherTenant = await repository.appendObservation(observation({
    scope: scopeB,
    observationId: "observation-b",
    event: {
      ...observation().event,
      eventId: "event-b"
    }
  }));

  assert.equal(first.eventCreated, true);
  assert.equal(replay.eventCreated, false);
  assert.equal(replay.event.eventId, "event-1");
  assert.equal(replay.observation.likeCount, 7);
  assert.equal(otherTenant.eventCreated, true);
  assert.equal(otherTenant.event.eventId, "event-b");
});

test("changed public text is flagged without overwriting the immutable event", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  await repository.appendObservation(observation());

  const changed = await repository.appendObservation(observation({
    observationId: "observation-changed",
    event: {
      ...observation().event,
      text: "来源后来返回的文本",
      textHash: `sha256:${"c".repeat(64)}`,
      capturedAt: "2026-08-15T04:00:00.000Z",
      likeCount: 11,
      replyCount: 5
    }
  }));

  assert.equal(changed.contentChanged, true);
  assert.equal(changed.event.text, "原始公开评论");
  assert.equal(changed.event.textHash, `sha256:${"a".repeat(64)}`);
  assert.equal(changed.observation.observedTextHash, `sha256:${"c".repeat(64)}`);
});

test("run projections use the latest observation and remain tenant isolated", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  await repository.appendObservation(observation());
  await repository.linkEvent({
    scope: scopeA,
    eventId: "event-1",
    runId: "run-1",
    shardId: "shard-1",
    discoveryOperationId: null,
    candidateId: null,
    evidenceId: null
  });
  await repository.appendObservation(observation({
    observationId: "observation-2",
    event: {
      ...observation().event,
      capturedAt: "2026-08-15T03:00:00.000Z",
      likeCount: 9,
      replyCount: 4
    }
  }));

  const signals = await repository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.latestObservation.likeCount, 9);
  assert.equal(signals[0]?.latestObservation.replyCount, 4);
  assert.deepEqual(
    await repository.listRunCommentSignals(scopeB, "run-1", { limit: 50 }),
    []
  );
  assert.deepEqual(await repository.getRunCommentSummary(scopeB, "run-1"), {
    linkedEventCount: 0,
    observationCount: 0,
    fetchAttemptCount: 0,
    returnedCommentCount: 0
  });
});

test("missing platform comment ids fail closed before creating an event", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  await assert.rejects(
    repository.appendObservation(observation({
      event: { ...observation().event, platformEventId: "" }
    })),
    /ACQUISITION_DOUYIN_COMMENT_INVALID_EVENT/
  );
  assert.deepEqual(
    await repository.listRunCommentSignals(scopeA, "run-1", { limit: 50 }),
    []
  );
});

test("fetch attempts and event links have replay-safe lifecycles", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  await repository.appendObservation(observation());
  const linkInput = {
    scope: scopeA,
    eventId: "event-1",
    runId: "run-1",
    shardId: null,
    discoveryOperationId: null,
    candidateId: null,
    evidenceId: null
  };
  assert.equal((await repository.linkEvent(linkInput)).created, true);
  assert.equal((await repository.linkEvent(linkInput)).created, false);

  const start = {
    scope: scopeA,
    attemptId: "attempt-1",
    runId: "run-1",
    shardId: null,
    discoveryOperationId: null,
    sourceUrl: "https://www.douyin.com/video/123",
    videoId: "123",
    requestedCount: 20,
    startedAt: "2026-08-15T01:00:00.000Z"
  };
  assert.equal((await repository.startFetchAttempt(start)).created, true);
  assert.equal((await repository.startFetchAttempt(start)).created, false);
  const terminal = {
    status: "partial_success" as const,
    errorCode: "rate_limited",
    returnedCount: 7,
    reportedCommentCount: 30,
    pagesFetched: 1,
    completedAt: "2026-08-15T01:00:05.000Z"
  };
  await repository.finishFetchAttempt(scopeA, "attempt-1", terminal);
  await repository.finishFetchAttempt(scopeA, "attempt-1", terminal);
  await assert.rejects(
    repository.finishFetchAttempt(scopeA, "attempt-1", {
      ...terminal,
      returnedCount: 8
    }),
    /FETCH_ATTEMPT_CONFLICT/
  );
  assert.deepEqual(
    (await repository.listFetchAttempts(scopeA, "run-1"))[0],
    {
      attemptId: "attempt-1",
      runId: "run-1",
      shardId: null,
      discoveryOperationId: null,
      sourceUrl: "https://www.douyin.com/video/123",
      videoId: "123",
      requestedCount: 20,
      startedAt: "2026-08-15T01:00:00.000Z",
      ...terminal
    }
  );
  const summary = await repository.getRunCommentSummary(scopeA, "run-1");
  assert.equal(summary.linkedEventCount, 1);
  assert.equal(summary.fetchAttemptCount, 1);
  assert.equal(summary.returnedCommentCount, 7);
});

test("fetch lifecycle rejects invalid counters before mutating state", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  await assert.rejects(
    repository.startFetchAttempt({
      scope: scopeA,
      attemptId: "attempt-invalid",
      runId: null,
      shardId: null,
      discoveryOperationId: null,
      sourceUrl: "https://www.douyin.com/video/123",
      videoId: "123",
      requestedCount: -1,
      startedAt: "2026-08-15T01:00:00.000Z"
    }),
    /INVALID_FETCH_ATTEMPT/
  );
});
