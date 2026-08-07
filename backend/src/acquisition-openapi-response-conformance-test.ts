import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";
import { Ajv } from "ajv";
import express, { type Router } from "express";
import {
  createAcquisitionOpenApiPaths
} from "./acquisition-openapi.js";
import {
  createAcquisitionPlanRouter
} from "./acquisition-plan-router.js";
import {
  InMemoryAcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";
import {
  AcquisitionPlanRunService,
  type AcquisitionExecutionPort
} from "./acquisition-plan-run-service.js";
import {
  createAcquisitionProviderConnectionsRouter,
  type AcquisitionProviderConnectionStore
} from "./acquisition-provider-connections-router.js";
import { createDefaultProviderCatalog } from "./provider-catalog.js";
import { createAcquisitionV1Router } from "./acquisition-v1-router.js";

const OWNER = "response-contract-owner";
const TEAM = "response-contract-team";
const NOW = "2026-08-05T00:00:00.000Z";
const openApiPaths = createAcquisitionOpenApiPaths();

function assertResponseConforms(
  path: string,
  method: "get" | "post" | "patch" | "delete",
  status: number,
  body: unknown
) {
  const operation = openApiPaths[path]?.[method] as
    | Record<string, any>
    | undefined;
  assert.ok(operation, `${method.toUpperCase()} ${path}`);
  const schema = operation.responses[String(status)]
    ?.content?.["application/json"]?.schema;
  assert.ok(schema, `${method.toUpperCase()} ${path} ${status} schema`);
  const validate = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false
  }).compile(schema);
  assert.equal(
    validate(body),
    true,
    `${method.toUpperCase()} ${path} ${status}: ${JSON.stringify(
      validate.errors,
      null,
      2
    )}`
  );
}

async function mount(...routers: Router[]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: OWNER,
      teamId: TEAM,
      name: "Response Contract Owner",
      email: "response-contract@example.test",
      role: "sales",
      avatar: "",
      authVersion: 1
    };
    next();
  });
  for (const router of routers) app.use(router);
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    async request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers
      });
      return {
        response,
        body: await response.json().catch(() => null)
      };
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function modelSnapshot() {
  return {
    jobSnapshotId: "job-snapshot-response-contract",
    connectionId: "model-connection-response-contract",
    credentialVersion: 3,
    provider: "qwen",
    model: "qwen-plus",
    capabilitySnapshotHash: "sha256:capability",
    promptVersion: "acquisition-plan.v1",
    schemaVersion: "acquisition-plan.v1",
    promptHash: "sha256:prompt",
    schemaHash: "sha256:schema"
  };
}

function planBody() {
  return {
    name: "公开商机响应契约",
    objective: "验证计划与运行的公开响应投影",
    icp: {
      industries: ["企业服务"],
      regions: ["中国"],
      organizationCriteria: ["公开采购需求"],
      individualCriteria: ["公开比较方案"],
      exclusionRules: []
    },
    subjectChannels: {
      organization: true,
      individual: true
    },
    providerConnections: [{
      connectionId: "search-response-contract",
      providerId: "baidu_ai_search",
      kind: "search",
      status: "active",
      credentialVersion: 1
    }],
    operations: [
      {
        operationId: "operation-organization-response-contract",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "search-response-contract",
        query: "企业公开采购需求",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 100,
          durationSeconds: 60
        }
      },
      {
        operationId: "operation-individual-response-contract",
        subjectChannel: "individual",
        kind: "search",
        connectionId: "search-response-contract",
        query: "个人公开比较采购方案",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 100,
          durationSeconds: 60
        }
      }
    ],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 2,
      maxResults: 20,
      maxAmountMinor: 200,
      maxDurationSeconds: 120
    },
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    }
  };
}

