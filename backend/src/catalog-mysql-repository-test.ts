import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type mysql from "mysql2/promise";
import {
  CATALOG_MYSQL_SCHEMA_STATEMENTS,
  MysqlCatalogRepository,
  ensureCatalogMysqlSchema
} from "./catalog-mysql-repository.js";
import type {
  CommissionCatalogMigrationCommit,
  CreateCatalogItemCommand,
  CreatePricingPolicyDraftCommand,
  PackageVersionLifecycleCommand,
  PricingPolicyLifecycleCommand
} from "./catalog-repository.js";
import type { PricingPolicyVersion } from "./catalog-domain.js";
import { MysqlGrowthTemporalBarrier } from "./growth-temporal-barrier-mysql-repository.js";

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

class ExistingSchemaPool extends FakePool {
  private readonly columns = new Map<string, Map<string, string>>([
    ["catalog_items", new Map()], ["pricing_policy_versions", new Map()],
    ["package_versions", new Map()], ["package_components", new Map()]
  ]);

  override async query(sql: string, values: unknown[] = []) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.calls.push({ sql: normalized, values });
    if (/FROM information_schema\.columns/u.test(normalized)) {
      const table = String(values[0]);
      return [[...(this.columns.get(table) ?? new Map()).entries()].map(
        ([column_name, is_nullable]) => ({ column_name, is_nullable })
      ), []];
    }
    const add = /^ALTER TABLE (\w+) ADD COLUMN (recorded_at|temporal_sequence)/u
      .exec(normalized);
    if (add) this.columns.get(add[1]!)?.set(add[2]!, "YES");
    const modify = /^ALTER TABLE (\w+) MODIFY COLUMN recorded_at/u.exec(normalized);
    if (modify) {
      this.columns.get(modify[1]!)?.set("recorded_at", "NO");
      this.columns.get(modify[1]!)?.set("temporal_sequence", "NO");
    }
    return [{ affectedRows: 1 }, []];
  }
}

class LifecycleConnection extends FakeConnection {
  constructor(private readonly lifecycle: "activate" | "retire") { super(); }

  override async query(sql: string, values: unknown[] = []) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.calls.push({ sql: normalized, values });
    if (/^INSERT INTO growth_workspace_temporal_barriers/u.test(normalized)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/FROM growth_workspace_temporal_barriers/u.test(normalized)) {
      return [[{ last_recorded_at: "2026-08-09 08:00:00.000", temporal_sequence: 20 }], []];
    }
    if (/CURRENT_TIMESTAMP\(3\)/u.test(normalized)) {
      return [[{ current_timestamp_3: "2026-08-09 08:00:00.000" }], []];
    }
    if (/^UPDATE growth_workspace_temporal_barriers/u.test(normalized)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/FROM catalog_command_receipts/u.test(normalized)) return [[], []];
    if (/^SELECT catalog_item_id FROM pricing_policy_versions/u.test(normalized)) {
      return [[{ catalog_item_id: "item-1" }], []];
    }
    if (/^SELECT package_catalog_item_id FROM package_versions/u.test(normalized)) {
      return [[{ package_catalog_item_id: "package-item-1" }], []];
    }
    if (/^SELECT \* FROM catalog_items/u.test(normalized)) {
      return [[catalogRow({ id: String(values[1] ?? "item-1"), item_type: "package" })], []];
    }
    if (/pricing_policy_versions/u.test(normalized)) {
      return [[pricingRow({ policy_status: this.lifecycle === "retire" ? "active" : "draft" })], []];
    }
    if (/package_versions/u.test(normalized)) {
      return [[packageRow({ package_status: this.lifecycle === "retire" ? "active" : "draft" })], []];
    }
    if (/FROM package_components/u.test(normalized)) return [[], []];
    return [{ affectedRows: 1 }, []];
  }
}

class ReceiptConnection extends FakeConnection {
  private sequence = 0;
  private readonly items = new Map<string, Record<string, unknown>>();
  private readonly receipts = new Map<string, Record<string, unknown>>();

