import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import {
  AcquisitionDouyinIdentityResolutionOperationError,
  type AcquisitionDouyinIdentityResolutionOperationRecord
} from "./acquisition-douyin-identity-resolution-operations.js";
import {
  ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_SCHEMA_STATEMENTS,
  MysqlAcquisitionDouyinIdentityResolutionOperationRepository,
  ensureAcquisitionDouyinIdentityResolutionMysqlSchema
} from "./acquisition-douyin-identity-resolution-mysql-repository.js";

class FakePool {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  readonly queue: Array<[unknown, unknown]> = [];

  enqueue(rows: unknown) {
    this.queue.push([rows, []]);
  }

  async query(sql: string, values: unknown[] = []) {
    this.calls.push({ sql: sql.replace(/\s+/gu, " ").trim(), values });
    return this.queue.shift() ?? [{ affectedRows: 1 }, []];
  }
}

function asPool(pool: FakePool) {
  return pool as unknown as mysql.Pool;
}

const queuedOperation: AcquisitionDouyinIdentityResolutionOperationRecord = {
  id: "douyin-identity-resolution-1",
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "actor-a",
  candidateId: "candidate-a",
  candidateVersion: 3,
  sourceEvidenceFingerprint: `sha256:${"a".repeat(64)}`,
  searchConnections: [{
    connectionId: "search-connection-1",
    providerId: "baidu-search",
    kind: "search",
    status: "active",
    credentialVersion: 3
  }],
  planSessionId: "acquisition-plan:run-1",
  status: "queued",
  currentStage: null,
  outcome: null,
  retryable: false,
  canonicalProfileUrl: null,
  profileCandidates: [],
  evidence: [],
  intelligenceOperationId: null,
  idempotencyKeyHash: "b".repeat(64),
  requestHash: `sha256:${"c".repeat(64)}`,
  leaseOwner: null,
  leaseToken: null,
  leaseExpiresAt: null,
  createdAt: "2026-08-08T02:00:00.000Z",
  updatedAt: "2026-08-08T02:00:00.000Z",
  completedAt: null
};

function mysqlDate(value: string) {
  return value.slice(0, 23).replace("T", " ");
}

function mysqlRow(
  operation: AcquisitionDouyinIdentityResolutionOperationRecord,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: operation.id,
    owner_id: operation.ownerId,
    team_id: operation.teamId,
    actor_id: operation.actorId,
    candidate_id: operation.candidateId,
    candidate_version: operation.candidateVersion,
    source_evidence_fingerprint: operation.sourceEvidenceFingerprint,
    idempotency_key_hash: operation.idempotencyKeyHash,
    request_hash: operation.requestHash,
    status: operation.status,
    lease_owner: operation.leaseOwner,
    lease_token: operation.leaseToken,
    lease_expires_at: operation.leaseExpiresAt
      ? mysqlDate(operation.leaseExpiresAt)
      : null,
    payload_json: JSON.stringify(operation),
    created_at: mysqlDate(operation.createdAt),
    updated_at: mysqlDate(operation.updatedAt),
    ...overrides
  };
}

test("Douyin identity operation schema creates tenant, lease, latest, and recovery invariants", async () => {
  const pool = new FakePool();

  await ensureAcquisitionDouyinIdentityResolutionMysqlSchema(asPool(pool));

  assert.equal(
    pool.calls.length,
    ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_SCHEMA_STATEMENTS.length
  );
  const schema = pool.calls.map((call) => call.sql).join("\n");
  assert.match(schema, /PRIMARY KEY \(id\)/u);
  assert.match(schema, /candidate_id VARCHAR\(120\) NOT NULL/u);
  assert.match(schema, /UNIQUE KEY uk_douyin_identity_resolution_idempotency\s*\(owner_id, team_id, idempotency_key_hash\)/u);
  assert.match(schema, /KEY idx_douyin_identity_resolution_latest\s*\(owner_id, team_id, candidate_id, created_at, id\)/u);
  assert.match(schema, /KEY idx_douyin_identity_resolution_recovery\s*\(status, lease_expires_at, created_at, id\)/u);
  for (const status of [
    "queued",
    "running",
    "succeeded",
    "requires_review",
    "failed"
  ]) {
    assert.match(schema, new RegExp(`'${status}'`, "u"));
  }
});

