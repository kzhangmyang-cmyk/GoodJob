import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import {
  ACQUISITION_VISUAL_ARTIFACT_ALGORITHM,
  ACQUISITION_VISUAL_ARTIFACT_ENVELOPE_VERSION,
  ACQUISITION_VISUAL_ARTIFACT_KEY_DERIVATION_VERSION,
  decryptAcquisitionVisualArtifact,
  deriveAcquisitionVisualArtifactKey,
  encryptAcquisitionVisualArtifact,
  type AcquisitionVisualArtifactContext,
  type AcquisitionVisualArtifactEnvelope
} from "./acquisition-visual-artifact-crypto.js";
import {
  AcquisitionVisualReaderRepositoryError,
  assertCreateVisualReaderSessionInput,
  assertVisualCommentObservation,
  assertVisualReaderArtifactInput,
  deriveVisualReaderOutcome,
  visualCardBoundsHash,
  visualObservationDedupeKey,
  visualObservationInputHash,
  visualObservationIsLowConfidence,
  visualReaderExpiredProjection,
  visualReaderSessionIsActiveAt,
  type AcquisitionScope,
  type AcquisitionVisualReaderRepository,
  type AppendVisualObservationBatchInput,
  type CreateVisualReaderSessionInput,
  type DouyinVisualCommentObservationV1,
  type VisualReaderArtifact,
  type VisualReaderArtifactInput,
  type VisualReaderOutcome,
  type VisualReaderSession,
  type VisualReaderStableErrorCode,
  type VisualReaderUsage
} from "./acquisition-visual-reader-sessions.js";
import { canonicalJsonStringify } from "./canonical-json.js";

