import assert from "node:assert/strict";
import { test } from "node:test";
import type mysql from "mysql2/promise";
import {
  AcquisitionDiscoveryOperationError,
  type AcquisitionContentFetchOperationRecord,
  type AcquisitionImportOperationRecord
} from "./acquisition-discovery-operations.js";
import {
  ACQUISITION_DISCOVERY_MYSQL_SCHEMA_STATEMENTS,
  MysqlAcquisitionDiscoveryOperationRepository,
  ensureAcquisitionDiscoveryMysqlSchema
} from "./acquisition-discovery-mysql-repository.js";

class FakePool {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  readonly queue: Array<[unknown, unknown]> = [];

  enqueue(rows: unknown) {
    this.queue.push([rows, []]);
  }

  async query(sql: string, values: unknown[] = []) {
    this.calls.push({
      sql: sql.replace(/\s+/gu, " ").trim(),
      values
    });
    return this.queue.shift() ?? [{ affectedRows: 1 }, []];
  }
}

function asPool(pool: FakePool) {
  return pool as unknown as mysql.Pool;
}

const fetchOperation: AcquisitionContentFetchOperationRecord = {
  id: "fetch-1",
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "user-a",
  sourceUrl: "https://example.com/opportunity",
  finalUrl: null,
  subjectChannel: "organization",
  status: "queued",
  accessStatus: null,
  httpStatus: null,
  contentType: null,
  title: null,
  rawArtifactHash: null,
  contentHash: null,
  evidenceCount: 0,
  errorCode: null,
  idempotencyKeyHash: "a".repeat(64),
  requestHash: `sha256:${"b".repeat(64)}`,
  createdAt: "2026-07-24T08:00:00.000Z",
  startedAt: null,
  completedAt: null
};

const importOperation: AcquisitionImportOperationRecord = {
  id: "import-1",
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "user-a",
  fileName: "leads.csv",
  mediaType: "text/csv",
  subjectChannel: "individual",
  artifactHash: `sha256:${"c".repeat(64)}`,
  artifactCiphertext: "artifact-v1.iv.tag.ciphertext",
  columnMapping: {
    sourceTitle: "title",
    sourceSnippet: "snippet"
  },
  status: "queued",
  rowCount: 0,
  acceptedRowCount: 0,
  errorRows: [],
  errorCode: null,
  idempotencyKeyHash: "d".repeat(64),
  requestHash: `sha256:${"e".repeat(64)}`,
  createdAt: "2026-07-24T08:00:00.000Z",
  startedAt: null,
  completedAt: null
};

test("discovery operation schema creates durable tenant and idempotency indexes", async () => {
  const pool = new FakePool();
  await ensureAcquisitionDiscoveryMysqlSchema(asPool(pool));
  assert.equal(
    pool.calls.length,
    ACQUISITION_DISCOVERY_MYSQL_SCHEMA_STATEMENTS.length
  );
  const schema = pool.calls.map((call) => call.sql).join("\n");
  assert.match(schema, /acquisition_content_fetch_operations/);
  assert.match(schema, /acquisition_import_operations/);
  assert.match(schema, /UNIQUE KEY uk_acquisition_fetch_idempotency/);
  assert.match(schema, /UNIQUE KEY uk_acquisition_import_idempotency/);
});

test("mysql repository persists encrypted import artifacts and tenant-scoped fetch records", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));

  const createdFetch = await repository.createContentFetchOperation(
    fetchOperation
  );
  assert.equal(createdFetch.created, true);
  assert.equal(createdFetch.operation.id, fetchOperation.id);
  const fetchInsert = pool.calls.at(-1)!;
  assert.match(fetchInsert.sql, /INSERT INTO acquisition_content_fetch_operations/);
  assert.doesNotMatch(JSON.stringify(fetchInsert.values), /fetch-key/);

  pool.enqueue([{
    payload_json: JSON.stringify(fetchOperation)
  }]);
  const loaded = await repository.getContentFetchOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    fetchOperation.id
  );
  assert.deepEqual(loaded, fetchOperation);
  const fetchSelect = pool.calls.at(-1)!;
  assert.match(fetchSelect.sql, /owner_id = \\?/);
  assert.match(fetchSelect.sql, /team_id = \\?/);
  assert.deepEqual(
    fetchSelect.values.slice(0, 3),
    [fetchOperation.id, "owner-a", "team-a"]
  );

  const createdImport = await repository.createImportOperation(
    importOperation
  );
  assert.equal(createdImport.created, true);
  const importInsert = pool.calls.at(-1)!;
  assert.match(importInsert.sql, /INSERT INTO acquisition_import_operations/);
  const serialized = JSON.stringify(importInsert.values);
  assert.match(serialized, /artifact-v1\.iv\.tag\.ciphertext/);
  assert.doesNotMatch(serialized, /contentBase64/);
});

test("mysql claim is atomic and never steals running or terminal operations", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  pool.enqueue({ affectedRows: 1 });
  pool.enqueue([{
    payload_json: JSON.stringify({
      ...fetchOperation,
      status: "running",
      startedAt: "2026-07-24T08:01:00.000Z"
    })
  }]);
  const claimed = await repository.claimContentFetchOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    fetchOperation.id,
    "2026-07-24T08:01:00.000Z"
  );
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.operation?.status, "running");
  const update = pool.calls[0]!;
  assert.match(update.sql, /status = 'queued'/);
  assert.match(update.sql, /owner_id = \\?/);
  assert.match(update.sql, /team_id = \\?/);
});

test("duplicate idempotency compares request hashes instead of silently reusing another request", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  const duplicate = Object.assign(new Error("duplicate"), {
    errno: 1062,
    code: "ER_DUP_ENTRY"
  });
  pool.query = async function query(
    sql: string,
    values: unknown[] = []
  ) {
    this.calls.push({
      sql: sql.replace(/\s+/gu, " ").trim(),
      values
    });
    if (sql.includes("INSERT INTO")) throw duplicate;
    return [[{
      payload_json: JSON.stringify({
        ...fetchOperation,
        requestHash: `sha256:${"f".repeat(64)}`
      })
    }], []];
  };
  await assert.rejects(
    repository.createContentFetchOperation(fetchOperation),
    (error: unknown) =>
      error instanceof AcquisitionDiscoveryOperationError
      && error.code === "IDEMPOTENCY_CONFLICT"
  );
});
