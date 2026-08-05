import test from "node:test";
import assert from "node:assert/strict";
import {
  createAiGrowthApi,
  type AdvisorRequest,
  type ProviderConnectionDto
} from "./api.js";
import {
  createAiGrowthController,
  type AiGrowthControllerApi
} from "./controller.js";
import type {
  AcquisitionTaskOverviewDto,
  AcquisitionTaskSummaryDto
} from "./types.js";

const task: AcquisitionTaskSummaryDto = {
  id: "plan-1",
  planId: "plan-1",
  name: "抖音外贸 <script>alert(1)</script>",
  objective: "寻找公开采购需求",
  platform: "douyin",
  discoveryMethods: ["public_search"],
  planStatus: "approved",
  latestRun: {
    id: "run-1",
    status: "running",
    updatedAt: "2026-08-05T09:05:00.000Z",
    completedAt: null,
    evidenceCount: 7,
    consumedBudget: {
      requests: 2,
      results: 7,
      durationSeconds: 11
    }
  },
  updatedAt: "2026-08-05T09:05:00.000Z"
};

const stoppedTask: AcquisitionTaskSummaryDto = {
  ...task,
  id: "plan-2",
  planId: "plan-2",
  name: "已完成任务",
  latestRun: {
    ...task.latestRun!,
    id: "run-2",
    status: "succeeded",
    completedAt: "2026-08-05T09:10:00.000Z",
    evidenceCount: 5
  }
};

const noRunTask: AcquisitionTaskSummaryDto = {
  ...task,
  id: "plan-empty",
  planId: "plan-empty",
  name: "待启动任务",
  latestRun: null
};

const overview: AcquisitionTaskOverviewDto = {
  generatedAt: "2026-08-05T09:06:00.000Z",
  platform: "douyin",
  totals: { tasks: 2 },
  statusCounts: { running: 1, succeeded: 1 },
  discoveryMethodCounts: { public_search: 2 },
  tasks: [task, stoppedTask]
};

const connection: ProviderConnectionDto = {
  id: "connection-1",
  ownerId: "user-1",
  teamId: "team-1",
  providerId: "baidu",
  kind: "search",
  status: "active",
  credentialVersion: 1,
  lastHealthAt: "2026-08-05T09:00:00.000Z",
  lastHealthStatus: "passed",
  lastErrorCode: null,
  lastHealthMessage: "ok",
  usage: "public search",
  createdAt: "2026-08-05T08:00:00.000Z"
};

const modelSnapshotRef = {
  jobSnapshotId: "snapshot-1",
  connectionId: "model-connection-1",
  credentialVersion: 1,
  provider: "openai",
  model: "gpt-4o-mini",
  capabilitySnapshotHash: "sha256:capability",
  promptVersion: "v1",
  schemaVersion: "v1",
  promptHash: "sha256:prompt",
  schemaHash: "sha256:schema"
};

const planPayload = {
  name: "抖音外贸需求",
  objective: "寻找公开采购需求",
  icp: {
    industries: ["制造业"],
    regions: ["上海"],
    organizationCriteria: ["有采购意向"],
    individualCriteria: [],
    exclusionRules: []
  },
  subjectChannels: { organization: true, individual: false },
  providerConnections: [{
    connectionId: "connection-1",
    providerId: "baidu",
    kind: "search",
    status: "active",
    credentialVersion: 1
  }],
  operations: [{
    operationId: "search-1",
    subjectChannel: "organization",
    kind: "search",
    connectionId: "connection-1",
    query: "site:douyin.com 制造业 采购",
    allocatedBudget: {
      requests: 5,
      results: 20,
      amountMinor: 0,
      durationSeconds: 30
    }
  }],
  budgetSnapshot: {
    billingCurrency: "CNY",
    maxRequests: 5,
    maxResults: 20,
    maxAmountMinor: 0,
    maxDurationSeconds: 30
  },
  modelSnapshotRef,
  stopConditions: {
    stopWhenBudgetExhausted: true,
    stopWhenNoMoreResults: true
  }
} as const;

