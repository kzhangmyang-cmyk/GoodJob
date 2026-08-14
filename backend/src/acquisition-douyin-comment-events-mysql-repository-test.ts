import assert from "node:assert/strict";
import { test } from "node:test";
import type mysql from "mysql2/promise";
import type { AppendDouyinCommentObservationInput } from
  "./acquisition-douyin-comment-events.js";
import {
  ACQUISITION_DOUYIN_COMMENT_EVENTS_MYSQL_SCHEMA_STATEMENTS,
  MysqlAcquisitionDouyinCommentEventRepository,
  ensureAcquisitionDouyinCommentEventsMysqlSchema
} from "./acquisition-douyin-comment-events-mysql-repository.js";

function input(observationId: string): AppendDouyinCommentObservationInput {
  return {
    scope: { ownerId: "owner-a", teamId: "team-a" },
    observationId,
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
      actor: { displayName: "公开用户", handle: null, secUid: "sec-1" },
      sourceUrl: "https://www.douyin.com/video/123",
      coverage: "public_top_level_sample",
      accessStatus: "public_content",
      providerVersion: "douyin-public-comment-provider-v1",
      rawArtifactHash: `sha256:${"b".repeat(64)}`
    }
  };
}

class SchemaPool {
  readonly statements: string[] = [];
  async query(sql: string) {
    this.statements.push(sql.replace(/\s+/gu, " ").trim());
    return [[], []] as [unknown, unknown];
  }
}

function eventRow(values: unknown[]) {
  return {
    event_id: values[0], owner_id: values[1], team_id: values[2],
    platform: values[3], event_type: values[4], platform_event_id: values[5],
    video_id: values[6], parent_comment_id: values[7], text: values[8],
    text_hash: values[9], occurred_at: values[10], captured_at: values[11],
    like_count: values[12], reply_count: values[13], ip_label: values[14],
    actor_display_name: values[15], actor_handle: values[16],
    actor_sec_uid: values[17], source_url: values[18], coverage: values[19],
    access_status: values[20], provider_version: values[21],
    raw_artifact_hash: values[22]
  };
}

class ConcurrentPool {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  readonly events = new Map<string, Record<string, unknown>>();
  readonly observations = new Map<string, Record<string, unknown>>();
  commits = 0;
  rollbacks = 0;

  async query() {
    return [[], []] as [unknown, unknown];
  }

  async getConnection() {
    return {
      beginTransaction: async () => {},
      query: async (sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/gu, " ").trim();
        this.calls.push({ sql: normalized, values });
        if (normalized.startsWith(
          "INSERT IGNORE INTO acquisition_douyin_comment_events"
        )) {
          const key = `${values[1]}:${values[2]}:${values[3]}:${values[5]}`;
          if (this.events.has(key)) return [{ affectedRows: 0 }, []];
          this.events.set(key, eventRow(values));
          return [{ affectedRows: 1 }, []];
        }
        if (normalized.includes("FROM acquisition_douyin_comment_events")
          && normalized.includes("platform_event_id = ?")) {
          const key = `${values[0]}:${values[1]}:${values[2]}:${values[3]}`;
          const row = this.events.get(key);
          return [row ? [row] : [], []];
        }
        if (normalized.startsWith(
          "INSERT IGNORE INTO acquisition_douyin_comment_observations"
        )) {
          const key = `${values[1]}:${values[2]}:${values[0]}`;
          if (this.observations.has(key)) return [{ affectedRows: 0 }, []];
          this.observations.set(key, {
            observation_id: values[0], owner_id: values[1], team_id: values[2],
            event_id: values[3], captured_at: values[4], like_count: values[5],
            reply_count: values[6], observed_text_hash: values[7],
            provider_version: values[8], raw_artifact_hash: values[9]
          });
          return [{ affectedRows: 1 }, []];
        }
        if (normalized.includes(
          "FROM acquisition_douyin_comment_observations"
        )) {
          const key = `${values[0]}:${values[1]}:${values[2]}`;
          const row = this.observations.get(key);
          return [row ? [row] : [], []];
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
      },
      commit: async () => { this.commits += 1; },
      rollback: async () => { this.rollbacks += 1; },
      release: () => {}
    };
  }
}