  override async query(sql: string, values: unknown[] = []) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.calls.push({ sql: normalized, values });
    if (/^INSERT INTO growth_workspace_temporal_barriers/u.test(normalized)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/FROM growth_workspace_temporal_barriers/u.test(normalized)) {
      return [[{
        last_recorded_at: "2026-08-09 08:00:00.000",
        temporal_sequence: this.sequence
      }], []];
    }
    if (/CURRENT_TIMESTAMP\(3\)/u.test(normalized)) {
      return [[{ current_timestamp_3: "2026-08-09 08:00:00.000" }], []];
    }
    if (/^UPDATE growth_workspace_temporal_barriers/u.test(normalized)) {
      this.sequence = Number(values[1]);
      return [{ affectedRows: 1 }, []];
    }
    if (/^SELECT request_hash,resource_kind,resource_id/u.test(normalized)) {
      const receipt = this.receipts.get(values.slice(0, 4).join("\u0000"));
      return [receipt ? [receipt] : [], []];
    }
    if (/^INSERT INTO catalog_command_receipts/u.test(normalized)) {
      this.receipts.set(values.slice(0, 4).join("\u0000"), {
        request_hash: values[4], resource_kind: values[5], resource_id: values[6]
      });
      return [{ affectedRows: 1 }, []];
    }
    if (/^SELECT \* FROM catalog_items/u.test(normalized)) {
      const workspaceId = String(values[0]);
      const id = String(values[1]);
      const code = values[2] === undefined ? null : String(values[2]);
      const rows = [...this.items.values()].filter((row) =>
        row.workspace_id === workspaceId && (row.id === id || row.code === code));
      return [rows, []];
    }
    if (/^INSERT INTO catalog_items/u.test(normalized)) {
      this.items.set(`${values[0]}\u0000${values[1]}`, catalogRow({
        workspace_id: values[0], id: values[1], item_type: values[2], code: values[3],
        name: values[4], description: values[5], unit: values[6],
        item_status: values[7], revision: values[8], created_by: values[9],
        created_at: values[10], updated_at: values[11]
      }));
      return [{ affectedRows: 1 }, []];
    }
    if (/^UPDATE catalog_items SET name/u.test(normalized)) {
      const mapKey = `${values[7]}\u0000${values[8]}`;
      const current = this.items.get(mapKey)!;
      this.items.set(mapKey, {
        ...current, name: values[0], description: values[1], unit: values[2],
        revision: values[3], updated_at: values[4]
      });
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 1 }, []];
  }
}

class FailingEmptyStampConnection extends FakeConnection {
  override async query(sql: string, values: unknown[] = []) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    if (/^UPDATE package_versions SET recorded_at/u.test(normalized)) {
      this.calls.push({ sql: normalized, values });
      throw new Error("stamp_write_failed");
    }
    return super.query(sql, values);
  }
}

function asPool(pool: FakePool) { return pool as unknown as mysql.Pool; }

function catalogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1", workspace_id: "team-a", item_type: "service",
    code: "SVC-001", name: "诊断服务", description: "获客诊断",
    unit: "次", item_status: "active", revision: 1,
    created_by: "admin-1", created_at: "2026-08-09 08:00:00.001",
    updated_at: "2026-08-09 08:00:00.001",
    last_idempotency_key: "catalog-create-0001",
    last_request_hash: "sha256:catalog-create-0001",
    ...overrides
  };
}

function enqueueBarrier(pool: FakePool, sequence: number, withReceipt = true) {
  pool.connection.enqueue({ affectedRows: 1 });
  pool.connection.enqueue([{
    last_recorded_at: "2026-08-09 08:00:00.000",
    temporal_sequence: sequence
  }]);
  pool.connection.enqueue([{
    current_timestamp_3: "2026-08-09 08:00:00.000"
  }]);
  pool.connection.enqueue({ affectedRows: 1 });
  if (withReceipt) pool.connection.enqueue([]);
}

function pricingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-1", workspace_id: "team-a", catalog_item_id: "item-1",
    version: 1, package_version_id: null, currency: "CNY",
    list_unit_price_minor: 10_000, unit_standard_cost_minor: 4_000,
    default_order_delivery_cost_minor: 0, default_order_sales_cost_minor: 0,
    default_order_service_cost_minor: 0, absolute_floor_unit_price_minor: 4_000,
    standard_discount_limit_bps: 500, absolute_discount_limit_bps: 1_000,
    target_gross_margin_bps: 5_000, absolute_minimum_gross_margin_bps: 2_000,
    standard_payment_term_days: 30, absolute_payment_term_days: 60,
    approval_thresholds_json: JSON.stringify({
      discountCapability: "quote.exception.discount.approve",
      marginCapability: "quote.exception.margin.approve",
      paymentTermsCapability: "quote.exception.payment_terms.approve",
      giftCapability: "quote.exception.gift.approve",
      creditCapability: "quote.exception.credit.approve",
      manualCapability: "quote.exception.manual.approve",
      creditRiskThresholdBps: 7_000, manualEscalationEnabled: true
    }),
    surcharge_policies_json: "[]", gift_policies_json: "[]",
    valid_from: "2026-08-09 08:00:00.000", valid_to: null,
    policy_status: "draft", source: "native",
    capability_registry_version: "growth-capabilities.v1", revision: 1,
    created_by: "admin-1", created_at: "2026-08-09 08:00:00.000",
    ...overrides
  };
}

function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "package-1", workspace_id: "team-a",
    package_catalog_item_id: "package-item-1", version: 1, currency: "CNY",
    package_status: "draft", valid_from: "2026-08-09 08:00:00.000",
    valid_to: null, revision: 1, created_by: "admin-1",
    created_at: "2026-08-09 08:00:00.000",
    updated_at: "2026-08-09 08:00:00.000", ...overrides
  };
}

function policyValue(overrides: Record<string, unknown> = {}): PricingPolicyVersion {
  return {
    id: "policy-1", workspaceId: "team-a", catalogItemId: "item-1", version: 1,
    packageVersionId: null, currency: "CNY", listUnitPriceMinor: 10_000,
    unitStandardCostMinor: 4_000, defaultOrderDeliveryCostMinor: 0,
    defaultOrderSalesCostMinor: 0, defaultOrderServiceCostMinor: 0,
    absoluteFloorUnitPriceMinor: 4_000, standardDiscountLimitBps: 500,
    absoluteDiscountLimitBps: 1_000, targetGrossMarginBps: 5_000,
    absoluteMinimumGrossMarginBps: 2_000, standardPaymentTermDays: 30,
    absolutePaymentTermDays: 60,
    approvalThresholds: {
      discountCapability: "quote.exception.discount.approve",
      marginCapability: "quote.exception.margin.approve",
      paymentTermsCapability: "quote.exception.payment_terms.approve",
      giftCapability: "quote.exception.gift.approve",
      creditCapability: "quote.exception.credit.approve",
      manualCapability: "quote.exception.manual.approve",
      creditRiskThresholdBps: 7_000, manualEscalationEnabled: true
    },
    surchargePolicies: [], giftPolicies: [],
    validFrom: "2026-08-09T08:00:00.000Z", validTo: null,
    status: "draft", source: "native",
    capabilityRegistryVersion: "growth-capabilities.v1", revision: 1,
    createdBy: "admin-1", createdAt: "2026-08-09T08:00:00.000Z",
    ...overrides
  } as PricingPolicyVersion;
}

test("catalog schema uses dedicated append-oriented tables", async () => {
  const pool = new ExistingSchemaPool();
  await ensureCatalogMysqlSchema(asPool(pool));
  const schemaSql = pool.calls.map((call) => call.sql).join("\n");
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS catalog_items/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS pricing_policy_versions/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS package_versions/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS package_components/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS catalog_command_receipts/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS commission_product_catalog_links/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS commission_catalog_migration_runs/u);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS commission_catalog_migration_items/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, catalog_item_id\)/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, package_version_id\)/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, pricing_policy_version_id\)/u);
  assert.match(schemaSql, /FOREIGN KEY \(workspace_id, migration_run_id\)/u);
  assert.match(schemaSql, /snapshot_json LONGTEXT NOT NULL/u);
  assert.match(schemaSql, /JSON_VALID\(snapshot_json\)/u);
  assert.doesNotMatch(schemaSql, /replaceRows|persistAll/u);
});

