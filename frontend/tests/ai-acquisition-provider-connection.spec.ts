import { expect, test, type Page } from "@playwright/test";

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

const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const prohibitedWritePath =
  /comment|reply|direct-message|private-message|messages?|friend|group|outreach/iu;

function redactRequestBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const object = body as JsonObject;
  return Object.hasOwn(object, "apiKey")
    ? { ...object, apiKey: "[REDACTED]" }
    : body;
}

class StrictAcquisitionFixture {
  readonly requests: FixtureRequest[] = [];
  readonly unexpected: FixtureRequest[] = [];
  readonly prohibited: FixtureRequest[] = [];
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
      const method = request.method().toUpperCase();
      const tracked = url.pathname.startsWith("/api/v1/acquisition/")
        || url.pathname === "/api/todos";
      const prohibited = !tracked
        && writeMethods.has(method)
        && prohibitedWritePath.test(url.pathname);
      if (!tracked && !prohibited) {
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
        method,
        pathname: url.pathname,
        search: url.search,
        body,
        idempotencyKey: headers["idempotency-key"] ?? null,
        ifMatch: headers["if-match"] ?? null
      };
      const safeRecord = { ...record, body: redactRequestBody(record.body) };
      this.requests.push(safeRecord);
      if (prohibited) {
        this.prohibited.push(safeRecord);
        await route.fulfill({
          status: 501,
          contentType: "application/json",
          body: JSON.stringify({ code: "prohibited_automatic_outreach" })
        });
        return;
      }
      const queue = this.handlers.get(
        `${record.method} ${record.pathname}`
      );
      if (!queue || queue.length === 0) {
        this.unexpected.push(safeRecord);
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
      writeMethods.has(request.method)
    );
  }

  assertNoUnexpected() {
    expect(this.unexpected, JSON.stringify(this.unexpected, null, 2))
      .toEqual([]);
    expect(this.prohibited, JSON.stringify(this.prohibited, null, 2))
      .toEqual([]);
  }
}

const timestamp = "2026-08-06T08:00:00.000Z";
const connectionId = "search-connection-baidu-first-use";
const fixtureSecret = "FIXTURE_ONLY_NOT_A_REAL_KEY_DO_NOT_PERSIST_9f8e7d";
const intent = "寻找常州本周公开提到扩建智能产线的制造企业，核对抖音公开信号";
const allowedQueries = [
  "site:douyin.com 常州 制造业 智能产线 扩建",
  "site:iesdouyin.com 常州 制造业 智能产线 扩建"
];

const providerCatalog = {
  items: [{
    id: "baidu_ai_search",
    kind: "search",
    displayName: "百度 AI 搜索",
    officialDocsUrl: "https://cloud.baidu.com/doc/",
    requiresKey: true,
    costNote: "按百度官方用量计费",
    capabilities: ["web_search"]
  }],
  nextCursor: null
};

const connection = (
  status: "disabled" | "active",
  lastHealthStatus: "untested" | "passed" | "failed"
) => ({
  id: connectionId,
  ownerId: "u_manager_alex",
  teamId: "europe",
  providerId: "baidu_ai_search",
  kind: "search",
  status,
  credentialVersion: 1,
  lastHealthAt: lastHealthStatus === "untested" ? null : timestamp,
  lastHealthStatus,
  lastErrorCode: lastHealthStatus === "failed" ? "AUTH_REJECTED" : null,
  lastHealthMessage: lastHealthStatus === "untested"
    ? "尚未测试"
    : lastHealthStatus === "passed" ? "连接测试通过" : "凭据校验失败",
  usage: "public search",
  createdAt: timestamp,
  updatedAt: timestamp
});

const disabledUntested = connection("disabled", "untested");
const disabledPassed = connection("disabled", "passed");
const activePassed = connection("active", "passed");
const disabledFailed = connection("disabled", "failed");

