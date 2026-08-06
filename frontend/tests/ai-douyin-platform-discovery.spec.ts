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
  idempotencyKey: string | null;
  ifMatch: string | null;
};

type FixtureHandler = (
  request: FixtureRequest
) => FixtureResponse | Promise<FixtureResponse>;

class StrictDouyinFixture {
  readonly requests: FixtureRequest[] = [];
  readonly unexpected: FixtureRequest[] = [];
  private readonly handlers = new Map<string, FixtureHandler[]>();

  on(
    method: string,
    pathname: string,
    ...responses: Array<FixtureResponse | FixtureHandler>
  ) {
    this.handlers.set(
      `${method.toUpperCase()} ${pathname}`,
      responses.map((response): FixtureHandler =>
        typeof response === "function" ? response : () => response
      )
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
      const headers = request.headers();
      const record: FixtureRequest = {
        method: request.method().toUpperCase(),
        pathname: url.pathname,
        search: url.search,
        body,
        idempotencyKey: headers["idempotency-key"] ?? null,
        ifMatch: headers["if-match"] ?? null
      };
      this.requests.push(record);
      const queue = this.handlers.get(
        `${record.method} ${record.pathname}`
      );
      if (!queue || queue.length === 0) {
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
      const handler = queue.length > 1 ? queue.shift()! : queue[0]!;
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

const timestamp = "2026-08-06T01:00:00.000Z";
const planId = "plan/抖音 公开商机-001";
const encodedPlanId = encodeURIComponent(planId);
const taskPath = `/api/v1/acquisition/tasks/${encodedPlanId}`;
const runId = "run-douyin-public-001";
const candidateId = "candidate-douyin-public-001";
const evidenceId = "evidence-douyin-public-001";
const allowedQueries = [
  "site:douyin.com 苏州 制造业 数字化 采购",
  "site:iesdouyin.com 苏州 制造业 数字化 采购"
];

const connection = {
  id: "search-connection-baidu-001",
  ownerId: "u_manager_alex",
  teamId: "europe",
  providerId: "baidu_ai_search",
  kind: "search",
  status: "active",
  credentialVersion: 5,
  lastHealthAt: timestamp,
  lastHealthStatus: "passed",
  lastErrorCode: null,
  lastHealthMessage: "fixture connection ready",
  usage: "public search",
  createdAt: timestamp
};

const modelSnapshotRef = {
  jobSnapshotId: "snapshot-douyin-001",
  connectionId: "model-connection-zhipu-001",
  credentialVersion: 3,
  provider: "zhipu",
  model: "glm-4.5",
  capabilitySnapshotHash: "sha256:capability-douyin-001",
  promptVersion: "acquisition-plan-draft-v2",
  schemaVersion: "acquisition-plan-v1",
  promptHash: "sha256:prompt-douyin-001",
  schemaHash: "sha256:schema-douyin-001"
};

const budgetSnapshot = {
  billingCurrency: "CNY",
  maxRequests: 8,
  maxResults: 40,
  maxAmountMinor: 2_000,
  maxDurationSeconds: 90
};

const planDraft = {
  targetPlatform: "douyin",
  name: "抖音制造业公开商机发现",
  objective: "发现抖音公开索引页面中有数字化采购信号的苏州制造企业",
  icp: {
    industries: ["装备制造"],
    regions: ["苏州"],
    organizationCriteria: ["有公开扩产或数字化采购信号"],
    individualCriteria: [],
    exclusionRules: ["勿扰名单", "缺少可回溯公开来源"]
  },
  subjectChannels: { organization: true, individual: false },
  providerConnections: [{
    connectionId: connection.id,
    providerId: connection.providerId,
    kind: "search",
    status: "active",
    credentialVersion: connection.credentialVersion
  }],
  operations: allowedQueries.map((query, index) => ({
    operationId: `douyin-search-${index + 1}`,
    subjectChannel: "organization",
    kind: "search",
    connectionId: connection.id,
    query,
    allocatedBudget: {
      requests: 4,
      results: 20,
      amountMinor: 1_000,
      durationSeconds: 45
    }
  })),
  budgetSnapshot,
  modelSnapshotRef,
  stopConditions: {
    stopWhenBudgetExhausted: true,
    stopWhenNoMoreResults: true
  }
};

const plan = {
  id: planId,
  ownerId: "u_manager_alex",
  teamId: "europe",
  status: "draft",
  version: 1,
  revision: 1,
  etag: '"plan-douyin-public-001:1"',
  currentVersionId: "plan-version-douyin-001",
  approvedVersionId: null,
  approvedSnapshotHash: null,
  approvedBy: null,
  approvedAt: null,
  budgetSnapshot,
  payload: planDraft,
  createdBy: "u_manager_alex",
  createdAt: timestamp,
  updatedBy: "u_manager_alex",
  updatedAt: timestamp
};

const approvedPlan = {
  ...plan,
  status: "approved",
  revision: 2,
  etag: '"plan-douyin-public-001:2"',
  approvedVersionId: plan.currentVersionId,
  approvedSnapshotHash: "sha256:approved-douyin-001",
  approvedBy: "u_manager_alex",
  approvedAt: timestamp
};

const run = {
  id: runId,
  ownerId: "u_manager_alex",
  teamId: "europe",
  planId,
  planVersionId: plan.currentVersionId,
  planVersion: 1,
  planSnapshotHash: "sha256:plan-douyin-001",
  parentRunId: null,
  status: "succeeded",
  terminationIntent: null,
  revision: 2,
  etag: `"${runId}:2"`,
  budgetSnapshotId: "budget-douyin-001",
  budgetSnapshot,
  budgetSnapshotHash: "sha256:budget-douyin-001",
  billingCurrency: "CNY",
  modelSnapshotRef,
  consumedBudget: {
    requests: 2,
    results: 2,
    amountMinor: 400,
    durationSeconds: 12
  },
  evidenceCount: 1,
  reason: "fixture completed",
  createdBy: "u_manager_alex",
  createdAt: timestamp,
  updatedBy: "acquisition-worker",
  updatedAt: timestamp,
  completedAt: timestamp
};

const evidence = {
  id: evidenceId,
  targetType: "organization",
  sourcePlatform: "douyin",
  sourceTitle: "抖音公开视频：澜星智造数字化产线扩建",
  sourceSnippet: "公开搜索摘要显示企业正在扩建数字化产线并征集合作方",
  publishedAt: "2026-08-01T00:00:00.000Z",
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "sha256:raw-douyin-evidence-001",
  contentHash: "sha256:content-douyin-evidence-001",
  provenance: {
    kind: "search_result",
    provider: "baidu_ai_search",
    providerConnectionId: connection.id,
    requestId: "preq-douyin-public-001",
    providerRecordId: "baidu-result-douyin-public-001",
    sourceUrl: "https://www.douyin.com/video/7390012345678901234",
    queryText: allowedQueries[0],
    resultRank: 1,
    sourceType: "video"
  },
  accessStatus: "indexed_summary"
};

const qualification = {
  id: "qualification-douyin-001",
  candidateId,
  decisionVersion: "qualification.douyin:1",
  decisionEngine: "model",
  grade: "A",
  score: 89,
  recommendedAction: "priority_review",
  evidence: [{
    evidenceId,
    excerpt: evidence.sourceSnippet
  }],
  positiveSignals: [{ name: "公开扩产与采购信号", score: 27 }],
  negativeSignals: [],
  reasons: ["需求信号来自可回溯的抖音公开页面"],
  confidence: 0.9,
  ruleVersion: "qualification.douyin",
  promptVersion: "qualification.douyin",
  modelProvider: "zhipu",
  model: "glm-4.5",
  hardGateFailures: [],
  createdAt: timestamp
};

const financialValue = {
  id: "financial-douyin-001",
  candidateId,
  qualificationDecisionId: qualification.id,
  version: "financial.douyin:1",
  grade: "A",
  score: 82,
  currency: "CNY",
  expectedRevenueMinor: 880_000,
  expectedGrossProfitMinor: 352_000,
  expectedContributionMinor: 190_000,
  factors: {
    profitability: 0.74,
    cashFlow: 0.69,
    creditQuality: 0.78,
    repeatPotential: 0.64,
    referralPotential: 0.48,
    closeProbability: 0.6
  },
  createdAt: timestamp
};

const candidate = {
  id: candidateId,
  subjectKind: "organization",
  name: "苏州澜星智造（测试样例）",
  domain: "https://lanxing.example.test",
  region: "苏州",
  creditCode: null,
  status: "pending_review",
  version: 1,
  identityResolved: true,
  latestDecisionVersion: qualification.decisionVersion,
  approvedDecisionVersion: null,
  evidenceIds: [evidenceId],
  createdAt: timestamp,
  updatedAt: timestamp
};

const battleCard = {
  id: "battle-card-douyin-001",
  candidateId,
  qualificationDecisionId: qualification.id,
  partyType: "organization",
  evidenceIds: [evidenceId],
  confidence: 0.86,
  modelProvider: "zhipu",
  model: "glm-4.5",
  promptVersion: "battle-card.douyin",
  schemaVersion: "battle-card.v2",
  createdAt: timestamp,
  intelligence: {
    accountOverview: [{
      kind: "fact",
      text: "苏州装备制造企业，抖音公开页面显示数字化产线扩建",
      evidenceIds: [evidenceId],
      confidence: 1
    }],
    needAssessment: [{
      kind: "fact",
      text: "有可回溯的公开扩产与系统合作信号",
      evidenceIds: [evidenceId],
      confidence: 0.95
    }],
    supplierHypotheses: [{
      kind: "inference",
      text: "可能已有产线集成供应商，建议从数据协同补位切入",
      evidenceIds: [evidenceId],
      confidence: 0.63
    }],
    buyingCommittee: [{
      role: "数字化负责人",
      priority: 1,
      influence: "decision_maker",
      concerns: ["实施周期", "数据连通"],
      claim: {
        kind: "inference",
        text: "数字化负责人可能参与供应商筛选",
        evidenceIds: [evidenceId],
        confidence: 0.61
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
        text: "以扩产中的数据协同问题切入",
        evidenceIds: [evidenceId],
        confidence: 0.7
      },
      openingDraft: "看到贵司公开页面提到数字化产线扩建，想先交流数据协同难点。"
    }],
    roleSpecificOpeners: [{
      role: "数字化负责人",
      channel: "email",
      text: "围绕扩产中的数据协同做一次短诊断。"
    }],
    doNotActions: ["不要把搜索摘要当成完整评论扫描", "未经人工审核不要触达"],
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

const providerPresentation = {
  shardId: "shard-douyin-001",
  connectionId: connection.id,
  providerId: connection.providerId,
  status: "succeeded",
  rawResultCount: 2,
  acceptedResultCount: 1,
  duplicateResultCount: 0,
  failedResultCount: 0,
  errorCode: null,
  retryAfterAt: null
};

const presentation = {
  run: {
    id: run.id,
    status: run.status,
    etag: run.etag,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt
  },
  providers: [providerPresentation],
  summary: {
    sourcesSearched: 1,
    pagesAnalyzed: 2,
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
    eventId: "candidate-event-douyin-001",
    createdAt: timestamp,
    candidateId,
    candidate: {
      id: candidateId,
      subjectKind: "organization",
      displayName: candidate.name,
      industry: "装备制造",
      region: candidate.region,
      domain: candidate.domain,
      status: candidate.status,
      version: candidate.version,
      identityResolved: candidate.identityResolved,
      updatedAt: timestamp
    },
    qualification,
    financialValue,
    sourcePlatforms: ["douyin"],
    evidenceCount: 1
  }],
  nextAfter: "douyin-complete-cursor",
  hasMore: false
};

const task = {
  id: planId,
  planId,
  name: planDraft.name,
  objective: planDraft.objective,
  platform: "douyin",
  discoveryMethods: ["public_search"],
  planStatus: "approved",
  latestRun: {
    id: run.id,
    status: run.status,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    evidenceCount: run.evidenceCount,
    consumedBudget: run.consumedBudget
  },
  updatedAt: timestamp
};

const taskDetail = {
  task,
  plan: approvedPlan,
  latestRun: run,
  shards: [],
  presentation
};

const unresolvedPlanDraft = {
  ...planDraft,
  name: "抖音门店公开需求信号发现",
  objective: "发现抖音公开索引页面中表达获客困难的厦门门店经营者",
  icp: {
    ...planDraft.icp,
    industries: ["本地生活"],
    regions: ["厦门"],
    organizationCriteria: [],
    individualCriteria: ["公开视频或评论摘要中出现明确获客困难"],
    exclusionRules: ["身份未核验不得评分", "勿扰名单"]
  },
  subjectChannels: { organization: false, individual: true },
  operations: [{
    operationId: "douyin-search-individual-1",
    subjectChannel: "individual",
    kind: "search",
    connectionId: connection.id,
    query: "site:douyin.com 厦门 门店 获客",
    allocatedBudget: {
      requests: 4,
      results: 20,
      amountMinor: 1_000,
      durationSeconds: 45
    }
  }]
};

const unresolvedPlan = {
  ...plan,
  payload: unresolvedPlanDraft
};

const unresolvedApprovedPlan = {
  ...approvedPlan,
  payload: unresolvedPlanDraft
};

const unresolvedEvidence = {
  ...evidence,
  targetType: "individual_signal",
  sourceTitle: "夏季门店经营复盘",
  sourceSnippet: "公开搜索摘要：咨询量不少，但有效到店客户不多。",
  publishedAt: null,
  provenance: {
    ...evidence.provenance,
    providerRecordId: "baidu-result-douyin-unresolved-001",
    sourceUrl: "https://www.douyin.com/video/7521000000000000010",
    queryText: unresolvedPlanDraft.operations[0].query
  }
};

const unresolvedCandidate = {
  id: candidateId,
  publicActorKey: "unresolved-public-signal:douyin:sha256:fixture",
  publicDisplayName: "抖音公开需求信号（身份待核实）",
  publicProfileUrl: unresolvedEvidence.provenance.sourceUrl,
  sourcePlatform: "douyin",
  evidenceIds: [evidenceId],
  demandCategory: "门店获客",
  demandSummary: unresolvedEvidence.sourceSnippet,
  locationHint: "厦门",
  buyingStage: "problem_defined",
  negativeSignals: [],
  subjectKind: "individual",
  status: "unresolvable",
  version: 1,
  identityResolved: false,
  latestDecisionVersion: null,
  approvedDecisionVersion: null,
  updatedAt: timestamp,
  firstSeenAt: timestamp,
  lastSeenAt: timestamp
};

const unresolvedPresentation = {
  ...presentation,
  summary: {
    ...presentation.summary,
    organizationsFound: 0,
    validOpportunities: 0,
    highIntent: 0,
    financialEvaluatedHighIntentCount: 0,
    expectedRevenueByCurrency: []
  },
  candidateEvents: [{
    eventId: "candidate-event-douyin-unresolved-001",
    createdAt: timestamp,
    candidateId,
    candidate: {
      id: candidateId,
      subjectKind: "individual",
      displayName: unresolvedCandidate.publicDisplayName,
      industry: null,
      region: unresolvedCandidate.locationHint,
      domain: unresolvedCandidate.publicProfileUrl,
      status: unresolvedCandidate.status,
      version: unresolvedCandidate.version,
      identityResolved: unresolvedCandidate.identityResolved,
      updatedAt: timestamp
    },
    qualification: null,
    financialValue: null,
    sourcePlatforms: ["douyin"],
    evidenceCount: 1
  }]
};

const unresolvedTask = {
  ...task,
  name: unresolvedPlanDraft.name,
  objective: unresolvedPlanDraft.objective
};

const unresolvedTaskDetail = {
  ...taskDetail,
  task: unresolvedTask,
  plan: unresolvedApprovedPlan,
  presentation: unresolvedPresentation
};

function configureFixture(fixture: StrictDouyinFixture) {
  fixture
    .on("GET", "/api/todos", { body: { todos: [] } })
    .on("GET", "/api/v1/acquisition/overview", {
      body: {
        generatedAt: timestamp,
        platform: "douyin",
        totals: { tasks: 0 },
        statusCounts: {},
        discoveryMethodCounts: {},
        tasks: []
      }
    })
    .on("GET", "/api/v1/acquisition/tasks", {
      body: { items: [], nextCursor: null }
    })
    .on("GET", "/api/v1/acquisition/provider-connections", {
      body: { items: [connection], nextCursor: null }
    })
    .on("POST", "/api/v1/acquisition/copilot/sessions", {
      body: {
        id: "operation-create-session-douyin-001",
        kind: "copilot_session_creation",
        status: "succeeded",
        resourceId: "copilot-session-douyin-001",
        createdAt: timestamp,
        completedAt: timestamp
      }
    })
    .on(
      "POST",
      "/api/v1/acquisition/copilot/sessions/copilot-session-douyin-001/messages",
      {
        body: {
          id: "copilot-task-douyin-001",
          sessionId: "copilot-session-douyin-001",
          kind: "message",
          status: "succeeded",
          responseMode: "plan_draft",
          targetPlatform: "douyin",
          result: { planDraft },
          errorCode: null,
          createdAt: timestamp,
          completedAt: timestamp
        }
      }
    )
    .on("POST", "/api/v1/acquisition/plans", { body: plan })
    .on("POST", `/api/v1/acquisition/plans/${encodedPlanId}/approval`, {
      body: approvedPlan
    })
    .on("POST", `/api/v1/acquisition/plans/${encodedPlanId}/runs`, {
      body: run
    })
    .on("GET", `/api/v1/acquisition/runs/${runId}/presentation`, {
      body: presentation
    })
    .on("GET", taskPath, { body: taskDetail })
    .on("GET", `/api/v1/acquisition/candidates/${candidateId}`, {
      body: candidate
    })
    .on("GET", `/api/v1/acquisition/candidates/${candidateId}/evidence`, {
      body: { items: [evidence], nextCursor: null }
    })
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidateId}/qualification`,
      { body: qualification }
    )
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidateId}/financial-value`,
      { body: financialValue }
    )
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidateId}/battle-card`,
      { body: battleCard }
    );
}

function configureUnresolvedFixture(fixture: StrictDouyinFixture) {
  configureFixture(fixture);
  fixture
    .on(
      "POST",
      "/api/v1/acquisition/copilot/sessions/copilot-session-douyin-001/messages",
      {
        body: {
          id: "copilot-task-douyin-unresolved-001",
          sessionId: "copilot-session-douyin-001",
          kind: "message",
          status: "succeeded",
          responseMode: "plan_draft",
          targetPlatform: "douyin",
          result: { planDraft: unresolvedPlanDraft },
          errorCode: null,
          createdAt: timestamp,
          completedAt: timestamp
        }
      }
    )
    .on("POST", "/api/v1/acquisition/plans", { body: unresolvedPlan })
    .on("POST", `/api/v1/acquisition/plans/${encodedPlanId}/approval`, {
      body: unresolvedApprovedPlan
    })
    .on("GET", `/api/v1/acquisition/runs/${runId}/presentation`, {
      body: unresolvedPresentation
    })
    .on("GET", taskPath, { body: unresolvedTaskDetail })
    .on("GET", `/api/v1/acquisition/candidates/${candidateId}`, {
      body: unresolvedCandidate
    })
    .on("GET", `/api/v1/acquisition/candidates/${candidateId}/evidence`, {
      body: { items: [unresolvedEvidence], nextCursor: null }
    });
}

async function login(page: Page) {
  await page.goto("/");
  await page.locator("#loginEmail").fill("alex@goodjob.com");
  await page.locator("#loginPassword").fill("goodjob123");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/u);
}

async function openAdvisor(page: Page) {
  const button = page.locator('.nav button[data-view="ai-growth"]');
  if (!(await button.isVisible())) {
    const group = button.locator("xpath=ancestor::details[1]");
    if (await group.count()) await group.locator("summary").click();
  }
  await button.click();
  await expect(page.locator("#ai-growth")).toHaveClass(/active/u);
  await expect(page).toHaveURL(/#ai-growth$/u);
}

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth
  }));
  expect(sizes.scrollWidth, JSON.stringify(sizes)).toBeLessThanOrEqual(
    sizes.clientWidth
  );
  expect(sizes.clientWidth).toBeLessThanOrEqual(sizes.innerWidth);
}

async function tabTo(page: Page, target: Locator, maxPresses = 60) {
  for (let attempt = 0; attempt < maxPresses; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  throw new Error("Tab focus did not reach requested platform control");
}

async function checkWidths(page: Page, visible: Locator) {
  for (const width of [1440, 1366, 1024]) {
    await page.setViewportSize({ width, height: 1_000 });
    await expect(visible).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
}

test("Douyin discovery compiles safe public queries and keeps provider, source and writes separate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1_000 });
  await login(page);
  const fixture = new StrictDouyinFixture();
  configureFixture(fixture);
  await fixture.install(page);

  await openAdvisor(page);
  await expect(page.getByRole("heading", { name: "抖音获客中心" }))
    .toBeVisible();
  expect(fixture.calls("GET", "/api/v1/acquisition/overview")[0]?.search)
    .toBe("?platform=douyin");
  expect(fixture.calls("GET", "/api/v1/acquisition/tasks")[0]?.search)
    .toBe("?platform=douyin&limit=20");

  await page.getByRole("button", { name: "新建获客任务" }).click();
  await expect(page).toHaveURL(/#ai-growth\/new$/u);
  const douyin = page.getByRole("button", { name: /抖音公开商机/u });
  const web = page.getByRole("button", { name: /全网公开网页/u });
  await expect(douyin).toHaveAttribute("aria-pressed", "true");
  for (const future of ["快手", "微信公众号", "微博", "小红书"]) {
    await expect(page.getByRole("button", { name: new RegExp(future, "u") }))
      .toBeDisabled();
  }
  await checkWidths(page, douyin);

  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await tabTo(page, web);
  await page.keyboard.press("Enter");
  await expect(web).toHaveAttribute("aria-pressed", "true");
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await tabTo(page, douyin);
  await page.keyboard.press("Space");
  await expect(douyin).toHaveAttribute("aria-pressed", "true");

  const intent = "寻找苏州近期有数字化采购信号的制造企业";
  await page.locator('[data-field="task-text"]').fill(intent);
  await page.getByRole("button", { name: "生成商机搜索方案" }).click();

  const planPanel = page.locator(".ai-growth-plan");
  await expect(planPanel).toBeVisible();

  const messageCalls = fixture.calls(
    "POST",
    "/api/v1/acquisition/copilot/sessions/copilot-session-douyin-001/messages"
  );
  expect(messageCalls).toHaveLength(1);
  expect(messageCalls[0]?.body).toEqual({
    message: intent,
    responseMode: "plan_draft",
    targetPlatform: "douyin"
  });
  expect(messageCalls[0]?.idempotencyKey).toMatch(
    /^ai-growth-plan-draft:/u
  );

  await expect(planPanel).toContainText("目标内容平台");
  await expect(planPanel).toContainText("抖音公开内容");
  await expect(planPanel).toContainText("搜索服务商");
  await expect(planPanel).toContainText("baidu_ai_search");
  await expect(page.getByRole("note")).toContainText(
    "不代表扫描抖音全站或全部评论"
  );
  for (const query of allowedQueries) await expect(planPanel).toContainText(query);
  for (const operation of planDraft.operations) {
    expect(operation.query).toMatch(/^site:(?:douyin\.com|iesdouyin\.com) /u);
    expect(operation.query).not.toMatch(/site:(?!douyin\.com|iesdouyin\.com)/u);
  }
  await checkWidths(page, planPanel);

  await page.getByRole("button", { name: "批准并开始执行" }).click();
  await expect(page.locator(".ai-growth-run-console"))
    .toHaveAttribute("data-status", "completed");
  await expect(page.getByText(candidate.name, { exact: true })).toBeVisible();
  await expect(page.locator(".ai-growth-provider-results"))
    .toContainText("百度 AI 搜索");
  const candidateCard = page.locator(
    `.ai-growth-candidate-card[data-candidate-id="${candidateId}"]`
  );
  await expect(candidateCard).toContainText("douyin");
  await checkWidths(page, candidateCard);

  const presentationCalls = fixture.calls(
    "GET",
    `/api/v1/acquisition/runs/${runId}/presentation`
  );
  expect(presentationCalls).toHaveLength(1);
  expect(presentationCalls[0]?.search).toBe("?limit=100");
  const createPlan = fixture.calls("POST", "/api/v1/acquisition/plans");
  expect(createPlan).toHaveLength(1);
  expect(createPlan[0]?.body).toEqual(planDraft);
  const approval = fixture.calls(
    "POST",
    `/api/v1/acquisition/plans/${encodedPlanId}/approval`
  );
  expect(approval).toHaveLength(1);
  expect(approval[0]?.ifMatch).toBe(plan.etag);

  await candidateCard.getByRole("button", { name: /查看客户作战卡/u })
    .click();
  const drawer = page.getByRole("dialog", { name: candidate.name });
  await expect(drawer).toContainText("可能已有产线集成供应商");
  await expect(drawer).toContainText("不要把搜索摘要当成完整评论扫描");
  const evidenceReference = drawer.locator(
    `[data-evidence-id="${evidenceId}"]`
  ).first();
  await expect(evidenceReference).toContainText(
    `douyin：${evidence.sourceTitle}`
  );
  await page.locator('[data-action="close-battle-card"]').last().click();

  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#ai-growth/task/${encodedPlanId}`);
  await expect(page).toHaveURL(
    new RegExp(`#ai-growth/task/${encodedPlanId}$`, "u")
  );
  await expect(page.getByRole("heading", { name: planDraft.name }))
    .toBeVisible();
  await expect(page.getByText(candidate.name, { exact: true })).toBeVisible();
  expect(fixture.calls("GET", taskPath)).toHaveLength(1);
  await checkWidths(page, page.getByRole("heading", { name: planDraft.name }));

  await page.reload();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/u);
  await expect(page).toHaveURL(
    new RegExp(`#ai-growth/task/${encodedPlanId}$`, "u")
  );
  await expect(page.getByText(candidate.name, { exact: true })).toBeVisible();
  expect(fixture.calls("GET", taskPath)).toHaveLength(2);

