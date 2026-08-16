import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import {
  FINANCIAL_COUNCIL_MYSQL_SCHEMA_STATEMENTS,
  MysqlFinancialCouncilRepository,
  ensureFinancialCouncilMysqlSchema
} from "./financial-council-mysql-repository.js";
import {
  financialCouncilAggregateHash
} from "./financial-council-domain.js";
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

function compareUtf8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

type FailurePoint =
  | "run_insert"
  | "created_event_insert"
  | "snapshot_insert"
  | "run_update"
  | "event_insert"
  | "frozen_event_insert"
  | null;

class FakeConnection {
  pending: State | null = null;
  dirty = false;
  readonly calls: string[] = [];
  destroyed = false;
  released = false;

  constructor(readonly pool: FakePool) {}

  get state() { return this.pool.state; }

  async beginTransaction() {
    this.calls.push("BEGIN");
    this.pending = cloneState(this.pool.state);
  }

  async commit() {
    this.calls.push("COMMIT");
    if (this.pending && this.dirty) {
      this.pool.state.runs = this.pending.runs;
      this.pool.state.events = this.pending.events;
      this.pool.state.snapshots = this.pending.snapshots;
    }
    this.pending = null;
    this.dirty = false;
    this.pool.releaseRowLocks(this);
  }

  async rollback() {
    this.calls.push("ROLLBACK");
    if (this.pool.failRollback) throw new Error("rollback failed");
    this.pending = null;
    this.dirty = false;
    this.pool.releaseRowLocks(this);
  }

  release() {
    this.calls.push("RELEASE");
    this.released = true;
  }

  destroy() {
    this.calls.push("DESTROY");
    this.destroyed = true;
    this.pending = null;
    this.pool.releaseRowLocks(this);
  }

