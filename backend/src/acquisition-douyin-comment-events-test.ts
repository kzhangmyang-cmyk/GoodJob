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
    observationId: "observation-1",
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
  await repository.linkEvent({
    scope: scopeA,
    eventId: "event-1",
    observationId: "observation-2",
    runId: "run-1",
    shardId: "shard-1",
    discoveryOperationId: null,
    candidateId: null,
    evidenceId: null
  });

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
    observationId: "observation-1",
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
    (await repository.listFetchAttempts(scopeA, "run-1", { limit: 50 }))[0],
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

test("later runs cannot change an earlier run comment snapshot", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  await repository.appendObservation(observation());
  await repository.linkEvent({
    scope: scopeA,
    eventId: "event-1",
    observationId: "observation-1",
    runId: "run-1",
    shardId: null,
    discoveryOperationId: null,
    candidateId: null,
    evidenceId: null
  });
  await repository.appendObservation(observation({
    observationId: "observation-2",
    event: {
      ...observation().event,
      capturedAt: "2026-08-15T05:00:00.000Z",
      likeCount: 99,
      replyCount: 42
    }
  }));
  await repository.linkEvent({
    scope: scopeA,
    eventId: "event-1",
    observationId: "observation-2",
    runId: "run-2",
    shardId: null,
    discoveryOperationId: null,
    candidateId: null,
    evidenceId: null
  });

  const run1 = await repository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  );
  const run2 = await repository.listRunCommentSignals(
    scopeA,
    "run-2",
    { limit: 50 }
  );
  assert.equal(run1[0]?.latestObservation.observationId, "observation-1");
  assert.equal(run1[0]?.latestObservation.likeCount, 2);
  assert.equal(run2[0]?.latestObservation.observationId, "observation-2");
  assert.equal((await repository.getRunCommentSummary(scopeA, "run-1"))
    .observationCount, 1);
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

test("instants canonicalize to UTC milliseconds before replay comparison", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  const offset = observation({
    event: {
      ...observation().event,
      occurredAt: "2026-08-15T08:30:00.987654+08:00",
      capturedAt: "2026-08-15T09:00:00.123456+08:00"
    }
  });
  const first = await repository.appendObservation(offset);
  assert.equal(first.event.occurredAt, "2026-08-15T00:30:00.987Z");
  assert.equal(first.observation.capturedAt, "2026-08-15T01:00:00.123Z");

  const replay = await repository.appendObservation({
    ...offset,
    event: {
      ...offset.event,
      occurredAt: "2026-08-15T00:30:00.987Z",
      capturedAt: "2026-08-15T01:00:00.123Z"
    }
  });
  assert.equal(replay.eventCreated, false);
  assert.equal(replay.observation.observationId, "observation-1");

  const started = await repository.startFetchAttempt({
    scope: scopeA,
    attemptId: "attempt-offset",
    runId: "run-offset",
    shardId: null,
    discoveryOperationId: null,
    sourceUrl: "https://www.douyin.com/video/123",
    videoId: "123",
    requestedCount: 1,
    startedAt: "2026-08-15T09:00:00.123999+08:00"
  });
  assert.equal(started.attempt.startedAt, "2026-08-15T01:00:00.123Z");
});

test("observation id conflicts cannot leave a linkable event orphan", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  await repository.appendObservation(observation());
  const secondEvent = {
    ...observation().event,
    eventId: "event-2",
    platformEventId: "cid-2",
    videoId: "video-2"
  };
  await assert.rejects(
    repository.appendObservation(observation({
      observationId: "observation-1",
      event: secondEvent
    })),
    /OBSERVATION_ID_CONFLICT/
  );

  const retried = await repository.appendObservation(observation({
    observationId: "observation-2",
    event: secondEvent
  }));
  assert.equal(retried.eventCreated, true);
});

test("fetch attempt reads are deterministically bounded", async () => {
  const repository = new InMemoryAcquisitionDouyinCommentEventRepository();
  for (const [attemptId, startedAt] of [
    ["attempt-3", "2026-08-15T03:00:00.000Z"],
    ["attempt-2", "2026-08-15T02:00:00.000Z"],
    ["attempt-1", "2026-08-15T01:00:00.000Z"]
  ]) {
    await repository.startFetchAttempt({
      scope: scopeA,
      attemptId,
      runId: "run-bounded",
      shardId: null,
      discoveryOperationId: null,
      sourceUrl: "https://www.douyin.com/video/123",
      videoId: "123",
      requestedCount: 1,
      startedAt
    });
  }
  assert.deepEqual(
    (await repository.listFetchAttempts(
      scopeA,
      "run-bounded",
      { limit: 2 }
    )).map((attempt) => attempt.attemptId),
    ["attempt-1", "attempt-2"]
  );
  await assert.rejects(
    repository.listFetchAttempts(scopeA, "run-bounded", { limit: 0 }),
    /INVALID_LIMIT/
  );
});
