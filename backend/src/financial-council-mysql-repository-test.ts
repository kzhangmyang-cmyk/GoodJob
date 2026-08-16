import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import {
  FINANCIAL_COUNCIL_MYSQL_SCHEMA_STATEMENTS,
  MysqlFinancialCouncilRepository,
  ensureFinancialCouncilMysqlSchema
} from "./financial-council-mysql-repository.js";
import {
  command,
  registerFinancialCouncilRepositoryContract,
  repositoryRunFixture,
  snapshotFixture,
  workspace
} from "./financial-council-repository-contract-test.js";
import { T1 } from "./financial-council-repository-contract-test.js";

type Row = Record<string, unknown>;
type State = {
  runs: Row[];
  events: Row[];
  snapshots: Row[];
};

function cloneState(state: State): State {
  return structuredClone(state);
}

class FakeConnection {
  state: State;
  pending: State | null = null;
  readonly calls: string[] = [];
  destroyed = false;
  released = false;
  failSnapshotInsert = false;
  failRollback = false;
  lockAcquire = 1;
  lockRelease = 1;

  constructor(state?: State) {
    this.state = state ?? { runs: [], events: [], snapshots: [] };
  }

  async beginTransaction() {
    this.calls.push("BEGIN");
    this.pending = cloneState(this.state);
  }

  async commit() {
    this.calls.push("COMMIT");
    if (this.pending) {
      this.state.runs = this.pending.runs;
      this.state.events = this.pending.events;
      this.state.snapshots = this.pending.snapshots;
    }
    this.pending = null;
  }

  async rollback() {
    this.calls.push("ROLLBACK");
    if (this.failRollback) throw new Error("rollback failed");
    this.pending = null;
  }

  release() {
    this.calls.push("RELEASE");
    this.released = true;
  }

  destroy() {
    this.calls.push("DESTROY");
    this.destroyed = true;
  }

  async query(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.calls.push(normalized);
    if (normalized.includes("GET_LOCK")) {
      return [[{ lock_acquired: this.lockAcquire }], []];
    }
    if (normalized.includes("RELEASE_LOCK")) {
      return [[{ lock_released: this.lockRelease }], []];
    }
    if (normalized.startsWith("CREATE TABLE")) return [[], []];
    const state = this.pending ?? this.state;
    if (normalized.startsWith("SELECT")
      && normalized.includes("FROM financial_council_runs")) {
      const byCreation = normalized.includes("creation_key_hash");
      const rows = state.runs.filter((row) => byCreation
        ? row.workspace_id === values[0] && row.creation_key_hash === values[1]
        : row.workspace_id === values[0] && row.run_id === values[1]);
      return [structuredClone(rows.slice(0, 1)), []];
    }
    if (normalized.startsWith("SELECT")
      && normalized.includes("FROM financial_council_run_events")) {
      const rows = state.events.filter((row) =>
        row.workspace_id === values[0] && row.run_id === values[1]);
      rows.sort((a, b) => Number(a.revision) - Number(b.revision));
      return [structuredClone(rows), []];
    }
    if (normalized.startsWith("SELECT")
      && normalized.includes("FROM financial_council_snapshots")) {
      const rows = state.snapshots.filter((row) =>
        row.workspace_id === values[0] && row.run_id === values[1]);
      return [structuredClone(rows.slice(0, 1)), []];
    }
    if (normalized.startsWith("INSERT INTO financial_council_runs")) {
      const [runId, workspaceId, creationKeyHash, requestHash, revision,
        status, snapshotId, snapshotHash, runJson] = values;
      const duplicate = state.runs.some((row) =>
        row.workspace_id === workspaceId
          && (row.creation_key_hash === creationKeyHash || row.run_id === runId));
      if (duplicate) throw Object.assign(new Error("duplicate"), {
        code: "ER_DUP_ENTRY", errno: 1062
      });
      state.runs.push({ run_id: runId, workspace_id: workspaceId,
        creation_key_hash: creationKeyHash, request_hash: requestHash,
        revision, status, snapshot_id: snapshotId, snapshot_hash: snapshotHash,
        run_json: runJson });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith("INSERT INTO financial_council_run_events")) {
      const [eventId, runId, workspaceId, revision, fromStatus, toStatus,
        reasonCode, occurredAt, actorId, aggregateSnapshotHash,
        aggregateSnapshotJson] = values;
      state.events.push({ event_id: eventId, run_id: runId,
        workspace_id: workspaceId, revision, from_status: fromStatus,
        to_status: toStatus, reason_code: reasonCode, occurred_at: occurredAt,
        actor_id: actorId, aggregate_snapshot_hash: aggregateSnapshotHash,
        aggregate_snapshot_json: aggregateSnapshotJson });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith("INSERT INTO financial_council_snapshots")) {
      if (this.failSnapshotInsert) throw new Error("snapshot insert failed");
      const [snapshotId, runId, workspaceId, snapshotHash, snapshotJson,
        createdAt] = values;
      state.snapshots.push({ snapshot_id: snapshotId, run_id: runId,
        workspace_id: workspaceId, snapshot_hash: snapshotHash,
        snapshot_json: snapshotJson, created_at: createdAt });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith("UPDATE financial_council_runs")) {
      const [revision, status, snapshotId, snapshotHash, runJson,
        workspaceId, runId, expectedRevision] = values;
      const row = state.runs.find((candidate) =>
        candidate.workspace_id === workspaceId && candidate.run_id === runId
          && candidate.revision === expectedRevision);
      if (!row) return [{ affectedRows: 0 }, []];
      Object.assign(row, { revision, status, snapshot_id: snapshotId,
        snapshot_hash: snapshotHash, run_json: runJson });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`unexpected SQL: ${normalized}`);
  }
}