  async query(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.calls.push(normalized);
    if (normalized.includes("GET_LOCK")) {
      return [[{ lock_acquired: this.pool.lockAcquire }], []];
    }
    if (normalized.includes("RELEASE_LOCK")) {
      return [[{ lock_released: this.pool.lockRelease }], []];
    }
    if (normalized === "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ") {
      return [[], []];
    }
    if (normalized.startsWith("CREATE TABLE")) return [[], []];
    const state = this.pending ?? this.pool.state;
    if (normalized.startsWith("SELECT")
      && normalized.includes("FROM financial_council_runs")) {
      if (normalized.includes("status = 'snapshot_frozen'")) {
        const afterWorkspaceId = values[0] as string | null;
        const afterRunId = values[3] as string | null;
        const limit = Number(values[4]);
        const rows = state.runs.filter((row) => row.status === "snapshot_frozen"
          && (afterWorkspaceId === null
            || compareUtf8Bytes(
              String(row.workspace_id), afterWorkspaceId
            ) > 0
            || (String(row.workspace_id) === afterWorkspaceId
              && compareUtf8Bytes(
                String(row.run_id), String(afterRunId)
              ) > 0)))
          .sort((left, right) => compareUtf8Bytes(
            String(left.workspace_id), String(right.workspace_id)
          ) || compareUtf8Bytes(String(left.run_id), String(right.run_id)))
          .slice(0, limit);
        return [structuredClone(rows), []];
      }
      const byCreation = normalized.includes("creation_key_hash");
      if (normalized.includes("FOR UPDATE") && this.pending) {
        const lockKey = byCreation
          ? `creation:${String(values[0])}:${String(values[1])}`
          : `run:${String(values[0])}:${String(values[1])}`;
        await this.pool.acquireRowLock(lockKey, this);
        const committedRows = this.pool.state.runs.filter((row) => byCreation
          ? row.workspace_id === values[0] && row.creation_key_hash === values[1]
          : row.workspace_id === values[0] && row.run_id === values[1]);
        state.runs = state.runs.filter((row) => byCreation
          ? !(row.workspace_id === values[0]
            && row.creation_key_hash === values[1])
          : !(row.workspace_id === values[0] && row.run_id === values[1]));
        state.runs.push(...structuredClone(committedRows));
        if (byCreation) {
          const committedRunIds = new Set(committedRows.map((row) => row.run_id));
          state.events = state.events.filter((row) =>
            row.workspace_id !== values[0]
              || !committedRunIds.has(row.run_id));
          state.events.push(...structuredClone(this.pool.state.events.filter(
            (row) => row.workspace_id === values[0]
              && committedRunIds.has(row.run_id)
          )));
          state.snapshots = state.snapshots.filter((row) =>
            row.workspace_id !== values[0]
              || !committedRunIds.has(row.run_id));
          state.snapshots.push(...structuredClone(
            this.pool.state.snapshots.filter((row) =>
              row.workspace_id === values[0]
                && committedRunIds.has(row.run_id)
            )
          ));
        }
      }
      const rows = state.runs.filter((row) => byCreation
        ? row.workspace_id === values[0] && row.creation_key_hash === values[1]
        : row.workspace_id === values[0] && row.run_id === values[1]);
      const result = structuredClone(rows.slice(0, 1));
      if (!normalized.includes("FOR UPDATE")) {
        await this.pool.afterRunRead(String(values[1]));
      }
      return [result, []];
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
      if (normalized.includes("FOR UPDATE") && this.pending) {
        const lockKey = `snapshot-run:${String(values[0])}:${String(values[1])}`;
        await this.pool.acquireRowLock(lockKey, this);
        const committedRows = this.pool.state.snapshots.filter((row) =>
          row.workspace_id === values[0] && row.run_id === values[1]);
        state.snapshots = state.snapshots.filter((row) =>
          !(row.workspace_id === values[0] && row.run_id === values[1]));
        state.snapshots.push(...structuredClone(committedRows));
      }
      const rows = state.snapshots.filter((row) =>
        row.workspace_id === values[0] && row.run_id === values[1]);
      return [structuredClone(rows.slice(0, 1)), []];
    }
    if (normalized.startsWith("INSERT INTO financial_council_runs")) {
      this.pool.createInsertAttempts += 1;
      if (this.pool.transientCreateFailures > 0) {
        this.pool.transientCreateFailures -= 1;
        throw Object.assign(new Error("deadlock"), {
          code: "ER_LOCK_DEADLOCK", errno: 1213
        });
      }
      if (this.pool.failurePoint === "run_insert") {
        throw new Error("run insert failed");
      }
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
      this.dirty = true;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith("INSERT INTO financial_council_run_events")) {
      const eventRevision = Number(values[3]);
      if (this.pool.failurePoint === "event_insert"
        || (this.pool.failurePoint === "created_event_insert"
          && eventRevision === 1)
        || (this.pool.failurePoint === "frozen_event_insert"
          && eventRevision === 2)) {
        throw new Error("event insert failed");
      }
      const [eventId, runId, workspaceId, revision, fromStatus, toStatus,
        reasonCode, occurredAt, actorId, aggregateSnapshotHash,
        aggregateSnapshotJson] = values;
      state.events.push({ event_id: eventId, run_id: runId,
        workspace_id: workspaceId, revision, from_status: fromStatus,
        to_status: toStatus, reason_code: reasonCode, occurred_at: occurredAt,
        actor_id: actorId, aggregate_snapshot_hash: aggregateSnapshotHash,
        aggregate_snapshot_json: aggregateSnapshotJson });
      this.dirty = true;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith("INSERT INTO financial_council_snapshots")) {
      if (this.pool.failurePoint === "snapshot_insert") {
        throw new Error("snapshot insert failed");
      }
      const [snapshotId, runId, workspaceId, snapshotHash, snapshotJson,
        createdAt] = values;
      if (state.snapshots.some((row) => row.workspace_id === workspaceId
        && (row.snapshot_id === snapshotId || row.run_id === runId))) {
        throw Object.assign(new Error("duplicate"), {
          code: "ER_DUP_ENTRY", errno: 1062
        });
      }
      state.snapshots.push({ snapshot_id: snapshotId, run_id: runId,
        workspace_id: workspaceId, snapshot_hash: snapshotHash,
        snapshot_json: snapshotJson, created_at: createdAt });
      this.dirty = true;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith("UPDATE financial_council_runs")) {
      if (this.pool.failurePoint === "run_update") {
        throw new Error("run update failed");
      }
      const [revision, status, snapshotId, snapshotHash, runJson,
        workspaceId, runId, expectedRevision] = values;
      const row = state.runs.find((candidate) =>
        candidate.workspace_id === workspaceId && candidate.run_id === runId
          && candidate.revision === expectedRevision);
      if (!row) return [{ affectedRows: 0 }, []];
      Object.assign(row, { revision, status, snapshot_id: snapshotId,
        snapshot_hash: snapshotHash, run_json: runJson });
      this.dirty = true;
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`unexpected SQL: ${normalized}`);
  }
}

