import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { CommissionProduct } from "./types.js";
import {
  CommissionCatalogMigrationService,
  type CommissionProductMigrationSource
} from "./commission-catalog-migration.js";
import { InMemoryCatalogRepository } from "./catalog-repository.js";
import type { CommissionCatalogMigrationCommit } from "./catalog-repository.js";

const BASE_PRODUCT: CommissionProduct = {
  id: "cp-1", ownerId: "admin-1", teamId: "team-a",
  name: "标准服务", category: "服务", model: "标准",
  defaultPrice: 29_800, costPrice: 8_000, currency: "CNY",
  status: "active", remark: "", updatedAt: "2026-08-09T08:00:00.000Z"
};

function migrationFixture(overrides: Partial<CommissionProduct> = {}) {
  const repository = new InMemoryCatalogRepository();
  const service = new CommissionCatalogMigrationService({
    repository,
    products: async () => [{ ...BASE_PRODUCT, ...overrides }],
    now: () => "2026-08-09T08:00:00.000Z",
    idFactory: (prefix) => `${prefix}-1`
  });
  return { repository, service };
}

function rawMigrationFixture(defaultPrice: unknown, costPrice: unknown) {
  const repository = new InMemoryCatalogRepository();
  const product = {
    ...BASE_PRODUCT,
    defaultPrice,
    costPrice
  } as CommissionProductMigrationSource;
  const service = new CommissionCatalogMigrationService({
    repository,
    products: async () => [product],
    now: () => "2026-08-09T08:00:00.000Z",
    idFactory: (prefix) => `${prefix}-raw`
  });
  return { repository, service };
}

test("migration creates one traceable catalog item and initial policy", async () => {
  const state = migrationFixture();
  const result = await state.service.execute(
    "team-a", "admin-1", "commission-migration-0001"
  );
  assert.equal(result.migrated, 1);
  const link = await state.repository.findCommissionProductLink("team-a", "cp-1");
  assert.ok(link);
  const item = await state.repository.findCatalogItem("team-a", link.catalogItemId);
  const policy = await state.repository.findPricingPolicyVersion(
    "team-a", link.pricingPolicyVersionId
  );
  assert.equal(item?.status, "active");
  assert.equal(policy?.source, "legacy_commission_product");
  assert.equal(policy?.status, "draft");
  assert.equal(policy?.listUnitPriceMinor, 2_980_000);
  assert.equal(policy?.unitStandardCostMinor, 800_000);
  assert.equal(policy?.absoluteFloorUnitPriceMinor, 800_000);
  assert.match(result.items[0]!.snapshotHash, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.reportHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
});

test("invalid currency enters repair queue and cannot be quoted", async () => {
  const state = migrationFixture({ currency: "RMB" });
  const result = await state.service.execute(
    "team-a", "admin-1", "commission-migration-0002"
  );
  assert.equal(result.repairRequired, 1);
  assert.equal(result.items[0]?.code, "invalid_currency");
  assert.equal(await state.repository.findCommissionProductLink(
    "team-a", "cp-1"
  ), null);
});

test("migration rejects decimal precision beyond the ISO exponent", async () => {
  const state = migrationFixture({ currency: "JPY", defaultPrice: 1.5 });
  const result = await state.service.preview("team-a");
  assert.equal(result.repairRequired, 1);
  assert.equal(result.items[0]?.code, "invalid_default_price_precision");
  assert.equal(await state.repository.findCatalogItem("team-a", "catalog_item-1"), null);
});

test("migration parses raw decimals exactly and repairs null or malformed amounts", async () => {
  const valid = rawMigrationFixture("29800.10", "8000.01");
  const migrated = await valid.service.execute("team-a", "admin-1", "raw-valid");
  const link = await valid.repository.findCommissionProductLink("team-a", "cp-1");
  assert.ok(link);
  const policy = await valid.repository.findPricingPolicyVersion(
    "team-a", link.pricingPolicyVersionId
  );
  assert.equal(migrated.migrated, 1);
  assert.equal(policy?.listUnitPriceMinor, 2_980_010);
  assert.equal(policy?.unitStandardCostMinor, 800_001);

  const nullPrice = await rawMigrationFixture(null, "8000.00")
    .service.preview("team-a");
  assert.equal(nullPrice.items[0]?.code, "invalid_default_price");

  const malformedCost = await rawMigrationFixture("29800.00", "8,000")
    .service.preview("team-a");
  assert.equal(malformedCost.items[0]?.code, "invalid_cost_price");
});

test("same idempotency key replays only an identical deterministic snapshot", async () => {
  const products: CommissionProduct[] = [{ ...BASE_PRODUCT }];
  const repository = new InMemoryCatalogRepository();
  const service = new CommissionCatalogMigrationService({
    repository,
    products: async () => products,
    now: () => "2026-08-09T08:00:00.000Z",
    idFactory: (prefix) => `${prefix}-1`
  });
  const first = await service.execute("team-a", "admin-1", "migration-key");
  const replay = await service.execute("team-a", "admin-1", "migration-key");
  assert.deepEqual(replay, first);
  products[0] = { ...products[0]!, defaultPrice: 30_000 };
  await assert.rejects(
    () => service.execute("team-a", "admin-1", "migration-key"),
    (error: unknown) => (error as { code?: string }).code
      === "commission_catalog_migration_conflict"
  );
});

test("tagged snapshots preserve invalid JavaScript values and bind idempotency bytes", async () => {
  const product = {
    ...BASE_PRODUCT,
    defaultPrice: Number.NaN,
    diagnostic: {
      positive: Number.POSITIVE_INFINITY,
      negative: Number.NEGATIVE_INFINITY,
      missing: undefined
    }
  } as CommissionProduct & { diagnostic: Record<string, unknown> };
  const repository = new InMemoryCatalogRepository();
  const service = new CommissionCatalogMigrationService({
    repository,
    products: async () => [product],
    now: () => "2026-08-09T08:00:00.000Z",
    idFactory: (prefix) => `${prefix}-tagged`
  });
  const first = await service.execute("team-a", "admin-1", "tagged-key");
  const snapshotBytes = JSON.stringify(first.items[0]!.snapshot);
  assert.deepEqual(JSON.parse(snapshotBytes), first.items[0]!.snapshot);
  assert.match(snapshotBytes, /"number","NaN"/u);
  assert.match(snapshotBytes, /"number","Infinity"/u);
  assert.match(snapshotBytes, /"number","-Infinity"/u);
  assert.match(snapshotBytes, /"undefined"/u);
  assert.equal(
    first.items[0]!.snapshotHash,
    `sha256:${createHash("sha256").update(snapshotBytes).digest("hex")}`
  );

  product.defaultPrice = Number.POSITIVE_INFINITY;
  await assert.rejects(
    () => service.execute("team-a", "admin-1", "tagged-key"),
    { code: "commission_catalog_migration_conflict" }
  );
});

test("repository returns immutable independent clones", async () => {
  const state = migrationFixture();
  const result = await state.service.execute("team-a", "admin-1", "clone-key");
  const link = await state.repository.findCommissionProductLink("team-a", "cp-1");
  assert.ok(link);
  const first = await state.repository.findPricingPolicyVersion(
    "team-a", link.pricingPolicyVersionId
  );
  const second = await state.repository.findPricingPolicyVersion(
    "team-a", link.pricingPolicyVersionId
  );
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.approvalThresholds), true);
  assert.equal(result.scanned, 1);
});

