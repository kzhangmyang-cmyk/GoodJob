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
  type GrowthTemporalTransaction,
  type GrowthTemporalTransactionRunner
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

class FailAfterWorkRunner implements GrowthTemporalTransactionRunner {
  constructor(private readonly inner: GrowthTemporalTransactionRunner) {}

  run<T>(work: (tx: GrowthTemporalTransaction) => Promise<T>): Promise<T> {
    return this.inner.run(async (tx) => {
      await work(tx);
      throw new Error("post_work_commit_failure");
    });
  }
}

class ToggleAfterWorkRunner implements GrowthTemporalTransactionRunner {
  fail = false;
  constructor(private readonly inner: GrowthTemporalTransactionRunner) {}

  run<T>(work: (tx: GrowthTemporalTransaction) => Promise<T>): Promise<T> {
    return this.inner.run(async (tx) => {
      const result = await work(tx);
      if (this.fail) throw new Error("post_work_commit_failure");
      return result;
    });
  }
}

class RacingPostWorkFailureRunner implements GrowthTemporalTransactionRunner {
  private failFirst = true;
  private readonly workCompleteResolve: () => void;
  private readonly releaseFailureResolve: () => void;
  readonly workComplete: Promise<void>;
  private readonly releaseFailurePromise: Promise<void>;

  constructor(private readonly inner: GrowthTemporalTransactionRunner) {
    let complete!: () => void;
    let release!: () => void;
    this.workComplete = new Promise<void>((resolve) => { complete = resolve; });
    this.releaseFailurePromise = new Promise<void>((resolve) => { release = resolve; });
    this.workCompleteResolve = complete;
    this.releaseFailureResolve = release;
  }

  releaseFailure(): void { this.releaseFailureResolve(); }

  async run<T>(work: (tx: GrowthTemporalTransaction) => Promise<T>): Promise<T> {
    if (!this.failFirst) return this.inner.run(work);
    this.failFirst = false;
    await this.inner.run(work);
    this.workCompleteResolve();
    await this.releaseFailurePromise;
    throw new Error("post_work_commit_failure");
  }
}

class GateSecondAllocationBarrier extends ObservingGrowthTemporalBarrier {
  private allocationsSeen = 0;
  private readonly secondAllocationResolve: () => void;
  private readonly returnSecondResolve: () => void;
  readonly secondAllocation: Promise<void>;
  private readonly returnSecond: Promise<void>;

  constructor(transactions: GrowthTemporalTransactionRunner) {
    super(transactions);
    let seen!: () => void;
    let release!: () => void;
    this.secondAllocation = new Promise<void>((resolve) => { seen = resolve; });
    this.returnSecond = new Promise<void>((resolve) => { release = resolve; });
    this.secondAllocationResolve = seen;
    this.returnSecondResolve = release;
  }

  releaseSecondAllocation(): void { this.returnSecondResolve(); }

  override async allocateAppend(tx: GrowthTemporalTransaction, workspaceId: string) {
    const stamp = await super.allocateAppend(tx, workspaceId);
    this.allocationsSeen += 1;
    if (this.allocationsSeen === 2) {
      this.secondAllocationResolve();
      await this.returnSecond;
    }
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

test("concurrent memory CAS loser never restores over the committed winner", async () => {
  const repository = repositoryFixtures()[0]!;
  await repository.appendCatalogItem({
    id: "item-race", workspaceId: "team-a", type: "service", code: "RACE",
    name: "original", description: "", unit: "次", status: "active",
    revision: 1, createdBy: "seed", createdAt: NOW, updatedAt: NOW
  });
  const results = await Promise.all([
    repository.updateCatalogItem({
      workspaceId: "team-a", id: "item-race", expectedRevision: 1,
      patch: { name: "winner-a" }, actorId: "admin-a",
      idempotencyKey: "race-a", requestHash: hash({ name: "winner-a" })
    }),
    repository.updateCatalogItem({
      workspaceId: "team-a", id: "item-race", expectedRevision: 1,
      patch: { name: "winner-b" }, actorId: "admin-b",
      idempotencyKey: "race-b", requestHash: hash({ name: "winner-b" })
    })
  ]);
  assert.equal(results.filter((result) => result.kind === "ok").length, 1);
  assert.equal(
    results.filter((result) => result.kind === "revision_conflict").length,
    1
  );
  const winner = results.find((result) => result.kind === "ok")!;
  const persisted = await repository.findCatalogItem("team-a", "item-race");
  assert.equal(persisted?.revision, 2);
  assert.equal(persisted?.name, winner.value.name);
});

test("post-work failure restores before a queued memory winner can publish", async () => {
  const base = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const transactions = new RacingPostWorkFailureRunner(base);
  const temporalBarrier = new GateSecondAllocationBarrier(base);
  const repository = new InMemoryCatalogRepository({
    transactions,
    temporalBarrier
  });
  await repository.appendCatalogItem({
    id: "item-post-work-race", workspaceId: "team-a", type: "service",
    code: "POST-WORK-RACE", name: "original", description: "", unit: "次",
    status: "active", revision: 1, createdBy: "seed",
    createdAt: NOW, updatedAt: NOW
  });
  const failing = assert.rejects(repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-post-work-race", expectedRevision: 1,
    patch: { name: "must-rollback" }, actorId: "admin-failing",
    idempotencyKey: "post-work-failing",
    requestHash: hash({ name: "must-rollback" })
  }), /post_work_commit_failure/u);
  await transactions.workComplete;
  const winner = repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-post-work-race", expectedRevision: 1,
    patch: { name: "queued-winner" }, actorId: "admin-winner",
    idempotencyKey: "post-work-winner",
    requestHash: hash({ name: "queued-winner" })
  });
  await temporalBarrier.secondAllocation;
  temporalBarrier.releaseSecondAllocation();
  await new Promise<void>((resolve) => setImmediate(resolve));
  transactions.releaseFailure();
  await failing;
  assert.equal((await winner).kind, "ok");
  assert.equal(
    (await repository.findCatalogItem("team-a", "item-post-work-race"))?.name,
    "queued-winner"
  );
  assert.equal(
    (await repository.findCatalogItem("team-a", "item-post-work-race"))?.revision,
    2
  );
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