class FakePool {
  readonly state: State = { runs: [], events: [], snapshots: [] };
  readonly connections: FakeConnection[] = [];
  readonly lockAttempts = new Map<string, number>();
  private readonly rowLocks = new Map<string, FakeConnection>();
  private readonly lockWaiters = new Map<string, Array<() => void>>();
  private barrierResolve: (() => void) | null = null;
  private barrierPromise: Promise<void> | null = null;
  failurePoint: FailurePoint = null;
  transientCreateFailures = 0;
  createInsertAttempts = 0;
  failRollback = false;
  lockAcquire = 1;
  lockRelease = 1;
  barrierRunId: string | null = null;
  private readBarrierRunId: string | null = null;
  private readCapturedResolve: (() => void) | null = null;
  private readCaptured: Promise<void> | null = null;
  private resumeReadResolve: (() => void) | null = null;
  private resumeRead: Promise<void> | null = null;

  get connection() { return this.connections.at(-1)!; }

  async getConnection() {
    const connection = new FakeConnection(this);
    this.connections.push(connection);
    return connection;
  }

  async query(sql: string, values?: unknown[]) {
    return new FakeConnection(this).query(sql, values);
  }

  armReadBarrier(runId: string) {
    this.readBarrierRunId = runId;
    this.readCaptured = new Promise<void>((resolve) => {
      this.readCapturedResolve = resolve;
    });
    this.resumeRead = new Promise<void>((resolve) => {
      this.resumeReadResolve = resolve;
    });
  }

  async waitForRunRead() {
    await this.readCaptured;
  }

  resumeRunRead() {
    this.resumeReadResolve?.();
  }

  async afterRunRead(runId: string) {
    if (runId !== this.readBarrierRunId) return;
    this.readBarrierRunId = null;
    this.readCapturedResolve?.();
    await this.resumeRead;
  }

  async acquireRowLock(key: string, connection: FakeConnection) {
    const attempts = (this.lockAttempts.get(key) ?? 0) + 1;
    this.lockAttempts.set(key, attempts);
    if (this.barrierRunId && key.endsWith(`:${this.barrierRunId}`)) {
      if (!this.barrierPromise) {
        this.barrierPromise = new Promise<void>((resolve) => {
          this.barrierResolve = resolve;
        });
      }
      if (attempts >= 2) this.barrierResolve?.();
    }
    while (this.rowLocks.has(key)
      && this.rowLocks.get(key) !== connection) {
      await new Promise<void>((resolve) => {
        const waiters = this.lockWaiters.get(key) ?? [];
        waiters.push(resolve);
        this.lockWaiters.set(key, waiters);
      });
    }
    this.rowLocks.set(key, connection);
    if (attempts === 1 && this.barrierRunId
      && key.endsWith(`:${this.barrierRunId}`)) {
      await this.barrierPromise;
    }
  }

  releaseRowLocks(connection: FakeConnection) {
    for (const [key, owner] of this.rowLocks) {
      if (owner !== connection) continue;
      this.rowLocks.delete(key);
      const waiters = this.lockWaiters.get(key) ?? [];
      this.lockWaiters.delete(key);
      for (const resolve of waiters) resolve();
    }
  }
}

function repositoryWith(pool = new FakePool()) {
  return { pool, repository: new MysqlFinancialCouncilRepository(
    pool as unknown as mysql.Pool
  ) };
}

test("MySQL harness gives concurrent transactions distinct connections", async () => {
  const pool = new FakePool();
  const [first, second] = await Promise.all([
    pool.getConnection(), pool.getConnection()
  ]);
  assert.notEqual(first, second);
});

