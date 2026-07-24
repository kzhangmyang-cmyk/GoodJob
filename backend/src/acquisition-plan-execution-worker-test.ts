import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AcquisitionPlanExecutionWorker,
  AcquisitionShardProcessorRegistry,
  type AcquisitionShardWorkerFailure,
  type AcquisitionShardProcessorPort
} from "./acquisition-plan-execution-worker.js";
import {
  AcquisitionPlanRunService,
  type AcquisitionExecutionPort,
  type AcquisitionPlanDraftInput,
  type AcquisitionScope
} from "./acquisition-plan-run-service.js";
import {
  InMemoryAcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";

const scope: AcquisitionScope = {
  ownerId: "owner-worker",
  teamId: "team-worker",
  actorId: "planner"
};

function planInput(): AcquisitionPlanDraftInput {
  return {
    name: "公开来源 worker 测试计划",
    objective: "只搜索公开来源并持久化可核验证据",
    icp: {
      industries: ["企业服务"],
      regions: ["中国大陆"],
      organizationCriteria: ["公开采购信号"],
      individualCriteria: ["公开表达需求"],
      exclusionRules: ["拒绝营销"]
    },
    subjectChannels: {
      organization: true,
      individual: true
    },
    providerConnections: [{
      connectionId: "search-connection",
      providerId: "official-search",
      kind: "search",
      status: "active",
      credentialVersion: 1
    }],
    operations: [
      {
        operationId: "organization-search",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "search-connection",
        query: "企业公开采购需求",
        allocatedBudget: {
          requests: 2,
          results: 10,
          amountMinor: 100,
          durationSeconds: 60
        }
      },
      {
        operationId: "individual-search",
        subjectChannel: "individual",
        kind: "search",
        connectionId: "search-connection",
        query: "个人公开业务需求",
        allocatedBudget: {
          requests: 2,
          results: 10,
          amountMinor: 100,
          durationSeconds: 60
        }
      }
    ],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 4,
      maxResults: 20,
      maxAmountMinor: 200,
      maxDurationSeconds: 120
    },
    modelSnapshotRef: {
      jobSnapshotId: "snapshot-worker",
      connectionId: "model-connection",
      credentialVersion: 1,
      provider: "test-model",
      model: "test-model-v1",
      capabilitySnapshotHash: "sha256:capability",
      promptVersion: "worker-prompt.v1",
      schemaVersion: "acquisition-plan.v1",
      promptHash: "sha256:prompt",
      schemaHash: "sha256:schema"
    },
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    }
  };
}

function createHarness(
  processor: AcquisitionShardProcessorPort,
  maxConcurrency = 1,
  onError?: (failure: AcquisitionShardWorkerFailure) => void
) {
  const repository = new InMemoryAcquisitionPlanRunRepository();
  const worker = new AcquisitionPlanExecutionWorker({
    repository,
    processorRegistry: new AcquisitionShardProcessorRegistry({
      search: processor
    }),
    maxConcurrency,
    workerActorId: "acquisition-worker",
    onError
  });
  let sequence = 0;
  const service = new AcquisitionPlanRunService({
    repository,
    executionPort: worker,
    now: () =>
      new Date(Date.UTC(2026, 6, 24, 8, 0, sequence++)).toISOString(),
    idFactory: (prefix) => `${prefix}_${++sequence}`
  });
  worker.attachService(service);
  return { repository, service, worker };
}

async function createApprovedRun(
  service: AcquisitionPlanRunService,
  input = planInput()
) {
  const draft = await service.createPlan(scope, input);
  const approved = await service.approvePlan(
    scope,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准测试执行" }
  );
  return service.createRun(scope, approved.id, {
    idempotencyKey: "worker-run-idempotency-0001"
  });
}

