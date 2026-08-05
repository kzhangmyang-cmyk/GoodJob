import { expect, test, type Locator, type Page } from "@playwright/test";

type FixtureResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

type FixtureRequest = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
};

type FixtureHandler = (
  request: FixtureRequest
) => FixtureResponse | Promise<FixtureResponse>;

class StrictReadOnlyFixture {
  readonly requests: FixtureRequest[] = [];
  readonly unexpected: FixtureRequest[] = [];
  private readonly handlers = new Map<string, FixtureHandler>();

  on(
    method: string,
    pathname: string,
    response: FixtureResponse | FixtureHandler
  ) {
    this.handlers.set(
      `${method.toUpperCase()} ${pathname}`,
      typeof response === "function" ? response : () => response
    );
    return this;
  }

  async install(page: Page) {
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const tracked = url.pathname.startsWith("/api/v1/acquisition/")
        || url.pathname === "/api/todos";
      if (!tracked) {
        await route.continue();
        return;
      }

      let body: unknown = null;
      const postData = request.postData();
      if (postData) {
        try {
          body = JSON.parse(postData);
        } catch {
          body = postData;
        }
      }
      const record: FixtureRequest = {
        method: request.method().toUpperCase(),
        pathname: url.pathname,
        search: url.search,
        body
      };
      this.requests.push(record);
      const handler = this.handlers.get(
        `${record.method} ${record.pathname}`
      );
      if (!handler) {
        this.unexpected.push(record);
        await route.fulfill({
          status: 501,
          contentType: "application/json",
          body: JSON.stringify({
            code: "unexpected_acquisition_request",
            method: record.method,
            pathname: record.pathname,
            search: record.search
          })
        });
        return;
      }
      const response = await handler(record);
      await route.fulfill({
        status: response.status ?? 200,
        headers: {
          "content-type": "application/json",
          ...response.headers
        },
        body: JSON.stringify(response.body ?? {})
      });
    });
  }

  calls(method: string, pathname: string) {
    return this.requests.filter((request) =>
      request.method === method.toUpperCase()
      && request.pathname === pathname
    );
  }

  writes() {
    return this.requests.filter((request) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
    );
  }

  assertNoUnexpected() {
    expect(this.unexpected, JSON.stringify(this.unexpected, null, 2))
      .toEqual([]);
  }
}

const timestamp = "2026-08-05T08:00:00.000Z";
const planId = "plan/抖音 公开-001";
const encodedPlanId = encodeURIComponent(planId);
const taskPath = `/api/v1/acquisition/tasks/${encodedPlanId}`;

const connection = {
  id: "synthetic-search-connection",
  ownerId: "u_manager_alex",
  teamId: "europe",
  providerId: "baidu_ai_search",
  kind: "search",
  status: "active",
  credentialVersion: 4,
  lastHealthAt: timestamp,
  lastHealthStatus: "passed",
  lastErrorCode: null,
  lastHealthMessage: "synthetic fixture",
  usage: "public search fixture",
  createdAt: timestamp,
  updatedAt: timestamp
};

const modelSnapshotRef = {
  jobSnapshotId: "synthetic-model-snapshot",
  connectionId: "synthetic-model-connection",
  credentialVersion: 2,
  provider: "zhipu",
  model: "glm-4.5",
  capabilitySnapshotHash: "sha256:synthetic-capability",
  promptVersion: "synthetic-prompt-v1",
  schemaVersion: "synthetic-schema-v1",
  promptHash: "sha256:synthetic-prompt",
  schemaHash: "sha256:synthetic-schema"
};

const budgetSnapshot = {
  billingCurrency: "CNY",
  maxRequests: 6,
  maxResults: 30,
  maxAmountMinor: 0,
  maxDurationSeconds: 60
};

