import { expect, test } from "@playwright/test";

test("standalone frontend login enters the demo workspace without an API server", async ({ page }) => {
  await page.goto("/#acquisition");
  await page.locator("#loginButton").click();

  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page.locator(".replica-shell")).toBeVisible();
  await expect(page.locator(".toast.error")).toHaveCount(0);
});

test("standalone frontend restores a saved demo session without calling the API", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("gj_user", JSON.stringify({
      id: "demo-admin",
      name: "Admin",
      email: "admin@goodjob.com",
      role: "admin",
      teamId: "demo-team",
      avatar: "AD"
    }));
  });

  await page.goto("/#acquisition");

  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  expect(apiRequests).toEqual([]);
});

test("standalone frontend does not poll backend dashboards in demo mode", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });

  await page.goto("/#acquisition");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await page.waitForTimeout(10_250);

  expect(apiRequests).toEqual([]);
});

test("real acquisition task opens authoritative plan and AI candidate review", async ({ page }) => {
  const qualification = {
    id: "qualification-ui-1",
    candidateId: "candidate-ui-1",
    decisionVersion: "decision-ui-v1",
    decisionEngine: "model",
    grade: "A",
    score: 86,
    recommendedAction: "priority_review",
    evidence: [{ evidenceId: "evidence-ui-1", excerpt: "公开表示正在比较 AI 获客方案" }],
    positiveSignals: [{ name: "明确采购需求", score: 32 }],
    negativeSignals: [],
    reasons: ["出现明确采购需求并主动比较供应商"],
    confidence: 0.91,
    ruleVersion: "qualification-rules-v1",
    promptVersion: "qualification-prompt-v1",
    modelProvider: "zhipu",
    model: "glm-5.2",
    hardGateFailures: [],
    createdAt: "2026-08-07T08:03:00.000Z"
  };
  const financialValue = {
    id: "financial-ui-1",
    candidateId: "candidate-ui-1",
    qualificationDecisionId: qualification.id,
    version: "financial-v1",
    grade: "A",
    score: 82,
    currency: "CNY",
    expectedRevenueMinor: 6800000,
    expectedGrossProfitMinor: 3800000,
    expectedContributionMinor: 2900000,
    factors: {
      profitability: 82,
      cashFlow: 76,
      creditQuality: 88,
      repeatPotential: 78,
      referralPotential: 74,
      closeProbability: 69
    },
    createdAt: "2026-08-07T08:03:00.000Z"
  };
  const task = {
    id: "plan-ui-1",
    planId: "plan-ui-1",
    name: "抖音企业服务真实获客",
    objective: "发现正在采购 AI 获客系统的企业",
    platform: "douyin",
    discoveryMethods: ["public_search"],
    planStatus: "approved",
    latestRun: {
      id: "run-ui-1",
      status: "succeeded",
      updatedAt: "2026-08-07T08:05:00.000Z",
      completedAt: "2026-08-07T08:05:00.000Z",
      evidenceCount: 1,
      consumedBudget: { requests: 2, results: 1, amountMinor: 120, durationSeconds: 18 }
    },
    updatedAt: "2026-08-07T08:05:00.000Z"
  };
  const plan = {
    id: "plan-ui-1",
    ownerId: "demo-admin",
    teamId: "demo-team",
    status: "approved",
    version: 1,
    revision: 2,
    etag: "\"plan-ui-1:2\"",
    currentVersionId: "plan-version-ui-1",
    approvedVersionId: "plan-version-ui-1",
    approvedSnapshotHash: "sha256:approved-ui-1",
    approvedBy: "demo-admin",
    approvedAt: "2026-08-07T08:00:00.000Z",
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 20,
      maxResults: 50,
      maxAmountMinor: 3000,
      maxDurationSeconds: 600
    },
    payload: {
      targetPlatform: "douyin",
      name: task.name,
      objective: task.objective,
      icp: {
        industries: ["企业服务"],
        regions: ["中国大陆"],
        organizationCriteria: ["公开表达采购需求"],
        individualCriteria: ["公开表达合作需求"],
        exclusionRules: ["明确拒绝联系"]
      },
      subjectChannels: { organization: true, individual: true },
      providerConnections: [{
        connectionId: "search-connection-ui-1",
        providerId: "baidu_ai_search",
        kind: "search",
        status: "active",
        credentialVersion: 1
      }],
      operations: [{
        operationId: "operation-ui-1",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "search-connection-ui-1",
        query: "site:douyin.com AI 获客 采购",
        allocatedBudget: { requests: 20, results: 50, amountMinor: 3000, durationSeconds: 600 }
      }],
      budgetSnapshot: {
        billingCurrency: "CNY",
        maxRequests: 20,
        maxResults: 50,
        maxAmountMinor: 3000,
        maxDurationSeconds: 600
      },
      modelSnapshotRef: {
        jobSnapshotId: "model-job-ui-1",
        connectionId: "model-connection-ui-1",
        credentialVersion: 1,
        provider: "zhipu",
        model: "glm-5.2",
        capabilitySnapshotHash: "sha256:capability-ui-1",
        promptVersion: "qualification-prompt-v1",
        schemaVersion: "qualification.v1",
        promptHash: "sha256:prompt-ui-1",
        schemaHash: "sha256:schema-ui-1"
      },
      stopConditions: { stopWhenBudgetExhausted: true, stopWhenNoMoreResults: true }
    },
    createdBy: "demo-admin",
    createdAt: "2026-08-07T08:00:00.000Z",
    updatedBy: "demo-admin",
    updatedAt: "2026-08-07T08:05:00.000Z"
  };
  const latestRun = {
    id: "run-ui-1",
    ownerId: "demo-admin",
    teamId: "demo-team",
    planId: plan.id,
    planVersionId: "plan-version-ui-1",
    planVersion: 1,
    planSnapshotHash: "sha256:approved-ui-1",
    parentRunId: null,
    status: "succeeded",
    terminationIntent: null,
    revision: 2,
    etag: "\"run-ui-1:2\"",
    budgetSnapshotId: "budget-ui-1",
    budgetSnapshot: plan.budgetSnapshot,
    budgetSnapshotHash: "sha256:budget-ui-1",
    billingCurrency: "CNY",
    modelSnapshotRef: plan.payload.modelSnapshotRef,
    consumedBudget: { requests: 2, results: 1, amountMinor: 120, durationSeconds: 18 },
    evidenceCount: 1,
    reason: null,
    createdBy: "demo-admin",
    createdAt: "2026-08-07T08:00:00.000Z",
    updatedBy: "demo-admin",
    updatedAt: "2026-08-07T08:05:00.000Z",
    completedAt: "2026-08-07T08:05:00.000Z"
  };
  const candidateSummary = {
    id: "candidate-ui-1",
    subjectKind: "organization",
    displayName: "厦门增长科技有限公司",
    industry: "企业服务",
    region: "福建厦门",
    domain: "growth.example.cn",
    status: "pending_review",
    version: 2,
    identityResolved: true,
    updatedAt: "2026-08-07T08:04:00.000Z"
  };
  const presentation = {
    run: {
      id: latestRun.id,
      status: latestRun.status,
      etag: latestRun.etag,
      updatedAt: latestRun.updatedAt,
      completedAt: latestRun.completedAt
    },
    providers: [{
      shardId: "shard-ui-1",
      connectionId: "search-connection-ui-1",
      providerId: "baidu_ai_search",
      status: "succeeded",
      rawResultCount: 2,
      acceptedResultCount: 1,
      duplicateResultCount: 0,
      failedResultCount: 0,
      errorCode: null,
      retryAfterAt: null
    }],
    summary: {
      sourcesSearched: 1,
      pagesAnalyzed: 2,
      organizationsFound: 1,
      dedupedCandidates: 1,
      validOpportunities: 1,
      highIntent: 1,
      financialEvaluatedHighIntentCount: 1,
      financialPendingHighIntentCount: 0,
      expectedRevenueByCurrency: [{ currency: "CNY", amountMinor: 6800000 }]
    },
    candidateEvents: [{
      eventId: "candidate-event-ui-1",
      createdAt: "2026-08-07T08:04:00.000Z",
      candidateId: candidateSummary.id,
      candidate: candidateSummary,
      qualification,
      financialValue,
      sourcePlatforms: ["douyin"],
      evidenceCount: 1
    }],
    nextAfter: "candidate-cursor-ui-1",
    hasMore: true
  };
  const candidate = {
    id: candidateSummary.id,
    name: candidateSummary.displayName,
    domain: candidateSummary.domain,
    region: candidateSummary.region,
    creditCode: null,
    evidenceIds: ["evidence-ui-1"],
    subjectKind: "organization",
    status: "pending_review",
    version: 2,
    identityResolved: true,
    latestDecisionVersion: qualification.decisionVersion,
    approvedDecisionVersion: null,
    updatedAt: candidateSummary.updatedAt,
    createdAt: "2026-08-07T08:02:00.000Z"
  };

  await page.route("**/api/v1/acquisition/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(value) });
    if (url.pathname === "/api/v1/acquisition/overview") {
      await json({
        generatedAt: "2026-08-07T08:06:00.000Z",
        platform: "douyin",
        totals: { tasks: 1 },
        statusCounts: { succeeded: 1 },
        discoveryMethodCounts: { public_search: 1 },
        tasks: [task]
      });
      return;
    }
    if (url.pathname === `/api/v1/acquisition/tasks/${plan.id}`) {
      await json({
        task,
        plan,
        latestRun,
        shards: [{
          id: "shard-ui-1",
          runId: latestRun.id,
          ownerId: "demo-admin",
          teamId: "demo-team",
          operationId: "operation-ui-1",
          parentShardId: null,
          subjectChannel: "organization",
          kind: "search",
          connection: plan.payload.providerConnections[0],
          query: plan.payload.operations[0].query,
          sourceRef: "douyin-public-search",
          status: "succeeded",
          budgetSnapshotId: "budget-ui-1",
          allocatedBudget: plan.payload.operations[0].allocatedBudget,
          consumedBudget: latestRun.consumedBudget,
          modelSnapshotRef: latestRun.modelSnapshotRef,
          evidenceCount: 1,
          revision: 2,
          createdAt: latestRun.createdAt,
          updatedAt: latestRun.updatedAt,
          completedAt: latestRun.completedAt
        }],
        presentation
      });
      return;
    }
    if (url.pathname === `/api/v1/acquisition/runs/${latestRun.id}/presentation`) {
      await json({
        ...presentation,
        candidateEvents: [{
          ...presentation.candidateEvents[0],
          eventId: "candidate-event-ui-2",
          candidateId: "candidate-ui-2",
          candidate: {
            ...candidateSummary,
            id: "candidate-ui-2",
            displayName: "福州数智营销有限公司",
            status: "normalized",
            version: 1
          },
          qualification: null,
          financialValue: null
        }],
        nextAfter: "",
        hasMore: false
      });
      return;
    }
    if (url.pathname === `/api/v1/acquisition/candidates/${candidate.id}`) {
      await json(candidate, 200, { ETag: "\"candidate-v2\"" });
      return;
    }
    if (url.pathname === `/api/v1/acquisition/candidates/${candidate.id}/evidence`) {
      await json({
        items: [{
          id: "evidence-ui-1",
          targetType: "organization",
          sourcePlatform: "douyin",
          sourceTitle: "企业公开采购讨论",
          sourceSnippet: "计划采购 AI 获客系统，正在比较供应商",
          publishedAt: "2026-08-06T08:00:00.000Z",
          fetchedAt: "2026-08-07T08:02:00.000Z",
          locale: "zh-CN",
          rawArtifactHash: "sha256:raw-ui-1",
          contentHash: "sha256:content-ui-1",
          provenance: {
            kind: "search_result",
            provider: "baidu_ai_search",
            providerConnectionId: "search-connection-ui-1",
            queryText: "site:douyin.com AI 获客 采购",
            sourceUrl: "https://www.douyin.com/video/example",
            resultRank: 1
          },
          accessStatus: "public_content"
        }],
        nextCursor: null
      });
      return;
    }
    if (url.pathname.endsWith("/qualification")) return void await json(qualification);
    if (url.pathname.endsWith("/financial-value")) return void await json(financialValue);
    if (url.pathname.endsWith("/battle-card")) {
      await json({
        id: "battle-card-ui-1",
        candidateId: candidate.id,
        qualificationDecisionId: qualification.id,
        partyType: "organization",
        evidenceIds: ["evidence-ui-1"],
        confidence: 0.88,
        modelProvider: "zhipu",
        model: "glm-5.2",
        promptVersion: "battle-card-prompt-v1",
        createdAt: "2026-08-07T08:04:00.000Z",
        schemaVersion: "battle-card.v1",
        sections: [{
          label: "推荐切入点",
          kind: "inference",
          content: "先提供行业获客诊断，再讨论产品方案",
          evidenceIds: ["evidence-ui-1"],
          confidence: 0.86
        }],
        intelligence: null
      });
      return;
    }
    if (url.pathname.endsWith("/reviews")) return void await json({ items: [], nextCursor: null });
    await json({ code: "resource_not_found", message: "测试路由未配置", details: null, requestId: "e2e", retryable: false }, 404);
  });

  await page.addInitScript(() => {
    localStorage.setItem("gj_user", JSON.stringify({
      id: "demo-admin",
      name: "Admin",
      email: "admin@goodjob.com",
      role: "admin",
      teamId: "demo-team",
      avatar: "AD"
    }));
  });
  await page.goto("/#acquisition");
  await page.locator('[data-acquisition-mode="real"]').click();
  await expect(page.locator('[data-acquisition-plan-id="plan-ui-1"]')).toBeVisible();
  await expect(page.locator('[data-acquisition-plan-id="plan-ui-1"]')).toHaveClass(/active/);
  await page.locator("#replicaEditTask").click();

  const dialog = page.locator("#replicaAcquisitionDetailCenter");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("发现正在采购 AI 获客系统的企业");
  await dialog.locator('[data-acquisition-detail-action="switch-mode"][data-mode="candidates"]').click();
  await expect(dialog).toContainText("厦门增长科技有限公司");
  await expect(dialog).toContainText("出现明确采购需求并主动比较供应商");
  await expect(dialog.locator(".replica-acquisition-factor-list")).toContainText("82%");
  await expect(dialog.locator(".replica-acquisition-factor-list")).not.toContainText("8200%");
  await dialog.locator('[data-acquisition-detail-action="load-more-candidates"]').click();
  await expect(dialog).toContainText("福州数智营销有限公司");
  await expect(dialog.locator('[data-acquisition-detail-action="load-more-candidates"]')).toHaveCount(0);
});