test("MySQL create and idempotency replay are tenant scoped and conflict on request drift", async () => {
  const createdPool = new FakePool();
  const createdRepository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(createdPool)
    );
  assert.deepEqual(await createdRepository.createOperation(queuedOperation), {
    operation: queuedOperation,
    created: true
  });
  assert.match(createdPool.calls[0]!.sql, /INSERT INTO acquisition_douyin_identity_resolution_operations/u);
  assert.equal(
    createdPool.calls[0]!.sql.match(/operations \((.*?)\) VALUES/u)?.[1]
      ?.split(",").length,
    createdPool.calls[0]!.values.length
  );

  const duplicate = Object.assign(new Error("duplicate"), {
    errno: 1062,
    code: "ER_DUP_ENTRY"
  });
  for (const sameRequest of [true, false]) {
    const pool = new FakePool();
    pool.query = async function query(sql: string, values: unknown[] = []) {
      this.calls.push({ sql: sql.replace(/\s+/gu, " ").trim(), values });
      if (sql.includes("INSERT INTO")) throw duplicate;
      return [[mysqlRow({
        ...queuedOperation,
        requestHash: sameRequest
          ? queuedOperation.requestHash
          : `sha256:${"d".repeat(64)}`
      })], []];
    };
    const repository =
      new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
        asPool(pool)
      );
    if (sameRequest) {
      assert.equal(
        (await repository.createOperation(queuedOperation)).created,
        false
      );
    } else {
      await assert.rejects(
        repository.createOperation(queuedOperation),
        (error: unknown) =>
          error instanceof AcquisitionDouyinIdentityResolutionOperationError
          && error.code === "IDEMPOTENCY_CONFLICT"
      );
    }
    const lookup = pool.calls.at(-1)!;
    assert.deepEqual(lookup.values, [
      queuedOperation.ownerId,
      queuedOperation.teamId,
      queuedOperation.idempotencyKeyHash
    ]);
  }
});

test("MySQL latest candidate lookup is tenant scoped and deterministic", async () => {
  const pool = new FakePool();
  pool.enqueue([mysqlRow(queuedOperation)]);
  const repository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(pool)
    );

  assert.deepEqual(await repository.findLatestForCandidate(
    { ownerId: "owner-a", teamId: "team-a" },
    "candidate-a"
  ), queuedOperation);
  assert.match(pool.calls[0]!.sql, /owner_id = \? AND team_id = \? AND candidate_id = \?/u);
  assert.match(pool.calls[0]!.sql, /ORDER BY created_at DESC, id DESC LIMIT 1/u);
  assert.deepEqual(pool.calls[0]!.values, [
    "owner-a",
    "team-a",
    "candidate-a"
  ]);
});

test("MySQL successful Run ownership lookup is tenant and session scoped", async () => {
  const succeeded = {
    ...queuedOperation,
    status: "succeeded" as const,
    outcome: "verified_consensus" as const,
    intelligenceOperationId: "candidate-intelligence-1",
    completedAt: "2026-08-08T02:01:00.000Z"
  };
  const pool = new FakePool();
  pool.enqueue([mysqlRow(succeeded)]);
  const repository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(pool)
    );

  assert.deepEqual(await repository
    .findSucceededForCandidateAndPlanSession(
      { ownerId: "owner-a", teamId: "team-a" },
      "candidate-a",
      "acquisition-plan:run-1"
    ), succeeded);
  assert.match(pool.calls[0]!.sql, /status = 'succeeded'/u);
  assert.match(pool.calls[0]!.sql, /\$\.planSessionId/u);
  assert.match(pool.calls[0]!.sql, /\$\.intelligenceOperationId/u);
  assert.deepEqual(pool.calls[0]!.values, [
    "owner-a",
    "team-a",
    "candidate-a",
    "acquisition-plan:run-1"
  ]);
});

