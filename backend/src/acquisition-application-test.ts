import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import type mysql from "mysql2/promise";
import {
  ACQUISITION_FINAL_ANSWER_TOOL,
  ACQUISITION_PI_PROMPT_ID
} from "./acquisition-model-content.js";
import {
  acquisitionProviderConnectionVersion,
  createAcquisitionApplication,
  trackAcquisitionBackgroundTask
} from "./acquisition-application.js";
import type {
  AcquisitionContentFetcherPort,
  AcquisitionContentFetchOperationRecord
} from "./acquisition-discovery-operations.js";
import {
  InMemoryAcquisitionDiscoveryOperationRepository
} from "./acquisition-discovery-operations.js";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS
} from "./acquisition-discovery-providers.js";
import type {
  AcquisitionPlanPayload
} from "./acquisition-plan-run-repository.js";
import type {
  SearchPublicSourcesPort
} from "./acquisition-tool-executor.js";
import type {
  AcquisitionPiGatewayPort
} from "./acquisition-pi-gateway-runtime.js";
import {
  acquisitionPiModelSnapshotFromStored
} from "./acquisition-pi-runtime-factory.js";
import { memoryStore, type CrmStore } from "./store.js";
import type {
  AiModelConfig
} from "./types.js";

const OWNER = "owner-application";
const TEAM = "team-application";
const MASTER_SECRET =
  "acquisition-application-test-master-secret-at-least-32-characters";

function modelConfig(): AiModelConfig {
  return {
    id: "model-connection-application",
    provider: "zhipu",
    protocol: "openai-compatible",
    name: "GLM 测试连接",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    apiKey: "",
    enabled: true,
    temperature: 0.2,
    useLeadFinder: true,
    useWebsiteParse: true,
    useScoring: true,
    useEmailDraft: true,
    useExam: false,
    ownerId: OWNER,
    teamId: TEAM,
    credentialVersion: 1,
    capabilitySnapshot: {
      structuredOutput: true,
      toolCalling: true,
      parallelToolCalling: false,
      streaming: true,
      modelListing: true
    },
    capabilityCertificationHash: "sha256:test-certification",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z"
  };
}

function isolatedMemoryStore() {
  let persistCount = 0;
  let readBarrierCount = 0;
  const store: CrmStore = {
    ...memoryStore,
    mode: "memory",
    leads: [],
    leadActivities: [],
    leadSourceEvents: [],
    providerCatalog: [],
    providerConnections: [{
      id: "fake-search-connection",
      providerId: "fake-official-search",
      scope: "personal",
      credentialRef: "credential-ref-application",
      configurationEncrypted: "encrypted-test-configuration",
      status: "active",
      quotaPolicy: {},
      budgetPolicy: {},
      lastHealthAt: "2026-07-24T00:00:00.000Z",
      lastHealthStatus: "passed",
      lastErrorCode: "",
      lastHealthMessage: "ok",
      usage: "",
      ownerId: OWNER,
      teamId: TEAM,
      createdBy: OWNER,
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    }],
    providerRequestLogs: [],
    aiModelConfigs: [modelConfig()],
    modelCredentialVersions: [],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: [],
    modelCallRecords: [],
    pendingModelCallRecords: [],
    async persist() {
      persistCount += 1;
      store.pendingAiJobModelSnapshots.splice(0);
      store.pendingModelCallRecords.splice(0);
    },
    async readBarrier() {
      readBarrierCount += 1;
    },
    async close() {}
  };
  return {
    store,
    persistCount: () => persistCount,
    readBarrierCount: () => readBarrierCount
  };
}

function fakeSearchPort() {
  const calls: Array<{
    ownerId: string;
    teamId: string;
    providerConnectionId: string;
    query: string;
  }> = [];
  const port: SearchPublicSourcesPort = {
    async search(input) {
      calls.push({
        ownerId: input.ownerId,
        teamId: input.teamId,
        providerConnectionId: input.providerConnectionId,
        query: input.query
      });
      const individual = input.subjectKinds.length === 1
        && input.subjectKinds[0] === "individual";
      return {
        providerConnectionId: input.providerConnectionId,
        provider: "fake-official-search",
        requestId: "search-request-application",
        results: [{
          sourceUrl: individual
            ? "https://example.cn/public-profile/operator"
            : "https://example.cn/public-demand",
          title: individual ? "示例门店主理人" : "示例科技有限公司",
          snippet: individual
            ? "公开表达：门店获客成本高，正在了解 AI 解决方案。"
            : "公开发布：正在寻找 AI 获客与销售决策系统供应商。",
          publishedAt: "2026-07-23T12:00:00.000Z",
          locale: "zh-CN",
          rawArtifactHash: individual
            ? `sha256:${"b".repeat(64)}`
            : `sha256:${"a".repeat(64)}`,
          accessStatus: "public_content",
          subject: individual
            ? {
                kind: "individual" as const,
                publicActorKey:
                  "public:fake-official-search:operator-application",
                publicDisplayName: "示例门店主理人",
                publicProfileUrl:
                  "https://example.cn/public-profile/operator",
                sourcePlatform: "fake-official-search",
                demandCategory: "门店获客",
                demandSummary: "门店获客成本高，正在了解 AI 解决方案。",
                locationHint: "中国",
                buyingStage: "solution_research" as const,
                negativeSignals: [],
                individualPartyId: null
              }
            : {
                kind: "organization" as const,
                name: "示例科技有限公司",
                domain: "example.cn",
                region: "中国",
                creditCode: null,
                organizationId: null
              }
        }]
      };
    }
  };
  return { port, calls };
}

