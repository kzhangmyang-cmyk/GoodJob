import assert from "node:assert/strict";
import {
  AcquisitionPlanRunError,
  AcquisitionPlanRunService,
  type AcquisitionExecutionPort,
  type AcquisitionPlanDraftInput,
  type AcquisitionScope
} from "./acquisition-plan-run-service.js";
import {
  InMemoryAcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";

type AsyncTest = () => Promise<void>;

const tests: Array<{ name: string; run: AsyncTest }> = [];

function test(name: string, run: AsyncTest) {
  tests.push({ name, run });
}

async function rejectsCode(
  action: () => Promise<unknown>,
  code: string
) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof AcquisitionPlanRunError);
    assert.equal(error.code, code);
    return true;
  });
}

const ownerA: AcquisitionScope = {
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "alice"
};

const ownerB: AcquisitionScope = {
  ownerId: "owner-b",
  teamId: "team-a",
  actorId: "bob"
};

const otherTeam: AcquisitionScope = {
  ownerId: "owner-a",
  teamId: "team-b",
  actorId: "mallory"
};

function planInput(
  overrides: Partial<AcquisitionPlanDraftInput> = {}
): AcquisitionPlanDraftInput {
  return {
    name: "全国通用 AI 获客计划",
    objective: "发现同时匹配组织和个人场景的公开商机",
    icp: {
      industries: ["企业服务", "本地生活"],
      regions: ["中国大陆"],
      organizationCriteria: ["有明确增长或采购信号"],
      individualCriteria: ["公开表达业务需求的经营者或决策人"],
      exclusionRules: ["同行广告", "明确拒绝联系"]
    },
    subjectChannels: {
      organization: true,
      individual: true
    },
    providerConnections: [
      {
        connectionId: "search-cn-v3",
        providerId: "china-search",
        kind: "search",
        status: "active",
        credentialVersion: 3
      },
      {
        connectionId: "fetch-public-v2",
        providerId: "public-fetch",
        kind: "content_fetch",
        status: "active",
        credentialVersion: 2
      },
      {
        connectionId: "import-v1",
        providerId: "customer-import",
        kind: "import",
        status: "active",
        credentialVersion: 1
      }
    ],
    operations: [
      {
        operationId: "org-search",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "search-cn-v3",
        query: "招聘销售 OR 新店开业 OR 寻找供应商",
        allocatedBudget: {
          requests: 3,
          results: 30,
          amountMinor: 300,
          durationSeconds: 300
        }
      },
      {
        operationId: "person-search",
        subjectChannel: "individual",
        kind: "search",
        connectionId: "search-cn-v3",
        query: "老板 获客难 OR 采购方案 OR 询价",
        allocatedBudget: {
          requests: 3,
          results: 30,
          amountMinor: 300,
          durationSeconds: 300
        }
      },
      {
        operationId: "org-fetch",
        subjectChannel: "organization",
        kind: "content_fetch",
        connectionId: "fetch-public-v2",
        sourceRef: "https://example.test/public-company-list",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 100,
          durationSeconds: 120
        }
      },
      {
        operationId: "person-import",
        subjectChannel: "individual",
        kind: "import_rows",
        connectionId: "import-v1",
        sourceRef: "upload://authorized-public-leads.xlsx",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 100,
          durationSeconds: 120
        }
      }
    ],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 8,
      maxResults: 80,
      maxAmountMinor: 800,
      maxDurationSeconds: 840
    },
    modelSnapshotRef: {
      jobSnapshotId: "job-snapshot-20260724",
      connectionId: "glm-official-user-key",
      credentialVersion: 5,
      provider: "glm",
      model: "glm-4.5",
      capabilitySnapshotHash: "capability-hash-v5",
      promptVersion: "acquisition-plan-prompt.v2",
      schemaVersion: "acquisition-plan.v1",
      promptHash: "sha256:acquisition-plan-prompt-v2",
      schemaHash: "sha256:acquisition-plan-schema-v1"
    },
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    },
    ...overrides
  };
}

class RecordingExecutionPort implements AcquisitionExecutionPort {
  enqueueFailuresRemaining = 0;
  pauseFailuresRemaining = 0;
  readonly enqueueCalls: Array<{
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }> = [];
  readonly pauseCalls: Array<{
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }> = [];
  readonly resumeCalls: Array<{
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }> = [];
  readonly cancelCalls: Array<{
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }> = [];