test("catalog schema upgrades prerequisite tables and repeats idempotently", async () => {
  const pool = new ExistingSchemaPool();
  await ensureCatalogMysqlSchema(asPool(pool));
  const firstRunCount = pool.calls.length;
  await ensureCatalogMysqlSchema(asPool(pool));
  const firstRunSql = pool.calls.slice(0, firstRunCount).map((call) => call.sql);
  const sql = firstRunSql.join("\n");
  for (const table of [
    "catalog_items", "pricing_policy_versions", "package_versions",
    "package_components"
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ADD COLUMN recorded_at`, "u"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ADD COLUMN temporal_sequence`, "u"));
  }
  assert.match(sql, /SET recorded_at = COALESCE\(recorded_at,updated_at\)/u);
  assert.match(sql, /SET recorded_at = COALESCE\(recorded_at,created_at\)/u);
  assert.match(sql, /temporal_sequence = COALESCE\([^\n]*,0\)/u);
  assert.equal(
    pool.calls.slice(firstRunCount).some((call) => / ADD COLUMN /u.test(call.sql)),
    false
  );
});

test("catalog schema deterministically upgrades and closes the pricing source enum", async () => {
  const pool = new ExistingSchemaPool();
  await ensureCatalogMysqlSchema(asPool(pool));
  const firstRunCount = pool.calls.length;
  await ensureCatalogMysqlSchema(asPool(pool));

  const firstRun = pool.calls.slice(0, CATALOG_MYSQL_SCHEMA_STATEMENTS.length);
  const secondRun = pool.calls.slice(
    firstRunCount, firstRunCount + CATALOG_MYSQL_SCHEMA_STATEMENTS.length
  );
  assert.deepEqual(secondRun, firstRun);

  const sourceStatements = firstRun
    .map((call) => call.sql)
    .filter((sql) => /pricing_policy_versions/u.test(sql) && /\bsource\b/u.test(sql));
  assert.equal(sourceStatements.length, 4);
  assert.match(sourceStatements[0]!, /CREATE TABLE IF NOT EXISTS pricing_policy_versions/u);
  assert.match(
    sourceStatements[0]!,
    /source ENUM\('native','legacy_commission_product'\) NOT NULL/u
  );
  assert.equal(
    sourceStatements[1],
    "ALTER TABLE pricing_policy_versions MODIFY COLUMN source "
      + "ENUM('manual','native','legacy_commission_product') NOT NULL"
  );
  assert.equal(
    sourceStatements[2],
    "UPDATE pricing_policy_versions SET source = 'native' WHERE source = 'manual'"
  );
  assert.equal(
    sourceStatements[3],
    "ALTER TABLE pricing_policy_versions MODIFY COLUMN source "
      + "ENUM('native','legacy_commission_product') NOT NULL"
  );
  assert.doesNotMatch(sourceStatements.at(-1)!, /manual/u);
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

test("mysql policy boundaries reject full unknown and retired manual shapes before I/O", async () => {
  for (const invalid of [
    { ...policyValue(), source: "manual" },
    { ...policyValue(), futureRule: true }
  ]) {
    const pool = new FakePool();
    const repository = new MysqlCatalogRepository(asPool(pool));
    await assert.rejects(
      () => repository.appendPricingPolicyVersion(invalid as PricingPolicyVersion),
      { code: "invalid_pricing_policy_version" }
    );
    assert.equal(pool.calls.length, 0);
  }

  const pool = new FakePool();
  pool.enqueue([pricingRow({ source: "manual" })]);
  const repository = new MysqlCatalogRepository(asPool(pool));
  await assert.rejects(
    () => repository.findPricingPolicyVersion("team-a", "policy-1"),
    { code: "invalid_pricing_policy_version" }
  );
});

test("mysql catalog command locks the temporal barrier before domain rows and commits", async () => {
  const pool = new FakePool();
  pool.connection.enqueue({ affectedRows: 1 });
  pool.connection.enqueue([{
    last_recorded_at: "2026-08-09 08:00:00.000",
    temporal_sequence: 4
  }]);
  pool.connection.enqueue([{
    current_timestamp_3: "2026-08-09 08:00:00.000"
  }]);
  pool.connection.enqueue({ affectedRows: 1 });
  pool.connection.enqueue([]);
  pool.connection.enqueue([]);
  const repository = new MysqlCatalogRepository(
    asPool(pool),
    new MysqlGrowthTemporalBarrier(asPool(pool))
  );
  const command: CreateCatalogItemCommand = {
    workspaceId: "team-a", id: "item-1", type: "service", code: "SVC-001",
    name: "诊断服务", description: "获客诊断", unit: "次",
    actorId: "admin-1", idempotencyKey: "catalog-create-0001",
    requestHash: "sha256:catalog-create-0001"
  };

  const result = await repository.createCatalogItem(command);

  assert.equal(result.kind, "ok");
  assert.equal(result.replayed, false);
  assert.deepEqual(result.value, {
    id: "item-1", workspaceId: "team-a", type: "service", code: "SVC-001",
    name: "诊断服务", description: "获客诊断", unit: "次", status: "active",
    revision: 1, createdBy: "admin-1",
    createdAt: "2026-08-09T08:00:00.001Z",
    updatedAt: "2026-08-09T08:00:00.001Z"
  });
  assert.deepEqual(pool.connection.transactions, ["begin", "commit", "release"]);
  const sql = pool.connection.calls.map((call) => call.sql);
  assert.match(sql[0]!, /^INSERT INTO growth_workspace_temporal_barriers/u);
  assert.match(sql[1]!, /growth_workspace_temporal_barriers[\s\S]*FOR UPDATE/u);
  const firstDomainLock = sql.findIndex((statement) =>
    /FROM catalog_items/u.test(statement) && /FOR UPDATE/u.test(statement)
  );
  assert.ok(firstDomainLock > 3);
  assert.ok(sql.slice(0, firstDomainLock).every((statement) =>
    /growth_workspace_temporal_barriers|CURRENT_TIMESTAMP|catalog_command_receipts/u
      .test(statement)
  ));
  const insert = pool.connection.calls.find((call) =>
    /^INSERT INTO catalog_items/u.test(call.sql)
  )!;
  assert.match(insert.sql, /^INSERT INTO catalog_items/u);
  assert.equal(insert.values[12], "2026-08-09 08:00:00.001");
  assert.equal(insert.values[13], 5);
  assert.doesNotMatch(sql.join("\n"), /persistAll|replaceRows/u);
});

test("mysql domain receipts scope by actor and operation and survive intervening commands", async () => {
  const connection = new ReceiptConnection();
  const pool = new FakePool(connection);
  const repository = new MysqlCatalogRepository(
    asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
  );
  const create: CreateCatalogItemCommand = {
    workspaceId: "team-a", id: "item-1", type: "service", code: "SVC-001",
    name: "原名称", description: "获客诊断", unit: "次",
    actorId: "admin-1", idempotencyKey: "shared-key",
    requestHash: "sha256:create"
  };
  assert.equal((await repository.createCatalogItem(create)).kind, "ok");
  assert.equal((await repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-1", expectedRevision: 1,
    patch: { name: "actor-one" }, actorId: "admin-1",
    idempotencyKey: "shared-key", requestHash: "sha256:update-one"
  })).kind, "ok");
  assert.equal((await repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-1", expectedRevision: 2,
    patch: { name: "actor-two" }, actorId: "admin-2",
    idempotencyKey: "shared-key", requestHash: "sha256:update-two"
  })).kind, "ok");
  assert.deepEqual(await repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-1", expectedRevision: 3,
    patch: { name: "conflict" }, actorId: "admin-1",
    idempotencyKey: "shared-key", requestHash: "sha256:changed"
  }), { kind: "state_conflict", code: "idempotency_conflict" });

  const replay = await repository.createCatalogItem({ ...create, id: "ignored-new-id" });
  assert.equal(replay.kind, "ok");
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.id, "item-1");
  assert.equal(replay.value.name, "actor-two");
  assert.equal(replay.value.revision, 3);
});

