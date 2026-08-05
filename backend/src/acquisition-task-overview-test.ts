import assert from "node:assert/strict";
import {
  AcquisitionPlanRunService,
  type AcquisitionExecutionPort,
  type AcquisitionPlanDraftInput,
  type AcquisitionScope
} from "./acquisition-plan-run-service.js";
import {
  InMemoryAcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";
import {
  AcquisitionTaskOverviewService
} from "./acquisition-task-overview.js";

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

const executionPort: AcquisitionExecutionPort = {
  async enqueue() {},
  async requestPause() {},
  async resume() {},
  async requestCancel() {}
};

function planInput(name: string): AcquisitionPlanDraftInput {
  return {
    name,
    objective: "发现可验证的抖音公开商机",
    icp: {
      industries: ["企业服务"],
      regions: ["中国大陆"],
      organizationCriteria: ["有采购信号"],
      individualCriteria: ["公开表达业务需求"],
      exclusionRules: ["明确拒绝联系"]
    },
    subjectChannels: { organization: true, individual: true },
    providerConnections: [
      {
        connectionId: "search-1",
        providerId: "search",
        kind: "search",
        status: "active",
        credentialVersion: 1
      },
      {
        connectionId: "fetch-1",
        providerId: "fetch",
        kind: "content_fetch",
        status: "active",
        credentialVersion: 1
      },
      {
        connectionId: "import-1",
        providerId: "import",
        kind: "import",
        status: "active",
        credentialVersion: 1
      }
    ],
    operations: [
      {
        operationId: "search",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "search-1",
        query: "site:douyin.com 企业服务",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 0,
          durationSeconds: 60
        }
      },
      {
        operationId: "fetch",
        subjectChannel: "organization",
        kind: "content_fetch",
        connectionId: "fetch-1",
        sourceRef: "https://www.iesdouyin.com/public-source",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 0,
          durationSeconds: 60
        }
      },
      {
        operationId: "individual-search",
        subjectChannel: "individual",
        kind: "search",
        connectionId: "search-1",
        query: "site:douyin.com 采购需求",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 0,
          durationSeconds: 60
        }
      },
      {
        operationId: "import",
        subjectChannel: "individual",
        kind: "import_rows",
        connectionId: "import-1",
        sourceRef: "upload://authorized-leads.csv",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 0,
          durationSeconds: 60
        }
      }
    ],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 4,
      maxResults: 40,
      maxAmountMinor: 0,
      maxDurationSeconds: 240
    },
    modelSnapshotRef: {
      jobSnapshotId: "snapshot-1",
      connectionId: "model-1",
      credentialVersion: 1,
      provider: "model-provider",
      model: "model",
      capabilitySnapshotHash: "capability",
      promptVersion: "prompt.v1",
      schemaVersion: "schema.v1",
      promptHash: "sha256:prompt",
      schemaHash: "sha256:schema"
    },
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    }
  };
}

async function createApprovedPlan(
  service: AcquisitionPlanRunService,
  scope: AcquisitionScope,
  name: string
) {
  const draft = await service.createPlan(scope, planInput(name));
  return service.approvePlan(scope, draft.id, draft.etag, {
    decision: "approve",
    reason: "已核对公开数据源"
  });
}

async function main() {
  const repository = new InMemoryAcquisitionPlanRunRepository();
  let tick = 0;
  let id = 0;
  const service = new AcquisitionPlanRunService({
    repository,
    executionPort,
    now: () => new Date(Date.UTC(2026, 7, 5, 0, 0, tick++))
      .toISOString(),
    idFactory: (prefix) => `${prefix}-${++id}`
  });
  const overview = new AcquisitionTaskOverviewService({ repository });

  const visiblePlan = await createApprovedPlan(service, ownerA, "抖音获客");
  const olderRun = await service.createRun(ownerA, visiblePlan.id, {
    idempotencyKey: "visible-run-0001"
  });
  const latestRun = await service.createRun(ownerA, visiblePlan.id, {
    idempotencyKey: "visible-run-0002"
  });
  await repository.transaction((transaction) => {
    transaction.putRun({
      ...olderRun,
      status: "succeeded",
      evidenceCount: 99,
      consumedBudget: {
        requests: 9,
        results: 99,
        amountMinor: 800,
        durationSeconds: 90
      },
      updatedAt: "2026-08-05T00:00:00.000Z",
      completedAt: "2026-08-05T00:00:00.000Z"
    });
    transaction.putRun({
      ...latestRun,
      status: "running",
      evidenceCount: 3,
      consumedBudget: {
        requests: 2,
        results: 3,
        amountMinor: 0,
        durationSeconds: 20
      },
      updatedAt: "2026-08-05T01:00:00.000Z"
    });
  });
  await createApprovedPlan(service, ownerB, "其他租户的抖音获客");

  const result = await overview.getOverview(ownerA, "douyin");
  assert.equal(result.platform, "douyin");
  assert.equal(result.totals.tasks, 1);
  assert.deepEqual(result.statusCounts, { approved: 1 });
  assert.deepEqual(result.discoveryMethodCounts, {
    "公开搜索": 1,
    "用户导入": 1
  });
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.tasks[0]?.discoveryMethods, ["公开搜索", "用户导入"]);
  assert.equal(result.tasks[0]?.latestRun?.id, latestRun.id);
  assert.equal(result.tasks[0]?.latestRun?.evidenceCount, 3);
  assert.equal(
    Object.hasOwn(result.tasks[0]?.latestRun?.consumedBudget ?? {}, "amountMinor"),
    false
  );

  assert.equal((await overview.listTasks(ownerB, { platform: "douyin" })).length, 1);
  assert.equal(await overview.getTask(ownerB, visiblePlan.id), null);
}

await main();
console.log("acquisition task overview tests passed");
