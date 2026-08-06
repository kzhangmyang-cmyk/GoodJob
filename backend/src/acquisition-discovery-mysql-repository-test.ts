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
  evidenceIds: [],
  candidateCount: 0,
  candidateIds: [],
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
  evidenceCount: 0,
  evidenceIds: [],
  candidateCount: 0,
  candidateIds: [],
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

test("mysql repository defaults evidence ids for legacy content-fetch payloads", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  const legacyPayload = structuredClone(fetchOperation) as Partial<
    AcquisitionContentFetchOperationRecord
  >;
  delete legacyPayload.evidenceIds;
  pool.enqueue([{ payload_json: JSON.stringify(legacyPayload) }]);

  const loaded = await repository.getContentFetchOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    fetchOperation.id
  );

  assert.deepEqual(loaded?.evidenceIds, []);
});

test("mysql repository marks legacy terminal fetches without evidence ids as refetch-required failures", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  const legacyPayload = {
    ...structuredClone(fetchOperation),
    status: "succeeded" as const,
    finalUrl: "https://example.com/opportunity",
    accessStatus: "public_content" as const,
    httpStatus: 200,
    contentType: "text/html",
    title: "公开商机",
    rawArtifactHash: `sha256:${"c".repeat(64)}`,
    contentHash: `sha256:${"d".repeat(64)}`,
    evidenceCount: 1,
    startedAt: "2026-07-24T08:00:01.000Z",
    completedAt: "2026-07-24T08:00:02.000Z"
  } as Partial<AcquisitionContentFetchOperationRecord>;
  delete legacyPayload.evidenceIds;
  pool.enqueue([{ payload_json: JSON.stringify(legacyPayload) }]);

  const loaded = await repository.getContentFetchOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    fetchOperation.id
  );

  assert.equal(loaded?.status, "failed");
  assert.equal(loaded?.evidenceCount, 0);
  assert.deepEqual(loaded?.evidenceIds, []);
  assert.equal(
    loaded?.errorCode,
    "LEGACY_EVIDENCE_IDS_UNAVAILABLE_REFETCH_REQUIRED"
  );
});

test("mysql repository rejects duplicate and inconsistent content-fetch evidence references", async () => {
  const invalidPayloads = [
    {
      ...fetchOperation,
      status: "succeeded",
      evidenceCount: 2,
      evidenceIds: ["evidence-1", "evidence-1"]
    },
    {
      ...fetchOperation,
      status: "succeeded",
      evidenceCount: 1,
      evidenceIds: []
    }
  ];

  for (const payload of invalidPayloads) {
    const pool = new FakePool();
    const repository =
      new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
    pool.enqueue([{ payload_json: JSON.stringify(payload) }]);

    await assert.rejects(
      repository.getContentFetchOperation(
        { ownerId: "owner-a", teamId: "team-a" },
        fetchOperation.id
      ),
      /ACQUISITION_DISCOVERY_MYSQL_INTEGRITY:evidence_/u
    );
  }
});

test("mysql repository preserves evidence association when candidate ingestion fails after fetch", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  pool.enqueue([{ payload_json: JSON.stringify({
    ...fetchOperation,
    status: "failed",
    evidenceCount: 1,
    evidenceIds: ["evidence-1"],
    candidateCount: 0,
    candidateIds: [],
    errorCode: "CONTENT_FETCH_FAILED"
  }) }]);

  const loaded = await repository.getContentFetchOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    fetchOperation.id
  );

  assert.equal(loaded?.status, "failed");
  assert.deepEqual(loaded?.evidenceIds, ["evidence-1"]);
  assert.deepEqual(loaded?.candidateIds, []);
});

test("mysql repository lists tenant operations by created time and id with a bounded limit", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  pool.enqueue([
    { payload_json: JSON.stringify(fetchOperation) }
  ]);

  const fetchItems = await repository.listContentFetchOperations(
    { ownerId: "owner-a", teamId: "team-a" },
    25
  );

  assert.deepEqual(fetchItems, [fetchOperation]);
  const fetchSelect = pool.calls.at(-1)!;
  assert.match(
    fetchSelect.sql,
    /ORDER BY created_at DESC, id DESC LIMIT \?/
  );
  assert.deepEqual(fetchSelect.values, ["owner-a", "team-a", 25]);

  pool.enqueue([
    { payload_json: JSON.stringify(importOperation) }
  ]);
  const importItems = await repository.listImportOperations(
    { ownerId: "owner-a", teamId: "team-a" },
    10
  );

  assert.deepEqual(importItems, [importOperation]);
  const importSelect = pool.calls.at(-1)!;
  assert.match(
    importSelect.sql,
    /ORDER BY created_at DESC, id DESC LIMIT \?/
  );
  assert.deepEqual(importSelect.values, ["owner-a", "team-a", 10]);
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
      startedAt: "2026-07-24T08:01:00.000Z",
      leaseOwner: "worker-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-24T08:11:00.000Z"
    })
  }]);
  const claimed = await repository.claimContentFetchOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    fetchOperation.id,
    {
      leaseOwner: "worker-a",
      leaseToken: "lease-a",
      claimedAt: "2026-07-24T08:01:00.000Z",
      leaseExpiresAt: "2026-07-24T08:11:00.000Z",
      staleRunningBefore: "2026-07-24T07:51:00.000Z"
    }
  );
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.operation?.status, "running");
  const update = pool.calls[0]!;
  assert.match(update.sql, /status = 'queued'/);
  assert.match(update.sql, /lease_expires_at <= \?/);
  assert.match(update.sql, /owner_id = \\?/);
  assert.match(update.sql, /team_id = \\?/);
});

test("mysql recovery listing is cross-tenant, bounded, and oldest first", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  pool.enqueue([
    { payload_json: JSON.stringify(fetchOperation) },
    { payload_json: JSON.stringify(importOperation) }
  ]);

  const operations = await repository.listRecoverableOperations({
    now: "2026-07-24T08:10:00.000Z",
    staleRunningBefore: "2026-07-24T08:00:00.000Z",
    limit: 20
  });

  assert.deepEqual(
    operations.map((operation) => operation.id),
    [fetchOperation.id, importOperation.id]
  );
  const query = pool.calls.at(-1)!;
  assert.match(query.sql, /UNION ALL/);
  assert.match(query.sql, /lease_expires_at <= \?/);
  assert.match(query.sql, /ORDER BY created_at ASC, id ASC/);
  assert.match(query.sql, /LIMIT \?/);
  assert.deepEqual(query.values, [
    "2026-07-24 08:10:00.000",
    "2026-07-24 08:00:00.000",
    "2026-07-24 08:10:00.000",
    "2026-07-24 08:00:00.000",
    20
  ]);
});

test("mysql terminal writes are fenced by the active lease token", async () => {
  const pool = new FakePool();
  const repository =
    new MysqlAcquisitionDiscoveryOperationRepository(asPool(pool));
  pool.enqueue({ affectedRows: 0 });

  await assert.rejects(
    repository.putContentFetchOperation({
      ...fetchOperation,
      status: "succeeded",
      startedAt: "2026-07-24T08:00:00.000Z",
      completedAt: "2026-07-24T08:01:00.000Z"
    }, "stale-lease"),
    (error: unknown) =>
      error instanceof AcquisitionDiscoveryOperationError
      && error.code === "OPERATION_ALREADY_RUNNING"
      && error.message === "OPERATION_LEASE_LOST"
  );
  const query = pool.calls.at(-1)!;
  assert.match(query.sql, /lease_token = \?/);
  assert.equal(query.values.at(-1), "stale-lease");
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
