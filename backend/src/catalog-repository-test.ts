import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  InMemoryCatalogRepository,
  type CatalogCommandResult,
  type CatalogRepository,
  type CreateCatalogItemCommand,
  type CreatePackageVersionDraftCommand,
  type CreatePricingPolicyDraftCommand,
  encodeCatalogCursor
} from "./catalog-repository.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner,
  type GrowthTemporalTransaction
} from "./growth-temporal-barrier.js";

const NOW = "2026-08-09T08:00:00.000Z";

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

class ObservingGrowthTemporalBarrier extends DefaultGrowthTemporalBarrier {
  readonly allocations: Array<{ recordedAt: string; temporalSequence: number }> = [];

  override async allocateAppend(tx: GrowthTemporalTransaction, workspaceId: string) {
    const stamp = await super.allocateAppend(tx, workspaceId);
    this.allocations.push(stamp);
    return stamp;
  }
}

const observedBarriers = new WeakMap<CatalogRepository, ObservingGrowthTemporalBarrier>();

function repositoryFixtures(): readonly CatalogRepository[] {
  const transactions = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const temporalBarrier = new ObservingGrowthTemporalBarrier(transactions);
  const repository = new InMemoryCatalogRepository({ transactions, temporalBarrier });
  observedBarriers.set(repository, temporalBarrier);
  return [repository];
}

function createItemCommand(
  overrides: Partial<CreateCatalogItemCommand> = {}
): CreateCatalogItemCommand {
  const input = {
    workspaceId: "team-a",
    id: "item-1",
    type: "service" as const,
    code: "SVC-001",
    name: "诊断服务",
    description: "获客诊断",
    unit: "次",
    actorId: "admin-1",
    idempotencyKey: "item-create-0001",
    requestHash: hash({ code: "SVC-001" }),
    ...overrides
  };
  return input;
}

const approvalThresholds = Object.freeze({
  discountCapability: "quote.exception.discount.approve" as const,
  marginCapability: "quote.exception.margin.approve" as const,
  paymentTermsCapability: "quote.exception.payment_terms.approve" as const,
  giftCapability: "quote.exception.gift.approve" as const,
  creditCapability: "quote.exception.credit.approve" as const,
  manualCapability: "quote.exception.manual.approve" as const,
  creditRiskThresholdBps: 7_000,
  manualEscalationEnabled: true
});

function createPolicyCommand(
  overrides: Partial<CreatePricingPolicyDraftCommand> = {}
): CreatePricingPolicyDraftCommand {
  return {
    workspaceId: "team-a",
    id: "policy-1",
    catalogItemId: "item-1",
    packageVersionId: null,
    currency: "CNY",
    listUnitPriceMinor: 10_000,
    unitStandardCostMinor: 4_000,
    defaultOrderDeliveryCostMinor: 500,
    defaultOrderSalesCostMinor: 300,
    defaultOrderServiceCostMinor: 200,
    absoluteFloorUnitPriceMinor: 5_000,
    standardDiscountLimitBps: 500,
    absoluteDiscountLimitBps: 1_000,
    targetGrossMarginBps: 5_000,
    absoluteMinimumGrossMarginBps: 2_000,
    standardPaymentTermDays: 30,
    absolutePaymentTermDays: 60,
    approvalThresholds,
    surchargePolicies: [{
      kind: "region", condition: "CN-FJ",
      fixedAmountMinor: 1_000, unitAmountMinor: 0
    }],
    giftPolicies: [],
    validFrom: NOW,
    validTo: null,
    source: "native",
    capabilityRegistryVersion: "growth-capabilities.v1",
    actorId: "admin-1",
    idempotencyKey: "policy-create-0001",
    requestHash: hash({ id: "policy-1" }),
    ...overrides
  };
}

function createPackageCommand(
  overrides: Partial<CreatePackageVersionDraftCommand> = {}
): CreatePackageVersionDraftCommand {
  return {
    workspaceId: "team-a",
    id: "package-version-1",
    packageCatalogItemId: "package-item-1",
    currency: "CNY",
    validFrom: NOW,
    validTo: null,
    components: [{
      componentCatalogItemId: "item-1",
      componentPricingPolicyVersionId: "policy-1",
      quantityMicros: 1_000_000
    }, {
      componentCatalogItemId: "item-2",
      componentPricingPolicyVersionId: "policy-2",
      quantityMicros: 2_000_000
    }],
    actorId: "admin-1",
    idempotencyKey: "package-create-0001",
    requestHash: hash({ id: "package-version-1" }),
    ...overrides
  };
}