function fakeGateway() {
  let outcomeToolCalls = 0;
  const gateway: AcquisitionPiGatewayPort = {
    async callTools(request) {
      if (!("contentBinding" in request) || !request.contentBinding) {
        throw new Error("expected content-bound model request");
      }
      const binding = request.contentBinding;
      if (binding.promptId !== ACQUISITION_PI_PROMPT_ID) {
        throw new Error("unexpected judgment call in application test");
      }
      const dynamic = binding.dynamicData as {
        conversation?: Array<{ role?: string; content?: unknown }>;
      };
      const serialized = JSON.stringify(dynamic.conversation ?? []);
      const asksForUnsafeOutcome = serialized.includes("未经可信执行");
      const hasToolResult = serialized.includes("toolResult");
      if (asksForUnsafeOutcome && !hasToolResult) {
        outcomeToolCalls += 1;
        const candidateId =
          serialized.match(/candidate[-_][A-Za-z0-9_-]+/u)?.[0]
          ?? "missing-candidate";
        return {
          toolCalls: [{
            id: "record-outcome-without-receipt",
            name: "record_outcome",
            arguments: {
              candidateId,
              reviewTaskId: "missing-review-task",
              outcome: "contacted",
              occurredAt: "2026-07-24T01:00:00.000Z"
            }
          }],
          usage: {
            inputTokens: 20,
            outputTokens: 10,
            reasoningTokens: 0
          },
          providerRequestId: "fake-model-request-tool"
        };
      }
      return {
        toolCalls: [{
          id: "final-answer-application",
          name: ACQUISITION_FINAL_ANSWER_TOOL,
          arguments: {
            text: asksForUnsafeOutcome
              ? "没有可信执行凭证，系统未记录已触达结果。"
              : "已读取公开商机数据，并生成下一步人工审核建议。"
          }
        }],
        usage: {
          inputTokens: 30,
          outputTokens: 12,
          reasoningTokens: 0
        },
        providerRequestId: "fake-model-request-final"
      };
    }
  };
  return {
    gateway,
    outcomeToolCalls: () => outcomeToolCalls
  };
}

async function serve(
  handler: RequestHandler
) {
  const app = express();
  app.set("query parser", "simple");
  return {
    async request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      headers.set("x-test-owner", OWNER);
      headers.set("x-test-team", TEAM);
      const request = Object.create(express.request) as express.Request;
      request.app = app;
      request.method = init.method || "GET";
      request.url = path;
      request.originalUrl = path;
      request.baseUrl = "";
      Object.defineProperty(request, "query", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: Object.fromEntries(
          new URL(path, "http://application.test").searchParams
        )
      });
      request.headers = Object.fromEntries(
        [...headers.entries()].map(([key, value]) => [
          key.toLowerCase(),
          value
        ])
      );
      request.body = init.body
        ? JSON.parse(String(init.body))
        : undefined;
      request.user = {
        id: OWNER,
        teamId: TEAM,
        name: "测试用户",
        email: "application@example.test",
        role: "admin",
        avatar: "",
        authVersion: 1,
        outboundEmail: "",
        emailSenderName: "",
        emailSignature: "",
        smtpHost: "",
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: "",
        hasSmtpPassword: false,
        lastDevelopmentEmailAt: "",
        lastDevelopmentEmailTo: "",
        lastDevelopmentEmailSubject: ""
      };

      const responseHeaders = new Map<string, string>();
      const chunks: Buffer[] = [];
      const response = Object.create(express.response) as express.Response;
      response.app = app;
      response.req = request;
      request.res = response;
      response.locals = {};
      response.statusCode = 200;
      response.setHeader = ((name: string, value: string | number | readonly string[]) => {
        responseHeaders.set(
          name.toLowerCase(),
          Array.isArray(value) ? value.join(", ") : String(value)
        );
        return response;
      }) as express.Response["setHeader"];
      response.getHeader = ((name: string) =>
        responseHeaders.get(name.toLowerCase())) as express.Response["getHeader"];
      response.getHeaders = (() =>
        Object.fromEntries(responseHeaders)) as express.Response["getHeaders"];
      response.removeHeader = ((name: string) => {
        responseHeaders.delete(name.toLowerCase());
      }) as express.Response["removeHeader"];
      response.write = ((chunk: unknown) => {
        chunks.push(Buffer.from(String(chunk)));
        return true;
      }) as express.Response["write"];

      const completed = new Promise<void>((resolve, reject) => {
        response.end = ((chunk?: unknown) => {
          if (chunk !== undefined) chunks.push(Buffer.from(String(chunk)));
          resolve();
          return response;
        }) as express.Response["end"];
        try {
          handler(request, response, (error?: unknown) => {
            if (error) reject(error);
            else {
              response.statusCode = 404;
              resolve();
            }
          });
        } catch (error) {
          reject(error);
        }
      });
      await completed;
      const text = Buffer.concat(chunks).toString("utf8");
      const json = text ? JSON.parse(text) : null;
      return {
        response: {
          status: response.statusCode,
          headers: {
            get(name: string) {
              return responseHeaders.get(name.toLowerCase()) ?? null;
            }
          }
        },
        json
      };
    },
    async close() {}
  };
}