class QueuePool {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  readonly queue: unknown[] = [];
  enqueue(rows: unknown) { this.queue.push(rows); }
  async query(sql: string, values: unknown[] = []) {
    this.calls.push({ sql: sql.replace(/\s+/gu, " ").trim(), values });
    return [this.queue.shift() ?? [], []] as [unknown, unknown];
  }
}

function storedEventRow() {
  const value = input("observation-1");
  const event = value.event;
  return {
    event_id: event.eventId,
    owner_id: value.scope.ownerId,
    team_id: value.scope.teamId,
    platform: event.platform,
    event_type: event.eventType,
    platform_event_id: event.platformEventId,
    video_id: event.videoId,
    parent_comment_id: event.parentCommentId,
    text: event.text,
    text_hash: event.textHash,
    occurred_at: "2026-08-15 01:00:00.000",
    captured_at: "2026-08-15 02:00:00.000",
    like_count: event.likeCount,
    reply_count: event.replyCount,
    ip_label: event.ipLabel,
    actor_display_name: event.actor.displayName,
    actor_handle: event.actor.handle,
    actor_sec_uid: event.actor.secUid,
    source_url: event.sourceUrl,
    coverage: event.coverage,
    access_status: event.accessStatus,
    provider_version: event.providerVersion,
    raw_artifact_hash: event.rawArtifactHash
  };
}

function storedObservationRow(
  observationId: string,
  capturedAt: string,
  likeCount: number
) {
  return {
    observation_id: observationId,
    event_id: "event-1",
    captured_at: capturedAt,
    like_count: likeCount,
    reply_count: 1,
    observed_text_hash: `sha256:${"a".repeat(64)}`,
    provider_version: "douyin-public-comment-provider-v1",
    raw_artifact_hash: `sha256:${"b".repeat(64)}`
  };
}

class SnapshotPool {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  async query(sql: string, values: unknown[] = []) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.calls.push({ sql: normalized, values });
    if (normalized.includes("FROM acquisition_douyin_comment_event_links")) {
      return [[{
        ...storedEventRow(),
        link_id: "link-run-1",
        observation_id: "observation-1",
        run_id: "run-1",
        shard_id: null,
        discovery_operation_id: null,
        candidate_id: null,
        evidence_id: null
      }], []] as [unknown, unknown];
    }
    if (normalized.includes("FROM acquisition_douyin_comment_events")) {
      return [[storedEventRow()], []] as [unknown, unknown];
    }
    if (normalized.includes("FROM acquisition_douyin_comment_observations")) {
      const byObservation = values[2] === "observation-1";
      return [[byObservation
        ? storedObservationRow(
            "observation-1", "2026-08-15 02:00:00.000", 2
          )
        : storedObservationRow(
            "observation-2", "2026-08-15 05:00:00.000", 99
          )], []] as [unknown, unknown];
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  }
}

function asPool(value: unknown) {
  return value as mysql.Pool;
}