test("mysql draft-component replacement takes the temporal barrier before its package lock", async () => {
  const pool = new FakePool();
  pool.connection.enqueue({ affectedRows: 1 });
  pool.connection.enqueue([{
    last_recorded_at: "2026-08-09 08:00:00.000",
    temporal_sequence: 8
  }]);
  pool.connection.enqueue([{
    current_timestamp_3: "2026-08-09 08:00:00.000"
  }]);
  pool.connection.enqueue({ affectedRows: 1 });
  pool.connection.enqueue([{
    package_status: "draft", updated_at: "2026-08-09 08:00:00.000"
  }]);
  const repository = new MysqlCatalogRepository(
    asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
  );

  const components = await repository.replaceDraftPackageComponents(
    "team-a", "package-version-1", [{
      workspaceId: "team-a", packageVersionId: "package-version-1",
      componentCatalogItemId: "item-1",
      componentPricingPolicyVersionId: "policy-1", quantityMicros: 1_000_000
    }]
  );

  assert.deepEqual(Object.keys(components[0]!).sort(), [
    "componentCatalogItemId", "componentPricingPolicyVersionId",
    "packageVersionId", "quantityMicros", "workspaceId"
  ]);
  const sql = pool.connection.calls.map((call) => call.sql);
  assert.match(sql[0]!, /^INSERT INTO growth_workspace_temporal_barriers/u);
  assert.match(sql[1]!, /growth_workspace_temporal_barriers[\s\S]*FOR UPDATE/u);
  assert.match(sql[4]!, /FROM package_versions[\s\S]*FOR UPDATE/u);
  const componentInsert = pool.connection.calls.at(-1)!;
  assert.equal(componentInsert.values.at(-2), "2026-08-09 08:00:00.001");
  assert.equal(componentInsert.values.at(-1), 9);
  assert.deepEqual(pool.connection.transactions, ["begin", "commit", "release"]);
});