type PublicPlanPayload = Omit<
  AcquisitionPlanPayload,
  "modelSnapshotRef"
> & {
  modelConnectionId?: string | null;
};

function planPayload(
  modelConnectionId: string | null = modelConfig().id
): PublicPlanPayload {
  return {
    name: "全国公开商机搜索",
    objective: "搜索公开存在的组织需求",
    icp: {
      industries: ["企业服务"],
      regions: ["中国"],
      organizationCriteria: ["公开寻找供应商"],
      individualCriteria: ["公开表达经营需求"],
      exclusionRules: ["明确拒绝联系"]
    },
    subjectChannels: {
      organization: true,
      individual: true
    },
    providerConnections: [{
      connectionId: "fake-search-connection",
      providerId: "fake-official-search",
      kind: "search",
      status: "active",
      credentialVersion: Date.parse("2026-07-24T00:00:00.000Z")
    }],
    operations: [
      {
        operationId: "search-organizations",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "fake-search-connection",
        query: "正在寻找 AI 获客供应商",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 0,
          durationSeconds: 60
        }
      },
      {
        operationId: "search-individual-signals",
        subjectChannel: "individual",
        kind: "search",
        connectionId: "fake-search-connection",
        query: "门店主理人 获客难 AI 解决方案",
        allocatedBudget: {
          requests: 1,
          results: 10,
          amountMinor: 0,
          durationSeconds: 60
        }
      }
    ],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 2,
      maxResults: 20,
      maxAmountMinor: 0,
      maxDurationSeconds: 120
    },
    modelConnectionId,
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    }
  };
}

async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("application test timed out");
}