function okValue<T>(result: CatalogCommandResult<T>): T {
  assert.equal(result.kind, "ok");
  return result.value;
}

test("memory repository rejects a stale catalog revision", async () => {
  for (const repository of repositoryFixtures()) {
    await repository.createCatalogItem(createItemCommand());
    const first = await repository.updateCatalogItem({
      workspaceId: "team-a", id: "item-1", expectedRevision: 1,
      patch: { name: "新版名称" }, actorId: "admin-1",
      idempotencyKey: "item-update-0001", requestHash: hash({ name: "新版名称" })
    });
    assert.equal(first.kind, "ok");
    const stale = await repository.updateCatalogItem({
      workspaceId: "team-a", id: "item-1", expectedRevision: 1,
      patch: { name: "并发覆盖" }, actorId: "admin-2",
      idempotencyKey: "item-update-0002", requestHash: hash({ name: "并发覆盖" })
    });
    assert.deepEqual(stale, { kind: "revision_conflict", actualRevision: 2 });
  }
});

test("catalog commands replay exact requests and fail closed on key conflicts", async () => {
  for (const repository of repositoryFixtures()) {
    const command = createItemCommand();
    const created = await repository.createCatalogItem(command);
    assert.equal(created.kind, "ok");
    assert.equal(created.replayed, false);
    const replay = await repository.createCatalogItem(command);
    assert.equal(replay.kind, "ok");
    assert.equal(replay.replayed, true);
    const conflict = await repository.createCatalogItem({
      ...command,
      name: "更名不得重放",
      requestHash: hash({ name: "更名不得重放" })
    });
    assert.deepEqual(conflict, {
      kind: "state_conflict", code: "idempotency_conflict"
    });
  }
});

test("catalog reads and commands never cross a workspace boundary", async () => {
  for (const repository of repositoryFixtures()) {
    await repository.createCatalogItem(createItemCommand());
    assert.equal(await repository.findCatalogItem("team-b", "item-1"), null);
    const hidden = await repository.updateCatalogItem({
      workspaceId: "team-b", id: "item-1", expectedRevision: 1,
      patch: { name: "跨租户修改" }, actorId: "admin-2",
      idempotencyKey: "cross-workspace-0001",
      requestHash: hash({ name: "跨租户修改" })
    });
    assert.deepEqual(hidden, { kind: "not_found" });
    const page = await repository.listCatalogItems("team-b", {
      cursor: null, limit: 20, sort: "updatedAt", direction: "desc"
    });
    assert.deepEqual(page, []);
  }
});

test("catalog cursor order is stable and malformed cursors fail closed", async () => {
  for (const repository of repositoryFixtures()) {
    await repository.createCatalogItem(createItemCommand({
      id: "item-b", code: "B", idempotencyKey: "create-b"
    }));
    await repository.createCatalogItem(createItemCommand({
      id: "item-a", code: "A", idempotencyKey: "create-a"
    }));
    const first = await repository.listCatalogItems("team-a", {
      cursor: null, limit: 1, sort: "code", direction: "asc"
    });
    assert.deepEqual(first.map((item) => item.id), ["item-a"]);
    const second = await repository.listCatalogItems("team-a", {
      cursor: encodeCatalogCursor("A", "item-a"),
      limit: 1, sort: "code", direction: "asc"
    });
    assert.deepEqual(second.map((item) => item.id), ["item-b"]);
    await assert.rejects(
      () => repository.listCatalogItems("team-a", {
        cursor: "not-a-cursor", limit: 20, sort: "code", direction: "asc"
      }),
      { code: "invalid_catalog_cursor" }
    );
  }
});

