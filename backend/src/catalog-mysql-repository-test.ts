import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type mysql from "mysql2/promise";
import {
  CATALOG_MYSQL_SCHEMA_STATEMENTS,
  MysqlCatalogRepository,
  ensureCatalogMysqlSchema
} from "./catalog-mysql-repository.js";
import type { CommissionCatalogMigrationCommit } from "./catalog-repository.js";

class FakeConnection {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  readonly transactions: string[] = [];
  readonly queue: unknown[] = [];
  enqueue(rows: unknown) { this.queue.push(rows); }
  async query(sql: string, values: unknown[] = []) {
    this.calls.push({ sql: sql.replace(/\s+/gu, " ").trim(), values });
    return [this.queue.shift() ?? { affectedRows: 1 }, []];
  }
  async beginTransaction() { this.transactions.push("begin"); }
  async commit() { this.transactions.push("commit"); }
  async rollback() { this.transactions.push("rollback"); }
  release() { this.transactions.push("release"); }
}

class FakePool extends FakeConnection {
  constructor(readonly connection = new FakeConnection()) { super(); }
  async getConnection() { return this.connection; }
}

function asPool(pool: FakePool) { return pool as unknown as mysql.Pool; }

test("catalog schema uses dedicated append-oriented tables", async () => {
  const pool = new FakePool();
  await ensureCatalogMysqlSchema(asPool(pool));
  assert.equal(pool.calls.length, CATALOG_MYSQL_SCHEMA_STATEMENTS.length);
  const schemaSql = pool.calls.map((call) => call.sql).join("\n");
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS catalog_items/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS pricing_policy_versions/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS package_versions/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS package_components/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS commission_product_catalog_links/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS commission_catalog_migration_runs/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS commission_catalog_migration_items/u);
  assert.match(schemaSql, /source ENUM\('native','legacy_commission_product'\)/u);
  assert.doesNotMatch(schemaSql, /source ENUM\('manual'/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, catalog_item_id\)/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, package_version_id\)/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, pricing_policy_version_id\)/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, migration_run_id\)/u);
  assert.match(schemaSql, /snapshot_json LONGTEXT NOT NULL/u);
  assert.match(schemaSql, /JSON_VALID\(snapshot_json\)/u);
  assert.doesNotMatch(schemaSql, /replaceRows|persistAll/u);
});

test("mysql migration commit rejects cross-workspace references before I/O", async () => {
  const pool = new FakePool();
  const repository = new MysqlCatalogRepository(asPool(pool));
  const snapshot = ["object", []] as const;
  const snapshotHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(snapshot)).digest("hex")}` as const;
  const inputSnapshotHash = `sha256:${createHash("sha256").update(JSON.stringify([
    "commission-catalog-migration-input.v1", "team-a", [snapshot]
  ])).digest("hex")}` as const;
  const reportHash = `sha256:${createHash("sha256").update(JSON.stringify([
    "commission-catalog-migration-report.v1", "team-a",
    [["cp-1", "migrated", "migrated", snapshotHash]]
  ])).digest("hex")}` as const;
  const commit = {
    run: {
      id: "run-1", workspaceId: "team-a", actorId: "admin-1",
      idempotencyKey: "invalid-commit", inputSnapshotHash,
      startedAt: "2026-08-09T08:00:00.000Z",
      completedAt: "2026-08-09T08:00:00.000Z", status: "completed",
      scanned: 1, migrated: 1, repairRequired: 0, reportHash,
      items: [{
        workspaceId: "team-a", commissionProductId: "cp-1",
        status: "migrated", code: "migrated", snapshot, snapshotHash,
        catalogItemId: "item-1", pricingPolicyVersionId: "policy-1"
      }]
    },
    entries: [{
      item: { id: "item-1", workspaceId: "team-b" },
      pricingPolicy: {
        id: "policy-1", workspaceId: "team-a", catalogItemId: "item-1"
      },
      link: {
        workspaceId: "team-a", commissionProductId: "cp-1",
        catalogItemId: "item-1", pricingPolicyVersionId: "policy-1"
      }
    }]
  } as CommissionCatalogMigrationCommit;
  await assert.rejects(
    () => repository.commitCommissionCatalogMigration(commit),
    { code: "invalid_commission_catalog_migration_commit" }
  );
  assert.equal(pool.calls.length, 0);
  assert.equal(pool.connection.transactions.length, 0);
});

test("mysql migration commit rejects a false existing-authority claim before writes", async () => {
  const pool = new FakePool();
  pool.connection.enqueue([]);
  pool.connection.enqueue([{
    workspace_id: "team-a", commission_product_id: "cp-1",
    catalog_item_id: "actual-item", pricing_policy_version_id: "policy-1",
    item_id: "actual-item", policy_id: "policy-1",
    policy_catalog_item_id: "actual-item"
  }]);
  const snapshot = ["object", []] as const;
  const snapshotHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(snapshot)).digest("hex")}` as const;
  const commit = {
    run: {
      id: "run-existing-claim", workspaceId: "team-a", actorId: "admin-1",
      idempotencyKey: "existing-claim", inputSnapshotHash:
        `sha256:${createHash("sha256").update(JSON.stringify([
          "commission-catalog-migration-input.v1", "team-a", [snapshot]
        ])).digest("hex")}`,
      startedAt: "2026-08-09T08:00:00.000Z",
      completedAt: "2026-08-09T08:00:00.000Z", status: "completed",
      scanned: 1, migrated: 1, repairRequired: 0,
      reportHash: `sha256:${createHash("sha256").update(JSON.stringify([
        "commission-catalog-migration-report.v1", "team-a",
        [["cp-1", "migrated", "migrated", snapshotHash]]
      ])).digest("hex")}`,
      items: [{
        workspaceId: "team-a", commissionProductId: "cp-1",
        status: "migrated", code: "migrated", snapshot, snapshotHash,
        catalogItemId: "claimed-item", pricingPolicyVersionId: "policy-1"
      }]
    },
    entries: []
  } as CommissionCatalogMigrationCommit;
  const repository = new MysqlCatalogRepository(asPool(pool));
  await assert.rejects(
    () => repository.commitCommissionCatalogMigration(commit),
    { code: "invalid_commission_catalog_migration_commit" }
  );
  assert.deepEqual(pool.connection.transactions, ["begin", "rollback", "release"]);
  assert.equal(
    pool.connection.calls.some((call) => /^(?:INSERT|UPDATE|DELETE)\b/u.test(call.sql)),
    false
  );
});