test("enqueue asynchronously settles queued shards through the public run service", async () => {
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      return {
        status: "succeeded",
        evidenceCount: 2,
        usage: {
          requests: 1,
          results: 2,
          amountMinor: 10,
          durationSeconds: 1
        }
      };
    }
  };
  const { repository, service, worker } = createHarness(processor);

  const created = await createApprovedRun(service);
  assert.equal(created.status, "queued", "enqueue must not execute inline");

  await worker.waitForIdle();

  const settled = await service.getRun(scope, created.id);
  assert.equal(settled.status, "succeeded");
  assert.equal(settled.evidenceCount, 4);
  assert.deepEqual(settled.consumedBudget, {
    requests: 2,
    results: 4,
    amountMinor: 20,
    durationSeconds: 2
  });

  for (const shard of await repository.listRunShards(created.id)) {
    assert.equal(shard.status, "succeeded");
    assert.equal(shard.evidenceCount, 2);
    assert.deepEqual(
      (await repository.listRunEvents(created.id))
        .filter((event) => event.shardId === shard.id)
        .map((event) => event.type)
        .filter((type) => [
          "shard.started",
          "shard.budget_consumed",
          "shard.succeeded"
        ].includes(type)),
      [
        "shard.started",
        "shard.budget_consumed",
        "shard.succeeded"
      ]
    );
  }

  await worker.close();
});

test("a completed search with no accepted evidence settles as succeeded_empty", async () => {
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      return {
        status: "succeeded_empty",
        evidenceCount: 0,
        usage: {
          requests: 1,
          results: 0,
          amountMinor: 0,
          durationSeconds: 1
        }
      };
    }
  };
  const { repository, service, worker } = createHarness(processor);

  const created = await createApprovedRun(service);
  await worker.waitForIdle();

  const settled = await service.getRun(scope, created.id);
  assert.equal(settled.status, "succeeded_empty");
  assert.equal(settled.evidenceCount, 0);
  assert.ok(
    (await repository.listRunShards(created.id))
      .every((shard) => shard.status === "succeeded_empty")
  );

  await worker.close();
});

test("a controlled failed result accounts usage before settling the shard", async () => {
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      return {
        status: "failed",
        evidenceCount: 0,
        usage: {
          requests: 1,
          results: 0,
          amountMinor: 5,
          durationSeconds: 2
        }
      };
    }
  };
  const { service, worker } = createHarness(processor);

  const created = await createApprovedRun(service);
  await worker.waitForIdle();

  const settled = await service.getRun(scope, created.id);
  assert.equal(settled.status, "failed");
  assert.deepEqual(settled.consumedBudget, {
    requests: 2,
    results: 0,
    amountMinor: 10,
    durationSeconds: 4
  });

  await worker.close();
});

test("partial_success remains a first-class processor outcome", async () => {
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      return {
        status: "partial_success",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const { repository, service, worker } = createHarness(processor);

  const created = await createApprovedRun(service);
  await worker.waitForIdle();

  const settled = await service.getRun(scope, created.id);
  assert.equal(settled.status, "partial_success");
  assert.ok(
    (await repository.listRunShards(created.id))
      .every((shard) => shard.status === "partial_success")
  );
  assert.equal(settled.evidenceCount, 2);
  await worker.close();
});

test("configured concurrency is used without exceeding the shard limit", async () => {
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fallback = setTimeout(release, 100);
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 2) {
        clearTimeout(fallback);
        release();
      }
      await bothStarted;
      active -= 1;
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const { service, worker } = createHarness(processor, 2);

  await createApprovedRun(service);
  await worker.waitForIdle();

  assert.equal(peak, 2);
  await worker.close();
});

