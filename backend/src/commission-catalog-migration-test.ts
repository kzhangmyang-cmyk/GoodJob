import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommissionProduct } from "./types.js";
import { CommissionCatalogMigrationService } from "./commission-catalog-migration.js";
import { InMemoryCatalogRepository } from "./catalog-repository.js";

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