test("MySQL recovery selects queued and expired-running operations oldest first", async () => {
  const expired = {
    ...queuedOperation,
    id: "douyin-identity-resolution-expired",
    status: "running" as const,
    leaseOwner: "worker-old",
    leaseToken: "lease-old",
    leaseExpiresAt: "2026-08-08T02:01:00.000Z"
  };
  const pool = new FakePool();
  pool.enqueue([mysqlRow(queuedOperation), mysqlRow(expired)]);
  const repository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(pool)
    );

  const operations = await repository.listRecoverableOperations({
    now: "2026-08-08T02:02:00.000Z",
    limit: 25
  });

  assert.deepEqual(operations.map((operation) => operation.id), [
    queuedOperation.id,
    expired.id
  ]);
  assert.match(pool.calls[0]!.sql, /status = 'queued'/u);
  assert.match(pool.calls[0]!.sql, /status = 'running' AND lease_expires_at <= \?/u);
  assert.match(pool.calls[0]!.sql, /ORDER BY created_at ASC, id ASC LIMIT \?/u);
  assert.deepEqual(pool.calls[0]!.values, ["2026-08-08 02:02:00.000", 25]);
});

test("MySQL claim, save, and renewal are tenant and lease-token fenced", async () => {
  const running = {
    ...queuedOperation,
    status: "running" as const,
    updatedAt: "2026-08-08T02:01:00.000Z",
    leaseOwner: "worker-a",
    leaseToken: "lease-a",
    leaseExpiresAt: "2026-08-08T02:11:00.000Z"
  };
  const claimPool = new FakePool();
  claimPool.enqueue({ affectedRows: 1 });
  claimPool.enqueue([mysqlRow(running)]);
  const claimRepository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(claimPool)
    );
  assert.equal((await claimRepository.claimOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    queuedOperation.id,
    {
      leaseOwner: "worker-a",
      leaseToken: "lease-a",
      claimedAt: "2026-08-08T02:01:00.000Z",
      leaseExpiresAt: "2026-08-08T02:11:00.000Z"
    }
  )).claimed, true);
  assert.match(claimPool.calls[0]!.sql, /status = 'queued'/u);
  assert.doesNotMatch(claimPool.calls[0]!.sql, /status IN \('queued','failed'\)/u);
  assert.match(claimPool.calls[0]!.sql, /owner_id = \? AND team_id = \?/u);

  const savePool = new FakePool();
  savePool.enqueue({ affectedRows: 1 });
  const saveRepository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(savePool)
    );
  await saveRepository.saveOperation({
    ...running,
    status: "succeeded",
    outcome: "verified_consensus",
    updatedAt: "2026-08-08T02:02:00.000Z",
    completedAt: "2026-08-08T02:02:00.000Z"
  }, "lease-a");
  assert.match(savePool.calls[0]!.sql, /lease_owner = NULL/u);
  assert.match(savePool.calls[0]!.sql, /status = 'running' AND lease_token = \?/u);

  const renewPool = new FakePool();
  renewPool.enqueue({ affectedRows: 1 });
  const renewRepository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(renewPool)
    );
  assert.equal(await renewRepository.renewLease(
    { ownerId: "owner-a", teamId: "team-a" },
    queuedOperation.id,
    "lease-a",
    {
      renewedAt: "2026-08-08T02:03:00.000Z",
      leaseExpiresAt: "2026-08-08T02:13:00.000Z"
    }
  ), true);
  assert.match(renewPool.calls[0]!.sql, /lease_expires_at > \?/u);
  assert.match(renewPool.calls[0]!.sql, /owner_id = \? AND team_id = \?/u);
});