  async enqueue(input: {
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }) {
    this.enqueueCalls.push(structuredClone(input));
    if (this.enqueueFailuresRemaining > 0) {
      this.enqueueFailuresRemaining -= 1;
      throw new Error("simulated enqueue failure");
    }
  }

  async requestPause(input: {
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }) {
    this.pauseCalls.push(structuredClone(input));
    if (this.pauseFailuresRemaining > 0) {
      this.pauseFailuresRemaining -= 1;
      throw new Error("simulated pause dispatch failure");
    }
  }

  async resume(input: {
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }) {
    this.resumeCalls.push(structuredClone(input));
  }

  async requestCancel(input: {
    runId: string;
    shardIds: string[];
    dispatchKey: string;
  }) {
    this.cancelCalls.push(structuredClone(input));
  }
}

function harness(options: {
  validatePlanPayloadForApproval?: ConstructorParameters<
    typeof AcquisitionPlanRunService
  >[0]["validatePlanPayloadForApproval"];
} = {}) {
  const repository = new InMemoryAcquisitionPlanRunRepository();
  const executionPort = new RecordingExecutionPort();
  let tick = 0;
  let id = 0;
  const service = new AcquisitionPlanRunService({
    repository,
    executionPort,
    now: () => new Date(Date.UTC(2026, 6, 24, 0, 0, tick++))
      .toISOString(),
    idFactory: (prefix) => `${prefix}_${++id}`,
    validatePlanPayloadForApproval:
      options.validatePlanPayloadForApproval
  });
  return { repository, executionPort, service };
}

test("plan updates append immutable versions and enforce ETag plus owner/team isolation", async () => {
  const { repository, service } = harness();
  const created = await service.createPlan(ownerA, planInput());
  assert.equal(created.status, "draft");
  assert.equal(created.version, 1);

  const originalEtag = created.etag;
  const updated = await service.updatePlan(
    ownerA,
    created.id,
    originalEtag,
    { objective: "只保留有可核验证据的公开商机" }
  );
  assert.equal(updated.version, 2);
  assert.notEqual(updated.etag, originalEtag);

  await rejectsCode(
    () => service.updatePlan(
      ownerA,
      created.id,
      originalEtag,
      { name: "stale write" }
    ),
    "precondition_failed"
  );
  await rejectsCode(
    () => service.getPlan(ownerB, created.id),
    "resource_not_found"
  );
  await rejectsCode(
    () => service.getPlan(otherTeam, created.id),
    "resource_not_found"
  );

  const versions = await repository.listPlanVersions(created.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[0]?.payload.objective, planInput().objective);
  assert.equal(
    versions[1]?.payload.objective,
    "只保留有可核验证据的公开商机"
  );
  assert.notEqual(versions[0]?.payloadHash, versions[1]?.payloadHash);
});

test("explicit approval freezes dual-channel ICP, connections, queries, budget and model snapshot", async () => {
  const { repository, service } = harness();
  const invalid = await service.createPlan(ownerA, planInput({
    subjectChannels: { organization: true, individual: false }
  }));
  await rejectsCode(
    () => service.approvePlan(ownerA, invalid.id, invalid.etag, {
      decision: "approve",
      reason: "人工审阅"
    }),
    "plan_not_ready"
  );

  const missingContentHashInput = planInput();
  missingContentHashInput.modelSnapshotRef.promptHash = "";
  const missingContentHash = await service.createPlan(
    ownerA,
    missingContentHashInput
  );
  await rejectsCode(
    () => service.approvePlan(
      ownerA,
      missingContentHash.id,
      missingContentHash.etag,
      { decision: "approve", reason: "不应批准缺少内容哈希的模型快照" }
    ),
    "plan_not_ready"
  );

  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    {
      decision: "approve",
      reason: "已人工核对数据源、查询和预算"
    }
  );
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedVersionId, draft.currentVersionId);
  assert.ok(approved.approvedSnapshotHash);
  assert.equal(approved.approvedBy, ownerA.actorId);

  await rejectsCode(
    () => service.updatePlan(
      ownerA,
      approved.id,
      approved.etag,
      { objective: "偷偷修改已冻结配置" }
    ),
    "approved_plan_is_frozen"
  );

  const approvedVersion = await repository.getPlanVersion(
    approved.approvedVersionId!
  );
  assert.ok(approvedVersion);
  assert.deepEqual(
    approvedVersion.payload.subjectChannels,
    { organization: true, individual: true }
  );
  assert.equal(approvedVersion.payload.providerConnections.length, 3);
  assert.equal(
    approvedVersion.payload.operations.filter(
      (operation) => operation.kind === "search"
    ).length,
    2
  );
  assert.equal(
    approvedVersion.payload.budgetSnapshot.billingCurrency,
    "CNY"
  );
  assert.equal(
    approvedVersion.payload.modelSnapshotRef.jobSnapshotId,
    "job-snapshot-20260724"
  );
  assert.match(
    approvedVersion.payload.modelSnapshotRef.promptHash,
    /^sha256:/
  );
  assert.match(
    approvedVersion.payload.modelSnapshotRef.schemaHash,
    /^sha256:/
  );
});

