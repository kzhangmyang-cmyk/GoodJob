import assert from "node:assert/strict";
import type mysql from "mysql2/promise";
import {
  ACQUISITION_MYSQL_SCHEMA_STATEMENTS,
  MysqlAcquisitionCopilotRepository,
  MysqlAcquisitionDomainRepository,
  MysqlAcquisitionPlanRunRepository,
  ensureAcquisitionMysqlSchema
} from "./acquisition-mysql-repositories.js";
import type {
  AcquisitionCandidate,
  DiscoveryEvidence
} from "./acquisition-domain.js";
import type {
  AcquisitionCopilotMessage,
  AcquisitionCopilotSession,
  AcquisitionCopilotTask
} from "./acquisition-copilot-service.js";
import type {
  AcquisitionPlan,
  AcquisitionPlanVersion,
  AcquisitionRun
} from "./acquisition-plan-run-repository.js";

type QueryResult = [unknown, unknown];

class FakeConnection {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  readonly queue: QueryResult[] = [];
  beginCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  releaseCount = 0;

  enqueue(result: unknown) {
    this.queue.push([result, []]);
  }

  async query(sql: string, values: unknown[] = []) {
    this.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
    return this.queue.shift() ?? [{ affectedRows: 1 }, []];
  }

  async beginTransaction() {
    this.beginCount += 1;
  }

  async commit() {
    this.commitCount += 1;
  }

  async rollback() {
    this.rollbackCount += 1;
  }

  release() {
    this.releaseCount += 1;
  }
}

class FakePool extends FakeConnection {
  readonly connection = new FakeConnection();

  async getConnection() {
    return this.connection;
  }
}

function asPool(value: FakePool) {
  return value as unknown as mysql.Pool;
}

const NOW = "2026-07-24T08:00:00.000Z";

function candidate(overrides: Partial<AcquisitionCandidate> = {}): AcquisitionCandidate {
  return {
    id: "candidate-1",
    ownerId: "owner-a",
    teamId: "team-a",
    partyType: "organization",
    partyRef: {
      partyType: "organization",
      organizationId: "org-1",
      tenantProspectId: "prospect-1"
    },
    profile: {
      kind: "organization",
      name: "Example",
      domain: "example.cn",
      region: "CN",
      creditCode: null
    },
    evidenceIds: ["evidence-1"],
    status: "normalized",
    latestDecisionId: null,
    latestDecisionVersion: null,
    approvedDecisionVersion: null,
    hardGateFailures: [],
    leadId: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides
  };
}

function evidence(): DiscoveryEvidence {
  return {
    id: "evidence-1",
    ownerId: "owner-a",
    teamId: "team-a",
    targetType: "organization",
    sourcePlatform: "baidu",
    sourceTitle: "Example",
    sourceSnippet: "公开商机",
    publishedAt: null,
    locale: "zh-CN",
    rawArtifactHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    provenance: {
      kind: "search_result",
      provider: "baidu",
      queryText: "采购需求",
      sourceUrl: "https://example.cn",
      resultRank: 1
    },
    accessStatus: "indexed_summary",
    supersedesEvidenceId: null,
    fetchedAt: NOW
  };
}

function session(): AcquisitionCopilotSession {
  return {
    id: "session-1",
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "user-1",
    status: "active",
    modelSnapshot: {
      jobId: "job-1",
      connectionId: "connection-1",
      credentialVersion: 2,
      provider: "moonshot",
      model: "kimi-k2",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      promptHash: "sha256:prompt-v1",
      schemaHash: "sha256:schema-v1",
      capabilitySnapshotHash: "c".repeat(64),
      baseUrlFingerprint: "d".repeat(64)
    },
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null
  };
}

function task(): AcquisitionCopilotTask {
  return {
    id: "task-1",
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "user-1",
    sessionId: "session-1",
    kind: "message",
    status: "queued",
    prompt: "查找中国市场公开商机",
    result: null,
    errorCode: null,
    createdAt: NOW,
    startedAt: null,
    completedAt: null
  };
}