test("MySQL claim does not report success when read-back has a replacement lease", async () => {
  const replaced = {
    ...queuedOperation,
    status: "running" as const,
    updatedAt: "2026-08-08T02:01:01.000Z",
    leaseOwner: "worker-b",
    leaseToken: "lease-b",
    leaseExpiresAt: "2026-08-08T02:11:01.000Z"
  };
  const pool = new FakePool();
  pool.enqueue({ affectedRows: 1 });
  pool.enqueue([mysqlRow(replaced)]);
  const repository =
    new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
      asPool(pool)
    );

  const result = await repository.claimOperation(
    { ownerId: "owner-a", teamId: "team-a" },
    queuedOperation.id,
    {
      leaseOwner: "worker-a",
      leaseToken: "lease-a",
      claimedAt: "2026-08-08T02:01:00.000Z",
      leaseExpiresAt: "2026-08-08T02:11:00.000Z"
    }
  );

  assert.equal(result.claimed, false);
  assert.match(pool.calls[1]!.sql, /lease_token = \?/u);
  assert.deepEqual(pool.calls[1]!.values, [
    queuedOperation.id,
    "owner-a",
    "team-a",
    "lease-a"
  ]);
});

test("MySQL reads fail closed on JSON and indexed-column mismatches", async () => {
  const cases = [
    {
      row: mysqlRow(queuedOperation, { payload_json: "not-json" }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:invalid_json/u
    },
    {
      row: mysqlRow(queuedOperation, { owner_id: "owner-b" }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:owner_id_mismatch/u
    },
    {
      row: mysqlRow(queuedOperation, { candidate_version: 4 }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:candidate_version_mismatch/u
    },
    {
      row: mysqlRow(queuedOperation, { status: "succeeded" }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:status_mismatch/u
    },
    {
      row: mysqlRow({ ...queuedOperation, requestHash: "invalid" }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:request_hash/u
    },
    {
      row: mysqlRow({
        ...queuedOperation,
        planSessionId: "model-session:not-a-frozen-plan"
      }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:plan_session_id/u
    },
    {
      row: mysqlRow({
        ...queuedOperation,
        searchConnections: [{
          connectionId: "search-connection-1",
          providerId: "",
          kind: "search",
          status: "active",
          credentialVersion: 3
        }]
      }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:search_connections/u
    },
    {
      row: mysqlRow({
        ...queuedOperation,
        searchConnections: [{
          ...queuedOperation.searchConnections[0]!,
          kind: "content_fetch" as const
        }]
      }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:search_connections/u
    },
    {
      row: mysqlRow({
        ...queuedOperation,
        searchConnections: [{
          ...queuedOperation.searchConnections[0]!,
          status: "inactive" as const
        }]
      }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:search_connections/u
    },
    {
      row: mysqlRow({
        ...queuedOperation,
        searchConnections: [{
          connectionId: "search-connection-1",
          providerId: "baidu-search",
          kind: "search",
          status: "active",
          credentialVersion: 0
        }]
      }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:search_connections/u
    },
    {
      row: mysqlRow({
        ...queuedOperation,
        searchConnections: [
          queuedOperation.searchConnections[0]!,
          queuedOperation.searchConnections[0]!
        ]
      }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:search_connections/u
    },
    {
      row: mysqlRow({ ...queuedOperation, status: "running" }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:lease_state/u
    },
    {
      row: mysqlRow(queuedOperation, {
        updated_at: "2026-08-08 02:00:01.000"
      }),
      error: /ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_MYSQL_INTEGRITY:updated_at_mismatch/u
    }
  ];

  for (const item of cases) {
    const pool = new FakePool();
    pool.enqueue([item.row]);
    const repository =
      new MysqlAcquisitionDouyinIdentityResolutionOperationRepository(
        asPool(pool)
      );
    await assert.rejects(
      repository.getOperation(
        { ownerId: "owner-a", teamId: "team-a" },
        queuedOperation.id
      ),
      item.error
    );
  }
});