const planPayload = {
  name: "抖音制造业公开商机搜索",
  objective: "发现抖音公开页面中有明确数字化采购需求的企业",
  icp: {
    industries: ["装备制造"],
    regions: ["苏州"],
    organizationCriteria: ["有公开扩产或采购信号"],
    individualCriteria: [],
    exclusionRules: ["勿扰名单", "缺少公开来源"]
  },
  subjectChannels: { organization: true, individual: false },
  providerConnections: [{
    connectionId: connection.id,
    providerId: connection.providerId,
    kind: "search",
    status: "active",
    credentialVersion: connection.credentialVersion
  }],
  operations: [{
    operationId: "synthetic-douyin-search",
    subjectChannel: "organization",
    kind: "search",
    connectionId: connection.id,
    query: "site:douyin.com 苏州 制造业 数字化 采购",
    allocatedBudget: {
      requests: 6,
      results: 30,
      amountMinor: 0,
      durationSeconds: 60
    }
  }],
  budgetSnapshot,
  modelSnapshotRef,
  stopConditions: {
    stopWhenBudgetExhausted: true,
    stopWhenNoMoreResults: true
  }
};

const task = {
  id: planId,
  planId,
  name: planPayload.name,
  objective: planPayload.objective,
  platform: "douyin",
  discoveryMethods: ["public_search"],
  planStatus: "approved",
  latestRun: {
    id: "synthetic-run-succeeded",
    status: "succeeded",
    updatedAt: timestamp,
    completedAt: timestamp,
    evidenceCount: 1,
    consumedBudget: {
      requests: 1,
      results: 1,
      amountMinor: 0,
      durationSeconds: 8
    }
  },
  updatedAt: timestamp
};

const plan = {
  id: planId,
  ownerId: "u_manager_alex",
  teamId: "europe",
  status: "approved",
  version: 2,
  revision: 2,
  etag: `"${planId}:2"`,
  currentVersionId: "synthetic-plan-version-2",
  approvedVersionId: "synthetic-plan-version-2",
  approvedSnapshotHash: "sha256:synthetic-approved",
  approvedBy: "u_manager_alex",
  approvedAt: timestamp,
  budgetSnapshot,
  payload: planPayload,
  createdBy: "u_manager_alex",
  createdAt: timestamp,
  updatedBy: "u_manager_alex",
  updatedAt: timestamp
};

const run = {
  id: "synthetic-run-succeeded",
  ownerId: "u_manager_alex",
  teamId: "europe",
  planId,
  planVersionId: "synthetic-plan-version-2",
  planVersion: 2,
  planSnapshotHash: "sha256:synthetic-plan",
  parentRunId: null,
  status: "succeeded",
  terminationIntent: null,
  revision: 3,
  etag: '"synthetic-run-succeeded:3"',
  budgetSnapshotId: "synthetic-budget",
  budgetSnapshot,
  budgetSnapshotHash: "sha256:synthetic-budget",
  billingCurrency: "CNY",
  modelSnapshotRef,
  consumedBudget: task.latestRun.consumedBudget,
  evidenceCount: 1,
  reason: "synthetic fixture completed",
  createdBy: "u_manager_alex",
  createdAt: timestamp,
  updatedBy: "synthetic-worker",
  updatedAt: timestamp,
  completedAt: timestamp
};

const evidence = {
  id: "synthetic-evidence-1",
  targetType: "organization",
  sourcePlatform: "baidu_ai_search",
  sourceTitle: "合成样例：苏州澜星智造扩产公告",
  sourceSnippet: "公开页面披露新增数字化产线并征集系统合作方",
  publishedAt: "2026-08-01T00:00:00.000Z",
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "sha256:synthetic-raw-evidence",
  contentHash: "sha256:synthetic-content-evidence",
  provenance: {
    sourceUrl: "https://synthetic.example.test/douyin/public-demand"
  },
  accessStatus: "public_content"
};

