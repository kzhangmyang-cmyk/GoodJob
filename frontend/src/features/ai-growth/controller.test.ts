import test from "node:test";
import assert from "node:assert/strict";
import type { AiGrowthApi } from "./api.js";
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
    listProviderConnections: async () => ({
      items: [{
        id: "conn-search",
        providerId: "baidu",
        kind: "search" as const,
        status: "active" as const,
        credentialVersion: 1
      }],
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

test("leave 和 dispose 清理 poller、演示 runner与 drawer", () => {
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
  controller.leave();
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
