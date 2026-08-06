import { expect, test, type Page } from "@playwright/test";

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
  contentType: string | null;
  idempotencyKey: string | null;
};

type FixtureHandler = (
  request: FixtureRequest
) => FixtureResponse | Promise<FixtureResponse>;

class StrictPublicImportFixture {
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
      if (postData !== null) {
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
        contentType: headers["content-type"] ?? null,
        idempotencyKey: headers["idempotency-key"] ?? null
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

const timestamp = "2026-08-07T02:00:00.000Z";
const operationId = "import-douyin-public-001";
const candidateIds = [
  "candidate-douyin-import-001",
  "candidate-douyin-import-002"
];
const evidenceIds = [
  "evidence-douyin-import-001",
  "evidence-douyin-import-002"
];
const fileOperationId = "import-douyin-file-001";
const fileCandidateId = "candidate-douyin-file-001";
const fileEvidenceId = "evidence-douyin-file-001";
const validUrls = [
  "https://www.douyin.com/video/7521000000000000101",
  "https://v.douyin.com/AbCdEf12/"
];

const queuedOperation = {
  id: operationId,
  ownerId: "u_manager_alex",
  teamId: "europe",
  actorId: "u_manager_alex",
  fileName: "douyin-public-urls.csv",
  mediaType: "text/csv",
  subjectChannel: "individual",
  artifactHash: "sha256:import-douyin-public-001",
  status: "queued",
  rowCount: 0,
  acceptedRowCount: 0,
  errorRows: [],
  evidenceCount: 0,
  evidenceIds: [],
  candidateCount: 0,
  candidateIds: [],
  errorCode: null,
  createdAt: timestamp,
  startedAt: null,
  completedAt: null
};

const runningOperation = {
  ...queuedOperation,
  status: "running",
  startedAt: timestamp
};

const completedOperation = {
  ...queuedOperation,
  status: "succeeded",
  rowCount: 2,
  acceptedRowCount: 2,
  evidenceCount: 2,
  evidenceIds,
  candidateCount: 2,
  candidateIds,
  startedAt: timestamp,
  completedAt: timestamp
};

const importedCandidate = {
  id: candidateIds[0],
  publicActorKey: "unresolved-public-signal:douyin:sha256:import-fixture",
  publicDisplayName: "抖音公开需求信号（身份待核实）",
  publicProfileUrl: validUrls[0],
  sourcePlatform: "douyin",
  evidenceIds: [evidenceIds[0]],
  demandCategory: "公开线索待研判",
  demandSummary: "用户导入的公开抖音链接，主体与需求尚未核验。",
  locationHint: null,
  buyingStage: "unknown",
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

const importedEvidence = {
  id: evidenceIds[0],
  targetType: "individual_signal",
  sourcePlatform: "douyin",
  sourceTitle: "用户导入的公开抖音链接",
  sourceSnippet: "待解析公开页面并核验主体",
  publishedAt: null,
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: queuedOperation.artifactHash,
  contentHash: "sha256:import-douyin-evidence-001",
  provenance: {
    kind: "import_artifact_row",
    importBatchId: operationId,
    artifactHash: queuedOperation.artifactHash,
    sheetName: "CSV",
    rowNumber: 2,
    sourceUrl: validUrls[0]
  },
  accessStatus: "user_supplied"
};

function configureBaseFixture(fixture: StrictPublicImportFixture) {
  return fixture
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
      body: { items: [], nextCursor: null }
    });
}

function configureFixture(fixture: StrictPublicImportFixture) {
  configureBaseFixture(fixture)
    .on("POST", "/api/v1/acquisition/import-operations", (request) => {
      const query = new URLSearchParams(request.search);
      expect(query.get("fileName")).toMatch(
        /^douyin-public-urls-\d+\.csv$/u
      );
      expect(query.get("subjectChannel")).toBe("individual");
      expect(JSON.parse(query.get("mapping") ?? "null")).toEqual({
        sourceTitle: "标题",
        sourceSnippet: "摘要",
        sourcePlatform: "平台",
        sourceUrl: "链接"
      });
      expect(request.contentType).toBe("text/csv");
      expect(request.idempotencyKey).toMatch(
        /^ai-growth-public-url-import:/u
      );
      expect(typeof request.body).toBe("string");
      const csv = String(request.body);
      expect(csv).toMatch(/^标题,摘要,平台,链接\r?\n/u);
      for (const sourceUrl of validUrls) expect(csv).toContain(sourceUrl);
      expect(csv).not.toContain("http://www.douyin.com");
      expect(csv).not.toContain("example.com");
      return { body: queuedOperation };
    })
    .on(
      "GET",
      `/api/v1/acquisition/import-operations/${operationId}`,
      { body: runningOperation },
      { body: completedOperation }
    )
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidateIds[0]}`,
      { body: importedCandidate }
    )
    .on(
      "GET",
      `/api/v1/acquisition/candidates/${candidateIds[0]}/evidence`,
      { body: { items: [importedEvidence], nextCursor: null } }
    );
}

function configurePartialFileFixture(
  fixture: StrictPublicImportFixture,
  expectedCsv: string
) {
  const queued = {
    ...queuedOperation,
    id: fileOperationId,
    fileName: "douyin-leads.csv",
    artifactHash: "sha256:import-douyin-file-001"
  };
  const partial = {
    ...queued,
    status: "partial_success",
    rowCount: 2,
    acceptedRowCount: 1,
    errorRows: [{
      sheetName: "CSV",
      rowNumber: 3,
      code: "missing_source_snippet",
      message: "摘要不能为空"
    }],
    evidenceCount: 1,
    evidenceIds: [fileEvidenceId],
    candidateCount: 1,
    candidateIds: [fileCandidateId],
    startedAt: timestamp,
    completedAt: timestamp
  };

  configureBaseFixture(fixture)
    .on("POST", "/api/v1/acquisition/import-operations", (request) => {
      const query = new URLSearchParams(request.search);
      expect(query.get("fileName")).toBe("douyin-leads.csv");
      expect(query.get("subjectChannel")).toBe("individual");
      expect(JSON.parse(query.get("mapping") ?? "null")).toEqual({
        sourceTitle: "标题",
        sourceSnippet: "摘要",
        sourcePlatform: "平台",
        sourceUrl: "链接",
        publishedAt: "发布时间",
        locale: "语言"
      });
      expect(request.contentType).toBe("text/csv");
      expect(request.idempotencyKey).toMatch(
        /^ai-growth-public-file-import:/u
      );
      expect(request.body).toBe(expectedCsv);
      return { body: queued };
    })
    .on(
      "GET",
      `/api/v1/acquisition/import-operations/${fileOperationId}`,
      { body: partial }
    );
}

async function login(page: Page) {
  await page.goto("/");
  await page.locator("#loginEmail").fill("alex@goodjob.com");
  await page.locator("#loginPassword").fill("goodjob123");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/u);
}

async function openNewAcquisitionTask(page: Page) {
  const advisorButton = page.locator('.nav button[data-view="ai-growth"]');
  if (!(await advisorButton.isVisible())) {
    const group = advisorButton.locator("xpath=ancestor::details[1]");
    if (await group.count()) await group.locator("summary").click();
  }
  await advisorButton.click();
  await page.getByRole("button", { name: "新建获客任务" }).click();
  await expect(page).toHaveURL(/#ai-growth\/new$/u);
  await expect(page.getByRole("heading", { name: "导入公开抖音线索" }))
    .toBeVisible();
}

test("public Douyin URLs become unresolved candidates through one truthful CSV import", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1_000 });
  await login(page);
  const fixture = new StrictPublicImportFixture();
  configureFixture(fixture);
  await fixture.install(page);
  await openNewAcquisitionTask(page);

  await page.locator('[data-field="public-import-urls"]').fill([
    validUrls[0],
    "http://www.douyin.com/video/7521000000000000102",
    "https://example.com/video/7521000000000000103",
    validUrls[1]
  ].join("\n"));
  await page.getByRole("button", { name: "导入公开链接" }).click();

  await expect.poll(() => fixture.calls(
    "POST",
    "/api/v1/acquisition/import-operations"
  ).length).toBe(1);
  await expect.poll(() => fixture.calls(
    "GET",
    `/api/v1/acquisition/import-operations/${operationId}`
  ).length).toBe(2);
  const outcome = page.getByRole("region", { name: "导入结果" });
  await expect(outcome).toContainText("接收 2 行");
  await expect(outcome).toContainText("形成 2 条证据");
  await expect(outcome).toContainText("生成 2 个待核验候选");
  await expect(page.getByText("仅支持 HTTPS 公开链接", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("仅支持抖音公开域名链接", { exact: true }))
    .toBeVisible();

  await expect(outcome.getByRole("button", {
    name: "打开待核验候选 1"
  })).toBeVisible();
  await expect(outcome.getByRole("button", {
    name: "打开待核验候选 2"
  })).toBeVisible();

  await outcome.getByRole("button", { name: "打开待核验候选 1" })
    .click();
  const drawer = page.getByRole("dialog", {
    name: importedCandidate.publicDisplayName
  });
  await expect(drawer.getByRole("heading", { name: "主体核验" }))
    .toBeVisible();
  await expect(drawer).toContainText(importedEvidence.sourceTitle);
  await expect(drawer).toContainText("user_supplied");
  await expect(drawer).toContainText(
    "原始发现证据仅用于判断需求，不能直接确认主体"
  );

  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/candidates/${candidateIds[0]}`
  )).toHaveLength(1);
  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/candidates/${candidateIds[0]}/evidence`
  )).toHaveLength(1);
  for (const suffix of ["qualification", "financial-value", "battle-card"]) {
    expect(fixture.calls(
      "GET",
      `/api/v1/acquisition/candidates/${candidateIds[0]}/${suffix}`
    )).toHaveLength(0);
  }

  const writePaths = fixture.writes().map((request) =>
    `${request.method} ${request.pathname}`
  );
  expect(writePaths).toEqual([
    "POST /api/v1/acquisition/import-operations"
  ]);
  expect(writePaths.some((path) =>
    /crm|review|convert|comment|reply|message|friend|outreach/iu.test(path)
  )).toBe(false);
  expect(fixture.calls("POST", "/api/todos")).toHaveLength(0);
  fixture.assertNoUnexpected();
});

test("CSV partial success shows truthful row errors and only accepted unresolved candidates", async ({ page }) => {
  const csv = [
    "标题,摘要,平台,链接,发布时间,语言",
    `门店获客咨询,正在寻找获客方案,douyin,${validUrls[0]},2026-08-01T00:00:00.000Z,zh-CN`,
    `缺少摘要,,douyin,${validUrls[1]},,zh-CN`
  ].join("\n");
  await page.setViewportSize({ width: 1440, height: 1_000 });
  await login(page);
  const fixture = new StrictPublicImportFixture();
  configurePartialFileFixture(fixture, csv);
  await fixture.install(page);
  await openNewAcquisitionTask(page);

  await page.locator('[data-field="public-import-file"]').setInputFiles({
    name: "douyin-leads.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8")
  });
  await expect(page.getByText(/douyin-leads\.csv/u)).toBeVisible();
  await page.getByRole("button", { name: "上传并导入" }).click();

  await expect.poll(() => fixture.calls(
    "GET",
    `/api/v1/acquisition/import-operations/${fileOperationId}`
  ).length).toBe(1);
  const outcome = page.getByRole("region", { name: "导入结果" });
  await expect(outcome).toContainText("接收 1 行");
  await expect(outcome).toContainText("形成 1 条证据");
  await expect(outcome).toContainText("生成 1 个待核验候选");
  await expect(outcome.getByRole("button", {
    name: "打开待核验候选 1"
  })).toBeVisible();
  await expect(outcome.getByRole("button", {
    name: /\u6253\u5f00\u5f85\u6838\u9a8c\u5019\u9009 2/u
  })).toHaveCount(0);
  const errors = page.getByRole("list", { name: "逐行导入错误" });
  await expect(errors).toContainText("第 3 行 · CSV");
  await expect(errors).toContainText("摘要不能为空");
  await expect(errors).toContainText("missing_source_snippet");
  await expect(page.locator('[data-file-status="accepted"]'))
    .toContainText("导入完成");

  expect(fixture.calls(
    "POST",
    "/api/v1/acquisition/import-operations"
  )).toHaveLength(1);
  expect(fixture.writes().map((request) =>
    `${request.method} ${request.pathname}`
  )).toEqual(["POST /api/v1/acquisition/import-operations"]);
  fixture.assertNoUnexpected();
});