test("memory acquisition application composes search, plans, Pi and safe outcomes", async () => {
  const fixture = isolatedMemoryStore();
  const search = fakeSearchPort();
  const model = fakeGateway();
  let sequence = 0;
  let timestamp = Date.parse("2026-07-24T00:00:00.000Z");
  const runtime = await createAcquisitionApplication({
    store: fixture.store,
    masterSecret: MASTER_SECRET,
    searchPort: search.port,
    modelGatewayFactory: () => model.gateway,
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    now: () => new Date(timestamp++).toISOString(),
    nowMs: () => timestamp++
  });
  const server = await serve(runtime.handler);

  try {
    const forged = await server.request(
      "/api/v1/acquisition/copilot/sessions",
      {
        method: "POST",
        headers: { "Idempotency-Key": "forged-model-session" },
        body: JSON.stringify({
          connectionId: modelConfig().id,
          modelSnapshot: {
            provider: "openai",
            model: "attacker-selected"
          }
        })
      }
    );
    assert.equal(forged.response.status, 400);
    assert.equal(fixture.store.aiJobModelSnapshots.length, 0);

    const sessionResponse = await server.request(
      "/api/v1/acquisition/copilot/sessions",
      {
        method: "POST",
        headers: { "Idempotency-Key": "bound-model-session" },
        body: JSON.stringify({ connectionId: modelConfig().id })
      }
    );
    assert.equal(sessionResponse.response.status, 202);
    assert.equal(fixture.store.aiJobModelSnapshots.length, 1);
    assert.equal(fixture.persistCount(), 1);
    const sessionId = String(sessionResponse.json.resourceId);

    const retry = await server.request(
      "/api/v1/acquisition/copilot/sessions",
      {
        method: "POST",
        headers: { "Idempotency-Key": "bound-model-session" },
        body: JSON.stringify({ connectionId: modelConfig().id })
      }
    );
    assert.equal(retry.response.status, 202);
    assert.equal(retry.json.id, sessionId);
    assert.equal(fixture.store.aiJobModelSnapshots.length, 1);
    assert.equal(
      fixture.persistCount(),
      1,
      "idempotent session retries must not create or persist orphan snapshots"
    );

    const unrelatedStoredSnapshot = {
      ...structuredClone(fixture.store.aiJobModelSnapshots[0]!),
      jobId: "unrelated-model-job",
      promptVersion: "unrelated-prompt.v1",
      schemaVersion: "unrelated-schema.v1",
      promptHash: `sha256:${"c".repeat(64)}`,
      schemaHash: `sha256:${"d".repeat(64)}`
    };
    fixture.store.aiJobModelSnapshots.push(unrelatedStoredSnapshot);
    const unrelatedModelPlan = await server.request(
      "/api/v1/acquisition/plans",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "forged-plan-model-snapshot"
        },
        body: JSON.stringify({
          ...planPayload(),
          modelSnapshotRef:
            acquisitionPiModelSnapshotFromStored(unrelatedStoredSnapshot)
        })
      }
    );
    assert.equal(unrelatedModelPlan.response.status, 400);
    assert.equal(unrelatedModelPlan.json.error.code, "invalid_request");

    const staleProviderPayload = planPayload();
    staleProviderPayload.providerConnections[0]!.credentialVersion -= 1;
    const staleProviderPlan = await server.request(
      "/api/v1/acquisition/plans",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "stale-provider-plan"
        },
        body: JSON.stringify(staleProviderPayload)
      }
    );
    assert.equal(staleProviderPlan.response.status, 201);
    const staleProviderApproval = await server.request(
      `/api/v1/acquisition/plans/${staleProviderPlan.json.id}/approval`,
      {
        method: "POST",
        headers: {
          "If-Match": staleProviderPlan.response.headers.get("etag")!
        },
        body: JSON.stringify({
          decision: "approve",
          reason: "不应批准已漂移的数据源连接"
        })
      }
    );
    assert.equal(
      staleProviderApproval.response.status,
      503,
      JSON.stringify(staleProviderApproval.json)
    );
    assert.equal(
      staleProviderApproval.json.error.code,
      "plan_approval_validation_failed"
    );

    const createdPlan = await server.request(
      "/api/v1/acquisition/plans",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "trusted-public-search-plan"
        },
        body: JSON.stringify(planPayload())
      }
    );
    assert.equal(createdPlan.response.status, 201);
    const planId = String(createdPlan.json.id);
    const planEtag = createdPlan.response.headers.get("etag");
    assert.ok(planEtag);
    const snapshotsBeforePlanReplay =
      fixture.store.aiJobModelSnapshots.length;
    const activeModelConfig = fixture.store.aiModelConfigs[0]!;
    const originalCredentialVersion =
      activeModelConfig.credentialVersion;
    activeModelConfig.credentialVersion =
      (originalCredentialVersion ?? 1) + 1;
    const replayedPlan = await server.request(
      "/api/v1/acquisition/plans",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "trusted-public-search-plan"
        },
        body: JSON.stringify(planPayload())
      }
    );
    assert.equal(replayedPlan.response.status, 201);
    assert.equal(replayedPlan.json.id, planId);
    assert.equal(
      fixture.store.aiJobModelSnapshots.length,
      snapshotsBeforePlanReplay,
      "plan retries must reuse the server-bound model snapshot"
    );
    assert.equal(
      replayedPlan.json.payload.modelSnapshotRef.jobSnapshotId,
      createdPlan.json.payload.modelSnapshotRef.jobSnapshotId
    );
    const conflictingPlan = await server.request(
      "/api/v1/acquisition/plans",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "trusted-public-search-plan"
        },
        body: JSON.stringify(
          planPayload("another-model-connection")
        )
      }
    );
    assert.equal(conflictingPlan.response.status, 409);
    assert.equal(
      conflictingPlan.json.error.code,
      "idempotency_conflict"
    );
    assert.equal(
      fixture.store.aiJobModelSnapshots.length,
      snapshotsBeforePlanReplay,
      "idempotency conflicts must not persist orphan model snapshots"
    );
    activeModelConfig.credentialVersion = originalCredentialVersion;

    const approved = await server.request(
      `/api/v1/acquisition/plans/${planId}/approval`,
      {
        method: "POST",
        headers: { "If-Match": planEtag },
        body: JSON.stringify({
          decision: "approve",
          reason: "测试批准公开搜索"
        })
      }
    );
    assert.equal(approved.response.status, 200);

    fixture.store.providerConnections[0]!.status = "disabled";
    const driftedRun = await server.request(
      `/api/v1/acquisition/plans/${planId}/runs`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "run-drifted-public-search-application"
        },
        body: JSON.stringify({})
      }
    );
    assert.equal(driftedRun.response.status, 202);
    const terminalDriftedRun = await waitFor(
      () => server.request(
        `/api/v1/acquisition/runs/${driftedRun.json.id}`
      ),
      (value) => ["succeeded", "partial_success", "failed"].includes(
        String(value.json.status)
      )
    );
    assert.equal(
      terminalDriftedRun.json.status,
      "failed",
      "execution must revalidate a provider connection after approval"
    );
    assert.equal(
      search.calls.length,
      0,
      "drifted provider connections must fail before external search"
    );
    fixture.store.providerConnections[0]!.status = "active";

    const run = await server.request(
      `/api/v1/acquisition/plans/${planId}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "run-public-search-application" },
        body: JSON.stringify({})
      }
    );
    assert.equal(run.response.status, 202);
    const runId = String(run.json.id);

    const terminalRun = await waitFor(
      () => server.request(`/api/v1/acquisition/runs/${runId}`),
      (value) => ["succeeded", "partial_success", "failed"].includes(
        String(value.json.status)
      )
    );
    const shardResponse = await server.request(
      `/api/v1/acquisition/runs/${runId}/shards`
    );
    assert.equal(
      terminalRun.json.status,
      "succeeded",
      JSON.stringify(shardResponse.json)
    );
    assert.equal(search.calls.length, 2);
    assert.equal(
      fixture.readBarrierCount() >= 4,
      true,
      "session binding, plan approval, and shard execution must refresh state"
    );
    assert.deepEqual(
      new Set(search.calls.map((call) => call.query)),
      new Set([
        "正在寻找 AI 获客供应商",
        "门店主理人 获客难 AI 解决方案"
      ])
    );
    assert.equal(
      search.calls.every((call) =>
        call.ownerId === OWNER
        && call.teamId === TEAM
        && call.providerConnectionId === "fake-search-connection"
      ),
      true
    );

    const candidates = await server.request(
      "/api/v1/acquisition/candidates?limit=10"
    );
    assert.equal(
      candidates.response.status,
      200,
      JSON.stringify(candidates.json)
    );
    assert.equal(candidates.json.items.length, 2);
    const organizationCandidate = candidates.json.items.find(
      (candidate: { name?: string }) =>
        candidate.name === "示例科技有限公司"
    );
    assert.ok(organizationCandidate);
    const candidateId = String(organizationCandidate.id);

    const normalMessage = await server.request(
      `/api/v1/acquisition/copilot/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "copilot-normal-message" },
        body: JSON.stringify({ message: "给我今日公开商机建议" })
      }
    );
    assert.equal(normalMessage.response.status, 202);
    const normalTask = await waitFor(
      () => server.request(
        `/api/v1/acquisition/copilot/tasks/${normalMessage.json.id}`
      ),
      (value) => value.json.status !== "queued"
        && value.json.status !== "running"
    );
    assert.equal(
      normalTask.json.status,
      "succeeded",
      JSON.stringify(normalTask.json)
    );
    assert.match(normalTask.json.result.summary, /人工审核建议/u);

    const unsafeMessage = await server.request(
      `/api/v1/acquisition/copilot/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "copilot-unsafe-outcome" },
        body: JSON.stringify({
          message:
            `为 ${candidateId} 记录一个未经可信执行凭证的已触达结果`
        })
      }
    );
    assert.equal(unsafeMessage.response.status, 202);
    const unsafeTask = await waitFor(
      () => server.request(
        `/api/v1/acquisition/copilot/tasks/${unsafeMessage.json.id}`
      ),
      (value) => value.json.status !== "queued"
        && value.json.status !== "running"
    );
    assert.equal(
      unsafeTask.json.status,
      "succeeded",
      JSON.stringify(unsafeTask.json)
    );
    assert.equal(model.outcomeToolCalls(), 1);
    assert.match(unsafeTask.json.result.summary, /未记录已触达结果/u);

    const outcomes = await server.request(
      `/api/v1/acquisition/outcomes?candidateId=${encodeURIComponent(candidateId)}`
    );
    assert.equal(outcomes.response.status, 200);
    assert.deepEqual(outcomes.json.items, []);
  } finally {
    await server.close();
    await runtime.close();
    await runtime.close();
  }
});

test("application approves and executes a controlled content fetch shard", async () => {
  const fixture = isolatedMemoryStore();
  const search = fakeSearchPort();
  const model = fakeGateway();
  const fetchCalls: string[] = [];
  const contentFetcher: AcquisitionContentFetcherPort = {
    async fetch(sourceUrl) {
      fetchCalls.push(sourceUrl);
      return {
        finalUrl: sourceUrl,
        status: "succeeded",
        accessStatus: "public_content",
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        title: "公开采购需求",
        text: "示例企业正在公开寻找 AI 获客与经营决策系统供应商。",
        rawArtifactHash: `sha256:${"e".repeat(64)}`,
        contentHash: `sha256:${"f".repeat(64)}`
      };
    }
  };
  let sequence = 0;
  let timestamp = Date.parse("2026-07-24T02:00:00.000Z");
  const runtime = await createAcquisitionApplication({
    store: fixture.store,
    masterSecret: MASTER_SECRET,
    searchPort: search.port,
    contentFetcher,
    modelGatewayFactory: () => model.gateway,
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    now: () => new Date(timestamp++).toISOString(),
    nowMs: () => timestamp++
  });
  const server = await serve(runtime.handler);

  try {
    const session = await server.request(
      "/api/v1/acquisition/copilot/sessions",
      {
        method: "POST",
        headers: { "Idempotency-Key": "content-fetch-model-session" },
        body: JSON.stringify({ connectionId: modelConfig().id })
      }
    );
    assert.equal(session.response.status, 202);
    const payload = planPayload();
    payload.providerConnections.push(
      ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS.contentFetch
    );
    payload.operations.push({
      operationId: "fetch-public-demand-page",
      subjectChannel: "organization",
      kind: "content_fetch",
      connectionId:
        ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS.contentFetch.connectionId,
      sourceRef: "https://example.cn/public-procurement",
      allocatedBudget: {
        requests: 1,
        results: 1,
        amountMinor: 0,
        durationSeconds: 30
      }
    });
    payload.budgetSnapshot.maxRequests = 3;
    payload.budgetSnapshot.maxResults = 21;
    payload.budgetSnapshot.maxDurationSeconds = 150;

    const created = await server.request(
      "/api/v1/acquisition/plans",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "controlled-content-fetch-plan"
        },
        body: JSON.stringify(payload)
      }
    );
    assert.equal(created.response.status, 201);
    const approved = await server.request(
      `/api/v1/acquisition/plans/${created.json.id}/approval`,
      {
        method: "POST",
        headers: {
          "If-Match": created.response.headers.get("etag")!
        },
        body: JSON.stringify({
          decision: "approve",
          reason: "批准受控公开网页抓取"
        })
      }
    );
    assert.equal(
      approved.response.status,
      200,
      JSON.stringify(approved.json)
    );

    const run = await server.request(
      `/api/v1/acquisition/plans/${created.json.id}/runs`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "run-controlled-content-fetch"
        },
        body: JSON.stringify({})
      }
    );
    assert.equal(run.response.status, 202);
    const terminal = await waitFor(
      () => server.request(
        `/api/v1/acquisition/runs/${run.json.id}`
      ),
      (value) => ["succeeded", "partial_success", "failed"].includes(
        String(value.json.status)
      )
    );
    assert.equal(terminal.json.status, "succeeded");
    assert.deepEqual(fetchCalls, [
      "https://example.cn/public-procurement"
    ]);

    const shards = await server.request(
      `/api/v1/acquisition/runs/${run.json.id}/shards`
    );
    const contentShard = shards.json.items.find(
      (item: { kind?: string }) => item.kind === "content_fetch"
    );
    assert.equal(contentShard.status, "succeeded");
    assert.equal(contentShard.evidenceCount, 1);
  } finally {
    await server.close();
    await runtime.close();
  }
});

test("application exposes acquisition providers and executes direct discovery operations", async () => {
  const fixture = isolatedMemoryStore();
  const fetchedUrls: string[] = [];
  let sequence = 0;
  let timestamp = Date.parse("2026-07-24T02:30:00.000Z");
  const runtime = await createAcquisitionApplication({
    store: fixture.store,
    masterSecret: MASTER_SECRET,
    searchPort: fakeSearchPort().port,
    contentFetcher: {
      async fetch(sourceUrl) {
        fetchedUrls.push(sourceUrl);
        return {
          finalUrl: sourceUrl,
          status: "succeeded",
          accessStatus: "public_content",
          httpStatus: 200,
          contentType: "text/html; charset=utf-8",
          title: "公开需求页面",
          text: "某企业公开寻找 AI 获客增长与经营决策系统。",
          rawArtifactHash: `sha256:${"1".repeat(64)}`,
          contentHash: `sha256:${"2".repeat(64)}`
        };
      }
    },
    modelGatewayFactory: () => fakeGateway().gateway,
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    now: () => new Date(timestamp++).toISOString(),
    nowMs: () => timestamp++
  });
  const server = await serve(runtime.handler);

  try {
    const providers = await server.request(
      "/api/v1/acquisition/providers"
    );
    assert.equal(providers.response.status, 200);
    assert.ok(
      providers.json.items.some(
        (item: { id?: string }) => item.id === "baidu_ai_search"
      )
    );
    assert.ok(
      providers.json.items.some(
        (item: { id?: string }) => item.id === "controlled_public_content"
      )
    );

    const created = await server.request(
      "/api/v1/acquisition/content-fetch-operations",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "application-direct-content-fetch"
        },
        body: JSON.stringify({
          sourceUrl: "https://example.cn/public-demand/direct",
          subjectChannel: "organization"
        })
      }
    );
    assert.equal(
      created.response.status,
      202,
      JSON.stringify(created.json)
    );
    assert.equal(created.json.status, "queued");

    const completed = await waitFor(
      () => server.request(
        `/api/v1/acquisition/content-fetch-operations/${created.json.id}`
      ),
      (value) => value.json.status === "succeeded"
    );
    assert.equal(completed.json.evidenceCount, 1);
    assert.deepEqual(fetchedUrls, [
      "https://example.cn/public-demand/direct"
    ]);
  } finally {
    await server.close();
    await runtime.close();
  }
});

test("application startup recovers queued discovery operations", async () => {
  const fixture = isolatedMemoryStore();
  const discoveryRepository =
    new InMemoryAcquisitionDiscoveryOperationRepository();
  const queued: AcquisitionContentFetchOperationRecord = {
    id: "fetch-startup-recovery",
    ownerId: OWNER,
    teamId: TEAM,
    actorId: OWNER,
    sourceUrl: "https://example.cn/startup-recovery",
    finalUrl: null,
    subjectChannel: "organization",
    status: "queued",
    accessStatus: null,
    httpStatus: null,
    contentType: null,
    title: null,
    rawArtifactHash: null,
    contentHash: null,
    evidenceCount: 0,
    errorCode: null,
    idempotencyKeyHash: "f".repeat(64),
    requestHash: `sha256:${"e".repeat(64)}`,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    createdAt: "2026-07-24T02:00:00.000Z",
    startedAt: null,
    completedAt: null
  };
  await discoveryRepository.createContentFetchOperation(queued);
  const runtime = await createAcquisitionApplication({
    store: fixture.store,
    masterSecret: MASTER_SECRET,
    discoveryRepository,
    searchPort: fakeSearchPort().port,
    contentFetcher: {
      async fetch(sourceUrl) {
        return {
          finalUrl: sourceUrl,
          status: "succeeded",
          accessStatus: "public_content",
          httpStatus: 200,
          contentType: "text/html",
          title: "恢复后的公开商机",
          text: "应用启动后恢复了此前排队的公开商机抓取。",
          rawArtifactHash: `sha256:${"3".repeat(64)}`,
          contentHash: `sha256:${"4".repeat(64)}`
        };
      }
    },
    modelGatewayFactory: () => fakeGateway().gateway,
    now: () => "2026-07-24T03:00:00.000Z",
    nowMs: () => Date.parse("2026-07-24T03:00:00.000Z")
  });

  try {
    const completed = await waitFor(
      () => discoveryRepository.getContentFetchOperation(
        { ownerId: OWNER, teamId: TEAM },
        queued.id
      ),
      (value) => value?.status === "succeeded"
    );
    assert.equal(completed?.evidenceCount, 1);
    assert.equal(completed?.leaseToken, null);
  } finally {
    await runtime.close();
  }
});

test("application startup reconciles a durable pending CRM conversion", async () => {
  const fixture = isolatedMemoryStore();
  const repository = new InMemoryAcquisitionDomainRepository();
  const now = "2026-07-24T08:00:00.000Z";
  await repository.appendEvidence({
    id: "evidence-conversion-recovery",
    ownerId: OWNER,
    teamId: TEAM,
    targetType: "organization",
    sourcePlatform: "baidu_ai_search",
    sourceTitle: "公开采购需求",
    sourceSnippet: "正在寻找企业服务系统",
    publishedAt: "2026-07-23T00:00:00.000Z",
    locale: "zh-CN",
    rawArtifactHash: `sha256:${"a".repeat(64)}`,
    contentHash: `sha256:${"b".repeat(64)}`,
    provenance: {
      kind: "search_result",
      provider: "baidu_ai_search",
      queryText: "企业服务 采购",
      sourceUrl: "https://conversion.example.cn/procurement",
      resultRank: 1
    },
    accessStatus: "indexed_summary",
    supersedesEvidenceId: null,
    fetchedAt: now
  });
  await repository.insertCandidate({
    id: "candidate-conversion-recovery",
    ownerId: OWNER,
    teamId: TEAM,
    partyType: "organization",
    partyRef: {
      partyType: "organization",
      organizationId: "org-conversion-recovery",
      tenantProspectId: "prospect-conversion-recovery"
    },
    profile: {
      kind: "organization",
      name: "转换恢复示例公司",
      domain: "conversion.example.cn",
      region: "厦门",
      creditCode: null
    },
    evidenceIds: ["evidence-conversion-recovery"],
    status: "approved",
    latestDecisionId: "qualification-conversion-recovery",
    latestDecisionVersion: "decision-v1",
    approvedDecisionVersion: "decision-v1",
    hardGateFailures: [],
    leadId: null,
    createdAt: now,
    updatedAt: now,
    version: 1
  });
  await repository.appendConversionIntent({
    id: "conversion-intent-recovery",
    ownerId: OWNER,
    teamId: TEAM,
    candidateId: "candidate-conversion-recovery",
    decisionVersion: "decision-v1",
    partyRef: {
      partyType: "organization",
      organizationId: "org-conversion-recovery",
      tenantProspectId: "prospect-conversion-recovery"
    },
    reviewerId: OWNER,
    idempotencyKey: "conversion-recovery",
    evidenceIds: ["evidence-conversion-recovery"],
    evidenceSnapshotHash: `sha256:${"c".repeat(64)}`,
    status: "pending_crm",
    leadId: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  });

  const runtime = await createAcquisitionApplication({
    store: fixture.store,
    masterSecret: MASTER_SECRET,
    domainRepository: repository,
    conversionRecoveryIntervalMs: 60_000,
    now: () => now,
    nowMs: () => Date.parse(now)
  });

  try {
    assert.equal(fixture.store.leads.length, 1);
    assert.equal(fixture.store.leadSourceEvents.length, 1);
    assert.equal(fixture.store.leadActivities.length, 1);
    assert.equal(
      (await repository.findCandidate(
        { ownerId: OWNER, teamId: TEAM },
        "candidate-conversion-recovery"
      ))?.status,
      "converted_to_lead"
    );
    assert.equal(
      (await repository.findConversionIntent(
        { ownerId: OWNER, teamId: TEAM },
        "candidate-conversion-recovery"
      ))?.status,
      "completed"
    );
  } finally {
    await runtime.close();
  }
});

test("application shutdown is bounded when a model call never returns", async () => {
  const fixture = isolatedMemoryStore();
  let enteredGateway!: () => void;
  const gatewayEntered = new Promise<void>((resolve) => {
    enteredGateway = resolve;
  });
  const runtime = await createAcquisitionApplication({
    store: fixture.store,
    masterSecret: MASTER_SECRET,
    searchPort: fakeSearchPort().port,
    modelGatewayFactory: () => ({
      async callTools() {
        enteredGateway();
        return new Promise(() => undefined);
      }
    }),
    shutdownTimeoutMs: 20
  });
  const server = await serve(runtime.handler);
  const session = await server.request(
    "/api/v1/acquisition/copilot/sessions",
    {
      method: "POST",
      headers: { "Idempotency-Key": "bounded-shutdown-session" },
      body: JSON.stringify({ connectionId: modelConfig().id })
    }
  );
  assert.equal(session.response.status, 202);
  const message = await server.request(
    `/api/v1/acquisition/copilot/sessions/${session.json.resourceId}/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": "bounded-shutdown-message" },
      body: JSON.stringify({ message: "保持调用直到关闭测试" })
    }
  );
  assert.equal(message.response.status, 202);
  await gatewayEntered;
  await assert.rejects(
    runtime.close(),
    /ACQUISITION_APPLICATION_SHUTDOWN_TIMEOUT/u
  );
  await server.close();
});