type MysqlRow = Record<string, unknown>;
interface Queryable {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

export const ACQUISITION_VISUAL_READER_MYSQL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS acquisition_visual_reader_sessions (
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    session_id VARCHAR(160) NOT NULL,
    run_id VARCHAR(160) NOT NULL,
    status VARCHAR(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    create_input_hash CHAR(64) NOT NULL,
    session_json JSON NOT NULL,
    client_bindings_json JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (owner_id, team_id, session_id),
    KEY idx_visual_reader_session_run
      (owner_id, team_id, run_id, updated_at, session_id),
    CONSTRAINT chk_visual_reader_session_status CHECK (
      status IN (
        'created','collecting','completed','partial_success','aborted','expired'
      )
    )
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS acquisition_visual_comment_observations (
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    observation_id VARCHAR(160) NOT NULL,
    session_id VARCHAR(160) NOT NULL,
    run_id VARCHAR(160) NOT NULL,
    client_observation_key VARCHAR(160) NOT NULL,
    source_url VARCHAR(80) NOT NULL,
    viewport_hash CHAR(71) NOT NULL,
    card_bounds_hash CHAR(71) NOT NULL,
    text_hash CHAR(71) NOT NULL,
    video_id VARCHAR(32) NOT NULL,
    captured_at DATETIME(3) NOT NULL,
    observation_json JSON NOT NULL,
    PRIMARY KEY (owner_id, team_id, observation_id),
    UNIQUE KEY uk_visual_observation_client_key
      (owner_id, team_id, session_id, client_observation_key),
    UNIQUE KEY uk_visual_observation_immutable_facts
      (owner_id, team_id, session_id, source_url, viewport_hash,
       card_bounds_hash, text_hash),
    KEY idx_visual_observation_run
      (owner_id, team_id, run_id, captured_at, observation_id),
    KEY idx_visual_observation_session_video
      (owner_id, team_id, session_id, video_id, captured_at, observation_id),
    CONSTRAINT fk_visual_observation_session
      FOREIGN KEY (owner_id, team_id, session_id)
      REFERENCES acquisition_visual_reader_sessions
        (owner_id, team_id, session_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS acquisition_visual_reader_artifacts (
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    artifact_id VARCHAR(160) NOT NULL,
    session_id VARCHAR(160) NOT NULL,
    observation_id VARCHAR(160) NOT NULL,
    media_type VARCHAR(32) NOT NULL,
    plaintext_hash CHAR(71) NOT NULL,
    byte_length INT UNSIGNED NOT NULL,
    width_px INT UNSIGNED NOT NULL,
    height_px INT UNSIGNED NOT NULL,
    masked_region_count INT UNSIGNED NOT NULL,
    envelope_version VARCHAR(64) NOT NULL,
    key_derivation_version VARCHAR(64) NOT NULL,
    algorithm VARCHAR(32) NOT NULL,
    iv BINARY(12) NOT NULL,
    auth_tag BINARY(16) NOT NULL,
    ciphertext MEDIUMBLOB NOT NULL,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    PRIMARY KEY (owner_id, team_id, artifact_id),
    UNIQUE KEY uk_visual_artifact_observation
      (owner_id, team_id, session_id, observation_id, artifact_id),
    KEY idx_visual_artifact_expiry
      (expires_at, owner_id, team_id, artifact_id),
    CONSTRAINT fk_visual_artifact_observation
      FOREIGN KEY (owner_id, team_id, observation_id)
      REFERENCES acquisition_visual_comment_observations
        (owner_id, team_id, observation_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_visual_artifact_media CHECK (media_type = 'image/webp')
  ) ENGINE=InnoDB`
] as const;

const VISUAL_SCHEMA_LOCK = "acquisition:visual-reader-schema:v1";

export async function ensureAcquisitionVisualReaderMysqlSchema(
  pool: mysql.Pool
) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [result] = await connection.query(
      "SELECT GET_LOCK(?, ?) AS lock_acquired",
      [VISUAL_SCHEMA_LOCK, 30]
    );
    const row = Array.isArray(result)
      ? result[0] as MysqlRow | undefined
      : undefined;
    if (Number(row?.lock_acquired) !== 1) {
      throw new Error("ACQUISITION_VISUAL_READER_SCHEMA_LOCK_FAILED");
    }
    locked = true;
    for (const statement of ACQUISITION_VISUAL_READER_MYSQL_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    if (locked) {
      await connection.query(
        "SELECT RELEASE_LOCK(?) AS lock_released",
        [VISUAL_SCHEMA_LOCK]
      ).catch(() => undefined);
    }
    connection.release();
  }
}

function fail(code: ConstructorParameters<
  typeof AcquisitionVisualReaderRepositoryError
>[0]): never {
  throw new AcquisitionVisualReaderRepositoryError(code);
}

function canonical(value: unknown) {
  const encoded = canonicalJsonStringify(value);
  if (typeof encoded !== "string") fail("VISUAL_READER_INVALID_INPUT");
  return encoded;
}

function createInputHash(input: CreateVisualReaderSessionInput) {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

function sqlDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function isoDate(value: unknown) {
  const normalized = value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  if (typeof normalized !== "string") {
    throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
  }
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
  }
  return date.toISOString();
}

function jsonObject(value: unknown) {
  try {
    const decoded = Buffer.isBuffer(value)
      ? JSON.parse(value.toString("utf8"))
      : typeof value === "string"
        ? JSON.parse(value)
        : value;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error();
    }
    return decoded as Record<string, unknown>;
  } catch {
    throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
  }
}

function rowString(row: MysqlRow, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value) {
    throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
  }
  return value;
}

function parseSession(row: MysqlRow): VisualReaderSession {
  const session = jsonObject(row.session_json) as unknown as VisualReaderSession;
  if (typeof session.sessionId !== "string"
    || session.sessionId !== rowString(row, "session_id")
    || session.runId !== rowString(row, "run_id")
    || session.status !== rowString(row, "status")
    || session.expiresAt !== isoDate(row.expires_at)) {
    throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
  }
  return structuredClone(session);
}

interface ClientBinding {
  inputHash: string;
  observationId: string;
}

function parseBindings(row: MysqlRow) {
  const value = jsonObject(row.client_bindings_json);
  const bindings = new Map<string, ClientBinding>();
  for (const [key, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== "object"
      || typeof (candidate as ClientBinding).inputHash !== "string"
      || typeof (candidate as ClientBinding).observationId !== "string") {
      throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
    }
    bindings.set(key, structuredClone(candidate as ClientBinding));
  }
  return bindings;
}

function serializeBindings(bindings: Map<string, ClientBinding>) {
  return JSON.stringify(Object.fromEntries(
    [...bindings.entries()].sort(([left], [right]) =>
      left.localeCompare(right))
  ));
}

function parseObservation(row: MysqlRow) {
  const observation = jsonObject(
    row.observation_json
  ) as unknown as DouyinVisualCommentObservationV1;
  if (observation.observationId !== rowString(row, "observation_id")
    || observation.sessionId !== rowString(row, "session_id")
    || observation.sourceUrl !== rowString(row, "source_url")
    || observation.viewportHash !== rowString(row, "viewport_hash")
    || observation.textHash !== rowString(row, "text_hash")
    || observation.videoId !== rowString(row, "video_id")) {
    throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
  }
  return structuredClone(observation);
}

function duplicateEntry(error: unknown) {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062;
}

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
}

async function selectSession(
  queryable: Queryable,
  scope: AcquisitionScope,
  sessionId: string,
  lock = false
) {
  const [result] = await queryable.query(
    `SELECT * FROM acquisition_visual_reader_sessions
     WHERE owner_id = ? AND team_id = ? AND session_id = ?${
       lock ? " FOR UPDATE" : ""
     }`,
    [scope.ownerId, scope.teamId, sessionId]
  );
  return Array.isArray(result) && result[0]
    ? result[0] as MysqlRow
    : null;
}

function initialSession(input: CreateVisualReaderSessionInput): VisualReaderSession {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    planId: input.planId,
    planVersionId: input.planVersionId,
    platform: "douyin",
    coverage: "authorized_visible_top_level_sample",
    status: "created",
    artifactUploadEnabled: input.artifactUploadEnabled,
    limits: structuredClone(input.limits),
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
    createdAt: input.createdAt,
    authorizedAt: input.authorizedAt,
    updatedAt: input.createdAt,
    expiresAt: input.expiresAt,
    completedAt: null
  };
}

function validateBatchBasics(input: AppendVisualObservationBatchInput) {
  if (!input.scope?.ownerId || !input.scope.teamId
    || !Array.isArray(input.observations)
    || input.observations.length < 1
    || input.observations.length > 20
    || input.observations.filter((item) => item.artifact).length > 5) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  const usageDelta = input.usageDelta ?? { scrollCount: 0, ocrCallCount: 0 };
  if (!Number.isSafeInteger(usageDelta.scrollCount)
    || usageDelta.scrollCount < 0
    || !Number.isSafeInteger(usageDelta.ocrCallCount)
    || usageDelta.ocrCallCount < 0) {
    fail("VISUAL_READER_INVALID_INPUT");
  }
  return usageDelta;
}

interface PlannedArtifact {
  input: VisualReaderArtifactInput;
  envelope: AcquisitionVisualArtifactEnvelope;
}

function artifactContext(
  scope: AcquisitionScope,
  sessionId: string,
  artifact: VisualReaderArtifactInput
): AcquisitionVisualArtifactContext {
  return {
    ownerId: scope.ownerId,
    teamId: scope.teamId,
    sessionId,
    observationId: artifact.observationId,
    artifactId: artifact.artifactId,
    mediaType: artifact.mediaType,
    plaintextHash: artifact.plaintextHash,
    byteLength: artifact.byteLength
  };
}

export interface MysqlAcquisitionVisualReaderRepositoryOptions {
  masterSecret: string;
  now?: () => string;
}

export class MysqlAcquisitionVisualReaderRepository
implements AcquisitionVisualReaderRepository {
  private readonly masterSecret: string;
  private readonly now: () => string;

  constructor(
    private readonly pool: mysql.Pool,
    options: MysqlAcquisitionVisualReaderRepositoryOptions
  ) {
    deriveAcquisitionVisualArtifactKey(options.masterSecret);
    this.masterSecret = options.masterSecret;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createSession(input: CreateVisualReaderSessionInput) {
    assertCreateVisualReaderSessionInput(input);
    const session = initialSession(input);
    const hash = createInputHash(input);
    try {
      await this.pool.query(
        `INSERT INTO acquisition_visual_reader_sessions
          (owner_id, team_id, session_id, run_id, status, expires_at,
           create_input_hash, session_json, client_bindings_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.scope.ownerId,
          input.scope.teamId,
          input.sessionId,
          input.runId,
          session.status,
          sqlDate(input.expiresAt),
          hash,
          JSON.stringify(session),
          JSON.stringify({}),
          sqlDate(session.updatedAt)
        ]
      );
      return structuredClone(session);
    } catch (error) {
      if (!duplicateEntry(error)) throw error;
      const existing = await selectSession(
        this.pool as unknown as Queryable,
        input.scope,
        input.sessionId
      );
      if (!existing || rowString(existing, "create_input_hash") !== hash) {
        fail("VISUAL_READER_SESSION_CONFLICT");
      }
      return parseSession(existing);
    }
  }

  async appendObservationBatch(input: AppendVisualObservationBatchInput) {
    const usageDelta = validateBatchBasics(input);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await selectSession(
        connection as unknown as Queryable,
        input.scope,
        input.sessionId,
        true
      );
      if (!row) fail("VISUAL_READER_SESSION_NOT_FOUND");
      const session = parseSession(row);
      const now = this.now();
      sqlDate(now);
      if (Date.parse(now) >= Date.parse(session.expiresAt)
        && !["completed", "partial_success", "aborted", "expired"].includes(
          session.status
        )) {
        fail("VISUAL_READER_SESSION_EXPIRED");
      }
      if (["completed", "partial_success", "aborted", "expired"].includes(
        session.status
      )) fail("VISUAL_READER_SESSION_TERMINAL");

      for (const item of input.observations) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(
          item.clientObservationKey
        )) fail("VISUAL_READER_INVALID_INPUT");
        assertVisualCommentObservation(item.observation, input.sessionId);
        if (item.artifact) {
          assertVisualReaderArtifactInput(item.artifact, item.observation, session);
        }
      }

      const [observationResult] = await connection.query(
        `SELECT * FROM acquisition_visual_comment_observations
         WHERE owner_id = ? AND team_id = ? AND session_id = ?
         ORDER BY captured_at, observation_id`,
        [input.scope.ownerId, input.scope.teamId, input.sessionId]
      );
      const existingRows = Array.isArray(observationResult)
        ? observationResult as MysqlRow[]
        : [];
      const existingObservations = existingRows.map(parseObservation);
      const byId = new Map(existingObservations.map((observation) => [
        observation.observationId,
        observation
      ]));
      const byDedupe = new Map(existingObservations.map((observation) => [
        visualObservationDedupeKey(input.scope, observation),
        observation.observationId
      ]));
      const videoCounts = new Map<string, number>();
      for (const observation of existingObservations) {
        videoCounts.set(
          observation.videoId,
          (videoCounts.get(observation.videoId) ?? 0) + 1
        );
      }
      const bindings = parseBindings(row);
      const accepted: Array<{
        clientObservationKey: string;
        observation: DouyinVisualCommentObservationV1;
        artifact?: PlannedArtifact;
      }> = [];
      const duplicates: string[] = [];
      const duplicateSet = new Set<string>();

      for (const item of input.observations) {
        const inputHash = visualObservationInputHash(item);
        const existingBinding = bindings.get(item.clientObservationKey);
        if (existingBinding) {
          if (existingBinding.inputHash !== inputHash) {
            fail("VISUAL_READER_CLIENT_KEY_CONFLICT");
          }
          if (!duplicateSet.has(item.clientObservationKey)) {
            duplicates.push(item.clientObservationKey);
            duplicateSet.add(item.clientObservationKey);
          }
          continue;
        }
        const idMatch = byId.get(item.observation.observationId);
        if (idMatch && canonical(idMatch) !== canonical(item.observation)) {
          fail("VISUAL_READER_OBSERVATION_CONFLICT");
        }
        const dedupeMatch = byDedupe.get(
          visualObservationDedupeKey(input.scope, item.observation)
        );
        if (idMatch || dedupeMatch) {
          bindings.set(item.clientObservationKey, {
            inputHash,
            observationId: dedupeMatch ?? item.observation.observationId
          });
          duplicates.push(item.clientObservationKey);
          duplicateSet.add(item.clientObservationKey);
          continue;
        }
        if (!item.artifact && item.observation.redactedCropHash !== null) {
          fail("VISUAL_READER_ARTIFACT_INVALID");
        }
        const nextVideoCount = (videoCounts.get(item.observation.videoId) ?? 0) + 1;
        videoCounts.set(item.observation.videoId, nextVideoCount);
        if (nextVideoCount > session.limits.maxCommentsPerVideo
          || videoCounts.size > session.limits.maxVideos) {
          fail("VISUAL_READER_BUDGET_EXHAUSTED");
        }
        const plannedArtifact = item.artifact ? {
          input: item.artifact,
          envelope: encryptAcquisitionVisualArtifact({
            masterSecret: this.masterSecret,
            context: artifactContext(input.scope, input.sessionId, item.artifact),
            plaintext: Buffer.from(item.artifact.plaintext)
          })
        } : undefined;
        accepted.push({
          clientObservationKey: item.clientObservationKey,
          observation: structuredClone(item.observation),
          artifact: plannedArtifact
        });
        byId.set(item.observation.observationId, item.observation);
        byDedupe.set(
          visualObservationDedupeKey(input.scope, item.observation),
          item.observation.observationId
        );
        bindings.set(item.clientObservationKey, {
          inputHash,
          observationId: item.observation.observationId
        });
      }

      let nextSession = session;
      if (accepted.length > 0) {
        const usage: VisualReaderUsage = {
          videoCount: videoCounts.size,
          observationCount: session.usage.observationCount + accepted.length,
          scrollCount: session.usage.scrollCount + usageDelta.scrollCount,
          ocrCallCount: session.usage.ocrCallCount + usageDelta.ocrCallCount,
          domObservationCount: session.usage.domObservationCount
            + accepted.filter(({ observation }) =>
              observation.extractionMethod === "dom").length,
          accessibilityObservationCount:
            session.usage.accessibilityObservationCount
            + accepted.filter(({ observation }) =>
              observation.extractionMethod === "accessibility").length,
          ocrObservationCount: session.usage.ocrObservationCount
            + accepted.filter(({ observation }) =>
              observation.extractionMethod === "ocr").length,
          lowConfidenceObservationCount:
            session.usage.lowConfidenceObservationCount
            + accepted.filter(({ observation }) =>
              visualObservationIsLowConfidence(observation)).length,
          artifactCount: session.usage.artifactCount
            + accepted.filter(({ artifact }) => artifact).length
        };
        if (usage.scrollCount > session.limits.maxScrolls
          || usage.ocrCallCount > session.limits.maxOcrCalls) {
          fail("VISUAL_READER_BUDGET_EXHAUSTED");
        }
        nextSession = {
          ...session,
          status: "collecting",
          usage,
          updatedAt: now
        };
      }

      for (const planned of accepted) {
        const observation = planned.observation;
        await connection.query(
          `INSERT INTO acquisition_visual_comment_observations
            (owner_id, team_id, observation_id, session_id, run_id,
             client_observation_key, source_url, viewport_hash,
             card_bounds_hash, text_hash, video_id, captured_at,
             observation_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.scope.ownerId,
            input.scope.teamId,
            observation.observationId,
            input.sessionId,
            session.runId,
            planned.clientObservationKey,
            observation.sourceUrl,
            observation.viewportHash,
            visualCardBoundsHash(observation.cardBounds),
            observation.textHash,
            observation.videoId,
            sqlDate(observation.capturedAt),
            JSON.stringify(observation)
          ]
        );
        if (planned.artifact) {
          const { input: artifact, envelope } = planned.artifact;
          await connection.query(
            `INSERT INTO acquisition_visual_reader_artifacts
              (owner_id, team_id, artifact_id, session_id, observation_id,
               media_type, plaintext_hash, byte_length, width_px, height_px,
               masked_region_count, envelope_version, key_derivation_version,
               algorithm, iv, auth_tag, ciphertext, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              input.scope.ownerId,
              input.scope.teamId,
              artifact.artifactId,
              input.sessionId,
              artifact.observationId,
              artifact.mediaType,
              artifact.plaintextHash,
              artifact.byteLength,
              artifact.width,
              artifact.height,
              artifact.maskedRegionCount,
              envelope.envelopeVersion,
              envelope.keyDerivationVersion,
              envelope.algorithm,
              envelope.iv,
              envelope.authTag,
              envelope.ciphertext,
              sqlDate(artifact.createdAt),
              sqlDate(artifact.expiresAt)
            ]
          );
        }
      }
      await this.updateSession(connection as unknown as Queryable, input.scope,
        nextSession, bindings);
      await connection.commit();
      return {
        accepted: accepted.map(({ observation }) => structuredClone(observation)),
        duplicates
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (duplicateEntry(error)) fail("VISUAL_READER_OBSERVATION_CONFLICT");
      throw error;
    } finally {
      connection.release();
    }
  }

  async completeSession(
    scope: AcquisitionScope,
    sessionId: string,
    outcome: VisualReaderOutcome
  ) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await selectSession(
        connection as unknown as Queryable,
        scope,
        sessionId,
        true
      );
      if (!row) fail("VISUAL_READER_SESSION_NOT_FOUND");
      const session = parseSession(row);
      const now = this.now();
      sqlDate(now);
      const terminal = [
        "completed", "partial_success", "aborted", "expired"
      ].includes(session.status);
      const expiredNow = Date.parse(now) >= Date.parse(session.expiresAt);
      if (terminal) {
        if (session.outcome && canonical(session.outcome) === canonical(outcome)) {
          await connection.commit();
          return session;
        }
        fail("VISUAL_READER_SESSION_CONFLICT");
      }
      if (expiredNow && outcome?.status !== "expired") {
        fail("VISUAL_READER_SESSION_EXPIRED");
      }
      if (!outcome
        || !Array.isArray(outcome.errorCodes)
        || new Set(outcome.errorCodes).size !== outcome.errorCodes.length) {
        fail("VISUAL_READER_INVALID_INPUT");
      }
      const derived = deriveVisualReaderOutcome(
        outcome.status,
        session.usage,
        outcome.errorCodes
      );
      if (canonical(derived) !== canonical(outcome)) {
        fail("VISUAL_READER_SESSION_CONFLICT");
      }
      const completed: VisualReaderSession = {
        ...session,
        status: outcome.status,
        outcome: structuredClone(outcome),
        lastErrorCode: outcome.errorCodes[0] ?? null,
        updatedAt: now,
        completedAt: now
      };
      await this.updateSession(
        connection as unknown as Queryable,
        scope,
        completed,
        parseBindings(row)
      );
      await connection.commit();
      return structuredClone(completed);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSession(scope: AcquisitionScope, sessionId: string) {
    const row = await selectSession(
      this.pool as unknown as Queryable,
      scope,
      sessionId
    );
    if (!row) return null;
    const session = parseSession(row);
    const now = this.now();
    sqlDate(now);
    return visualReaderSessionIsActiveAt(session, now)
      || ["completed", "partial_success", "aborted", "expired"].includes(
        session.status
      )
      ? session
      : visualReaderExpiredProjection(session, now);
  }

  async listRunObservations(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ) {
    if (!Number.isSafeInteger(options.limit)
      || options.limit < 1
      || options.limit > 1_000) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
    const [result] = await this.pool.query(
      `SELECT * FROM acquisition_visual_comment_observations
       WHERE owner_id = ? AND team_id = ? AND run_id = ?
       ORDER BY captured_at, observation_id LIMIT ?`,
      [scope.ownerId, scope.teamId, runId, options.limit]
    );
    return (Array.isArray(result) ? result as MysqlRow[] : [])
      .map(parseObservation)
      .sort((left, right) =>
        left.capturedAt.localeCompare(right.capturedAt)
        || left.observationId.localeCompare(right.observationId))
      .slice(0, options.limit);
  }

  async getArtifact(scope: AcquisitionScope, artifactId: string) {
    const now = this.now();
    const [result] = await this.pool.query(
      `SELECT * FROM acquisition_visual_reader_artifacts
       WHERE owner_id = ? AND team_id = ? AND artifact_id = ?
         AND expires_at > ?`,
      [scope.ownerId, scope.teamId, artifactId, sqlDate(now)]
    );
    const row = Array.isArray(result) && result[0]
      ? result[0] as MysqlRow
      : null;
    if (!row) return null;
    return this.parseArtifact(scope, row);
  }

  async deleteExpiredArtifacts(input: { before: string; limit: number }) {
    if (!Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > 100) {
      fail("VISUAL_READER_INVALID_INPUT");
    }
    const [result] = await this.pool.query(
      `DELETE FROM acquisition_visual_reader_artifacts
       WHERE expires_at <= ?
       ORDER BY expires_at, artifact_id LIMIT ?`,
      [sqlDate(input.before), input.limit]
    );
    return affectedRows(result);
  }

  private async updateSession(
    queryable: Queryable,
    scope: AcquisitionScope,
    session: VisualReaderSession,
    bindings: Map<string, ClientBinding>
  ) {
    const [result] = await queryable.query(
      `UPDATE acquisition_visual_reader_sessions SET
         status = ?, expires_at = ?, session_json = ?,
         client_bindings_json = ?, updated_at = ?
       WHERE owner_id = ? AND team_id = ? AND session_id = ?`,
      [
        session.status,
        sqlDate(session.expiresAt),
        JSON.stringify(session),
        serializeBindings(bindings),
        sqlDate(session.updatedAt),
        scope.ownerId,
        scope.teamId,
        session.sessionId
      ]
    );
    if (affectedRows(result) !== 1) {
      throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
    }
  }

  private parseArtifact(scope: AcquisitionScope, row: MysqlRow): VisualReaderArtifact {
    const mediaType = rowString(row, "media_type");
    if (mediaType !== "image/webp") {
      throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
    }
    const metadata = {
      artifactId: rowString(row, "artifact_id"),
      observationId: rowString(row, "observation_id"),
      sessionId: rowString(row, "session_id"),
      mediaType,
      plaintextHash: rowString(row, "plaintext_hash"),
      byteLength: Number(row.byte_length),
      width: Number(row.width_px),
      height: Number(row.height_px),
      maskedRegionCount: Number(row.masked_region_count),
      createdAt: isoDate(row.created_at),
      expiresAt: isoDate(row.expires_at)
    } as const;
    const envelope: AcquisitionVisualArtifactEnvelope = {
      envelopeVersion: rowString(row, "envelope_version") as
        typeof ACQUISITION_VISUAL_ARTIFACT_ENVELOPE_VERSION,
      keyDerivationVersion: rowString(row, "key_derivation_version") as
        typeof ACQUISITION_VISUAL_ARTIFACT_KEY_DERIVATION_VERSION,
      algorithm: rowString(row, "algorithm") as
        typeof ACQUISITION_VISUAL_ARTIFACT_ALGORITHM,
      iv: Buffer.from(row.iv as Uint8Array),
      authTag: Buffer.from(row.auth_tag as Uint8Array),
      ciphertext: Buffer.from(row.ciphertext as Uint8Array)
    };
    return {
      ...metadata,
      plaintext: decryptAcquisitionVisualArtifact({
        masterSecret: this.masterSecret,
        context: {
          ownerId: scope.ownerId,
          teamId: scope.teamId,
          sessionId: metadata.sessionId,
          observationId: metadata.observationId,
          artifactId: metadata.artifactId,
          mediaType: metadata.mediaType,
          plaintextHash: metadata.plaintextHash,
          byteLength: metadata.byteLength
        },
        envelope
      })
    };
  }
}