test("policy and package reads are immutable clones", async () => {
  for (const repository of repositoryFixtures()) {
    await repository.createCatalogItem(createItemCommand());
    const policy = okValue(await repository.createPricingPolicyDraft(
      createPolicyCommand()
    ));
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.surchargePolicies), true);
    const firstPolicy = await repository.findPricingPolicyVersion("team-a", "policy-1");
    const secondPolicy = await repository.findPricingPolicyVersion("team-a", "policy-1");
    assert.ok(firstPolicy && secondPolicy);
    assert.notEqual(firstPolicy, secondPolicy);
    assert.notEqual(firstPolicy.surchargePolicies, secondPolicy.surchargePolicies);

    await repository.createCatalogItem(createItemCommand({
      id: "package-item-1", type: "package", code: "PKG-001",
      idempotencyKey: "package-item-create-0001"
    }));
    const packageVersion = okValue(await repository.createPackageVersionDraft(
      createPackageCommand()
    ));
    const firstPackage = await repository.findPackageVersion(
      "team-a", packageVersion.id
    );
    const secondPackage = await repository.findPackageVersion(
      "team-a", packageVersion.id
    );
    assert.ok(firstPackage && secondPackage);
    assert.notEqual(firstPackage, secondPackage);
    assert.equal(Object.isFrozen(firstPackage), true);
  }
});

test("every pricing persistence boundary rejects unknown frozen-rule keys", async () => {
  const repository = new InMemoryCatalogRepository();
  await repository.appendCatalogItem({
    id: "item-closed", workspaceId: "team-a", type: "service",
    code: "SVC-CLOSED", name: "闭合规则", description: "", unit: "次",
    status: "active", revision: 1, createdBy: "migration",
    createdAt: NOW, updatedAt: NOW
  });
  const command = createPolicyCommand({
    id: "policy-closed", catalogItemId: "item-closed"
  });
  const {
    actorId: createdBy,
    idempotencyKey: _idempotencyKey,
    requestHash: _requestHash,
    ...fields
  } = command;
  const invalid = {
    ...fields,
    version: 1,
    status: "draft" as const,
    revision: 1,
    createdBy,
    createdAt: NOW,
    approvalThresholds: {
      ...fields.approvalThresholds,
      unknownCapability: "quote.confirm"
    }
  };

  await assert.rejects(
    () => repository.appendPricingPolicyVersion(invalid),
    { code: "invalid_approval_rule" }
  );
  assert.equal(
    await repository.findPricingPolicyVersion("team-a", "policy-closed"),
    null
  );
});

test("parent-locked versions increment and multi-row commands allocate successive stamps", async () => {
  for (const repository of repositoryFixtures()) {
    const item = okValue(await repository.createCatalogItem(createItemCommand()));
    const first = okValue(await repository.createPricingPolicyDraft(
      createPolicyCommand()
    ));
    const second = okValue(await repository.createPricingPolicyDraft(
      createPolicyCommand({
        id: "policy-2", idempotencyKey: "policy-create-0002",
        requestHash: hash({ id: "policy-2" })
      })
    ));
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.ok(first.createdAt > item.createdAt);

    await repository.createCatalogItem(createItemCommand({
      id: "package-item-1", type: "package", code: "PKG-001",
      idempotencyKey: "package-item-create-0001"
    }));
    const packageVersion = okValue(await repository.createPackageVersionDraft(
      createPackageCommand()
    ));
    const components = await repository.listPackageComponents(
      "team-a", packageVersion.id
    );
    assert.equal(components.length, 2);
    const allocations = observedBarriers.get(repository)!.allocations;
    const packageStamp = allocations.at(-3)!;
    assert.equal(packageVersion.createdAt, packageStamp.recordedAt);
    assert.equal(allocations.at(-2)!.temporalSequence, packageStamp.temporalSequence + 1);
    assert.equal(
      allocations.at(-1)!.temporalSequence,
      allocations.at(-2)!.temporalSequence + 1
    );
    assert.ok(components.every((component) => Object.isFrozen(component)));
  }
});