test("compound create rolls back every write point to zero visible state", async () => {
  for (const failurePoint of [
    "run_insert", "created_event_insert", "snapshot_insert",
    "frozen_event_insert"
  ] as const) {
    const { pool, repository } = repositoryWith();
    const aggregate = repositoryRunFixture();
    pool.failurePoint = failurePoint;
    await assert.rejects(repository.createAndFreezeRun(command("create"), {
      aggregate,
      snapshot: snapshotFixture(aggregate),
      occurredAt: T1
    }));
    assert.deepEqual({
      runs: pool.state.runs.length,
      events: pool.state.events.length,
      snapshots: pool.state.snapshots.length
    }, { runs: 0, events: 0, snapshots: 0 }, failurePoint);
    assert.equal(pool.connection.calls.includes("ROLLBACK"), true, failurePoint);
  }
});

test("compound create retries bounded transient deadlocks from a clean rollback", async () => {
  const { pool, repository } = repositoryWith();
  const aggregate = repositoryRunFixture();
  pool.transientCreateFailures = 1;
  const result = await repository.createAndFreezeRun(command("deadlock"), {
    aggregate, snapshot: snapshotFixture(aggregate), occurredAt: T1
  });
  assert.equal(result.value.status, "snapshot_frozen");
  assert.equal(pool.createInsertAttempts, 2);
  assert.equal(pool.connections[0]?.calls.includes("ROLLBACK"), true);
  assert.deepEqual([pool.state.runs.length, pool.state.events.length,
    pool.state.snapshots.length], [1, 2, 1]);
});

test("compound create stops after three transient attempts without partial state", async () => {
  const { pool, repository } = repositoryWith();
  const aggregate = repositoryRunFixture();
  pool.transientCreateFailures = 10;
  await assert.rejects(repository.createAndFreezeRun(command("deadlock"), {
    aggregate, snapshot: snapshotFixture(aggregate), occurredAt: T1
  }), (error: unknown) => (error as { errno?: unknown }).errno === 1213);
  assert.equal(pool.createInsertAttempts, 3);
  assert.deepEqual([pool.state.runs.length, pool.state.events.length,
    pool.state.snapshots.length], [0, 0, 0]);
  assert.equal(pool.connections.filter((connection) => connection.calls.some(
    (call) => call.startsWith("INSERT INTO financial_council_runs")
  )).every((connection) =>
    connection.calls.includes("ROLLBACK") && connection.released), true);
});

test("real InnoDB concurrent create has one complete writer and one replay", {
  skip: !process.env.MYSQL_TEST_ADMIN_URL
}, async () => {
  const adminUrl = process.env.MYSQL_TEST_ADMIN_URL!;
  const database = `financial_council_${process.pid}_${Date.now()}`;
  const admin = mysql.createPool(adminUrl);
  const target = new URL(adminUrl);
  target.pathname = `/${database}`;
  let first: mysql.Pool | undefined;
  let second: mysql.Pool | undefined;
  try {
    await admin.query("CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_bin", [database]);
    first = mysql.createPool({ uri: target.toString(), connectionLimit: 1 });
    second = mysql.createPool({ uri: target.toString(), connectionLimit: 1 });
    await ensureFinancialCouncilMysqlSchema(first);
    const firstRepository = new MysqlFinancialCouncilRepository(first);
    const secondRepository = new MysqlFinancialCouncilRepository(second);
    const left = repositoryRunFixture({ runId: "race-left" });
    const right = repositoryRunFixture({ runId: "race-right" });
    const results = await Promise.all([
      firstRepository.createAndFreezeRun(
        command("race-left"), {
          aggregate: left, snapshot: snapshotFixture(left), occurredAt: T1
        }
      ),
      secondRepository.createAndFreezeRun(
        command("race-right"), {
          aggregate: right, snapshot: snapshotFixture(right), occurredAt: T1
        }
      )
    ]);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(results[0]!.value.runId, results[1]!.value.runId);
    const [counts] = await first.query(
      `SELECT
         (SELECT COUNT(*) FROM financial_council_runs) AS runs,
         (SELECT COUNT(*) FROM financial_council_run_events) AS events,
         (SELECT COUNT(*) FROM financial_council_snapshots) AS snapshots`
    );
    assert.deepEqual((counts as Row[])[0], { runs: 1, events: 2, snapshots: 1 });
    const runnable = await firstRepository.listRunnableRuns({
      after: null, limit: 10
    });
    assert.deepEqual(runnable.map((run) => run.runId), [results[0]!.value.runId]);
  } finally {
    await Promise.allSettled([first?.end(), second?.end()].filter(Boolean));
    await admin.query("DROP DATABASE IF EXISTS ??", [database]);
    await admin.end();
  }
});

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