test("mysql acquisition application fails closed without a database URL", async () => {
  const fixture = isolatedMemoryStore();
  fixture.store.mode = "mysql";
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousMysqlUrl = process.env.MYSQL_URL;
  delete process.env.DATABASE_URL;
  delete process.env.MYSQL_URL;
  try {
    await assert.rejects(
      createAcquisitionApplication({
        store: fixture.store,
        masterSecret: MASTER_SECRET,
        databaseUrl: ""
      }),
      /DATABASE_URL|MYSQL_URL/u
    );
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousMysqlUrl === undefined) {
      delete process.env.MYSQL_URL;
    } else {
      process.env.MYSQL_URL = previousMysqlUrl;
    }
  }
});

test("mysql acquisition application owns schema setup and pool lifecycle", async () => {
  const fixture = isolatedMemoryStore();
  fixture.store.mode = "mysql";
  const statements: string[] = [];
  const databaseUrls: string[] = [];
  let closeCount = 0;
  const pool = {
    async query(statement: unknown) {
      statements.push(String(statement));
      return [[], []];
    },
    async end() {
      closeCount += 1;
    }
  } as unknown as mysql.Pool;

  const runtime = await createAcquisitionApplication({
    store: fixture.store,
    masterSecret: MASTER_SECRET,
    databaseUrl: "mysql://application-test",
    mysqlPoolFactory(databaseUrl) {
      databaseUrls.push(databaseUrl);
      return pool;
    }
  });

  assert.deepEqual(databaseUrls, ["mysql://application-test"]);
  assert.equal(
    statements.some((statement) =>
      statement.includes("acquisition_candidates")
    ),
    true
  );
  assert.equal(
    statements.some((statement) =>
      statement.includes("acquisition_tool_audit")
    ),
    true
  );
  await runtime.close();
  await runtime.close();
  assert.equal(closeCount, 1, "the owned pool must close exactly once");
});

