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
  type FinancialCouncilCommandResult,
  type CreateAndFreezeFinancialCouncilRunInput,
  type FinancialCouncilRepository,
  type ListRunnableFinancialCouncilRunsInput,
  type StoreFrozenFinancialSnapshotInput,
  type TransitionFinancialCouncilRunInput
} from "./financial-council-repository.js";

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
  ) ENGINE=InnoDB`
] as const);

const FINANCIAL_COUNCIL_SCHEMA_LOCK = "financial:council-schema:v1";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const STATUSES = new Set<string>(FINANCIAL_COUNCIL_RUN_STATUSES);

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
        `SELECT * FROM financial_council_snapshots
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
          `SELECT * FROM financial_council_run_events
           WHERE workspace_id = ? AND run_id = ? ORDER BY revision ASC`,
          [run.workspaceId, run.runId]
        );
        const events = Object.freeze((eventRows as MysqlRow[]).map(parseEvent));
        assertFinancialCouncilRunHistory(run, events, integrity);
        const [snapshotRows] = await connection.query(
          `SELECT * FROM financial_council_snapshots
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

  private replay(
    existing: FinancialCouncilRun,
    requestHash: string
  ): FinancialCouncilCommandResult<FinancialCouncilRun> {
    if (existing.requestHash !== requestHash) {
      throw financialCouncilError("financial_council_idempotency_conflict");
    }
    return { value: existing, replayed: true };
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
      `SELECT * FROM financial_council_run_events
       WHERE workspace_id = ? AND run_id = ? ORDER BY revision ASC`,
      [run.workspaceId, run.runId]
    ))[0] as MysqlRow[];
    const events = Object.freeze(eventRows.map(parseEvent));
    assertFinancialCouncilRunHistory(run, events, integrity);
    if (run.snapshotId !== null) {
      const [snapshotRows] = await source.query(
        `SELECT * FROM financial_council_snapshots
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
        `SELECT * FROM financial_council_run_events
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
