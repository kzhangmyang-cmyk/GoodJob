import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AcquisitionVisualReaderRepositoryError,
  InMemoryAcquisitionVisualReaderRepository,
  type AcquisitionScope,
  type AppendVisualObservationBatchInput,
  type CreateVisualReaderSessionInput,
  type DouyinVisualCommentObservationV1,
  type VisualReaderArtifactInput,
  type VisualReaderOutcome
} from "./acquisition-visual-reader-sessions.js";

const MASTER_SECRET =
  "visual-reader-memory-test-master-secret-at-least-32-bytes";
const OWNER_SCOPE = Object.freeze({
  ownerId: "owner-visual",
  teamId: "team-visual"
});
const OTHER_SCOPE = Object.freeze({
  ownerId: "owner-other",
  teamId: "team-other"
});
const START = "2026-08-15T01:00:00.000Z";
const EXPIRES = "2026-08-15T01:02:00.000Z";

function digest(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function createInput(
  scope: AcquisitionScope = OWNER_SCOPE,
  overrides: Partial<CreateVisualReaderSessionInput> = {}
): CreateVisualReaderSessionInput {
  return {
    scope,
    sessionId: "visual-session-1",
    runId: "run-visual-1",
    planId: "plan-visual-1",
    planVersionId: "plan-version-visual-1",
    artifactUploadEnabled: true,
    limits: {
      maxVideos: 2,
      maxCommentsPerVideo: 2,
      maxScrolls: 2,
      maxOcrCalls: 2,
      maxDurationMs: 120_000
    },
    createdAt: START,
    authorizedAt: START,
    expiresAt: EXPIRES,
    ...overrides
  };
}

function observation(
  id: string,
  overrides: Partial<DouyinVisualCommentObservationV1> = {}
): DouyinVisualCommentObservationV1 {
  const visibleText = `visible text ${id}`;
  return {
    observationId: id,
    sessionId: "visual-session-1",
    sourceUrl: "https://www.douyin.com/video/123456789",
    videoId: "123456789",
    visibleText,
    textHash: digest(visibleText),
    displayName: "same visible nickname",
    visibleTimeText: "1小时前",
    likeCount: 3,
    replyCount: 0,
    platformCommentId: null,
    publicProfileUrl: null,
    secUid: null,
    extractionMethod: "dom",
    fieldConfidences: { visibleText: 0.99, displayName: 0.99 },
    viewportHash: digest(`viewport:${id}`),
    cardBounds: { x: 12, y: 24, width: 360, height: 120 },
    redactedCropHash: null,
    readerVersion: "visual-reader-test.v1",
    capturedAt: `2026-08-15T01:00:${id.endsWith("2") ? "02" : "01"}.000Z`,
    ...overrides
  };
}

function appendInput(
  entries: AppendVisualObservationBatchInput["observations"],
  overrides: Partial<AppendVisualObservationBatchInput> = {}
): AppendVisualObservationBatchInput {
  return {
    scope: OWNER_SCOPE,
    sessionId: "visual-session-1",
    observations: entries,
    usageDelta: { scrollCount: 0, ocrCallCount: 0 },
    ...overrides
  };
}

function terminalOutcome(
  status: VisualReaderOutcome["status"],
  overrides: Partial<VisualReaderOutcome> = {}
): VisualReaderOutcome {
  return {
    status,
    videoCount: 1,
    observationCount: 1,
    domObservationCount: 1,
    accessibilityObservationCount: 0,
    ocrObservationCount: 0,
    lowConfidenceObservationCount: 0,
    artifactCount: 0,
    errorCodes: [],
    ...overrides
  };
}

function artifact(
  observationId: string,
  bytes = Buffer.from("RIFF redacted WEBP comment card", "utf8")
): VisualReaderArtifactInput {
  return {
    artifactId: `artifact-${observationId}`,
    observationId,
    mediaType: "image/webp",
    plaintext: bytes,
    plaintextHash: digest(bytes),
    byteLength: bytes.byteLength,
    width: 360,
    height: 120,
    maskedRegionCount: 4,
    createdAt: START,
    expiresAt: "2026-09-14T01:00:00.000Z"
  };
}

function repository(clock = { now: START }) {
  return new InMemoryAcquisitionVisualReaderRepository({
    masterSecret: MASTER_SECRET,
    now: () => clock.now
  });
}

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof AcquisitionVisualReaderRepositoryError
    && error.code === code;
}