test("domain receipts scope replay by workspace actor operation and key", async () => {
  for (const repository of repositoryFixtures()) {
    const created = okValue(await repository.createCatalogItem(
      createItemCommand({ idempotencyKey: "shared-key" })
    ));
    const crossOperation = await repository.updateCatalogItem({
      workspaceId: "team-a", id: created.id, expectedRevision: 1,
      patch: { name: "跨操作可用" }, actorId: "admin-1",
      idempotencyKey: "shared-key", requestHash: hash({ name: "跨操作可用" })
    });
    assert.equal(crossOperation.kind, "ok");

    const crossActor = await repository.updateCatalogItem({
      workspaceId: "team-a", id: created.id, expectedRevision: 2,
      patch: { name: "跨操作员可用" }, actorId: "admin-2",
      idempotencyKey: "shared-key", requestHash: hash({ name: "跨操作员可用" })
    });
    assert.equal(crossActor.kind, "ok");

    const sameScopeConflict = await repository.updateCatalogItem({
      workspaceId: "team-a", id: created.id, expectedRevision: 3,
      patch: { name: "同作用域冲突" }, actorId: "admin-2",
      idempotencyKey: "shared-key",
      requestHash: hash({ name: "同作用域冲突", changed: true })
    });
    assert.deepEqual(sameScopeConflict, {
      kind: "state_conflict", code: "idempotency_conflict"
    });
  }
});

test("domain receipt keys preserve Foundation 200-character raw identity", async () => {
  const repository = repositoryFixtures()[0]!;
  const keys = [
    "x".repeat(200), "Case", "case", "caf\u00e9", "cafe\u0301", "trail", "trail "
  ];
  for (const [index, idempotencyKey] of keys.entries()) {
    const result = await repository.createCatalogItem(createItemCommand({
      id: `receipt-key-${index}`, code: `RECEIPT-${index}`,
      actorId: "receipt-actor", idempotencyKey,
      requestHash: hash({ index })
    }));
    assert.equal(result.kind, "ok");
    assert.equal(result.replayed, false);
  }
  const storedScopes = [...(repository as unknown as {
    commandReceipts: Map<string, unknown>;
  }).commandReceipts.keys()];
  assert.equal(storedScopes.length, keys.length);
  assert.equal(storedScopes.some((scope) => keys.some((raw) => scope.includes(raw))), false);
  assert.equal(
    storedScopes.every((scope) => /sha256:[a-f0-9]{64}/u.test(scope)),
    true
  );
  const replay = await repository.createCatalogItem(createItemCommand({
    id: "ignored-replay-id", code: "IGNORED-REPLAY",
    actorId: "receipt-actor", idempotencyKey: "trail ",
    requestHash: hash({ index: 6 })
  }));
  assert.equal(replay.kind, "ok");
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.id, "receipt-key-6");
  await assert.rejects(
    () => repository.createCatalogItem(createItemCommand({
      id: "too-long", code: "TOO-LONG", actorId: "receipt-actor",
      idempotencyKey: "x".repeat(201), requestHash: hash({ tooLong: true })
    })),
    { code: "invalid_catalog_command_identity" }
  );
});