const authoritativePlan = {
  id: "plan-1",
  ownerId: "user-1",
  teamId: "team-1",
  status: "approved",
  version: 2,
  revision: 2,
  etag: "\"plan-1:2\"",
  currentVersionId: "plan-version-2",
  approvedVersionId: "plan-version-2",
  approvedSnapshotHash: "sha256:approved",
  approvedBy: "user-1",
  approvedAt: "2026-08-05T09:00:00.000Z",
  budgetSnapshot: planPayload.budgetSnapshot,
  payload: planPayload,
  createdBy: "user-1",
  createdAt: "2026-08-05T08:00:00.000Z",
  updatedBy: "user-1",
  updatedAt: "2026-08-05T09:00:00.000Z"
} as const;

const fullRun = {
  id: "run-1",
  ownerId: "user-1",
  teamId: "team-1",
  planId: "plan-1",
  planVersionId: "plan-version-2",
  planVersion: 2,
  planSnapshotHash: "sha256:plan",
  parentRunId: null,
  status: "running",
  terminationIntent: null,
  revision: 1,
  etag: "\"run-1:1\"",
  budgetSnapshotId: "budget-1",
  budgetSnapshot: planPayload.budgetSnapshot,
  budgetSnapshotHash: "sha256:budget",
  billingCurrency: "CNY",
  modelSnapshotRef,
  consumedBudget: {
    requests: 2,
    results: 7,
    amountMinor: 0,
    durationSeconds: 11
  },
  evidenceCount: 7,
  reason: "已批准",
  createdBy: "user-1",
  createdAt: "2026-08-05T09:01:00.000Z",
  updatedBy: "worker-1",
  updatedAt: "2026-08-05T09:05:00.000Z",
  completedAt: null
} as const;

const presentation = {
  run: {
    id: "run-1",
    status: "running",
    etag: "\"run-1:1\"",
    updatedAt: "2026-08-05T09:05:00.000Z",
    completedAt: null
  },
  providers: [],
  summary: {
    sourcesSearched: 1,
    pagesAnalyzed: 2,
    organizationsFound: 0,
    dedupedCandidates: 0,
    validOpportunities: 0,
    highIntent: 0,
    financialEvaluatedHighIntentCount: 0,
    financialPendingHighIntentCount: 0,
    expectedRevenueByCurrency: []
  },
  candidateEvents: [],
  nextAfter: "cursor-1",
  hasMore: false
} as const;

function controllerApi(overrides: Record<string, unknown> = {}) {
  return {
    getTaskOverview: async () => overview,
    listAcquisitionTasks: async () => ({
      items: [task, stoppedTask],
      nextCursor: null
    }),
    getAcquisitionTask: async () => ({
      task,
      plan: authoritativePlan,
      latestRun: fullRun,
      shards: [],
      presentation
    }),
    listProviderConnections: async () => ({
      items: [connection],
      nextCursor: null
    }),
    getRunPresentation: async () => presentation,
    ...overrides
  } as unknown as AiGrowthControllerApi;
}

function makeController(
  api: AiGrowthControllerApi,
  options: { user?: boolean; initialView?: "overview" | "workflow" } = {}
) {
  const pollerStarts: Array<[string, string]> = [];
  const controller = createAiGrowthController({
    api,
    user: () => options.user === false ? null : { id: "user-1" },
    toast: () => undefined,
    navigate: () => undefined,
    initialView: options.initialView,
    pollerFactory: () => ({
      start: (runId: string, mode: "real" | "demo") =>
        pollerStarts.push([runId, mode]),
      stop: () => undefined,
      dispose: () => undefined,
      cursor: () => null
    })
  } as never);
  return { controller, pollerStarts };
}

