import type mysql from "mysql2/promise";
import {
  AcquisitionDiscoveryOperationError,
  type AcquisitionDiscoveryClaim,
  type AcquisitionContentFetchOperationRecord,
  type AcquisitionDiscoveryOperationRepository,
  type AcquisitionDiscoveryRecoveryQuery,
  type AcquisitionDiscoveryScope,
  type AcquisitionRecoverableDiscoveryOperation,
  type AcquisitionImportOperationRecord
} from "./acquisition-discovery-operations.js";

type QuerySource = Pick<mysql.Pool | mysql.PoolConnection, "query">;
type MysqlRow = Record<string, unknown>;
type OperationScope = Pick<
  AcquisitionDiscoveryScope,
  "ownerId" | "teamId"
>;

export const ACQUISITION_DISCOVERY_MYSQL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS acquisition_content_fetch_operations (
    id VARCHAR(160) PRIMARY KEY,
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    idempotency_key_hash CHAR(64) NOT NULL,
    request_hash CHAR(71) NOT NULL,
    status VARCHAR(30) NOT NULL,
    lease_owner VARCHAR(160) NULL,
    lease_token VARCHAR(200) NULL,
    lease_expires_at DATETIME(3) NULL,
    payload_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_acquisition_fetch_scope (owner_id, team_id, id),
    UNIQUE KEY uk_acquisition_fetch_idempotency
      (owner_id, team_id, idempotency_key_hash),
    KEY idx_acquisition_fetch_scope_status
      (owner_id, team_id, status, updated_at, id),
    KEY idx_acquisition_fetch_recovery
      (status, lease_expires_at, updated_at, created_at, id),
    CONSTRAINT chk_acquisition_fetch_status CHECK (
      status IN (
        'queued','running','succeeded','failed','access_restricted'
      )
    )
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS acquisition_import_operations (
    id VARCHAR(160) PRIMARY KEY,
    owner_id VARCHAR(100) NOT NULL,
    team_id VARCHAR(100) NOT NULL,
    idempotency_key_hash CHAR(64) NOT NULL,
    request_hash CHAR(71) NOT NULL,
    status VARCHAR(30) NOT NULL,
    lease_owner VARCHAR(160) NULL,
    lease_token VARCHAR(200) NULL,
    lease_expires_at DATETIME(3) NULL,
    payload_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_acquisition_import_scope (owner_id, team_id, id),
    UNIQUE KEY uk_acquisition_import_idempotency
      (owner_id, team_id, idempotency_key_hash),
    KEY idx_acquisition_import_scope_status
      (owner_id, team_id, status, updated_at, id),
    KEY idx_acquisition_import_recovery
      (status, lease_expires_at, updated_at, created_at, id),
    CONSTRAINT chk_acquisition_import_status CHECK (
      status IN (
        'queued','running','succeeded','partial_success','failed'
      )
    )
  ) ENGINE=InnoDB`,
  `ALTER TABLE acquisition_content_fetch_operations
    ADD COLUMN lease_owner VARCHAR(160) NULL`,
  `ALTER TABLE acquisition_content_fetch_operations
    ADD COLUMN lease_token VARCHAR(200) NULL`,
  `ALTER TABLE acquisition_content_fetch_operations
    ADD COLUMN lease_expires_at DATETIME(3) NULL`,
  `ALTER TABLE acquisition_content_fetch_operations
    ADD KEY idx_acquisition_fetch_recovery
      (status, lease_expires_at, updated_at, created_at, id)`,
  `ALTER TABLE acquisition_import_operations
    ADD COLUMN lease_owner VARCHAR(160) NULL`,
  `ALTER TABLE acquisition_import_operations
    ADD COLUMN lease_token VARCHAR(200) NULL`,
  `ALTER TABLE acquisition_import_operations
    ADD COLUMN lease_expires_at DATETIME(3) NULL`,
  `ALTER TABLE acquisition_import_operations
    ADD KEY idx_acquisition_import_recovery
      (status, lease_expires_at, updated_at, created_at, id)`
] as const;

export async function ensureAcquisitionDiscoveryMysqlSchema(
  pool: mysql.Pool
) {
  for (const statement of ACQUISITION_DISCOVERY_MYSQL_SCHEMA_STATEMENTS) {
    try {
      await pool.query(statement);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (
        code !== "ER_DUP_FIELDNAME"
        && code !== "ER_DUP_KEYNAME"
      ) {
        throw error;
      }
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mysqlDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("ACQUISITION_DISCOVERY_MYSQL_INVALID_DATE");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function parsePayload(value: unknown, resource: string) {
  try {
    const parsed = typeof value === "string"
      ? JSON.parse(value)
      : Buffer.isBuffer(value)
        ? JSON.parse(value.toString("utf8"))
        : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(
      `ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:${resource}:invalid_json`
    );
  }
}

function requiredString(
  record: Record<string, unknown>,
  key: string
) {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new Error(
      `ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:${key}:invalid_string`
    );
  }
  return value;
}

function parsedFetch(row: MysqlRow) {
  const payload = parsePayload(
    row.payload_json,
    "content_fetch_operation"
  );
  requiredString(payload, "id");
  requiredString(payload, "ownerId");
  requiredString(payload, "teamId");
  requiredString(payload, "idempotencyKeyHash");
  requiredString(payload, "requestHash");
  if (![
    "queued",
    "running",
    "succeeded",
    "failed",
    "access_restricted"
  ].includes(String(payload.status))) {
    throw new Error(
      "ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:fetch_status"
    );
  }
  if (!Number.isSafeInteger(payload.evidenceCount)
    || Number(payload.evidenceCount) < 0) {
    throw new Error(
      "ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:evidence_count"
    );
  }
  if (payload.evidenceIds === undefined) {
    if ([
      "succeeded",
      "access_restricted"
    ].includes(String(payload.status))
      || Number(payload.evidenceCount) > 0) {
      payload.status = "failed";
      payload.evidenceCount = 0;
      payload.evidenceIds = [];
      payload.errorCode =
        "LEGACY_EVIDENCE_IDS_UNAVAILABLE_REFETCH_REQUIRED";
    } else {
      payload.evidenceIds = [];
    }
  } else if (!Array.isArray(payload.evidenceIds)
    || payload.evidenceIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error(
      "ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:evidence_ids"
    );
  }
  const evidenceIds = payload.evidenceIds as string[];
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error(
      "ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:evidence_ids_duplicate"
    );
  }
  if (Number(payload.evidenceCount) !== evidenceIds.length) {
    throw new Error(
      "ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:evidence_count_mismatch"
    );
  }
  const successful = [
    "succeeded",
    "access_restricted"
  ].includes(String(payload.status));
  if ((successful && evidenceIds.length !== 1)
    || (!successful && evidenceIds.length !== 0)) {
    throw new Error(
      "ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:evidence_status_mismatch"
    );
  }
  return payload as unknown as AcquisitionContentFetchOperationRecord;
}

function parsedImport(row: MysqlRow) {
  const payload = parsePayload(
    row.payload_json,
    "import_operation"
  );
  requiredString(payload, "id");
  requiredString(payload, "ownerId");
  requiredString(payload, "teamId");
  requiredString(payload, "idempotencyKeyHash");
  requiredString(payload, "requestHash");
  requiredString(payload, "artifactCiphertext");
  if (![
    "queued",
    "running",
    "succeeded",
    "partial_success",
    "failed"
  ].includes(String(payload.status))) {
    throw new Error(
      "ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:import_status"
    );
  }
  return payload as unknown as AcquisitionImportOperationRecord;
}

function duplicateEntry(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { errno?: unknown; code?: unknown };
  return candidate.errno === 1062 || candidate.code === "ER_DUP_ENTRY";
}

function affectedRows(result: unknown) {
  return Number(
    (result as { affectedRows?: unknown } | null)?.affectedRows ?? 0
  );
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function recoverableRow(
  row: MysqlRow
): AcquisitionRecoverableDiscoveryOperation {
  const payload = parsePayload(row.payload_json, "recovery_operation");
  const kind = "artifactCiphertext" in payload
    ? "import"
    : "content_fetch";
  return {
    kind,
    id: requiredString(payload, "id"),
    ownerId: requiredString(payload, "ownerId"),
    teamId: requiredString(payload, "teamId"),
    actorId: requiredString(payload, "actorId"),
    status: requiredString(
      payload,
      "status"
    ) as AcquisitionRecoverableDiscoveryOperation["status"],
    createdAt: requiredString(payload, "createdAt")
  };
}

async function selectedRows(
  source: QuerySource,
  sql: string,
  values: unknown[]
) {
  const [rows] = await source.query(sql, values);
  return Array.isArray(rows) ? rows as MysqlRow[] : [];
}

export class MysqlAcquisitionDiscoveryOperationRepository
implements AcquisitionDiscoveryOperationRepository {
  constructor(private readonly pool: mysql.Pool) {}

  async createContentFetchOperation(
    operation: AcquisitionContentFetchOperationRecord
  ) {
    try {
      await this.pool.query(
        `INSERT INTO acquisition_content_fetch_operations (
          id, owner_id, team_id, idempotency_key_hash, request_hash,
          status, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          operation.id,
          operation.ownerId,
          operation.teamId,
          operation.idempotencyKeyHash,
          operation.requestHash,
          operation.status,
          json(operation),
          mysqlDate(operation.createdAt),
          mysqlDate(operation.createdAt)
        ]
      );
      return { operation: clone(operation), created: true };
    } catch (error) {
      if (!duplicateEntry(error)) throw error;
      const existing = await this.getFetchByIdempotency(operation);
      if (!existing) throw error;
      if (existing.requestHash !== operation.requestHash) {
        throw new AcquisitionDiscoveryOperationError(
          "IDEMPOTENCY_CONFLICT"
        );
      }
      return { operation: existing, created: false };
    }
  }

  async getContentFetchOperation(
    scope: OperationScope,
    id: string
  ) {
    const rows = await selectedRows(
      this.pool,
      `SELECT payload_json
       FROM acquisition_content_fetch_operations
       WHERE id = ? AND owner_id = ? AND team_id = ?
       LIMIT 1`,
      [id, scope.ownerId, scope.teamId]
    );
    return rows[0] ? parsedFetch(rows[0]) : null;
  }

  async listContentFetchOperations(
    scope: OperationScope,
    limit: number
  ) {
    const rows = await selectedRows(
      this.pool,
      `SELECT payload_json
       FROM acquisition_content_fetch_operations
       WHERE owner_id = ? AND team_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [scope.ownerId, scope.teamId, limit]
    );
    return rows.map(parsedFetch);
  }

  async claimContentFetchOperation(
    scope: OperationScope,
    id: string,
    claim: AcquisitionDiscoveryClaim
  ) {
    const [result] = await this.pool.query(
      `UPDATE acquisition_content_fetch_operations
       SET status = 'running',
           lease_owner = ?,
           lease_token = ?,
           lease_expires_at = ?,
           payload_json = JSON_SET(
             payload_json,
             '$.status', 'running',
             '$.startedAt', ?,
             '$.leaseOwner', ?,
             '$.leaseToken', ?,
             '$.leaseExpiresAt', ?,
             '$.errorCode', CAST('null' AS JSON)
           ),
           updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?
         AND (
           status = 'queued'
           OR (
             status = 'running'
             AND (
               lease_expires_at <= ?
               OR (
                 lease_expires_at IS NULL
                 AND updated_at <= ?
               )
             )
           )
         )`,
      [
        claim.leaseOwner,
        claim.leaseToken,
        mysqlDate(claim.leaseExpiresAt),
        claim.claimedAt,
        claim.leaseOwner,
        claim.leaseToken,
        claim.leaseExpiresAt,
        mysqlDate(claim.claimedAt),
        id,
        scope.ownerId,
        scope.teamId,
        mysqlDate(claim.claimedAt),
        mysqlDate(claim.staleRunningBefore)
      ]
    );
    const operation = await this.getContentFetchOperation(scope, id);
    return {
      operation,
      claimed: affectedRows(result) === 1
    };
  }

  async putContentFetchOperation(
    operation: AcquisitionContentFetchOperationRecord,
    leaseToken: string
  ) {
    const stored = {
      ...operation,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null
    };
    const [result] = await this.pool.query(
      `UPDATE acquisition_content_fetch_operations
       SET status = ?,
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           payload_json = ?,
           updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?
         AND status = 'running' AND lease_token = ?`,
      [
        stored.status,
        json(stored),
        mysqlDate(operation.completedAt ?? operation.startedAt
          ?? operation.createdAt),
        operation.id,
        operation.ownerId,
        operation.teamId,
        leaseToken
      ]
    );
    if (affectedRows(result) !== 1) {
      throw new AcquisitionDiscoveryOperationError(
        "OPERATION_ALREADY_RUNNING",
        "OPERATION_LEASE_LOST"
      );
    }
  }

  async createImportOperation(
    operation: AcquisitionImportOperationRecord
  ) {
    try {
      await this.pool.query(
        `INSERT INTO acquisition_import_operations (
          id, owner_id, team_id, idempotency_key_hash, request_hash,
          status, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          operation.id,
          operation.ownerId,
          operation.teamId,
          operation.idempotencyKeyHash,
          operation.requestHash,
          operation.status,
          json(operation),
          mysqlDate(operation.createdAt),
          mysqlDate(operation.createdAt)
        ]
      );
      return { operation: clone(operation), created: true };
    } catch (error) {
      if (!duplicateEntry(error)) throw error;
      const existing = await this.getImportByIdempotency(operation);
      if (!existing) throw error;
      if (existing.requestHash !== operation.requestHash) {
        throw new AcquisitionDiscoveryOperationError(
          "IDEMPOTENCY_CONFLICT"
        );
      }
      return { operation: existing, created: false };
    }
  }

  async getImportOperation(scope: OperationScope, id: string) {
    const rows = await selectedRows(
      this.pool,
      `SELECT payload_json
       FROM acquisition_import_operations
       WHERE id = ? AND owner_id = ? AND team_id = ?
       LIMIT 1`,
      [id, scope.ownerId, scope.teamId]
    );
    return rows[0] ? parsedImport(rows[0]) : null;
  }

  async listImportOperations(scope: OperationScope, limit: number) {
    const rows = await selectedRows(
      this.pool,
      `SELECT payload_json
       FROM acquisition_import_operations
       WHERE owner_id = ? AND team_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [scope.ownerId, scope.teamId, limit]
    );
    return rows.map(parsedImport);
  }

  async claimImportOperation(
    scope: OperationScope,
    id: string,
    claim: AcquisitionDiscoveryClaim
  ) {
    const [result] = await this.pool.query(
      `UPDATE acquisition_import_operations
       SET status = 'running',
           lease_owner = ?,
           lease_token = ?,
           lease_expires_at = ?,
           payload_json = JSON_SET(
             payload_json,
             '$.status', 'running',
             '$.startedAt', ?,
             '$.leaseOwner', ?,
             '$.leaseToken', ?,
             '$.leaseExpiresAt', ?,
             '$.errorCode', CAST('null' AS JSON)
           ),
           updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?
         AND (
           status = 'queued'
           OR (
             status = 'running'
             AND (
               lease_expires_at <= ?
               OR (
                 lease_expires_at IS NULL
                 AND updated_at <= ?
               )
             )
           )
         )`,
      [
        claim.leaseOwner,
        claim.leaseToken,
        mysqlDate(claim.leaseExpiresAt),
        claim.claimedAt,
        claim.leaseOwner,
        claim.leaseToken,
        claim.leaseExpiresAt,
        mysqlDate(claim.claimedAt),
        id,
        scope.ownerId,
        scope.teamId,
        mysqlDate(claim.claimedAt),
        mysqlDate(claim.staleRunningBefore)
      ]
    );
    const operation = await this.getImportOperation(scope, id);
    return {
      operation,
      claimed: affectedRows(result) === 1
    };
  }

  async putImportOperation(
    operation: AcquisitionImportOperationRecord,
    leaseToken: string
  ) {
    const stored = {
      ...operation,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null
    };
    const [result] = await this.pool.query(
      `UPDATE acquisition_import_operations
       SET status = ?,
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           payload_json = ?,
           updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?
         AND status = 'running' AND lease_token = ?`,
      [
        stored.status,
        json(stored),
        mysqlDate(operation.completedAt ?? operation.startedAt
          ?? operation.createdAt),
        operation.id,
        operation.ownerId,
        operation.teamId,
        leaseToken
      ]
    );
    if (affectedRows(result) !== 1) {
      throw new AcquisitionDiscoveryOperationError(
        "OPERATION_ALREADY_RUNNING",
        "OPERATION_LEASE_LOST"
      );
    }
  }

  async listRecoverableOperations(
    input: AcquisitionDiscoveryRecoveryQuery
  ) {
    const rows = await selectedRows(
      this.pool,
      `SELECT payload_json, created_at, id
       FROM (
         SELECT payload_json, created_at, id
         FROM acquisition_content_fetch_operations
         WHERE status = 'queued'
           OR (
             status = 'running'
             AND (
               lease_expires_at <= ?
               OR (
                 lease_expires_at IS NULL
                 AND updated_at <= ?
               )
             )
           )
         UNION ALL
         SELECT payload_json, created_at, id
         FROM acquisition_import_operations
         WHERE status = 'queued'
           OR (
             status = 'running'
             AND (
               lease_expires_at <= ?
               OR (
                 lease_expires_at IS NULL
                 AND updated_at <= ?
               )
             )
           )
       ) recoverable
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
      [
        mysqlDate(input.now),
        mysqlDate(input.staleRunningBefore),
        mysqlDate(input.now),
        mysqlDate(input.staleRunningBefore),
        input.limit
      ]
    );
    return rows.map(recoverableRow);
  }

  private async getFetchByIdempotency(
    operation: AcquisitionContentFetchOperationRecord
  ) {
    const rows = await selectedRows(
      this.pool,
      `SELECT payload_json
       FROM acquisition_content_fetch_operations
       WHERE owner_id = ? AND team_id = ?
         AND idempotency_key_hash = ?
       LIMIT 1`,
      [
        operation.ownerId,
        operation.teamId,
        operation.idempotencyKeyHash
      ]
    );
    return rows[0] ? parsedFetch(rows[0]) : null;
  }

  private async getImportByIdempotency(
    operation: AcquisitionImportOperationRecord
  ) {
    const rows = await selectedRows(
      this.pool,
      `SELECT payload_json
       FROM acquisition_import_operations
       WHERE owner_id = ? AND team_id = ?
         AND idempotency_key_hash = ?
       LIMIT 1`,
      [
        operation.ownerId,
        operation.teamId,
        operation.idempotencyKeyHash
      ]
    );
    return rows[0] ? parsedImport(rows[0]) : null;
  }
}