test("migration CLI rejects every ambiguous argument form before database setup", () => {
  const cli = fileURLToPath(new URL(
    "./migrate-commission-products-to-catalog.ts",
    import.meta.url
  ));
  const cases: ReadonlyArray<readonly [readonly string[], RegExp]> = [
    [["--actor", "admin", "--idempotency", "key"], /missing --workspace/u],
    [["--workspace", "team-a", "--workspace=team-b", "--actor", "admin", "--idempotency", "key"], /duplicate --workspace/u],
    [["--workspace", "team-a", "--actor", "admin", "--idempotency", "key", "--extra", "x"], /unknown argument --extra/u],
    [["--workspace", "team-a", "--actor", "--idempotency", "key"], /flag-looking value for --actor/u],
    [["--workspace=", "--actor", "admin", "--idempotency", "key"], /blank --workspace/u],
    [["--workspace", "all", "--actor", "admin", "--idempotency", "key"], /invalid --workspace/u]
  ];
  for (const [args, expected] of cases) {
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", cli, ...args],
      {
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: "", MYSQL_URL: "" }
      }
    );
    const output = `${child.stdout}${child.stderr}`;
    assert.notEqual(child.status, 0);
    assert.match(output, expected);
    assert.doesNotMatch(output, /requires DATABASE_URL or MYSQL_URL/u);
  }
});

function crossWorkspaceCommit(): CommissionCatalogMigrationCommit {
  const snapshot = ["object", []] as const;
  const snapshotHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(snapshot)).digest("hex")}` as const;
  const item = {
    workspaceId: "team-a", commissionProductId: "cp-1",
    status: "migrated", code: "migrated", snapshot, snapshotHash,
    catalogItemId: "item-1", pricingPolicyVersionId: "policy-1"
  } as const;
  const inputSnapshotHash = `sha256:${createHash("sha256").update(JSON.stringify([
    "commission-catalog-migration-input.v1", "team-a", [snapshot]
  ])).digest("hex")}` as const;
  const reportHash = `sha256:${createHash("sha256").update(JSON.stringify([
    "commission-catalog-migration-report.v1", "team-a",
    [["cp-1", "migrated", "migrated", snapshotHash]]
  ])).digest("hex")}` as const;
  return {
    run: {
      id: "run-1", workspaceId: "team-a", actorId: "admin-1",
      idempotencyKey: "invalid-commit", inputSnapshotHash,
      startedAt: "2026-08-09T08:00:00.000Z",
      completedAt: "2026-08-09T08:00:00.000Z", status: "completed",
      scanned: 1, migrated: 1, repairRequired: 0, reportHash, items: [item]
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
}

test("memory migration commit rejects cross-workspace references before mutation", async () => {
  const repository = new InMemoryCatalogRepository();
  await assert.rejects(
    () => repository.commitCommissionCatalogMigration(crossWorkspaceCommit()),
    { code: "invalid_commission_catalog_migration_commit" }
  );
  assert.equal(await repository.findCatalogItem("team-b", "item-1"), null);
  assert.equal(await repository.findCommissionCatalogMigrationRun(
    "team-a", "invalid-commit"
  ), null);

  const missingEntry = crossWorkspaceCommit();
  missingEntry.entries = [];
  await assert.rejects(
    () => repository.commitCommissionCatalogMigration(missingEntry),
    { code: "invalid_commission_catalog_migration_commit" }
  );
});