test("policy, package, and item lifecycle commands enforce revisions and terminal states", async () => {
  for (const repository of repositoryFixtures()) {
    await repository.createCatalogItem(createItemCommand());
    const draftPolicy = okValue(await repository.createPricingPolicyDraft(
      createPolicyCommand()
    ));
    const activePolicy = okValue(await repository.activatePricingPolicy({
      workspaceId: "team-a", id: draftPolicy.id, expectedRevision: 1,
      actorId: "admin-1", idempotencyKey: "policy-activate-1",
      requestHash: hash({ status: "active" }),
      validate: async (view, locked) => {
        assert.equal(locked.status, "draft");
        assert.equal((await view.findCatalogItem("team-a", "item-1"))?.id, "item-1");
      }
    }));
    assert.equal(activePolicy.status, "active");
    assert.equal(activePolicy.revision, 2);
    const retiredPolicy = okValue(await repository.retirePricingPolicy({
      workspaceId: "team-a", id: draftPolicy.id, expectedRevision: 2,
      actorId: "admin-1", idempotencyKey: "policy-retire-1",
      requestHash: hash({ status: "retired" })
    }));
    assert.equal(retiredPolicy.status, "retired");
    assert.equal(retiredPolicy.revision, 3);

    await repository.createCatalogItem(createItemCommand({
      id: "package-item-1", type: "package", code: "PKG-001",
      idempotencyKey: "package-item-create-0001"
    }));
    const draftPackage = okValue(await repository.createPackageVersionDraft(
      createPackageCommand({ components: [] })
    ));
    const updatedPackage = okValue(await repository.updatePackageVersionDraft({
      workspaceId: "team-a", id: draftPackage.id, expectedRevision: 1,
      patch: { validTo: "2026-09-01T00:00:00.000Z", components: [] },
      actorId: "admin-1", idempotencyKey: "package-update-1",
      requestHash: hash({ validTo: "2026-09-01T00:00:00.000Z" })
    }));
    assert.equal(updatedPackage.revision, 2);
    const activePackage = okValue(await repository.activatePackageVersion({
      workspaceId: "team-a", id: draftPackage.id, expectedRevision: 2,
      actorId: "admin-1", idempotencyKey: "package-activate-1",
      requestHash: hash({ status: "active" })
    }));
    assert.equal(activePackage.status, "active");
    const immutable = await repository.updatePackageVersionDraft({
      workspaceId: "team-a", id: draftPackage.id, expectedRevision: 3,
      patch: { currency: "USD" }, actorId: "admin-1",
      idempotencyKey: "package-update-after-active",
      requestHash: hash({ currency: "USD" })
    });
    assert.deepEqual(immutable, {
      kind: "state_conflict", code: "package_version_immutable"
    });
    const retiredPackage = okValue(await repository.retirePackageVersion({
      workspaceId: "team-a", id: draftPackage.id, expectedRevision: 3,
      actorId: "admin-1", idempotencyKey: "package-retire-1",
      requestHash: hash({ status: "retired" })
    }));
    assert.equal(retiredPackage.status, "retired");

    const retiredItem = okValue(await repository.retireCatalogItem({
      workspaceId: "team-a", id: "item-1", expectedRevision: 1,
      actorId: "admin-1", idempotencyKey: "item-retire-1",
      requestHash: hash({ status: "retired" })
    }));
    assert.equal(retiredItem.status, "retired");
    assert.equal(retiredItem.revision, 2);
  }
});

test("legacy draft-component replacement still uses the Foundation barrier first", async () => {
  const transactions = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const temporalBarrier = new ObservingGrowthTemporalBarrier(transactions);
  const repository = new InMemoryCatalogRepository({ transactions, temporalBarrier });
  await repository.appendCatalogItem({
    id: "package-item-legacy", workspaceId: "team-a", type: "package",
    code: "PKG-LEGACY", name: "旧套餐", description: "", unit: "套",
    status: "active", revision: 1, createdBy: "migration",
    createdAt: NOW, updatedAt: NOW
  });
  await repository.appendPackageVersion({
    id: "package-version-legacy", workspaceId: "team-a",
    packageCatalogItemId: "package-item-legacy", version: 1, currency: "CNY",
    status: "draft", validFrom: NOW, validTo: null, revision: 1,
    createdBy: "migration", createdAt: NOW, updatedAt: NOW
  });

  const replaced = await repository.replaceDraftPackageComponents(
    "team-a",
    "package-version-legacy",
    [{
      workspaceId: "team-a",
      packageVersionId: "package-version-legacy",
      componentCatalogItemId: "component-1",
      componentPricingPolicyVersionId: "policy-1",
      quantityMicros: 1_000_000
    }, {
      workspaceId: "team-a",
      packageVersionId: "package-version-legacy",
      componentCatalogItemId: "component-2",
      componentPricingPolicyVersionId: "policy-2",
      quantityMicros: 1_000_000
    }]
  );

  assert.deepEqual(temporalBarrier.allocations, [{
    recordedAt: "2026-08-09T08:00:00.000Z", temporalSequence: 1
  }, {
    recordedAt: "2026-08-09T08:00:00.001Z", temporalSequence: 2
  }]);
  assert.deepEqual(Object.keys(replaced[0]!).sort(), [
    "componentCatalogItemId", "componentPricingPolicyVersionId",
    "packageVersionId", "quantityMicros", "workspaceId"
  ]);
});