test("approval delegates trusted model snapshot validation and accepts the bound schema bundle", async () => {
  const validatedSchemas: string[] = [];
  const { service } = harness({
    validatePlanPayloadForApproval: async (_scope, payload) => {
      validatedSchemas.push(payload.modelSnapshotRef.schemaVersion);
      if (payload.modelSnapshotRef.jobSnapshotId !== "trusted-job-snapshot") {
        throw new AcquisitionPlanRunError(
          409,
          "untrusted_model_snapshot",
          "计划引用的模型快照不是服务端持久化的可信快照"
        );
      }
    }
  });
  const trustedPayload = planInput();
  trustedPayload.modelSnapshotRef = {
    ...trustedPayload.modelSnapshotRef,
    jobSnapshotId: "trusted-job-snapshot",
    schemaVersion: "acquisition-model-schema-bundle.v1"
  };
  const trusted = await service.createPlan(ownerA, trustedPayload);
  const approved = await service.approvePlan(
    ownerA,
    trusted.id,
    trusted.etag,
    { decision: "approve", reason: "已核对服务端模型快照" }
  );

  assert.equal(approved.status, "approved");
  assert.deepEqual(validatedSchemas, [
    "acquisition-model-schema-bundle.v1"
  ]);

  const forgedPayload = planInput();
  forgedPayload.modelSnapshotRef = {
    ...forgedPayload.modelSnapshotRef,
    jobSnapshotId: "client-forged-snapshot",
    schemaVersion: "acquisition-model-schema-bundle.v1"
  };
  const forged = await service.createPlan(ownerA, forgedPayload);
  await rejectsCode(
    () => service.approvePlan(
      ownerA,
      forged.id,
      forged.etag,
      { decision: "approve", reason: "不应接受客户端伪造快照" }
    ),
    "untrusted_model_snapshot"
  );
});

test("only approved plans create immutable dual-channel operation shards and enqueue once", async () => {
  const { executionPort, repository, service } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  await rejectsCode(
    () => service.createRun(ownerA, draft.id, {
      idempotencyKey: "run-not-approved-0001"
    }),
    "plan_not_approved"
  );
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准执行" }
  );

  const [first, second] = await Promise.all([
    service.createRun(ownerA, approved.id, {
      idempotencyKey: "run-concurrent-0001"
    }),
    service.createRun(ownerA, approved.id, {
      idempotencyKey: "run-concurrent-0001"
    })
  ]);
  assert.equal(first.id, second.id);
  assert.equal(executionPort.enqueueCalls.length, 1);
  assert.equal(first.planVersionId, approved.approvedVersionId);
  assert.equal(first.planSnapshotHash, approved.approvedSnapshotHash);
  assert.equal(first.status, "queued");

  const shards = await repository.listRunShards(first.id);
  assert.deepEqual(
    new Set(shards.map((shard) => shard.kind)),
    new Set(["search", "content_fetch", "import_rows"])
  );
  assert.deepEqual(
    new Set(shards.map((shard) => shard.subjectChannel)),
    new Set(["organization", "individual"])
  );
  assert.ok(shards.every(
    (shard) => shard.modelSnapshotRef.jobSnapshotId
      === "job-snapshot-20260724"
  ));
  assert.ok(shards.every(
    (shard) => shard.budgetSnapshotId === first.budgetSnapshotId
      && shard.parentShardId === null
      && shard.sourceRef.length > 0
  ));
  assert.equal(first.billingCurrency, "CNY");
  assert.equal(
    shards.find((shard) => shard.operationId === "org-search")
      ?.allocatedBudget.requests,
    3
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(executionPort, "sendMessage"),
    false
  );

  await rejectsCode(
    () => service.createRun(ownerA, approved.id, {
      idempotencyKey: "run-concurrent-0001",
      reason: "same key, different request"
    }),
    "idempotency_conflict"
  );
});

