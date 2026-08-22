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
  idempotencyKey: string | null;
  ifMatch: string | null;
};

type FixtureHandler = (
  request: FixtureRequest
) => FixtureResponse | Promise<FixtureResponse>;

class StrictIdentityFixture {
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

const timestamp = "2026-08-06T03:00:00.000Z";
const planId = "plan/抖音 个人主体核验-001";
const encodedPlanId = encodeURIComponent(planId);
const taskPath = `/api/v1/acquisition/tasks/${encodedPlanId}`;
const candidateId = "candidate-douyin-personal-001";
const oldCandidateId = "candidate-old-card-001";
const profileUrl = "https://www.douyin.com/user/MS4wLjABAAAA";
const originalEvidenceId = "evidence-douyin-video-signal-001";
const profileEvidenceId = "evidence-douyin-profile-001";
const researchEvidenceId = "evidence-douyin-research-001";
const contentFetchId = "content-fetch-profile-001";
const sessionId = "copilot-session-identity-001";
const messagePath =
  `/api/v1/acquisition/copilot/sessions/${sessionId}/messages`;
const candidatePath = `/api/v1/acquisition/candidates/${candidateId}`;
const evidencePath = `${candidatePath}/evidence`;
const qualificationPath = `${candidatePath}/qualification`;
const financialPath = `${candidatePath}/financial-value`;
const battleCardPath = `${candidatePath}/battle-card`;
const identityConfirmationPath = `${candidatePath}/identity-confirmation`;

const budgetSnapshot = {
  billingCurrency: "CNY",
  maxRequests: 8,
  maxResults: 40,
  maxAmountMinor: 2_000,
  maxDurationSeconds: 90
};

const modelSnapshotRef = {
  jobSnapshotId: "snapshot-identity-001",
  connectionId: "model-connection-zhipu-001",
  credentialVersion: 3,
  provider: "zhipu",
  model: "glm-4.5",
  capabilitySnapshotHash: "sha256:identity-capability",
  promptVersion: "acquisition-identity-v1",
  schemaVersion: "acquisition-identity-v1",
  promptHash: "sha256:identity-prompt",
  schemaHash: "sha256:identity-schema"
};

const planDraft = {
  targetPlatform: "douyin",
  name: "抖音个人需求主体核验",
  objective: "从抖音公开索引需求信号中识别可核验的个人候选主体",
  icp: {
    industries: ["本地生活"],
    regions: ["厦门"],
    organizationCriteria: [],
    individualCriteria: ["公开表达获客系统需求"],
    exclusionRules: ["未完成主体核验不得评分或触达"]
  },
  subjectChannels: { organization: false, individual: true },
  providerConnections: [],
  operations: [],
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
  status: "approved",
  version: 1,
  revision: 2,
  etag: '"plan-douyin-identity-001:2"',
  currentVersionId: "plan-version-identity-001",
  approvedVersionId: "plan-version-identity-001",
  approvedSnapshotHash: "sha256:identity-approved",
  approvedBy: "u_manager_alex",
  approvedAt: timestamp,
  budgetSnapshot,
  payload: planDraft,
  createdBy: "u_manager_alex",
  createdAt: timestamp,
  updatedBy: "u_manager_alex",
  updatedAt: timestamp
};

const run = {
  id: "run-douyin-identity-001",
  ownerId: "u_manager_alex",
  teamId: "europe",
  planId,
  planVersionId: plan.currentVersionId,
  planVersion: 1,
  planSnapshotHash: "sha256:identity-plan",
  parentRunId: null,
  status: "succeeded",
  terminationIntent: null,
  revision: 2,
  etag: '"run-douyin-identity-001:2"',
  budgetSnapshotId: "budget-identity-001",
  budgetSnapshot,
  budgetSnapshotHash: "sha256:identity-budget",
  billingCurrency: "CNY",
  modelSnapshotRef,
  consumedBudget: {
    requests: 2,
    results: 2,
    amountMinor: 400,
    durationSeconds: 12
  },
  evidenceCount: 2,
  reason: "fixture completed",
  createdBy: "u_manager_alex",
  createdAt: timestamp,
  updatedBy: "acquisition-worker",
  updatedAt: timestamp,
  completedAt: timestamp
};

const originalEvidence = {
  id: originalEvidenceId,
  targetType: "individual_signal",
  sourcePlatform: "douyin",
  sourceTitle: "抖音公开视频中的获客需求留言",
  sourceSnippet: "正在对比可以分析真实意向的获客系统",
  publishedAt: "2026-08-01T00:00:00.000Z",
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "sha256:identity-original-raw",
  contentHash: "sha256:identity-original-content",
  provenance: {
    kind: "search_result",
    provider: "baidu_ai_search",
    queryText: "site:douyin.com 厦门 获客系统",
    sourceUrl: "https://www.douyin.com/video/7390012345678901234",
    resultRank: 1,
    sourceType: "video"
  },
  accessStatus: "public_content"
};

const profileEvidence = {
  id: profileEvidenceId,
  targetType: "individual_signal",
  sourcePlatform: "www.douyin.com",
  sourceTitle: "厦门门店经营者公开抖音主页",
  sourceSnippet: "公开主页简介及历史内容与原始需求信号主体一致",
  publishedAt: null,
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "sha256:identity-profile-raw",
  contentHash: "sha256:identity-profile-content",
  provenance: {
    kind: "user_submitted_url",
    sourceUrl: profileUrl,
    submittedBy: "u_manager_alex"
  },
  accessStatus: "public_content"
};

const researchEvidence = {
  id: researchEvidenceId,
  targetType: "individual_signal",
  sourcePlatform: "douyin",
  sourceTitle: "公开主页补充研究",
  sourceSnippet: "近期开店内容表明其正在评估获客与私域承接方案",
  publishedAt: "2026-08-02T00:00:00.000Z",
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "sha256:identity-research-raw",
  contentHash: "sha256:identity-research-content",
  provenance: {
    kind: "search_result",
    provider: "baidu_ai_search",
    queryText: "公开主页补充研究",
    sourceUrl: profileUrl,
    resultRank: 1,
    sourceType: "profile"
  },
  accessStatus: "public_content"
};

const unresolvedCandidate = {
  id: candidateId,
  subjectKind: "individual",
  publicActorKey: `unresolved:${candidateId}`,
  publicDisplayName: "厦门门店经营者（主体待核实）",
  publicProfileUrl: originalEvidence.provenance.sourceUrl,
  sourcePlatform: "douyin",
  evidenceIds: [originalEvidenceId],
  demandCategory: "AI 获客系统",
  demandSummary: "正在寻找能识别真实意向并辅助私域转化的系统",
  locationHint: "厦门",
  buyingStage: "solution_research",
  negativeSignals: [],
  status: "unresolvable",
  version: 3,
  identityResolved: false,
  latestDecisionVersion: null,
  approvedDecisionVersion: null,
  updatedAt: timestamp,
  firstSeenAt: timestamp,
  lastSeenAt: timestamp
};

const resolvedCandidate = {
  ...unresolvedCandidate,
  publicActorKey: "public:douyin:sha256:verified-actor",
  publicDisplayName: "厦门门店经营者",
  publicProfileUrl: profileUrl,
  evidenceIds: [originalEvidenceId, profileEvidenceId],
  status: "normalized",
  version: 4,
  identityResolved: true,
  updatedAt: "2026-08-06T03:01:00.000Z"
};

const researchedCandidate = {
  ...resolvedCandidate,
  evidenceIds: [originalEvidenceId, profileEvidenceId, researchEvidenceId],
  version: 5,
  updatedAt: "2026-08-06T03:02:00.000Z"
};

const qualification = {
  id: "qualification-identity-001",
  candidateId,
  decisionVersion: "qualification.identity:6",
  decisionEngine: "model",
  grade: "A",
  score: 88,
  recommendedAction: "priority_review",
  evidence: [{
    evidenceId: researchEvidenceId,
    excerpt: researchEvidence.sourceSnippet
  }],
  positiveSignals: [{ name: "明确方案对比与开店场景", score: 27 }],
  negativeSignals: [],
  reasons: ["公开主页与原始需求信号已由人工核验为同一主体"],
  confidence: 0.89,
  ruleVersion: "qualification.v1",
  promptVersion: "qualification.identity.v1",
  modelProvider: "zhipu",
  model: "glm-4.5",
  hardGateFailures: [],
  createdAt: "2026-08-06T03:03:00.000Z"
};

const financialValue = {
  id: "financial-identity-001",
  candidateId,
  qualificationDecisionId: qualification.id,
  version: "financial.identity:6",
  grade: "A",
  score: 81,
  currency: "CNY",
  expectedRevenueMinor: 680_000,
  expectedGrossProfitMinor: 310_000,
  expectedContributionMinor: 190_000,
  factors: {
    profitability: 0.76,
    cashFlow: 0.72,
    creditQuality: 0.68,
    repeatPotential: 0.75,
    referralPotential: 0.55,
    closeProbability: 0.64
  },
  createdAt: "2026-08-06T03:03:00.000Z"
};

const pendingReviewCandidate = {
  ...researchedCandidate,
  status: "pending_review",
  version: 6,
  latestDecisionVersion: qualification.decisionVersion,
  updatedAt: "2026-08-06T03:03:00.000Z"
};

const battleCard = {
  id: "battle-card-identity-001",
  candidateId,
  qualificationDecisionId: qualification.id,
  partyType: "individual",
  schemaVersion: "battle-card.v2",
  intelligence: {
    accountOverview: [{
      kind: "fact",
      text: "公开主页已核验为厦门门店经营者本人使用的商务账号。",
      evidenceIds: [profileEvidenceId],
      confidence: 1
    }],
    needAssessment: [{
      kind: "fact",
      text: "正在比较能识别真实意向并承接私域的获客系统。",
      evidenceIds: [originalEvidenceId, researchEvidenceId],
      confidence: 0.96
    }],
    supplierHypotheses: [{
      kind: "unknown",
      text: "现有获客供应商尚无充分公开证据。",
      evidenceIds: [],
      confidence: null
    }],
    buyingCommittee: [{
      role: "门店经营者",
      priority: 1,
      influence: "decision_maker",
      concerns: ["有效线索率", "私域转化", "投入产出"],
      claim: {
        kind: "inference",
        text: "该账号使用者可能直接参与采购决策。",
        evidenceIds: [profileEvidenceId, researchEvidenceId],
        confidence: 0.78
      }
    }],
    procurementPreferences: [{
      kind: "inference",
      text: "更关注真实意向判断与可量化转化，而非线索数量。",
      evidenceIds: [originalEvidenceId, researchEvidenceId],
      confidence: 0.83
    }],
    connectionStrategies: [{
      channel: "public_reply",
      targetRole: "门店经营者",
      rationale: {
        kind: "fact",
        text: "原始需求来自公开内容，适合先以公开诊断问题回应。",
        evidenceIds: [originalEvidenceId],
        confidence: 1
      },
      openingDraft: "先确认您更想减少无效线索，还是提升现有咨询的私域转化？"
    }],
    roleSpecificOpeners: [{
      role: "门店经营者",
      channel: "public_reply",
      text: "可以先按您现有渠道做一次真实意向漏斗诊断。"
    }],
    doNotActions: ["未经人工审核不要触达", "不要把一次公开留言等同于采购承诺"],
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
  },
  evidenceIds: [originalEvidenceId, profileEvidenceId, researchEvidenceId],
  confidence: 0.87,
  modelProvider: "zhipu",
  model: "glm-4.5",
  promptVersion: "battle-card.identity.v1",
  createdAt: "2026-08-06T03:04:00.000Z"
};

const oldQualification = {
  ...qualification,
  id: "qualification-old-001",
  candidateId: oldCandidateId,
  decisionVersion: "qualification.old:2",
  reasons: ["旧候选资格结论—不得泄露到新抽屉"]
};

const oldFinancialValue = {
  ...financialValue,
  id: "financial-old-001",
  candidateId: oldCandidateId,
  qualificationDecisionId: oldQualification.id
};

const oldEvidence = {
  ...researchEvidence,
  id: "evidence-old-001",
  targetType: "organization",
  sourcePlatform: "企业官网",
  sourceTitle: "旧候选公开证据",
  sourceSnippet: "旧候选信息"
};

const oldCandidate = {
  id: oldCandidateId,
  subjectKind: "organization",
  name: "旧候选企业（状态隔离样例）",
  domain: "https://old-candidate.example.test",
  region: "厦门",
  creditCode: null,
  evidenceIds: [oldEvidence.id],
  status: "pending_review",
  version: 2,
  identityResolved: true,
  latestDecisionVersion: oldQualification.decisionVersion,
  approvedDecisionVersion: null,
  updatedAt: timestamp,
  createdAt: timestamp
};

const oldBattleCard = {
  ...battleCard,
  id: "battle-card-old-001",
  candidateId: oldCandidateId,
  qualificationDecisionId: oldQualification.id,
  partyType: "organization",
  intelligence: {
    ...battleCard.intelligence,
    accountOverview: [{
      kind: "fact",
      text: "旧候选作战卡内容—不得泄露到新抽屉",
      evidenceIds: [oldEvidence.id],
      confidence: 1
    }],
    financialSummary: {
      ...battleCard.intelligence.financialSummary,
      decisionId: oldFinancialValue.id,
      decisionVersion: oldFinancialValue.version
    }
  },
  evidenceIds: [oldEvidence.id]
};

const stalePresentationQualification = {
  ...qualification,
  id: "qualification-stale-presentation",
  decisionVersion: "qualification.stale:1",
  reasons: ["列表旧资格—抽屉必须读取权威接口"]
};

const providerPresentation = {
  shardId: "shard-identity-001",
  connectionId: "search-connection-identity-001",
  providerId: "baidu_ai_search",
  status: "succeeded",
  rawResultCount: 2,
  acceptedResultCount: 2,
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
    dedupedCandidates: 2,
    validOpportunities: 1,
    highIntent: 1,
    financialEvaluatedHighIntentCount: 1,
    financialPendingHighIntentCount: 0,
    expectedRevenueByCurrency: [{ currency: "CNY", amountMinor: 1_200_000 }]
  },
  candidateEvents: [{
    eventId: "candidate-event-old-001",
    createdAt: timestamp,
    candidateId: oldCandidateId,
    candidate: {
      id: oldCandidateId,
      subjectKind: "organization",
      displayName: oldCandidate.name,
      industry: "企业服务",
      region: oldCandidate.region,
      domain: oldCandidate.domain,
      status: oldCandidate.status,
      version: oldCandidate.version,
      identityResolved: true,
      updatedAt: timestamp
    },
    qualification: oldQualification,
    financialValue: oldFinancialValue,
    sourcePlatforms: ["企业官网"],
    evidenceCount: 1
  }, {
    eventId: "candidate-event-personal-001",
    createdAt: timestamp,
    candidateId,
    candidate: {
      id: candidateId,
      subjectKind: "individual",
      displayName: unresolvedCandidate.publicDisplayName,
      industry: "本地生活",
      region: unresolvedCandidate.locationHint,
      domain: unresolvedCandidate.publicProfileUrl,
      status: unresolvedCandidate.status,
      version: 3,
      identityResolved: false,
      updatedAt: timestamp
    },
    qualification: stalePresentationQualification,
    financialValue,
    sourcePlatforms: ["douyin"],
    evidenceCount: 1
  }],
  nextAfter: "identity-complete-cursor",
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
  plan,
  latestRun: run,
  shards: [],
  presentation
};