test("the first accepted dispatchKey owns the shard set for the process lifetime", async () => {
  const repository = new InMemoryAcquisitionPlanRunRepository();
  const noOpExecutionPort: AcquisitionExecutionPort = {
    async enqueue() {},
    async requestPause() {},
    async resume() {},
    async requestCancel() {}
  };
  let sequence = 0;
  const service = new AcquisitionPlanRunService({
    repository,
    executionPort: noOpExecutionPort,
    now: () =>
      new Date(Date.UTC(2026, 6, 24, 9, 0, sequence++)).toISOString(),
    idFactory: (prefix) => `${prefix}_dedupe_${++sequence}`
  });
  let processed = 0;
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      processed += 1;
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const worker = new AcquisitionPlanExecutionWorker({
    repository,
    processorRegistry: new AcquisitionShardProcessorRegistry({
      search: processor
    })
  }).attachService(service);
  const run = await createApprovedRun(service);
  const [first, second] = await repository.listRunShards(run.id);
  assert.ok(first);
  assert.ok(second);

  await worker.enqueue({
    runId: run.id,
    shardIds: [first.id],
    dispatchKey: "same-dispatch-key"
  });
  await worker.enqueue({
    runId: run.id,
    shardIds: [second.id],
    dispatchKey: "same-dispatch-key"
  });
  await worker.waitForIdle();

  const shards = await repository.listRunShards(run.id);
  assert.equal(
    shards.find((shard) => shard.id === first.id)?.status,
    "succeeded"
  );
  assert.equal(
    shards.find((shard) => shard.id === second.id)?.status,
    "queued"
  );
  assert.equal(processed, 1);
  await worker.close();
});

test("pause aborts the active processor, acknowledges the safe point, and resume requeues paused shards", async () => {
  let attempts = 0;
  const failures: AcquisitionShardWorkerFailure[] = [];
  const processor: AcquisitionShardProcessorPort = {
    async process({ signal }) {
      attempts += 1;
      if (attempts === 1) {
        await new Promise<void>((_resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("processor was not aborted")),
            100
          );
          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new DOMException("paused", "AbortError"));
          }, { once: true });
        });
      }
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const { service, worker } = createHarness(
    processor,
    1,
    (failure) => failures.push(failure)
  );
  const created = await createApprovedRun(service);
  while (attempts === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  let run = await service.getRun(scope, created.id);
  run = await service.pauseRun(scope, run.id, run.etag, {
    reason: "人工检查公开证据"
  });
  assert.equal(run.status, "pause_requested");
  await worker.waitForIdle();

  run = await service.getRun(scope, run.id);
  assert.equal(run.status, "paused");
  run = await service.resumeRun(scope, run.id, run.etag, {
    reason: "人工确认继续"
  });
  assert.equal(run.status, "queued");
  await worker.waitForIdle();

  run = await service.getRun(scope, run.id);
  assert.equal(run.status, "succeeded");
  assert.equal(attempts, 3);
  assert.deepEqual(run.consumedBudget, {
    requests: 2,
    results: 2,
    amountMinor: 2,
    durationSeconds: 2
  });
  assert.deepEqual(failures, []);
  await worker.close();
});

test("budget accounting stays idempotent when pause lands after consumption but before completion", async () => {
  const repository = new InMemoryAcquisitionPlanRunRepository();
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const worker = new AcquisitionPlanExecutionWorker({
    repository,
    processorRegistry: new AcquisitionShardProcessorRegistry({
      search: processor
    }),
    maxConcurrency: 1
  });
  let service!: AcquisitionPlanRunService;
  let pauseInjected = false;
  const serviceProxy = {
    async startShard(
      ...args: Parameters<AcquisitionPlanRunService["startShard"]>
    ) {
      return service.startShard(...args);
    },
    async consumeShardBudget(
      ...args: Parameters<AcquisitionPlanRunService["consumeShardBudget"]>
    ) {
      const result = await service.consumeShardBudget(...args);
      if (!pauseInjected) {
        pauseInjected = true;
        const [workerScope, runId] = args;
        const latest = await service.getRun(workerScope, runId);
        await service.pauseRun(
          workerScope,
          runId,
          latest.etag,
          { reason: "测试预算入账后的安全点" }
        );
      }
      return result;
    },
    async completeShard(
      ...args: Parameters<AcquisitionPlanRunService["completeShard"]>
    ) {
      return service.completeShard(...args);
    },
    async acknowledgeShardPaused(
      ...args: Parameters<
        AcquisitionPlanRunService["acknowledgeShardPaused"]
      >
    ) {
      return service.acknowledgeShardPaused(...args);
    },
    async acknowledgeShardCancelled(
      ...args: Parameters<
        AcquisitionPlanRunService["acknowledgeShardCancelled"]
      >
    ) {
      return service.acknowledgeShardCancelled(...args);
    }
  } as unknown as AcquisitionPlanRunService;
  let sequence = 0;
  service = new AcquisitionPlanRunService({
    repository,
    executionPort: worker,
    now: () =>
      new Date(Date.UTC(2026, 6, 24, 10, 0, sequence++)).toISOString(),
    idFactory: (prefix) => `${prefix}_budget_pause_${++sequence}`
  });
  worker.attachService(serviceProxy);
  const created = await createApprovedRun(service);
  await worker.waitForIdle();

  let paused = await service.getRun(scope, created.id);
  assert.equal(paused.status, "paused");
  paused = await service.resumeRun(scope, paused.id, paused.etag, {
    reason: "继续同一幂等处理结果"
  });
  assert.equal(paused.status, "queued");
  await worker.waitForIdle();

  const settled = await service.getRun(scope, created.id);
  assert.equal(settled.status, "succeeded");
  assert.deepEqual(settled.consumedBudget, {
    requests: 2,
    results: 2,
    amountMinor: 2,
    durationSeconds: 2
  });
  assert.deepEqual(
    (await repository.listRunShards(created.id))
      .map((shard) => shard.consumedBudget.requests),
    [1, 1]
  );
  await worker.close();
});