test("durable execution intents survive queue/control port failure and can be retried", async () => {
  const { executionPort, service } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准" }
  );

  executionPort.enqueueFailuresRemaining = 1;
  await assert.rejects(
    () => service.createRun(ownerA, approved.id, {
      idempotencyKey: "run-outbox-retry-0001"
    }),
    /simulated enqueue failure/
  );
  const replayed = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-outbox-retry-0001"
  });
  assert.equal(executionPort.enqueueCalls.length, 2);
  assert.equal(executionPort.enqueueCalls[0]?.runId, replayed.id);
  assert.equal(executionPort.enqueueCalls[1]?.runId, replayed.id);

  const shard = (await service.listRunShards(ownerA, replayed.id))[0]!;
  let run = await service.startShard(ownerA, replayed.id, shard.id);
  executionPort.pauseFailuresRemaining = 1;
  await assert.rejects(
    () => service.pauseRun(ownerA, run.id, run.etag, {
      reason: "人工检查"
    }),
    /simulated pause dispatch failure/
  );
  run = await service.getRun(ownerA, run.id);
  assert.equal(run.status, "pause_requested");
  await service.dispatchPendingExecutionIntents(ownerA, run.id);
  assert.equal(executionPort.pauseCalls.length, 2);
  assert.equal(
    executionPort.pauseCalls[0]?.dispatchKey,
    executionPort.pauseCalls[1]?.dispatchKey
  );
});

test("startup recovery redispatches a persisted dispatched intent whose shards are still queued", async () => {
  const {
    repository,
    service
  } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "批准执行并模拟进程退出" }
  );
  const run = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-crash-recovery-0001"
  });
  const persisted = await repository.listRunExecutionIntents(run.id);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.status, "dispatched");

  const restartedPort = new RecordingExecutionPort();
  let restartedId = 0;
  const restartedService = new AcquisitionPlanRunService({
    repository,
    executionPort: restartedPort,
    now: () => "2026-07-24T02:00:00.000Z",
    idFactory: (prefix) => `${prefix}_restarted_${++restartedId}`
  });
  const recovered = await restartedService.recoverExecutionIntents(
    "acquisition-startup-recovery"
  );

  assert.equal(recovered, 1);
  assert.equal(restartedPort.enqueueCalls.length, 1);
  assert.equal(restartedPort.enqueueCalls[0]?.runId, run.id);
  assert.deepEqual(
    new Set(restartedPort.enqueueCalls[0]?.shardIds),
    new Set(
      (await repository.listRunShards(run.id)).map((shard) => shard.id)
    )
  );
});

test("pause uses safe points, resume preserves consumption, and cancel settles running shards", async () => {
  const { executionPort, repository, service } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准" }
  );
  let run = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-control-0001"
  });
  const [runningShard, queuedShard] =
    await repository.listRunShards(run.id);
  assert.ok(runningShard);
  assert.ok(queuedShard);

  run = await service.startShard(ownerA, run.id, runningShard.id);
  run = await service.consumeShardBudget(
    ownerA,
    run.id,
    runningShard.id,
    {
      idempotencyKey: "usage-control-0001",
      usage: {
        requests: 1,
        results: 2,
        amountMinor: 50,
        durationSeconds: 10
      }
    }
  );
  const consumedBeforePause = run.consumedBudget;
  run = await service.pauseRun(ownerA, run.id, run.etag, {
    reason: "人工检查搜索结果"
  });
  assert.equal(run.status, "pause_requested");
  let shards = await repository.listRunShards(run.id);
  assert.equal(
    shards.find((shard) => shard.id === runningShard.id)?.status,
    "pause_requested"
  );
  assert.equal(
    shards.find((shard) => shard.id === queuedShard.id)?.status,
    "paused"
  );

  run = await service.acknowledgeShardPaused(
    ownerA,
    run.id,
    runningShard.id
  );
  assert.equal(run.status, "paused");
  run = await service.resumeRun(ownerA, run.id, run.etag, {
    reason: "人工确认继续"
  });
  assert.equal(run.status, "queued");
  assert.deepEqual(run.consumedBudget, consumedBeforePause);
  assert.equal(executionPort.pauseCalls.length, 1);
  assert.equal(executionPort.resumeCalls.length, 1);

  shards = await repository.listRunShards(run.id);
  const resumedShard = shards.find((shard) => shard.id === runningShard.id)!;
  run = await service.startShard(ownerA, run.id, resumedShard.id);
  run = await service.cancelRun(ownerA, run.id, run.etag, {
    reason: "用户明确取消"
  });
  assert.equal(run.status, "cancel_requested");
  run = await service.acknowledgeShardCancelled(
    ownerA,
    run.id,
    resumedShard.id
  );
  assert.equal(run.status, "cancelled");
  assert.equal(executionPort.cancelCalls.length, 1);

  const events = await repository.listRunEvents(run.id);
  assert.ok(events.some((event) => event.type === "run.pause_requested"));
  assert.ok(events.some((event) => event.type === "run.resumed"));
  assert.ok(events.some((event) => event.type === "run.cancelled"));
  const audit = await repository.listAuditEvents({
    ownerId: ownerA.ownerId,
    teamId: ownerA.teamId
  });
  assert.ok(audit.some((event) => event.action === "run.cancel"));
});

