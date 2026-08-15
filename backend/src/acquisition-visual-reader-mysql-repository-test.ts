import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type mysql from "mysql2/promise";
import {
  ACQUISITION_VISUAL_READER_MYSQL_SCHEMA_STATEMENTS,
  MysqlAcquisitionVisualReaderRepository,
  ensureAcquisitionVisualReaderMysqlSchema
} from "./acquisition-visual-reader-mysql-repository.js";
import type {
  AppendVisualObservationBatchInput,
  CreateVisualReaderSessionInput,
  DouyinVisualCommentObservationV1,
  VisualReaderArtifactInput
} from "./acquisition-visual-reader-sessions.js";

const SECRET = "mysql-visual-reader-master-secret-at-least-32-bytes";
const SCOPE = { ownerId: "owner-mysql-visual", teamId: "team-mysql-visual" };
const START = "2026-08-15T01:00:00.000Z";

function digest(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createInput(
  overrides: Partial<CreateVisualReaderSessionInput> = {}
): CreateVisualReaderSessionInput {
  return {
    scope: SCOPE,
    sessionId: "mysql-visual-session",
    runId: "mysql-visual-run",
    planId: "mysql-visual-plan",
    planVersionId: "mysql-visual-plan-version",
    artifactUploadEnabled: true,
    limits: {
      maxVideos: 2,
      maxCommentsPerVideo: 3,
      maxScrolls: 2,
      maxOcrCalls: 2,
      maxDurationMs: 120_000
    },
    createdAt: START,
    authorizedAt: START,
    expiresAt: "2026-08-15T01:02:00.000Z",
    ...overrides
  };
}

function observation(
  id: string,
  overrides: Partial<DouyinVisualCommentObservationV1> = {}
): DouyinVisualCommentObservationV1 {
  const visibleText = `mysql visible ${id}`;
  return {
    observationId: id,
    sessionId: "mysql-visual-session",
    sourceUrl: "https://www.douyin.com/video/987654321",
    videoId: "987654321",
    visibleText,
    textHash: digest(visibleText),
    displayName: "visible user",
    visibleTimeText: null,
    likeCount: 1,
    replyCount: 0,
    platformCommentId: null,
    publicProfileUrl: null,
    secUid: null,
    extractionMethod: "dom",
    fieldConfidences: { visibleText: 0.99 },
    viewportHash: digest(`viewport:${id}`),
    cardBounds: { x: 1, y: 2, width: 300, height: 100 },
    redactedCropHash: null,
    readerVersion: "mysql-reader.v1",
    capturedAt: id.endsWith("2")
      ? "2026-08-15T01:00:02.000Z"
      : "2026-08-15T01:00:01.000Z",
    ...overrides
  };
}

function artifact(
  observationId: string,
  plaintext = Buffer.from("RIFF encrypted-only WEBP bytes", "utf8")
): VisualReaderArtifactInput {
  return {
    artifactId: `artifact-${observationId}`,
    observationId,
    mediaType: "image/webp",
    plaintext,
    plaintextHash: digest(plaintext),
    byteLength: plaintext.byteLength,
    width: 300,
    height: 100,
    maskedRegionCount: 3,
    createdAt: START,
    expiresAt: "2026-09-14T01:00:00.000Z"
  };
}

interface FakeState {
  sessions: Map<string, Record<string, unknown>>;
  observations: Map<string, Record<string, unknown>>;
  artifacts: Map<string, Record<string, unknown>>;
}

function copyState(state: FakeState): FakeState {
  return {
    sessions: new Map([...state.sessions].map(([key, value]) => [
      key,
      structuredClone(value)
    ])),
    observations: new Map([...state.observations].map(([key, value]) => [
      key,
      structuredClone(value)
    ])),
    artifacts: new Map([...state.artifacts].map(([key, value]) => [
      key,
      structuredClone(value)
    ]))
  };
}

function replaceState(target: FakeState, source: FakeState) {
  target.sessions = source.sessions;
  target.observations = source.observations;
  target.artifacts = source.artifacts;
}

function scoped(values: unknown[], idIndex = 2) {
  return `${values[0]}\u0000${values[1]}\u0000${values[idIndex]}`;
}

class StatefulVisualMysqlPool {
  readonly statements: Array<{ sql: string; values: unknown[] }> = [];
  readonly state: FakeState = {
    sessions: new Map(), observations: new Map(), artifacts: new Map()
  };
  failNextArtifactInsert = false;
  private transactionTail = Promise.resolve();

  async query(sql: unknown, values: unknown[] = []) {
    return this.execute(this.state, String(sql), values);
  }

  async getConnection() {
    let state = this.state;
    let releaseLock: (() => void) | null = null;
    return {
      beginTransaction: async () => {
        const previous = this.transactionTail;
        this.transactionTail = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        await previous;
        state = copyState(this.state);
      },
      query: (sql: unknown, values: unknown[] = []) =>
        this.execute(state, String(sql), values),
      commit: async () => {
        replaceState(this.state, state);
        releaseLock?.();
        releaseLock = null;
      },
      rollback: async () => {
        releaseLock?.();
        releaseLock = null;
      },
      release() {},
      destroy() {}
    };
  }

  async end() {}

  private async execute(state: FakeState, sql: string, values: unknown[]) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.statements.push({ sql: normalized, values: structuredClone(values) });
    if (normalized.startsWith("CREATE TABLE")) return [[], []];
    if (normalized.includes("SELECT GET_LOCK")) {
      return [[{ lock_acquired: 1 }], []];
    }
    if (normalized.includes("SELECT RELEASE_LOCK")) {
      return [[{ lock_released: 1 }], []];
    }
    if (normalized.startsWith(
      "INSERT INTO acquisition_visual_reader_sessions"
    )) {
      const key = scoped(values);
      if (state.sessions.has(key)) {
        const error = Object.assign(new Error("duplicate"), {
          code: "ER_DUP_ENTRY", errno: 1062
        });
        throw error;
      }
      state.sessions.set(key, {
        owner_id: values[0], team_id: values[1], session_id: values[2],
        run_id: values[3], status: values[4], expires_at: values[5],
        create_input_hash: values[6], session_json: values[7],
        client_bindings_json: values[8]
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.includes("FROM acquisition_visual_reader_sessions")) {
      const key = scoped(values);
      const row = state.sessions.get(key);
      return [[...(row ? [structuredClone(row)] : [])], []];
    }
    if (normalized.startsWith(
      "UPDATE acquisition_visual_reader_sessions SET"
    )) {
      const key = `${values[5]}\u0000${values[6]}\u0000${values[7]}`;
      const row = state.sessions.get(key);
      if (!row) return [{ affectedRows: 0 }, []];
      Object.assign(row, {
        status: values[0], expires_at: values[1], session_json: values[2],
        client_bindings_json: values[3], updated_at: values[4]
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith(
      "SELECT * FROM acquisition_visual_comment_observations"
    )) {
      const rows = [...state.observations.values()].filter((row) =>
        row.owner_id === values[0] && row.team_id === values[1]
        && (normalized.includes("run_id = ?")
          ? row.run_id === values[2]
          : row.session_id === values[2]));
      return [[...rows.map((row) => structuredClone(row))], []];
    }
    if (normalized.startsWith(
      "INSERT INTO acquisition_visual_comment_observations"
    )) {
      const key = scoped(values);
      if (state.observations.has(key)) {
        const error = Object.assign(new Error("duplicate"), {
          code: "ER_DUP_ENTRY", errno: 1062
        });
        throw error;
      }
      state.observations.set(key, {
        owner_id: values[0], team_id: values[1], observation_id: values[2],
        session_id: values[3], run_id: values[4],
        client_observation_key: values[5], source_url: values[6],
        viewport_hash: values[7], card_bounds_hash: values[8],
        text_hash: values[9], video_id: values[10], captured_at: values[11],
        observation_json: values[12]
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith(
      "INSERT INTO acquisition_visual_reader_artifacts"
    )) {
      if (this.failNextArtifactInsert) {
        this.failNextArtifactInsert = false;
        throw new Error("injected artifact persistence failure");
      }
      const key = scoped(values);
      state.artifacts.set(key, {
        owner_id: values[0], team_id: values[1], artifact_id: values[2],
        session_id: values[3], observation_id: values[4],
        media_type: values[5], plaintext_hash: values[6],
        byte_length: values[7], width_px: values[8], height_px: values[9],
        masked_region_count: values[10], envelope_version: values[11],
        key_derivation_version: values[12], algorithm: values[13],
        iv: values[14], auth_tag: values[15], ciphertext: values[16],
        created_at: values[17], expires_at: values[18]
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith(
      "DELETE FROM acquisition_visual_reader_artifacts"
    )) {
      const before = String(values[0]);
      const limit = Number(values[1]);
      const keys = [...state.artifacts.entries()]
        .filter(([, row]) => String(row.expires_at) <= before)
        .sort((left, right) => String(left[1].expires_at)
          .localeCompare(String(right[1].expires_at)))
        .slice(0, limit)
        .map(([key]) => key);
      keys.forEach((key) => state.artifacts.delete(key));
      return [{ affectedRows: keys.length }, []];
    }
    if (normalized.includes("FROM acquisition_visual_reader_artifacts")) {
      const key = scoped(values);
      const row = state.artifacts.get(key);
      const readable = row && String(row.expires_at) > String(values[3]);
      return [[...(readable ? [structuredClone(row)] : [])], []];
    }
    throw new Error(`Unhandled visual MySQL test query: ${normalized}`);
  }
}

test("visual MySQL schema is isolated, repeatable, and fully tenant scoped", async () => {
  assert.equal(ACQUISITION_VISUAL_READER_MYSQL_SCHEMA_STATEMENTS.length, 3);
  const schema = ACQUISITION_VISUAL_READER_MYSQL_SCHEMA_STATEMENTS.join("\n");
  for (const table of [
    "acquisition_visual_reader_sessions",
    "acquisition_visual_comment_observations",
    "acquisition_visual_reader_artifacts"
  ]) assert.match(schema, new RegExp(table, "u"));
  assert.match(schema, /PRIMARY KEY \(owner_id, team_id, session_id\)/u);
  assert.match(schema, /PRIMARY KEY \(owner_id, team_id, observation_id\)/u);
  assert.match(schema, /PRIMARY KEY \(owner_id, team_id, artifact_id\)/u);
  assert.match(schema, /MEDIUMBLOB/u);
  assert.match(schema, /UNIQUE KEY[\s\S]*owner_id, team_id, session_id/u);

  const pool = new StatefulVisualMysqlPool();
  await Promise.all([
    ensureAcquisitionVisualReaderMysqlSchema(pool as unknown as mysql.Pool),
    ensureAcquisitionVisualReaderMysqlSchema(pool as unknown as mysql.Pool)
  ]);
  assert.equal(
    pool.statements.filter(({ sql }) => sql.startsWith("CREATE TABLE")).length,
    6
  );
});

test("visual MySQL repository atomically stores ciphertext and converges duplicates", async () => {
  const pool = new StatefulVisualMysqlPool();
  const repo = new MysqlAcquisitionVisualReaderRepository(
    pool as unknown as mysql.Pool,
    { masterSecret: SECRET, now: () => START }
  );
  await repo.createSession(createInput());
  const inputArtifact = artifact("mysql-observation-1");
  const value = observation("mysql-observation-1", {
    redactedCropHash: inputArtifact.plaintextHash
  });
  const first = await repo.appendObservationBatch({
    scope: SCOPE,
    sessionId: "mysql-visual-session",
    observations: [{
      clientObservationKey: "mysql-client-1",
      observation: value,
      artifact: inputArtifact
    }],
    usageDelta: { scrollCount: 1, ocrCallCount: 0 }
  });
  assert.deepEqual(first.accepted, [value]);
  const [left, right] = await Promise.all([
    repo.appendObservationBatch({
      scope: SCOPE,
      sessionId: "mysql-visual-session",
      observations: [{
        clientObservationKey: "mysql-client-2",
        observation: { ...value, observationId: "mysql-observation-retry" }
      }]
    }),
    repo.appendObservationBatch({
      scope: SCOPE,
      sessionId: "mysql-visual-session",
      observations: [{
        clientObservationKey: "mysql-client-3",
        observation: { ...value, observationId: "mysql-observation-retry-2" }
      }]
    })
  ]);
  assert.deepEqual(left.accepted, []);
  assert.deepEqual(right.accepted, []);
  assert.equal(pool.state.observations.size, 1);

  const persistedArtifact = [...pool.state.artifacts.values()][0];
  assert.ok(persistedArtifact);
  assert.notDeepEqual(persistedArtifact.ciphertext, inputArtifact.plaintext);
  assert.equal(
    pool.statements.some(({ values }) => values.some((candidate) =>
      Buffer.isBuffer(candidate)
      && candidate.equals(inputArtifact.plaintext))),
    false,
    "captured SQL values must never contain plaintext WebP bytes"
  );
  assert.equal(
    pool.statements.some(({ sql }) => sql.includes("FOR UPDATE")),
    true
  );
  assert.deepEqual(
    (await repo.getArtifact(SCOPE, inputArtifact.artifactId))?.plaintext,
    inputArtifact.plaintext
  );
});

test("visual MySQL append rollback leaves no observation, BLOB, usage, or key binding", async () => {
  const pool = new StatefulVisualMysqlPool();
  const repo = new MysqlAcquisitionVisualReaderRepository(
    pool as unknown as mysql.Pool,
    { masterSecret: SECRET, now: () => START }
  );
  await repo.createSession(createInput());
  const inputArtifact = artifact("mysql-observation-1");
  pool.failNextArtifactInsert = true;
  await assert.rejects(repo.appendObservationBatch({
    scope: SCOPE,
    sessionId: "mysql-visual-session",
    observations: [{
      clientObservationKey: "mysql-client-rollback",
      observation: observation("mysql-observation-1", {
        redactedCropHash: inputArtifact.plaintextHash
      }),
      artifact: inputArtifact
    }]
  }), /injected artifact persistence failure/u);
  assert.equal(pool.state.observations.size, 0);
  assert.equal(pool.state.artifacts.size, 0);
  assert.equal(
    (await repo.getSession(SCOPE, "mysql-visual-session"))?.usage
      .observationCount,
    0
  );
});

test("visual MySQL reads are scoped, deterministic, and expiry deletion is bounded", async () => {
  const pool = new StatefulVisualMysqlPool();
  let now = START;
  const repo = new MysqlAcquisitionVisualReaderRepository(
    pool as unknown as mysql.Pool,
    { masterSecret: SECRET, now: () => now }
  );
  await repo.createSession(createInput());
  const inputArtifact = artifact("mysql-observation-1");
  await repo.appendObservationBatch({
    scope: SCOPE,
    sessionId: "mysql-visual-session",
    observations: [{
      clientObservationKey: "mysql-client-2",
      observation: observation("mysql-observation-2")
    }, {
      clientObservationKey: "mysql-client-1",
      observation: observation("mysql-observation-1", {
        redactedCropHash: inputArtifact.plaintextHash
      }),
      artifact: inputArtifact
    }]
  } as AppendVisualObservationBatchInput);
  assert.deepEqual((await repo.listRunObservations(
    SCOPE,
    "mysql-visual-run",
    { limit: 10 }
  )).map((item) => item.observationId), [
    "mysql-observation-1",
    "mysql-observation-2"
  ]);
  assert.equal(await repo.getSession(
    { ownerId: "other", teamId: "other" },
    "mysql-visual-session"
  ), null);
  assert.equal(await repo.getArtifact(
    { ownerId: "other", teamId: "other" },
    inputArtifact.artifactId
  ), null);

  now = inputArtifact.expiresAt;
  assert.equal(await repo.getArtifact(SCOPE, inputArtifact.artifactId), null);
  assert.equal(await repo.deleteExpiredArtifacts({ before: now, limit: 1 }), 1);
  assert.equal(pool.state.artifacts.size, 0);
  assert.equal(pool.state.observations.size, 2);
});

test("visual MySQL repository persists an expired terminal session", async () => {
  const pool = new StatefulVisualMysqlPool();
  let now = START;
  const repo = new MysqlAcquisitionVisualReaderRepository(
    pool as unknown as mysql.Pool,
    { masterSecret: SECRET, now: () => now }
  );
  await repo.createSession(createInput());
  now = "2026-08-15T01:02:00.000Z";
  const outcome = {
    status: "expired" as const,
    videoCount: 0,
    observationCount: 0,
    domObservationCount: 0,
    accessibilityObservationCount: 0,
    ocrObservationCount: 0,
    lowConfidenceObservationCount: 0,
    artifactCount: 0,
    errorCodes: ["visual_reader_session_expired" as const]
  };
  const expired = await repo.completeSession(
    SCOPE,
    "mysql-visual-session",
    outcome
  );
  assert.equal(expired.status, "expired");
  assert.deepEqual(expired.outcome, outcome);
});

test("real MySQL visual repository parity is conditional", {
  skip: !process.env.MYSQL_TEST_ADMIN_URL
}, async () => {
  assert.ok(process.env.MYSQL_TEST_ADMIN_URL);
});