  const writePaths = fixture.writes().map((request) =>
    `${request.method} ${request.pathname}`
  );
  expect(writePaths).toEqual([
    "POST /api/v1/acquisition/copilot/sessions",
    "POST /api/v1/acquisition/copilot/sessions/copilot-session-douyin-001/messages",
    "POST /api/v1/acquisition/plans",
    `POST /api/v1/acquisition/plans/${encodedPlanId}/approval`,
    `POST /api/v1/acquisition/plans/${encodedPlanId}/runs`
  ]);
  expect(writePaths.some((path) =>
    /comment|reply|direct-message|private-message|friend|group|outreach/iu
      .test(path)
  )).toBe(false);
  expect(fixture.calls("POST", "/api/todos")).toHaveLength(0);
  fixture.assertNoUnexpected();
});

test("Douyin search presents ordinary video signals as unresolved and blocks downstream decisions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1_000 });
  await login(page);
  const fixture = new StrictDouyinFixture();
  configureUnresolvedFixture(fixture);
  await fixture.install(page);

  await openAdvisor(page);
  await page.getByRole("button", { name: "新建获客任务" }).click();
  const intent = "寻找厦门在抖音公开视频中表达获客困难的门店经营者";
  await page.locator('[data-field="task-text"]').fill(intent);
  await page.getByRole("button", { name: "生成商机搜索方案" }).click();

  const planPanel = page.locator(".ai-growth-plan");
  await expect(planPanel).toContainText(unresolvedPlanDraft.operations[0].query);
  await page.getByRole("button", { name: "批准并开始执行" }).click();

  const runConsole = page.locator(".ai-growth-run-console");
  await expect(runConsole).toHaveAttribute("data-status", "completed");
  await expect(runConsole).toContainText(
    "发现 1 个公开需求信号待核验；不是已确认客户"
  );
  const candidateCard = page.locator(
    `.ai-growth-candidate-card[data-candidate-id="${candidateId}"]`
  );
  await expect(candidateCard).toHaveAttribute(
    "data-review-status",
    "unresolvable"
  );
  await expect(candidateCard).toHaveAttribute(
    "data-identity-state",
    "unresolved"
  );
  await expect(candidateCard).toContainText("主体确认后评估");
  await expect(candidateCard.locator(".ai-growth-character-icon"))
    .toHaveText("需");
  await expect(candidateCard.locator(".ai-growth-candidate-score"))
    .toHaveCount(0);
  await expect(candidateCard.getByText("查看客户作战卡", { exact: true }))
    .toHaveCount(0);
  await expect(candidateCard.getByRole("button", { name: "核验主体" }))
    .toBeVisible();
  await expect(candidateCard.getByRole("button", { name: "查看发现依据" }))
    .toBeVisible();

  await candidateCard.getByRole("button", { name: "查看发现依据" }).click();
  const drawer = page.getByRole("dialog", {
    name: unresolvedCandidate.publicDisplayName
  });
  await expect(drawer.getByRole("heading", { name: "主体核验" }))
    .toBeVisible();
  await expect(drawer).toContainText("搜索结果不是已核验的客户身份");
  await expect(drawer).toContainText(unresolvedEvidence.sourceTitle);
  await expect(drawer).toContainText("百度搜索");
  await expect(drawer.locator('[data-field="identity-profile-url"]'))
    .toHaveValue("");
  await expect(drawer.getByRole("button", { name: "确认主体并继续" }))
    .toBeDisabled();

  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/candidates/${candidateId}/qualification`
  )).toHaveLength(0);
  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/candidates/${candidateId}/financial-value`
  )).toHaveLength(0);
  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/candidates/${candidateId}/battle-card`
  )).toHaveLength(0);
  expect(fixture.writes().some((request) =>
    /qualification|financial-value|battle-card|review|convert|outreach/iu
      .test(request.pathname)
  )).toBe(false);
  expect(fixture.calls("POST", "/api/todos")).toHaveLength(0);
  fixture.assertNoUnexpected();
});