function pageOf(items: unknown[]) {
  return { items, nextCursor: null };
}

function missing(message: string): FixtureResponse {
  return { status: 404, body: { message } };
}

function contentFetchOperation(
  status: "queued" | "running" | "succeeded" | "access_restricted",
  evidenceIds = [profileEvidenceId]
) {
  const completed = status === "succeeded" || status === "access_restricted";
  return {
    id: contentFetchId,
    ownerId: "u_manager_alex",
    teamId: "europe",
    actorId: "u_manager_alex",
    sourceUrl: profileUrl,
    finalUrl: completed ? profileUrl : null,
    subjectChannel: "individual",
    status,
    accessStatus: status === "succeeded"
      ? "public_content"
      : status === "access_restricted" ? "access_restricted" : null,
    httpStatus: status === "succeeded"
      ? 200
      : status === "access_restricted" ? 403 : null,
    contentType: completed ? "text/html" : null,
    title: completed ? profileEvidence.sourceTitle : null,
    rawArtifactHash: completed
      ? profileEvidence.rawArtifactHash
      : null,
    contentHash: completed
      ? profileEvidence.contentHash
      : null,
    evidenceCount: completed ? evidenceIds.length : 0,
    evidenceIds: completed ? evidenceIds : [],
    errorCode: null,
    createdAt: timestamp,
    startedAt: status === "queued" ? null : timestamp,
    completedAt: completed ? timestamp : null
  };
}