test("a worker cannot report cancelled without a prior cancellation request", async () => {
  const { repository, service } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准" }
  );
  let run = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-unexpected-cancel-0001"
  });
  const shard = (await repository.listRunShards(run.id))[0]!;
  run = await service.startShard(ownerA, run.id, shard.id);
  await rejectsCode(
    () => service.completeShard(ownerA, run.id, shard.id, {
      status: "cancelled",
      evidenceCount: 0
    }),
    "cancel_not_requested"
  );
});

test("successful shard settlement aggregates evidence into a succeeded run", async () => {
  const { repository, service } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准" }
  );
  let run = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-success-aggregation-0001"
  });
  const shards = await repository.listRunShards(run.id);
  for (const [index, shard] of shards.entries()) {
    run = await service.startShard(ownerA, run.id, shard.id);
    run = await service.completeShard(ownerA, run.id, shard.id, {
      status: index === 0 ? "succeeded" : "succeeded_empty",
      evidenceCount: index === 0 ? 3 : 0
    });
  }
  assert.equal(run.status, "succeeded");
  assert.equal(run.evidenceCount, 3);
  assert.ok(run.completedAt);
});

test("usage idempotency and shard hard limits never overspend allocations", async () => {
  const { repository, service } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准" }
  );
  let run = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-shard-budget-0001"
  });
  const shards = await repository.listRunShards(run.id);
  const target = shards.find(
    (shard) => shard.operationId === "org-fetch"
  )!;
  run = await service.startShard(ownerA, run.id, target.id);

  const usage = {
    idempotencyKey: "usage-shard-budget-0001",
    usage: {
      requests: 1,
      results: 2,
      amountMinor: 50,
      durationSeconds: 10
    }
  };
  await service.consumeShardBudget(ownerA, run.id, target.id, usage);
  run = await service.consumeShardBudget(ownerA, run.id, target.id, usage);
  assert.equal(run.consumedBudget.requests, 1);
  assert.equal(run.consumedBudget.amountMinor, 50);

  run = await service.consumeShardBudget(
    ownerA,
    run.id,
    target.id,
    {
      idempotencyKey: "usage-shard-budget-0002",
      usage: {
        requests: 0,
        results: 9,
        amountMinor: 0,
        durationSeconds: 0
      }
    }
  );
  const exhausted = (await repository.listRunShards(run.id))
    .find((shard) => shard.id === target.id)!;
  assert.equal(exhausted.status, "budget_exhausted");
  assert.deepEqual(exhausted.consumedBudget, {
    requests: 1,
    results: 2,
    amountMinor: 50,
    durationSeconds: 10
  });
  assert.equal(run.consumedBudget.requests, 1);

  for (const shard of await repository.listRunShards(run.id)) {
    if (shard.status === "queued") {
      run = await service.startShard(ownerA, run.id, shard.id);
      run = await service.completeShard(ownerA, run.id, shard.id, {
        status: "succeeded_empty",
        evidenceCount: 0
      });
    }
  }
  assert.equal(run.status, "failed");
});