test("cancel aborts and acknowledges the active shard while queued work never starts", async () => {
  let attempts = 0;
  let aborted = false;
  const processor: AcquisitionShardProcessorPort = {
    async process({ signal }) {
      attempts += 1;
      await new Promise<void>((_resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("processor was not cancelled")),
          100
        );
        signal.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(timeout);
          reject(new DOMException("cancelled", "AbortError"));
        }, { once: true });
      });
      throw new Error("unreachable");
    }
  };
  const { repository, service, worker } = createHarness(processor);
  const created = await createApprovedRun(service);
  while (attempts === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  let run = await service.getRun(scope, created.id);
  run = await service.cancelRun(scope, run.id, run.etag, {
    reason: "用户明确取消"
  });
  assert.equal(run.status, "cancel_requested");
  await worker.waitForIdle();

  run = await service.getRun(scope, run.id);
  assert.equal(run.status, "cancelled");
  assert.equal(aborted, true);
  assert.equal(attempts, 1);
  assert.deepEqual(run.consumedBudget, {
    requests: 0,
    results: 0,
    amountMinor: 0,
    durationSeconds: 0
  });
  assert.ok(
    (await repository.listRunShards(run.id))
      .every((shard) => shard.status === "cancelled")
  );
  await worker.close();
});

test("one processor exception is isolated and the next shard still completes", async () => {
  const failures: AcquisitionShardWorkerFailure[] = [];
  const processor: AcquisitionShardProcessorPort = {
    async process({ shard }) {
      if (shard.subjectChannel === "organization") {
        throw new Error("private provider detail must not escape");
      }
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const { repository, service, worker } = createHarness(
    processor,
    1,
    (failure) => failures.push(failure)
  );
  const created = await createApprovedRun(service);

  await worker.waitForIdle();

  const run = await service.getRun(scope, created.id);
  assert.equal(run.status, "partial_success");
  assert.deepEqual(
    (await repository.listRunShards(run.id)).map((shard) => shard.status),
    ["failed", "succeeded"]
  );
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0], {
    code: "SHARD_PROCESSING_FAILED",
    phase: "process",
    runId: run.id,
    shardId: (await repository.listRunShards(run.id))[0]?.id,
    operationKind: "search",
    errorName: "Error"
  });
  assert.equal(JSON.stringify(failures).includes("private provider detail"), false);
  await worker.close();
});