const qualification = {
  id: "synthetic-qualification-1",
  candidateId: "synthetic-candidate-1",
  decisionVersion: "qualification.synthetic:1",
  decisionEngine: "model",
  grade: "A",
  score: 88,
  recommendedAction: "priority_review",
  evidence: [{
    evidenceId: evidence.id,
    excerpt: evidence.sourceSnippet
  }],
  positiveSignals: [{ name: "公开扩产采购信号", score: 26 }],
  negativeSignals: [],
  reasons: ["需求信号来自可回溯的公开页面"],
  confidence: 0.89,
  ruleVersion: "qualification.synthetic",
  promptVersion: "qualification.synthetic",
  modelProvider: "zhipu",
  model: "glm-4.5",
  hardGateFailures: [],
  createdAt: timestamp
};

const financialValue = {
  id: "synthetic-financial-1",
  candidateId: "synthetic-candidate-1",
  qualificationDecisionId: qualification.id,
  version: "financial.synthetic:1",
  grade: "A",
  score: 80,
  currency: "CNY",
  expectedRevenueMinor: 800_000,
  expectedGrossProfitMinor: 320_000,
  expectedContributionMinor: 180_000,
  factors: {
    profitability: 0.72,
    cashFlow: 0.68,
    creditQuality: 0.77,
    repeatPotential: 0.61,
    referralPotential: 0.45,
    closeProbability: 0.58
  },
  createdAt: timestamp
};

const candidate = {
  id: "synthetic-candidate-1",
  subjectKind: "organization",
  name: "苏州澜星智造（合成样例）",
  domain: "https://synthetic.example.test",
  region: "苏州",
  creditCode: null,
  status: "pending_review",
  latestDecisionVersion: qualification.decisionVersion,
  approvedDecisionVersion: null,
  evidenceIds: [evidence.id],
  createdAt: timestamp,
  updatedAt: timestamp
};

const battleCard = {
  id: "synthetic-battle-card-1",
  candidateId: candidate.id,
  qualificationDecisionId: qualification.id,
  partyType: "organization",
  evidenceIds: [evidence.id],
  confidence: 0.85,
  modelProvider: "zhipu",
  model: "glm-4.5",
  promptVersion: "battle-card.synthetic",
  schemaVersion: "battle-card.v2",
  createdAt: timestamp,
  intelligence: {
    accountOverview: [{
      kind: "fact",
      text: "苏州装备制造企业，公开页面披露数字化产线扩建",
      evidenceIds: [evidence.id],
      confidence: 1
    }],
    needAssessment: [{
      kind: "fact",
      text: "有可回溯的系统采购与扩产需求信号",
      evidenceIds: [evidence.id],
      confidence: 0.94
    }],
    supplierHypotheses: [{
      kind: "inference",
      text: "可能已有产线集成供应商，适合从数据协同补位切入",
      evidenceIds: [evidence.id],
      confidence: 0.64
    }],
    buyingCommittee: [{
      role: "数字化负责人",
      priority: 1,
      influence: "decision_maker",
      concerns: ["实施周期", "数据连通"],
      claim: {
        kind: "inference",
        text: "数字化负责人可能参与供应商筛选",
        evidenceIds: [evidence.id],
        confidence: 0.62
      }
    }],
    procurementPreferences: [{
      kind: "unknown",
      text: "公开证据不足，采购偏好未知",
      evidenceIds: [],
      confidence: null
    }],
    connectionStrategies: [{
      channel: "email",
      targetRole: "数字化负责人",
      rationale: {
        kind: "inference",
        text: "以扩产中的数据协同难题切入",
        evidenceIds: [evidence.id],
        confidence: 0.7
      },
      openingDraft: "看到贵司公开披露数字化产线扩建，想先交流数据协同的落地难点。"
    }],
    roleSpecificOpeners: [{
      role: "数字化负责人",
      channel: "email",
      text: "围绕扩产中的数据协同做一次短诊断。"
    }],
    doNotActions: ["不要把供应商假设表述为事实", "未经人工审核不要触达"],
    financialSummary: {
      decisionId: financialValue.id,
      decisionVersion: financialValue.version,
      grade: financialValue.grade,
      score: financialValue.score,
      currency: financialValue.currency,
      expectedRevenueMinor: financialValue.expectedRevenueMinor,
      expectedGrossProfitMinor: financialValue.expectedGrossProfitMinor,
      expectedContributionMinor: financialValue.expectedContributionMinor,
      factors: financialValue.factors
    }
  }
};

