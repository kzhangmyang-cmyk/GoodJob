import type mysql from "mysql2/promise";
import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import {
  FINANCIAL_COUNCIL_RUN_STATUSES,
  applyFinancialCouncilTransition,
  createFinancialCouncilRunEvent,
  financialCouncilAggregateHash,
  financialCouncilCanonicalJson,
  financialCouncilCanonicalHash,
  financialCouncilError,
  financialCouncilTransitionIsAllowed,
  immutableFinancialCouncilValue,
  type FinancialCouncilRun,
  type FinancialCouncilRunEvent,
  type FinancialCouncilTransitionKind,
  type FinancialSnapshotRecord
} from "./financial-council-domain.js";
import {
  assertFinancialSnapshotRecord,
  assertFinancialSnapshotFreezeTime,
  assertFinancialCouncilRunHistory,
  assertFinancialCouncilRunValue,
  assertFinancialSnapshotRecordValue,
  validateFinancialCouncilCreateMutation,
  validateFinancialCouncilCreateAndFreezeMutation,
  validateListRunnableFinancialCouncilRunsInput,
  validateFinancialCouncilStoreSnapshotMutation,
  validateFinancialCouncilTransitionMutation,
  validateFinancialCouncilSpecialistResult,
  type FinancialCouncilCommandResult,
  type CreateAndFreezeFinancialCouncilRunInput,
  type FinancialCouncilRepository,
  type FinancialCouncilFindingDisposition,
  type FinancialCouncilRebuttalAttempt,
  type InitialFinancialCouncilFindingDisposition,
  type CompleteFinancialCouncilRebuttalInput,
  type FinancialCouncilSpecialistPhase,
  type FinancialCouncilSpecialistResult,
  type ListRunnableFinancialCouncilRunsInput,
  type StoreFrozenFinancialSnapshotInput,
  type TransitionFinancialCouncilRunInput,
  type VerifiedFinancialCouncilRunSnapshot
} from "./financial-council-repository.js";
import type { FinancialCouncilAuditGraph } from
  "./financial-council-audit.js";
import {
  assertFinancialCouncilSpecialistResultAuthorized,
  type AuthorizedFinancialCouncilSpecialistResult
} from "./financial-council-finding-validator.js";
import { validateFinancialSnapshotForRun } from
  "./financial-council-snapshot.js";
import type { FinancialCouncilAgentRole } from "./growth-contract-types.js";
import type { FinancialCouncilRebutInput } from
  "./financial-council-model-port.js";

type MysqlRow = Record<string, unknown>;

