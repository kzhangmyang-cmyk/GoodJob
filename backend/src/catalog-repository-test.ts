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

class PausingAfterWorkRunner implements GrowthTemporalTransactionRunner {
  private readonly workCompleteResolve: () => void;
  private readonly releaseResolve: () => void;
  readonly workComplete: Promise<void>;
  private readonly releasePromise: Promise<void>;

  constructor(
    private readonly inner: GrowthTemporalTransactionRunner,
    private readonly rejectAfterWork: boolean
  ) {
    let complete!: () => void;
    let release!: () => void;
    this.workComplete = new Promise<void>((resolve) => { complete = resolve; });
    this.releasePromise = new Promise<void>((resolve) => { release = resolve; });
    this.workCompleteResolve = complete;
    this.releaseResolve = release;
  }

  release(): void { this.releaseResolve(); }

  async run<T>(work: (tx: GrowthTemporalTransaction) => Promise<T>): Promise<T> {
    const result = await this.inner.run(work);
    this.workCompleteResolve();
    await this.releasePromise;
    if (this.rejectAfterWork) throw new Error("post_work_commit_failure");
    return result;
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

test("every public memory read waits for rollback before observing live maps", async () => {
  const base = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const transactions = new PausingAfterWorkRunner(base, true);
  const repository = new InMemoryCatalogRepository({
    transactions,
    temporalBarrier: new ObservingGrowthTemporalBarrier(base)
  });
  await repository.appendCatalogItem({
    id: "item-read-fence", workspaceId: "team-a", type: "service",
    code: "READ-FENCE", name: "committed", description: "", unit: "次",
    status: "active", revision: 1, createdBy: "seed",
    createdAt: NOW, updatedAt: NOW
  });
  const failing = assert.rejects(repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-read-fence", expectedRevision: 1,
    patch: { name: "uncommitted" }, actorId: "admin-failing",
    idempotencyKey: "read-fence-failure",
    requestHash: hash({ name: "uncommitted" })
  }), /post_work_commit_failure/u);
  await transactions.workComplete;

  let settled = 0;
  const reads = [
    repository.findCatalogItem("team-a", "item-read-fence"),
    repository.listCatalogItems("team-a", {
      cursor: null, limit: 20, sort: "updatedAt", direction: "desc"
    }),
    repository.findPricingPolicyVersion("team-a", "missing-policy"),
    repository.listPricingPolicies("team-a", {
      cursor: null, limit: 20, sort: "updatedAt", direction: "desc"
    }),
    repository.findPackageVersion("team-a", "missing-package"),
    repository.listPackageVersions("team-a", "item-read-fence", {
      cursor: null, limit: 20, sort: "updatedAt", direction: "desc"
    }),
    repository.listPackageComponents("team-a", "missing-package"),
    repository.findCommissionProductLink("team-a", "missing-product"),
    repository.findCommissionCatalogMigrationRun("team-a", "missing-run")
  ].map(async (read) => {
    const value = await read;
    settled += 1;
    return value;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, 0);

  transactions.release();
  await failing;
  const values = await Promise.all(reads);
  assert.equal((values[0] as { revision: number; name: string }).revision, 1);
  assert.equal((values[0] as { revision: number; name: string }).name, "committed");
  assert.equal((values[1] as readonly { revision: number }[])[0]?.revision, 1);
});

test("a successful memory commit releases pending reads to revision two", async () => {
  const base = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const transactions = new PausingAfterWorkRunner(base, false);
  const repository = new InMemoryCatalogRepository({
    transactions,
    temporalBarrier: new ObservingGrowthTemporalBarrier(base)
  });
  await repository.appendCatalogItem({
    id: "item-read-success", workspaceId: "team-a", type: "service",
    code: "READ-SUCCESS", name: "revision-one", description: "", unit: "次",
    status: "active", revision: 1, createdBy: "seed",
    createdAt: NOW, updatedAt: NOW
  });
  const update = repository.updateCatalogItem({
    workspaceId: "team-a", id: "item-read-success", expectedRevision: 1,
    patch: { name: "revision-two" }, actorId: "admin-success",
    idempotencyKey: "read-fence-success",
    requestHash: hash({ name: "revision-two" })
  });
  await transactions.workComplete;
  let settled = false;
  const read = repository.findCatalogItem("team-a", "item-read-success")
    .then((value) => { settled = true; return value; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  transactions.release();
  assert.equal((await update).kind, "ok");
  assert.equal((await read)?.revision, 2);
  assert.equal((await repository.findCatalogItem(
    "team-a", "item-read-success"
  ))?.name, "revision-two");
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

test("memory append boundaries store and return canonical UTC catalog instants", async () => {
  const repository = new InMemoryCatalogRepository();
  const offsetStart = "2026-08-09T16:00:00.123+08:00";
  const offsetEnd = "2026-08-10T17:00:00.456+08:00";
  const item = await repository.appendCatalogItem({
    id: "offset-item", workspaceId: "team-a", type: "service", code: "OFFSET",
    name: "offset", description: "", unit: "次", status: "active", revision: 1,
    createdBy: "seed", createdAt: offsetStart, updatedAt: offsetEnd
  });
  assert.equal(item.createdAt, "2026-08-09T08:00:00.123Z");
  assert.equal(item.updatedAt, "2026-08-10T09:00:00.456Z");
  assert.equal(
    (await repository.findCatalogItem("team-a", item.id))?.createdAt,
    "2026-08-09T08:00:00.123Z"
  );

  const policyCommand = createPolicyCommand({
    id: "offset-policy", catalogItemId: item.id,
    validFrom: offsetStart, validTo: offsetEnd
  });
  const {
    actorId: createdBy,
    idempotencyKey: _idempotencyKey,
    requestHash: _requestHash,
    ...policyFields
  } = policyCommand;
  const policy = await repository.appendPricingPolicyVersion({
    ...policyFields, version: 1, status: "draft", revision: 1,
    createdBy, createdAt: offsetStart
  });
  assert.equal(policy.validFrom, "2026-08-09T08:00:00.123Z");
  assert.equal(policy.validTo, "2026-08-10T09:00:00.456Z");
  assert.equal(policy.createdAt, "2026-08-09T08:00:00.123Z");
  assert.equal(
    (await repository.listPricingPolicies("team-a", {
      cursor: null, limit: 20, sort: "updatedAt", direction: "desc"
    }))[0]?.validFrom,
    "2026-08-09T08:00:00.123Z"
  );

  const version = await repository.appendPackageVersion({
    id: "offset-package", workspaceId: "team-a",
    packageCatalogItemId: item.id, version: 1, currency: "CNY",
    status: "draft", validFrom: offsetStart, validTo: offsetEnd, revision: 1,
    createdBy: "seed", createdAt: offsetStart, updatedAt: offsetEnd
  });
  assert.equal(version.validFrom, "2026-08-09T08:00:00.123Z");
  assert.equal(version.validTo, "2026-08-10T09:00:00.456Z");
  assert.equal(version.createdAt, "2026-08-09T08:00:00.123Z");
  assert.equal(version.updatedAt, "2026-08-10T09:00:00.456Z");
  assert.equal(
    (await repository.findPackageVersion("team-a", version.id))?.validFrom,
    "2026-08-09T08:00:00.123Z"
  );
});

test("memory command results reads and receipt replays share canonical UTC bytes", async () => {
  const offsetNow = "2026-08-09T16:00:00.000+08:00";
  const base = new InMemoryGrowthTemporalTransactionRunner(offsetNow);
  const repository = new InMemoryCatalogRepository({
    transactions: base,
    temporalBarrier: new ObservingGrowthTemporalBarrier(base)
  });
  const itemCommand = createItemCommand({ id: "offset-command-item", code: "OFFSET-CMD" });
  const item = okValue(await repository.createCatalogItem(itemCommand));
  assert.equal(item.createdAt, "2026-08-09T08:00:00.000Z");
  const updatedItem = okValue(await repository.updateCatalogItem({
    workspaceId: "team-a", id: item.id, expectedRevision: 1,
    patch: { name: "offset-updated" }, actorId: "admin-1",
    idempotencyKey: "offset-item-update",
    requestHash: hash({ name: "offset-updated" })
  }));
  assert.equal(updatedItem.updatedAt, "2026-08-09T08:00:00.001Z");

  const policyCommand = createPolicyCommand({
    id: "offset-command-policy", catalogItemId: item.id,
    validFrom: "2026-08-10T16:00:00.123+08:00",
    validTo: "2026-08-11T17:00:00.456+08:00",
    idempotencyKey: "offset-policy-create"
  });
  const policy = okValue(await repository.createPricingPolicyDraft(policyCommand));
  assert.equal(policy.validFrom, "2026-08-10T08:00:00.123Z");
  assert.equal(policy.validTo, "2026-08-11T09:00:00.456Z");
  const policyReplay = await repository.createPricingPolicyDraft(policyCommand);
  assert.equal(policyReplay.kind, "ok");
  assert.equal(policyReplay.replayed, true);
  assert.equal(policyReplay.value.validFrom, "2026-08-10T08:00:00.123Z");
  assert.equal(
    (await repository.findPricingPolicyVersion("team-a", policy.id))?.validTo,
    "2026-08-11T09:00:00.456Z"
  );

  await repository.createCatalogItem(createItemCommand({
    id: "offset-package-item", type: "package", code: "OFFSET-PKG",
    idempotencyKey: "offset-package-item-create"
  }));
  const packageCommand = createPackageCommand({
    id: "offset-command-package", packageCatalogItemId: "offset-package-item",
    validFrom: "2026-08-12T16:00:00.123+08:00",
    validTo: "2026-08-13T17:00:00.456+08:00", components: [],
    idempotencyKey: "offset-package-create"
  });
  const version = okValue(await repository.createPackageVersionDraft(packageCommand));
  assert.equal(version.validFrom, "2026-08-12T08:00:00.123Z");
  assert.equal(version.validTo, "2026-08-13T09:00:00.456Z");
  const createReplay = await repository.createPackageVersionDraft(packageCommand);
  assert.equal(createReplay.kind, "ok");
  assert.equal(createReplay.replayed, true);
  assert.equal(createReplay.value.validFrom, "2026-08-12T08:00:00.123Z");

  const updateCommand = {
    workspaceId: "team-a", id: version.id, expectedRevision: 1,
    patch: {
      validFrom: "2026-08-14T16:00:00.123+08:00",
      validTo: "2026-08-15T17:00:00.456+08:00"
    },
    actorId: "admin-1", idempotencyKey: "offset-package-update",
    requestHash: hash({ offset: "package-update" })
  } as const;
  const updated = okValue(await repository.updatePackageVersionDraft(updateCommand));
  assert.equal(updated.validFrom, "2026-08-14T08:00:00.123Z");
  assert.equal(updated.validTo, "2026-08-15T09:00:00.456Z");
  const updateReplay = await repository.updatePackageVersionDraft(updateCommand);
  assert.equal(updateReplay.kind, "ok");
  assert.equal(updateReplay.replayed, true);
  assert.equal(updateReplay.value.validFrom, "2026-08-14T08:00:00.123Z");
  assert.equal(
    (await repository.listPackageVersions("team-a", "offset-package-item", {
      cursor: null, limit: 20, sort: "updatedAt", direction: "desc"
    }))[0]?.validTo,
    "2026-08-15T09:00:00.456Z"
  );
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