test("mysql empty draft-component replacement persists its set-level authority stamp", async () => {
  const pool = new FakePool();
  enqueueBarrier(pool, 8, false);
  pool.connection.enqueue([{
    package_status: "draft", updated_at: "2026-08-09 08:00:00.000"
  }]);
  const repository = new MysqlCatalogRepository(
    asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
  );

  assert.deepEqual(
    await repository.replaceDraftPackageComponents("team-a", "package-version-1", []),
    []
  );
  const stampUpdate = pool.connection.calls.find((call) =>
    /^UPDATE package_versions SET recorded_at/u.test(call.sql)
  );
  assert.ok(stampUpdate);
  assert.deepEqual(stampUpdate.values, [
    "2026-08-09 08:00:00.001", 9, "team-a", "package-version-1"
  ]);
});

test("mysql empty draft-component replacement rolls back delete when stamp write fails", async () => {
  const connection = new FailingEmptyStampConnection();
  const pool = new FakePool(connection);
  enqueueBarrier(pool, 8, false);
  connection.enqueue([{
    package_status: "draft", updated_at: "2026-08-09 08:00:00.000"
  }]);
  const repository = new MysqlCatalogRepository(
    asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
  );
  await assert.rejects(
    () => repository.replaceDraftPackageComponents(
      "team-a", "package-version-1", []
    ),
    /stamp_write_failed/u
  );
  assert.deepEqual(connection.transactions, ["begin", "rollback", "release"]);
  const sql = connection.calls.map((call) => call.sql);
  assert.ok(sql.findIndex((statement) => /^DELETE FROM package_components/u.test(statement))
    < sql.findIndex((statement) => /^UPDATE package_versions SET recorded_at/u.test(statement)));
});

for (const lifecycle of ["activate", "retire"] as const) {
  test(`mysql pricing ${lifecycle} locks discovered parent then child separately`, async () => {
    const pool = new FakePool(new LifecycleConnection(lifecycle));
    const repository = new MysqlCatalogRepository(
      asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
    );
    const command: PricingPolicyLifecycleCommand = {
      workspaceId: "team-a", id: "policy-1", expectedRevision: 1,
      actorId: "admin-1", idempotencyKey: `policy-${lifecycle}`,
      requestHash: `sha256:policy-${lifecycle}`
    };
    await repository[lifecycle === "activate"
      ? "activatePricingPolicy" : "retirePricingPolicy"](command);
    const domain = pool.connection.calls.slice(5).map((call) => call.sql);
    assert.match(domain[0]!, /^SELECT catalog_item_id FROM pricing_policy_versions/u);
    assert.match(domain[1]!, /^SELECT \* FROM catalog_items[\s\S]*FOR UPDATE/u);
    assert.match(domain[2]!, /^SELECT \* FROM pricing_policy_versions[\s\S]*FOR UPDATE/u);
    assert.doesNotMatch(domain.slice(0, 3).join("\n"), /INNER JOIN/u);
  });

  test(`mysql package ${lifecycle} locks discovered parent then child separately`, async () => {
    const pool = new FakePool(new LifecycleConnection(lifecycle));
    const repository = new MysqlCatalogRepository(
      asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
    );
    const command: PackageVersionLifecycleCommand = {
      workspaceId: "team-a", id: "package-1", expectedRevision: 1,
      actorId: "admin-1", idempotencyKey: `package-${lifecycle}`,
      requestHash: `sha256:package-${lifecycle}`
    };
    await repository[lifecycle === "activate"
      ? "activatePackageVersion" : "retirePackageVersion"](command);
    const domain = pool.connection.calls.slice(5).map((call) => call.sql);
    assert.match(domain[0]!, /^SELECT package_catalog_item_id FROM package_versions/u);
    assert.match(domain[1]!, /^SELECT \* FROM catalog_items[\s\S]*FOR UPDATE/u);
    assert.match(domain[2]!, /^SELECT \* FROM package_versions[\s\S]*FOR UPDATE/u);
    assert.doesNotMatch(domain.slice(0, 3).join("\n"), /INNER JOIN/u);
  });
}