function succeededTask(id: string, toolName: string) {
  return {
    id,
    sessionId,
    kind: "message",
    status: "succeeded",
    responseMode: "assistant",
    result: { toolNames: [toolName] },
    errorCode: null,
    createdAt: timestamp,
    completedAt: timestamp
  };
}

function configureNavigation(fixture: StrictIdentityFixture) {
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
      body: { items: [], nextCursor: null }
    })
    .on("GET", taskPath, { body: taskDetail });
  return fixture;
}

function configureInitialCandidateReads(fixture: StrictIdentityFixture) {
  fixture
    .on("GET", candidatePath, { body: unresolvedCandidate })
    .on("GET", evidencePath, { body: pageOf([originalEvidence]) })
    .on("GET", qualificationPath, missing("qualification missing"))
    .on("GET", financialPath, missing("financial value missing"))
    .on("GET", battleCardPath, missing("battle card missing"));
  return fixture;
}

function configureOldCandidate(fixture: StrictIdentityFixture) {
  const path = `/api/v1/acquisition/candidates/${oldCandidateId}`;
  fixture
    .on("GET", path, { body: oldCandidate })
    .on("GET", `${path}/evidence`, { body: pageOf([oldEvidence]) })
    .on("GET", `${path}/qualification`, { body: oldQualification })
    .on("GET", `${path}/financial-value`, { body: oldFinancialValue })
    .on("GET", `${path}/battle-card`, { body: oldBattleCard });
  return fixture;
}