test("background task cleanup handles fulfillment and rejection", async () => {
  const tasks = new Set<Promise<void>>();
  const failure = Promise.reject(new Error("expected-background-failure"));
  const trackedFailure = trackAcquisitionBackgroundTask(tasks, failure);
  assert.equal(trackedFailure, failure);
  await assert.rejects(trackedFailure, /expected-background-failure/u);
  await Promise.resolve();
  assert.equal(tasks.size, 0);

  const success = Promise.resolve();
  await trackAcquisitionBackgroundTask(tasks, success);
  await Promise.resolve();
  assert.equal(tasks.size, 0);
});

test("provider versions prefer an explicit credential version", () => {
  assert.equal(
    acquisitionProviderConnectionVersion({
      credentialVersion: 7,
      updatedAt: "2026-07-24T00:00:00.000Z"
    }),
    7
  );
  assert.equal(
    acquisitionProviderConnectionVersion({
      updatedAt: "2026-07-24T00:00:00.000Z"
    }),
    Date.parse("2026-07-24T00:00:00.000Z")
  );
});

test("acquisition application rejects weak master secrets", async () => {
  const fixture = isolatedMemoryStore();
  await assert.rejects(
    createAcquisitionApplication({
      store: fixture.store,
      masterSecret: "too-short"
    }),
    /masterSecret/u
  );
  await assert.rejects(
    createAcquisitionApplication({
      store: fixture.store,
      masterSecret: " ".repeat(64)
    }),
    /masterSecret/u
  );
});