test("memory repository creates an exact scoped replay and isolates tenants", async () => {
  const repo = repository();
  const created = await repo.createSession(createInput());
  assert.deepEqual(created, {
    sessionId: "visual-session-1",
    runId: "run-visual-1",
    planId: "plan-visual-1",
    planVersionId: "plan-version-visual-1",
    platform: "douyin",
    coverage: "authorized_visible_top_level_sample",
    status: "created",
    artifactUploadEnabled: true,
    limits: createInput().limits,
    usage: {
      videoCount: 0,
      observationCount: 0,
      scrollCount: 0,
      ocrCallCount: 0,
      domObservationCount: 0,
      accessibilityObservationCount: 0,
      ocrObservationCount: 0,
      lowConfidenceObservationCount: 0,
      artifactCount: 0
    },
    outcome: null,
    lastErrorCode: null,
    createdAt: START,
    authorizedAt: START,
    updatedAt: START,
    expiresAt: EXPIRES,
    completedAt: null
  });
  assert.deepEqual(await repo.createSession(createInput()), created);
  await assert.rejects(
    repo.createSession(createInput(OWNER_SCOPE, { runId: "different-run" })),
    hasCode("VISUAL_READER_SESSION_CONFLICT")
  );
  assert.equal(await repo.getSession(OTHER_SCOPE, created.sessionId), null);

  const other = await repo.createSession(createInput(OTHER_SCOPE));
  assert.equal(other.sessionId, created.sessionId);
  assert.deepEqual(await repo.getSession(OTHER_SCOPE, other.sessionId), other);
});

test("memory repository derives budgets from only the selected tenant", async () => {
  const repo = repository();
  await repo.createSession(createInput());
  await repo.createSession(createInput(OTHER_SCOPE));
  const shared = observation("shared-observation");
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "owner-shared-key",
    observation: shared
  }]));
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "other-shared-key",
    observation: shared
  }], { scope: OTHER_SCOPE }));

  const accepted = await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "owner-second-key",
    observation: observation("owner-observation-2", {
      viewportHash: digest("owner-second-viewport")
    })
  }]));
  assert.equal(accepted.accepted.length, 1);
  assert.equal((await repo.getSession(
    OWNER_SCOPE,
    "visual-session-1"
  ))?.usage.observationCount, 2);
});

test("memory repository atomically derives usage and keeps same-nickname observations distinct", async () => {
  const repo = repository();
  await repo.createSession(createInput());
  const first = observation("observation-1");
  const second = observation("observation-2", {
    extractionMethod: "ocr",
    fieldConfidences: { visibleText: 0.70 },
    viewportHash: digest("a different viewport")
  });
  const result = await repo.appendObservationBatch(appendInput([
    { clientObservationKey: "client-key-1", observation: first },
    { clientObservationKey: "client-key-2", observation: second }
  ], { usageDelta: { scrollCount: 1, ocrCallCount: 1 } }));
  assert.deepEqual(result.accepted, [first, second]);
  assert.deepEqual(result.duplicates, []);

  const session = await repo.getSession(OWNER_SCOPE, "visual-session-1");
  assert.ok(session);
  assert.equal(session.status, "collecting");
  assert.deepEqual(session.usage, {
    videoCount: 1,
    observationCount: 2,
    scrollCount: 1,
    ocrCallCount: 1,
    domObservationCount: 1,
    accessibilityObservationCount: 0,
    ocrObservationCount: 1,
    lowConfidenceObservationCount: 1,
    artifactCount: 0
  });
  const stored = await repo.listRunObservations(
    OWNER_SCOPE,
    "run-visual-1",
    { limit: 10 }
  );
  assert.deepEqual(stored.map((item) => item.observationId), [
    "observation-1",
    "observation-2"
  ]);
  assert.equal(stored[0]?.displayName, stored[1]?.displayName);
});