const presentation = {
  run: {
    id: run.id,
    status: run.status,
    etag: run.etag,
    updatedAt: timestamp,
    completedAt: timestamp
  },
  providers: [{
    shardId: "synthetic-shard-1",
    connectionId: connection.id,
    providerId: connection.providerId,
    status: "succeeded",
    rawResultCount: 1,
    acceptedResultCount: 1,
    duplicateResultCount: 0,
    failedResultCount: 0,
    errorCode: null,
    retryAfterAt: null
  }],
  summary: {
    sourcesSearched: 1,
    pagesAnalyzed: 1,
    organizationsFound: 1,
    dedupedCandidates: 1,
    validOpportunities: 1,
    highIntent: 1,
    financialEvaluatedHighIntentCount: 1,
    financialPendingHighIntentCount: 0,
    expectedRevenueByCurrency: [{
      currency: "CNY",
      amountMinor: financialValue.expectedRevenueMinor
    }]
  },
  candidateEvents: [{
    eventId: "synthetic-candidate-event-1",
    createdAt: timestamp,
    candidateId: candidate.id,
    candidate: {
      id: candidate.id,
      subjectKind: "organization",
      displayName: candidate.name,
      industry: "装备制造",
      region: candidate.region,
      domain: candidate.domain,
      status: candidate.status,
      updatedAt: timestamp
    },
    qualification,
    financialValue,
    sourcePlatforms: [connection.providerId],
    evidenceCount: 1
  }],
  nextAfter: "synthetic-complete-cursor",
  hasMore: false
};

const detail = {
  task,
  plan,
  latestRun: run,
  shards: [],
  presentation
};

function configureFixture(fixture: StrictReadOnlyFixture) {
  fixture
    .on("GET", "/api/todos", { body: { todos: [] } })
    .on("GET", "/api/v1/acquisition/overview", {
      body: {
        generatedAt: timestamp,
        platform: "douyin",
        totals: { tasks: 1 },
        statusCounts: { succeeded: 1 },
        discoveryMethodCounts: { public_search: 1 },
        tasks: [task]
      }
    })
    .on("GET", "/api/v1/acquisition/tasks", {
      body: { items: [task], nextCursor: null }
    })
    .on("GET", "/api/v1/acquisition/provider-connections", {
      body: { items: [connection], nextCursor: null }
    })
    .on("GET", taskPath, { body: detail })
    .on("GET", `/api/v1/acquisition/candidates/${candidate.id}`, {
      body: candidate
    })
    .on("GET", `/api/v1/acquisition/candidates/${candidate.id}/evidence`, {
      body: { items: [evidence], nextCursor: null }
    })
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidate.id}/qualification`,
      { body: qualification }
    )
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidate.id}/financial-value`,
      { body: financialValue }
    )
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidate.id}/battle-card`,
      { body: battleCard }
    );
}

async function login(page: Page) {
  await page.goto("/");
  await page.locator("#loginEmail").fill("alex@goodjob.com");
  await page.locator("#loginPassword").fill("goodjob123");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
}

async function openAdvisor(page: Page) {
  const button = page.locator('.nav button[data-view="ai-growth"]');
  if (!(await button.isVisible())) {
    const group = button.locator("xpath=ancestor::details[1]");
    if (await group.count()) await group.locator("summary").click();
  }
  await button.click();
  await expect(page.locator("#ai-growth")).toHaveClass(/active/);
  await expect(page).toHaveURL(/#ai-growth$/u);
}

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  expect(sizes.scrollWidth, JSON.stringify(sizes)).toBeLessThanOrEqual(
    sizes.innerWidth
  );
}

async function tabTo(page: Page, target: Locator, maxPresses = 40) {
  for (let attempt = 0; attempt < maxPresses; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  const active = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element
      ? `${element.tagName.toLowerCase()}#${element.id}.${element.className}`
      : "none";
  });
  throw new Error(`Tab did not reach target; active element: ${active}`);
}