async function login(page: Page) {
  await page.goto("/");
  await page.locator("#loginEmail").fill("alex@goodjob.com");
  await page.locator("#loginPassword").fill("goodjob123");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/u);
}

async function openTaskPage(page: Page, fixture: StrictIdentityFixture) {
  await login(page);
  await fixture.install(page);
  const button = page.locator('.nav button[data-view="ai-growth"]');
  if (!(await button.isVisible())) {
    const group = button.locator("xpath=ancestor::details[1]");
    if (await group.count()) await group.locator("summary").click();
  }
  await button.click();
  await expect(page.locator("#ai-growth")).toHaveClass(/active/u);
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#ai-growth/task/${encodedPlanId}`);
  await expect(page).toHaveURL(
    new RegExp(`#ai-growth/task/${encodedPlanId}$`, "u")
  );
  await expect(page.getByRole("heading", { name: planDraft.name }))
    .toBeVisible();
}

function assertNoForbiddenWrites(fixture: StrictIdentityFixture) {
  const forbidden = fixture.writes().filter((request) =>
    request.pathname === "/api/todos"
    || /\/review(?:\/|$)|\/conversion(?:\/|$)|\/convert(?:\/|$)/u
      .test(request.pathname)
    || /outreach|comment|reply|direct-message|private-message|friend|group/iu
      .test(request.pathname)
  );
  expect(forbidden, JSON.stringify(forbidden, null, 2)).toEqual([]);
}