function plan(): AcquisitionPlan {
  const budgetSnapshot = {
    maxRequests: 20,
    maxResults: 100,
    maxAmountMinor: 10_000,
    maxDurationSeconds: 300,
    billingCurrency: "CNY"
  };
  const modelSnapshotRef = {
    jobSnapshotId: "job-1",
    connectionId: "model-connection-1",
    credentialVersion: 2,
    provider: "moonshot",
    model: "kimi-k2",
    capabilitySnapshotHash: "c".repeat(64),
    promptVersion: "prompt-v1",
    promptHash: "e".repeat(64),
    schemaHash: "f".repeat(64),
    schemaVersion: "acquisition-plan.v1"
  };
  return {
    id: "plan-1",
    ownerId: "owner-a",
    teamId: "team-a",
    status: "draft",
    version: 1,
    revision: 1,
    etag: "\"plan-1:1\"",
    currentVersionId: "plan-version-1",
    approvedVersionId: null,
    approvedSnapshotHash: null,
    approvedBy: null,
    approvedAt: null,
    budgetSnapshot,
    payload: {
      name: "中国公开商机",
      objective: "发现组织与个人需求线索",
      icp: {
        industries: ["通用"],
        regions: ["中国"],
        organizationCriteria: ["公开采购需求"],
        individualCriteria: ["公开表达需求"],
        exclusionRules: ["拒绝联系"]
      },
      subjectChannels: {
        organization: true,
        individual: true
      },
      providerConnections: [],
      operations: [],
      budgetSnapshot,
      modelSnapshotRef,
      stopConditions: {
        stopWhenBudgetExhausted: true,
        stopWhenNoMoreResults: true
      }
    },
    createdBy: "user-1",
    createdAt: NOW,
    updatedBy: "user-1",
    updatedAt: NOW
  };
}

function planVersion(): AcquisitionPlanVersion {
  const value = plan();
  return {
    id: value.currentVersionId,
    planId: value.id,
    ownerId: value.ownerId,
    teamId: value.teamId,
    version: value.version,
    payload: structuredClone(value.payload),
    payloadHash: "1".repeat(64),
    createdBy: value.createdBy,
    createdAt: value.createdAt
  };
}

function acquisitionRun(): AcquisitionRun {
  const value = plan();
  return {
    id: "run-1",
    ownerId: value.ownerId,
    teamId: value.teamId,
    planId: value.id,
    planVersionId: value.currentVersionId,
    planVersion: value.version,
    planSnapshotHash: "2".repeat(64),
    parentRunId: null,
    status: "queued",
    terminationIntent: null,
    revision: 1,
    etag: "\"run-1:1\"",
    budgetSnapshotId: "budget-1",
    budgetSnapshot: structuredClone(value.budgetSnapshot),
    budgetSnapshotHash: "3".repeat(64),
    billingCurrency: "CNY",
    modelSnapshotRef: structuredClone(value.payload.modelSnapshotRef),
    consumedBudget: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    },
    evidenceCount: 0,
    reason: null,
    createdBy: "user-1",
    createdAt: NOW,
    updatedBy: "user-1",
    updatedAt: NOW,
    completedAt: null
  };
}

