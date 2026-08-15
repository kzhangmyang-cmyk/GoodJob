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
  poisonAcquisitionMysqlConnection,
  releaseAcquisitionMysqlConnection,
  releaseAcquisitionMysqlNamedLocks
} from "./acquisition-mysql-named-lock.js";
import {
  ACQUISITION_VISUAL_READER_MAX_CLIENT_BINDINGS,
  ACQUISITION_VISUAL_READER_MAX_CLIENT_BINDINGS_BYTES,
  AcquisitionVisualReaderRepositoryError,
  assertAcquisitionVisualReaderClientBindingsBudget,
  assertAppendVisualObservationBatchInput,
  assertCreateVisualReaderSessionInput,
  assertDeleteExpiredVisualArtifactsInput,
  assertVisualCommentObservation,
  assertVisualReaderArtifactInput,
  assertVisualReaderIdentifier,
  assertVisualReaderOutcome,
  assertVisualReaderOutcomeShape,
  assertVisualReaderSession,
  assertVisualReaderScope,
  deriveVisualReaderOutcome,
  visualCardBoundsHash,
  visualObservationDedupeKey,
  visualObservationInputHash,
  visualObservationIsLowConfidence,
  visualReaderExpiredProjection,
  visualReaderSessionIsActiveAt,
  serializeAcquisitionVisualReaderClientBindings,
  type AcquisitionScope,
  type AcquisitionVisualReaderClientBinding,
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
    try {
      const [result] = await connection.query(
        "SELECT GET_LOCK(?, ?) AS lock_acquired",
        [VISUAL_SCHEMA_LOCK, 30]
      );
      const row = Array.isArray(result)
        ? result[0] as MysqlRow | undefined
        : undefined;
      if (Number(row?.lock_acquired) !== 1) throw new Error();
    } catch {
      poisonAcquisitionMysqlConnection(connection);
      throw new Error("ACQUISITION_VISUAL_READER_SCHEMA_LOCK_FAILED");
    }
    locked = true;
    for (const statement of ACQUISITION_VISUAL_READER_MYSQL_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    try {
      if (locked) {
        await releaseAcquisitionMysqlNamedLocks(connection, [VISUAL_SCHEMA_LOCK]);
      }
    } finally {
      releaseAcquisitionMysqlConnection(connection);
    }
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

function integrity(): never {
  throw new Error("ACQUISITION_VISUAL_READER_MYSQL_INTEGRITY");
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

function parseSession(
  row: MysqlRow,
  expectedScope?: AcquisitionScope
): VisualReaderSession {
  try {
    const session: unknown = jsonObject(row.session_json);
    assertVisualReaderSession(session);
    if (expectedScope
      && (rowString(row, "owner_id") !== expectedScope.ownerId
        || rowString(row, "team_id") !== expectedScope.teamId)) integrity();
    if (session.sessionId !== rowString(row, "session_id")
      || session.runId !== rowString(row, "run_id")
      || session.status !== rowString(row, "status")
      || session.expiresAt !== isoDate(row.expires_at)
      || session.updatedAt !== isoDate(row.updated_at)
      || !/^[0-9a-f]{64}$/u.test(rowString(row, "create_input_hash"))) {
      integrity();
    }
    parseBindings(row);
    return structuredClone(session);
  } catch {
    integrity();
  }
}

function parseBindings(row: MysqlRow) {
  try {
    const raw = row.client_bindings_json;
    if ((typeof raw === "string"
        && Buffer.byteLength(raw, "utf8")
          > ACQUISITION_VISUAL_READER_MAX_CLIENT_BINDINGS_BYTES)
      || (Buffer.isBuffer(raw)
        && raw.byteLength
          > ACQUISITION_VISUAL_READER_MAX_CLIENT_BINDINGS_BYTES)) {
      integrity();
    }
    const value = jsonObject(raw);
    const entries = Object.entries(value);
    if (entries.length > ACQUISITION_VISUAL_READER_MAX_CLIENT_BINDINGS) {
      integrity();
    }
    const bindings = new Map<string, AcquisitionVisualReaderClientBinding>();
    for (const [key, candidate] of entries) {
      assertVisualReaderIdentifier(key);
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || Object.keys(candidate).length !== 2
        || !Object.hasOwn(candidate, "inputHash")
        || !Object.hasOwn(candidate, "observationId")
        || typeof (candidate as AcquisitionVisualReaderClientBinding)
          .inputHash !== "string"
        || !/^[0-9a-f]{64}$/u.test(
          (candidate as AcquisitionVisualReaderClientBinding).inputHash)
        || typeof (candidate as AcquisitionVisualReaderClientBinding)
          .observationId !== "string") {
        integrity();
      }
      assertVisualReaderIdentifier(
        (candidate as AcquisitionVisualReaderClientBinding).observationId);
      bindings.set(key, structuredClone(
        candidate as AcquisitionVisualReaderClientBinding));
    }
    if (Buffer.byteLength(
      serializeAcquisitionVisualReaderClientBindings(bindings),
      "utf8"
    ) > ACQUISITION_VISUAL_READER_MAX_CLIENT_BINDINGS_BYTES) integrity();
    return bindings;
  } catch {
    integrity();
  }
}

function parseObservation(
  row: MysqlRow,
  expected: {
    scope: AcquisitionScope;
    sessionId?: string;
    runId?: string;
    bindings?: Map<string, AcquisitionVisualReaderClientBinding>;
  }
) {
  try {
    const observation: unknown = jsonObject(row.observation_json);
    const storedSessionId = rowString(row, "session_id");
    assertVisualCommentObservation(
      observation as DouyinVisualCommentObservationV1,
      expected.sessionId ?? storedSessionId
    );
    const normalized = observation as DouyinVisualCommentObservationV1;
    const clientObservationKey = rowString(row, "client_observation_key");
    assertVisualReaderIdentifier(clientObservationKey);
    const storedRunId = rowString(row, "run_id");
    assertVisualReaderIdentifier(storedRunId);
    if (rowString(row, "owner_id") !== expected.scope.ownerId
      || rowString(row, "team_id") !== expected.scope.teamId
      || normalized.observationId !== rowString(row, "observation_id")
      || normalized.sessionId !== storedSessionId
      || (expected.sessionId && storedSessionId !== expected.sessionId)
      || (expected.runId && storedRunId !== expected.runId)
      || normalized.sourceUrl !== rowString(row, "source_url")
      || normalized.viewportHash !== rowString(row, "viewport_hash")
      || visualCardBoundsHash(normalized.cardBounds)
        !== rowString(row, "card_bounds_hash")
      || normalized.textHash !== rowString(row, "text_hash")
      || normalized.videoId !== rowString(row, "video_id")
      || normalized.capturedAt !== isoDate(row.captured_at)) {
      integrity();
    }
    if (expected.bindings) {
      const binding = expected.bindings.get(clientObservationKey);
      if (!binding || binding.observationId !== normalized.observationId) {
        integrity();
      }
    }
    return structuredClone(normalized);
  } catch {
    integrity();
  }
}

function duplicateEntry(error: unknown) {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062;
}

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
}

function binaryView(value: unknown, expectedLength?: number) {
  if (!ArrayBuffer.isView(value)) integrity();
  const bytes = Buffer.from(
    value.buffer,
    value.byteOffset,
    value.byteLength
  );
  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    integrity();
  }
  return Buffer.from(bytes);
}