test("shard budget overflow stays terminal without being misreported as a completion error", async () => {
  const failures: AcquisitionShardWorkerFailure[] = [];
  const processor: AcquisitionShardProcessorPort = {
    async process({ shard }) {
      const organization = shard.subjectChannel === "organization";
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: organization ? 3 : 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const { repository, service, worker } = createHarness(
    processor,
    1,
    (failure) => failures.push(failure)
  );
  const created = await createApprovedRun(service);

  await worker.waitForIdle();

  const run = await service.getRun(scope, created.id);
  const shards = await repository.listRunShards(run.id);
  assert.equal(run.status, "partial_success");
  assert.equal(
    shards.find((shard) => shard.subjectChannel === "organization")?.status,
    "budget_exhausted"
  );
  assert.equal(
    shards.find((shard) => shard.subjectChannel === "individual")?.status,
    "succeeded"
  );
  assert.deepEqual(run.consumedBudget, {
    requests: 1,
    results: 1,
    amountMinor: 1,
    durationSeconds: 1
  });
  assert.deepEqual(failures, []);
  await worker.close();
});

test("unregistered content_fetch and import_rows processors fail explicitly instead of pretending success", async () => {
  const input = planInput();
  input.providerConnections.push(
    {
      connectionId: "fetch-connection",
      providerId: "official-fetch",
      kind: "content_fetch",
      status: "active",
      credentialVersion: 1
    },
    {
      connectionId: "import-connection",
      providerId: "authorized-import",
      kind: "import",
      status: "active",
      credentialVersion: 1
    }
  );
  input.operations.push(
    {
      operationId: "organization-fetch",
      subjectChannel: "organization",
      kind: "content_fetch",
      connectionId: "fetch-connection",
      sourceRef: "https://example.test/public-source",
      allocatedBudget: {
        requests: 1,
        results: 1,
        amountMinor: 10,
        durationSeconds: 10
      }
    },
    {
      operationId: "individual-import",
      subjectChannel: "individual",
      kind: "import_rows",
      connectionId: "import-connection",
      sourceRef: "upload://authorized-public-rows.csv",
      allocatedBudget: {
        requests: 1,
        results: 1,
        amountMinor: 10,
        durationSeconds: 10
      }
    }
  );
  input.budgetSnapshot = {
    billingCurrency: "CNY",
    maxRequests: 6,
    maxResults: 22,
    maxAmountMinor: 220,
    maxDurationSeconds: 140
  };
  const failures: AcquisitionShardWorkerFailure[] = [];
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const { repository, service, worker } = createHarness(
    processor,
    2,
    (failure) => failures.push(failure)
  );
  const created = await createApprovedRun(service, input);

  await worker.waitForIdle();

  const run = await service.getRun(scope, created.id);
  assert.equal(run.status, "partial_success");
  assert.deepEqual(
    (await repository.listRunShards(run.id))
      .filter((shard) => shard.kind !== "search")
      .map((shard) => [shard.kind, shard.status]),
    [
      ["content_fetch", "failed"],
      ["import_rows", "failed"]
    ]
  );
  assert.deepEqual(
    failures.map((failure) => [
      failure.code,
      failure.operationKind,
      failure.errorName
    ]),
    [
      [
        "UNSUPPORTED_SHARD_OPERATION",
        "content_fetch",
        "AcquisitionShardProcessorUnsupportedError"
      ],
      [
        "UNSUPPORTED_SHARD_OPERATION",
        "import_rows",
        "AcquisitionShardProcessorUnsupportedError"
      ]
    ]
  );
  await worker.close();
});

test("close drains accepted work and permanently rejects later dispatches", async () => {
  let release!: () => void;
  let started!: () => void;
  const processorStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const processor: AcquisitionShardProcessorPort = {
    async process() {
      started();
      await gate;
      return {
        status: "succeeded",
        evidenceCount: 1,
        usage: {
          requests: 1,
          results: 1,
          amountMinor: 1,
          durationSeconds: 1
        }
      };
    }
  };
  const { repository, service, worker } = createHarness(processor);
  const created = await createApprovedRun(service);
  await processorStarted;

  let closed = false;
  const closing = worker.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  release();
  await closing;
  assert.equal(closed, true);

  const shard = (await repository.listRunShards(created.id))[0]!;
  await assert.rejects(
    worker.enqueue({
      runId: created.id,
      shardIds: [shard.id],
      dispatchKey: "dispatch-after-close"
    }),
    /closed/
  );
});