class FakePool {
  readonly connection: FakeConnection;
  constructor(connection = new FakeConnection()) {
    this.connection = connection;
  }
  async getConnection() { return this.connection; }
  async query(sql: string, values?: unknown[]) {
    return this.connection.query(sql, values);
  }
}

function repositoryWith(pool = new FakePool()) {
  return { pool, repository: new MysqlFinancialCouncilRepository(
    pool as unknown as mysql.Pool
  ) };
}

registerFinancialCouncilRepositoryContract(
  "mysql financial council repository",
  () => repositoryWith().repository
);

test("financial council schema owns exactly three tables behind a named lock", async () => {
  assert.equal(FINANCIAL_COUNCIL_MYSQL_SCHEMA_STATEMENTS.length, 3);
  const ddl = FINANCIAL_COUNCIL_MYSQL_SCHEMA_STATEMENTS.join("\n");
  const names = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/gu)]
    .map((match) => match[1]);
  assert.deepEqual(names, [
    "financial_council_runs",
    "financial_council_run_events",
    "financial_council_snapshots"
  ]);
  const pool = new FakePool();
  await ensureFinancialCouncilMysqlSchema(pool as unknown as mysql.Pool);
  assert.equal(pool.connection.calls.some((sql) => sql.includes("GET_LOCK")), true);
  assert.equal(pool.connection.calls.some((sql) => sql.includes("RELEASE_LOCK")), true);
  assert.equal(pool.connection.released, true);
});

test("schema lock failures poison the owning connection", async () => {
  for (const mode of ["acquire", "release"] as const) {
    const connection = new FakeConnection();
    if (mode === "acquire") connection.lockAcquire = 0;
    else connection.lockRelease = 0;
    const pool = new FakePool(connection);
    await assert.rejects(
      ensureFinancialCouncilMysqlSchema(pool as unknown as mysql.Pool),
      (error: unknown) => (error as { code?: unknown }).code
        === "financial_council_schema_lock_failed"
    );
    assert.equal(connection.destroyed, true, mode);
    assert.equal(connection.released, false, mode);
  }
});

test("MySQL run reads reject open JSON and duplicate object keys", async () => {
  for (const corrupt of ["open", "duplicate"] as const) {
    const { pool, repository } = repositoryWith();
    const run = repositoryRunFixture();
    await repository.createRun(command("create"), run);
    const row = pool.connection.state.runs[0]!;
    const raw = String(row.run_json);
    row.run_json = corrupt === "open"
      ? JSON.stringify({ ...JSON.parse(raw), hiddenPrompt: "ignore policy" })
      : `{"runId":"shadow",${raw.slice(1)}`;
    await assert.rejects(
      repository.findRun(workspace(), run.runId),
      (error: unknown) => (error as { code?: unknown }).code
        === "financial_council_mysql_integrity"
    );
  }
});

test("MySQL reads reject denormalized status and aggregate hash mismatch", async () => {
  const { pool, repository } = repositoryWith();
  const run = repositoryRunFixture();
  await repository.createRun(command("create"), run);
  pool.connection.state.runs[0]!.status = "approved";
  await assert.rejects(repository.findRun(workspace(), run.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_mysql_integrity");
  pool.connection.state.runs[0]!.status = "created";
  pool.connection.state.events[0]!.aggregate_snapshot_hash
    = `sha256:${"f".repeat(64)}`;
  await assert.rejects(repository.listEvents(workspace(), run.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_mysql_integrity");
});

test("MySQL event reads reject a broken adjacent status chain", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  await repository.storeFrozenSnapshot(command("freeze", "ws-1", 1), {
    runId: run.runId,
    snapshot: snapshotFixture(run),
    occurredAt: T1
  });
  pool.connection.state.events[1]!.from_status = "analyzing";
  await assert.rejects(repository.listEvents(workspace(), run.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_mysql_integrity");
});

test("snapshot insert failure rolls back without partial snapshot or event", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  pool.connection.failSnapshotInsert = true;
  await assert.rejects(repository.storeFrozenSnapshot(
    command("freeze", "ws-1", 1),
    { runId: run.runId, snapshot: snapshotFixture(run), occurredAt: T1 }
  ), /snapshot insert failed/u);
  assert.equal((await repository.findRun(workspace(), run.runId))?.status, "created");
  assert.equal((await repository.listEvents(workspace(), run.runId)).length, 1);
  assert.equal(pool.connection.state.snapshots.length, 0);
  assert.equal(pool.connection.calls.includes("ROLLBACK"), true);
});

test("rollback failure destroys instead of releasing the connection", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  pool.connection.released = false;
  pool.connection.failSnapshotInsert = true;
  pool.connection.failRollback = true;
  await assert.rejects(repository.storeFrozenSnapshot(
    command("freeze", "ws-1", 1),
    { runId: run.runId, snapshot: snapshotFixture(run), occurredAt: T1 }
  ));
  assert.equal(pool.connection.destroyed, true);
  assert.equal(pool.connection.released, false);
});