function boundedRowInteger(
  row: MysqlRow,
  key: string,
  minimum: number,
  maximum: number
) {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    integrity();
  }
  return value;
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
      return parseSession(existing, input.scope);
    }
  }

  async appendObservationBatch(input: AppendVisualObservationBatchInput) {
    const usageDelta = assertAppendVisualObservationBatchInput(input);
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const row = await selectSession(
        connection as unknown as Queryable,
        input.scope,
        input.sessionId,
        true
      );
      if (!row) fail("VISUAL_READER_SESSION_NOT_FOUND");
      const session = parseSession(row, input.scope);
      const now = this.now();
      sqlDate(now);
      if (Date.parse(now) >= Date.parse(session.expiresAt)
        && !["completed", "partial_success", "aborted", "expired"].includes(
          session.status
        )) {
        await this.updateSession(
          connection as unknown as Queryable,
          input.scope,
          visualReaderExpiredProjection(session, session.expiresAt),
          parseBindings(row)
        );
        await connection.commit();
        transactionStarted = false;
        fail("VISUAL_READER_SESSION_EXPIRED");
      }
      if (["completed", "partial_success", "aborted", "expired"].includes(
        session.status
      )) fail("VISUAL_READER_SESSION_TERMINAL");

      for (const item of input.observations) {
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
      const bindings = parseBindings(row);
      const existingObservations = existingRows.map((existingRow) =>
        parseObservation(existingRow, {
          scope: input.scope,
          sessionId: input.sessionId,
          runId: session.runId,
          bindings
        }));
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

      assertAcquisitionVisualReaderClientBindingsBudget(bindings);

      let nextSession = session;
      if (accepted.length > 0) {
        const acceptedOcrCount = accepted.filter(({ observation }) =>
          observation.extractionMethod === "ocr").length;
        const usage: VisualReaderUsage = {
          videoCount: videoCounts.size,
          observationCount: session.usage.observationCount + accepted.length,
          scrollCount: session.usage.scrollCount + usageDelta.scrollCount,
          ocrCallCount: session.usage.ocrCallCount
            + Math.max(usageDelta.ocrCallCount, acceptedOcrCount),
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
          try {
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
          } catch (error) {
            if (duplicateEntry(error)) fail("VISUAL_READER_ARTIFACT_CONFLICT");
            throw error;
          }
        }
      }
      await this.updateSession(connection as unknown as Queryable, input.scope,
        nextSession, bindings);
      await connection.commit();
      transactionStarted = false;
      return {
        accepted: accepted.map(({ observation }) => structuredClone(observation)),
        duplicates
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          poisonAcquisitionMysqlConnection(connection);
        }
      }
      if (duplicateEntry(error)) fail("VISUAL_READER_OBSERVATION_CONFLICT");
      throw error;
    } finally {
      releaseAcquisitionMysqlConnection(connection);
    }
  }

  async completeSession(
    scope: AcquisitionScope,
    sessionId: string,
    outcome: VisualReaderOutcome
  ) {
    assertVisualReaderScope(scope);
    assertVisualReaderIdentifier(sessionId);
    assertVisualReaderOutcomeShape(outcome);
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const row = await selectSession(
        connection as unknown as Queryable,
        scope,
        sessionId,
        true
      );
      if (!row) fail("VISUAL_READER_SESSION_NOT_FOUND");
      const session = parseSession(row, scope);
      const now = this.now();
      sqlDate(now);
      const terminal = [
        "completed", "partial_success", "aborted", "expired"
      ].includes(session.status);
      const expiredNow = Date.parse(now) >= Date.parse(session.expiresAt);
      if (terminal) {
        if (session.outcome && canonical(session.outcome) === canonical(outcome)) {
          await connection.commit();
          transactionStarted = false;
          return session;
        }
        fail("VISUAL_READER_SESSION_CONFLICT");
      }
      if (expiredNow) {
        const expired = visualReaderExpiredProjection(
          session,
          session.expiresAt
        );
        await this.updateSession(
          connection as unknown as Queryable,
          scope,
          expired,
          parseBindings(row)
        );
        await connection.commit();
        transactionStarted = false;
        if (canonical(expired.outcome) === canonical(outcome)) {
          return structuredClone(expired);
        }
        fail("VISUAL_READER_SESSION_EXPIRED");
      }
      assertVisualReaderOutcome(outcome, session.usage);
      const derived = deriveVisualReaderOutcome(outcome.status, session.usage,
        outcome.errorCodes);
      const completed: VisualReaderSession = {
        ...session,
        status: outcome.status,
        outcome: structuredClone(derived),
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
      transactionStarted = false;
      return structuredClone(completed);
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          poisonAcquisitionMysqlConnection(connection);
        }
      }
      throw error;
    } finally {
      releaseAcquisitionMysqlConnection(connection);
    }
  }

  async getSession(scope: AcquisitionScope, sessionId: string) {
    assertVisualReaderScope(scope);
    assertVisualReaderIdentifier(sessionId);
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const row = await selectSession(
        connection as unknown as Queryable,
        scope,
        sessionId,
        true
      );
      if (!row) {
        await connection.commit();
        transactionStarted = false;
        return null;
      }
      const session = parseSession(row, scope);
      const now = this.now();
      sqlDate(now);
      if (visualReaderSessionIsActiveAt(session, now)
        || ["completed", "partial_success", "aborted", "expired"].includes(
          session.status
        )) {
        await connection.commit();
        transactionStarted = false;
        return session;
      }
      const expired = visualReaderExpiredProjection(
        session,
        session.expiresAt
      );
      await this.updateSession(
        connection as unknown as Queryable,
        scope,
        expired,
        parseBindings(row)
      );
      await connection.commit();
      transactionStarted = false;
      return expired;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          poisonAcquisitionMysqlConnection(connection);
        }
      }
      throw error;
    } finally {
      releaseAcquisitionMysqlConnection(connection);
    }
  }

  async listRunObservations(
    scope: AcquisitionScope,
    runId: string,
    options: { limit: number }
  ) {
    assertVisualReaderScope(scope);
    assertVisualReaderIdentifier(runId);
    if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).length !== 1
      || !Object.hasOwn(options, "limit")
      || !Number.isSafeInteger(options.limit)
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
      .map((row) => parseObservation(row, { scope, runId }))
      .sort((left, right) =>
        left.capturedAt.localeCompare(right.capturedAt)
        || left.observationId.localeCompare(right.observationId))
      .slice(0, options.limit);
  }

  async getArtifact(scope: AcquisitionScope, artifactId: string) {
    assertVisualReaderScope(scope);
    assertVisualReaderIdentifier(artifactId);
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
    assertDeleteExpiredVisualArtifactsInput(input);
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
    bindings: Map<string, AcquisitionVisualReaderClientBinding>
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
        serializeAcquisitionVisualReaderClientBindings(bindings),
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
    try {
      if (rowString(row, "owner_id") !== scope.ownerId
        || rowString(row, "team_id") !== scope.teamId) integrity();
      const artifactId = rowString(row, "artifact_id");
      const observationId = rowString(row, "observation_id");
      const sessionId = rowString(row, "session_id");
      assertVisualReaderIdentifier(artifactId);
      assertVisualReaderIdentifier(observationId);
      assertVisualReaderIdentifier(sessionId);
      const mediaType = rowString(row, "media_type");
      const plaintextHash = rowString(row, "plaintext_hash");
      if (mediaType !== "image/webp"
        || !/^sha256:[0-9a-f]{64}$/u.test(plaintextHash)) integrity();
      const createdAt = isoDate(row.created_at);
      const expiresAt = isoDate(row.expires_at);
      const createdTime = Date.parse(createdAt);
      const expiresTime = Date.parse(expiresAt);
      if (expiresTime <= createdTime
        || expiresTime - createdTime > 30 * 24 * 60 * 60_000) integrity();
      const metadata = {
        artifactId,
        observationId,
        sessionId,
        mediaType,
        plaintextHash,
        byteLength: boundedRowInteger(row, "byte_length", 1, 262_144),
        width: boundedRowInteger(row, "width_px", 1, 8_192),
        height: boundedRowInteger(row, "height_px", 1, 8_192),
        maskedRegionCount: boundedRowInteger(
          row,
          "masked_region_count",
          1,
          100
        ),
        createdAt,
        expiresAt
      } as const;
      const envelopeVersion = rowString(row, "envelope_version");
      const keyDerivationVersion = rowString(row, "key_derivation_version");
      const algorithm = rowString(row, "algorithm");
      if (envelopeVersion !== ACQUISITION_VISUAL_ARTIFACT_ENVELOPE_VERSION
        || keyDerivationVersion
          !== ACQUISITION_VISUAL_ARTIFACT_KEY_DERIVATION_VERSION
        || algorithm !== ACQUISITION_VISUAL_ARTIFACT_ALGORITHM) integrity();
      const envelope: AcquisitionVisualArtifactEnvelope = {
        envelopeVersion,
        keyDerivationVersion,
        algorithm,
        iv: binaryView(row.iv, 12),
        authTag: binaryView(row.auth_tag, 16),
        ciphertext: binaryView(row.ciphertext, metadata.byteLength)
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
    } catch {
      integrity();
    }
  }
}
