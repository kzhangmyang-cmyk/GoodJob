import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { AcquisitionCostLedgerService } from "./acquisition-cost-ledger.js";
import {
  FINANCIAL_LEDGER_MYSQL_SCHEMA_STATEMENTS,
  MysqlFinancialLedgerRepository
} from "./financial-ledger-mysql-repository.js";
import { withGrowthFinanceMysqlTestDatabase } from "./growth-finance-mysql-test-support.js";
import { ledgerCommandContext } from "./growth-finance-test-fixtures.js";

class FakeConnection {
  readonly queries: string[] = [];
  commits = 0;
  rollbacks = 0;
  releases = 0;
  async beginTransaction() {}
  async commit() { this.commits += 1; }
  async rollback() { this.rollbacks += 1; }
  release() { this.releases += 1; }
  async query(sql: string): Promise<[unknown, unknown]> {
    this.queries.push(sql.replace(/\s+/gu, " ").trim());
    if (sql.includes("SELECT last_recorded_at")) return [[{
      last_recorded_at: "2026-08-09 09:00:00.000", temporal_sequence: "4"
    }], []];
    if (sql.includes("CURRENT_TIMESTAMP")) return [[{
      current_timestamp_3: "2026-08-09 09:00:00.000"
    }], []];
    if (sql.includes("SELECT * FROM ledger_source_heads")) return [[], []];
    if (sql.startsWith("UPDATE ledger_source_heads")) return [{ affectedRows: 0 }, []];
    return [{ affectedRows: 1 }, []];
  }
}

test("fake MySQL transaction locks barrier before source and rolls back every staged write", async () => {
  const connection = new FakeConnection();
  const pool = {
    getConnection: async () => connection,
    query: connection.query.bind(connection)
  } as unknown as mysql.Pool;
  const repository = new MysqlFinancialLedgerRepository(pool);
  await assert.rejects(repository.transaction(async (tx) => {
    await tx.lockWorkspaceTemporalBarrierForUpdate("workspace-a");
    await tx.getSourceHeadForUpdate("workspace-a", "cost", "external:portal:a");
    throw new Error("abort-after-locks");
  }), /abort-after-locks/u);
  assert.deepEqual(repository.lockTraces[0]?.slice(0, 2), [
    "temporal:workspace-a", "source:cost:external:portal:a"
  ]);
  assert.equal(connection.commits, 0);
  assert.equal(connection.rollbacks, 1);
  assert.equal(connection.releases, 1);
});

test("fake MySQL CAS requires exactly one affected source-head row", async () => {
  const connection = new FakeConnection();
  const repository = new MysqlFinancialLedgerRepository({
    getConnection: async () => connection,
    query: connection.query.bind(connection)
  } as unknown as mysql.Pool);
  const advanced = await repository.transaction((tx) => tx.compareAndSetSourceHead(1, {
    workspaceId: "workspace-a", ledgerType: "cost",
    sourceIdentityRoot: "external:portal:a", currentLedgerEntryId: "cost-2",
    currentSourceVersion: 2, revision: 2
  }));
  assert.equal(advanced, false);
});

test("ledger schema is idempotent DDL with required immutable uniqueness guards", () => {
  const ddl = FINANCIAL_LEDGER_MYSQL_SCHEMA_STATEMENTS.join("\n");
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS acquisition_cost_entries/u);
  assert.match(ddl, /uk_ledger_source_version/u);
  assert.match(ddl, /uk_ledger_single_decision/u);
  assert.match(ddl, /uk_ledger_entry_revision/u);
  assert.match(ddl, /uk_cost_estimate_event_sequence/u);
  assert.match(ddl, /uk_cost_estimate_event_revision/u);
});

test("live MySQL permits only one concurrent correction of a source head", async () => {
  await withGrowthFinanceMysqlTestDatabase(async ({ pool, foundation }) => {
    const service = new AcquisitionCostLedgerService({
      repository: new MysqlFinancialLedgerRepository(pool),
      foundation
    });
    const context = ledgerCommandContext("workspace-a", "finance-a");
    const created = await service.createPending(context, {
      platform: "douyin", planId: null, runId: null, providerId: null,
      category: "media", amountMinor: 100, currency: "CNY",
      businessOccurredAt: "2026-08-08T00:00:00.000Z", provenance: "portal_export",
      sourceRef: "report:a", evidenceHash: "sha256:a", externalId: "a",
      sourceIdentityRoot: "external:portal:a", estimateReconciliationId: null
    });
    await service.verify(
      ledgerCommandContext("workspace-a", "finance-a", "verify-cost-mysql", 1),
      { entryId: created.entry.id, reason: "checked" }
    );
    const attempts = await Promise.allSettled([101, 102].map((amountMinor, index) =>
      service.correct(
        ledgerCommandContext("workspace-a", `finance-${index}`,
          `correction-key-${index}`, 2),
        { entryId: created.entry.id, amountMinor,
          businessOccurredAt: "2026-08-08T00:00:00.000Z",
          evidenceHash: `sha256:${amountMinor}`, sourceRef: `report:${amountMinor}`,
          reason: "reissue" }
      )));
    assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS count FROM acquisition_cost_entries
       WHERE workspace_id = 'workspace-a' AND source_identity_root = 'external:portal:a'
         AND source_version = 2`
    );
    assert.equal(Number((rows as Array<{ count: string }>)[0]?.count), 1);
  });
});

test("live two MySQL connections preserve a sealed cutoff across a rolled-back clock", async () => {
  await withGrowthFinanceMysqlTestDatabase(async (fixture) => {
    const workspace = fixture.workspaceContext("workspace-cutoff");
    await fixture.setSessionTimestamp3("a", "2026-08-09T09:00:00.000Z");
    await fixture.setSessionTimestamp3("b", "2026-08-09T08:59:55.000Z");
    const effectiveCutoff = await fixture.currentTimestamp3OnConnection("a");
    const sealed = await fixture.sealReadCutoffOnConnection("a", workspace, effectiveCutoff);
    assert.equal(sealed.effectiveAsOf, effectiveCutoff);
    assert.ok(await fixture.currentTimestamp3OnConnection("b") < effectiveCutoff);
    const service = fixture.costLedgerOnConnection("b");
    const created = await service.createPending(
      fixture.command("workspace-cutoff", "create-after-seal"),
      fixture.newCostInput({ sourceIdentityRoot: "external:portal:new-stream" })
    );
    await service.verify(
      fixture.command("workspace-cutoff", "verify-after-seal", 1),
      { entryId: created.entry.id, reason: "checked" }
    );
    assert.ok(created.entry.recordedAt > sealed.effectiveAsOf);
    assert.ok(created.entry.temporalSequence > sealed.temporalSequence);
    assert.deepEqual(await fixture.verifiedSealedReader.listVerifiedCostsAt(sealed, {
      currency: "CNY", entryIds: [created.entry.id]
    }), []);
    assert.deepEqual(await fixture.reReadOldCutoffAfterLaterAppend(
      sealed, created.entry.id
    ), []);
    assert.deepEqual(fixture.businessLockTrace("create-after-seal").slice(0, 2), [
      "temporal:workspace-cutoff", "source:cost:external:portal:new-stream"
    ]);
  });
});