test("memory repository converges exact duplicates without incrementing usage", async () => {
  const repo = repository();
  await repo.createSession(createInput());
  const value = observation("observation-1");
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-1",
    observation: value
  }], { usageDelta: { scrollCount: 1, ocrCallCount: 0 } }));

  const replay = await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-1",
    observation: structuredClone(value)
  }], { usageDelta: { scrollCount: 1, ocrCallCount: 1 } }));
  assert.deepEqual(replay, { accepted: [], duplicates: ["client-key-1"] });

  const dedupeByImmutableFacts = await repo.appendObservationBatch(
    appendInput([{
      clientObservationKey: "client-key-2",
      observation: { ...value, observationId: "observation-retry" }
    }])
  );
  assert.deepEqual(dedupeByImmutableFacts, {
    accepted: [],
    duplicates: ["client-key-2"]
  });
  const session = await repo.getSession(OWNER_SCOPE, "visual-session-1");
  assert.equal(session?.usage.observationCount, 1);
  assert.equal(session?.usage.scrollCount, 1);
  assert.equal(session?.usage.ocrCallCount, 0);
});

test("memory repository rejects conflicting client keys and rolls back whole batches", async () => {
  const repo = repository();
  await repo.createSession(createInput());
  const first = observation("observation-1");
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-1",
    observation: first
  }]));
  await assert.rejects(
    repo.appendObservationBatch(appendInput([{
      clientObservationKey: "client-key-1",
      observation: observation("observation-2")
    }])),
    hasCode("VISUAL_READER_CLIENT_KEY_CONFLICT")
  );

  const invalidArtifact = artifact("observation-3");
  invalidArtifact.plaintextHash = digest("not the artifact bytes");
  await assert.rejects(
    repo.appendObservationBatch(appendInput([{
      clientObservationKey: "client-key-2",
      observation: observation("observation-2")
    }, {
      clientObservationKey: "client-key-3",
      observation: observation("observation-3", {
        redactedCropHash: invalidArtifact.plaintextHash
      }),
      artifact: invalidArtifact
    }])),
    hasCode("VISUAL_READER_ARTIFACT_INVALID")
  );
  const stored = await repo.listRunObservations(
    OWNER_SCOPE,
    "run-visual-1",
    { limit: 10 }
  );
  assert.deepEqual(stored.map((item) => item.observationId), ["observation-1"]);
  assert.equal(
    (await repo.getSession(OWNER_SCOPE, "visual-session-1"))?.usage
      .observationCount,
    1
  );
});

test("serialized memory mutations do not let a rollback erase a concurrent success", async () => {
  const repo = repository();
  await repo.createSession(createInput());
  const good = repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-good",
    observation: observation("observation-1")
  }]));
  const bad = repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-bad",
    observation: observation("observation-2", {
      sessionId: "wrong-session"
    })
  }]));
  const results = await Promise.allSettled([good, bad]);
  assert.equal(results[0]?.status, "fulfilled");
  assert.equal(results[1]?.status, "rejected");
  assert.deepEqual((await repo.listRunObservations(
    OWNER_SCOPE,
    "run-visual-1",
    { limit: 10 }
  )).map((item) => item.observationId), ["observation-1"]);
});

test("memory repository enforces time, per-video, scroll, and OCR budgets", async () => {
  const clock = { now: START };
  const repo = repository(clock);
  await repo.createSession(createInput());
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-1",
    observation: observation("observation-1")
  }], { usageDelta: { scrollCount: 2, ocrCallCount: 2 } }));
  await assert.rejects(
    repo.appendObservationBatch(appendInput([{
      clientObservationKey: "client-key-2",
      observation: observation("observation-2")
    }], { usageDelta: { scrollCount: 1, ocrCallCount: 0 } })),
    hasCode("VISUAL_READER_BUDGET_EXHAUSTED")
  );
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-2",
    observation: observation("observation-2")
  }]));
  await assert.rejects(
    repo.appendObservationBatch(appendInput([{
      clientObservationKey: "client-key-3",
      observation: observation("observation-3", {
        viewportHash: digest("viewport-3")
      })
    }])),
    hasCode("VISUAL_READER_BUDGET_EXHAUSTED")
  );

  clock.now = EXPIRES;
  await assert.rejects(
    repo.appendObservationBatch(appendInput([{
      clientObservationKey: "client-key-expired",
      observation: observation("observation-expired")
    }])),
    hasCode("VISUAL_READER_SESSION_EXPIRED")
  );
});