async function testSchemaIsCompleteAndHasNoSecretColumns() {
  const sql = ACQUISITION_MYSQL_SCHEMA_STATEMENTS.join("\n").toLowerCase();
  for (const table of [
    "acquisition_discovery_evidence",
    "acquisition_candidates",
    "acquisition_qualification_decisions",
    "acquisition_financial_values",
    "acquisition_battle_cards",
    "acquisition_review_events",
    "acquisition_research_attempts",
    "acquisition_conversions",
    "acquisition_outcomes",
    "acquisition_domain_audit_events",
    "acquisition_domain_idempotency",
    "acquisition_copilot_sessions",
    "acquisition_copilot_tasks",
    "acquisition_copilot_messages",
    "acquisition_copilot_idempotency",
    "acquisition_plans",
    "acquisition_plan_versions",
    "acquisition_runs",
    "acquisition_operation_shards",
    "acquisition_plan_events",
    "acquisition_run_events",
    "acquisition_plan_run_audit_events",
    "acquisition_run_idempotency",
    "acquisition_usage_idempotency",
    "acquisition_execution_intents"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.doesNotMatch(sql, /\b(api_key|secret_key|access_token)\b/);
  assert.match(sql, /unique key uk_acquisition_candidate_scope/);
  assert.match(sql, /unique key uk_acquisition_copilot_message_sequence/);
  assert.match(sql, /unique key uk_acquisition_domain_idempotency/);
  assert.match(
    sql,
    /create table if not exists acquisition_run_idempotency \(\s*scope_key_hash char\(64\) primary key/
  );
  assert.match(
    sql,
    /create table if not exists acquisition_usage_idempotency \(\s*scope_key_hash char\(64\) primary key/
  );
  assert.match(
    sql,
    /constraint fk_acquisition_qualification_candidate\s+foreign key \(owner_id, team_id, candidate_id\)/
  );
  assert.match(
    sql,
    /constraint fk_acquisition_copilot_message_session\s+foreign key \(owner_id, team_id, session_id\)/
  );
  assert.match(
    sql,
    /constraint fk_acquisition_shard_run\s+foreign key \(owner_id, team_id, run_id\)/
  );
  assert.match(sql, /dispatch_lease_until datetime\(3\) null/);
  assert.match(sql, /dispatch_attempts bigint unsigned not null default 0/);
  assert.match(
    sql,
    /constraint fk_acquisition_run_plan_version\s+foreign key \(owner_id, team_id, plan_id, plan_version_id\)/
  );
}

async function testEnsureSchemaExecutesEveryStatement() {
  const pool = new FakePool();
  await ensureAcquisitionMysqlSchema(asPool(pool));
  assert.equal(pool.calls.length, ACQUISITION_MYSQL_SCHEMA_STATEMENTS.length);
}

async function testDomainQueriesAlwaysUseOwnerAndTeam() {
  const pool = new FakePool();
  pool.enqueue([{
    id: "candidate-1",
    owner_id: "owner-a",
    team_id: "team-a",
    version: 1,
    payload_json: JSON.stringify(candidate())
  }]);
  const repository = new MysqlAcquisitionDomainRepository(asPool(pool));
  assert.deepEqual(
    await repository.findCandidate(
      { ownerId: "owner-a", teamId: "team-a" },
      "candidate-1"
    ),
    candidate()
  );
  const call = pool.calls.at(-1)!;
  assert.match(call.sql, /owner_id = \? AND team_id = \?/);
  assert.deepEqual(call.values, ["candidate-1", "owner-a", "team-a"]);
}

async function testDomainRejectsCorruptOrCrossTenantJson() {
  const pool = new FakePool();
  pool.enqueue([{
    id: "candidate-1",
    owner_id: "owner-a",
    team_id: "team-a",
    version: 1,
    payload_json: JSON.stringify(candidate({ teamId: "team-b" }))
  }]);
  const repository = new MysqlAcquisitionDomainRepository(asPool(pool));
  await assert.rejects(
    () => repository.findCandidate(
      { ownerId: "owner-a", teamId: "team-a" },
      "candidate-1"
    ),
    /integrity/i
  );
}

async function testCandidateRejectsJsonVersionThatDiffersFromLockColumn() {
  const pool = new FakePool();
  pool.enqueue([{
    id: "candidate-1",
    owner_id: "owner-a",
    team_id: "team-a",
    version: 7,
    payload_json: JSON.stringify(candidate({ version: 6 }))
  }]);
  const repository = new MysqlAcquisitionDomainRepository(asPool(pool));
  await assert.rejects(
    () => repository.findCandidate(
      { ownerId: "owner-a", teamId: "team-a" },
      "candidate-1"
    ),
    /version_mismatch/
  );
}

async function testCandidateSaveUsesOptimisticVersionAndScope() {
  const pool = new FakePool();
  pool.enqueue({ affectedRows: 1 });
  const repository = new MysqlAcquisitionDomainRepository(asPool(pool));
  await repository.saveCandidate(candidate({ version: 2 }));
  const call = pool.calls.at(-1)!;
  assert.match(
    call.sql,
    /WHERE id = \? AND owner_id = \? AND team_id = \? AND version = \?/
  );
  assert.deepEqual(call.values.slice(-4), [
    "candidate-1",
    "owner-a",
    "team-a",
    1
  ]);

  const conflictPool = new FakePool();
  conflictPool.enqueue({ affectedRows: 0 });
  await assert.rejects(
    () => new MysqlAcquisitionDomainRepository(asPool(conflictPool))
      .saveCandidate(candidate({ version: 2 })),
    /CANDIDATE_VERSION_CONFLICT/
  );
}

async function testAppendEvidenceUsesInsertOnly() {
  const pool = new FakePool();
  const repository = new MysqlAcquisitionDomainRepository(asPool(pool));
  await repository.appendEvidence(evidence());
  assert.match(pool.calls.at(-1)!.sql, /^INSERT INTO acquisition_discovery_evidence/);
  assert.doesNotMatch(pool.calls.at(-1)!.sql, /UPDATE|ON DUPLICATE/i);
  const storedPayload = JSON.parse(String(pool.calls.at(-1)!.values.at(-2)));
  assert.deepEqual(storedPayload, evidence());
  assert.equal("createdAt" in storedPayload, false);
}

async function testDomainTransactionUsesOneConnectionAndRollsBackAtomically() {
  const committedPool = new FakePool();
  const committedRepository = new MysqlAcquisitionDomainRepository(
    asPool(committedPool)
  );
  await committedRepository.transaction(async () => {
    await committedRepository.appendEvidence(evidence());
  });
  assert.equal(committedPool.connection.beginCount, 1);
  assert.equal(committedPool.connection.commitCount, 1);
  assert.equal(committedPool.connection.rollbackCount, 0);
  assert.ok(committedPool.connection.calls.some((call) =>
    call.sql.startsWith("INSERT INTO acquisition_discovery_evidence")
  ));
  assert.equal(
    committedPool.calls.some((call) =>
      call.sql.startsWith("INSERT INTO acquisition_discovery_evidence")
    ),
    false,
    "transactional domain writes must use the leased connection"
  );

  const rolledBackPool = new FakePool();
  const rolledBackRepository = new MysqlAcquisitionDomainRepository(
    asPool(rolledBackPool)
  );
  await assert.rejects(
    rolledBackRepository.transaction(async () => {
      await rolledBackRepository.appendEvidence(evidence());
      throw new Error("simulated domain transaction failure");
    }),
    /simulated domain transaction failure/
  );
  assert.equal(rolledBackPool.connection.commitCount, 0);
  assert.equal(rolledBackPool.connection.rollbackCount, 1);
  assert.equal(rolledBackPool.connection.releaseCount, 1);
}

async function testRawIdempotencyKeysAreNotPersisted() {
  const pool = new FakePool();
  const repository = new MysqlAcquisitionDomainRepository(asPool(pool));
  const rawKey = "customer-request-123456";
  await repository.appendReviewEvent({
    id: "review-1",
    ownerId: "owner-a",
    teamId: "team-a",
    candidateId: "candidate-1",
    decisionVersion: "decision-v1",
    action: "approved",
    reason: "证据充分",
    reviewerId: "user-1",
    idempotencyKey: rawKey,
    createdAt: NOW
  });
  const payload = String(pool.calls.at(-1)!.values.at(-2));
  assert.doesNotMatch(payload, new RegExp(rawKey));
  assert.match(payload, /"idempotencyKey":"sha256:[a-f0-9]{64}"/);
}

async function testDomainIdempotencyRestoresTheRequestKeyOnReplay() {
  const pool = new FakePool();
  const repository = new MysqlAcquisitionDomainRepository(asPool(pool));
  const rawKey = "customer-request-654321";
  const review = {
    id: "review-2",
    ownerId: "owner-a",
    teamId: "team-a",
    candidateId: "candidate-1",
    decisionVersion: "decision-v1",
    action: "approved" as const,
    reason: null,
    reviewerId: "user-1",
    idempotencyKey: rawKey,
    createdAt: NOW
  };
  const record = {
    ownerId: "owner-a",
    teamId: "team-a",
    operation: "review_candidate",
    idempotencyKey: rawKey,
    requestHash: "5".repeat(64),
    result: { review },
    createdAt: NOW
  };
  await repository.appendIdempotency(record);
  const payload = String(pool.calls.at(-1)!.values.at(-2));
  pool.enqueue([{
    owner_id: "owner-a",
    team_id: "team-a",
    payload_json: payload
  }]);
  assert.deepEqual(
    await repository.findIdempotency(
      { ownerId: "owner-a", teamId: "team-a" },
      "review_candidate",
      rawKey
    ),
    record
  );
}

async function testCopilotPersistenceIsScopedAndMessageOrderIsDurable() {
  const pool = new FakePool();
  const repository = new MysqlAcquisitionCopilotRepository(asPool(pool));
  await repository.insertSession(session());
  await repository.insertTask(task());
  const messages: AcquisitionCopilotMessage[] = [
    {
      id: "message-1",
      ownerId: "owner-a",
      teamId: "team-a",
      sessionId: "session-1",
      sequence: 1,
      message: {
        role: "user",
        content: "查找中国市场公开商机",
        timestamp: 1
      },
      createdAt: NOW
    }
  ];
  pool.connection.enqueue([{ id: "session-1" }]);
  pool.connection.enqueue([{ max_sequence: 5 }]);
  pool.connection.enqueue({ affectedRows: 1 });
  await repository.appendMessages(messages);
  const insert = pool.connection.calls.find((call) =>
    call.sql.startsWith("INSERT INTO acquisition_copilot_messages")
  );
  assert.ok(insert);
  assert.doesNotMatch(JSON.stringify(insert.values), /api[_-]?key/i);
  assert.equal(insert.values[4], 6);
  const storedMessage = JSON.parse(String(insert.values[5]));
  assert.equal(storedMessage.sequence, 6);
  assert.equal(pool.connection.beginCount, 1);
  assert.equal(pool.connection.commitCount, 1);
  assert.ok(pool.connection.calls.some((call) =>
    /FROM acquisition_copilot_sessions/.test(call.sql)
    && /owner_id = \? AND team_id = \?/.test(call.sql)
    && /FOR UPDATE/.test(call.sql)
  ));

  pool.enqueue([{
    id: "message-1",
    owner_id: "owner-a",
    team_id: "team-a",
    session_id: "session-1",
    sequence_no: 1,
    payload_json: JSON.stringify(messages[0])
  }]);
  assert.deepEqual(
    await repository.listMessages(
      { ownerId: "owner-a", teamId: "team-a" },
      "session-1"
    ),
    messages
  );
  const list = pool.calls.at(-1)!;
  assert.match(list.sql, /owner_id = \? AND team_id = \?/);
  assert.match(list.sql, /ORDER BY sequence_no, id/);
}

async function testCopilotClaimIsAtomicAndScoped() {
  const pool = new FakePool();
  pool.enqueue({ affectedRows: 1 });
  const repository = new MysqlAcquisitionCopilotRepository(asPool(pool));
  assert.equal(
    await repository.claimTaskDispatch(
      { ownerId: "owner-a", teamId: "team-a" },
      "task-1"
    ),
    true
  );
  const call = pool.calls.at(-1)!;
  assert.match(call.sql, /^UPDATE acquisition_copilot_tasks/);
  assert.match(call.sql, /owner_id = \? AND team_id = \?/);
  assert.match(call.sql, /status = 'queued'/);
  assert.match(
    call.sql,
    /\(\s*dispatch_lease_until IS NULL OR dispatch_lease_until < UTC_TIMESTAMP\(3\)\s*\)/
  );
  assert.match(call.sql, /dispatch_attempts = dispatch_attempts \+ 1/);
}

async function testPlaintextCredentialFieldsAreRejected() {
  const pool = new FakePool();
  const repository = new MysqlAcquisitionCopilotRepository(asPool(pool));
  const unsafe = {
    ...session(),
    modelSnapshot: {
      ...session().modelSnapshot,
      clientSecret: "plaintext-must-not-be-stored"
    }
  } as AcquisitionCopilotSession;
  await assert.rejects(
    () => repository.insertSession(unsafe),
    /PLAINTEXT_SECRET_REJECTED/
  );
  assert.equal(pool.calls.length, 0);
}

async function testTaskStateUpdateUsesExpectedPreviousState() {
  const pool = new FakePool();
  pool.enqueue({ affectedRows: 1 });
  const repository = new MysqlAcquisitionCopilotRepository(asPool(pool));
  await repository.saveTask({
    ...task(),
    status: "running",
    startedAt: NOW
  });
  const call = pool.calls.at(-1)!;
  assert.match(call.sql, /AND status IN \('queued'\)/);
  assert.deepEqual(call.values.slice(-5), [
    "task-1",
    "owner-a",
    "team-a",
    "user-1",
    "session-1"
  ]);
}

async function testRunPersistsImmutableSnapshotColumnsAfterVersion() {
  const pool = new FakePool();
  const connection = pool.connection;
  connection.enqueue([{ id: 1 }]);
  for (let index = 0; index < 10; index += 1) {
    connection.enqueue([]);
  }
  const repository = new MysqlAcquisitionPlanRunRepository(asPool(pool));
  await repository.transaction((transaction) => {
    transaction.putPlan(plan());
    transaction.appendPlanVersion(planVersion());
    transaction.putRun(acquisitionRun());
  });
  const versionIndex = connection.calls.findIndex((call) =>
    call.sql.startsWith("INSERT INTO acquisition_plan_versions")
  );
  const runIndex = connection.calls.findIndex((call) =>
    call.sql.startsWith("INSERT INTO acquisition_runs")
  );
  assert.ok(versionIndex >= 0);
  assert.ok(runIndex > versionIndex);
  const insert = connection.calls[runIndex]!;
  assert.match(
    insert.sql,
    /\(id, plan_id, plan_version_id, owner_id, team_id, revision,\s*plan_snapshot_hash, budget_snapshot_hash, payload_json/
  );
  assert.deepEqual(insert.values.slice(0, 8), [
    "run-1",
    "plan-1",
    "plan-version-1",
    "owner-a",
    "team-a",
    1,
    "2".repeat(64),
    "3".repeat(64)
  ]);
}

async function testPlanRunIdempotencyScopesAreHashedAtRest() {
  const pool = new FakePool();
  const connection = pool.connection;
  connection.enqueue([{ id: 1 }]);
  for (let index = 0; index < 10; index += 1) {
    connection.enqueue([]);
  }
  const rawScopeKey = "team-a\u001fowner-a\u001fcreate_run\u001frequest-123";
  const repository = new MysqlAcquisitionPlanRunRepository(asPool(pool));
  await repository.transaction((transaction) => {
    transaction.putIdempotency({
      scopeKey: rawScopeKey,
      requestHash: "4".repeat(64),
      resultType: "run",
      resultId: "run-1",
      createdAt: NOW
    });
    assert.equal(transaction.getIdempotency(rawScopeKey)?.resultId, "run-1");
  });
  const insert = connection.calls.find((call) =>
    call.sql.startsWith("INSERT INTO acquisition_run_idempotency")
  );
  assert.ok(insert);
  assert.doesNotMatch(String(insert.values[3]), new RegExp(rawScopeKey));
  assert.match(
    String(insert.values[3]),
    /"scopeKey":"sha256:[a-f0-9]{64}"/
  );
}

async function testPlanRunTransactionCommitsNewRowsWithoutOverwriteUpsert() {
  const pool = new FakePool();
  const connection = pool.connection;
  connection.enqueue([{ id: 1 }]);
  for (let index = 0; index < 10; index += 1) {
    connection.enqueue([]);
  }
  const repository = new MysqlAcquisitionPlanRunRepository(asPool(pool));
  await repository.transaction((transaction) => {
    transaction.putPlan(plan());
  });
  assert.equal(connection.beginCount, 1);
  assert.equal(connection.commitCount, 1);
  assert.equal(connection.rollbackCount, 0);
  const insert = connection.calls.find((call) =>
    call.sql.startsWith("INSERT INTO acquisition_plans")
  );
  assert.ok(insert);
  assert.doesNotMatch(insert.sql, /ON DUPLICATE KEY UPDATE/);
}

async function testPlanRunTransactionLocksAndRollsBack() {
  const pool = new FakePool();
  const connection = pool.connection;
  connection.enqueue([{ id: 1 }]);
  for (let index = 0; index < 11; index += 1) {
    connection.enqueue([]);
  }
  const repository = new MysqlAcquisitionPlanRunRepository(asPool(pool));
  const failure = new Error("boom");
  await assert.rejects(
    () => repository.transaction(() => {
      throw failure;
    }),
    failure
  );
  assert.equal(connection.beginCount, 1);
  assert.equal(connection.commitCount, 0);
  assert.equal(connection.rollbackCount, 1);
  assert.equal(connection.releaseCount, 1);
  assert.ok(connection.calls.some((call) =>
    /SELECT id FROM acquisition_plan_run_transaction_guard WHERE id = 1 FOR UPDATE/
      .test(call.sql)
  ));
}

async function run() {
  await testSchemaIsCompleteAndHasNoSecretColumns();
  await testEnsureSchemaExecutesEveryStatement();
  await testDomainQueriesAlwaysUseOwnerAndTeam();
  await testDomainRejectsCorruptOrCrossTenantJson();
  await testCandidateRejectsJsonVersionThatDiffersFromLockColumn();
  await testCandidateSaveUsesOptimisticVersionAndScope();
  await testAppendEvidenceUsesInsertOnly();
  await testDomainTransactionUsesOneConnectionAndRollsBackAtomically();
  await testRawIdempotencyKeysAreNotPersisted();
  await testDomainIdempotencyRestoresTheRequestKeyOnReplay();
  await testCopilotPersistenceIsScopedAndMessageOrderIsDurable();
  await testCopilotClaimIsAtomicAndScoped();
  await testPlaintextCredentialFieldsAreRejected();
  await testTaskStateUpdateUsesExpectedPreviousState();
  await testRunPersistsImmutableSnapshotColumnsAfterVersion();
  await testPlanRunIdempotencyScopesAreHashedAtRest();
  await testPlanRunTransactionCommitsNewRowsWithoutOverwriteUpsert();
  await testPlanRunTransactionLocksAndRollsBack();
  console.log("acquisition mysql repositories tests passed");
}

await run();
