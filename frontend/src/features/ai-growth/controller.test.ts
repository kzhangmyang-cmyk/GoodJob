import test from "node:test";
import assert from "node:assert/strict";
import type { AiGrowthApi, ProviderConnectionDto } from "./api.js";
import type { RunPresentationPollerOptions } from "./poll-run.js";
import {
  createAiGrowthController,
  type AiGrowthControllerApi,
  type AiGrowthControllerOptions
} from "./controller.js";
import { createBattleCardDrawer } from "./components/battle-card-drawer.js";
import { demoFixture } from "./demo/fixture.js";
import type {
  AcquisitionPlanCreateDto,
  AdvisorState,
  CandidateDto,
  RunDto
} from "./types.js";

const planDraft: AcquisitionPlanCreateDto = {
  name: "上海制造业数字化商机",
  objective: "寻找上海近期有数字化采购需求的制造企业",
  icp: {
    industries: ["制造业"],
    regions: ["上海"],
    organizationCriteria: ["员工规模 50 人以上"],
    individualCriteria: [],
    exclusionRules: ["勿扰名单"]
  },
  subjectChannels: { organization: true, individual: false },
  providerConnections: [{
    connectionId: "conn-search",
    providerId: "baidu",
    kind: "search",
    status: "active",
    credentialVersion: 1
  }],
  operations: [{
    operationId: "search-1",
    subjectChannel: "organization",
    kind: "search",
    connectionId: "conn-search",
    query: "上海 制造业 数字化采购",
    allocatedBudget: {
      requests: 10,
      results: 50,
      amountMinor: 1000,
      durationSeconds: 60
    }
  }],
  budgetSnapshot: {
    billingCurrency: "CNY",
    maxRequests: 10,
    maxResults: 50,
    maxAmountMinor: 1000,
    maxDurationSeconds: 60
  },
  stopConditions: {
    stopWhenBudgetExhausted: true,
    stopWhenNoMoreResults: true
  }
};

const approvedCandidate: CandidateDto = {
  id: "candidate-1",
  subjectKind: "organization",
  name: "示例制造企业",
  domain: "example.cn",
  region: "上海",
  creditCode: null,
  status: "approved",
  latestDecisionVersion: "decision-1",
  approvedDecisionVersion: "decision-1",
  evidenceIds: ["evidence-1"],
  createdAt: "2026-07-26T09:00:00.000Z",
  updatedAt: "2026-07-26T09:00:00.000Z"
};