test("real Douyin task overview restores a succeeded task and V2 battle card read-only", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const fixture = new StrictReadOnlyFixture();
  configureFixture(fixture);
  await fixture.install(page);

  await openAdvisor(page);
  await expect(page.getByRole("heading", { name: "抖音获客中心" }))
    .toBeVisible();
  await expect(page.getByText("抖音 · 公开搜索", { exact: true }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "真实任务总览" }))
    .toBeVisible();
  await expect(page.getByText(planPayload.name, { exact: true }))
    .toBeVisible();

  const overviewCalls = fixture.calls(
    "GET",
    "/api/v1/acquisition/overview"
  );
  expect(overviewCalls).toHaveLength(1);
  expect(overviewCalls[0]?.search).toBe("?platform=douyin");
  const taskListCalls = fixture.calls("GET", "/api/v1/acquisition/tasks");
  expect(taskListCalls).toHaveLength(1);
  expect(taskListCalls[0]?.search).toBe("?platform=douyin&limit=20");
  expect(fixture.calls(
    "GET",
    "/api/v1/acquisition/provider-connections"
  )).toHaveLength(1);

  const openTask = page.getByRole("button", { name: "打开任务" });
  for (const width of [1440, 1366, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(openTask).toBeVisible();
    await expect(page.getByRole("button", { name: "新建获客任务" }))
      .toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  await tabTo(page, openTask);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`#ai-growth/task/${encodedPlanId}$`, "u")
  );
  await expect(page.getByRole("heading", { name: planPayload.name }))
    .toBeVisible();
  await expect(page.locator(".ai-growth-run-console"))
    .toHaveAttribute("data-status", "completed");
  await expect(page.getByText(candidate.name, { exact: true }))
    .toBeVisible();
  expect(fixture.calls("GET", taskPath)).toHaveLength(1);
  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/runs/${run.id}/presentation`
  )).toHaveLength(0);

  const back = page.getByRole("button", { name: /\u8fd4回任务总览/u });
  for (const width of [1440, 1366, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(back).toBeVisible();
    await expect(page.getByText(candidate.name, { exact: true }))
      .toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await tabTo(page, back);

  await page.locator(
    `.ai-growth-candidate-card[data-candidate-id="${candidate.id}"] `
      + '[data-action="open-battle-card"]'
  ).click();
  const drawer = page.getByRole("dialog", { name: candidate.name });
  await expect(drawer.getByRole("heading", { name: "供应商" }))
    .toBeVisible();
  await expect(drawer).toContainText("可能已有产线集成供应商");
  await expect(drawer.getByRole("heading", { name: "决策链" }))
    .toBeVisible();
  await expect(drawer).toContainText("数字化负责人");
  await expect(drawer.getByRole("heading", { name: "采购偏好" }))
    .toBeVisible();
  await expect(drawer).toContainText("采购偏好未知");
  await expect(drawer).toContainText("推测 · 置信度");
  await expect(drawer).toContainText("未经人工审核不要触达");
  const evidenceReferences = drawer.locator(
    `[data-evidence-id="${evidence.id}"]`
  );
  await expect(evidenceReferences).toHaveCount(5);
  await expect(evidenceReferences.first()).toContainText(evidence.sourceTitle);

  await page.locator('[data-action="close-battle-card"]').last().click();
  const hashBeforeReload = await page.evaluate(() => location.hash);
  expect(hashBeforeReload).toBe(`#ai-growth/task/${encodedPlanId}`);
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page).toHaveURL(
    new RegExp(`#ai-growth/task/${encodedPlanId}$`, "u")
  );
  await expect(page.getByRole("heading", { name: planPayload.name }))
    .toBeVisible();
  await expect(page.getByText(candidate.name, { exact: true }))
    .toBeVisible();
  expect(fixture.calls("GET", taskPath)).toHaveLength(2);

  expect(fixture.writes()).toEqual([]);
  fixture.assertNoUnexpected();
});