test("mysql catalog reads are workspace-scoped and clone parsed JSON", async () => {
  const pool = new FakePool();
  pool.enqueue([{
    id: "policy-1", workspace_id: "team-a", catalog_item_id: "item-1",
    version: 1, package_version_id: null, currency: "CNY",
    list_unit_price_minor: 100, unit_standard_cost_minor: 20,
    default_order_delivery_cost_minor: 0, default_order_sales_cost_minor: 0,
    default_order_service_cost_minor: 0, absolute_floor_unit_price_minor: 20,
    standard_discount_limit_bps: 0, absolute_discount_limit_bps: 0,
    target_gross_margin_bps: 0, absolute_minimum_gross_margin_bps: 0,
    standard_payment_term_days: 0, absolute_payment_term_days: 0,
    approval_thresholds_json: JSON.stringify({
      discountCapability: "quote.exception.discount.approve",
      marginCapability: "quote.exception.margin.approve",
      paymentTermsCapability: "quote.exception.payment_terms.approve",
      giftCapability: "quote.exception.gift.approve",
      creditCapability: "quote.exception.credit.approve",
      manualCapability: "quote.exception.manual.approve",
      creditRiskThresholdBps: 0,
      manualEscalationEnabled: false
    }),
    surcharge_policies_json: JSON.stringify([{
      kind: "region", condition: "CN-FJ",
      fixedAmountMinor: 1_000, unitAmountMinor: 0
    }]),
    gift_policies_json: "[]", valid_from: "2026-08-09T08:00:00.000Z",
    valid_to: null, status: "draft", source: "native",
    capability_registry_version: "growth-capabilities.v1", revision: 1,
    created_by: "admin-1", created_at: "2026-08-09T08:00:00.000Z"
  }]);
  const repository = new MysqlCatalogRepository(asPool(pool));
  const policy = await repository.findPricingPolicyVersion("team-a", "policy-1");
  assert.ok(policy);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(policy.source, "native");
  assert.equal(policy.approvalThresholds.manualEscalationEnabled, false);
  assert.deepEqual(policy.surchargePolicies, [{
    kind: "region", condition: "CN-FJ",
    fixedAmountMinor: 1_000, unitAmountMinor: 0
  }]);
  assert.deepEqual(pool.calls.at(-1)?.values, ["team-a", "policy-1"]);
  assert.match(pool.calls.at(-1)!.sql, /workspace_id = \? AND id = \?/u);
});