function providerConnection(
  overrides: Partial<ProviderConnectionDto> = {}
): ProviderConnectionDto {
  return {
    id: "conn-search",
    ownerId: "user-1",
    teamId: null,
    providerId: "baidu",
    kind: "search",
    status: "active",
    credentialVersion: 1,
    lastHealthAt: "2026-08-06T00:00:00.000Z",
    lastHealthStatus: "passed",
    lastErrorCode: null,
    lastHealthMessage: "连接正常",
    usage: "search",
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

function run(status: RunDto["status"] = "running"): RunDto {
  return {
    id: "run-1",
    status,
    etag: `"run-1:${status}"`,
    updatedAt: "2026-07-26T09:00:00.000Z",
    completedAt: status === "succeeded"
      ? "2026-07-26T09:10:00.000Z"
      : null
  };
}

function createApi(overrides: Partial<AiGrowthControllerApi> = {}) {
  const calls = {
    createPlan: 0,
    approvePlan: 0,
    createRun: 0,
    convert: 0,
    todo: 0,
    pause: 0,
    resume: 0,
    cancel: 0
  };
  const api = {
    listProviders: async () => ({
      items: [{
        id: "baidu",
        kind: "search" as const,
        displayName: "百度 AI 搜索",
        capabilities: ["web_search"]
      }],
      nextCursor: null
    }),
    listProviderConnections: async () => ({
      items: [providerConnection()],
      nextCursor: null
    }),
    createSession: async () => ({
      id: "operation-session-1",
      kind: "copilot_session_creation",
      status: "succeeded" as const,
      resourceId: "session-1",
      createdAt: "2026-08-05T00:00:00.000Z",
      completedAt: "2026-08-05T00:00:00.000Z"
    }),
    requestPlanDraft: async () => ({
      id: "task-1",
      status: "succeeded" as const,
      responseMode: "plan_draft" as const,
      result: { planDraft }
    }),
    getCopilotTask: async () => ({
      id: "task-1",
      status: "succeeded" as const,
      result: { planDraft }
    }),
    createPlan: async () => {
      calls.createPlan += 1;
      return {
        ...planDraft,
        id: "plan-1",
        etag: "\"plan-1:draft\"",
        status: "draft" as const,
        version: 1
      };
    },
    getPlan: async () => ({
      ...planDraft,
      id: "plan-1",
      etag: "\"plan-1:draft\"",
      status: "draft" as const,
      version: 1
    }),
    approvePlan: async () => {
      calls.approvePlan += 1;
      return {
        ...planDraft,
        id: "plan-1",
        etag: "\"plan-1:approved\"",
        status: "approved" as const,
        version: 2
      };
    },
    createRun: async () => {
      calls.createRun += 1;
      return run();
    },
    getRun: async () => run(),
    pauseRun: async () => {
      calls.pause += 1;
      return run("paused");
    },
    resumeRun: async () => {
      calls.resume += 1;
      return run("running");
    },
    cancelRun: async () => {
      calls.cancel += 1;
      return run("cancelled");
    },
    getCandidate: async () => approvedCandidate,
    convertCandidate: async () => {
      calls.convert += 1;
      return {
        id: "conversion-1",
        candidateId: approvedCandidate.id,
        decisionVersion: "decision-1",
        partyRef: {},
        leadId: "lead-1",
        reviewerId: "user-1",
        evidenceSnapshotHash: "hash",
        createdAt: "2026-07-26T09:00:00.000Z"
      };
    },
    createTodoForConversion: async () => {
      calls.todo += 1;
      return {
        id: "todo-1",
        ownerId: "user-1",
        teamId: "team-1",
        title: "跟进示例制造企业",
        type: "customer" as const,
        priority: "high" as const,
        dueAt: "2026-07-27T09:00:00.000Z",
        related: "lead-1",
        done: false
      };
    },
    ...overrides
  } as unknown as AiGrowthControllerApi;
  return { api, calls };
}

function controllerOptions(
  api: AiGrowthControllerApi,
  overrides: Partial<AiGrowthControllerOptions> = {}
): AiGrowthControllerOptions {
  return {
    api,
    user: () => ({ id: "user-1" }),
    wait: async () => undefined,
    toast: () => undefined,
    navigate: () => undefined,
    recentStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    },
    pollerFactory: () => ({
      start: () => undefined,
      stop: () => undefined,
      dispose: () => undefined,
      cursor: () => null
    }),
    drawerFactory: () => ({
      getState: () => ({
        open: false,
        readOnly: false,
        candidateId: null,
        candidate: { status: "idle", data: null, error: null },
        evidence: { status: "idle", data: null, error: null },
        qualification: { status: "idle", data: null, error: null },
        financialValue: { status: "idle", data: null, error: null },
        battleCard: { status: "idle", data: null, error: null },
        action: {
          kind: null,
          status: "idle",
          taskId: null,
          message: null,
          error: null
        }
      }),
      render: () => ({ html: "", callbacks: {} as never }),
      open: async () => undefined,
      openFixture: () => undefined,
      close: () => undefined,
      runQualification: async () => undefined,
      generateBattleCard: async () => undefined,
      review: async () => undefined,
      convert: async () => undefined,
      createOutreachReviewTask: async () => undefined
    }),
    ...overrides
  };
}

test("真实流程按 idle 到 completed 的服务状态推进", async () => {
  const { api, calls } = createApi();
  let latest: AdvisorState | null = null;
  let presentationUpdate:
    | RunPresentationPollerOptions["onUpdate"]
    | undefined;
  const controller = createAiGrowthController(controllerOptions(api, {
    onChange: (state) => {
      latest = state;
    },
    pollerFactory: (options) => {
      presentationUpdate = options.onUpdate;
      return {
        start: () => undefined,
        stop: () => undefined,
        dispose: () => undefined,
        cursor: () => null
      };
    }
  }));

  assert.equal(controller.getState().status, "idle");
  await controller.submit();
  assert.equal(latest!.status, "awaiting_approval");
  assert.equal(calls.createRun, 0);
  await controller.approve();
  assert.equal(latest!.status, "running");
  assert.equal(calls.createPlan, 1);
  assert.equal(calls.approvePlan, 1);
  assert.equal(calls.createRun, 1);

  assert.ok(presentationUpdate);
  presentationUpdate({
    run: run("succeeded"),
    providers: [],
    summary: null,
    candidatesById: new Map(),
    nextAfter: "cursor-1",
    hasMore: false
  }, {
    run: run("succeeded")
  } as never);
  assert.equal(latest!.status, "completed");
});

test("Copilot 会话创建使用异步操作的 resourceId", async () => {
  let requestedSessionId: string | null = null;
  const { api } = createApi({
    createSession: async () => ({
      id: "operation-1",
      kind: "copilot_session_creation",
      status: "succeeded",
      resourceId: "session-resource-1",
      createdAt: "2026-08-05T00:00:00.000Z",
      completedAt: "2026-08-05T00:00:00.000Z"
    }) as never,
    requestPlanDraft: async (sessionId) => {
      requestedSessionId = sessionId;
      return {
        id: "task-1",
        status: "succeeded",
        result: { planDraft }
      } as never;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));

  await controller.submit();

  assert.equal(requestedSessionId, "session-resource-1");
});

test("获客任务默认选择抖音且忽略非法平台值", () => {
  const { api } = createApi();
  const controller = createAiGrowthController(controllerOptions(api));
  const target = controller as unknown as {
    getState(): AdvisorState & { targetPlatform?: string };
    setTargetPlatform(platform: string): void;
  };

  assert.equal(target.getState().targetPlatform, "douyin");
  target.setTargetPlatform("web");
  assert.equal(target.getState().targetPlatform, "web");
  target.setTargetPlatform("kuaishou");
  assert.equal(target.getState().targetPlatform, "web");
});

test("目标平台在模式、模板和新建视图切换后保留", () => {
  const { api } = createApi();
  const controller = createAiGrowthController(controllerOptions(api));
  const target = controller as unknown as {
    getState(): AdvisorState & { targetPlatform?: string };
    setTargetPlatform(platform: string): void;
    showNewTask(): void;
  };

  target.setTargetPlatform("web");
  controller.setMode("demo");
  controller.selectTemplate("renovation");
  target.showNewTask();

  assert.equal(target.getState().targetPlatform, "web");
});

test("真实方案请求传递当前目标平台", async () => {
  let requestedPlatform: string | undefined;
  const { api } = createApi({
    requestPlanDraft: async (
      _sessionId,
      _message,
      _idempotencyKey,
      targetPlatform
    ) => {
      requestedPlatform = targetPlatform;
      return {
        id: "task-1",
        status: "succeeded",
        result: { planDraft: { ...planDraft, targetPlatform } }
      } as never;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  const target = controller as unknown as {
    setTargetPlatform(platform: string): void;
  };
  target.setTargetPlatform("web");

  await controller.submit();

  assert.equal(requestedPlatform, "web");
  assert.equal(controller.getState().planDraft?.targetPlatform, "web");
});

test("切换目标平台会废弃仍在生成的旧平台方案", async () => {
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  let releaseRequest!: (
    value: Awaited<ReturnType<AiGrowthControllerApi["requestPlanDraft"]>>
  ) => void;
  const deferredRequest = new Promise<
    Awaited<ReturnType<AiGrowthControllerApi["requestPlanDraft"]>>
  >((resolve) => {
    releaseRequest = resolve;
  });
  const { api } = createApi({
    requestPlanDraft: async () => {
      markRequestStarted();
      return deferredRequest;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));

  const submission = controller.submit();
  await requestStarted;
  controller.setTargetPlatform("web");
  releaseRequest({
    id: "task-stale-douyin",
    sessionId: "session-1",
    kind: "message",
    status: "succeeded",
    responseMode: "plan_draft",
    targetPlatform: "douyin",
    result: {
      planDraft: { ...planDraft, targetPlatform: "douyin" }
    },
    errorCode: null,
    createdAt: "2026-08-05T00:00:00.000Z",
    completedAt: "2026-08-05T00:00:01.000Z"
  });
  await submission;

  assert.equal(controller.getState().targetPlatform, "web");
  assert.equal(controller.getState().status, "idle");
  assert.equal(controller.getState().planDraft, null);
  await assert.rejects(
    controller.approve(),
    /当前没有等待批准的搜索方案/
  );
});

test("打开旧任务时优先恢复方案平台并回退任务平台", async () => {
  const detail = (
    payload: AcquisitionPlanCreateDto,
    taskPlatform: "douyin" | "web"
  ) => ({
    task: {
      id: "plan-legacy",
      planId: "plan-legacy",
      name: "历史获客任务",
      objective: payload.objective,
      platform: taskPlatform,
      discoveryMethods: ["public_search"],
      planStatus: "approved",
      latestRun: null,
      updatedAt: "2026-08-05T09:00:00.000Z"
    },
    plan: { payload },
    latestRun: null,
    shards: [],
    presentation: null
  });
  const explicit = createApi({
    getAcquisitionTask: async () => detail(
      { ...planDraft, targetPlatform: "web" },
      "douyin"
    ) as never
  });
  const explicitController = createAiGrowthController(
    controllerOptions(explicit.api)
  );
  await explicitController.openTask("plan-explicit");
  assert.equal(
    (explicitController.getState() as AdvisorState & {
      targetPlatform?: string;
    }).targetPlatform,
    "web"
  );

  const legacy = createApi({
    getAcquisitionTask: async () => detail(planDraft, "douyin") as never
  });
  const legacyController = createAiGrowthController(
    controllerOptions(legacy.api)
  );
  await legacyController.openTask("plan-legacy");
  assert.equal(
    (legacyController.getState() as AdvisorState & {
      targetPlatform?: string;
    }).targetPlatform,
    "douyin"
  );
});

test("未批准时不会创建运行", async () => {
  const { api, calls } = createApi();
  const controller = createAiGrowthController(controllerOptions(api));
  await assert.rejects(() => controller.approve(), /等待批准/);
  assert.equal(calls.createRun, 0);
});

test("并发批准复用同一写入链且只创建一个运行", async () => {
  const createdPlan = {
    ...planDraft,
    id: "plan-1",
    etag: "\"plan-1:draft\"",
    status: "draft" as const,
    version: 1
  };
  const approvedPlan = {
    ...createdPlan,
    etag: "\"plan-1:approved\"",
    status: "approved" as const,
    version: 2
  };
  let releaseCreatePlan!: () => void;
  const createPlanGate = new Promise<void>((resolve) => {
    releaseCreatePlan = resolve;
  });
  const writeCalls = { createPlan: 0, approvePlan: 0, createRun: 0 };
  const { api } = createApi({
    createPlan: async () => {
      writeCalls.createPlan += 1;
      await createPlanGate;
      return createdPlan;
    },
    approvePlan: async () => {
      writeCalls.approvePlan += 1;
      return approvedPlan;
    },
    createRun: async () => {
      writeCalls.createRun += 1;
      return run();
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.submit();

  const first = controller.approve();
  const second = controller.approve();
  await Promise.resolve();
  assert.equal(writeCalls.createPlan, 1);

  releaseCreatePlan();
  await Promise.all([first, second]);
  assert.deepEqual(writeCalls, {
    createPlan: 1,
    approvePlan: 1,
    createRun: 1
  });
});

test("暂停、继续和取消调用真实运行控制接口", async () => {
  const { api, calls } = createApi();
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.submit();
  await controller.approve();
  await controller.pause();
  assert.equal(controller.getState().status, "paused");
  await controller.resume();
  assert.equal(controller.getState().status, "running");
  await controller.cancel();
  assert.equal(controller.getState().status, "cancelled");
  assert.deepEqual(
    { pause: calls.pause, resume: calls.resume, cancel: calls.cancel },
    { pause: 1, resume: 1, cancel: 1 }
  );
});

test("陈旧 presentation 不会覆盖同一运行的新版控制 ETag", async () => {
  const versionedRun = (
    status: RunDto["status"],
    revision: number
  ): RunDto => ({
    ...run(status),
    etag: `"run-1:${revision}"`
  });
  let presentationUpdate:
    | RunPresentationPollerOptions["onUpdate"]
    | undefined;
  let cancelledWith: string | null = null;
  const { api } = createApi({
    createRun: async () => versionedRun("running", 1),
    pauseRun: async (_runId, etag) => {
      assert.equal(etag, '"run-1:1"');
      return versionedRun("paused", 2);
    },
    resumeRun: async (_runId, etag) => {
      assert.equal(etag, '"run-1:2"');
      return versionedRun("running", 3);
    },
    cancelRun: async (_runId, etag) => {
      cancelledWith = etag;
      return versionedRun("cancelled", 4);
    }
  });
  const controller = createAiGrowthController(controllerOptions(api, {
    pollerFactory: (options) => {
      presentationUpdate = options.onUpdate;
      return {
        start: () => undefined,
        stop: () => undefined,
        dispose: () => undefined,
        cursor: () => null
      };
    }
  }));

  await controller.submit();
  await controller.approve();
  await controller.pause();
  await controller.resume();
  assert.ok(presentationUpdate);
  presentationUpdate({
    run: versionedRun("running", 1),
    providers: [],
    summary: null,
    candidatesById: new Map(),
    nextAfter: "stale",
    hasMore: false
  }, {
    run: versionedRun("running", 1)
  } as never);
  await controller.cancel();

  assert.equal(cancelledWith, '"run-1:3"');
});

test("缺少真实搜索连接时保留用户输入", async () => {
  const { api } = createApi({
    listProviderConnections: async () => ({ items: [], nextCursor: null })
  });
  const controller = createAiGrowthController(controllerOptions(api));
  controller.setTaskText("寻找厦门近期有获客需求的企业");
  await controller.submit();
  assert.equal(controller.getState().status, "connection_required");
  assert.equal(
    controller.getState().taskText,
    "寻找厦门近期有获客需求的企业"
  );
});

test("只有 active 且 passed 的搜索连接允许生成方案", async () => {
  let draftRequests = 0;
  const untested = createApi({
    listProviderConnections: async () => ({
      items: [providerConnection({ lastHealthStatus: "untested" })],
      nextCursor: null
    }),
    requestPlanDraft: async () => {
      draftRequests += 1;
      return {
        id: "task-untested",
        status: "succeeded",
        result: { planDraft }
      } as never;
    }
  });
  const blocked = createAiGrowthController(controllerOptions(untested.api));

  await blocked.submit();

  assert.equal(blocked.getState().status, "connection_required");
  assert.equal(draftRequests, 0);

  const passed = createApi({
    requestPlanDraft: async () => {
      draftRequests += 1;
      return {
        id: "task-passed",
        status: "succeeded",
        result: { planDraft }
      } as never;
    }
  });
  const allowed = createAiGrowthController(controllerOptions(passed.api));

  await allowed.submit();

  assert.equal(allowed.getState().status, "awaiting_approval");
  assert.equal(draftRequests, 1);
});

test("任务输入只统计搜索连接且 active failed 不得显示为健康", async () => {
  const { api } = createApi({
    listProviderConnections: async () => ({
      items: [
        providerConnection({
          id: "connection-content",
          providerId: "internal_reader",
          kind: "content_fetch",
          status: "active",
          lastHealthStatus: "passed"
        }),
        providerConnection({
          id: "connection-import",
          providerId: "spreadsheet_import",
          kind: "import",
          status: "active",
          lastHealthStatus: "passed"
        }),
        providerConnection({
          id: "connection-search-failed",
          providerId: "baidu",
          kind: "search",
          status: "active",
          lastHealthStatus: "failed",
          lastHealthMessage: "凭据已失效"
        })
      ],
      nextCursor: null
    })
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.submit();
  const root = { innerHTML: "" } as HTMLElement;

  controller.render(root);

  assert.match(root.innerHTML, /搜索来源健康状态[\s\S]*1 个来源/);
  assert.match(root.innerHTML, /data-health="unavailable"/);
  assert.match(root.innerHTML, /连接不可用/);
  assert.doesNotMatch(root.innerHTML, /internal_reader|spreadsheet_import/);
});

test("打开连接中心并发加载且只保留搜索来源和当前任务", async () => {
  let releaseCatalog!: () => void;
  let releaseConnections!: () => void;
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  const connectionsGate = new Promise<void>((resolve) => {
    releaseConnections = resolve;
  });
  const reads: string[] = [];
  const { api } = createApi({
    listProviders: async () => {
      reads.push("catalog");
      await catalogGate;
      return {
        items: [{
          id: "baidu",
          kind: "search",
          displayName: "百度 AI 搜索",
          capabilities: ["web_search"]
        }, {
          id: "reader",
          kind: "content_fetch",
          displayName: "网页读取",
          capabilities: ["content_fetch"]
        }],
        nextCursor: null
      };
    },
    listProviderConnections: async () => {
      reads.push("connections");
      await connectionsGate;
      return {
        items: [
          providerConnection(),
          providerConnection({
            id: "conn-content",
            providerId: "reader",
            kind: "content_fetch"
          })
        ],
        nextCursor: null
      };
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  controller.selectTemplate("beauty");
  controller.setTaskText("寻找抖音上的上海美业采购需求");
  controller.setTargetPlatform("web");
  const before = controller.getState();

  const opening = controller.openConnectionCenter();

  assert.deepEqual(reads.sort(), ["catalog", "connections"]);
  assert.equal(controller.getConnectionCenter().open, true);
  assert.equal(controller.getConnectionCenter().status, "loading");
  releaseCatalog();
  releaseConnections();
  await opening;

  const center = controller.getConnectionCenter();
  assert.equal(center.status, "ready");
  assert.deepEqual(center.providers.map((item) => item.id), ["baidu"]);
  assert.deepEqual(center.connections.map((item) => item.id), ["conn-search"]);
  assert.equal(controller.getState().taskText, before.taskText);
  assert.equal(controller.getState().targetPlatform, before.targetPlatform);
  assert.equal(controller.getState().templateId, before.templateId);
  assert.equal(controller.getView(), "workflow");
});

test("关闭后重开连接中心会忽略第一次打开的迟到响应", async () => {
  const catalogResolvers: Array<(value: {
    items: Array<{
      id: string;
      kind: "search";
      displayName: string;
      capabilities: string[];
    }>;
    nextCursor: null;
  }) => void> = [];
  const connectionResolvers: Array<(value: {
    items: ProviderConnectionDto[];
    nextCursor: null;
  }) => void> = [];
  const { api } = createApi({
    listProviders: () => new Promise((resolve) => {
      catalogResolvers.push(resolve);
    }),
    listProviderConnections: () => new Promise((resolve) => {
      connectionResolvers.push(resolve);
    })
  });
  const controller = createAiGrowthController(controllerOptions(api));

  const first = controller.openConnectionCenter();
  controller.closeConnectionCenter();
  assert.equal(controller.getConnectionCenter().open, false);
  const second = controller.openConnectionCenter();
  catalogResolvers[1]!({
    items: [{
      id: "second-provider",
      kind: "search",
      displayName: "第二次目录",
      capabilities: []
    }],
    nextCursor: null
  });
  connectionResolvers[1]!({
    items: [providerConnection({ id: "second-connection" })],
    nextCursor: null
  });
  await second;

  catalogResolvers[0]!({
    items: [{
      id: "stale-provider",
      kind: "search",
      displayName: "过期目录",
      capabilities: []
    }],
    nextCursor: null
  });
  connectionResolvers[0]!({
    items: [providerConnection({ id: "stale-connection" })],
    nextCursor: null
  });
  await first;

  const center = controller.getConnectionCenter();
  assert.equal(center.open, true);
  assert.deepEqual(center.providers.map((item) => item.id), ["second-provider"]);
  assert.deepEqual(
    center.connections.map((item) => item.id),
    ["second-connection"]
  );
});

test("新建连接强制 disabled 且任何公开状态都不保留 API Key", async () => {
  const fixtureKey = "fixture-provider-key-never-store";
  let createInput: unknown;
  let createKey = "";
  let connectionReads = 0;
  const disabled = providerConnection({
    id: "conn-created",
    status: "disabled",
    lastHealthAt: null,
    lastHealthStatus: "untested",
    lastHealthMessage: "尚未测试"
  });
  const { api } = createApi({
    listProviderConnections: async () => {
      connectionReads += 1;
      return {
        items: connectionReads === 1 ? [] : [disabled],
        nextCursor: null
      };
    },
    createProviderConnection: async (input, key) => {
      createInput = input;
      createKey = key;
      return disabled;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.openConnectionCenter();
  controller.selectConnectionCenterProvider("baidu");

  await controller.saveProviderConnection(fixtureKey);

  assert.deepEqual(createInput, {
    providerId: "baidu",
    apiKey: fixtureKey,
    status: "disabled"
  });
  assert.match(createKey, /^ai-growth-provider-connection:/);
  assert.equal(connectionReads, 2);
  assert.equal(controller.getConnectionCenter().mutationStatus, "idle");
  assert.equal(
    controller.getConnectionCenter().selectedConnectionId,
    "conn-created"
  );
  assert.doesNotMatch(JSON.stringify(controller.getState()), /fixture-provider-key/);
  assert.doesNotMatch(
    JSON.stringify(controller.getConnectionCenter()),
    /fixture-provider-key/
  );
});

test("关闭重开会废弃保存锁且迟到保存不能覆盖新一轮状态", async () => {
  let releaseFirstSave!: () => void;
  const firstSaveGate = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  let saves = 0;
  const { api } = createApi({
    listProviderConnections: async () => ({ items: [], nextCursor: null }),
    createProviderConnection: async () => {
      saves += 1;
      const current = saves;
      if (current === 1) await firstSaveGate;
      return providerConnection({
        id: `conn-save-${current}`,
        status: "disabled",
        lastHealthAt: null,
        lastHealthStatus: "untested"
      });
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.openConnectionCenter();
  controller.selectConnectionCenterProvider("baidu");
  const staleSave = controller.saveProviderConnection("fixture-stale-key");

  controller.closeConnectionCenter();
  await controller.openConnectionCenter();
  controller.selectConnectionCenterProvider("baidu");
  const currentSave = controller.saveProviderConnection("fixture-current-key");
  releaseFirstSave();
  await Promise.all([staleSave, currentSave]);

  assert.equal(saves, 2);
  assert.equal(
    controller.getConnectionCenter().selectedConnectionId,
    "conn-save-2"
  );
  assert.doesNotMatch(
    JSON.stringify(controller.getConnectionCenter()),
    /fixture-(?:stale|current)-key/
  );
});

test("测试失败不能启用而测试通过后才能成为健康连接", async () => {
  let current = providerConnection({
    status: "disabled",
    lastHealthAt: null,
    lastHealthStatus: "untested",
    lastHealthMessage: "尚未测试"
  });
  let tests = 0;
  const updates: unknown[] = [];
  const { api } = createApi({
    listProviderConnections: async () => ({
      items: [current],
      nextCursor: null
    }),
    testProviderConnection: async () => {
      tests += 1;
      const ok = tests === 2;
      current = providerConnection({
        ...current,
        lastHealthAt: "2026-08-06T01:00:00.000Z",
        lastHealthStatus: ok ? "passed" : "failed",
        lastErrorCode: ok ? null : "invalid_api_key",
        lastHealthMessage: ok ? "连接正常" : "凭据无效"
      });
      return {
        ok,
        message: current.lastHealthMessage,
        errorCode: current.lastErrorCode,
        retryable: false,
        retryAfterAt: null,
        usage: "search"
      };
    },
    updateProviderConnection: async (_id, input) => {
      updates.push(input);
      current = providerConnection({ ...current, status: "active" });
      return current;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.openConnectionCenter();
  controller.selectConnectionCenterConnection("conn-search");

  await controller.testProviderConnection();

  assert.equal(controller.getConnectionCenter().health?.ok, false);
  assert.equal(
    controller.getConnectionCenter().connections[0]?.lastHealthStatus,
    "failed"
  );
  await assert.rejects(
    () => controller.setProviderConnectionEnabled(true),
    /测试通过/
  );
  assert.deepEqual(updates, []);

  await controller.testProviderConnection();
  await controller.setProviderConnectionEnabled(true);

  assert.equal(controller.getConnectionCenter().health?.ok, true);
  assert.deepEqual(updates, [{ status: "active" }]);
  assert.equal(controller.getConnectionCenter().connections[0]?.status, "active");
  assert.equal(
    controller.getConnectionCenter().connections[0]?.lastHealthStatus,
    "passed"
  );
});

test("禁用仅提交状态、轮换回到未测试 disabled、删除后刷新", async () => {
  const fixtureKey = "fixture-rotation-key-never-store";
  let current: ProviderConnectionDto | null = providerConnection();
  const updates: unknown[] = [];
  const deletions: string[] = [];
  const { api } = createApi({
    listProviderConnections: async () => ({
      items: current ? [current] : [],
      nextCursor: null
    }),
    updateProviderConnection: async (_id, input) => {
      updates.push(input);
      if ("apiKey" in input) {
        current = providerConnection({
          credentialVersion: 2,
          status: "disabled",
          lastHealthAt: null,
          lastHealthStatus: "untested",
          lastHealthMessage: "尚未测试"
        });
      } else {
        current = providerConnection({ status: input.status });
      }
      return current;
    },
    deleteProviderConnection: async (id) => {
      deletions.push(id);
      current = null;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.openConnectionCenter();
  controller.selectConnectionCenterConnection("conn-search");

  await controller.setProviderConnectionEnabled(false);
  assert.deepEqual(updates[0], { status: "disabled" });

  await controller.saveProviderConnection(fixtureKey);
  assert.deepEqual(updates[1], {
    apiKey: fixtureKey,
    status: "disabled"
  });
  assert.equal(
    controller.getConnectionCenter().connections[0]?.lastHealthStatus,
    "untested"
  );
  assert.doesNotMatch(
    JSON.stringify(controller.getConnectionCenter()),
    /fixture-rotation-key/
  );

  await controller.deleteProviderConnection();
  assert.deepEqual(deletions, ["conn-search"]);
  assert.deepEqual(controller.getConnectionCenter().connections, []);
  assert.equal(controller.getConnectionCenter().selectedConnectionId, null);
});

test("系统托管搜索连接在客户端拒绝密钥轮换", async () => {
  let updates = 0;
  const { api } = createApi({
    listProviderConnections: async () => ({
      items: [providerConnection({
        id: "conn-system",
        ownerId: "system",
        teamId: null,
        lastHealthAt: null,
        lastHealthStatus: "untested",
        lastHealthMessage: "系统托管来源"
      })],
      nextCursor: null
    }),
    updateProviderConnection: async () => {
      updates += 1;
      return providerConnection();
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.openConnectionCenter();
  controller.selectConnectionCenterConnection("conn-system");

  await assert.rejects(
    () => controller.saveProviderConnection("fixture-system-key"),
    /只读/
  );

  assert.equal(updates, 0);
  assert.doesNotMatch(
    JSON.stringify(controller.getConnectionCenter()),
    /fixture-system-key/
  );
});

test("健康连接就绪后沿原方案路径继续并保留抖音任务载荷", async () => {
  let current: ProviderConnectionDto[] = [];
  let requestedMessage = "";
  let requestedPlatform = "";
  const { api } = createApi({
    listProviderConnections: async () => ({ items: current, nextCursor: null }),
    requestPlanDraft: async (
      _sessionId,
      message,
      _idempotencyKey,
      targetPlatform
    ) => {
      requestedMessage = message;
      requestedPlatform = targetPlatform;
      return {
        id: "task-after-connection",
        status: "succeeded",
        result: { planDraft: { ...planDraft, targetPlatform } }
      } as never;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  controller.selectTemplate("beauty");
  controller.setTaskText("寻找抖音上的上海美业采购需求");

  await controller.submit();
  assert.equal(controller.getState().status, "connection_required");
  current = [providerConnection()];
  await controller.openConnectionCenter();

  await controller.continueAfterConnection();

  assert.equal(controller.getConnectionCenter().open, false);
  assert.equal(controller.getState().status, "awaiting_approval");
  assert.equal(requestedMessage, "寻找抖音上的上海美业采购需求");
  assert.equal(requestedPlatform, "douyin");
  assert.equal(controller.getState().templateId, "beauty");
  assert.equal(controller.getView(), "workflow");
});

test("保存、测试、更新和删除在进行中都会合并重复点击", async (t) => {
  await t.test("保存", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const idempotencyKeys: string[] = [];
    const { api } = createApi({
      listProviderConnections: async () => ({ items: [], nextCursor: null }),
      createProviderConnection: async (_input, key) => {
        calls += 1;
        idempotencyKeys.push(key);
        await gate;
        return providerConnection({ status: "disabled" });
      }
    });
    const controller = createAiGrowthController(controllerOptions(api));
    await controller.openConnectionCenter();
    controller.selectConnectionCenterProvider("baidu");
    const first = controller.saveProviderConnection("fixture-dedup-key");
    const duplicate = controller.saveProviderConnection("fixture-dedup-key");
    assert.equal(first, duplicate);
    assert.equal(calls, 1);
    release();
    await first;
    controller.selectConnectionCenterProvider("baidu");
    await controller.saveProviderConnection("fixture-distinct-save-key");
    assert.equal(calls, 2);
    assert.notEqual(idempotencyKeys[0], idempotencyKeys[1]);
  });

  await t.test("测试", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { api } = createApi({
      testProviderConnection: async () => {
        calls += 1;
        await gate;
        return {
          ok: true,
          message: "连接正常",
          errorCode: null,
          retryable: false,
          retryAfterAt: null,
          usage: "search"
        };
      }
    });
    const controller = createAiGrowthController(controllerOptions(api));
    await controller.openConnectionCenter();
    controller.selectConnectionCenterConnection("conn-search");
    const first = controller.testProviderConnection();
    const duplicate = controller.testProviderConnection();
    assert.equal(first, duplicate);
    assert.equal(calls, 1);
    release();
    await first;
  });

  await t.test("更新", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { api } = createApi({
      updateProviderConnection: async () => {
        calls += 1;
        await gate;
        return providerConnection({ status: "disabled" });
      }
    });
    const controller = createAiGrowthController(controllerOptions(api));
    await controller.openConnectionCenter();
    controller.selectConnectionCenterConnection("conn-search");
    const first = controller.setProviderConnectionEnabled(false);
    const duplicate = controller.setProviderConnectionEnabled(false);
    assert.equal(first, duplicate);
    assert.equal(calls, 1);
    release();
    await first;
  });

  await t.test("删除", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { api } = createApi({
      deleteProviderConnection: async () => {
        calls += 1;
        await gate;
      }
    });
    const controller = createAiGrowthController(controllerOptions(api));
    await controller.openConnectionCenter();
    controller.selectConnectionCenterConnection("conn-search");
    const first = controller.deleteProviderConnection();
    const duplicate = controller.deleteProviderConnection();
    assert.equal(first, duplicate);
    assert.equal(calls, 1);
    release();
    await first;
  });
});

test("保存错误只暴露安全文案且可在失败后重试", async () => {
  const fixtureKey = "fixture-upstream-echo-key";
  let attempts = 0;
  let connectionReads = 0;
  const saved = providerConnection({ status: "disabled" });
  const { api } = createApi({
    listProviderConnections: async () => {
      connectionReads += 1;
      return {
        items: connectionReads === 1 ? [] : [saved],
        nextCursor: null
      };
    },
    createProviderConnection: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error(`upstream echoed ${fixtureKey}`) as Error & {
          status: number;
        };
        error.status = 422;
        throw error;
      }
      return saved;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));
  await controller.openConnectionCenter();
  controller.selectConnectionCenterProvider("baidu");

  await assert.rejects(
    () => controller.saveProviderConnection(fixtureKey),
    /连接配置无效/
  );

  assert.equal(controller.getConnectionCenter().mutationStatus, "idle");
  assert.equal(
    controller.getConnectionCenter().error?.message,
    "连接配置无效，请检查后重试"
  );
  assert.doesNotMatch(
    JSON.stringify(controller.getConnectionCenter()),
    /fixture-upstream-echo-key|upstream echoed/
  );

  await controller.saveProviderConnection("fixture-retry-key");

  assert.equal(attempts, 2);
  assert.equal(controller.getConnectionCenter().error, null);
  assert.equal(controller.getConnectionCenter().message, "连接已保存，请测试后再启用");
});

test("候选更新按 candidateId 合并并校验当前批准版本后才转换", async () => {
  const { api, calls } = createApi();
  const controller = createAiGrowthController(controllerOptions(api));
  controller.applyCandidateUpdate(approvedCandidate);
  await controller.convertAndCreateTodo(approvedCandidate.id);
  assert.equal(calls.convert, 1);
  assert.equal(calls.todo, 1);

  const stale = {
    ...approvedCandidate,
    approvedDecisionVersion: "decision-old"
  };
  const staleApi = createApi({ getCandidate: async () => stale });
  const staleController = createAiGrowthController(
    controllerOptions(staleApi.api)
  );
  await assert.rejects(
    () => staleController.convertAndCreateTodo(stale.id),
    /当前资格决定/
  );
  assert.equal(staleApi.calls.convert, 0);
});

test("待办失败时复用 conversion 且不重复 convert", async () => {
  let todoAttempts = 0;
  const { api, calls } = createApi({
    createTodoForConversion: async () => {
      todoAttempts += 1;
      if (todoAttempts === 1) throw new Error("todo failed");
      return {
        id: "todo-1",
        ownerId: "user-1",
        teamId: "team-1",
        title: "跟进示例制造企业",
        type: "customer",
        priority: "high",
        dueAt: "2026-07-27T09:00:00.000Z",
        related: "lead-1",
        done: false
      };
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));

  await assert.rejects(
    () => controller.convertAndCreateTodo(approvedCandidate.id),
    /todo failed/
  );
  assert.equal(calls.convert, 1);
  await controller.convertAndCreateTodo(approvedCandidate.id);
  assert.equal(calls.convert, 1);
  assert.equal(todoAttempts, 2);
});

test("并发转换在首次读取前合并且只写一次 conversion 和 todo", async () => {
  let releaseCandidate!: () => void;
  const candidateGate = new Promise<void>((resolve) => {
    releaseCandidate = resolve;
  });
  const operationCalls = { getCandidate: 0, convert: 0, todo: 0 };
  const { api } = createApi({
    getCandidate: async () => {
      operationCalls.getCandidate += 1;
      if (operationCalls.getCandidate === 1) await candidateGate;
      return approvedCandidate;
    },
    convertCandidate: async () => {
      operationCalls.convert += 1;
      return {
        id: "conversion-1",
        candidateId: approvedCandidate.id,
        decisionVersion: "decision-1",
        partyRef: {},
        leadId: "lead-1",
        reviewerId: "user-1",
        evidenceSnapshotHash: "hash",
        createdAt: "2026-07-26T09:00:00.000Z"
      };
    },
    createTodoForConversion: async () => {
      operationCalls.todo += 1;
      return {
        id: "todo-1",
        ownerId: "user-1",
        teamId: "team-1",
        title: "跟进示例制造企业",
        type: "customer",
        priority: "high",
        dueAt: "2026-07-27T09:00:00.000Z",
        related: "lead-1",
        done: false
      };
    }
  });
  const controller = createAiGrowthController(controllerOptions(api));

  const first = controller.convertAndCreateTodo(approvedCandidate.id);
  const second = controller.convertAndCreateTodo(approvedCandidate.id);
  await Promise.resolve();
  assert.equal(operationCalls.getCandidate, 1);

  releaseCandidate();
  await Promise.all([first, second]);
  assert.equal(operationCalls.convert, 1);
  assert.equal(operationCalls.todo, 1);
});

test("demo 切到 real 清除演示 runner、候选和运行指针", () => {
  const { api } = createApi();
  let disposed = 0;
  const controller = createAiGrowthController(controllerOptions(api, {
    demoRunnerFactory: () => ({
      start: () => undefined,
      approve: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      jumpToResult: () => undefined,
      dispose: () => {
        disposed += 1;
      }
    })
  }));
  controller.setMode("demo");
  controller.applyCandidateUpdate(approvedCandidate);
  controller.setMode("real");
  assert.equal(disposed, 1);
  assert.equal(controller.getState().runId, null);
  assert.equal(controller.getState().candidatesById.size, 0);
  assert.equal(controller.getState().status, "idle");
});

test("demo 回放打开内置只读作战卡且没有作战卡时关闭抽屉并提示", async () => {
  const { api, calls } = createApi();
  const reads = {
    candidate: 0,
    evidence: 0,
    qualification: 0,
    financial: 0,
    battleCard: 0
  };
  const toasts: string[] = [];
  const controller = createAiGrowthController(controllerOptions(api, {
    toast: (message) => toasts.push(message),
    drawerFactory: (options) => createBattleCardDrawer(options),
    api: {
      ...api,
      getCandidate: async () => {
        reads.candidate += 1;
        return approvedCandidate;
      },
      getEvidence: async () => {
        reads.evidence += 1;
        return { items: [], nextCursor: null };
      },
      getQualification: async () => {
        reads.qualification += 1;
        throw new Error("demo must not read qualification");
      },
      getFinancialValue: async () => {
        reads.financial += 1;
        throw new Error("demo must not read financial value");
      },
      getBattleCard: async () => {
        reads.battleCard += 1;
        return demoFixture.battleCard;
      }
    } as AiGrowthControllerApi
  }));
  controller.setMode("demo");
  controller.jumpToDemoResult();

  await controller.openCandidate("demo-candidate-1");

  assert.equal(controller.getDrawer().getState().open, true);
  assert.equal(controller.getDrawer().getState().readOnly, true);
  assert.match(controller.getDrawer().render().html, /客户作战卡/);
  assert.match(controller.getDrawer().render().html, /演示数据 · 只读/);
  assert.deepEqual(reads, {
    candidate: 0,
    evidence: 0,
    qualification: 0,
    financial: 0,
    battleCard: 0
  });

  await controller.openCandidate("demo-candidate-2");

  assert.equal(controller.getDrawer().getState().open, false);
  assert.equal(toasts.at(-1), "演示作战卡尚未生成");
  await assert.rejects(
    () => controller.convertAndCreateTodo("demo-candidate-1"),
    /演示模式不会写入/
  );

  assert.equal(calls.convert, 0);
  assert.equal(calls.todo, 0);
});

test("real candidate opening performs the five authoritative GET reads", async () => {
  const reads: string[] = [];
  const firstEvent = demoFixture.runPresentation.candidateEvents[0]!;
  const { api } = createApi({
    getCandidate: async () => {
      reads.push("candidate");
      return approvedCandidate;
    },
    getEvidence: async () => {
      reads.push("evidence");
      return { items: [], nextCursor: null };
    },
    getQualification: async () => {
      reads.push("qualification");
      return firstEvent.qualification!;
    },
    getFinancialValue: async () => {
      reads.push("financial");
      return firstEvent.financialValue!;
    },
    getBattleCard: async () => {
      reads.push("battle-card");
      return demoFixture.battleCard;
    }
  });
  const controller = createAiGrowthController(controllerOptions(api, {
    drawerFactory: (options) => createBattleCardDrawer(options)
  }));

  await controller.openCandidate("candidate-1");

  assert.deepEqual(reads.sort(), [
    "battle-card",
    "candidate",
    "evidence",
    "financial",
    "qualification"
  ]);
});

test("demo 隐藏真实最近任务且继续任务不会发请求或启动 poller", async () => {
  const pointer = {
    sessionId: "session-1",
    planId: "plan-1",
    runId: "run-1",
    updatedAt: "2026-07-26T09:00:00.000Z"
  };
  const requests = { run: 0, plan: 0, pollerStart: 0 };
  const { api } = createApi({
    getRun: async () => {
      requests.run += 1;
      return run();
    },
    getPlan: async () => {
      requests.plan += 1;
      return {
        ...planDraft,
        id: "plan-1",
        etag: "\"plan-1:approved\"",
        status: "approved",
        version: 2
      };
    }
  });
  const controller = createAiGrowthController(controllerOptions(api, {
    recentStorage: {
      getItem: () => JSON.stringify([pointer]),
      setItem: () => undefined,
      removeItem: () => undefined
    },
    pollerFactory: () => ({
      start: () => {
        requests.pollerStart += 1;
      },
      stop: () => undefined,
      dispose: () => undefined,
      cursor: () => null
    })
  }));
  controller.setMode("demo");
  controller.enter();
  const root = { innerHTML: "" } as HTMLElement;
  controller.render(root);

  assert.doesNotMatch(root.innerHTML, /继续任务/);
  await assert.rejects(
    () => controller.continueRecent(pointer.runId),
    /演示模式/
  );
  assert.deepEqual(requests, { run: 0, plan: 0, pollerStart: 0 });
});

test("最近任务解析后只保留四个允许字段", () => {
  const allowed = {
    sessionId: "session-1",
    planId: "plan-1",
    runId: "run-1",
    updatedAt: "2026-07-26T09:00:00.000Z"
  };
  const { api } = createApi();
  const controller = createAiGrowthController(controllerOptions(api, {
    recentStorage: {
      getItem: () => JSON.stringify([{
        ...allowed,
        candidateText: "不应保留",
        apiKey: "secret"
      }]),
      setItem: () => undefined,
      removeItem: () => undefined
    }
  }));

  controller.enter();
  assert.deepEqual(controller.getRecentTasks(), [allowed]);
});

test("最近任务校验在 leave 或 dispose 后不得写存储或发布", async () => {
  for (const lifecycle of ["leave", "dispose"] as const) {
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let storageWrites = 0;
    let publishes = 0;
    const { api } = createApi({
      getRun: async () => {
        await runGate;
        return run();
      }
    });
    const controller = createAiGrowthController(controllerOptions(api, {
      onChange: () => {
        publishes += 1;
      },
      recentStorage: {
        getItem: () => JSON.stringify([{
          sessionId: "session-1",
          planId: "plan-1",
          runId: "run-1",
          updatedAt: "2026-07-26T09:00:00.000Z"
        }]),
        setItem: () => {
          storageWrites += 1;
        },
        removeItem: () => undefined
      }
    }));

    controller.enter();
    controller[lifecycle]();
    const publishesAfterLifecycle = publishes;
    releaseRun();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(storageWrites, 0, lifecycle);
    assert.equal(publishes, publishesAfterLifecycle, lifecycle);
  }
});

test("leave 和 dispose 清理 poller、演示 runner与 drawers", async () => {
  const { api } = createApi();
  const calls = { pollerStop: 0, pollerDispose: 0, demoDispose: 0, close: 0 };
  const controller = createAiGrowthController(controllerOptions(api, {
    pollerFactory: () => ({
      start: () => undefined,
      stop: () => {
        calls.pollerStop += 1;
      },
      dispose: () => {
        calls.pollerDispose += 1;
      },
      cursor: () => null
    }),
    demoRunnerFactory: () => ({
      start: () => undefined,
      approve: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      jumpToResult: () => undefined,
      dispose: () => {
        calls.demoDispose += 1;
      }
    }),
    drawerFactory: () => ({
      ...(controllerOptions(api).drawerFactory!({} as never)),
      close: () => {
        calls.close += 1;
      }
    })
  }));
  controller.setMode("demo");
  const openingConnections = controller.openConnectionCenter();
  assert.equal(controller.getConnectionCenter().open, true);
  controller.leave();
  assert.equal(controller.getConnectionCenter().open, false);
  await openingConnections;
  controller.dispose();
  assert.ok(calls.pollerStop >= 1);
  assert.equal(calls.pollerDispose, 1);
  assert.ok(calls.demoDispose >= 1);
  assert.ok(calls.close >= 1);
});

test("真实模式不会因演示 timer 改变业务状态", async () => {
  let resolveTask!: (value: unknown) => void;
  const task = new Promise((resolve) => {
    resolveTask = resolve;
  });
  const { api } = createApi({
    requestPlanDraft: async () => task as never
  });
  let demoCreated = 0;
  const controller = createAiGrowthController(controllerOptions(api, {
    demoRunnerFactory: () => {
      demoCreated += 1;
      throw new Error("真实模式不应创建演示 runner");
    }
  }));
  const submit = controller.submit();
  await Promise.resolve();
  assert.equal(controller.getState().status, "planning");
  assert.equal(demoCreated, 0);
  resolveTask({
    id: "task-1",
    status: "succeeded",
    result: { planDraft }
  });
  await submit;
  assert.equal(controller.getState().status, "awaiting_approval");
});

void (undefined as unknown as AiGrowthApi);
