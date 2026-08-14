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
  readonly observations = new Set<string>();
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
          this.observations.add(key);
          return [{ affectedRows: 1 }, []];
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
      "run-1"
    ),
    /MYSQL_INTEGRITY:status/
  );
  assert.deepEqual(pool.calls[0]?.values, ["owner-a", "team-a", "run-1"]);
});