test("MySQL runnable scan uses binary UTF-8 bytes and no unavailable charset", async () => {
  const { pool, repository } = repositoryWith();
  await repository.listRunnableRuns({ after: null, limit: 1 });
  const query = pool.connection.calls.find((sql) =>
    sql.includes("status = 'snapshot_frozen'")) ?? "";
  assert.doesNotMatch(query, /utf16be/iu);
  assert.match(query, /ORDER BY BINARY workspace_id ASC, BINARY run_id ASC/u);
  assert.match(query, /BINARY workspace_id > BINARY \?/u);
});

test("schema lock failures poison the owning connection", async () => {
  for (const mode of ["acquire", "release"] as const) {
    const pool = new FakePool();
    if (mode === "acquire") pool.lockAcquire = 0;
    else pool.lockRelease = 0;
    await assert.rejects(
      ensureFinancialCouncilMysqlSchema(pool as unknown as mysql.Pool),
      (error: unknown) => (error as { code?: unknown }).code
        === "financial_council_schema_lock_failed"
    );
    const connection = pool.connection;
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

test("MySQL legacy create replay rejects a missing or corrupted first event", async () => {
  for (const corruption of ["missing", "hash"] as const) {
    const { pool, repository } = repositoryWith();
    const run = repositoryRunFixture();
    await repository.createRun(command("create"), run);
    if (corruption === "missing") pool.state.events.splice(0, 1);
    else pool.state.events[0]!.aggregate_snapshot_hash
      = `sha256:${"f".repeat(64)}`;

    await assert.rejects(
      repository.createRun(command("replay"), run),
      (error: unknown) =>
        (error as { code?: unknown }).code
          === "financial_council_mysql_integrity"
    );
  }
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

test("MySQL event reads reject a self-consistent illegal state edge", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  const approved = Object.freeze({
    ...run,
    status: "approved" as const,
    revision: 2,
    updatedAt: T1
  });
  pool.connection.state.events.push({
    event_id: `${run.runId}:2`,
    run_id: run.runId,
    workspace_id: run.workspaceId,
    revision: 2,
    from_status: "created",
    to_status: "approved",
    reason_code: null,
    occurred_at: T1,
    actor_id: "manager-1",
    aggregate_snapshot_hash: financialCouncilAggregateHash(approved),
    aggregate_snapshot_json: JSON.stringify(approved)
  });
  await assert.rejects(repository.listEvents(workspace(), run.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_mysql_integrity");
});

test("MySQL event reads bind occurredAt to the aggregate update time", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  pool.connection.state.events[0]!.occurred_at = T1;
  await assert.rejects(repository.listEvents(workspace(), run.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_mysql_integrity");
});

test("both MySQL read APIs reject a missing latest event", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  await repository.storeFrozenSnapshot(command("freeze", "ws-1", 1), {
    runId: run.runId,
    snapshot: snapshotFixture(run),
    occurredAt: T1
  });
  pool.connection.state.events.pop();
  const results = await Promise.allSettled([
    repository.findRun(workspace(), run.runId),
    repository.listEvents(workspace(), run.runId)
  ]);
  assert.deepEqual(results.map((result) => [
    result.status,
    result.status === "rejected" ? result.reason.code : null
  ]), [
    ["rejected", "financial_council_mysql_integrity"],
    ["rejected", "financial_council_mysql_integrity"]
  ]);
});

test("both MySQL read APIs reject current run and latest event divergence", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  const current = pool.connection.state.runs[0]!;
  const changed = {
    ...JSON.parse(String(current.run_json)),
    expiresAt: "2026-08-18T08:00:00.000Z"
  };
  current.run_json = JSON.stringify(changed);
  const results = await Promise.allSettled([
    repository.findRun(workspace(), run.runId),
    repository.listEvents(workspace(), run.runId)
  ]);
  assert.deepEqual(results.map((result) => [
    result.status,
    result.status === "rejected" ? result.reason.code : null
  ]), [
    ["rejected", "financial_council_mysql_integrity"],
    ["rejected", "financial_council_mysql_integrity"]
  ]);
});

test("MySQL reads reject an intermediate aggregate not derived by its event", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  await repository.storeFrozenSnapshot(command("freeze", "ws-1", 1), {
    runId: run.runId,
    snapshot: snapshotFixture(run),
    occurredAt: T1
  });
  await repository.transitionRun(command("advance", "ws-1", 2), {
    runId: run.runId,
    kind: "analyzing",
    occurredAt: "2026-08-16T08:02:00.000Z",
    reasonCode: null
  });
  const middle = pool.state.events[1]!;
  const changed = {
    ...JSON.parse(String(middle.aggregate_snapshot_json)),
    expiresAt: "2026-08-18T08:00:00.000Z"
  };
  middle.aggregate_snapshot_json = JSON.stringify(changed);
  middle.aggregate_snapshot_hash = financialCouncilAggregateHash(changed);
  await assert.rejects(repository.listEvents(workspace(), run.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_mysql_integrity");
});

test("concurrent MySQL transitions serialize on a row lock with one complete winner", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  await repository.storeFrozenSnapshot(command("freeze", "ws-1", 1), {
    runId: run.runId,
    snapshot: snapshotFixture(run),
    occurredAt: T1
  });
  pool.barrierRunId = run.runId;
  const runLockKey = `run:ws-1:${run.runId}`;
  const priorLockAttempts = pool.lockAttempts.get(runLockKey) ?? 0;
  const connectionStart = pool.connections.length;
  const results = await Promise.allSettled([
    repository.transitionRun(command("advance-a", "ws-1", 2), {
      runId: run.runId,
      kind: "analyzing",
      occurredAt: "2026-08-16T08:02:00.000Z",
      reasonCode: null
    }),
    repository.transitionRun(command("advance-b", "ws-1", 2), {
      runId: run.runId,
      kind: "analyzing",
      occurredAt: "2026-08-16T08:02:00.000Z",
      reasonCode: null
    })
  ]);
  const transitionConnections = pool.connections.slice(connectionStart);
  assert.equal(new Set(transitionConnections).size, 2);
  assert.deepEqual(results.map((result) => result.status).sort(), [
    "fulfilled", "rejected"
  ]);
  const loser = results.find((result) => result.status === "rejected") as
    PromiseRejectedResult;
  assert.equal(loser.reason.code, "financial_council_revision_conflict");
  pool.barrierRunId = null;
  const current = await repository.findRun(workspace(), run.runId);
  const events = await repository.listEvents(workspace(), run.runId);
  assert.deepEqual(
    [current?.status, current?.revision, events.length,
      pool.state.snapshots.length],
    ["analyzing", 3, 3, 1]
  );
  assert.equal(events.at(-1)?.revision, 3);
  assert.equal(transitionConnections.every((connection) =>
    connection.released && !connection.destroyed), true);
  assert.equal(pool.lockAttempts.get(runLockKey), priorLockAttempts + 2);
});

for (const method of ["findRun", "listEvents"] as const) {
  test(`${method} reads run and events from one transaction snapshot`, async () => {
    const { pool, repository } = repositoryWith();
    const run = (await repository.createRun(
      command(`create-${method}`), repositoryRunFixture()
    )).value;
    await repository.storeFrozenSnapshot(command(`freeze-${method}`, "ws-1", 1), {
      runId: run.runId,
      snapshot: snapshotFixture(run),
      occurredAt: T1
    });
    pool.armReadBarrier(run.runId);
    const readConnectionIndex = pool.connections.length;
    const read = method === "findRun"
      ? repository.findRun(workspace(), run.runId)
      : repository.listEvents(workspace(), run.runId);
    await pool.waitForRunRead();
    await repository.transitionRun(command(`advance-${method}`, "ws-1", 2), {
      runId: run.runId,
      kind: "analyzing",
      occurredAt: "2026-08-16T08:02:00.000Z",
      reasonCode: null
    });
    pool.resumeRunRead();
    const result = await read;
    const readConnection = pool.connections[readConnectionIndex]!;
    assert.equal(readConnection.calls.includes(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
    ), true);
    assert.equal(readConnection.calls.includes("BEGIN"), true);
    assert.equal(readConnection.calls.includes("COMMIT"), true);
    assert.equal(readConnection.calls.includes("ROLLBACK"), false);
    assert.equal(readConnection.released, true);
    assert.equal(readConnection.destroyed, false);
    if (method === "findRun") {
      const current = result as Awaited<ReturnType<typeof repository.findRun>>;
      assert.equal(current?.revision, 2);
      assert.equal(current?.status, "snapshot_frozen");
    } else {
      const events = result as Awaited<ReturnType<typeof repository.listEvents>>;
      assert.equal(events.length, 2);
      assert.equal(events.at(-1)?.toStatus, "snapshot_frozen");
    }
    assert.deepEqual(
      [(await repository.findRun(workspace(), run.runId))?.revision,
        (await repository.listEvents(workspace(), run.runId)).length],
      [3, 3]
    );
  });
}

test("failures after snapshot insert roll back run, event and snapshot together", async () => {
  for (const failurePoint of ["run_update", "event_insert"] as const) {
    const { pool, repository } = repositoryWith();
    const run = (await repository.createRun(
      command(`create-${failurePoint}`), repositoryRunFixture()
    )).value;
    pool.failurePoint = failurePoint;
    await assert.rejects(repository.storeFrozenSnapshot(
      command(`freeze-${failurePoint}`, "ws-1", 1),
      { runId: run.runId, snapshot: snapshotFixture(run), occurredAt: T1 }
    ), new RegExp(failurePoint.replace("_", " ")));
    const failedConnection = pool.connection;
    assert.equal(failedConnection.calls.some((sql) =>
      sql.startsWith("INSERT INTO financial_council_snapshots")), true);
    assert.equal(failedConnection.calls.includes("ROLLBACK"), true);
    assert.equal(failedConnection.released, true);
    assert.equal(failedConnection.destroyed, false);
    pool.failurePoint = null;
    const current = await repository.findRun(workspace(), run.runId);
    const events = await repository.listEvents(workspace(), run.runId);
    assert.deepEqual(
      [current?.status, current?.revision, events.length,
        pool.state.snapshots.length],
      ["created", 1, 1, 0],
      failurePoint
    );
  }
});

test("snapshot insert failure rolls back without partial snapshot or event", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  pool.failurePoint = "snapshot_insert";
  await assert.rejects(repository.storeFrozenSnapshot(
    command("freeze", "ws-1", 1),
    { runId: run.runId, snapshot: snapshotFixture(run), occurredAt: T1 }
  ), /snapshot insert failed/u);
  const failedConnection = pool.connection;
  assert.equal((await repository.findRun(workspace(), run.runId))?.status, "created");
  assert.equal((await repository.listEvents(workspace(), run.runId)).length, 1);
  assert.equal(failedConnection.state.snapshots.length, 0);
  assert.equal(failedConnection.calls.includes("ROLLBACK"), true);
});

test("rollback failure destroys instead of releasing the connection", async () => {
  const { pool, repository } = repositoryWith();
  const run = (await repository.createRun(
    command("create"), repositoryRunFixture()
  )).value;
  pool.failurePoint = "snapshot_insert";
  pool.failRollback = true;
  await assert.rejects(repository.storeFrozenSnapshot(
    command("freeze", "ws-1", 1),
    { runId: run.runId, snapshot: snapshotFixture(run), occurredAt: T1 }
  ));
  assert.equal(pool.connection.destroyed, true);
  assert.equal(pool.connection.released, false);
});