test("a lost HTTP completion replays its stable domain receipt after intervening mutation", async () => {
  for (const repository of repositoryFixtures()) {
    const create = createItemCommand({ idempotencyKey: "lost-completion-create" });
    await repository.createCatalogItem(create);
    await repository.updateCatalogItem({
      workspaceId: "team-a", id: "item-1", expectedRevision: 1,
      patch: { name: "已有后续修改" }, actorId: "admin-1",
      idempotencyKey: "intervening-update",
      requestHash: hash({ name: "已有后续修改" })
    });

    const replay = await repository.createCatalogItem({
      ...create,
      id: "new-id-from-reclaimed-http-execution"
    });

    assert.equal(replay.kind, "ok");
    assert.equal(replay.replayed, true);
    assert.equal(replay.value.id, "item-1");
    assert.equal(replay.value.name, "已有后续修改");
    assert.equal(replay.value.revision, 2);
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

test("package list validates pagination before looking up a missing parent", async () => {
  for (const repository of repositoryFixtures()) {
    await assert.rejects(
      () => repository.listPackageVersions("team-a", "missing", {
        cursor: "malformed", limit: 0, sort: "updatedAt", direction: "desc"
      }),
      (error: unknown) => [
        "invalid_catalog_list_query", "invalid_catalog_cursor"
      ].includes((error as { code?: string }).code ?? "")
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

test("the full persisted policy object is exact and rejects historical source values", async () => {
  const repository = new InMemoryCatalogRepository();
  await repository.appendCatalogItem({
    id: "item-full-closed", workspaceId: "team-a", type: "service",
    code: "SVC-FULL-CLOSED", name: "全闭合规则", description: "", unit: "次",
    status: "active", revision: 1, createdBy: "migration",
    createdAt: NOW, updatedAt: NOW
  });
  const command = createPolicyCommand({
    id: "policy-full-closed", catalogItemId: "item-full-closed"
  });
  const {
    actorId: createdBy,
    idempotencyKey: _idempotencyKey,
    requestHash: _requestHash,
    ...fields
  } = command;
  const base = {
    ...fields, version: 1, status: "retired" as const,
    revision: 1, createdBy, createdAt: NOW
  };

  await assert.rejects(
    () => repository.appendPricingPolicyVersion({
      ...base,
      source: "manual"
    } as never),
    { code: "invalid_pricing_policy_version" }
  );
  await assert.rejects(
    () => repository.appendPricingPolicyVersion({
      ...base,
      unknownTopLevel: true
    } as never),
    { code: "invalid_pricing_policy_version" }
  );
  assert.equal(
    await repository.findPricingPolicyVersion("team-a", "policy-full-closed"),
    null
  );
});

test("persisted policy rejects zero price, 10000 minimum margin, and non-RFC3339 windows", async () => {
  const repository = new InMemoryCatalogRepository();
  const command = createPolicyCommand({ id: "strict-policy" });
  const {
    actorId: createdBy,
    idempotencyKey: _idempotencyKey,
    requestHash: _requestHash,
    ...fields
  } = command;
  const base = {
    ...fields, version: 1, status: "draft" as const,
    revision: 1, createdBy, createdAt: NOW
  };
  for (const invalid of [
    { ...base, listUnitPriceMinor: 0 },
    { ...base, absoluteMinimumGrossMarginBps: 10_000 },
    { ...base, validFrom: "2026-08-09" },
    { ...base, validTo: "2026-08-10" },
    { ...base, validFrom: "2026-02-30T08:00:00.000Z" },
    { ...base, validFrom: new Date(NOW) }
  ]) {
    await assert.rejects(
      () => repository.appendPricingPolicyVersion(invalid as never),
      { code: "invalid_pricing_policy_version" }
    );
  }
  const offset = {
    ...base,
    id: "strict-policy-offset",
    validFrom: "2026-08-09T16:00:00.000+08:00",
    validTo: "2026-08-10T16:00:00.000+08:00"
  };
  assert.equal(
    (await repository.appendPricingPolicyVersion(offset)).id,
    "strict-policy-offset"
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

test("empty component replacement retains one set-level authority stamp", async () => {
  const transactions = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const temporalBarrier = new ObservingGrowthTemporalBarrier(transactions);
  const repository = new InMemoryCatalogRepository({ transactions, temporalBarrier });
  await repository.appendCatalogItem({
    id: "package-empty", workspaceId: "team-a", type: "package",
    code: "PKG-EMPTY", name: "空套餐", description: "", unit: "套",
    status: "active", revision: 1, createdBy: "migration",
    createdAt: NOW, updatedAt: NOW
  });
  await repository.appendPackageVersion({
    id: "package-empty-v1", workspaceId: "team-a",
    packageCatalogItemId: "package-empty", version: 1, currency: "CNY",
    status: "draft", validFrom: NOW, validTo: null, revision: 1,
    createdBy: "migration", createdAt: NOW, updatedAt: NOW
  });

  await repository.replaceDraftPackageComponents("team-a", "package-empty-v1", []);

  assert.equal(temporalBarrier.allocations.length, 1);
  const evidence = (repository as unknown as {
    appendEvidence: Map<string, { recordedAt: string; temporalSequence: number }>;
  }).appendEvidence;
  assert.deepEqual(
    [...evidence.entries()].filter(([entry]) => entry.startsWith("package-component-set")),
    [[
      "package-component-set\u0000team-a\u0000package-empty-v1",
      temporalBarrier.allocations[0]
    ]]
  );
});

test("failed empty component replacement restores components and set evidence", async () => {
  const base = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const transactions = new ToggleAfterWorkRunner(base);
  const temporalBarrier = new ObservingGrowthTemporalBarrier(base);
  const repository = new InMemoryCatalogRepository({ transactions, temporalBarrier });
  await repository.appendPackageVersion({
    id: "package-empty-rollback", workspaceId: "team-a",
    packageCatalogItemId: "package-item-1", version: 1, currency: "CNY",
    status: "draft", validFrom: NOW, validTo: null, revision: 1,
    createdBy: "admin-1", createdAt: NOW, updatedAt: NOW
  });
  const original = [{
    workspaceId: "team-a", packageVersionId: "package-empty-rollback",
    componentCatalogItemId: "item-1",
    componentPricingPolicyVersionId: "policy-1", quantityMicros: 1_000_000
  }] as const;
  await repository.replaceDraftPackageComponents(
    "team-a", "package-empty-rollback", original
  );
  transactions.fail = true;
  await assert.rejects(
    () => repository.replaceDraftPackageComponents(
      "team-a", "package-empty-rollback", []
    ),
    /post_work_commit_failure/u
  );
  assert.deepEqual(
    await repository.listPackageComponents("team-a", "package-empty-rollback"),
    original
  );
  const evidence = (repository as unknown as {
    appendEvidence: Map<string, unknown>;
  }).appendEvidence;
  assert.equal(
    evidence.has("package-component-set\u0000team-a\u0000package-empty-rollback"),
    false
  );
});

test("post-work transaction failure restores every workspace mutation", async () => {
  const base = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const temporalBarrier = new ObservingGrowthTemporalBarrier(base);
  const failing = new FailAfterWorkRunner(base);
  const repository = new InMemoryCatalogRepository({
    transactions: failing,
    temporalBarrier
  });
  await repository.appendCatalogItem({
    id: "item-existing", workspaceId: "team-a", type: "service",
    code: "EXISTING", name: "原名", description: "", unit: "次",
    status: "active", revision: 1, createdBy: "seed",
    createdAt: NOW, updatedAt: NOW
  });
  await repository.appendCatalogItem({
    id: "package-existing", workspaceId: "team-a", type: "package",
    code: "PACKAGE-EXISTING", name: "原套餐", description: "", unit: "套",
    status: "active", revision: 1, createdBy: "seed",
    createdAt: NOW, updatedAt: NOW
  });

  await assert.rejects(
    () => repository.createCatalogItem(createItemCommand({
      id: "item-new", code: "NEW", idempotencyKey: "fail-create"
    })),
    /post_work_commit_failure/u
  );
  await assert.rejects(
    () => repository.updateCatalogItem({
      workspaceId: "team-a", id: "item-existing", expectedRevision: 1,
      patch: { name: "不应提交" }, actorId: "admin-1",
      idempotencyKey: "fail-update", requestHash: hash({ name: "不应提交" })
    }),
    /post_work_commit_failure/u
  );
  await assert.rejects(
    () => repository.createPricingPolicyDraft(createPolicyCommand({
      id: "policy-failed", catalogItemId: "item-existing",
      idempotencyKey: "fail-policy"
    })),
    /post_work_commit_failure/u
  );
  await assert.rejects(
    () => repository.createPackageVersionDraft(createPackageCommand({
      id: "package-version-failed",
      packageCatalogItemId: "package-existing",
      idempotencyKey: "fail-package"
    })),
    /post_work_commit_failure/u
  );

  assert.equal(await repository.findCatalogItem("team-a", "item-new"), null);
  assert.equal(
    (await repository.findCatalogItem("team-a", "item-existing"))?.name,
    "原名"
  );
  assert.equal(
    await repository.findPricingPolicyVersion("team-a", "policy-failed"),
    null
  );
  assert.equal(
    await repository.findPackageVersion("team-a", "package-version-failed"),
    null
  );
  assert.deepEqual(
    await repository.listPackageComponents("team-a", "package-version-failed"),
    []
  );
});