test("candidate intelligence public DTO conforms without internal operation state", () => {
  const operation = {
    id: "candidate-intelligence-response-1",
    candidateId: "candidate-response-1",
    status: "running",
    currentStage: "qualification",
    completedStages: ["research"],
    skippedStages: [],
    research: {
      summary: "已完成公开证据研究",
      findings: [{
        label: "公开需求",
        content: "客户正在公开调研解决方案",
        evidenceIds: ["evidence-response-1"],
        confidence: 0.9
      }]
    },
    qualification: null,
    battleCardId: null,
    failure: null,
    createdAt: NOW,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    failedAt: null
  };
  const path =
    "/api/v1/acquisition/candidate-intelligence-operations/{operationId}";

  assertResponseConforms(path, "get", 200, operation);
  const schema = (openApiPaths[path]!.get as Record<string, any>)
    .responses["200"].content["application/json"].schema;
  const validate = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false
  }).compile(schema);
  assert.equal(validate({ ...operation, ownerId: OWNER }), false);
  assert.equal(validate({ ...operation, leaseToken: "secret" }), false);
});

test("mounted plan and run responses conform to production OpenAPI", async () => {
  const executionPort: AcquisitionExecutionPort = {
    async enqueue() {},
    async requestPause() {},
    async resume() {},
    async requestCancel() {}
  };
  let sequence = 0;
  const service = new AcquisitionPlanRunService({
    repository: new InMemoryAcquisitionPlanRunRepository(),
    executionPort,
    idFactory: (prefix) => `${prefix}-response-${++sequence}`,
    now: () => NOW
  });
  const fixture = await mount(createAcquisitionPlanRouter({
    service,
    presentationService: {
      async get() {
        throw new Error("presentation is outside this response fixture");
      }
    },
    async resolveModelSnapshot() {
      return modelSnapshot();
    },
    requestIdFactory: () => "request-response-contract"
  }));
  try {
    const created = await fixture.request(
      "/api/v1/acquisition/plans",
      {
        method: "POST",
        headers: { "Idempotency-Key": "response-plan-create" },
        body: JSON.stringify(planBody())
      }
    );
    assert.equal(created.response.status, 201);
    assertResponseConforms(
      "/api/v1/acquisition/plans",
      "post",
      201,
      created.body
    );

    const approved = await fixture.request(
      `/api/v1/acquisition/plans/${created.body.id}/approval`,
      {
        method: "POST",
        headers: { "If-Match": created.body.etag },
        body: JSON.stringify({
          decision: "approve",
          reason: "人工确认公开数据源与预算"
        })
      }
    );
    assert.equal(
      approved.response.status,
      200,
      JSON.stringify(approved.body)
    );
    const run = await fixture.request(
      `/api/v1/acquisition/plans/${created.body.id}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "response-run-create" },
        body: JSON.stringify({ reason: "开始公开检索" })
      }
    );
    assert.equal(run.response.status, 202);
    assertResponseConforms(
      "/api/v1/acquisition/plans/{id}/runs",
      "post",
      202,
      run.body
    );
  } finally {
    await fixture.close();
  }
});

test("mounted provider connection and health responses conform to production OpenAPI", async () => {
  const store: AcquisitionProviderConnectionStore = {
    providerCatalog: createDefaultProviderCatalog(),
    providerConnections: [],
    async persist() {},
    async readBarrier() {}
  };
  let sequence = 0;
  const fixture = await mount(createAcquisitionProviderConnectionsRouter({
    store,
    credentialSecret:
      "response-contract-provider-secret-at-least-32-characters",
    idFactory: (prefix) => `${prefix}-response-${++sequence}`,
    requestIdFactory: (prefix) => `${prefix}-response-${++sequence}`,
    now: () => NOW,
    async connectionTester() {
      return {
        ok: true,
        message: "数据源连接测试通过",
        errorCode: null,
        retryable: false,
        retryAfterAt: null,
        usage: "response contract fixture"
      };
    }
  }));
  try {
    const created = await fixture.request(
      "/api/v1/acquisition/provider-connections",
      {
        method: "POST",
        headers: { "Idempotency-Key": "response-provider-create" },
        body: JSON.stringify({
          providerId: "serper",
          apiKey: "response-contract-private-key"
        })
      }
    );
    assert.equal(created.response.status, 201);
    assertResponseConforms(
      "/api/v1/acquisition/provider-connections",
      "post",
      201,
      created.body
    );

    const health = await fixture.request(
      `/api/v1/acquisition/provider-connections/${created.body.id}/test`,
      { method: "POST" }
    );
    assert.equal(health.response.status, 200);
    assertResponseConforms(
      "/api/v1/acquisition/provider-connections/{id}/test",
      "post",
      200,
      health.body
    );
  } finally {
    await fixture.close();
  }
});

function candidateFixtures() {
  const common = {
    ownerId: OWNER,
    teamId: TEAM,
    evidenceIds: ["evidence-response-contract"],
    status: "qualified" as const,
    latestDecisionVersion: "decision-version-response-contract",
    approvedDecisionVersion: null,
    hardGateFailures: [],
    leadId: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 2
  };
  const organization = {
    ...common,
    id: "candidate-organization",
    partyType: "organization" as const,
    partyRef: {
      partyType: "organization" as const,
      organizationId: "organization-response-contract",
      tenantProspectId: "tenant-prospect-response-contract"
    },
    profile: {
      kind: "organization" as const,
      name: "响应契约企业",
      domain: "response-contract.example",
      region: "福建厦门",
      creditCode: null
    },
    latestDecisionId: "decision-organization"
  };
  const individual = {
    ...common,
    id: "candidate-individual",
    partyType: "individual" as const,
    partyRef: {
      partyType: "individual" as const,
      individualPartyId: "individual-response-contract",
      demandSignalId: "signal-response-contract"
    },
    profile: {
      kind: "individual" as const,
      publicActorKey: "platform:response-contract",
      publicDisplayName: "公开需求用户",
      publicProfileUrl: "https://example.test/public/response-contract",
      sourcePlatform: "public_forum",
      demandCategory: "软件采购",
      demandSummary: "正在公开比较获客系统",
      locationHint: "厦门",
      buyingStage: "comparison" as const,
      negativeSignals: []
    },
    latestDecisionId: "decision-individual"
  };
  return {
    organization,
    individual,
    cardV1Candidate: {
      ...organization,
      id: "candidate-card-v1",
      latestDecisionId: "decision-card-v1"
    },
    cardV2Candidate: {
      ...organization,
      id: "candidate-card-v2",
      latestDecisionId: "decision-card-v2"
    }
  };
}

function battleCards() {
  const common = {
    ownerId: OWNER,
    teamId: TEAM,
    partyType: "organization" as const,
    version: "battle-card-response-contract",
    evidenceIds: ["evidence-response-contract"],
    confidence: 0.8,
    modelProvider: "qwen",
    model: "qwen-plus",
    promptVersion: "battle-card.v2",
    snapshotHash: "sha256:battle-card",
    createdAt: NOW
  };
  return {
    v1: {
      ...common,
      id: "battle-card-v1",
      candidateId: "candidate-card-v1",
      qualificationDecisionId: "decision-card-v1",
      schemaVersion: "battle-card.v1" as const,
      sections: [{
        label: "公开事实",
        kind: "fact" as const,
        content: "企业公开了采购需求",
        evidenceIds: ["evidence-response-contract"],
        confidence: 1
      }]
    },
    v2: {
      ...common,
      id: "battle-card-v2",
      candidateId: "candidate-card-v2",
      qualificationDecisionId: "decision-card-v2",
      schemaVersion: "battle-card.v2" as const,
      intelligence: {
        accountOverview: [],
        needAssessment: [],
        supplierHypotheses: [],
        buyingCommittee: [],
        procurementPreferences: [],
        connectionStrategies: [],
        roleSpecificOpeners: [],
        doNotActions: [],
        financialSummary: null
      }
    }
  };
}

test("mounted candidate, battle-card, message, and task responses conform to production OpenAPI", async () => {
  const candidates = candidateFixtures();
  const cards = battleCards();
  const domainService = {
    async getCandidate(_scope: unknown, id: string) {
      const candidate = Object.values(candidates).find((item) =>
        item.id === id);
      if (!candidate) throw new Error(`unknown candidate: ${id}`);
      return structuredClone(candidate);
    },
    async listBattleCards(_scope: unknown, candidateId: string) {
      return [cards.v1, cards.v2]
        .filter((card) => card.candidateId === candidateId)
        .map((card) => structuredClone(card));
    },
    async listOutcomes() {
      return [{
        id: "outcome-incomplete-live-history",
        ownerId: OWNER,
        teamId: TEAM,
        leadId: "lead-response-contract",
        customerId: null,
        eventType: "won",
        occurredAt: NOW,
        amount: { amountMinor: 120_000, currency: "CNY" },
        reasonCode: "historical-live",
        reasonText: "旧 live 记录缺少完整 run chain",
        idempotencyKey: "outcome-history-response-contract",
        createdBy: OWNER,
        createdAt: NOW,
        recordKind: "live",
        partyRef: candidates.organization.partyRef,
        candidateId: candidates.organization.id,
        attribution: {
          runId: "legacy-session-id",
          evidenceIds: ["evidence-response-contract"],
          providerIds: ["baidu_ai_search"],
          queryIds: ["query-legacy"],
          strategyVersion: "strategy.v0",
          qualificationDecisionId: "decision-organization",
          decisionVersion: "decision-version-response-contract",
          decisionSnapshotHash: "sha256:legacy-decision",
          decisionEngine: "rules",
          ruleVersion: "qualification-rules.v1",
          modelProvider: null,
          model: null,
          promptVersion: null
        },
        snapshotHash: "sha256:historical-live"
      }, {
        id: "outcome-partial-live-history",
        ownerId: OWNER,
        teamId: TEAM,
        leadId: "lead-response-contract",
        customerId: null,
        eventType: "quoted",
        occurredAt: NOW,
        amount: { amountMinor: 80_000, currency: "CNY" },
        reasonCode: "historical-partial-live",
        reasonText: "旧 live 记录有 run chain 但缺少 decisionEngine",
        idempotencyKey: "outcome-partial-response-contract",
        createdBy: OWNER,
        createdAt: NOW,
        recordKind: "live",
        partyRef: candidates.organization.partyRef,
        candidateId: candidates.organization.id,
        attribution: {
          attributionVersion: "acquisition-run.v1",
          runId: "run-partial-response-contract",
          planId: "plan-partial-response-contract",
          planVersionId: "plan-version-partial-response-contract",
          planVersion: 1,
          planSnapshotHash: "sha256:plan-partial-response-contract",
          discoveredEventId: "run-event-partial-response-contract",
          discoveredAt: NOW,
          shardId: "shard-partial-response-contract",
          operationId: "operation-partial-response-contract",
          connectionId: "connection-partial-response-contract",
          providerId: "baidu_ai_search",
          evidenceIds: ["evidence-response-contract"],
          providerIds: ["baidu_ai_search"],
          queryIds: ["operation:operation-partial-response-contract"],
          strategyVersion: "acquisition-plan-v1",
          qualificationDecisionId: "decision-organization",
          decisionVersion: "decision-version-response-contract",
          decisionSnapshotHash: "sha256:decision-response-contract",
          ruleVersion: "qualification-rules.v1",
          modelProvider: null,
          model: null,
          promptVersion: null
        },
        snapshotHash: "sha256:partial-live"
      }, {
        id: "outcome-full-live-v2",
        ownerId: OWNER,
        teamId: TEAM,
        leadId: "lead-response-contract",
        customerId: null,
        eventType: "contacted",
        occurredAt: NOW,
        amount: null,
        reasonCode: "full-live",
        reasonText: "完整持久化运行链",
        idempotencyKey: "outcome-full-response-contract",
        createdBy: OWNER,
        createdAt: NOW,
        recordKind: "live",
        partyRef: candidates.organization.partyRef,
        candidateId: candidates.organization.id,
        attribution: {
          attributionVersion: "acquisition-run.v1",
          runId: "run-response-contract",
          planId: "plan-response-contract",
          planVersionId: "plan-version-response-contract",
          planVersion: 1,
          planSnapshotHash: "sha256:plan-response-contract",
          discoveredEventId: "run-event-response-contract",
          discoveredAt: NOW,
          shardId: "shard-response-contract",
          operationId: "operation-response-contract",
          connectionId: "connection-response-contract",
          providerId: "baidu_ai_search",
          evidenceIds: ["evidence-response-contract"],
          providerIds: ["baidu_ai_search"],
          queryIds: ["operation:operation-response-contract"],
          strategyVersion: "acquisition-plan-v1",
          qualificationDecisionId: "decision-organization",
          decisionVersion: "decision-version-response-contract",
          decisionSnapshotHash: "sha256:decision-response-contract",
          decisionEngine: "rules",
          ruleVersion: "qualification-rules.v1",
          modelProvider: null,
          model: null,
          promptVersion: null
        },
        snapshotHash: "sha256:full-live"
      }];
    }
  };
  const assistantMessage = {
    id: "copilot-message-response-contract",
    ownerId: OWNER,
    teamId: TEAM,
    sessionId: "copilot-session-response-contract",
    sequence: 1,
    message: {
      role: "assistant",
      content: [{
        type: "toolCall",
        id: "tool-call-response-contract",
        name: "query_candidates",
        arguments: {
          candidateId: "candidate-organization",
          limit: 10
        }
      }],
      api: "goodjob-gateway",
      provider: "qwen",
      model: "qwen-plus",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 15,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0
        }
      },
      stopReason: "toolUse",
      timestamp: Date.parse(NOW)
    },
    createdAt: NOW
  };
  const task = {
    id: "copilot-task-response-contract",
    ownerId: OWNER,
    teamId: TEAM,
    actorId: OWNER,
    sessionId: "copilot-session-response-contract",
    kind: "message",
    status: "succeeded",
    prompt: "生成计划草稿",
    responseMode: "plan_draft",
    result: {
      summary: "计划草稿已生成",
      toolNames: ["query_candidates"]
    },
    errorCode: null,
    createdAt: NOW,
    startedAt: NOW,
    completedAt: NOW
  };
  const copilotService = {
    async listMessages() {
      return [structuredClone(assistantMessage)];
    },
    async getTask() {
      return structuredClone(task);
    }
  };
  const fixture = await mount(createAcquisitionV1Router({
    domainService: domainService as never,
    identityResolutionService: {} as never,
    copilotService: copilotService as never,
    queryPort: {} as never,
    cursorSecret:
      "response-contract-cursor-secret-at-least-32-characters",
    requestIdFactory: () => "request-response-contract"
  }));
  try {
    for (const id of ["candidate-organization", "candidate-individual"]) {
      const result = await fixture.request(
        `/api/v1/acquisition/candidates/${id}`
      );
      assert.equal(result.response.status, 200);
      assertResponseConforms(
        "/api/v1/acquisition/candidates/{id}",
        "get",
        200,
        result.body
      );
    }
    for (const id of ["candidate-card-v1", "candidate-card-v2"]) {
      const result = await fixture.request(
        `/api/v1/acquisition/candidates/${id}/battle-card`
      );
      assert.equal(result.response.status, 200);
      assertResponseConforms(
        "/api/v1/acquisition/candidates/{id}/battle-card",
        "get",
        200,
        result.body
      );
    }

    const outcomes = await fixture.request(
      "/api/v1/acquisition/outcomes?candidateId=candidate-organization"
    );
    assert.equal(outcomes.response.status, 200);
    assert.equal(outcomes.body.items[0]?.recordKind, "legacy_migrated");
    assert.match(outcomes.body.items[0]?.migrationWarnings?.[0] ?? "", /incomplete/i);
    assert.equal(outcomes.body.items[1]?.recordKind, "legacy_migrated");
    assert.equal(outcomes.body.items[2]?.recordKind, "live");
    assert.equal(
      outcomes.body.items[2]?.attribution?.attributionVersion,
      "acquisition-run.v1"
    );
    assertResponseConforms(
      "/api/v1/acquisition/outcomes",
      "get",
      200,
      outcomes.body
    );

    const messages = await fixture.request(
      "/api/v1/acquisition/copilot/sessions/copilot-session-response-contract/messages"
    );
    assert.equal(messages.response.status, 200);
    assertResponseConforms(
      "/api/v1/acquisition/copilot/sessions/{id}/messages",
      "get",
      200,
      messages.body
    );

    const taskResult = await fixture.request(
      "/api/v1/acquisition/copilot/tasks/copilot-task-response-contract"
    );
    assert.equal(taskResult.response.status, 200);
    assertResponseConforms(
      "/api/v1/acquisition/copilot/tasks/{id}",
      "get",
      200,
      taskResult.body
    );
  } finally {
    await fixture.close();
  }
});