export const FINANCIAL_COUNCIL_MYSQL_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS financial_council_runs (
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    creation_key_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    snapshot_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    snapshot_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NULL,
    run_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (workspace_id, run_id),
    UNIQUE KEY uk_financial_council_creation
      (workspace_id, creation_key_hash),
    CONSTRAINT chk_financial_council_run_json CHECK (JSON_VALID(run_json)),
    CONSTRAINT chk_financial_council_run_status CHECK (status IN
      ('created','snapshot_frozen','analyzing','auditing','synthesizing',
       'optimizing','awaiting_approval','approved','rejected','expired',
       'failed','not_computable'))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_run_events (
    event_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    reason_code VARCHAR(200) NULL,
    occurred_at DATETIME(3) NOT NULL,
    actor_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    aggregate_snapshot_hash CHAR(71)
      CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    aggregate_snapshot_json LONGTEXT
      CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (workspace_id, run_id, revision),
    UNIQUE KEY uk_financial_council_event_id (workspace_id, event_id),
    CONSTRAINT fk_financial_council_event_run
      FOREIGN KEY (workspace_id, run_id)
      REFERENCES financial_council_runs (workspace_id, run_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_event_json
      CHECK (JSON_VALID(aggregate_snapshot_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_snapshots (
    snapshot_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    snapshot_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    snapshot_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id, snapshot_id),
    UNIQUE KEY uk_financial_council_snapshot_run (workspace_id, run_id),
    CONSTRAINT fk_financial_council_snapshot_run
      FOREIGN KEY (workspace_id, run_id)
      REFERENCES financial_council_runs (workspace_id, run_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_snapshot_json
      CHECK (JSON_VALID(snapshot_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_specialist_results (
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    phase VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result_id CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    snapshot_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    snapshot_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id, run_id, role, phase),
    UNIQUE KEY uk_financial_council_specialist_result_id
      (workspace_id, result_id),
    CONSTRAINT fk_financial_council_specialist_run
      FOREIGN KEY (workspace_id, run_id)
      REFERENCES financial_council_runs (workspace_id, run_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_financial_council_specialist_snapshot
      FOREIGN KEY (workspace_id, snapshot_id)
      REFERENCES financial_council_snapshots (workspace_id, snapshot_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_specialist_role CHECK
      (role IN ('finance','profit','cost','cashflow','tax')),
    CONSTRAINT chk_financial_council_specialist_phase CHECK
      (phase IN ('analyze','rebut')),
    CONSTRAINT chk_financial_council_specialist_json
      CHECK (JSON_VALID(result_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_findings (
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    finding_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    phase VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    snapshot_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    finding_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (workspace_id, run_id, role, phase, finding_id),
    CONSTRAINT fk_financial_council_finding_result
      FOREIGN KEY (workspace_id, run_id, role, phase)
      REFERENCES financial_council_specialist_results
        (workspace_id, run_id, role, phase)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_finding_json
      CHECK (JSON_VALID(finding_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_candidate_actions (
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    action_id CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    phase VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    snapshot_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    action_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (workspace_id, run_id, role, phase, action_id),
    CONSTRAINT fk_financial_council_action_result
      FOREIGN KEY (workspace_id, run_id, role, phase)
      REFERENCES financial_council_specialist_results
        (workspace_id, run_id, role, phase)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_action_json
      CHECK (JSON_VALID(action_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_audit_graphs (
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    snapshot_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    snapshot_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    graph_id CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    graph_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    graph_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (workspace_id, run_id),
    UNIQUE KEY uk_financial_council_audit_graph (workspace_id, graph_id),
    CONSTRAINT fk_financial_council_audit_run FOREIGN KEY (workspace_id, run_id)
      REFERENCES financial_council_runs (workspace_id, run_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_audit_json CHECK (JSON_VALID(graph_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_rebuttal_attempts (
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    round_number TINYINT UNSIGNED NOT NULL,
    attempt_id CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    input_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (workspace_id, run_id, role, round_number),
    UNIQUE KEY uk_financial_council_rebuttal_attempt (workspace_id, attempt_id),
    CONSTRAINT fk_financial_council_rebuttal_graph FOREIGN KEY (workspace_id, run_id)
      REFERENCES financial_council_audit_graphs (workspace_id, run_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_rebuttal_round CHECK (round_number = 1),
    CONSTRAINT chk_financial_council_rebuttal_status
      CHECK (status IN ('reserved','completed')),
    CONSTRAINT chk_financial_council_rebuttal_json CHECK (JSON_VALID(attempt_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS financial_council_finding_dispositions (
    workspace_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    run_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    finding_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    disposition_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    disposition_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (workspace_id, run_id, finding_id),
    CONSTRAINT fk_financial_council_disposition_graph FOREIGN KEY (workspace_id, run_id)
      REFERENCES financial_council_audit_graphs (workspace_id, run_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_financial_council_disposition_status
      CHECK (status IN ('unresolved','upheld','revised','withdrawn')),
    CONSTRAINT chk_financial_council_disposition_json
      CHECK (JSON_VALID(disposition_json))
  ) ENGINE=InnoDB`
] as const);

const FINANCIAL_COUNCIL_SCHEMA_LOCK = "financial:council-schema:v1";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const STATUSES = new Set<string>(FINANCIAL_COUNCIL_RUN_STATUSES);
const SPECIALIST_ROLES = new Set<string>([
  "finance", "profit", "cost", "cashflow", "tax"
]);
const SPECIALIST_PHASES = new Set<string>(["analyze", "rebut"]);
const EVENT_SELECT = `SELECT event_id, run_id, workspace_id, revision,
  from_status, to_status, reason_code,
  DATE_FORMAT(occurred_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS occurred_at,
  actor_id, aggregate_snapshot_hash, aggregate_snapshot_json
  FROM financial_council_run_events`;
const SNAPSHOT_SELECT = `SELECT snapshot_id, run_id, workspace_id,
  snapshot_hash, snapshot_json,
  DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at
  FROM financial_council_snapshots`;

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function poison(connection: mysql.PoolConnection): void {
  try {
    connection.destroy();
  } catch {
    // A poisoned MySQL session must never return to the pool.
  }
}

export async function ensureFinancialCouncilMysqlSchema(
  pool: mysql.Pool
): Promise<void> {
  const connection = await pool.getConnection();
  let acquired = false;
  let poisoned = false;
  try {
    try {
      const [rows] = await connection.query(
        "SELECT GET_LOCK(?, ?) AS lock_acquired",
        [FINANCIAL_COUNCIL_SCHEMA_LOCK, 30]
      );
      const row = Array.isArray(rows)
        ? rows[0] as MysqlRow | undefined
        : undefined;
      if (Number(row?.lock_acquired) !== 1) throw new Error();
      acquired = true;
    } catch {
      poison(connection);
      poisoned = true;
      throw codedError("financial_council_schema_lock_failed");
    }
    for (const statement of FINANCIAL_COUNCIL_MYSQL_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    if (acquired) {
      try {
        const [rows] = await connection.query(
          "SELECT RELEASE_LOCK(?) AS lock_released",
          [FINANCIAL_COUNCIL_SCHEMA_LOCK]
        );
        const row = Array.isArray(rows)
          ? rows[0] as MysqlRow | undefined
          : undefined;
        if (Number(row?.lock_released) !== 1) throw new Error();
      } catch {
        if (!poisoned) poison(connection);
        poisoned = true;
        throw codedError("financial_council_schema_lock_failed");
      }
    }
    if (!poisoned) connection.release();
  }
}

function integrity(): never {
  throw codedError("financial_council_mysql_integrity");
}

function canonical(value: unknown): string {
  return financialCouncilCanonicalJson(value);
}

function duplicateEntry(error: unknown): boolean {
  const value = error as { code?: unknown; errno?: unknown } | null;
  return value?.code === "ER_DUP_ENTRY" || value?.errno === 1062;
}

function transientCreateRace(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { errno?: unknown; code?: unknown };
  return candidate.errno === 1213 || candidate.errno === 1205
    || candidate.code === "ER_LOCK_DEADLOCK"
    || candidate.code === "ER_LOCK_WAIT_TIMEOUT";
}

function affectedRows(result: unknown): number {
  return Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
}

function rowString(row: MysqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) integrity();
  return value;
}

function rowNullableString(row: MysqlRow, key: string): string | null {
  return row[key] === null ? null : rowString(row, key);
}

function rowInteger(row: MysqlRow, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 1) integrity();
  return value;
}

function isoDate(value: unknown): string {
  const normalized = value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
        && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  if (typeof normalized !== "string") integrity();
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) integrity();
  return date.toISOString();
}

function sqlDate(value: string): string {
  const iso = isoDate(value);
  if (iso !== value) {
    throw financialCouncilError("financial_council_timestamp_invalid");
  }
  return iso.slice(0, 23).replace("T", " ");
}

function assertNoDuplicateJsonObjectKeys(value: unknown): void {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) return;
  const raw = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  const stack: Array<
    | { type: "object"; keys: Set<string>; expectsKey: boolean }
    | { type: "array" }
  > = [];
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character === '"') {
      const start = index;
      let escaped = false;
      for (index += 1; index < raw.length; index += 1) {
        const nested = raw[index]!;
        if (escaped) escaped = false;
        else if (nested === "\\") escaped = true;
        else if (nested === '"') break;
      }
      if (index >= raw.length) integrity();
      const frame = stack.at(-1);
      if (frame?.type === "object" && frame.expectsKey) {
        const key = JSON.parse(raw.slice(start, index + 1)) as unknown;
        if (typeof key !== "string" || frame.keys.has(key)) integrity();
        frame.keys.add(key);
        let colon = index + 1;
        while (/\s/u.test(raw[colon] ?? "")) colon += 1;
        if (raw[colon] !== ":") integrity();
        frame.expectsKey = false;
      }
      continue;
    }
    if (character === "{") {
      stack.push({ type: "object", keys: new Set(), expectsKey: true });
    } else if (character === "[") {
      stack.push({ type: "array" });
    } else if (character === "}") {
      if (stack.pop()?.type !== "object") integrity();
    } else if (character === "]") {
      if (stack.pop()?.type !== "array") integrity();
    } else if (character === ",") {
      const frame = stack.at(-1);
      if (frame?.type === "object") frame.expectsKey = true;
    }
  }
  if (stack.length !== 0) integrity();
}

function jsonObject(value: unknown): Record<string, unknown> {
  try {
    assertNoDuplicateJsonObjectKeys(value);
    const parsed = Buffer.isBuffer(value)
      ? JSON.parse(value.toString("utf8"))
      : typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      integrity();
    }
    return parsed as Record<string, unknown>;
  } catch {
    integrity();
  }
}

function exactKeys(value: unknown, keys: readonly string[]):
asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000")
      !== [...keys].sort().join("\u0000")) {
    integrity();
  }
}

const RUN_KEYS = [
  "runId", "workspaceId", "creationKeyHash", "requestHash", "currency",
  "status", "revision", "dataAsOf", "businessReport", "policyVersionId",
  "snapshotId", "snapshotHash", "consensusReport", "portfolios",
  "latestPortfolioRevision", "approval", "createdAt", "updatedAt", "expiresAt"
] as const;

function parseRun(row: MysqlRow): FinancialCouncilRun {
  try {
    const value = jsonObject(row.run_json);
    assertFinancialCouncilRunValue(value);
    exactKeys(value, RUN_KEYS);
    if (typeof value.runId !== "string" || !value.runId
      || typeof value.workspaceId !== "string" || !value.workspaceId
      || typeof value.creationKeyHash !== "string" || !HASH.test(value.creationKeyHash)
      || typeof value.requestHash !== "string" || !HASH.test(value.requestHash)
      || (value.currency !== "CNY" && value.currency !== "USD")
      || typeof value.status !== "string" || !STATUSES.has(value.status)
      || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
      || typeof value.dataAsOf !== "string" || isoDate(value.dataAsOf) !== value.dataAsOf
      || typeof value.policyVersionId !== "string" || !value.policyVersionId
      || (value.snapshotId !== null
        && (typeof value.snapshotId !== "string" || !value.snapshotId))
      || (value.snapshotHash !== null
        && (typeof value.snapshotHash !== "string" || !HASH.test(value.snapshotHash)))
      || (value.snapshotId === null) !== (value.snapshotHash === null)
      || value.consensusReport !== null
      || !Array.isArray(value.portfolios) || value.portfolios.length !== 0
      || value.latestPortfolioRevision !== null
      || value.approval !== null
      || typeof value.createdAt !== "string" || isoDate(value.createdAt) !== value.createdAt
      || typeof value.updatedAt !== "string" || isoDate(value.updatedAt) !== value.updatedAt
      || typeof value.expiresAt !== "string" || isoDate(value.expiresAt) !== value.expiresAt) {
      integrity();
    }
    const aggregate = immutableFinancialCouncilValue(value) as unknown as
      FinancialCouncilRun;
    if (aggregate.runId !== rowString(row, "run_id")
      || aggregate.workspaceId !== rowString(row, "workspace_id")
      || aggregate.creationKeyHash !== rowString(row, "creation_key_hash")
      || aggregate.requestHash !== rowString(row, "request_hash")
      || aggregate.revision !== rowInteger(row, "revision")
      || aggregate.status !== rowString(row, "status")
      || aggregate.snapshotId !== rowNullableString(row, "snapshot_id")
      || aggregate.snapshotHash !== rowNullableString(row, "snapshot_hash")) {
      integrity();
    }
    return aggregate;
  } catch {
    integrity();
  }
}

function parseEvent(row: MysqlRow): FinancialCouncilRunEvent {
  try {
    const aggregate = parseRun({
      run_json: row.aggregate_snapshot_json,
      run_id: row.run_id,
      workspace_id: row.workspace_id,
      creation_key_hash: jsonObject(row.aggregate_snapshot_json).creationKeyHash,
      request_hash: jsonObject(row.aggregate_snapshot_json).requestHash,
      revision: row.revision,
      status: row.to_status,
      snapshot_id: jsonObject(row.aggregate_snapshot_json).snapshotId,
      snapshot_hash: jsonObject(row.aggregate_snapshot_json).snapshotHash
    });
    const revision = rowInteger(row, "revision");
    const fromStatus = rowNullableString(row, "from_status");
    const toStatus = rowString(row, "to_status");
    const hash = rowString(row, "aggregate_snapshot_hash");
    const occurredAt = isoDate(row.occurred_at);
    if ((fromStatus !== null && !STATUSES.has(fromStatus))
      || !STATUSES.has(toStatus)
      || !HASH.test(hash)
      || rowString(row, "event_id") !== `${aggregate.runId}:${revision}`
      || aggregate.revision !== revision
      || aggregate.status !== toStatus
      || hash !== financialCouncilAggregateHash(aggregate)
      || (revision === 1) !== (fromStatus === null)) {
      integrity();
    }
    return immutableFinancialCouncilValue({
      eventId: rowString(row, "event_id"),
      runId: aggregate.runId,
      workspaceId: aggregate.workspaceId,
      revision,
      fromStatus: fromStatus as FinancialCouncilRunEvent["fromStatus"],
      toStatus: toStatus as FinancialCouncilRunEvent["toStatus"],
      reasonCode: rowNullableString(row, "reason_code"),
      occurredAt,
      actorId: rowString(row, "actor_id"),
      aggregateSnapshotHash: hash as `sha256:${string}`,
      aggregateSnapshot: aggregate
    });
  } catch {
    integrity();
  }
}

function parseSnapshot(row: MysqlRow): FinancialSnapshotRecord {
  try {
    const snapshot = jsonObject(row.snapshot_json);
    const snapshotId = rowString(row, "snapshot_id");
    const runId = rowString(row, "run_id");
    const workspaceId = rowString(row, "workspace_id");
    const snapshotHash = rowString(row, "snapshot_hash");
    const nestedHash = snapshot.snapshotHash;
    const { snapshotHash: _snapshotHash, ...preimage } = snapshot;
    if (!HASH.test(snapshotHash)
      || snapshot.snapshotId !== snapshotId
      || snapshot.runId !== runId
      || snapshot.workspaceId !== workspaceId
      || nestedHash !== snapshotHash
      || financialCouncilCanonicalHash(preimage) !== snapshotHash) {
      integrity();
    }
    const record = immutableFinancialCouncilValue({
      snapshotId,
      runId,
      workspaceId,
      snapshotHash: snapshotHash as `sha256:${string}`,
      snapshot,
      createdAt: isoDate(row.created_at)
    });
    assertFinancialSnapshotRecordValue(record);
    return record;
  } catch {
    integrity();
  }
}

function assertStoredSnapshot(
  run: FinancialCouncilRun,
  snapshot: FinancialSnapshotRecord,
  events: readonly FinancialCouncilRunEvent[]
): void {
  try {
    assertFinancialSnapshotRecord(run, snapshot);
    assertFinancialSnapshotFreezeTime(snapshot, events, integrity);
  } catch {
    integrity();
  }
}

function parseSpecialistResult(
  row: MysqlRow,
  findingRows: readonly MysqlRow[],
  actionRows: readonly MysqlRow[]
): FinancialCouncilSpecialistResult {
  try {
    const result = validateFinancialCouncilSpecialistResult(
      jsonObject(row.result_json)
    );
    if (result.workspaceId !== rowString(row, "workspace_id")
      || result.runId !== rowString(row, "run_id")
      || result.role !== rowString(row, "role")
      || result.phase !== rowString(row, "phase")
      || result.resultId !== rowString(row, "result_id")
      || result.snapshotId !== rowString(row, "snapshot_id")
      || result.snapshotHash !== rowString(row, "snapshot_hash")
      || result.resultHash !== rowString(row, "result_hash")
      || result.createdAt !== isoDate(row.created_at)) integrity();
    const findings = findingRows.map((findingRow) => {
      const value = jsonObject(findingRow.finding_json);
      if (rowString(findingRow, "workspace_id") !== result.workspaceId
        || rowString(findingRow, "run_id") !== result.runId
        || rowString(findingRow, "role") !== result.role
        || rowString(findingRow, "phase") !== result.phase
        || rowString(findingRow, "snapshot_id") !== result.snapshotId
        || rowString(findingRow, "finding_id") !== value.findingId) {
        integrity();
      }
      return value;
    }).sort((left, right) => Buffer.compare(
      Buffer.from(String(left.findingId), "utf8"),
      Buffer.from(String(right.findingId), "utf8")
    ));
    const actions = actionRows.map((actionRow) => {
      const value = jsonObject(actionRow.action_json);
      if (rowString(actionRow, "workspace_id") !== result.workspaceId
        || rowString(actionRow, "run_id") !== result.runId
        || rowString(actionRow, "role") !== result.role
        || rowString(actionRow, "phase") !== result.phase
        || rowString(actionRow, "snapshot_id") !== result.snapshotId
        || rowString(actionRow, "action_id") !== value.actionId) {
        integrity();
      }
      return value;
    }).sort((left, right) => Buffer.compare(
      Buffer.from(String(left.actionId), "utf8"),
      Buffer.from(String(right.actionId), "utf8")
    ));
    const expectedFindings = [...result.findings].sort((left, right) =>
      Buffer.compare(Buffer.from(left.findingId, "utf8"),
        Buffer.from(right.findingId, "utf8")));
    const expectedActions = [...result.actions].sort((left, right) =>
      Buffer.compare(Buffer.from(left.actionId, "utf8"),
        Buffer.from(right.actionId, "utf8")));
    if (canonical(findings) !== canonical(expectedFindings)
      || canonical(actions) !== canonical(expectedActions)) integrity();
    return result;
  } catch {
    integrity();
  }
}

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function rebuttalContentHash(input: FinancialCouncilRebutInput):
`sha256:${string}` {
  return financialCouncilCanonicalHash({
    allowlist: input.allowlist,
    businessData: input.businessData,
    targetFindingId: input.targetFindingId,
    conflictData: input.conflictData
  });
}

function parseAuditGraphRow(row: MysqlRow): FinancialCouncilAuditGraph {
  const rawGraph = jsonObject(row.graph_json);
  exactKeys(rawGraph, ["graphId", "workspaceId", "runId", "snapshotId",
    "snapshotHash", "edges", "graphHash"]);
  if (!Array.isArray(rawGraph.edges)) integrity();
  for (const edge of rawGraph.edges) exactKeys(edge, ["edgeId", "kind",
    "findingIds", "sharedRefs", "status", "validatorReason"]);
  const graph = immutableFinancialCouncilValue(rawGraph) as
    unknown as FinancialCouncilAuditGraph;
  const expectedHash = financialCouncilCanonicalHash({
    workspaceId: graph.workspaceId, runId: graph.runId,
    snapshotId: graph.snapshotId, snapshotHash: graph.snapshotHash,
    edges: graph.edges
  });
  if (rowString(row, "workspace_id") !== graph.workspaceId
    || rowString(row, "run_id") !== graph.runId
    || rowString(row, "snapshot_id") !== graph.snapshotId
    || rowString(row, "snapshot_hash") !== graph.snapshotHash
    || rowString(row, "graph_id") !== graph.graphId
    || rowString(row, "graph_hash") !== graph.graphHash
    || graph.graphId !== expectedHash || graph.graphHash !== expectedHash) {
    integrity();
  }
  return graph;
}

function parseRebuttalAttemptRow(row: MysqlRow):
FinancialCouncilRebuttalAttempt {
  const rawAttempt = jsonObject(row.attempt_json);
  exactKeys(rawAttempt, ["attemptId", "workspaceId", "runId", "snapshotId",
    "snapshotHash", "graphId", "role", "round", "edgeId",
    "targetFindingId", "inputHash", "input", "status", "result",
    "outputHash", "createdAt", "completedAt", "attemptHash"]);
  exactKeys(rawAttempt.input, ["ownerId", "teamId", "runId", "snapshotId",
    "snapshotHash", "role", "attempt", "allowlist", "businessData",
    "targetFindingId", "conflictData"]);
  exactKeys((rawAttempt.input as Record<string, unknown>).allowlist,
    ["evidenceRefIds", "formulaRefIds", "findingIds", "subjectRefs",
      "dataGapRefs"]);
  const attempt = immutableFinancialCouncilValue(rawAttempt) as unknown as
    FinancialCouncilRebuttalAttempt;
  const { attemptHash: _hash, ...preimage } = attempt;
  if (rowString(row, "workspace_id") !== attempt.workspaceId
    || rowString(row, "run_id") !== attempt.runId
    || rowString(row, "role") !== attempt.role
    || rowInteger(row, "round_number") !== attempt.round
    || rowString(row, "attempt_id") !== attempt.attemptId
    || rowString(row, "input_hash") !== attempt.inputHash
    || rowString(row, "status") !== attempt.status
    || attempt.round !== 1
    || attempt.inputHash !== financialCouncilCanonicalHash(attempt.input)
    || attempt.attemptHash !== financialCouncilCanonicalHash(preimage)) {
    integrity();
  }
  return attempt;
}

function parseDispositionRow(row: MysqlRow): FinancialCouncilFindingDisposition {
  const rawDisposition = jsonObject(row.disposition_json);
  exactKeys(rawDisposition, ["workspaceId", "runId", "snapshotId",
    "snapshotHash", "graphId", "findingId", "role", "status",
    "blockingConflictIds", "updatedAt", "dispositionHash"]);
  const disposition = immutableFinancialCouncilValue(rawDisposition) as
    unknown as FinancialCouncilFindingDisposition;
  const { dispositionHash: _hash, ...preimage } = disposition;
  if (rowString(row, "workspace_id") !== disposition.workspaceId
    || rowString(row, "run_id") !== disposition.runId
    || rowString(row, "finding_id") !== disposition.findingId
    || rowString(row, "role") !== disposition.role
    || rowString(row, "status") !== disposition.status
    || rowString(row, "disposition_hash") !== disposition.dispositionHash
    || disposition.dispositionHash !== financialCouncilCanonicalHash(preimage)) {
    integrity();
  }
  return disposition;
}

function expectedRevision(command: CommandContext): number {
  return command.expectedRevision as number;
}

export class MysqlFinancialCouncilRepository
implements FinancialCouncilRepository {
  constructor(private readonly pool: mysql.Pool) {}

  async createAndFreezeRun(
    command: CommandContext,
    input: CreateAndFreezeFinancialCouncilRunInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    ({ command, input } = validateFinancialCouncilCreateAndFreezeMutation(
      command, input
    ));
    const { aggregate, snapshot, occurredAt } = input;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.transaction(async (connection) => {
        const existing = await this.readVerifiedFrozenByCreationKey(
          connection, aggregate.workspaceId, aggregate.creationKeyHash,
          aggregate.requestHash, true
        );
        if (existing) return { value: existing, replayed: true };
        const created = immutableFinancialCouncilValue(aggregate);
        const withSnapshot = immutableFinancialCouncilValue({
          ...created,
          snapshotId: snapshot.snapshotId,
          snapshotHash: snapshot.snapshotHash
        });
        const frozen = applyFinancialCouncilTransition(withSnapshot, {
          kind: "snapshot_frozen", occurredAt, actorId: command.actorId
        });
        await connection.query(
          `INSERT INTO financial_council_runs (
             run_id, workspace_id, creation_key_hash, request_hash, revision,
             status, snapshot_id, snapshot_hash, run_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [frozen.runId, frozen.workspaceId, frozen.creationKeyHash,
            frozen.requestHash, frozen.revision, frozen.status,
            frozen.snapshotId, frozen.snapshotHash, canonical(frozen)]
        );
        await this.appendEvent(connection, createFinancialCouncilRunEvent(
          created, {
            fromStatus: null, reasonCode: null,
            occurredAt: created.createdAt, actorId: command.actorId
          }
        ));
        await connection.query(
          `INSERT INTO financial_council_snapshots (
             snapshot_id, run_id, workspace_id, snapshot_hash, snapshot_json,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [snapshot.snapshotId, snapshot.runId, snapshot.workspaceId,
            snapshot.snapshotHash, canonical(snapshot.snapshot),
            sqlDate(snapshot.createdAt)]
        );
        await this.appendEvent(connection, createFinancialCouncilRunEvent(
          frozen, {
            fromStatus: "created", reasonCode: null,
            occurredAt, actorId: command.actorId
          }
        ));
        return { value: frozen, replayed: false };
        });
      } catch (error) {
        if (transientCreateRace(error)) {
          const existing = await this.transaction((connection) =>
            this.readVerifiedFrozenByCreationKey(
              connection, aggregate.workspaceId, aggregate.creationKeyHash,
              aggregate.requestHash, false
            ), true
          );
          if (existing) return { value: existing, replayed: true };
          if (attempt < 3) continue;
        }
        if (!duplicateEntry(error)) throw error;
        const existing = await this.transaction((connection) =>
          this.readVerifiedFrozenByCreationKey(
            connection, aggregate.workspaceId, aggregate.creationKeyHash,
            aggregate.requestHash, false
          ), true
        );
        if (!existing) {
          throw financialCouncilError("financial_council_run_conflict");
        }
        return { value: existing, replayed: true };
      }
    }
    throw financialCouncilError("financial_council_run_conflict");
  }

  async findFrozenRunByCreationKey(
    context: ActiveWorkspaceContext,
    creationKeyHash: string,
    requestHash: string
  ): Promise<FinancialCouncilRun | null> {
    if (!HASH.test(creationKeyHash) || !HASH.test(requestHash)) {
      throw financialCouncilError("financial_council_input_invalid");
    }
    return this.transaction((connection) =>
      this.readVerifiedFrozenByCreationKey(
        connection, context.workspaceId, creationKeyHash, requestHash, false
      ), true
    );
  }

  async createRun(
    command: CommandContext,
    aggregate: FinancialCouncilRun
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    ({ command, aggregate } = validateFinancialCouncilCreateMutation(
      command, aggregate
    ));
    try {
      return await this.transaction(async (connection) => {
        const existing = await this.findByCreationKey(
          connection, aggregate.workspaceId, aggregate.creationKeyHash, true
        );
        if (existing) {
          await this.verifyStoredRun(connection, existing);
          return this.replay(existing, aggregate.requestHash);
        }
        const stored = immutableFinancialCouncilValue(aggregate);
        await connection.query(
          `INSERT INTO financial_council_runs (
             run_id, workspace_id, creation_key_hash, request_hash, revision,
             status, snapshot_id, snapshot_hash, run_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [stored.runId, stored.workspaceId, stored.creationKeyHash,
            stored.requestHash, stored.revision, stored.status,
            stored.snapshotId, stored.snapshotHash, canonical(stored)]
        );
        await this.appendEvent(connection, createFinancialCouncilRunEvent(stored, {
          fromStatus: null,
          reasonCode: null,
          occurredAt: stored.createdAt,
          actorId: command.actorId
        }));
        return { value: stored, replayed: false };
      });
    } catch (error) {
      if (!duplicateEntry(error)) throw error;
      return this.transaction(async (connection) => {
        const existing = await this.findByCreationKey(
          connection, aggregate.workspaceId, aggregate.creationKeyHash, false
        );
        if (!existing) {
          throw financialCouncilError("financial_council_run_conflict");
        }
        await this.verifyStoredRun(connection, existing);
        return this.replay(existing, aggregate.requestHash);
      }, true);
    }
  }

  async findRun(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<FinancialCouncilRun | null> {
    return (await this.readVerifiedHistory(context, runId))?.run ?? null;
  }

  async getVerifiedRunSnapshot(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<VerifiedFinancialCouncilRunSnapshot | null> {
    return this.transaction(async (connection) => {
      const [runRows] = await connection.query(
        `SELECT * FROM financial_council_runs
         WHERE workspace_id = ? AND run_id = ?`,
        [context.workspaceId, runId]
      );
      const row = (runRows as MysqlRow[])[0];
      if (!row) return null;
      const run = parseRun(row);
      const events = await this.verifyStoredRun(connection, run);
      const [snapshotRows] = await connection.query(
        `${SNAPSHOT_SELECT}
         WHERE workspace_id = ? AND run_id = ?`,
        [context.workspaceId, runId]
      );
      const snapshotRow = (snapshotRows as MysqlRow[])[0];
      if (!snapshotRow) integrity();
      const record = parseSnapshot(snapshotRow);
      assertStoredSnapshot(run, record, events);
      return immutableFinancialCouncilValue({
        run,
        snapshot: validateFinancialSnapshotForRun(record.snapshot, run)
      });
    }, true);
  }

  async listEvents(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilRunEvent[]> {
    return (await this.readVerifiedHistory(context, runId))?.events
      ?? Object.freeze([]);
  }

  async storeFrozenSnapshot(
    command: CommandContext,
    input: StoreFrozenFinancialSnapshotInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    ({ command, input } = validateFinancialCouncilStoreSnapshotMutation(
      command, input
    ));
    const revision = expectedRevision(command);
    return this.transaction(async (connection) => {
      const current = await this.findByRunId(
        connection, command.workspace.workspaceId, input.runId, true
      );
      if (!current) {
        throw financialCouncilError("financial_council_run_not_found");
      }
      if (current.revision !== revision) {
        throw financialCouncilError("financial_council_revision_conflict");
      }
      assertFinancialSnapshotRecord(current, input.snapshot);
      const [existingRows] = await connection.query(
        `${SNAPSHOT_SELECT}
         WHERE workspace_id = ? AND run_id = ? FOR UPDATE`,
        [current.workspaceId, current.runId]
      );
      const existingRow = (existingRows as MysqlRow[])[0];
      if (existingRow) {
        parseSnapshot(existingRow);
        throw financialCouncilError("financial_council_snapshot_conflict");
      }
      try {
        await connection.query(
          `INSERT INTO financial_council_snapshots (
             snapshot_id, run_id, workspace_id, snapshot_hash, snapshot_json,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [input.snapshot.snapshotId, input.snapshot.runId,
            input.snapshot.workspaceId, input.snapshot.snapshotHash,
            canonical(input.snapshot.snapshot), sqlDate(input.snapshot.createdAt)]
        );
      } catch (error) {
        if (duplicateEntry(error)) {
          throw financialCouncilError("financial_council_snapshot_conflict");
        }
        throw error;
      }
      const withSnapshot = immutableFinancialCouncilValue({
        ...current,
        snapshotId: input.snapshot.snapshotId,
        snapshotHash: input.snapshot.snapshotHash
      });
      const next = applyFinancialCouncilTransition(withSnapshot, {
        kind: "snapshot_frozen",
        occurredAt: input.occurredAt,
        actorId: command.actorId
      });
      await this.updateRun(connection, current, next);
      await this.appendEvent(connection, createFinancialCouncilRunEvent(next, {
        fromStatus: current.status,
        reasonCode: null,
        occurredAt: input.occurredAt,
        actorId: command.actorId
      }));
      return { value: next, replayed: false };
    });
  }

  async transitionRun(
    command: CommandContext,
    input: TransitionFinancialCouncilRunInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRun>> {
    ({ command, input } = validateFinancialCouncilTransitionMutation(
      command, input
    ));
    if (input.kind === "snapshot_frozen") {
      throw financialCouncilError("financial_council_transition_invalid");
    }
    const revision = expectedRevision(command);
    return this.transaction(async (connection) => {
      const current = await this.findByRunId(
        connection, command.workspace.workspaceId, input.runId, true
      );
      if (!current) {
        throw financialCouncilError("financial_council_run_not_found");
      }
      if (current.revision !== revision) {
        throw financialCouncilError("financial_council_revision_conflict");
      }
      const next = applyFinancialCouncilTransition(current, {
        kind: input.kind,
        occurredAt: input.occurredAt,
        actorId: command.actorId
      });
      await this.updateRun(connection, current, next);
      await this.appendEvent(connection, createFinancialCouncilRunEvent(next, {
        fromStatus: current.status,
        reasonCode: input.reasonCode,
        occurredAt: input.occurredAt,
        actorId: command.actorId
      }));
      return { value: next, replayed: false };
    });
  }

  async listRunnableRuns(
    input: ListRunnableFinancialCouncilRunsInput
  ): Promise<readonly FinancialCouncilRun[]> {
    input = validateListRunnableFinancialCouncilRunsInput(input);
    return this.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT * FROM financial_council_runs
         WHERE status = 'snapshot_frozen'
           AND (? IS NULL OR BINARY workspace_id > BINARY ?
             OR (BINARY workspace_id = BINARY ?
               AND BINARY run_id > BINARY ?))
         ORDER BY BINARY workspace_id ASC, BINARY run_id ASC LIMIT ?`,
        [
          input.after?.workspaceId ?? null,
          input.after?.workspaceId ?? null,
          input.after?.workspaceId ?? null,
          input.after?.runId ?? null,
          input.limit
        ]
      );
      const runs: FinancialCouncilRun[] = [];
      for (const row of rows as MysqlRow[]) {
        const run = parseRun(row);
        if (run.status !== "snapshot_frozen") integrity();
        const [eventRows] = await connection.query(
          `${EVENT_SELECT}
           WHERE workspace_id = ? AND run_id = ? ORDER BY revision ASC`,
          [run.workspaceId, run.runId]
        );
        const events = Object.freeze((eventRows as MysqlRow[]).map(parseEvent));
        assertFinancialCouncilRunHistory(run, events, integrity);
        const [snapshotRows] = await connection.query(
          `${SNAPSHOT_SELECT}
           WHERE workspace_id = ? AND run_id = ?`,
          [run.workspaceId, run.runId]
        );
        const snapshotRow = (snapshotRows as MysqlRow[])[0];
        if (!snapshotRow) integrity();
        const snapshot = parseSnapshot(snapshotRow);
        assertStoredSnapshot(run, snapshot, events);
        runs.push(run);
      }
      return Object.freeze(runs);
    }, true);
  }

  async storeSpecialistResult(
    context: ActiveWorkspaceContext,
    rawResult: AuthorizedFinancialCouncilSpecialistResult
  ): Promise<FinancialCouncilCommandResult<
  AuthorizedFinancialCouncilSpecialistResult>> {
    assertFinancialCouncilSpecialistResultAuthorized(rawResult);
    const result = validateFinancialCouncilSpecialistResult(rawResult);
    if (result.workspaceId !== context.workspaceId) {
      throw financialCouncilError("financial_council_specialist_result_invalid");
    }
    try {
      return await this.transaction(async (connection) => {
        const run = await this.findByRunId(
          connection, context.workspaceId, result.runId, true
        );
        if (!run) throw financialCouncilError("financial_council_run_not_found");
        const events = await this.verifyStoredRun(connection, run);
        const [snapshotRows] = await connection.query(
          `${SNAPSHOT_SELECT}
           WHERE workspace_id = ? AND run_id = ? FOR UPDATE`,
          [context.workspaceId, result.runId]
        );
        const snapshotRow = (snapshotRows as MysqlRow[])[0];
        if (!snapshotRow) integrity();
        const snapshot = parseSnapshot(snapshotRow);
        assertStoredSnapshot(run, snapshot, events);
        if (result.snapshotId !== snapshot.snapshotId
          || result.snapshotHash !== snapshot.snapshotHash
          || Date.parse(result.createdAt) < Date.parse(run.updatedAt)
          || Date.parse(result.createdAt) > Date.parse(run.expiresAt)
          || Date.parse(result.createdAt) > Date.now() + 1_000) {
          throw financialCouncilError(
            "financial_council_specialist_result_invalid"
          );
        }
        const existing = await this.readSpecialistResult(
          connection, result.workspaceId, result.runId,
          result.role, result.phase, true
        );
        if (existing) {
          if (canonical(existing) !== canonical(result)) {
            throw financialCouncilError("financial_council_specialist_conflict");
          }
          return { value: rawResult, replayed: true };
        }
        await connection.query(
          `INSERT INTO financial_council_specialist_results (
             workspace_id, run_id, role, phase, result_id, snapshot_id,
             snapshot_hash, result_hash, result_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [result.workspaceId, result.runId, result.role, result.phase,
            result.resultId, result.snapshotId, result.snapshotHash,
            result.resultHash, canonical(result), sqlDate(result.createdAt)]
        );
        for (const finding of result.findings) {
          await connection.query(
            `INSERT INTO financial_council_findings (
               workspace_id, run_id, finding_id, role, phase, snapshot_id,
               finding_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [result.workspaceId, result.runId, finding.findingId, result.role,
              result.phase, result.snapshotId, canonical(finding)]
          );
        }
        for (const action of result.actions) {
          await connection.query(
            `INSERT INTO financial_council_candidate_actions (
               workspace_id, run_id, action_id, role, phase, snapshot_id,
               action_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [result.workspaceId, result.runId, action.actionId, result.role,
              result.phase, result.snapshotId, canonical(action)]
          );
        }
        return { value: rawResult, replayed: false };
      });
    } catch (error) {
      if (!duplicateEntry(error)) throw error;
      const existing = await this.getSpecialistResult(
        context, result.runId, result.role, result.phase
      );
      if (existing && canonical(existing) === canonical(result)) {
        return { value: rawResult, replayed: true };
      }
      throw financialCouncilError("financial_council_specialist_conflict");
    }
  }

  async getSpecialistResult(
    context: ActiveWorkspaceContext,
    runId: string,
    role: FinancialCouncilAgentRole,
    phase: FinancialCouncilSpecialistPhase
  ): Promise<FinancialCouncilSpecialistResult | null> {
    if (!SPECIALIST_ROLES.has(role) || !SPECIALIST_PHASES.has(phase)) {
      throw financialCouncilError("financial_council_specialist_result_invalid");
    }
    return this.transaction(async (connection) => {
      const run = await this.findByRunId(
        connection, context.workspaceId, runId, false
      );
      const result = await this.readSpecialistResult(
        connection, context.workspaceId, runId, role, phase, false
      );
      if (!run) {
        if (result) integrity();
        return null;
      }
      await this.verifyStoredRun(connection, run);
      if (result && (result.snapshotId !== run.snapshotId
        || result.snapshotHash !== run.snapshotHash)) integrity();
      return result;
    }, true);
  }

  async listSpecialistResults(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilSpecialistResult[]> {
    return this.transaction(async (connection) => {
      const run = await this.findByRunId(
        connection, context.workspaceId, runId, false
      );
      const [rows] = await connection.query(
        `SELECT workspace_id, run_id, role, phase, result_id, snapshot_id,
                snapshot_hash, result_hash, result_json,
                DATE_FORMAT(created_at,
                  '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at
         FROM financial_council_specialist_results
         WHERE workspace_id = ? AND run_id = ?
         ORDER BY CASE role
           WHEN 'finance' THEN 1 WHEN 'profit' THEN 2 WHEN 'cost' THEN 3
           WHEN 'cashflow' THEN 4 WHEN 'tax' THEN 5 ELSE 6 END, phase ASC`,
        [context.workspaceId, runId]
      );
      if (!run) {
        if ((rows as MysqlRow[]).length !== 0) integrity();
        return Object.freeze([]);
      }
      await this.verifyStoredRun(connection, run);
      const results: FinancialCouncilSpecialistResult[] = [];
      for (const row of rows as MysqlRow[]) {
        const result = await this.readSpecialistResultByRow(connection, row);
        if (result.snapshotId !== run.snapshotId
          || result.snapshotHash !== run.snapshotHash) integrity();
        results.push(result);
      }
      return Object.freeze(results);
    }, true);
  }

  async storeAuditGraph(
    context: ActiveWorkspaceContext,
    graph: FinancialCouncilAuditGraph,
    dispositions: readonly InitialFinancialCouncilFindingDisposition[]
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilAuditGraph>> {
    return this.transaction(async (connection) => {
      const run = await this.findByRunId(
        connection, context.workspaceId, graph.runId, true
      );
      if (!run) throw financialCouncilError("financial_council_run_not_found");
      await this.verifyStoredRun(connection, run);
      const expectedHash = financialCouncilCanonicalHash({
        workspaceId: graph.workspaceId, runId: graph.runId,
        snapshotId: graph.snapshotId, snapshotHash: graph.snapshotHash,
        edges: graph.edges
      });
      if (graph.workspaceId !== context.workspaceId
        || graph.snapshotId !== run.snapshotId
        || graph.snapshotHash !== run.snapshotHash
        || graph.graphId !== expectedHash || graph.graphHash !== expectedHash
        || new Set(dispositions.map((item) => item.findingId)).size
          !== dispositions.length
        || dispositions.some((item) => item.status !== "unresolved"
          || !SPECIALIST_ROLES.has(item.role)
          || item.blockingConflictIds.some((id) => !graph.edges.some((edge) =>
            edge.edgeId === id && edge.findingIds.includes(item.findingId))))) {
        throw financialCouncilError("financial_council_audit_invalid");
      }
      const existing = await this.readAuditGraph(
        connection, context.workspaceId, graph.runId, true
      );
      if (existing) {
        const [storedDispositionRows] = await connection.query(
          `SELECT * FROM financial_council_finding_dispositions
           WHERE workspace_id = ? AND run_id = ? ORDER BY BINARY finding_id ASC`,
          [context.workspaceId, graph.runId]
        );
        const storedDispositions = (storedDispositionRows as MysqlRow[])
          .map(parseDispositionRow).map((item) => ({
            findingId: item.findingId, role: item.role,
            status: "unresolved", blockingConflictIds: item.blockingConflictIds
          }));
        if (canonical(existing) !== canonical(graph)
          || canonical(storedDispositions) !== canonical([...dispositions]
            .sort((left, right) => utf8Compare(
              left.findingId, right.findingId
            )))) {
          throw financialCouncilError("financial_council_audit_conflict");
        }
        return { value: existing, replayed: true };
      }
      await connection.query(
        `INSERT INTO financial_council_audit_graphs (
           workspace_id, run_id, snapshot_id, snapshot_hash, graph_id,
           graph_hash, graph_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [graph.workspaceId, graph.runId, graph.snapshotId, graph.snapshotHash,
          graph.graphId, graph.graphHash, canonical(graph)]
      );
      for (const item of dispositions) {
        const stable = { workspaceId: context.workspaceId, runId: graph.runId,
          snapshotId: graph.snapshotId, snapshotHash: graph.snapshotHash,
          graphId: graph.graphId, findingId: item.findingId, role: item.role,
          status: item.status, blockingConflictIds: [...item.blockingConflictIds]
            .sort(utf8Compare), updatedAt: run.updatedAt };
        const disposition = { ...stable,
          dispositionHash: financialCouncilCanonicalHash(stable) };
        await connection.query(
          `INSERT INTO financial_council_finding_dispositions (
             workspace_id, run_id, finding_id, role, status,
             disposition_hash, disposition_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [context.workspaceId, graph.runId, item.findingId, item.role,
            item.status, disposition.dispositionHash, canonical(disposition)]
        );
      }
      return { value: graph, replayed: false };
    });
  }

  async getAuditGraph(context: ActiveWorkspaceContext, runId: string):
  Promise<FinancialCouncilAuditGraph | null> {
    return this.transaction((connection) => this.readAuditGraph(
      connection, context.workspaceId, runId, false
    ), true);
  }

  async reserveRebuttalAttempt(
    context: ActiveWorkspaceContext,
    attempt: FinancialCouncilRebuttalAttempt
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRebuttalAttempt>> {
    if (attempt.workspaceId !== context.workspaceId || attempt.round !== 1
      || attempt.status !== "reserved" || attempt.result !== null
      || attempt.outputHash !== null || attempt.completedAt !== null
      || attempt.inputHash !== financialCouncilCanonicalHash(attempt.input)) {
      throw financialCouncilError("financial_council_rebuttal_invalid");
    }
    const { attemptHash: _hash, ...preimage } = attempt;
    if (attempt.attemptHash !== financialCouncilCanonicalHash(preimage)) {
      throw financialCouncilError("financial_council_rebuttal_invalid");
    }
    try {
      return await this.transaction(async (connection) => {
      const graph = await this.readAuditGraph(
        connection, context.workspaceId, attempt.runId, false
      );
      if (!graph || graph.graphId !== attempt.graphId
        || graph.snapshotId !== attempt.snapshotId
        || graph.snapshotHash !== attempt.snapshotHash
        || !graph.edges.some((edge) => edge.edgeId === attempt.edgeId
          && edge.findingIds.includes(attempt.targetFindingId))) {
        throw financialCouncilError("financial_council_rebuttal_invalid");
      }
      const existing = await this.readRebuttalAttempt(connection,
        context.workspaceId, attempt.runId, attempt.role, 1, true);
      if (existing) {
        if (existing.attemptId !== attempt.attemptId
          || existing.inputHash !== attempt.inputHash
          || existing.edgeId !== attempt.edgeId) {
          throw financialCouncilError("financial_council_rebuttal_conflict");
        }
        return { value: existing, replayed: true };
      }
      await connection.query(
        `INSERT INTO financial_council_rebuttal_attempts (
           workspace_id, run_id, role, round_number, attempt_id, input_hash,
           status, attempt_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [attempt.workspaceId, attempt.runId, attempt.role, 1,
          attempt.attemptId, attempt.inputHash, attempt.status,
          canonical(attempt)]
      );
        return { value: attempt, replayed: false };
      });
    } catch (error) {
      if (!duplicateEntry(error)) throw error;
      const existing = await this.getRebuttalAttempt(
        context, attempt.runId, attempt.role, 1
      );
      if (existing && existing.attemptId === attempt.attemptId
        && existing.inputHash === attempt.inputHash
        && existing.edgeId === attempt.edgeId) {
        return { value: existing, replayed: true };
      }
      throw financialCouncilError("financial_council_rebuttal_conflict");
    }
  }

  async getRebuttalAttempt(
    context: ActiveWorkspaceContext, runId: string,
    role: FinancialCouncilAgentRole, round: number
  ): Promise<FinancialCouncilRebuttalAttempt | null> {
    if (!SPECIALIST_ROLES.has(role) || round !== 1) {
      throw financialCouncilError("financial_council_rebuttal_invalid");
    }
    return this.transaction((connection) => this.readRebuttalAttempt(
      connection, context.workspaceId, runId, role, round, false
    ), true);
  }

  async listRebuttalAttempts(context: ActiveWorkspaceContext, runId: string):
  Promise<readonly FinancialCouncilRebuttalAttempt[]> {
    return this.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT * FROM financial_council_rebuttal_attempts
         WHERE workspace_id = ? AND run_id = ?
         ORDER BY BINARY role ASC, round_number ASC`,
        [context.workspaceId, runId]
      );
      return Object.freeze((rows as MysqlRow[]).map(parseRebuttalAttemptRow));
    }, true);
  }

  async completeRebuttalAttempt(
    context: ActiveWorkspaceContext,
    input: CompleteFinancialCouncilRebuttalInput
  ): Promise<FinancialCouncilCommandResult<FinancialCouncilRebuttalAttempt>> {
    return this.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT * FROM financial_council_rebuttal_attempts
         WHERE workspace_id = ? AND attempt_id = ? FOR UPDATE`,
        [context.workspaceId, input.attemptId]
      );
      const currentRow = (rows as MysqlRow[])[0];
      if (!currentRow) {
        throw financialCouncilError("financial_council_rebuttal_conflict");
      }
      const current = parseRebuttalAttemptRow(currentRow);
      const outputHash = financialCouncilCanonicalHash(input.result.value);
      if (current.inputHash !== input.inputHash) {
        throw financialCouncilError("financial_council_rebuttal_conflict");
      }
      if (current.status === "completed") {
        if (current.outputHash !== outputHash
          || canonical(current.result) !== canonical(input.result)) {
          throw financialCouncilError("financial_council_rebuttal_conflict");
        }
        return { value: current, replayed: true };
      }
      if (input.result.binding.jobId
          !== `financial-council:${current.runId}:${current.role}:rebut:1`
        || input.result.binding.contentHash !== rebuttalContentHash(current.input)
        || input.result.binding.runId !== current.runId
        || input.result.binding.snapshotId !== current.snapshotId
        || input.result.binding.snapshotHash !== current.snapshotHash
        || input.result.binding.role !== current.role
        || input.result.binding.phase !== "rebut"
        || input.result.binding.attempt !== 1
        || input.result.value.findingId !== current.targetFindingId) {
        throw financialCouncilError("financial_council_rebuttal_invalid");
      }
      const stable = { ...current, status: "completed" as const,
        result: input.result, outputHash, completedAt: input.completedAt };
      const { attemptHash: _oldAttemptHash, ...attemptPreimage } = stable;
      const completed = { ...attemptPreimage,
        attemptHash: financialCouncilCanonicalHash(attemptPreimage) };
      const [dispositionRows] = await connection.query(
        `SELECT * FROM financial_council_finding_dispositions
         WHERE workspace_id = ? AND run_id = ? AND finding_id = ? FOR UPDATE`,
        [context.workspaceId, current.runId, current.targetFindingId]
      );
      const dispositionRow = (dispositionRows as MysqlRow[])[0];
      if (!dispositionRow) integrity();
      const disposition = parseDispositionRow(dispositionRow);
      const expectedStatus = input.result.value.decision === "withdraw"
        ? "withdrawn" : input.result.value.decision === "revise"
          ? "revised" : "upheld";
      const expectedBlocking = input.result.value.decision === "withdraw" ? []
        : input.result.value.decision === "revise"
          ? disposition.blockingConflictIds.filter((id) => id !== current.edgeId)
          : [...disposition.blockingConflictIds];
      if (input.disposition.status !== expectedStatus
        || canonical([...input.disposition.blockingConflictIds]
          .sort(utf8Compare)) !== canonical(expectedBlocking.sort(utf8Compare))) {
        throw financialCouncilError("financial_council_rebuttal_invalid");
      }
      const changed = { ...disposition, status: input.disposition.status,
        blockingConflictIds: [...input.disposition.blockingConflictIds]
          .sort(utf8Compare), updatedAt: input.completedAt };
      const { dispositionHash: _oldDispositionHash, ...dispositionPreimage }
        = changed;
      const completedDisposition = { ...dispositionPreimage,
        dispositionHash: financialCouncilCanonicalHash(dispositionPreimage) };
      await connection.query(
        `UPDATE financial_council_rebuttal_attempts
         SET status = ?, attempt_json = ?
         WHERE workspace_id = ? AND run_id = ? AND role = ? AND round_number = 1`,
        ["completed", canonical(completed), context.workspaceId,
          current.runId, current.role]
      );
      await connection.query(
        `UPDATE financial_council_finding_dispositions
         SET status = ?, disposition_hash = ?, disposition_json = ?
         WHERE workspace_id = ? AND run_id = ? AND finding_id = ?`,
        [completedDisposition.status, completedDisposition.dispositionHash,
          canonical(completedDisposition), context.workspaceId, current.runId,
          current.targetFindingId]
      );
      return { value: completed, replayed: false };
    });
  }

  async listFindingDispositions(
    context: ActiveWorkspaceContext, runId: string
  ): Promise<readonly FinancialCouncilFindingDisposition[]> {
    return this.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT * FROM financial_council_finding_dispositions
         WHERE workspace_id = ? AND run_id = ? ORDER BY BINARY finding_id ASC`,
        [context.workspaceId, runId]
      );
      return Object.freeze((rows as MysqlRow[]).map(parseDispositionRow));
    }, true);
  }

  private replay(
    existing: FinancialCouncilRun,
    requestHash: string
  ): FinancialCouncilCommandResult<FinancialCouncilRun> {
    if (existing.requestHash !== requestHash) {
      throw financialCouncilError("financial_council_idempotency_conflict");
    }
    return { value: existing, replayed: true };
  }

  private async readAuditGraph(
    source: Pick<mysql.Pool, "query">,
    workspaceId: string,
    runId: string,
    lock: boolean
  ): Promise<FinancialCouncilAuditGraph | null> {
    const [rows] = await source.query(
      `SELECT * FROM financial_council_audit_graphs
       WHERE workspace_id = ? AND run_id = ?${lock ? " FOR UPDATE" : ""}`,
      [workspaceId, runId]
    );
    const row = (rows as MysqlRow[])[0];
    return row ? parseAuditGraphRow(row) : null;
  }

  private async readRebuttalAttempt(
    source: Pick<mysql.Pool, "query">,
    workspaceId: string,
    runId: string,
    role: FinancialCouncilAgentRole,
    round: number,
    lock: boolean
  ): Promise<FinancialCouncilRebuttalAttempt | null> {
    const [rows] = await source.query(
      `SELECT * FROM financial_council_rebuttal_attempts
       WHERE workspace_id = ? AND run_id = ? AND role = ?
         AND round_number = ?${lock ? " FOR UPDATE" : ""}`,
      [workspaceId, runId, role, round]
    );
    const row = (rows as MysqlRow[])[0];
    return row ? parseRebuttalAttemptRow(row) : null;
  }

  private async readSpecialistResult(
    source: Pick<mysql.Pool, "query">,
    workspaceId: string,
    runId: string,
    role: FinancialCouncilAgentRole,
    phase: FinancialCouncilSpecialistPhase,
    lock: boolean
  ): Promise<FinancialCouncilSpecialistResult | null> {
    const [rows] = await source.query(
      `SELECT workspace_id, run_id, role, phase, result_id, snapshot_id,
              snapshot_hash, result_hash, result_json,
              DATE_FORMAT(created_at,
                '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at
       FROM financial_council_specialist_results
       WHERE workspace_id = ? AND run_id = ? AND role = ? AND phase = ?`
        + (lock ? " FOR UPDATE" : ""),
      [workspaceId, runId, role, phase]
    );
    const row = (rows as MysqlRow[])[0];
    return row ? this.readSpecialistResultByRow(source, row) : null;
  }

  private async readSpecialistResultByRow(
    source: Pick<mysql.Pool, "query">,
    row: MysqlRow
  ): Promise<FinancialCouncilSpecialistResult> {
    const values = [rowString(row, "workspace_id"), rowString(row, "run_id"),
      rowString(row, "role"), rowString(row, "phase")];
    const [findingRows] = await source.query(
      `SELECT * FROM financial_council_findings
       WHERE workspace_id = ? AND run_id = ? AND role = ? AND phase = ?
       ORDER BY BINARY finding_id ASC`, values
    );
    const [actionRows] = await source.query(
      `SELECT * FROM financial_council_candidate_actions
       WHERE workspace_id = ? AND run_id = ? AND role = ? AND phase = ?
       ORDER BY BINARY action_id ASC`, values
    );
    return parseSpecialistResult(
      row, findingRows as MysqlRow[], actionRows as MysqlRow[]
    );
  }

  private async readVerifiedFrozenByCreationKey(
    connection: mysql.PoolConnection,
    workspaceId: string,
    creationKeyHash: string,
    requestHash: string,
    lock: boolean
  ): Promise<FinancialCouncilRun | null> {
    const existing = await this.findByCreationKey(
      connection, workspaceId, creationKeyHash, lock
    );
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw financialCouncilError("financial_council_idempotency_conflict");
    }
    if (existing.status === "created" || existing.revision < 2
      || existing.snapshotId === null || existing.snapshotHash === null) {
      integrity();
    }
    await this.verifyStoredRun(connection, existing);
    return existing;
  }

  private async verifyStoredRun(
    source: Pick<mysql.Pool, "query">,
    run: FinancialCouncilRun,
    suppliedEventRows?: readonly MysqlRow[]
  ): Promise<readonly FinancialCouncilRunEvent[]> {
    const eventRows = suppliedEventRows ?? (await source.query(
      `${EVENT_SELECT}
       WHERE workspace_id = ? AND run_id = ? ORDER BY revision ASC`,
      [run.workspaceId, run.runId]
    ))[0] as MysqlRow[];
    const events = Object.freeze(eventRows.map(parseEvent));
    assertFinancialCouncilRunHistory(run, events, integrity);
    if (run.snapshotId !== null) {
      const [snapshotRows] = await source.query(
        `${SNAPSHOT_SELECT}
         WHERE workspace_id = ? AND run_id = ?`,
        [run.workspaceId, run.runId]
      );
      const snapshotRow = (snapshotRows as MysqlRow[])[0];
      if (!snapshotRow) integrity();
      assertStoredSnapshot(run, parseSnapshot(snapshotRow), events);
    } else if (run.status !== "created") {
      integrity();
    }
    return events;
  }

  private async readVerifiedHistory(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<{
    readonly run: FinancialCouncilRun;
    readonly events: readonly FinancialCouncilRunEvent[];
  } | null> {
    return this.transaction(async (connection) => {
      const [runRows] = await connection.query(
        `SELECT * FROM financial_council_runs
         WHERE workspace_id = ? AND run_id = ?`,
        [context.workspaceId, runId]
      );
      const [eventRows] = await connection.query(
        `${EVENT_SELECT}
         WHERE workspace_id = ? AND run_id = ? ORDER BY revision ASC`,
        [context.workspaceId, runId]
      );
      const runRow = (runRows as MysqlRow[])[0];
      const rawEvents = eventRows as MysqlRow[];
      if (!runRow) {
        if (rawEvents.length !== 0) integrity();
        return null;
      }
      const run = parseRun(runRow);
      const events = await this.verifyStoredRun(connection, run, rawEvents);
      return Object.freeze({ run, events });
    }, true);
  }

  private async findByCreationKey(
    source: Pick<mysql.Pool, "query">,
    workspaceId: string,
    creationKeyHash: string,
    lock: boolean
  ): Promise<FinancialCouncilRun | null> {
    const [rows] = await source.query(
      `SELECT * FROM financial_council_runs
       WHERE workspace_id = ? AND creation_key_hash = ?${lock ? " FOR UPDATE" : ""}`,
      [workspaceId, creationKeyHash]
    );
    const row = (rows as MysqlRow[])[0];
    return row ? parseRun(row) : null;
  }

  private async findByRunId(
    source: Pick<mysql.Pool, "query">,
    workspaceId: string,
    runId: string,
    lock: boolean
  ): Promise<FinancialCouncilRun | null> {
    const [rows] = await source.query(
      `SELECT * FROM financial_council_runs
       WHERE workspace_id = ? AND run_id = ?${lock ? " FOR UPDATE" : ""}`,
      [workspaceId, runId]
    );
    const row = (rows as MysqlRow[])[0];
    return row ? parseRun(row) : null;
  }

  private async updateRun(
    connection: mysql.PoolConnection,
    current: FinancialCouncilRun,
    next: FinancialCouncilRun
  ): Promise<void> {
    const [result] = await connection.query(
      `UPDATE financial_council_runs
       SET revision = ?, status = ?, snapshot_id = ?, snapshot_hash = ?,
         run_json = ?
       WHERE workspace_id = ? AND run_id = ? AND revision = ?`,
      [next.revision, next.status, next.snapshotId, next.snapshotHash,
        canonical(next), next.workspaceId, next.runId, current.revision]
    );
    if (affectedRows(result) !== 1) {
      throw financialCouncilError("financial_council_revision_conflict");
    }
  }

  private async appendEvent(
    connection: mysql.PoolConnection,
    event: FinancialCouncilRunEvent
  ): Promise<void> {
    await connection.query(
      `INSERT INTO financial_council_run_events (
         event_id, run_id, workspace_id, revision, from_status, to_status,
         reason_code, occurred_at, actor_id, aggregate_snapshot_hash,
         aggregate_snapshot_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.eventId, event.runId, event.workspaceId, event.revision,
        event.fromStatus, event.toStatus, event.reasonCode,
        sqlDate(event.occurredAt), event.actorId, event.aggregateSnapshotHash,
        canonical(event.aggregateSnapshot)]
    );
  }

  private async transaction<T>(
    work: (connection: mysql.PoolConnection) => Promise<T>,
    consistentSnapshot = false
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    let poisoned = false;
    try {
      if (consistentSnapshot) {
        await connection.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
        );
      }
      await connection.beginTransaction();
      try {
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          poison(connection);
          poisoned = true;
        }
        throw error;
      }
    } finally {
      if (!poisoned) connection.release();
    }
  }
}
