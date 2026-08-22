import { expect, test, type Page, type Route } from "@playwright/test";

type JsonObject = Record<string, unknown>;
type FixtureResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};
type FixtureHandler = (
  request: FixtureRequest
) => FixtureResponse | Promise<FixtureResponse>;

interface FixtureRequest {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
  idempotencyKey: string | null;
  ifMatch: string | null;
}

const timestamp = "2026-07-27T06:00:00.000Z";

class StrictAcquisitionFixture {
  readonly requests: FixtureRequest[] = [];
  readonly unexpected: FixtureRequest[] = [];
  private readonly handlers = new Map<string, FixtureHandler[]>();

  on(
    method: string,
    pathname: string,
    ...responses: Array<FixtureResponse | FixtureHandler>
  ) {
    const handlers = responses.map((response): FixtureHandler =>
      typeof response === "function" ? response : () => response
    );
    this.handlers.set(`${method.toUpperCase()} ${pathname}`, handlers);
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
        method: request.method(),
        pathname: url.pathname,
        search: url.search,
        body,
        idempotencyKey: headers["idempotency-key"] ?? null,
        ifMatch: headers["if-match"] ?? null
      };
      this.requests.push(record);
      const key = `${record.method} ${record.pathname}`;
      const queue = this.handlers.get(key);
      if (!queue || queue.length === 0) {
        this.unexpected.push(record);
        await route.fulfill({
          status: 501,
          contentType: "application/json",
          body: JSON.stringify({
            code: "unexpected_acquisition_request",
            method: record.method,
            pathname: record.pathname
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

  assertNoUnexpected() {
    expect(this.unexpected, JSON.stringify(this.unexpected, null, 2))
      .toEqual([]);
  }
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
  await expect(page.locator("#aiGrowthRoot")).toBeVisible();
}

const providerConnection = {
  id: "search-connection-1",
  ownerId: "u_manager_alex",
  teamId: "europe",
  providerId: "baidu_ai_search",
  kind: "search",
  status: "active",
  credentialVersion: 3,
  createdAt: timestamp,
  updatedAt: timestamp
};

const planDraft = {
  name: "长三角制造企业数字化商机",
  objective: "寻找近期有数字化采购需求的制造企业",
  icp: {
    industries: ["装备制造"],
    regions: ["上海", "苏州"],
    organizationCriteria: ["50 人以上", "有公开采购或扩张信号"],
    individualCriteria: [],
    exclusionRules: ["勿扰名单", "缺少公开来源"]
  },
  subjectChannels: { organization: true, individual: false },
  providerConnections: [{
    connectionId: "search-connection-1",
    providerId: "baidu_ai_search",
    kind: "search",
    status: "active",
    credentialVersion: 3
  }],
  operations: [{
    operationId: "operation-organization-1",
    subjectChannel: "organization",
    kind: "search",
    connectionId: "search-connection-1",
    query: "上海 装备制造 数字化采购 招标 扩张",
    allocatedBudget: {
      requests: 4,
      results: 20,
      amountMinor: 1_000,
      durationSeconds: 30
    }
  }],
  budgetSnapshot: {
    billingCurrency: "CNY",
    maxRequests: 8,
    maxResults: 40,
    maxAmountMinor: 2_000,
    maxDurationSeconds: 90
  },
  stopConditions: {
    stopWhenBudgetExhausted: true,
    stopWhenNoMoreResults: true
  },
  modelConnectionId: null
};

const plan = {
  ...planDraft,
  id: "plan-e2e-1",
  etag: '"plan-e2e-1:1"',
  status: "draft",
  version: 1
};

const qualification = {
  id: "qualification-candidate-1",
  candidateId: "candidate-1",
  decisionVersion: "qualification.v1:7",
  decisionEngine: "model",
  grade: "S",
  score: 92,
  recommendedAction: "priority_review",
  evidence: [{
    evidenceId: "evidence-1",
    excerpt: "公司官网公开披露正在扩建数字化产线"
  }],
  positiveSignals: [{ name: "扩产与数字化采购", score: 28 }],
  negativeSignals: [],
  reasons: ["公开扩产公告与目标解决方案高度匹配"],
  confidence: 0.91,
  ruleVersion: "qualification.v1",
  promptVersion: "acquisition-qualification-v1",
  modelProvider: "zhipu",
  model: "glm-4.5",
  hardGateFailures: [],
  createdAt: timestamp
};

const financialValue = {
  id: "financial-candidate-1",
  candidateId: "candidate-1",
  qualificationDecisionId: qualification.id,
  version: "financial.v1:3",
  grade: "S",
  score: 86,
  currency: "CNY",
  expectedRevenueMinor: 5_800_000,
  expectedGrossProfitMinor: 2_320_000,
  expectedContributionMinor: 1_450_000,
  factors: {
    profitability: 0.84,
    cashFlow: 0.75,
    creditQuality: 0.82,
    repeatPotential: 0.7,
    referralPotential: 0.58,
    closeProbability: 0.62
  },
  createdAt: timestamp
};

const evidence = {
  id: "evidence-1",
  targetType: "organization",
  sourcePlatform: "baidu_ai_search",
  sourceTitle: "远岚智能装备数字化产线扩建公告",
  sourceSnippet: "公司官网公开披露正在扩建数字化产线",
  publishedAt: "2026-07-20T00:00:00.000Z",
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "raw-evidence-1",
  contentHash: "content-evidence-1",
  provenance: { sourceUrl: "https://yuanlan.example.com/news/digital-line" },
  accessStatus: "public_content"
};

const candidate = (
  status: "normalized" | "pending_review" | "approved" | "converted_to_lead"
) => ({
  id: "candidate-1",
  subjectKind: "organization",
  name: "远岚智能装备",
  domain: "https://yuanlan.example.com",
  region: "上海",
  creditCode: null,
  status,
  latestDecisionVersion: status === "normalized"
    ? null
    : qualification.decisionVersion,
  approvedDecisionVersion: status === "approved"
    || status === "converted_to_lead"
    ? qualification.decisionVersion
    : null,
  evidenceIds: ["evidence-1"],
  createdAt: timestamp,
  updatedAt: timestamp
});

const candidateEvent = (
  status: "normalized" | "pending_review",
  eventId: string,
  includeDecisions: boolean
) => ({
  eventId,
  createdAt: timestamp,
  candidateId: "candidate-1",
  candidate: {
    id: "candidate-1",
    subjectKind: "organization",
    displayName: "远岚智能装备",
    industry: "装备制造",
    region: "上海",
    domain: "https://yuanlan.example.com",
    status,
    updatedAt: timestamp
  },
  qualification: includeDecisions ? qualification : null,
  financialValue: includeDecisions ? financialValue : null,
  sourcePlatforms: ["baidu_ai_search"],
  evidenceCount: 1
});

const summary = {
  sourcesSearched: 1,
  pagesAnalyzed: 2,
  organizationsFound: 1,
  dedupedCandidates: 1,
  validOpportunities: 1,
  highIntent: 1,
  financialEvaluatedHighIntentCount: 1,
  financialPendingHighIntentCount: 0,
  expectedRevenueByCurrency: [{ currency: "CNY", amountMinor: 5_800_000 }]
};

const run = (
  status:
    | "running"
    | "paused"
    | "cancelled"
    | "succeeded"
    | "partial_success",
  version: number
) => ({
  id: "run-e2e-1",
  status,
  etag: `"run-e2e-1:${version}"`,
  updatedAt: timestamp,
  completedAt: ["succeeded", "partial_success", "cancelled"].includes(status)
    ? timestamp
    : null
});

const provider = (
  status: "running" | "succeeded" | "failed" | "partial_success"
) => ({
  shardId: "shard-1",
  connectionId: "search-connection-1",
  providerId: "baidu_ai_search",
  status,
  rawResultCount: status === "running" ? 0 : 2,
  acceptedResultCount: status === "running" ? 0 : 1,
  duplicateResultCount: 0,
  failedResultCount: status === "failed" ? 1 : 0,
  errorCode: status === "failed" ? "PROVIDER_RATE_LIMITED" : null,
  retryAfterAt: null
});

const battleCardV2 = {
  id: "battle-card-candidate-1",
  candidateId: "candidate-1",
  qualificationDecisionId: qualification.id,
  partyType: "organization",
  evidenceIds: ["evidence-1"],
  confidence: 0.88,
  modelProvider: "zhipu",
  model: "glm-4.5",
  promptVersion: "acquisition-battle-card-v2",
  schemaVersion: "battle-card.v2",
  createdAt: timestamp,
  intelligence: {
    accountOverview: [{
      kind: "fact",
      text: "上海装备制造企业，官网公开披露数字化产线扩建",
      evidenceIds: ["evidence-1"],
      confidence: 1
    }],
    needAssessment: [{
      kind: "fact",
      text: "近期存在数字化采购与扩产需求信号",
      evidenceIds: ["evidence-1"],
      confidence: 0.96
    }],
    supplierHypotheses: [{
      kind: "inference",
      text: "可能已有产线集成供应商，适合从补位能力切入",
      evidenceIds: ["evidence-1"],
      confidence: 0.63
    }],
    buyingCommittee: [{
      role: "运营负责人",
      priority: 1,
      influence: "influencer",
      concerns: ["实施周期", "数据连通"],
      claim: {
        kind: "inference",
        text: "运营负责人可能是需求发起人",
        evidenceIds: ["evidence-1"],
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
      targetRole: "运营负责人",
      rationale: {
        kind: "inference",
        text: "以扩产中的流程协同问题切入",
        evidenceIds: ["evidence-1"],
        confidence: 0.7
      },
      openingDraft: "看到贵司正在扩建数字化产线，想先交流流程协同的落地难点。"
    }],
    roleSpecificOpeners: [{
      role: "运营负责人",
      channel: "email",
      text: "围绕扩产中的流程协同与数据连通做一次短诊断。"
    }],
    doNotActions: ["不要把供应商假设表述为事实", "未经审核不要触达"],
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

function planDraftTask() {
  return {
    id: "copilot-task-plan-1",
    sessionId: "copilot-session-1",
    kind: "message",
    status: "succeeded",
    responseMode: "plan_draft",
    result: { planDraft },
    errorCode: null,
    createdAt: timestamp,
    completedAt: timestamp
  };
}

function configurePlanning(
  fixture: StrictAcquisitionFixture,
  initialRun = run("running", 1)
) {
  fixture
    .on("GET", "/api/v1/acquisition/provider-connections", {
      body: { items: [providerConnection], nextCursor: null }
    })
    .on("POST", "/api/v1/acquisition/copilot/sessions", {
      body: {
        id: "copilot-session-1",
        status: "active",
        createdAt: timestamp
      }
    })
    .on(
      "POST",
      "/api/v1/acquisition/copilot/sessions/copilot-session-1/messages",
      { body: planDraftTask() }
    )
    .on("POST", "/api/v1/acquisition/plans", { body: plan })
    .on("POST", "/api/v1/acquisition/plans/plan-e2e-1/approval", {
      body: { ...plan, status: "approved", etag: '"plan-e2e-1:2"' }
    })
    .on("POST", "/api/v1/acquisition/plans/plan-e2e-1/runs", {
      body: initialRun
    });
}

async function startRealRun(page: Page) {
  await page.locator('[data-field="task-text"]')
    .fill("寻找上海近期有数字化采购需求的制造企业");
  await page.locator('[data-action="submit-task"]').click();
  await expect(page.locator(".ai-growth-plan")).toBeVisible();
  await page.locator('[data-action="approve-plan"]').click();
}

test.describe("AI acquisition loop", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("real run catches up two presentation pages, renders V2, then converts once after approval", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    await fixture.install(page);
    configurePlanning(fixture);
    fixture
      .on(
        "GET",
        "/api/v1/acquisition/runs/run-e2e-1/presentation",
        {
          body: {
            run: run("running", 1),
            providers: [provider("running")],
            summary: { ...summary, validOpportunities: 0, highIntent: 0 },
            candidateEvents: [
              candidateEvent("normalized", "candidate-event-1", false)
            ],
            nextAfter: "signed-cursor-page-1",
            hasMore: true
          }
        },
        {
          body: {
            run: run("succeeded", 2),
            providers: [provider("succeeded")],
            summary,
            candidateEvents: [
              candidateEvent("pending_review", "candidate-event-2", true)
            ],
            nextAfter: "signed-cursor-page-2",
            hasMore: false
          }
        }
      )
      .on(
        "GET",
        "/api/v1/acquisition/candidates/candidate-1",
        { body: candidate("pending_review") },
        { body: candidate("approved") },
        { body: candidate("approved") },
        { body: candidate("converted_to_lead") }
      )
      .on("GET", "/api/v1/acquisition/candidates/candidate-1/evidence", {
        body: { items: [evidence], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/candidates/candidate-1/qualification", {
        body: qualification
      })
      .on("GET", "/api/v1/acquisition/candidates/candidate-1/financial-value", {
        body: financialValue
      })
      .on("GET", "/api/v1/acquisition/candidates/candidate-1/battle-card", {
        body: battleCardV2
      })
      .on("POST", "/api/v1/acquisition/candidates/candidate-1/review", {
        body: {
          candidate: candidate("approved"),
          review: { action: "approved" },
          research: null
        }
      })
      .on("POST", "/api/v1/acquisition/candidates/candidate-1/convert", {
        body: {
          id: "conversion-1",
          candidateId: "candidate-1",
          decisionVersion: qualification.decisionVersion,
          partyRef: { organizationId: "organization-1" },
          leadId: "lead-1",
          reviewerId: "u_manager_alex",
          evidenceSnapshotHash: "evidence-snapshot-1",
          createdAt: timestamp
        }
      })
      .on("POST", "/api/todos", {
        body: {
          id: "todo-1",
          ownerId: "u_manager_alex",
          teamId: "europe",
          title: "跟进远岚智能装备",
          type: "customer",
          priority: "high",
          dueAt: timestamp,
          related: "lead-1",
          done: false,
          status: "pending"
        }
      });

    await openAdvisor(page);
    await startRealRun(page);

    await expect(page.locator(".ai-growth-run-console"))
      .toHaveAttribute("data-status", "completed");
    await expect(page.locator(".ai-growth-candidate-card"))
      .toHaveAttribute("data-review-status", "pending_review");
    const presentationCalls = fixture.calls(
      "GET",
      "/api/v1/acquisition/runs/run-e2e-1/presentation"
    );
    expect(presentationCalls).toHaveLength(2);
    expect(presentationCalls[0]?.search).toBe("?limit=100");
    expect(presentationCalls[1]?.search)
      .toBe("?after=signed-cursor-page-1&limit=100");

    await page.locator('[data-action="open-battle-card"]').click();
    const dialog = page.getByRole("dialog", { name: "远岚智能装备" });
    await expect(dialog.getByRole("heading", { name: "供应商" }))
      .toBeVisible();
    await expect(dialog).toContainText("可能已有产线集成供应商");
    await expect(dialog.getByRole("heading", { name: "决策链" }))
      .toBeVisible();
    await expect(dialog).toContainText("运营负责人");
    await expect(dialog.getByRole("heading", { name: "采购偏好" }))
      .toBeVisible();
    await expect(dialog).toContainText("采购偏好未知");
    await expect(dialog)
      .toContainText("推测 · 置信度");
    await expect(dialog.locator('[data-action="convert"]'))
      .toHaveCount(0);

    await page.locator('[data-action="review-approved"]').click();
    await expect(page.locator(".ai-growth-battle-drawer"))
      .toContainText("已通过当前决定版本");
    await page.locator('[data-action="close-battle-card"]').last().click();
    await page.locator(
      '.ai-growth-candidate-card [data-action="convert"]'
    ).click();
    await expect(page.locator(".toast").last())
      .toContainText("已转为线索并创建跟进任务");

    expect(fixture.calls(
      "POST",
      "/api/v1/acquisition/candidates/candidate-1/convert"
    )).toHaveLength(1);
    expect(fixture.calls("POST", "/api/todos")).toHaveLength(1);
    for (const request of fixture.requests.filter((item) =>
      item.method === "POST"
    )) {
      expect(request.idempotencyKey, request.pathname).toBeTruthy();
    }
    expect(fixture.calls(
      "POST",
      "/api/v1/acquisition/plans/plan-e2e-1/approval"
    )[0]?.ifMatch).toBe('"plan-e2e-1:1"');
    fixture.assertNoUnexpected();
  });

  test("opens the provider connection center in place and preserves the current task", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    await fixture.install(page);
    fixture
      .on("GET", "/api/v1/acquisition/overview", {
        body: {
          tasks: [],
          totals: { tasks: 0 },
          statusCounts: {},
          discoveryMethodCounts: {},
          generatedAt: timestamp
        }
      })
      .on("GET", "/api/v1/acquisition/tasks", {
        body: { items: [], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/provider-connections", {
        body: { items: [], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/providers", {
        body: {
          items: [{
            id: "baidu_ai_search",
            kind: "search",
            displayName: "百度 AI 搜索",
            officialDocsUrl: "https://cloud.baidu.com/doc/",
            requiresKey: true,
            costNote: "按官方用量计费",
            capabilities: ["web_search"]
          }],
          nextCursor: null
        }
      });
    await openAdvisor(page);
    await page.locator('[data-action="new-task"]').click();

    const taskText = "寻找苏州近期扩产、但采购预算尚未公开的制造企业";
    await page.locator('[data-field="task-text"]').fill(taskText);
    await page.locator('[data-action="submit-task"]').click();
    const configure = page.locator('[data-action="configure-connections"]');
    await expect(configure).toBeVisible();
    const hashBefore = await page.evaluate(() => location.hash);

    await configure.click();

    await expect(page.getByRole("dialog", { name: "搜索来源连接中心" }))
      .toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
    await expect(page.locator("#ai-growth")).toHaveClass(/active/);
    await expect(page.locator('[data-field="task-text"]')).toHaveValue(taskText);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.evaluate(() => {
      const drawer = document.querySelector(".ai-growth-provider-drawer");
      const catalog = document.querySelector(".ai-growth-provider-catalog");
      const footer = document.querySelector(".ai-growth-provider-drawer__footer");
      return {
        drawerWidth: drawer?.getBoundingClientRect().width,
        catalogColumns: catalog
          ? getComputedStyle(catalog).gridTemplateColumns.split(" ").length
          : 0,
        footerPosition: footer ? getComputedStyle(footer).position : null,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    expect(mobileLayout).toEqual({
      drawerWidth: 390,
      catalogColumns: 1,
      footerPosition: "static",
      horizontalOverflow: false
    });
    fixture.assertNoUnexpected();
  });

  test("traps provider drawer focus and restores the trigger on Escape", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    await fixture.install(page);
    fixture
      .on("GET", "/api/v1/acquisition/overview", {
        body: {
          tasks: [],
          totals: { tasks: 0 },
          statusCounts: {},
          discoveryMethodCounts: {},
          generatedAt: timestamp
        }
      })
      .on("GET", "/api/v1/acquisition/tasks", {
        body: { items: [], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/provider-connections", {
        body: { items: [], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/providers", {
        body: {
          items: [{
            id: "baidu_ai_search",
            kind: "search",
            displayName: "百度 AI 搜索",
            capabilities: ["web_search"]
          }],
          nextCursor: null
        }
      });
    await openAdvisor(page);
    await page.locator('[data-action="new-task"]').click();
    await page.locator('[data-field="task-text"]').fill("验证抽屉焦点");
    await page.locator('[data-action="submit-task"]').click();
    const trigger = page.locator('[data-action="configure-connections"]');
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "搜索来源连接中心" });
    await expect(drawer).toBeVisible();

    expect(await page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");
    expect(await drawer.evaluate((element) =>
      element.contains(document.activeElement)
    )).toBe(true);
    const providerTrigger = drawer.locator(
      '[data-action="select-connection-provider"][data-provider-id="baidu_ai_search"]'
    );
    await providerTrigger.click();
    expect(await drawer.locator(
      '[data-action="select-connection-provider"][data-provider-id="baidu_ai_search"]'
    ).evaluate((element) => element === document.activeElement)).toBe(true);
    const focusable = drawer.locator(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable.first();
    const last = focusable.last();
    await last.evaluate((element: HTMLElement) => element.focus());
    await page.keyboard.press("Tab");
    expect(await first.evaluate((element) =>
      element === document.activeElement
    )).toBe(true);
    await first.evaluate((element: HTMLElement) => element.focus());
    await page.keyboard.press("Shift+Tab");
    expect(await last.evaluate((element) =>
      element === document.activeElement
    )).toBe(true);

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    expect(await trigger.evaluate((element) =>
      element === document.activeElement
    )).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    fixture.assertNoUnexpected();
  });

  test("clears the live API key input before a save request settles", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await fixture.install(page);
    fixture
      .on("GET", "/api/v1/acquisition/overview", {
        body: {
          tasks: [],
          totals: { tasks: 0 },
          statusCounts: {},
          discoveryMethodCounts: {},
          generatedAt: timestamp
        }
      })
      .on("GET", "/api/v1/acquisition/tasks", {
        body: { items: [], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/provider-connections", {
        body: { items: [], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/providers", {
        body: {
          items: [{
            id: "baidu_ai_search",
            kind: "search",
            displayName: "百度 AI 搜索",
            capabilities: ["web_search"]
          }],
          nextCursor: null
        }
      })
      .on(
        "POST",
        "/api/v1/acquisition/provider-connections",
        async () => {
          await saveGate;
          return {
            body: {
              id: "connection-new",
              ownerId: "u_manager_alex",
              teamId: "europe",
              providerId: "baidu_ai_search",
              kind: "search",
              status: "disabled",
              credentialVersion: 1,
              lastHealthAt: null,
              lastHealthStatus: "untested",
              lastErrorCode: null,
              lastHealthMessage: "尚未测试",
              usage: "search",
              createdAt: timestamp
            }
          };
        }
      );
    await openAdvisor(page);
    await page.locator('[data-action="new-task"]').click();
    await page.locator('[data-field="task-text"]').fill("保存输入清理时序");
    await page.locator('[data-action="submit-task"]').click();
    await page.locator('[data-action="configure-connections"]').click();
    await page.locator('[data-action="select-connection-provider"]').click();

    const secret = "fixture-secret-must-not-survive";
    const input = page.locator('[data-field="provider-api-key"]');
    await input.fill(secret);
    await page.locator('[data-action="save-provider-connection"]').click();
    await expect.poll(() => fixture.calls(
      "POST",
      "/api/v1/acquisition/provider-connections"
    ).length).toBe(1);

    await expect(input).toHaveValue("");
    await expect(input).not.toHaveAttribute("value", secret);
    expect(await page.locator(".ai-growth-provider-drawer").evaluate(
      (element) => element.outerHTML
    )).not.toContain(secret);
    const storageSnapshot = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage)
    }));
    expect(storageSnapshot.local).not.toContain(secret);
    expect(storageSnapshot.session).not.toContain(secret);

    releaseSave();
    await expect(page.locator(".ai-growth-provider-drawer"))
      .toContainText("连接已保存，请测试后再启用");
    fixture.assertNoUnexpected();
  });

  test("cancelled confirmation blocks credential rotation and deletion", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    const existingConnection = {
      id: "connection-existing",
      ownerId: "u_manager_alex",
      teamId: "europe",
      providerId: "baidu_ai_search",
      kind: "search",
      status: "disabled",
      credentialVersion: 2,
      lastHealthAt: timestamp,
      lastHealthStatus: "passed",
      lastErrorCode: null,
      lastHealthMessage: "测试通过",
      usage: "search",
      createdAt: timestamp
    };
    await fixture.install(page);
    fixture
      .on("GET", "/api/v1/acquisition/overview", {
        body: {
          tasks: [],
          totals: { tasks: 0 },
          statusCounts: {},
          discoveryMethodCounts: {},
          generatedAt: timestamp
        }
      })
      .on("GET", "/api/v1/acquisition/tasks", {
        body: { items: [], nextCursor: null }
      })
      .on(
        "GET",
        "/api/v1/acquisition/provider-connections",
        { body: { items: [], nextCursor: null } },
        { body: { items: [], nextCursor: null } },
        { body: { items: [existingConnection], nextCursor: null } }
      )
      .on("GET", "/api/v1/acquisition/providers", {
        body: {
          items: [{
            id: "baidu_ai_search",
            kind: "search",
            displayName: "百度 AI 搜索",
            capabilities: ["web_search"]
          }],
          nextCursor: null
        }
      });
    await openAdvisor(page);
    await page.locator('[data-action="new-task"]').click();
    await page.locator('[data-field="task-text"]').fill("确认取消不写入");
    await page.locator('[data-action="submit-task"]').click();
    await page.locator('[data-action="configure-connections"]').click();
    await page.locator('[data-action="select-provider-connection"]').click();
    await page.evaluate(() => {
      (window as typeof window & { __providerConfirms: string[] })
        .__providerConfirms = [];
      window.confirm = (message?: string) => {
        (window as typeof window & { __providerConfirms: string[] })
          .__providerConfirms.push(message ?? "");
        return false;
      };
    });

    await page.locator('[data-field="provider-api-key"]')
      .fill("rotation-secret");
    await page.locator('[data-action="rotate-provider-connection"]').click();
    await page.locator('[data-action="delete-provider-connection"]').click();

    expect(await page.evaluate(() =>
      (window as typeof window & { __providerConfirms: string[] })
        .__providerConfirms
    )).toHaveLength(2);
    expect(fixture.calls(
      "PATCH",
      "/api/v1/acquisition/provider-connections/connection-existing"
    )).toHaveLength(0);
    expect(fixture.calls(
      "DELETE",
      "/api/v1/acquisition/provider-connections/connection-existing"
    )).toHaveLength(0);
    fixture.assertNoUnexpected();
  });

  test("demo replay stays local and read-only without acquisition or todo writes", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    await fixture.install(page);
    await openAdvisor(page);
    await page.clock.install();

    await page.locator('[data-action="set-mode"][data-mode="demo"]').click();
    await page.locator('[data-action="submit-task"]').click();
    await page.clock.runFor(11_000);
    await expect(page.locator(".ai-growth-plan")).toBeVisible();
    await page.locator('[data-action="approve-plan"]').click();
    await page.clock.runFor(70_000);

    await expect(page.locator(".ai-growth-run-console"))
      .toHaveAttribute("data-status", "completed");
    await page.locator('[data-action="open-battle-card"]').first().click();
    await expect(page.locator(".ai-growth-battle-drawer"))
      .toContainText("演示数据 · 只读");
    await expect(page.locator(".ai-growth-battle-drawer"))
      .not.toContainText("转为线索");
    expect(fixture.requests).toEqual([]);
    fixture.assertNoUnexpected();
  });

  test("keeps the task on missing connection and presents provider/candidate partial success with unknown finance", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    await fixture.install(page);
    fixture.on("GET", "/api/v1/acquisition/provider-connections", {
      body: { items: [], nextCursor: null }
    });
    await openAdvisor(page);

    const taskText = "寻找苏州近期扩产、但采购预算尚未公开的制造企业";
    await page.locator('[data-field="task-text"]').fill(taskText);
    await page.locator('[data-action="submit-task"]').click();
    await expect(page.locator(".ai-growth-shell"))
      .toHaveAttribute("data-status", "connection_required");
    await expect(page.locator('[data-field="task-text"]')).toHaveValue(taskText);
    await expect(page.locator('[data-action="configure-connections"]'))
      .toBeVisible();
    fixture.assertNoUnexpected();

    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    const partial = new StrictAcquisitionFixture();
    await partial.install(page);
    configurePlanning(partial);
    const researchCandidate = {
      ...candidateEvent("pending_review", "candidate-event-research", true),
      candidateId: "candidate-2",
      candidate: {
        ...candidateEvent(
          "pending_review",
          "candidate-event-research",
          true
        ).candidate,
        id: "candidate-2",
        displayName: "证据待补制造企业",
        status: "needs_research"
      },
      qualification: null,
      financialValue: null,
      evidenceCount: 0
    };
    partial.on("GET", "/api/v1/acquisition/runs/run-e2e-1/presentation", {
      body: {
        run: run("partial_success", 2),
        providers: [
          provider("succeeded"),
          {
            ...provider("failed"),
            shardId: "shard-2",
            connectionId: "search-connection-2",
            providerId: "tavily"
          }
        ],
        summary: {
          ...summary,
          financialEvaluatedHighIntentCount: 0,
          financialPendingHighIntentCount: 1,
          expectedRevenueByCurrency: []
        },
        candidateEvents: [
          {
            ...candidateEvent(
              "pending_review",
              "candidate-event-pending-finance",
              true
            ),
            financialValue: null
          },
          researchCandidate
        ],
        nextAfter: "partial-complete",
        hasMore: false
      }
    });
    await openAdvisor(page);
    await startRealRun(page);

    await expect(page.locator(".ai-growth-partial-notice"))
      .toContainText("已有来源返回有效客户");
    await expect(page.locator('[data-provider-state="limited"]'))
      .toContainText("PROVIDER_RATE_LIMITED");
    await expect(page.locator(".ai-growth-candidate-card").first())
      .toContainText("财务价值");
    await expect(page.locator(".ai-growth-candidate-card").first())
      .toContainText("待评估");
    await expect(page.locator(".ai-growth-candidate-card").nth(1))
      .toContainText("需补充研究");
    partial.assertNoUnexpected();
  });

  test("does not retry a tampered cursor and sends current ETags for pause resume cancel", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    await fixture.install(page);
    configurePlanning(fixture);
    fixture
      .on(
        "GET",
        "/api/v1/acquisition/runs/run-e2e-1/presentation",
        {
          body: {
            run: run("running", 1),
            providers: [provider("running")],
            summary,
            candidateEvents: [],
            nextAfter: "tampered-cursor",
            hasMore: true
          }
        },
        {
          status: 400,
          body: { code: "invalid_cursor", message: "游标签名无效" }
        }
      );
    await openAdvisor(page);
    await startRealRun(page);
    await expect(page.locator(".ai-growth-shell"))
      .toHaveAttribute("data-status", "failed");
    await page.waitForTimeout(1_200);
    expect(fixture.calls(
      "GET",
      "/api/v1/acquisition/runs/run-e2e-1/presentation"
    )).toHaveLength(2);
    fixture.assertNoUnexpected();

    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    const controls = new StrictAcquisitionFixture();
    await controls.install(page);
    configurePlanning(controls);
    controls
      .on("GET", "/api/v1/acquisition/runs/run-e2e-1/presentation", {
        body: {
          run: run("running", 1),
          providers: [provider("running")],
          summary,
          candidateEvents: [],
          nextAfter: "running-cursor",
          hasMore: false
        }
      })
      .on("POST", "/api/v1/acquisition/runs/run-e2e-1/pause", {
        body: run("paused", 2)
      })
      .on("POST", "/api/v1/acquisition/runs/run-e2e-1/resume", {
        body: run("running", 3)
      })
      .on("POST", "/api/v1/acquisition/runs/run-e2e-1/cancel", {
        body: run("cancelled", 4)
      });
    await openAdvisor(page);
    await startRealRun(page);
    await expect(page.locator('[data-action="pause-run"]')).toBeVisible();
    await page.locator('[data-action="pause-run"]').click();
    await expect(page.locator('[data-action="resume-run"]')).toBeVisible();
    await page.locator('[data-action="resume-run"]').click();
    await expect(page.locator('[data-action="cancel-run"]')).toBeVisible();
    await page.locator('[data-action="cancel-run"]').click();
    await expect(page.locator(".ai-growth-shell"))
      .toHaveAttribute("data-status", "cancelled");

    expect(controls.calls(
      "POST",
      "/api/v1/acquisition/runs/run-e2e-1/pause"
    )[0]?.ifMatch).toBe('"run-e2e-1:1"');
    expect(controls.calls(
      "POST",
      "/api/v1/acquisition/runs/run-e2e-1/resume"
    )[0]?.ifMatch).toBe('"run-e2e-1:2"');
    expect(controls.calls(
      "POST",
      "/api/v1/acquisition/runs/run-e2e-1/cancel"
    )[0]?.ifMatch).toBe('"run-e2e-1:3"');
    controls.assertNoUnexpected();
  });

  test("retries a missing battle card only through Copilot and never POSTs a direct battle-card endpoint", async ({ page }) => {
    const fixture = new StrictAcquisitionFixture();
    await fixture.install(page);
    configurePlanning(fixture);
    fixture
      .on("GET", "/api/v1/acquisition/runs/run-e2e-1/presentation", {
        body: {
          run: run("succeeded", 2),
          providers: [provider("succeeded")],
          summary,
          candidateEvents: [
            candidateEvent("pending_review", "candidate-event-2", true)
          ],
          nextAfter: "complete",
          hasMore: false
        }
      })
      .on("GET", "/api/v1/acquisition/candidates/candidate-1", {
        body: candidate("pending_review")
      })
      .on("GET", "/api/v1/acquisition/candidates/candidate-1/evidence", {
        body: { items: [evidence], nextCursor: null }
      })
      .on("GET", "/api/v1/acquisition/candidates/candidate-1/qualification", {
        body: qualification
      })
      .on("GET", "/api/v1/acquisition/candidates/candidate-1/financial-value", {
        body: financialValue
      })
      .on(
        "GET",
        "/api/v1/acquisition/candidates/candidate-1/battle-card",
        { status: 404, body: { code: "battle_card_not_found" } },
        { body: battleCardV2 }
      )
      .on(
        "POST",
        "/api/v1/acquisition/copilot/sessions",
        {
          body: {
            id: "copilot-session-1",
            status: "active",
            createdAt: timestamp
          }
        },
        {
          body: {
            id: "copilot-session-retry",
            status: "active",
            createdAt: timestamp
          }
        }
      )
      .on(
        "POST",
        "/api/v1/acquisition/copilot/sessions/copilot-session-retry/messages",
        (request) => ({
          body: {
            id: "copilot-task-battle-card",
            sessionId: "copilot-session-retry",
            status: "succeeded",
            responseMode: "assistant",
            result: {
              toolNames: ["build_battle_card"],
              echoedRequest: request.body
            },
            errorCode: null,
            createdAt: timestamp,
            completedAt: timestamp
          }
        })
      );

    await openAdvisor(page);
    await startRealRun(page);
    await page.locator('[data-action="open-battle-card"]').click();
    await expect(page.locator('[data-action="generate-battle-card"]'))
      .toBeVisible();
    await page.locator('[data-action="generate-battle-card"]').click();
    await expect(page.locator('[data-v2-region="account-overview"]'))
      .toContainText("数字化产线扩建");

    const action = fixture.calls(
      "POST",
      "/api/v1/acquisition/copilot/sessions/copilot-session-retry/messages"
    );
    expect(action).toHaveLength(1);
    expect(JSON.stringify(action[0]?.body)).toContain("battle-card.v2");
    expect(fixture.requests.some((request) =>
      request.method === "POST"
      && /candidates\/candidate-1\/battle-card$/u.test(request.pathname)
    )).toBe(false);
    fixture.assertNoUnexpected();
  });
});
