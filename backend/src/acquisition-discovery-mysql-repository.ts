import type mysql from "mysql2/promise";
import {
  AcquisitionDiscoveryOperationError,
  type AcquisitionContentFetchOperationRecord,
  type AcquisitionDiscoveryOperationRepository,
  type AcquisitionDiscoveryScope,
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
    payload_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_acquisition_fetch_scope (owner_id, team_id, id),
    UNIQUE KEY uk_acquisition_fetch_idempotency
      (owner_id, team_id, idempotency_key_hash),
    KEY idx_acquisition_fetch_scope_status
      (owner_id, team_id, status, updated_at, id),
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
    payload_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_acquisition_import_scope (owner_id, team_id, id),
    UNIQUE KEY uk_acquisition_import_idempotency
      (owner_id, team_id, idempotency_key_hash),
    KEY idx_acquisition_import_scope_status
      (owner_id, team_id, status, updated_at, id),
    CONSTRAINT chk_acquisition_import_status CHECK (
      status IN (
        'queued','running','succeeded','partial_success','failed'
      )
    )
  ) ENGINE=InnoDB`
] as const;

export async function ensureAcquisitionDiscoveryMysqlSchema(
  pool: mysql.Pool
) {
  for (const statement of ACQUISITION_DISCOVERY_MYSQL_SCHEMA_STATEMENTS) {
    await pool.query(statement);
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
    startedAt: string
  ) {
    const [result] = await this.pool.query(
      `UPDATE acquisition_content_fetch_operations
       SET status = 'running',
           payload_json = JSON_SET(
             payload_json,
             '$.status', 'running',
             '$.startedAt', ?,
             '$.errorCode', CAST('null' AS JSON)
           ),
           updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?
         AND status = 'queued'`,
      [
        startedAt,
        mysqlDate(startedAt),
        id,
        scope.ownerId,
        scope.teamId
      ]
    );
    const operation = await this.getContentFetchOperation(scope, id);
    return {
      operation,
      claimed: affectedRows(result) === 1
    };
  }

  async putContentFetchOperation(
    operation: AcquisitionContentFetchOperationRecord
  ) {
    const [result] = await this.pool.query(
      `UPDATE acquisition_content_fetch_operations
       SET status = ?, payload_json = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?`,
      [
        operation.status,
        json(operation),
        mysqlDate(operation.completedAt ?? operation.startedAt
          ?? operation.createdAt),
        operation.id,
        operation.ownerId,
        operation.teamId
      ]
    );
    if (affectedRows(result) !== 1) {
      throw new AcquisitionDiscoveryOperationError(
        "RESOURCE_NOT_FOUND"
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
    startedAt: string
  ) {
    const [result] = await this.pool.query(
      `UPDATE acquisition_import_operations
       SET status = 'running',
           payload_json = JSON_SET(
             payload_json,
             '$.status', 'running',
             '$.startedAt', ?,
             '$.errorCode', CAST('null' AS JSON)
           ),
           updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?
         AND status = 'queued'`,
      [
        startedAt,
        mysqlDate(startedAt),
        id,
        scope.ownerId,
        scope.teamId
      ]
    );
    const operation = await this.getImportOperation(scope, id);
    return {
      operation,
      claimed: affectedRows(result) === 1
    };
  }

  async putImportOperation(
    operation: AcquisitionImportOperationRecord
  ) {
    const [result] = await this.pool.query(
      `UPDATE acquisition_import_operations
       SET status = ?, payload_json = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND team_id = ?`,
      [
        operation.status,
        json(operation),
        mysqlDate(operation.completedAt ?? operation.startedAt
          ?? operation.createdAt),
        operation.id,
        operation.ownerId,
        operation.teamId
      ]
    );
    if (affectedRows(result) !== 1) {
      throw new AcquisitionDiscoveryOperationError(
        "RESOURCE_NOT_FOUND"
      );
    }
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
