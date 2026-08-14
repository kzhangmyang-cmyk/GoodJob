import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import {
  assertAppendDouyinCommentObservationInput,
  assertFinishDouyinCommentFetchAttemptInput,
  assertLinkDouyinCommentEventInput,
  assertStartDouyinCommentFetchAttemptInput,
  type AcquisitionDouyinCommentEventRepository,
  type AcquisitionScope,
  type AppendDouyinCommentObservationInput,
  type DouyinCommentEvent,
  type DouyinCommentEventLink,
  type DouyinCommentFetchAttempt,
  type DouyinCommentObservation,
  type FinishDouyinCommentFetchAttemptInput,
  type LinkDouyinCommentEventInput,
  type StartDouyinCommentFetchAttemptInput
} from "./acquisition-douyin-comment-events.js";

type MysqlRow = Record<string, unknown>;

export const ACQUISITION_DOUYIN_COMMENT_EVENTS_MYSQL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS acquisition_douyin_comment_events (
    event_id VARCHAR(160) NOT NULL,
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    platform VARCHAR(32) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    platform_event_id VARCHAR(255) NOT NULL,
    video_id VARCHAR(255) NOT NULL,
    parent_comment_id VARCHAR(255) NULL,
    text TEXT NOT NULL,
    text_hash CHAR(71) NOT NULL,
    occurred_at DATETIME(3) NOT NULL,
    captured_at DATETIME(3) NOT NULL,
    like_count BIGINT UNSIGNED NOT NULL,
    reply_count BIGINT UNSIGNED NOT NULL,
    ip_label VARCHAR(255) NULL,
    actor_display_name VARCHAR(255) NOT NULL,
    actor_handle VARCHAR(255) NULL,
    actor_sec_uid VARCHAR(255) NULL,
    source_url VARCHAR(4000) NOT NULL,
    coverage VARCHAR(64) NOT NULL,
    access_status VARCHAR(64) NOT NULL,
    provider_version VARCHAR(255) NOT NULL,
    raw_artifact_hash CHAR(71) NOT NULL,
    PRIMARY KEY (owner_id, team_id, event_id),
    UNIQUE KEY uk_douyin_comment_platform_event
      (owner_id, team_id, platform, platform_event_id),
    KEY idx_douyin_comment_event_video
      (owner_id, team_id, video_id, occurred_at, event_id),
    CONSTRAINT chk_douyin_comment_event_literals CHECK (
      platform = 'douyin'
      AND event_type = 'comment'
      AND parent_comment_id IS NULL
      AND coverage = 'public_top_level_sample'
      AND access_status = 'public_content'
    )
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS acquisition_douyin_comment_observations (
    observation_id VARCHAR(160) NOT NULL,
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    event_id VARCHAR(160) NOT NULL,
    captured_at DATETIME(3) NOT NULL,
    like_count BIGINT UNSIGNED NOT NULL,
    reply_count BIGINT UNSIGNED NOT NULL,
    observed_text_hash CHAR(71) NOT NULL,
    provider_version VARCHAR(255) NOT NULL,
    raw_artifact_hash CHAR(71) NOT NULL,
    PRIMARY KEY (owner_id, team_id, observation_id),
    KEY idx_douyin_comment_observation_latest
      (owner_id, team_id, event_id, captured_at, observation_id),
    CONSTRAINT fk_douyin_comment_observation_event
      FOREIGN KEY (owner_id, team_id, event_id)
      REFERENCES acquisition_douyin_comment_events
        (owner_id, team_id, event_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS acquisition_douyin_comment_event_links (
    link_id VARCHAR(160) NOT NULL,
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    event_id VARCHAR(160) NOT NULL,
    run_id VARCHAR(160) NULL,
    shard_id VARCHAR(160) NULL,
    discovery_operation_id VARCHAR(160) NULL,
    candidate_id VARCHAR(160) NULL,
    evidence_id VARCHAR(160) NULL,
    PRIMARY KEY (owner_id, team_id, link_id),
    KEY idx_douyin_comment_link_run
      (owner_id, team_id, run_id, link_id),
    KEY idx_douyin_comment_link_event
      (owner_id, team_id, event_id, link_id),
    CONSTRAINT fk_douyin_comment_link_event
      FOREIGN KEY (owner_id, team_id, event_id)
      REFERENCES acquisition_douyin_comment_events
        (owner_id, team_id, event_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS acquisition_douyin_comment_fetch_attempts (
    attempt_id VARCHAR(160) NOT NULL,
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    run_id VARCHAR(160) NULL,
    shard_id VARCHAR(160) NULL,
    discovery_operation_id VARCHAR(160) NULL,
    source_url VARCHAR(4000) NOT NULL,
    video_id VARCHAR(255) NULL,
    status VARCHAR(32) NOT NULL,
    error_code VARCHAR(100) NULL,
    requested_count INT UNSIGNED NOT NULL,
    returned_count INT UNSIGNED NOT NULL,
    reported_comment_count BIGINT UNSIGNED NULL,
    pages_fetched INT UNSIGNED NOT NULL,
    started_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (owner_id, team_id, attempt_id),
    KEY idx_douyin_comment_fetch_run
      (owner_id, team_id, run_id, started_at, attempt_id),
    CONSTRAINT chk_douyin_comment_fetch_status CHECK (
      status IN (
        'running','succeeded','partial_success','failed','no_public_comments'
      )
    ),
    CONSTRAINT chk_douyin_comment_fetch_terminal CHECK (
      (status = 'running' AND completed_at IS NULL)
      OR (status <> 'running' AND completed_at IS NOT NULL)
    )
  ) ENGINE=InnoDB`
] as const;

export async function ensureAcquisitionDouyinCommentEventsMysqlSchema(
  pool: mysql.Pool
) {
  for (const statement of
    ACQUISITION_DOUYIN_COMMENT_EVENTS_MYSQL_SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
}

function integrity(reason: string): never {
  throw new Error(`ACQUISITION_DOUYIN_COMMENT_MYSQL_INTEGRITY:${reason}`);
}

function string(row: MysqlRow, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value) return integrity(key);
  return value;
}

function nullableString(row: MysqlRow, key: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string" || !value) return integrity(key);
  return value;
}

function integer(value: unknown, reason: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return integrity(reason);
  return parsed;
}

function instant(value: unknown, reason: string) {
  const normalized = value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
        ? `${value.replace(" ", "T")}Z`
        : value;
  if (typeof normalized !== "string") return integrity(reason);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return integrity(reason);
  return date.toISOString();
}

function nullableInstant(value: unknown, reason: string) {
  return value === null ? null : instant(value, reason);
}

function literal<T extends string>(
  value: unknown,
  allowed: readonly T[],
  reason: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return integrity(reason);
  }
  return value as T;
}

function digest(value: string, reason: string) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) integrity(reason);
  return value;
}

function mysqlDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return integrity("invalid_date");
  return parsed.toISOString().slice(0, 23).replace("T", " ");
}

function rows(value: unknown): MysqlRow[] {
  return Array.isArray(value) ? value as MysqlRow[] : integrity("rows");
}

function affectedRows(value: unknown) {
  return Number((value as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
}

function parseEvent(row: MysqlRow): DouyinCommentEvent {
  const parentCommentId = row.parent_comment_id;
  if (parentCommentId !== null) integrity("parent_comment_id");
  return {
    eventId: string(row, "event_id"),
    platform: literal(row.platform, ["douyin"], "platform"),
    eventType: literal(row.event_type, ["comment"], "event_type"),
    platformEventId: string(row, "platform_event_id"),
    videoId: string(row, "video_id"),
    parentCommentId,
    text: string(row, "text"),
    textHash: digest(string(row, "text_hash"), "text_hash"),
    occurredAt: instant(row.occurred_at, "occurred_at"),
    capturedAt: instant(row.captured_at, "captured_at"),
    likeCount: integer(row.like_count, "like_count"),
    replyCount: integer(row.reply_count, "reply_count"),
    ipLabel: nullableString(row, "ip_label"),
    actor: {
      displayName: string(row, "actor_display_name"),
      handle: nullableString(row, "actor_handle"),
      secUid: nullableString(row, "actor_sec_uid")
    },
    sourceUrl: string(row, "source_url"),
    coverage: literal(
      row.coverage,
      ["public_top_level_sample"],
      "coverage"
    ),
    accessStatus: literal(row.access_status, ["public_content"], "access_status"),
    providerVersion: string(row, "provider_version"),
    rawArtifactHash: digest(
      string(row, "raw_artifact_hash"),
      "raw_artifact_hash"
    )
  };
}

function parseObservation(row: MysqlRow): DouyinCommentObservation {
  return {
    observationId: string(row, "observation_id"),
    eventId: string(row, "event_id"),
    capturedAt: instant(row.captured_at, "captured_at"),
    likeCount: integer(row.like_count, "like_count"),
    replyCount: integer(row.reply_count, "reply_count"),
    observedTextHash: digest(
      string(row, "observed_text_hash"),
      "observed_text_hash"
    ),
    providerVersion: string(row, "provider_version"),
    rawArtifactHash: digest(
      string(row, "raw_artifact_hash"),
      "raw_artifact_hash"
    )
  };
}

function parseLink(row: MysqlRow): DouyinCommentEventLink {
  return {
    linkId: string(row, "link_id"),
    eventId: string(row, "event_id"),
    runId: nullableString(row, "run_id"),
    shardId: nullableString(row, "shard_id"),
    discoveryOperationId: nullableString(row, "discovery_operation_id"),
    candidateId: nullableString(row, "candidate_id"),
    evidenceId: nullableString(row, "evidence_id")
  };
}

const FETCH_STATUSES = [
  "running",
  "succeeded",
  "partial_success",
  "failed",
  "no_public_comments"
] as const;

function parseAttempt(row: MysqlRow): DouyinCommentFetchAttempt {
  const status = literal(row.status, FETCH_STATUSES, "status");
  const completedAt = nullableInstant(row.completed_at, "completed_at");
  if ((status === "running") !== (completedAt === null)) {
    integrity("status_completed_at");
  }
  return {
    attemptId: string(row, "attempt_id"),
    runId: nullableString(row, "run_id"),
    shardId: nullableString(row, "shard_id"),
    discoveryOperationId: nullableString(row, "discovery_operation_id"),
    sourceUrl: string(row, "source_url"),
    videoId: nullableString(row, "video_id"),
    status,
    errorCode: nullableString(row, "error_code"),
    requestedCount: integer(row.requested_count, "requested_count"),
    returnedCount: integer(row.returned_count, "returned_count"),
    reportedCommentCount: row.reported_comment_count === null
      ? null : integer(row.reported_comment_count, "reported_comment_count"),
    pagesFetched: integer(row.pages_fetched, "pages_fetched"),
    startedAt: instant(row.started_at, "started_at"),
    completedAt
  };
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function eventValues(input: AppendDouyinCommentObservationInput) {
  const { event } = input;
  return [
    event.eventId, input.scope.ownerId, input.scope.teamId,
    event.platform, event.eventType, event.platformEventId, event.videoId,
    event.parentCommentId, event.text, event.textHash,
    mysqlDate(event.occurredAt), mysqlDate(event.capturedAt),
    event.likeCount, event.replyCount, event.ipLabel, event.actor.displayName,
    event.actor.handle, event.actor.secUid, event.sourceUrl, event.coverage,
    event.accessStatus, event.providerVersion, event.rawArtifactHash
  ];
}

function observationFrom(
  input: AppendDouyinCommentObservationInput,
  eventId: string
): DouyinCommentObservation {
  return {
    observationId: input.observationId,
    eventId,
    capturedAt: input.event.capturedAt,
    likeCount: input.event.likeCount,
    replyCount: input.event.replyCount,
    observedTextHash: input.event.textHash,
    providerVersion: input.event.providerVersion,
    rawArtifactHash: input.event.rawArtifactHash
  };
}

async function selectEventByBoundary(
  connection: mysql.PoolConnection,
  scope: AcquisitionScope,
  platformEventId: string
) {
  const [result] = await connection.query(
    `SELECT * FROM acquisition_douyin_comment_events
     WHERE owner_id = ? AND team_id = ?
       AND platform = ? AND platform_event_id = ?
     FOR UPDATE`,
    [scope.ownerId, scope.teamId, "douyin", platformEventId]
  );
  const row = rows(result)[0];
  return row ? parseEvent(row) : integrity("event_missing_after_insert");
}

export class MysqlAcquisitionDouyinCommentEventRepository
implements AcquisitionDouyinCommentEventRepository {
  constructor(private readonly pool: mysql.Pool) {}

  async appendObservation(input: AppendDouyinCommentObservationInput) {
    assertAppendDouyinCommentObservationInput(input);
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [insertResult] = await connection.query(
        `INSERT IGNORE INTO acquisition_douyin_comment_events (
          event_id, owner_id, team_id, platform, event_type,
          platform_event_id, video_id, parent_comment_id, text, text_hash,
          occurred_at, captured_at, like_count, reply_count, ip_label,
          actor_display_name, actor_handle, actor_sec_uid, source_url,
          coverage, access_status, provider_version, raw_artifact_hash
        ) VALUES (${Array(23).fill("?").join(", ")})`,
        eventValues(input)
      );
      const eventCreated = affectedRows(insertResult) === 1;
      const event = await selectEventByBoundary(
        connection,
        input.scope,
        input.event.platformEventId
      );
      const observation = observationFrom(input, event.eventId);
      const [observationInsert] = await connection.query(
        `INSERT IGNORE INTO acquisition_douyin_comment_observations (
          observation_id, owner_id, team_id, event_id, captured_at,
          like_count, reply_count, observed_text_hash, provider_version,
          raw_artifact_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          observation.observationId, input.scope.ownerId, input.scope.teamId,
          observation.eventId, mysqlDate(observation.capturedAt),
          observation.likeCount, observation.replyCount,
          observation.observedTextHash, observation.providerVersion,
          observation.rawArtifactHash
        ]
      );
      let storedObservation = observation;
      if (affectedRows(observationInsert) === 0) {
        const [existingRows] = await connection.query(
          `SELECT * FROM acquisition_douyin_comment_observations
           WHERE owner_id = ? AND team_id = ? AND observation_id = ?
           FOR UPDATE`,
          [input.scope.ownerId, input.scope.teamId, input.observationId]
        );
        const row = rows(existingRows)[0];
        if (!row) integrity("observation_missing_after_insert");
        storedObservation = parseObservation(row);
        if (!same(storedObservation, observation)) {
          integrity("observation_id_conflict");
        }
      }
      await connection.commit();
      transactionStarted = false;
      return {
        event,
        observation: storedObservation,
        eventCreated,
        contentChanged: event.textHash !== storedObservation.observedTextHash
      };
    } catch (error) {
      if (transactionStarted) await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async linkEvent(input: LinkDouyinCommentEventInput) {
    assertLinkDouyinCommentEventInput(input);
    const link: DouyinCommentEventLink = {
      linkId: `douyin-comment-link:${createHash("sha256").update(JSON.stringify([
        input.scope.ownerId, input.scope.teamId, input.eventId, input.runId,
        input.shardId, input.discoveryOperationId, input.candidateId,
        input.evidenceId
      ])).digest("hex")}`,
      eventId: input.eventId,
      runId: input.runId,
      shardId: input.shardId,
      discoveryOperationId: input.discoveryOperationId,
      candidateId: input.candidateId,
      evidenceId: input.evidenceId
    };
    const [result] = await this.pool.query(
      `INSERT IGNORE INTO acquisition_douyin_comment_event_links (
        link_id, owner_id, team_id, event_id, run_id, shard_id,
        discovery_operation_id, candidate_id, evidence_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        link.linkId, input.scope.ownerId, input.scope.teamId, link.eventId,
        link.runId, link.shardId, link.discoveryOperationId, link.candidateId,
        link.evidenceId
      ]
    );
    const created = affectedRows(result) === 1;
    if (!created) {
      const [existingRows] = await this.pool.query(
        `SELECT * FROM acquisition_douyin_comment_event_links
         WHERE owner_id = ? AND team_id = ? AND link_id = ?`,
        [input.scope.ownerId, input.scope.teamId, link.linkId]
      );
      const row = rows(existingRows)[0];
      if (!row || !same(parseLink(row), link)) integrity("link_id_conflict");
    }
    return { link, created };
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
      startedAt: input.startedAt,
      completedAt: null
    };
    const [result] = await this.pool.query(
      `INSERT IGNORE INTO acquisition_douyin_comment_fetch_attempts (
        attempt_id, owner_id, team_id, run_id, shard_id,
        discovery_operation_id, source_url, video_id, status, error_code,
        requested_count, returned_count, reported_comment_count,
        pages_fetched, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attempt.attemptId, input.scope.ownerId, input.scope.teamId,
        attempt.runId, attempt.shardId, attempt.discoveryOperationId,
        attempt.sourceUrl, attempt.videoId, attempt.status, attempt.errorCode,
        attempt.requestedCount, attempt.returnedCount,
        attempt.reportedCommentCount, attempt.pagesFetched,
        mysqlDate(attempt.startedAt), attempt.completedAt
      ]
    );
    const created = affectedRows(result) === 1;
    if (created) return { attempt, created };
    const existing = await this.getFetchAttempt(input.scope, input.attemptId);
    if (!existing) integrity("fetch_attempt_missing_after_insert");
    const immutableStart = {
      ...existing,
      status: "running",
      errorCode: null,
      returnedCount: 0,
      reportedCommentCount: null,
      pagesFetched: 0,
      completedAt: null
    } as DouyinCommentFetchAttempt;
    if (!same(immutableStart, attempt)) integrity("fetch_attempt_conflict");
    return { attempt: existing, created };
  }

  async finishFetchAttempt(
    scope: AcquisitionScope,
    attemptId: string,
    terminal: FinishDouyinCommentFetchAttemptInput
  ) {
    assertFinishDouyinCommentFetchAttemptInput(terminal);
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [attemptRows] = await connection.query(
        `SELECT * FROM acquisition_douyin_comment_fetch_attempts
         WHERE owner_id = ? AND team_id = ? AND attempt_id = ?
         FOR UPDATE`,
        [scope.ownerId, scope.teamId, attemptId]
      );
      const row = rows(attemptRows)[0];
      if (!row) integrity("fetch_attempt_not_found");
      const existing = parseAttempt(row);
      const finished = { ...existing, ...terminal };
      if (existing.status !== "running") {
        if (!same(existing, finished)) integrity("fetch_attempt_conflict");
        await connection.commit();
        transactionStarted = false;
        return existing;
      }
      await connection.query(
        `UPDATE acquisition_douyin_comment_fetch_attempts
         SET status = ?, error_code = ?, returned_count = ?,
           reported_comment_count = ?, pages_fetched = ?, completed_at = ?
         WHERE owner_id = ? AND team_id = ? AND attempt_id = ?
           AND status = 'running'`,
        [
          terminal.status, terminal.errorCode, terminal.returnedCount,
          terminal.reportedCommentCount, terminal.pagesFetched,
          mysqlDate(terminal.completedAt), scope.ownerId, scope.teamId, attemptId
        ]
      );
      await connection.commit();
      transactionStarted = false;
      return finished;
    } catch (error) {
      if (transactionStarted) await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async listRunCommentSignals(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ) {
    if (!Number.isSafeInteger(options.limit)
      || options.limit < 1 || options.limit > 100) {
      throw new Error("ACQUISITION_DOUYIN_COMMENT_INVALID_LIMIT");
    }
    const [linkRows] = await this.pool.query(
      `SELECT l.*, e.*
       FROM acquisition_douyin_comment_event_links l
       INNER JOIN acquisition_douyin_comment_events e
         ON e.owner_id = l.owner_id AND e.team_id = l.team_id
         AND e.event_id = l.event_id
       WHERE l.owner_id = ? AND l.team_id = ? AND l.run_id = ?
       ORDER BY l.link_id ASC
       LIMIT ?`,
      [scope.ownerId, scope.teamId, runId, options.limit]
    );
    return Promise.all(rows(linkRows).map(async (row) => {
      const link = parseLink(row);
      const event = parseEvent(row);
      const [observationRows] = await this.pool.query(
        `SELECT * FROM acquisition_douyin_comment_observations
         WHERE owner_id = ? AND team_id = ? AND event_id = ?
         ORDER BY captured_at DESC, observation_id DESC
         LIMIT 1`,
        [scope.ownerId, scope.teamId, event.eventId]
      );
      const observationRow = rows(observationRows)[0];
      if (!observationRow) return integrity("event_observation_missing");
      return { event, latestObservation: parseObservation(observationRow), link };
    }));
  }

  async getRunCommentSummary(scope: AcquisitionScope, runId: string) {
    const [result] = await this.pool.query(
      `WITH requested_scope AS (
         SELECT ? AS owner_id, ? AS team_id, ? AS run_id
       ), run_events AS (
         SELECT DISTINCT l.event_id
         FROM acquisition_douyin_comment_event_links l
         INNER JOIN requested_scope s
           ON s.owner_id = l.owner_id AND s.team_id = l.team_id
           AND s.run_id = l.run_id
       )
       SELECT
         (SELECT COUNT(*) FROM run_events) AS linked_event_count,
         (SELECT COUNT(*)
          FROM acquisition_douyin_comment_observations o
          INNER JOIN requested_scope s
            ON s.owner_id = o.owner_id AND s.team_id = o.team_id
          INNER JOIN run_events e ON e.event_id = o.event_id
         ) AS observation_count,
         (SELECT COUNT(*)
          FROM acquisition_douyin_comment_fetch_attempts a
          INNER JOIN requested_scope s
            ON s.owner_id = a.owner_id AND s.team_id = a.team_id
            AND s.run_id = a.run_id
         ) AS fetch_attempt_count,
         (SELECT COALESCE(SUM(a.returned_count), 0)
          FROM acquisition_douyin_comment_fetch_attempts a
          INNER JOIN requested_scope s
            ON s.owner_id = a.owner_id AND s.team_id = a.team_id
            AND s.run_id = a.run_id
         ) AS returned_comment_count`,
      [scope.ownerId, scope.teamId, runId]
    );
    const row = rows(result)[0];
    if (!row) integrity("summary_missing");
    return {
      linkedEventCount: integer(row.linked_event_count, "linked_event_count"),
      observationCount: integer(row.observation_count, "observation_count"),
      fetchAttemptCount: integer(row.fetch_attempt_count, "fetch_attempt_count"),
      returnedCommentCount: integer(
        row.returned_comment_count,
        "returned_comment_count"
      )
    };
  }

  async listFetchAttempts(scope: AcquisitionScope, runId: string) {
    const [result] = await this.pool.query(
      `SELECT * FROM acquisition_douyin_comment_fetch_attempts
       WHERE owner_id = ? AND team_id = ? AND run_id = ?
       ORDER BY started_at ASC, attempt_id ASC`,
      [scope.ownerId, scope.teamId, runId]
    );
    return rows(result).map(parseAttempt);
  }

  private async getFetchAttempt(scope: AcquisitionScope, attemptId: string) {
    const [result] = await this.pool.query(
      `SELECT * FROM acquisition_douyin_comment_fetch_attempts
       WHERE owner_id = ? AND team_id = ? AND attempt_id = ?`,
      [scope.ownerId, scope.teamId, attemptId]
    );
    const row = rows(result)[0];
    return row ? parseAttempt(row) : null;
  }
}