test("overview API reads use the three exact GET paths", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push([path, init]);
    return {};
  }) as AdvisorRequest;
  const api = createAiGrowthApi(request) as unknown as {
    getTaskOverview(): Promise<unknown>;
    listAcquisitionTasks(): Promise<unknown>;
    getAcquisitionTask(planId: string): Promise<unknown>;
  };

  await api.getTaskOverview();
  await api.listAcquisitionTasks();
  await api.getAcquisitionTask("plan / 抖音");

  assert.deepEqual(calls, [
    ["/api/v1/acquisition/overview?platform=douyin", undefined],
    ["/api/v1/acquisition/tasks?platform=douyin&limit=20", undefined],
    ["/api/v1/acquisition/tasks/plan%20%2F%20%E6%8A%96%E9%9F%B3", undefined]
  ]);
});

test("task overview renderer derives real metrics and escapes task facts", async () => {
  const { renderTaskOverview } = await import(
    "./components/task-overview.js"
  );
  const rendered = renderTaskOverview({
    mode: "real",
    status: "ready",
    tasks: [task, stoppedTask],
    connections: [connection],
    connectionStatus: "ready",
    generatedAt: overview.generatedAt,
    errorMessage: null
  }, {} as never).html;

  assert.match(rendered, /抖音 · 公开搜索/);
  assert.match(rendered, /快手[\s\S]*待接入/);
  assert.match(rendered, /微信公众号[\s\S]*待接入/);
  assert.match(rendered, /微博[\s\S]*待接入/);
  assert.match(rendered, /小红书[\s\S]*待接入/);
  assert.match(rendered, />2<\/strong>/);
  assert.match(rendered, />12<\/strong>/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /128|42 位客户|模拟运行中|假收入/);
});

test("overview renderer keeps empty, error, partial, no-connection, and demo states explicit", async () => {
  const { renderTaskOverview } = await import(
    "./components/task-overview.js"
  );
  const cases = [
    {
      status: "empty",
      mode: "real",
      tasks: [],
      connections: [connection],
      connectionStatus: "ready",
      errorMessage: null,
      expected: "还没有真实抖音获客任务"
    },
    {
      status: "error",
      mode: "real",
      tasks: [],
      connections: [],
      connectionStatus: "error",
      errorMessage: "任务总览暂时不可用",
      expected: "重试"
    },
    {
      status: "partial_error",
      mode: "real",
      tasks: [task],
      connections: [connection],
      connectionStatus: "ready",
      errorMessage: "部分数据加载失败",
      expected: "部分数据加载失败"
    },
    {
      status: "ready",
      mode: "real",
      tasks: [task],
      connections: [],
      connectionStatus: "ready",
      errorMessage: null,
      expected: "需配置"
    },
    {
      status: "demo",
      mode: "demo",
      tasks: [],
      connections: [],
      connectionStatus: "ready",
      errorMessage: null,
      expected: "演示模式 · 演示数据"
    }
  ] as const;

  for (const item of cases) {
    const rendered = renderTaskOverview({
      ...item,
      generatedAt: null
    }, {} as never).html;
    assert.match(rendered, new RegExp(item.expected), item.status);
    if (item.tasks.length > 0) assert.match(rendered, /打开任务/);
  }
});

test("AI growth hash parser and builder keep fixed overview, new, and encoded task routes", async () => {
  const { buildAiGrowthHash, parseAiGrowthHash } = await import(
    "./components/task-overview.js"
  );

  assert.deepEqual(parseAiGrowthHash("#ai-growth"), { name: "overview" });
  assert.deepEqual(parseAiGrowthHash("#ai-growth/new"), { name: "new" });
  assert.deepEqual(
    parseAiGrowthHash("#ai-growth/task/plan%20%2F%20%E6%8A%96%E9%9F%B3"),
    { name: "task", planId: "plan / 抖音" }
  );
  assert.deepEqual(parseAiGrowthHash("#ai-growth/task/%E0%A4%A"), {
    name: "overview"
  });
  assert.equal(
    buildAiGrowthHash({ name: "task", planId: "plan / 抖音" }),
    "#ai-growth/task/plan%20%2F%20%E6%8A%96%E9%9F%B3"
  );
});