test("global budget exhaustion converges cancellation and can only continue with a newly approved plan version", async () => {
  const { executionPort, repository, service } = harness();
  const constrained = planInput({
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 2,
      maxResults: 80,
      maxAmountMinor: 800,
      maxDurationSeconds: 840
    },
    operations: planInput().operations.map((operation) => ({
      ...operation,
      allocatedBudget: {
        ...operation.allocatedBudget,
        requests: operation.operationId === "org-search" ? 2 : 0
      }
    }))
  });
  const draft = await service.createPlan(ownerA, constrained);
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准低预算试跑" }
  );
  let run = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-global-budget-0001"
  });
  const shards = await repository.listRunShards(run.id);
  const trigger = shards.find(
    (shard) => shard.operationId === "org-search"
  )!;
  const other = shards.find(
    (shard) => shard.operationId === "person-search"
  )!;
  run = await service.startShard(ownerA, run.id, trigger.id);
  run = await service.startShard(ownerA, run.id, other.id);
  run = await service.consumeShardBudget(
    ownerA,
    run.id,
    trigger.id,
    {
      idempotencyKey: "usage-global-budget-0001",
      usage: {
        requests: 2,
        results: 4,
        amountMinor: 40,
        durationSeconds: 12
      }
    }
  );
  run = await service.consumeShardBudget(
    ownerA,
    run.id,
    trigger.id,
    {
      idempotencyKey: "usage-global-budget-0002",
      usage: {
        requests: 1,
        results: 1,
        amountMinor: 10,
        durationSeconds: 2
      }
    }
  );
  assert.equal(run.status, "cancel_requested");
  assert.equal(run.terminationIntent, "budget_exhausted");
  assert.equal(run.consumedBudget.requests, 2);
  assert.equal(
    (await repository.listRunShards(run.id))
      .find((shard) => shard.id === trigger.id)?.status,
    "budget_exhausted"
  );
  assert.equal(executionPort.cancelCalls.at(-1)?.runId, run.id);
  assert.deepEqual(
    executionPort.cancelCalls.at(-1)?.shardIds,
    [other.id]
  );
  assert.ok(executionPort.cancelCalls.at(-1)?.dispatchKey);

  run = await service.acknowledgeShardCancelled(
    ownerA,
    run.id,
    other.id
  );
  assert.equal(run.status, "budget_exhausted");
  await rejectsCode(
    () => service.resumeRun(ownerA, run.id, run.etag, {
      reason: "不能原地加预算"
    }),
    "budget_revision_requires_new_run"
  );
  await rejectsCode(
    () => service.createRun(ownerA, approved.id, {
      idempotencyKey: "run-global-budget-0002",
      parentRunId: run.id
    }),
    "new_approved_plan_version_required"
  );

  let revision = await service.createPlanRevision(
    ownerA,
    approved.id,
    approved.etag,
    {
      budgetSnapshot: {
        ...approved.payload.budgetSnapshot,
        maxRequests: 12,
        maxAmountMinor: 1_200
      }
    }
  );
  revision = await service.approvePlan(
    ownerA,
    revision.id,
    revision.etag,
    { decision: "approve", reason: "人工批准新预算版本" }
  );
  const continued = await service.createRun(ownerA, revision.id, {
    idempotencyKey: "run-global-budget-0003",
    parentRunId: run.id
  });
  assert.equal(continued.parentRunId, run.id);
  assert.notEqual(continued.planVersionId, run.planVersionId);
  assert.equal(continued.status, "queued");
});

test("run and plan reads never cross owner/team boundaries", async () => {
  const { service } = harness();
  const draft = await service.createPlan(ownerA, planInput());
  const approved = await service.approvePlan(
    ownerA,
    draft.id,
    draft.etag,
    { decision: "approve", reason: "人工批准" }
  );
  const run = await service.createRun(ownerA, approved.id, {
    idempotencyKey: "run-tenant-0001"
  });
  await rejectsCode(
    () => service.getRun(ownerB, run.id),
    "resource_not_found"
  );
  await rejectsCode(
    () => service.getRun(otherTeam, run.id),
    "resource_not_found"
  );
  assert.equal((await service.getRun(ownerA, run.id)).id, run.id);
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.run();
    passed += 1;
    console.log(`✓ ${entry.name}`);
  } catch (error) {
    console.error(`✗ ${entry.name}`);
    throw error;
  }
}
console.log(`${passed}/${tests.length} acquisition plan/run tests passed`);