test("schema creates four tenant-scoped comment persistence tables", async () => {
  const pool = new SchemaPool();
  await ensureAcquisitionDouyinCommentEventsMysqlSchema(asPool(pool));
  assert.equal(
    pool.statements.length,
    ACQUISITION_DOUYIN_COMMENT_EVENTS_MYSQL_SCHEMA_STATEMENTS.length
  );
  const schema = pool.statements.join("\n");
  for (const table of [
    "acquisition_douyin_comment_events",
    "acquisition_douyin_comment_observations",
    "acquisition_douyin_comment_event_links",
    "acquisition_douyin_comment_fetch_attempts"
  ]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(
    schema,
    /UNIQUE KEY uk_douyin_comment_platform_event\s*\(owner_id, team_id, platform, platform_event_id\)/
  );
  assert.match(
    schema,
    /FOREIGN KEY \(owner_id, team_id, event_id, observation_id\)/
  );
  assert.match(
    ACQUISITION_DOUYIN_COMMENT_EVENTS_MYSQL_SCHEMA_STATEMENTS[2],
    /observation_id VARCHAR\(160\) NOT NULL/
  );
  assert.equal(
    ACQUISITION_DOUYIN_COMMENT_EVENTS_MYSQL_SCHEMA_STATEMENTS[1]
      .match(/observation_id VARCHAR\(160\) NOT NULL/g)?.length,
    1
  );
});

test("concurrent append is transactionally idempotent per tenant boundary", async () => {
  const pool = new ConcurrentPool();
  const repository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(pool)
  );

  const [first, second] = await Promise.all([
    repository.appendObservation(input("observation-1")),
    repository.appendObservation(input("observation-2"))
  ]);

  assert.deepEqual(
    [first.eventCreated, second.eventCreated].sort(),
    [false, true]
  );
  assert.equal(first.event.eventId, second.event.eventId);
  assert.equal(pool.events.size, 1);
  assert.equal(pool.observations.size, 2);
  assert.equal(pool.commits, 2);
  assert.equal(pool.rollbacks, 0);
});

test("run summary is aggregated inside owner and team scope", async () => {
  const pool = new QueuePool();
  pool.enqueue([{
    linked_event_count: 3,
    observation_count: 4,
    fetch_attempt_count: 2,
    returned_comment_count: 7
  }]);
  const repository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(pool)
  );

  assert.deepEqual(
    await repository.getRunCommentSummary(
      { ownerId: "owner-a", teamId: "team-a" },
      "run-1"
    ),
    {
      linkedEventCount: 3,
      observationCount: 4,
      fetchAttemptCount: 2,
      returnedCommentCount: 7
    }
  );
  const call = pool.calls[0]!;
  assert.match(call.sql, /SELECT \? AS owner_id, \? AS team_id, \? AS run_id/);
  assert.match(call.sql, /s\.owner_id = l\.owner_id/);
  assert.match(call.sql, /s\.team_id = l\.team_id/);
  assert.deepEqual(call.values, ["owner-a", "team-a", "run-1"]);
});

test("fetch attempt reads are tenant scoped and reject corrupt status rows", async () => {
  const pool = new QueuePool();
  pool.enqueue([{
    attempt_id: "attempt-1",
    run_id: "run-1",
    shard_id: null,
    discovery_operation_id: null,
    source_url: "https://www.douyin.com/video/123",
    video_id: "123",
    status: "invented_status",
    error_code: null,
    requested_count: 20,
    returned_count: 0,
    reported_comment_count: null,
    pages_fetched: 0,
    started_at: "2026-08-15 01:00:00.000",
    completed_at: null
  }]);
  const repository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(pool)
  );

  await assert.rejects(
    repository.listFetchAttempts(
      { ownerId: "owner-a", teamId: "team-a" },
      "run-1",
      { limit: 50 }
    ),
    /MYSQL_INTEGRITY:status/
  );
  assert.deepEqual(
    pool.calls[0]?.values,
    ["owner-a", "team-a", "run-1", 50]
  );
});

test("mysql run snapshots load only the observation linked to that run", async () => {
  const pool = new SnapshotPool();
  const repository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(pool)
  );

  const signals = await repository.listRunCommentSignals(
    { ownerId: "owner-a", teamId: "team-a" },
    "run-1",
    { limit: 50 }
  );
  assert.equal(signals[0]?.latestObservation.observationId, "observation-1");
  assert.equal(signals[0]?.latestObservation.likeCount, 2);
  assert.equal(signals[0]?.link.observationId, "observation-1");
});