const planDraft = {
  targetPlatform: "douyin",
  name: "抖音公开智能产线商机发现",
  objective: intent,
  icp: {
    industries: ["装备制造"],
    regions: ["常州"],
    organizationCriteria: ["公开提到智能产线扩建"],
    individualCriteria: [],
    exclusionRules: ["勿扰名单", "缺少公开来源"]
  },
  subjectChannels: { organization: true, individual: false },
  providerConnections: [{
    connectionId,
    providerId: "baidu_ai_search",
    kind: "search",
    status: "active",
    credentialVersion: 1
  }],
  operations: allowedQueries.map((query, index) => ({
    operationId: `douyin-public-query-${index + 1}`,
    subjectChannel: "organization",
    kind: "search",
    connectionId,
    query,
    allocatedBudget: {
      requests: 4,
      results: 20,
      amountMinor: 1_000,
      durationSeconds: 45
    }
  })),
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

function emptyOverview() {
  return {
    generatedAt: timestamp,
    platform: "douyin",
    totals: { tasks: 0 },
    statusCounts: {},
    discoveryMethodCounts: {},
    tasks: []
  };
}

function stateTransitions<T>(values: readonly T[]): T[] {
  return values.filter((value, index) =>
    index === 0 || value !== values[index - 1]);
}

function configureOverview(fixture: StrictAcquisitionFixture) {
  fixture
    .on("GET", "/api/v1/acquisition/overview", {
      body: emptyOverview()
    })
    .on("GET", "/api/v1/acquisition/tasks", {
      body: { items: [], nextCursor: null }
    });
}

function configurePlanning(fixture: StrictAcquisitionFixture) {
  fixture
    .on("POST", "/api/v1/acquisition/copilot/sessions", {
      body: {
        id: "operation-create-session-provider-first-use",
        kind: "copilot_session_creation",
        status: "succeeded",
        resourceId: "copilot-session-provider-first-use",
        createdAt: timestamp,
        completedAt: timestamp
      }
    })
    .on(
      "POST",
      "/api/v1/acquisition/copilot/sessions/copilot-session-provider-first-use/messages",
      {
        body: {
          id: "copilot-task-provider-first-use",
          sessionId: "copilot-session-provider-first-use",
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
    );
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

async function openNewDouyinTask(page: Page, taskText: string) {
  await openAdvisor(page);
  await page.getByRole("button", { name: "新建获客任务" }).click();
  await expect(page).toHaveURL(/#ai-growth\/new$/u);
  await expect(page.getByRole("button", { name: /抖音公开商机/u }))
    .toHaveAttribute("aria-pressed", "true");
  await page.locator(
    '[data-action="select-template"][data-template-id="export-manufacturing"]'
  ).click();
  await page.locator('[data-field="task-text"]').fill(taskText);
  await page.getByRole("button", { name: "生成商机搜索方案" }).click();
  await expect(page.locator(".ai-growth-shell"))
    .toHaveAttribute("data-status", "connection_required");
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("configures an official BYOK search connection and continues the preserved Douyin task", async ({ page }) => {
  const fixture = new StrictAcquisitionFixture();
  const consoleOutput: string[] = [];
  let lifecycle: "empty" | "saved" | "tested" | "active" = "empty";
  const observedLifecycle: Array<typeof lifecycle> = [];
  let exactCreateRequest = false;
  page.on("console", (message) => consoleOutput.push(message.text()));
  configureOverview(fixture);
  configurePlanning(fixture);
  fixture
    .on(
      "GET",
      "/api/v1/acquisition/provider-connections",
      () => {
        observedLifecycle.push(lifecycle);
        return {
          body: {
            items: lifecycle === "empty"
              ? []
              : [lifecycle === "saved"
                ? disabledUntested
                : lifecycle === "tested" ? disabledPassed : activePassed],
            nextCursor: null
          }
        };
      }
    )
    .on("GET", "/api/v1/acquisition/providers", {
      body: providerCatalog
    })
    .on(
      "POST",
      "/api/v1/acquisition/provider-connections",
      (request) => {
        const body = request.body as JsonObject;
        exactCreateRequest = Object.keys(body).sort().join(",")
            === "apiKey,providerId,status"
          && body.providerId === "baidu_ai_search"
          && body.apiKey === fixtureSecret
          && body.status === "disabled";
        lifecycle = "saved";
        return { body: disabledUntested };
      }
    )
    .on(
      "POST",
      `/api/v1/acquisition/provider-connections/${connectionId}/test`,
      () => {
        lifecycle = "tested";
        return {
          body: {
          ok: true,
          message: "连接测试通过",
          errorCode: null,
          retryable: false,
          retryAfterAt: null,
          usage: "public search"
          }
        };
      }
    )
    .on(
      "PATCH",
      `/api/v1/acquisition/provider-connections/${connectionId}`,
      () => {
        lifecycle = "active";
        return { body: activePassed };
      }
    );
  await fixture.install(page);

  await openNewDouyinTask(page, intent);
  await expect(page.locator('[data-field="task-text"]')).toHaveValue(intent);
  await expect(page.getByRole("button", { name: /抖音公开商机/u }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(
    '[data-template-id="export-manufacturing"]'
  )).toHaveAttribute("aria-pressed", "true");

  await page.locator('[data-action="configure-connections"]').click();
  const drawer = page.getByRole("dialog", { name: "搜索来源连接中心" });
  await expect(drawer).toBeVisible();
  await drawer.locator(
    '[data-action="select-connection-provider"][data-provider-id="baidu_ai_search"]'
  ).click();
  const secretInput = drawer.locator('[data-field="provider-api-key"]');
  await secretInput.fill(fixtureSecret);
  await drawer.locator('[data-action="save-provider-connection"]').click();

  const create = fixture.calls(
    "POST",
    "/api/v1/acquisition/provider-connections"
  );
  expect(create).toHaveLength(1);
  expect(
    exactCreateRequest,
    "create request must contain only provider, fixture secret and disabled status"
  ).toBe(true);
  expect(create[0]?.body).toEqual({
    providerId: "baidu_ai_search",
    apiKey: "[REDACTED]",
    status: "disabled"
  });
  expect(create[0]?.idempotencyKey).toMatch(
    /^ai-growth-provider-connection:/u
  );
  expect(create[0]?.ifMatch).toBeNull();

  await expect(drawer).toContainText("连接已保存，请测试后再启用");
  const clearedValue = await drawer.locator(
    '[data-field="provider-api-key"]'
  ).inputValue();
  expect(clearedValue.length, "rendered secret input must be empty").toBe(0);
  const drawerHtml = await drawer.evaluate((element) => element.outerHTML);
  expect(
    drawerHtml.includes(fixtureSecret),
    "drawer HTML must not disclose the fixture secret"
  ).toBe(false);
  const browserState = await page.evaluate(() => ({
    url: location.href,
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage)
  }));
  const leakedBrowserSurfaces = Object.entries(browserState)
    .filter(([, value]) => value.includes(fixtureSecret))
    .map(([surface]) => surface);
  expect(
    leakedBrowserSurfaces,
    "URL and browser storage must not disclose the fixture secret"
  ).toEqual([]);
  expect(
    consoleOutput.some((entry) => entry.includes(fixtureSecret)),
    "console output must not disclose the fixture secret"
  ).toBe(false);

  await drawer.getByRole("button", { name: "测试连接" }).click();
  const health = fixture.calls(
    "POST",
    `/api/v1/acquisition/provider-connections/${connectionId}/test`
  );
  expect(health).toHaveLength(1);
  expect(health[0]?.body).toBeNull();
  expect(health[0]?.idempotencyKey).toBeNull();
  expect(health[0]?.ifMatch).toBeNull();
  await expect(drawer).toContainText("测试通过·待启用");
  await expect(drawer).toContainText("连接测试通过");

  await drawer.getByRole("button", { name: "启用连接" }).click();
  const enable = fixture.calls(
    "PATCH",
    `/api/v1/acquisition/provider-connections/${connectionId}`
  );
  expect(enable).toHaveLength(1);
  expect(enable[0]?.body).toEqual({ status: "active" });
  expect(enable[0]?.idempotencyKey).toBeNull();
  expect(enable[0]?.ifMatch).toBeNull();
  await expect(drawer).toContainText("已启用·可用于获客");
  await expect(page.locator('[data-field="task-text"]')).toHaveValue(intent);
  await expect(page.getByRole("button", { name: /抖音公开商机/u }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(
    '[data-template-id="export-manufacturing"]'
  )).toHaveAttribute("aria-pressed", "true");

  await drawer.getByRole("button", { name: "继续当前任务" }).click();
  await expect(drawer).toHaveCount(0);
  const planPanel = page.locator(".ai-growth-plan");
  await expect(planPanel).toBeVisible();

  const messages = fixture.calls(
    "POST",
    "/api/v1/acquisition/copilot/sessions/copilot-session-provider-first-use/messages"
  );
  expect(messages).toHaveLength(1);
  expect(messages[0]?.body).toEqual({
    message: intent,
    responseMode: "plan_draft",
    targetPlatform: "douyin"
  });
  await expect(planPanel).toContainText("抖音公开内容");
  for (const query of allowedQueries) await expect(planPanel).toContainText(query);

  const writePaths = fixture.writes().map((request) =>
    `${request.method} ${request.pathname}`
  );
  expect(writePaths).toEqual([
    "POST /api/v1/acquisition/provider-connections",
    `POST /api/v1/acquisition/provider-connections/${connectionId}/test`,
    `PATCH /api/v1/acquisition/provider-connections/${connectionId}`,
    "POST /api/v1/acquisition/copilot/sessions",
    "POST /api/v1/acquisition/copilot/sessions/copilot-session-provider-first-use/messages"
  ]);
  expect(fixture.calls("POST", "/api/todos")).toHaveLength(0);
  expect(stateTransitions(observedLifecycle)).toEqual([
    "empty",
    "saved",
    "tested",
    "active"
  ]);
  expect(lifecycle).toBe("active");
  expect(
    consoleOutput.some((entry) => entry.includes(fixtureSecret)),
    "console output must not disclose the fixture secret"
  ).toBe(false);
  fixture.assertNoUnexpected();
});

test("keeps an HTTP 200 unhealthy connection disabled and blocks continuation", async ({ page }) => {
  const fixture = new StrictAcquisitionFixture();
  let healthState: "untested" | "failed" = "untested";
  const observedHealthStates: Array<typeof healthState> = [];
  configureOverview(fixture);
  fixture
    .on(
      "GET",
      "/api/v1/acquisition/provider-connections",
      () => {
        observedHealthStates.push(healthState);
        return {
          body: {
            items: [healthState === "untested"
              ? disabledUntested
              : disabledFailed],
            nextCursor: null
          }
        };
      }
    )
    .on("GET", "/api/v1/acquisition/providers", {
      body: providerCatalog
    })
    .on(
      "POST",
      `/api/v1/acquisition/provider-connections/${connectionId}/test`,
      () => {
        healthState = "failed";
        return {
          status: 200,
          body: {
            ok: false,
            message: "凭据校验失败",
            errorCode: "AUTH_REJECTED",
            retryable: false,
            retryAfterAt: null,
            usage: "public search"
          }
        };
      }
    );
  await fixture.install(page);

  await openNewDouyinTask(page, "验证不健康搜索连接不能解锁抖音方案");
  await page.locator('[data-action="configure-connections"]').click();
  const drawer = page.getByRole("dialog", { name: "搜索来源连接中心" });
  await drawer.locator(
    `[data-action="select-provider-connection"][data-connection-id="${connectionId}"]`
  ).click();
  await drawer.getByRole("button", { name: "测试连接" }).click();

  await expect(drawer.getByRole("alert")).toContainText("凭据校验失败");
  await expect(drawer).toContainText("测试失败");
  await expect(drawer).not.toContainText("已启用·可用于获客");
  await expect(drawer.getByRole("button", { name: "启用连接" }))
    .toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "继续当前任务" }))
    .toBeDisabled();
  expect(fixture.calls(
    "PATCH",
    `/api/v1/acquisition/provider-connections/${connectionId}`
  )).toHaveLength(0);
  expect(fixture.calls(
    "POST",
    "/api/v1/acquisition/copilot/sessions"
  )).toHaveLength(0);
  expect(fixture.writes().map(({ method, pathname }) =>
    `${method} ${pathname}`
  )).toEqual([
    `POST /api/v1/acquisition/provider-connections/${connectionId}/test`
  ]);
  expect(healthState).toBe("failed");
  expect(stateTransitions(observedHealthStates)).toEqual([
    "untested",
    "failed"
  ]);
  fixture.assertNoUnexpected();
});