test("default real overview loads tasks and connections, including partial source failure", async () => {
  let overviewReads = 0;
  const { controller } = makeController(controllerApi({
    getTaskOverview: async () => {
      overviewReads += 1;
      throw new Error("overview unavailable");
    }
  }), { initialView: "overview" });

  controller.enter();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(overviewReads, 1);
  assert.equal((controller as never as { getView(): string }).getView(), "overview");
  const vm = (controller as never as {
    getTaskOverview(): { status: string; tasks: unknown[]; connectionStatus: string };
  }).getTaskOverview();
  assert.equal(vm.status, "partial_error");
  assert.equal(vm.tasks.length, 2);
  assert.equal(vm.connectionStatus, "ready");
});

test("overview does not read APIs before login", async () => {
  let reads = 0;
  const api = controllerApi({
    getTaskOverview: async () => {
      reads += 1;
      return overview;
    },
    listAcquisitionTasks: async () => {
      reads += 1;
      return { items: [], nextCursor: null };
    },
    listProviderConnections: async () => {
      reads += 1;
      return { items: [], nextCursor: null };
    }
  });
  const { controller } = makeController(api, {
    user: false,
    initialView: "overview"
  });

  controller.enter();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(reads, 0);
});

test("opening an authoritative task hydrates plan.payload and polls only a non-terminal run", async () => {
  const { controller, pollerStarts } = makeController(controllerApi());

  await (controller as never as {
    openTask(planId: string): Promise<void>;
  }).openTask("plan-1");

  assert.equal(controller.getState().planDraft?.objective, planPayload.objective);
  assert.equal(controller.getState().runId, "run-1");
  assert.deepEqual(pollerStarts, [["run-1", "real"]]);
  assert.equal((controller as never as { getView(): string }).getView(), "task");

  const terminalDetail = {
    task: stoppedTask,
    plan: authoritativePlan,
    latestRun: { ...fullRun, id: "run-2", status: "succeeded" },
    shards: [],
    presentation: {
      ...presentation,
      run: { ...presentation.run, id: "run-2", status: "succeeded" }
    }
  };
  const terminal = makeController(controllerApi({
    getAcquisitionTask: async () => terminalDetail
  }));
  await (terminal.controller as never as {
    openTask(planId: string): Promise<void>;
  }).openTask("plan-2");
  assert.deepEqual(terminal.pollerStarts, []);
});

test("task detail without a run renders a real not-started state instead of the create form", async () => {
  const { controller } = makeController(controllerApi({
    getAcquisitionTask: async () => ({
      task: noRunTask,
      plan: { ...authoritativePlan, id: "plan-empty" },
      latestRun: null,
      shards: [],
      presentation: null
    })
  }));
  await (controller as never as {
    openTask(planId: string): Promise<void>;
  }).openTask("plan-empty");
  const root = { innerHTML: "" } as HTMLElement;

  controller.render(root);

  assert.match(root.innerHTML, /尚未启动/);
  assert.match(root.innerHTML, /返回任务总览/);
  assert.doesNotMatch(root.innerHTML, /自然语言任务/);
});

test("leaving overview suppresses a stale async completion", async () => {
  let release!: (value: typeof overview) => void;
  const deferred = new Promise<typeof overview>((resolve) => {
    release = resolve;
  });
  const { controller } = makeController(controllerApi({
    getTaskOverview: async () => deferred
  }));
  const target = controller as never as {
    showOverview(): Promise<void>;
    showNewTask(): void;
    getView(): string;
    getTaskOverview(): { tasks: unknown[] };
  };

  const loading = target.showOverview();
  target.showNewTask();
  release(overview);
  await loading;

  assert.equal(target.getView(), "workflow");
  assert.deepEqual(target.getTaskOverview().tasks, []);
});