test("memory repository completes once and rejects terminal appends", async () => {
  const clock = { now: START };
  const repo = repository(clock);
  await repo.createSession(createInput());
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-1",
    observation: observation("observation-1")
  }]));
  clock.now = "2026-08-15T01:00:30.000Z";
  const completed = await repo.completeSession(
    OWNER_SCOPE,
    "visual-session-1",
    terminalOutcome("completed")
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedAt, clock.now);
  assert.deepEqual(
    await repo.completeSession(
      OWNER_SCOPE,
      "visual-session-1",
      terminalOutcome("completed")
    ),
    completed
  );
  await assert.rejects(
    repo.completeSession(
      OWNER_SCOPE,
      "visual-session-1",
      terminalOutcome("partial_success", {
        errorCodes: ["visual_extraction_low_confidence"]
      })
    ),
    hasCode("VISUAL_READER_SESSION_CONFLICT")
  );
  await assert.rejects(
    repo.appendObservationBatch(appendInput([{
      clientObservationKey: "client-key-terminal",
      observation: observation("observation-terminal")
    }])),
    hasCode("VISUAL_READER_SESSION_TERMINAL")
  );
});

test("memory repository persists the derived expired terminal outcome", async () => {
  const clock = { now: START };
  const repo = repository(clock);
  await repo.createSession(createInput());
  clock.now = EXPIRES;
  const outcome = terminalOutcome("expired", {
    videoCount: 0,
    observationCount: 0,
    domObservationCount: 0,
    errorCodes: ["visual_reader_session_expired"]
  });
  const expired = await repo.completeSession(
    OWNER_SCOPE,
    "visual-session-1",
    outcome
  );
  assert.equal(expired.status, "expired");
  assert.deepEqual(expired.outcome, outcome);
  assert.deepEqual(await repo.completeSession(
    OWNER_SCOPE,
    "visual-session-1",
    outcome
  ), expired);
});

test("memory repository encrypts validated artifacts and makes expiry immediately unreadable", async () => {
  const clock = { now: START };
  const repo = repository(clock);
  await repo.createSession(createInput());
  const inputArtifact = artifact("observation-1");
  const value = observation("observation-1", {
    redactedCropHash: inputArtifact.plaintextHash
  });
  await repo.appendObservationBatch(appendInput([{
    clientObservationKey: "client-key-1",
    observation: value,
    artifact: inputArtifact
  }]));
  inputArtifact.plaintext.fill(0);

  const stored = await repo.getArtifact(
    OWNER_SCOPE,
    "artifact-observation-1"
  );
  assert.ok(stored);
  assert.equal(stored.mediaType, "image/webp");
  assert.deepEqual(
    stored.plaintext,
    Buffer.from("RIFF redacted WEBP comment card", "utf8")
  );
  assert.equal(await repo.getArtifact(
    OTHER_SCOPE,
    "artifact-observation-1"
  ), null);

  clock.now = inputArtifact.expiresAt;
  assert.equal(await repo.getArtifact(
    OWNER_SCOPE,
    "artifact-observation-1"
  ), null);
  assert.equal(await repo.deleteExpiredArtifacts({
    before: clock.now,
    limit: 1
  }), 1);
  assert.equal((await repo.getSession(
    OWNER_SCOPE,
    "visual-session-1"
  ))?.usage.artifactCount, 1);
  assert.equal((await repo.listRunObservations(
    OWNER_SCOPE,
    "run-visual-1",
    { limit: 10 }
  )).length, 1);
});

test("memory repository validates deterministic list limits", async () => {
  const repo = repository();
  await repo.createSession(createInput());
  for (const limit of [0, 1_001, 1.5]) {
    await assert.rejects(
      repo.listRunObservations(
        OWNER_SCOPE,
        "run-visual-1",
        { limit }
      ),
      hasCode("VISUAL_READER_INVALID_INPUT")
    );
  }
});