test("mysql writes canonicalize offset and sub-millisecond instants", async () => {
  const pool = new ConcurrentPool();
  const repository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(pool)
  );
  const value = input("observation-offset");
  value.event = {
    ...value.event,
    occurredAt: "2026-08-15T08:30:00.987654+08:00",
    capturedAt: "2026-08-15T09:00:00.123456+08:00"
  };

  const appended = await repository.appendObservation(value);
  assert.equal(appended.event.occurredAt, "2026-08-15T00:30:00.987Z");
  assert.equal(
    appended.observation.capturedAt,
    "2026-08-15T01:00:00.123Z"
  );
  const replayed = await repository.appendObservation({
    ...value,
    event: {
      ...value.event,
      occurredAt: "2026-08-15T00:30:00.987Z",
      capturedAt: "2026-08-15T01:00:00.123Z"
    }
  });
  assert.equal(replayed.eventCreated, false);
  assert.equal(replayed.observation.capturedAt, "2026-08-15T01:00:00.123Z");
});

test("mysql reads canonicalize Date and formatted DATETIME values", async () => {
  const baseRow = {
    attempt_id: "attempt-date",
    run_id: "run-date",
    shard_id: null,
    discovery_operation_id: null,
    source_url: "https://www.douyin.com/video/123",
    video_id: "123",
    status: "running",
    error_code: null,
    requested_count: 1,
    returned_count: 0,
    reported_comment_count: null,
    pages_fetched: 0,
    started_at: new Date("2026-08-15T01:00:00.123Z"),
    completed_at: null
  };
  const datePool = new QueuePool();
  datePool.enqueue([baseRow]);
  const dateRepository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(datePool)
  );
  assert.equal((await dateRepository.listFetchAttempts(
    { ownerId: "owner-a", teamId: "team-a" },
    "run-date",
    { limit: 1 }
  ))[0]?.startedAt, "2026-08-15T01:00:00.123Z");
  assert.match(datePool.calls[0]!.sql, /DATE_FORMAT\(started_at/);

  const stringPool = new QueuePool();
  stringPool.enqueue([{
    ...baseRow,
    status: "succeeded",
    started_at: "2026-08-15 01:00:00.987654",
    completed_at: "2026-08-15 01:00:01.999999"
  }]);
  const stringRepository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(stringPool)
  );
  const parsed = (await stringRepository.listFetchAttempts(
    { ownerId: "owner-a", teamId: "team-a" },
    "run-date",
    { limit: 1 }
  ))[0]!;
  assert.equal(parsed.startedAt, "2026-08-15T01:00:00.987Z");
  assert.equal(parsed.completedAt, "2026-08-15T01:00:01.999Z");
});

test("mysql fetch attempt reads validate and enforce their bound", async () => {
  const pool = new QueuePool();
  pool.enqueue(["1", "2", "3"].map((suffix) => ({
    attempt_id: `attempt-${suffix}`,
    run_id: "run-bounded",
    shard_id: null,
    discovery_operation_id: null,
    source_url: "https://www.douyin.com/video/123",
    video_id: "123",
    status: "running",
    error_code: null,
    requested_count: 1,
    returned_count: 0,
    reported_comment_count: null,
    pages_fetched: 0,
    started_at: `2026-08-15 0${suffix}:00:00.000`,
    completed_at: null
  })));
  const repository = new MysqlAcquisitionDouyinCommentEventRepository(
    asPool(pool)
  );
  const attempts = await repository.listFetchAttempts(
    { ownerId: "owner-a", teamId: "team-a" },
    "run-bounded",
    { limit: 2 }
  );
  assert.deepEqual(attempts.map((attempt) => attempt.attemptId), [
    "attempt-1", "attempt-2"
  ]);
  assert.match(pool.calls[0]!.sql, /LIMIT \?/);
  assert.deepEqual(pool.calls[0]!.values, [
    "owner-a", "team-a", "run-bounded", 2
  ]);
  await assert.rejects(
    repository.listFetchAttempts(
      { ownerId: "owner-a", teamId: "team-a" },
      "run-bounded",
      { limit: 101 }
    ),
    /INVALID_LIMIT/
  );
});