test("verifies a Douyin personal candidate then runs research, qualification, and battle card in order", async ({ page }) => {
  const fixture = configureNavigation(new StrictIdentityFixture());
  configureOldCandidate(fixture);
  fixture
    .on(
      "GET",
      candidatePath,
      { body: unresolvedCandidate },
      { body: researchedCandidate },
      { body: pendingReviewCandidate },
      { body: pendingReviewCandidate }
    )
    .on(
      "GET",
      evidencePath,
      { body: pageOf([originalEvidence]) },
      {
        body: pageOf([
          originalEvidence,
          profileEvidence,
          researchEvidence
        ])
      },
      {
        body: pageOf([
          originalEvidence,
          profileEvidence,
          researchEvidence
        ])
      }
    )
    .on(
      "GET",
      qualificationPath,
      missing("qualification missing"),
      { body: qualification },
      { body: qualification }
    )
    .on(
      "GET",
      financialPath,
      missing("financial value missing"),
      { body: financialValue },
      { body: financialValue }
    )
    .on(
      "GET",
      battleCardPath,
      missing("battle card missing"),
      { body: battleCard }
    )
    .on("POST", "/api/v1/acquisition/content-fetch-operations", {
      status: 202,
      body: contentFetchOperation("queued")
    })
    .on(
      "GET",
      `/api/v1/acquisition/content-fetch-operations/${contentFetchId}`,
      { body: contentFetchOperation("running") },
      { body: contentFetchOperation("succeeded") }
    )
    .on("GET", `/api/v1/acquisition/evidence/${profileEvidenceId}`, {
      body: profileEvidence
    })
    .on("POST", identityConfirmationPath, {
      body: {
        candidate: resolvedCandidate,
        resolution: {
          status: "resolved",
          basis: "provider_public_actor",
          resolverVersion: "identity-resolver.v1",
          evidenceIds: [profileEvidenceId],
          resolvedAt: "2026-08-06T03:01:00.000Z",
          resolvedBy: "u_manager_alex"
        }
      }
    })
    .on("POST", "/api/v1/acquisition/copilot/sessions", {
      status: 202,
      body: {
        id: "operation-create-session-identity-001",
        kind: "copilot_session_creation",
        status: "succeeded",
        resourceId: sessionId,
        createdAt: timestamp,
        completedAt: timestamp
      }
    })
    .on(
      "POST",
      messagePath,
      { status: 202, body: succeededTask("task-research-001", "research_candidate") },
      { status: 202, body: succeededTask("task-qualify-001", "qualify_candidate") },
      { status: 202, body: succeededTask("task-card-001", "build_battle_card") }
    );

  await openTaskPage(page, fixture);

  const oldCard = page.locator(
    `.ai-growth-candidate-card[data-candidate-id="${oldCandidateId}"]`
  );
  await oldCard.getByRole("button", { name: "查看客户作战卡" }).click();
  const oldDrawer = page.getByRole("dialog", { name: oldCandidate.name });
  await expect(oldDrawer).toContainText("旧候选资格结论—不得泄露到新抽屉");
  await expect(oldDrawer).toContainText("旧候选作战卡内容—不得泄露到新抽屉");
  await oldDrawer.getByRole("button", { name: "关闭客户作战卡" }).click();

  const unresolvedCard = page.locator(
    `.ai-growth-candidate-card[data-candidate-id="${candidateId}"]`
  );
  await expect(unresolvedCard.getByRole("button", { name: "核验主体" }))
    .toBeVisible();
  await unresolvedCard.getByRole("button", { name: "核验主体" }).click();

  const drawer = page.locator(
    `.ai-growth-battle-drawer[data-candidate-id="${candidateId}"]`
  );
  await expect(drawer).toContainText("判断与作战资料暂未开放");
  await expect(drawer).not.toContainText("旧候选资格结论—不得泄露到新抽屉");
  await expect(drawer).not.toContainText("旧候选作战卡内容—不得泄露到新抽屉");
  await expect(drawer).not.toContainText("列表旧资格—抽屉必须读取权威接口");

  await drawer.locator('[data-field="identity-profile-url"]').fill(profileUrl);
  await drawer.getByRole("button", { name: "抓取公开主页" }).click();
  const profileCheckbox = drawer.locator(
    `[data-field="identity-evidence"][data-evidence-id="${profileEvidenceId}"]`
  );
  await expect(profileCheckbox).toBeEnabled();
  await profileCheckbox.check();
  const rationale = "已人工核验公开主页、显示名称与原始需求信号属于同一主体。";
  await drawer.locator('[data-field="identity-rationale"]').fill(rationale);
  const confirm = drawer.getByRole("button", { name: "确认主体并继续" });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(drawer).toContainText("作战资料已生成，等待人工审核");
  await expect(drawer).toContainText("正在比较能识别真实意向并承接私域的获客系统");
  await expect(drawer).toContainText("候选资格人工复核");
  await expect(drawer).toContainText("未经人工审核不要触达");

  const contentFetch = fixture.calls(
    "POST",
    "/api/v1/acquisition/content-fetch-operations"
  );
  expect(contentFetch).toHaveLength(1);
  expect(contentFetch[0]?.body).toEqual({
    sourceUrl: profileUrl,
    subjectChannel: "individual"
  });
  expect(contentFetch[0]?.idempotencyKey).toBeTruthy();
  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/content-fetch-operations/${contentFetchId}`
  )).toHaveLength(2);
  expect(fixture.calls(
    "GET",
    `/api/v1/acquisition/evidence/${profileEvidenceId}`
  )).toHaveLength(1);

  const confirmations = fixture.calls("POST", identityConfirmationPath);
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]?.ifMatch).toBe('"candidate-v3"');
  expect(confirmations[0]?.idempotencyKey).toBeTruthy();
  expect(confirmations[0]?.body).toEqual({
    subjectKind: "individual",
    publicProfileUrl: profileUrl,
    sourcePlatform: "douyin",
    evidenceIds: [profileEvidenceId],
    rationale
  });

  const messages = fixture.calls("POST", messagePath);
  expect(messages).toHaveLength(3);
  expect(messages.map((request) => request.body)).toEqual([
    {
      message: expect.stringMatching(
        /research_candidate.*"depth":"standard"/u
      ),
      responseMode: "assistant"
    },
    {
      message: expect.stringMatching(
        /qualify_candidate.*"policyVersion":"qualification\.v1"/u
      ),
      responseMode: "assistant"
    },
    {
      message: expect.stringMatching(
        /build_battle_card.*"templateVersion":"battle-card\.v2"/u
      ),
      responseMode: "assistant"
    }
  ]);
  expect(messages.every((request) => Boolean(request.idempotencyKey)))
    .toBe(true);

  const writes = fixture.writes().map((request) =>
    `${request.method} ${request.pathname}`
  );
  expect(writes).toEqual([
    "POST /api/v1/acquisition/content-fetch-operations",
    `POST ${identityConfirmationPath}`,
    "POST /api/v1/acquisition/copilot/sessions",
    `POST ${messagePath}`,
    `POST ${messagePath}`,
    `POST ${messagePath}`
  ]);
  assertNoForbiddenWrites(fixture);
  fixture.assertNoUnexpected();
});

test("blocks video and short links, then refuses restricted or mismatched profile evidence", async ({ page }) => {
  const restrictedEvidence = {
    ...profileEvidence,
    id: "evidence-profile-restricted",
    accessStatus: "access_restricted"
  };
  const mismatchedEvidence = {
    ...profileEvidence,
    id: "evidence-profile-mismatch",
    provenance: {
      ...profileEvidence.provenance,
      sourceUrl: "https://www.douyin.com/user/DIFFERENT"
    }
  };
  const fixture = configureNavigation(new StrictIdentityFixture());
  configureInitialCandidateReads(fixture);
  fixture
    .on(
      "POST",
      "/api/v1/acquisition/content-fetch-operations",
      {
        status: 202,
        body: contentFetchOperation("access_restricted", [
          restrictedEvidence.id
        ])
      },
      {
        status: 202,
        body: contentFetchOperation("succeeded", [mismatchedEvidence.id])
      }
    )
    .on("GET", `/api/v1/acquisition/evidence/${mismatchedEvidence.id}`, {
      body: mismatchedEvidence
    });

  await openTaskPage(page, fixture);
  const card = page.locator(
    `.ai-growth-candidate-card[data-candidate-id="${candidateId}"]`
  );
  await card.getByRole("button", { name: "核验主体" }).click();
  const drawer = page.getByRole("dialog", {
    name: unresolvedCandidate.publicDisplayName
  });
  const input = drawer.locator('[data-field="identity-profile-url"]');
  const fetch = drawer.getByRole("button", { name: "抓取公开主页" });

  await input.fill("https://www.douyin.com/video/7390012345678901234");
  await expect(fetch).toBeDisabled();
  await input.fill("https://v.douyin.com/ABC123/");
  await expect(fetch).toBeDisabled();
  expect(fixture.calls(
    "POST",
    "/api/v1/acquisition/content-fetch-operations"
  )).toHaveLength(0);

  await input.fill(profileUrl);
  await expect(fetch).toBeEnabled();
  await fetch.click();
  await expect(drawer).toContainText("公开主页访问受限");
  await expect(fetch).toBeEnabled();
  await fetch.click();
  const mismatched = drawer.locator(
    `[data-field="identity-evidence"][data-evidence-id="${mismatchedEvidence.id}"]`
  );
  await expect(mismatched).toBeDisabled();
  const mismatchedRow = mismatched.locator(
    "xpath=ancestor::div[contains(@class, 'ai-growth-identity-evidence')]"
  );
  await expect(mismatchedRow.getByRole("link", { name: "打开公开证据" }))
    .toHaveAttribute("href", "https://www.douyin.com/user/DIFFERENT");
  await drawer.locator('[data-field="identity-rationale"]').fill(
    "即使填写核验说明，也不能使用受限或错主页证据。"
  );
  await expect(drawer.getByRole("button", { name: "确认主体并继续" }))
    .toBeDisabled();

  expect(fixture.calls("POST", identityConfirmationPath)).toHaveLength(0);
  expect(fixture.writes().map((request) => request.pathname)).toEqual([
    "/api/v1/acquisition/content-fetch-operations",
    "/api/v1/acquisition/content-fetch-operations"
  ]);
  assertNoForbiddenWrites(fixture);
  fixture.assertNoUnexpected();
});

test("shows a 412 identity conflict and never replays the stale confirmation", async ({ page }) => {
  const refreshedUnresolvedCandidate = {
    ...unresolvedCandidate,
    version: 4,
    updatedAt: "2026-08-06T03:05:00.000Z"
  };
  const fixture = configureNavigation(new StrictIdentityFixture());
  fixture
    .on(
      "GET",
      candidatePath,
      { body: unresolvedCandidate },
      { body: refreshedUnresolvedCandidate }
    )
    .on(
      "GET",
      evidencePath,
      { body: pageOf([originalEvidence]) },
      { body: pageOf([originalEvidence, profileEvidence]) }
    )
    .on("GET", qualificationPath, missing("qualification missing"))
    .on("GET", financialPath, missing("financial value missing"))
    .on("GET", battleCardPath, missing("battle card missing"))
    .on("POST", "/api/v1/acquisition/content-fetch-operations", {
      status: 202,
      body: contentFetchOperation("succeeded")
    })
    .on("GET", `/api/v1/acquisition/evidence/${profileEvidenceId}`, {
      body: profileEvidence
    })
    .on("POST", identityConfirmationPath, {
      status: 412,
      body: { message: "candidate version is stale" }
    });

  await openTaskPage(page, fixture);
  const card = page.locator(
    `.ai-growth-candidate-card[data-candidate-id="${candidateId}"]`
  );
  await card.getByRole("button", { name: "核验主体" }).click();
  const drawer = page.getByRole("dialog", {
    name: unresolvedCandidate.publicDisplayName
  });
  await drawer.locator('[data-field="identity-profile-url"]').fill(profileUrl);
  await drawer.getByRole("button", { name: "抓取公开主页" }).click();
  await drawer.locator(
    `[data-field="identity-evidence"][data-evidence-id="${profileEvidenceId}"]`
  ).check();
  await drawer.locator('[data-field="identity-rationale"]').fill(
    "已核验公开主页；若版本陈旧必须停止并提示人工刷新。"
  );
  await drawer.getByRole("button", { name: "确认主体并继续" }).click();

  await expect(drawer).toContainText(
    "候选已被其他成员更新，请核对最新版本后重试。"
  );
  await expect(drawer.getByRole("button", { name: "确认主体并继续" }))
    .toBeDisabled();
  const confirmations = fixture.calls("POST", identityConfirmationPath);
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]?.ifMatch).toBe('"candidate-v3"');
  expect(fixture.calls(
    "POST",
    "/api/v1/acquisition/copilot/sessions"
  )).toHaveLength(0);
  expect(fixture.calls("POST", messagePath)).toHaveLength(0);
  assertNoForbiddenWrites(fixture);
  fixture.assertNoUnexpected();
});