test("mysql stale revision matches memory semantics and rolls back its barrier allocation", async () => {
  const pool = new FakePool();
  enqueueBarrier(pool, 5);
  pool.connection.enqueue([catalogRow({ revision: 2 })]);
  const repository = new MysqlCatalogRepository(
    asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
  );

  const result = await repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-1", expectedRevision: 1,
    patch: { name: "并发覆盖" }, actorId: "admin-2",
    idempotencyKey: "catalog-update-stale",
    requestHash: "sha256:catalog-update-stale"
  });

  assert.deepEqual(result, { kind: "revision_conflict", actualRevision: 2 });
  assert.deepEqual(pool.connection.transactions, ["begin", "rollback", "release"]);
  assert.equal(
    pool.connection.calls.some((call) => /^UPDATE catalog_items/u.test(call.sql)),
    false
  );
});

test("mysql pricing version allocation locks one parent before reading MAX(version)", async () => {
  const pool = new FakePool();
  enqueueBarrier(pool, 10);
  pool.connection.enqueue([catalogRow()]);
  pool.connection.enqueue([]);
  pool.connection.enqueue([{ max_version: 4 }]);
  const repository = new MysqlCatalogRepository(
    asPool(pool), new MysqlGrowthTemporalBarrier(asPool(pool))
  );
  const command: CreatePricingPolicyDraftCommand = {
    workspaceId: "team-a", id: "policy-5", catalogItemId: "item-1",
    packageVersionId: null, currency: "CNY", listUnitPriceMinor: 10_000,
    unitStandardCostMinor: 4_000, defaultOrderDeliveryCostMinor: 0,
    defaultOrderSalesCostMinor: 0, defaultOrderServiceCostMinor: 0,
    absoluteFloorUnitPriceMinor: 4_000, standardDiscountLimitBps: 500,
    absoluteDiscountLimitBps: 1_000, targetGrossMarginBps: 5_000,
    absoluteMinimumGrossMarginBps: 2_000, standardPaymentTermDays: 30,
    absolutePaymentTermDays: 60,
    approvalThresholds: {
      discountCapability: "quote.exception.discount.approve",
      marginCapability: "quote.exception.margin.approve",
      paymentTermsCapability: "quote.exception.payment_terms.approve",
      giftCapability: "quote.exception.gift.approve",
      creditCapability: "quote.exception.credit.approve",
      manualCapability: "quote.exception.manual.approve",
      creditRiskThresholdBps: 7_000,
      manualEscalationEnabled: true
    },
    surchargePolicies: [], giftPolicies: [],
    validFrom: "2026-08-09T08:00:00.000Z", validTo: null,
    source: "native", capabilityRegistryVersion: "growth-capabilities.v1",
    actorId: "admin-1", idempotencyKey: "policy-create-5",
    requestHash: "sha256:policy-create-5"
  };

  const result = await repository.createPricingPolicyDraft(command);

  assert.equal(result.kind, "ok");
  assert.equal(result.value.version, 5);
  const sql = pool.connection.calls.map((call) => call.sql);
  const parentLock = sql.findIndex((statement) =>
    /FROM catalog_items/u.test(statement) && /FOR UPDATE/u.test(statement)
  );
  const maxRead = sql.findIndex((statement) => /SELECT MAX\(version\)/u.test(statement));
  assert.ok(parentLock > 3);
  assert.ok(maxRead > parentLock);
  assert.deepEqual(pool.connection.calls[maxRead]!.values, ["team-a", "item-1"]);
  assert.deepEqual(pool.connection.transactions, ["begin", "commit", "release"]);
});
