import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Server } from "node:http";
import express from "express";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AcquisitionCandidate,
  PartyRef
} from "./acquisition-domain.js";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  AcquisitionDomainService
} from "./acquisition-domain-service.js";
import {
  AcquisitionCopilotService,
  InMemoryAcquisitionCopilotRepository
} from "./acquisition-copilot-service.js";
import type {
  AcquisitionCopilotScope
} from "./acquisition-copilot-service.js";
import {
  createAcquisitionV1Router,
  type AcquisitionV1QueryPort,
  type AcquisitionV1RouterOptions
} from "./acquisition-v1-router.js";

const OWNER_A = "owner-a";
const TEAM_A = "team-a";

function deterministicIds() {
  let sequence = 0;
  return (prefix: string) => `${prefix}-${++sequence}`;
}

function deterministicClock() {
  let timestamp = Date.parse("2026-07-24T00:00:00.000Z");
  return () => new Date(timestamp++).toISOString();
}

async function createFixture(options: {
  injectedQueryCandidates?: AcquisitionCandidate[];
  dispatchCopilotTask?: (
    scope: AcquisitionCopilotScope,
    taskId: string
  ) => void | Promise<void>;
  resolveCopilotModelSnapshot?:
    AcquisitionV1RouterOptions["resolveCopilotModelSnapshot"];
} = {}) {
  const repository = new InMemoryAcquisitionDomainRepository();
  const candidates = new Map<string, AcquisitionCandidate>();
  const originalInsert = repository.insertCandidate.bind(repository);
  const originalSave = repository.saveCandidate.bind(repository);
  repository.insertCandidate = async (candidate) => {
    await originalInsert(candidate);
    candidates.set(candidate.id, structuredClone(candidate));
  };
  repository.saveCandidate = async (candidate) => {
    await originalSave(candidate);
    candidates.set(candidate.id, structuredClone(candidate));
  };

  const idFactory = deterministicIds();
  const now = deterministicClock();
  const domainService = new AcquisitionDomainService({
    repository,
    leadConversionPort: {
      async createLead(input) {
        return {
          leadId: `lead-${input.candidateId}`,
          partyRef: structuredClone(input.partyRef)
        };
      }
    },
    idFactory,
    now
  });
  const copilotService = new AcquisitionCopilotService({
    repository: new InMemoryAcquisitionCopilotRepository(),
    idempotencySecret:
      "router-test-idempotency-secret-at-least-32-characters",
    idFactory,
    now,
    runner: {
      async run(input) {
        const messages: AgentMessage[] = [
          {
            role: "user",
            content: input.prompt,
            timestamp: Date.parse("2026-07-24T01:00:00.000Z")
          },
          {
            role: "assistant",
            content: [{ type: "text", text: `分析完成：${input.prompt}` }],
            api: "goodjob-gateway",
            provider: input.snapshot.provider,
            model: input.snapshot.model,
            usage: {
              input: 8,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning: 0,
              totalTokens: 13,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0
              }
            },
            stopReason: "stop",
            timestamp: Date.parse("2026-07-24T01:00:01.000Z")
          }
        ];
        return {
          newMessages: messages,
          result: {
            summary: `分析完成：${input.prompt}`,
            toolNames: ["query_candidates"]
          }
        };
      }
    }
  });
  const queryPort: AcquisitionV1QueryPort = {
    async listCandidates(scope, query) {
      const items = [...candidates.values()]
        .filter((candidate) =>
          candidate.ownerId === scope.ownerId
          && candidate.teamId === scope.teamId
          && (!query.subjectKind
            || candidate.partyType === query.subjectKind)
          && (!query.status || candidate.status === query.status)
        )
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt)
          || right.id.localeCompare(left.id)
        );
      const snapshot = createHash("sha256")
        .update(JSON.stringify(items.map((candidate) => ({
          id: candidate.id,
          version: candidate.version,
          updatedAt: candidate.updatedAt
        }))))
        .digest("hex");
      const offset = query.cursor ? Number(query.cursor) : 0;
      const page = [
        ...items,
        ...(options.injectedQueryCandidates ?? [])
      ].slice(offset, offset + query.limit);
      const nextOffset = offset + page.length;
      return {
        items: page,
        nextCursor: nextOffset < items.length ? String(nextOffset) : null,
        snapshot
      };
    }
  };

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    const ownerId = req.header("x-test-owner");
    const teamId = req.header("x-test-team");
    if (ownerId && teamId) {
      (req as typeof req & { user?: Record<string, unknown> }).user = {
        id: ownerId,
        teamId,
        name: ownerId,
        email: `${ownerId}@example.test`,
        role: "sales",
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
    }
    next();
  });
  app.use(createAcquisitionV1Router({
    domainService,
    copilotService,
    queryPort,
    requestIdFactory: deterministicIds(),
    cursorSecret:
      "router-test-cursor-secret-that-is-at-least-32-characters",
    dispatchCopilotTask: options.dispatchCopilotTask,
    resolveCopilotModelSnapshot: options.resolveCopilotModelSnapshot
  }));

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(
    path: string,
    init: RequestInit = {},
    identity: { ownerId: string; teamId: string } | null = {
      ownerId: OWNER_A,
      teamId: TEAM_A
    }
  ) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (identity) {
      headers.set("x-test-owner", identity.ownerId);
      headers.set("x-test-team", identity.teamId);
    }
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers
    });
    const json = await response.json().catch(() => null);
    return { response, json };
  }

  return {
    domainService,
    copilotService,
    request,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function write(body: unknown, key?: string): RequestInit {
  return {
    method: "POST",
    headers: key ? { "Idempotency-Key": key } : {},
    body: JSON.stringify(body)
  };
}

function evidenceBody(
  targetType: "organization" | "individual_signal",
  suffix: string
) {
  return {
    targetType,
    sourcePlatform: "baidu_ai_search",
    sourceTitle: `公开需求 ${suffix}`,
    sourceSnippet: "公开页面表达了采购与方案比较需求",
    publishedAt: "2026-07-23T08:00:00.000Z",
    locale: "zh-CN",
    rawArtifactHash: `sha256:raw-${suffix}`,
    contentHash: `sha256:content-${suffix}`,
    provenance: {
      kind: "search_result",
      provider: "baidu_ai_search",
      queryText: `测试搜索 ${suffix}`,
      sourceUrl: `https://example.test/${suffix}`,
      resultRank: 1
    },
    accessStatus: "public_content"
  };
}

function qualificationBody(evidenceId: string) {
  return {
    qualification: {
      decisionEngine: "rules",
      ruleVersion: "qualification-rules-v1",
      promptVersion: null,
      modelProvider: null,
      model: null,
      dimensions: {
        demandStrength: 90,
        fit: 88,
        identityConfidence: 92,
        buyingStage: 86,
        budgetPotential: 75,
        decisionReachability: 80,
        freshness: 95,
        evidenceDiversity: 70,
        negativeSignalRisk: 5,
        contactRisk: 5
      },
      hardGates: {
        hasOriginalSource: true,
        identityResolved: true,
        notDoNotContact: true,
        noExplicitRejection: true,
        publicDataOnly: true,
        evidenceFresh: true,
        schemaValid: true
      },
      evidenceExcerpts: {
        [evidenceId]: "公开页面表达了采购与方案比较需求"
      },
      reasons: ["需求、主体与购买阶段均已核验"]
    },
    financial: {
      currency: "CNY",
      predictedDealAmountMinor: 3000000,
      grossMarginBps: 6000,
      closeProbabilityBps: 7000,
      acquisitionCostMinor: 5000,
      salesCostMinor: 10000,
      serviceCostMinor: 200000,
      benchmarkDealAmountMinor: 2500000,
      collectionDays: 15,
      creditRisk: 10,
      repeatPotential: 80,
      referralPotential: 70
    }
  };
}

test("v1 router rejects unauthenticated and invalid writes with structured errors", async () => {
  const fixture = await createFixture();
  try {
    const unauthenticated = await fixture.request(
      "/api/v1/acquisition/candidates",
      {},
      null
    );
    assert.equal(unauthenticated.response.status, 401);
    assert.deepEqual(Object.keys(unauthenticated.json).sort(), [
      "code",
      "details",
      "message",
      "requestId",
      "retryable"
    ]);
    assert.equal(unauthenticated.json.code, "unauthorized");

    const missingKey = await fixture.request(
      "/api/v1/acquisition/evidence",
      write(evidenceBody("organization", "missing-key"))
    );
    assert.equal(missingKey.response.status, 400);
    assert.equal(missingKey.json.code, "idempotency_key_required");

    const scopeInjection = await fixture.request(
      "/api/v1/acquisition/evidence",
      write({
        ...evidenceBody("organization", "scope-injection"),
        ownerId: "victim"
      }, "scope-injection")
    );
    assert.equal(scopeInjection.response.status, 400);
    assert.equal(scopeInjection.json.code, "invalid_request");
    assert.equal(scopeInjection.json.details.issues[0].code, "unrecognized_keys");
  } finally {
    await fixture.close();
  }
});

test("v1 candidate list defensively rejects query-port rows outside owner and team", async () => {
  const fixture = await createFixture({
    injectedQueryCandidates: [{
      id: "foreign-candidate",
      ownerId: "owner-b",
      teamId: TEAM_A,
      partyType: "organization",
      partyRef: {
        partyType: "organization",
        organizationId: "foreign-organization",
        tenantProspectId: "foreign-prospect"
      },
      profile: {
        kind: "organization",
        name: "不应泄露的候选",
        domain: null,
        region: null,
        creditCode: null
      },
      evidenceIds: ["foreign-evidence"],
      status: "normalized",
      latestDecisionId: null,
      latestDecisionVersion: null,
      approvedDecisionVersion: null,
      hardGateFailures: [],
      leadId: null,
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
      version: 1
    }]
  });
  try {
    const result = await fixture.request("/api/v1/acquisition/candidates");
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.json, { items: [], nextCursor: null });
  } finally {
    await fixture.close();
  }
});

test("v1 cursors reject tampering, cross-scope/filter reuse, and stale snapshots", async () => {
  const fixture = await createFixture();
  try {
    for (const suffix of ["cursor-a", "cursor-b"]) {
      const evidence = await fixture.request(
        "/api/v1/acquisition/evidence",
        write(evidenceBody("organization", suffix), `evidence-${suffix}`)
      );
      await fixture.request(
        "/api/v1/acquisition/candidates",
        write({
          subjectKind: "organization",
          name: `游标测试企业 ${suffix}`,
          domain: `${suffix}.example.cn`,
          region: "福建厦门",
          creditCode: null,
          organizationId: `organization-${suffix}`,
          tenantProspectId: `prospect-${suffix}`,
          evidenceIds: [evidence.json.id]
        }, `candidate-${suffix}`)
      );
    }

    const first = await fixture.request(
      "/api/v1/acquisition/candidates?subjectKind=organization&limit=1"
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.json.items.length, 1);
    assert.ok(first.json.nextCursor);
    const cursor = String(first.json.nextCursor);

    const tampered = `${cursor.slice(0, -1)}${
      cursor.endsWith("a") ? "b" : "a"
    }`;
    const tamperedResult = await fixture.request(
      `/api/v1/acquisition/candidates?subjectKind=organization&limit=1&cursor=${
        encodeURIComponent(tampered)
      }`
    );
    assert.equal(tamperedResult.response.status, 400);
    assert.equal(tamperedResult.json.code, "invalid_cursor");

    const crossFilter = await fixture.request(
      `/api/v1/acquisition/candidates?subjectKind=individual&limit=1&cursor=${
        encodeURIComponent(cursor)
      }`
    );
    assert.equal(crossFilter.response.status, 400);
    assert.equal(crossFilter.json.code, "invalid_cursor");

    const crossEndpoint = await fixture.request(
      `/api/v1/acquisition/audit-events?limit=1&cursor=${
        encodeURIComponent(cursor)
      }`
    );
    assert.equal(crossEndpoint.response.status, 400);
    assert.equal(crossEndpoint.json.code, "invalid_cursor");

    const crossScope = await fixture.request(
      `/api/v1/acquisition/candidates?subjectKind=organization&limit=1&cursor=${
        encodeURIComponent(cursor)
      }`,
      {},
      { ownerId: "owner-b", teamId: TEAM_A }
    );
    assert.equal(crossScope.response.status, 400);
    assert.equal(crossScope.json.code, "invalid_cursor");

    const newEvidence = await fixture.request(
      "/api/v1/acquisition/evidence",
      write(evidenceBody("organization", "cursor-c"), "evidence-cursor-c")
    );
    await fixture.request(
      "/api/v1/acquisition/candidates",
      write({
        subjectKind: "organization",
        name: "游标测试企业 cursor-c",
        domain: "cursor-c.example.cn",
        region: "福建厦门",
        creditCode: null,
        organizationId: "organization-cursor-c",
        tenantProspectId: "prospect-cursor-c",
        evidenceIds: [newEvidence.json.id]
      }, "candidate-cursor-c")
    );
    const stale = await fixture.request(
      `/api/v1/acquisition/candidates?subjectKind=organization&limit=1&cursor=${
        encodeURIComponent(cursor)
      }`
    );
    assert.equal(stale.response.status, 400);
    assert.equal(stale.json.code, "invalid_cursor");
  } finally {
    await fixture.close();
  }
});

test("v1 router exposes the full evidence-to-outcome workflow without automatic outreach", async () => {
  const fixture = await createFixture();
  try {
    const evidenceResult = await fixture.request(
      "/api/v1/acquisition/evidence",
      write(evidenceBody("organization", "org"), "evidence-org")
    );
    assert.equal(evidenceResult.response.status, 201);
    assert.deepEqual(Object.keys(evidenceResult.json).sort(), [
      "accessStatus",
      "contentHash",
      "fetchedAt",
      "id",
      "locale",
      "provenance",
      "publishedAt",
      "rawArtifactHash",
      "sourcePlatform",
      "sourceSnippet",
      "sourceTitle",
      "targetType"
    ]);
    const evidenceId = evidenceResult.json.id as string;

    const candidateResult = await fixture.request(
      "/api/v1/acquisition/candidates",
      write({
        subjectKind: "organization",
        name: "厦门示例科技有限公司",
        domain: "example.cn",
        region: "福建厦门",
        creditCode: null,
        organizationId: "organization-001",
        tenantProspectId: "prospect-001",
        evidenceIds: [evidenceId]
      }, "candidate-org")
    );
    assert.equal(candidateResult.response.status, 201);
    assert.deepEqual(Object.keys(candidateResult.json).sort(), [
      "createdAt",
      "creditCode",
      "domain",
      "evidenceIds",
      "id",
      "name",
      "region",
      "status"
    ]);
    const candidateId = candidateResult.json.id as string;

    const hidden = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}`,
      {},
      { ownerId: "owner-b", teamId: TEAM_A }
    );
    assert.equal(hidden.response.status, 404);
    assert.equal(hidden.json.code, "resource_not_found");

    const list = await fixture.request(
      "/api/v1/acquisition/candidates?subjectKind=organization&limit=10"
    );
    assert.equal(list.response.status, 200);
    assert.equal(list.json.items.length, 1);
    assert.deepEqual(list.json.items[0], candidateResult.json);
    assert.equal(list.json.nextCursor, null);

    const secondEvidence = await fixture.request(
      "/api/v1/acquisition/evidence",
      write(evidenceBody("organization", "org-2"), "evidence-org-2")
    );
    const attached = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/evidence`,
      write({ evidenceId: secondEvidence.json.id }, "attach-org-2")
    );
    assert.equal(attached.response.status, 200);
    assert.deepEqual(
      attached.json.evidenceIds,
      [evidenceId, secondEvidence.json.id]
    );
    const evidenceList = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/evidence?limit=10`
    );
    assert.equal(evidenceList.response.status, 200);
    assert.equal(evidenceList.json.items.length, 2);

    const qualified = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/qualification`,
      write(qualificationBody(evidenceId), "qualify-org")
    );
    assert.equal(qualified.response.status, 202);
    assert.equal(qualified.json.kind, "candidate_qualification");
    assert.equal(qualified.json.status, "succeeded");
    assert.ok(qualified.json.resourceId);

    const qualification = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/qualification`
    );
    assert.equal(qualification.response.status, 200);
    assert.deepEqual(Object.keys(qualification.json).sort(), [
      "confidence",
      "decisionEngine",
      "evidence",
      "grade",
      "model",
      "modelProvider",
      "negativeSignals",
      "positiveSignals",
      "promptVersion",
      "reasons",
      "recommendedAction",
      "ruleVersion",
      "score"
    ]);

    const cardResult = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/battle-card`,
      write({
        sections: [
          {
            label: "需求证据",
            kind: "fact",
            content: "客户公开表达了采购需求",
            evidenceIds: [evidenceId],
            confidence: 0.95
          },
          {
            label: "未知决策人",
            kind: "unknown",
            content: "尚无公开证据可以确认决策人",
            evidenceIds: [],
            confidence: null
          }
        ],
        confidence: 0.9,
        modelProvider: "qwen",
        model: "qwen-plus",
        promptVersion: "battle-card-v1"
      }, "battle-card-org")
    );
    assert.equal(cardResult.response.status, 202);
    assert.equal(cardResult.json.kind, "battle_card_generation");
    const card = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/battle-card`
    );
    assert.equal(card.response.status, 200);
    assert.equal(card.json.candidateId, candidateId);
    assert.equal("ownerId" in card.json, false);
    assert.equal("snapshotHash" in card.json, false);
    assert.equal("evidenceIds" in card.json.sections[1], false);

    const rawDecision = (
      await fixture.domainService.listQualificationDecisions(
        { ownerId: OWNER_A, teamId: TEAM_A, actorId: OWNER_A },
        candidateId
      )
    ).at(-1);
    assert.ok(rawDecision);
    const approved = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/review`,
      write({
        action: "approved",
        decisionVersion: rawDecision.decisionVersion,
        reason: null
      }, "review-approve")
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.json.review.action, "approved");

    const reviews = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/reviews`
    );
    assert.equal(reviews.response.status, 200);
    assert.equal(reviews.json.items.length, 1);
    assert.equal("ownerId" in reviews.json.items[0], false);

    const conversion = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/convert`,
      write({ decisionVersion: rawDecision.decisionVersion }, "convert-org")
    );
    assert.equal(conversion.response.status, 200);
    assert.equal(conversion.json.leadId, `lead-${candidateId}`);

    const outcomeResult = await fixture.request(
      "/api/v1/acquisition/outcomes",
      write({
        candidateId,
        leadId: conversion.json.leadId,
        customerId: null,
        eventType: "contacted",
        occurredAt: "2026-07-24T02:00:00.000Z",
        amount: null,
        reasonCode: null,
        reasonText: "人工审核后由销售完成联系",
        attribution: {
          runId: "run-001",
          evidenceIds: [evidenceId],
          providerIds: ["baidu_ai_search"],
          queryIds: ["query-001"],
          strategyVersion: "strategy-v1",
          qualificationDecisionId: rawDecision.id,
          decisionVersion: rawDecision.decisionVersion,
          decisionSnapshotHash: rawDecision.snapshotHash
        }
      }, "outcome-contacted")
    );
    assert.equal(outcomeResult.response.status, 201);
    assert.equal(outcomeResult.json.recordKind, "live");
    assert.equal("snapshotHash" in outcomeResult.json, false);

    const outcomes = await fixture.request(
      `/api/v1/acquisition/outcomes?candidateId=${candidateId}`
    );
    assert.equal(outcomes.response.status, 200);
    assert.equal(outcomes.json.items.length, 1);
    const audit = await fixture.request(
      `/api/v1/acquisition/audit-events?candidateId=${candidateId}`
    );
    assert.equal(audit.response.status, 200);
    assert.ok(audit.json.items.length >= 6);
    assert.ok(audit.json.items.every((item: { ownerId?: string }) =>
      item.ownerId === undefined
    ));

    const automaticOutreach = await fixture.request(
      `/api/v1/acquisition/candidates/${candidateId}/send`,
      write({}, "must-not-exist")
    );
    assert.equal(automaticOutreach.response.status, 404);
  } finally {
    await fixture.close();
  }
});

test("v1 router supports individual demand signals and research start", async () => {
  const fixture = await createFixture();
  try {
    const evidence = await fixture.request(
      "/api/v1/acquisition/evidence",
      write(evidenceBody("individual_signal", "individual"), "evidence-person")
    );
    const candidate = await fixture.request(
      "/api/v1/acquisition/candidates",
      write({
        subjectKind: "individual",
        publicActorKey: "platform:user-123",
        publicDisplayName: "公开用户",
        publicProfileUrl: "https://example.test/profiles/user-123",
        sourcePlatform: "public_forum",
        demandSignalId: "signal-123",
        demandCategory: "软件采购",
        demandSummary: "正在公开比较获客系统",
        locationHint: "厦门",
        buyingStage: "comparison",
        negativeSignals: [],
        individualPartyId: "individual-123",
        evidenceIds: [evidence.json.id]
      }, "candidate-person")
    );
    assert.equal(candidate.response.status, 201);
    assert.deepEqual(Object.keys(candidate.json).sort(), [
      "buyingStage",
      "demandCategory",
      "demandSummary",
      "evidenceIds",
      "firstSeenAt",
      "id",
      "lastSeenAt",
      "locationHint",
      "negativeSignals",
      "publicActorKey",
      "publicDisplayName",
      "publicProfileUrl",
      "sourcePlatform"
    ]);

    await fixture.request(
      `/api/v1/acquisition/candidates/${candidate.json.id}/qualification`,
      write(qualificationBody(evidence.json.id), "qualify-person")
    );
    const decisions = await fixture.domainService.listQualificationDecisions(
      { ownerId: OWNER_A, teamId: TEAM_A, actorId: OWNER_A },
      candidate.json.id
    );
    const decision = decisions.at(-1);
    assert.ok(decision);
    const review = await fixture.request(
      `/api/v1/acquisition/candidates/${candidate.json.id}/review`,
      write({
        action: "needs_research",
        decisionVersion: decision.decisionVersion,
        reason: "需要补充决策链公开证据"
      }, "review-research")
    );
    assert.equal(review.response.status, 200);
    assert.equal(review.json.research.status, "pending");

    const research = await fixture.request(
      `/api/v1/acquisition/candidates/${candidate.json.id}/research`,
      write({ researchId: review.json.research.id }, "research-start")
    );
    assert.equal(research.response.status, 202);
    assert.equal(research.json.kind, "candidate_research");
    assert.equal(research.json.status, "running");
    assert.equal(research.json.resourceId, review.json.research.id);
  } finally {
    await fixture.close();
  }
});

test("v1 copilot dispatch failures are terminal, observable, and never redispatched", async () => {
  let dispatchCalls = 0;
  const fixture = await createFixture({
    dispatchCopilotTask() {
      dispatchCalls += 1;
      if (dispatchCalls === 1) {
        throw new Error("SYNC_SECRET_MUST_NOT_LEAK");
      }
      return Promise.reject(new Error("ASYNC_SECRET_MUST_NOT_LEAK"));
    }
  });
  try {
    const sessionOperation = await fixture.request(
      "/api/v1/acquisition/copilot/sessions",
      write({
        modelSnapshot: {
          jobId: "job-dispatch-failure",
          connectionId: "connection-dispatch-failure",
          credentialVersion: 1,
          provider: "qwen",
          model: "qwen-plus",
          promptVersion: "acquisition-copilot-v1",
          schemaVersion: "copilot-turn.v1",
          promptHash: "sha256:prompt-dispatch-failure",
          schemaHash: "sha256:schema-dispatch-failure",
          capabilitySnapshotHash: "sha256:capability-dispatch",
          baseUrlFingerprint: "sha256:base-url-dispatch"
        }
      }, "copilot-session-dispatch-failure")
    );
    const sessionId = String(sessionOperation.json.resourceId);

    for (const [suffix, key] of [
      ["同步派发失败", "copilot-message-sync-failure"],
      ["异步派发失败", "copilot-message-async-failure"]
    ] as const) {
      const queued = await fixture.request(
        `/api/v1/acquisition/copilot/sessions/${sessionId}/messages`,
        write({ message: suffix }, key)
      );
      assert.equal(queued.response.status, 202);
      assert.equal(queued.json.status, "queued");
      assert.equal(queued.json.errorCode, null);

      let observed = queued;
      for (let index = 0;
        index < 20 && observed.json.status === "queued";
        index++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        observed = await fixture.request(
          `/api/v1/acquisition/copilot/tasks/${queued.json.id}`
        );
      }
      assert.equal(observed.response.status, 200);
      assert.equal(observed.json.status, "failed");
      assert.equal(observed.json.errorCode, "COPILOT_DISPATCH_FAILED");
      assert.equal(
        JSON.stringify(observed.json).includes("SECRET_MUST_NOT_LEAK"),
        false
      );

      const callsBeforeReplay = dispatchCalls;
      const replay = await fixture.request(
        `/api/v1/acquisition/copilot/sessions/${sessionId}/messages`,
        write({ message: suffix }, key)
      );
      assert.equal(replay.response.status, 202);
      assert.equal(replay.json.id, queued.json.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(
        dispatchCalls,
        callsBeforeReplay,
        "an idempotency replay must not dispatch a task twice"
      );

      const stored = await fixture.copilotService.getTask(
        { ownerId: OWNER_A, teamId: TEAM_A, actorId: OWNER_A },
        queued.json.id
      );
      assert.equal(stored.errorCode, "COPILOT_DISPATCH_FAILED");
    }
    assert.equal(dispatchCalls, 2);
  } finally {
    await fixture.close();
  }
});

test("v1 copilot sessions bind immutable model content on the server", async () => {
  const resolutions: Array<{
    ownerId: string;
    teamId: string;
    actorId: string;
    connectionId: string | null;
  }> = [];
  const fixture = await createFixture({
    async resolveCopilotModelSnapshot(scope, input) {
      resolutions.push({
        ...scope,
        connectionId: input.connectionId
      });
      return {
        jobId: "job-server-bound",
        connectionId: input.connectionId ?? "connection-active",
        credentialVersion: 7,
        provider: "qwen",
        model: "qwen-plus",
        promptVersion: "acquisition-copilot-v1",
        schemaVersion: "copilot-turn.v1",
        promptHash: "sha256:server-prompt-bundle",
        schemaHash: "sha256:server-schema-bundle",
        capabilitySnapshotHash: "sha256:server-capability",
        baseUrlFingerprint: "sha256:server-base-url"
      };
    }
  });
  try {
    const created = await fixture.request(
      "/api/v1/acquisition/copilot/sessions",
      write({ connectionId: "connection-selected" }, "server-bound-session")
    );
    assert.equal(created.response.status, 202);
    assert.deepEqual(resolutions, [{
      ownerId: OWNER_A,
      teamId: TEAM_A,
      actorId: OWNER_A,
      connectionId: "connection-selected"
    }]);

    const session = await fixture.request(
      `/api/v1/acquisition/copilot/sessions/${created.json.resourceId}`
    );
    assert.equal(session.response.status, 200);
    assert.equal(session.json.modelSnapshot.connectionId, "connection-selected");
    assert.equal(
      session.json.modelSnapshot.promptHash,
      "sha256:server-prompt-bundle"
    );

    const clientSnapshot = await fixture.request(
      "/api/v1/acquisition/copilot/sessions",
      write({
        modelSnapshot: {
          jobId: "job-client-controlled",
          connectionId: "connection-client-controlled",
          credentialVersion: 1,
          provider: "qwen",
          model: "qwen-plus",
          promptVersion: "client",
          schemaVersion: "client",
          promptHash: "sha256:client",
          schemaHash: "sha256:client",
          capabilitySnapshotHash: "sha256:client",
          baseUrlFingerprint: "sha256:client"
        }
      }, "client-controlled-session")
    );
    assert.equal(clientSnapshot.response.status, 400);
    assert.equal(
      resolutions.length,
      1,
      "client-controlled snapshots must be rejected before resolution"
    );
  } finally {
    await fixture.close();
  }
});

test("v1 copilot messages return 202 tasks and remain owner-and-team scoped", async () => {
  const fixture = await createFixture();
  try {
    const sessionOperation = await fixture.request(
      "/api/v1/acquisition/copilot/sessions",
      write({
        modelSnapshot: {
          jobId: "job-router",
          connectionId: "connection-router",
          credentialVersion: 3,
          provider: "qwen",
          model: "qwen-plus",
          promptVersion: "acquisition-copilot-v1",
          schemaVersion: "copilot-turn.v1",
          promptHash: "sha256:prompt-router",
          schemaHash: "sha256:schema-router",
          capabilitySnapshotHash: "sha256:capability",
          baseUrlFingerprint: "sha256:base-url"
        }
      }, "copilot-session")
    );
    assert.equal(sessionOperation.response.status, 202);
    assert.equal(sessionOperation.json.kind, "copilot_session_creation");
    assert.equal(sessionOperation.json.status, "succeeded");
    const session = await fixture.request(
      `/api/v1/acquisition/copilot/sessions/${sessionOperation.json.resourceId}`
    );
    assert.equal(session.response.status, 200);
    assert.deepEqual(Object.keys(session.json.modelSnapshot).sort(), [
      "connectionId",
      "credentialVersion",
      "model",
      "promptHash",
      "promptVersion",
      "provider",
      "schemaHash",
      "schemaVersion"
    ]);

    const queued = await fixture.request(
      `/api/v1/acquisition/copilot/sessions/${session.json.id}/messages`,
      write({ message: "分析今天值得人工跟进的客户" }, "copilot-message")
    );
    assert.equal(queued.response.status, 202);
    assert.equal(queued.json.kind, "message");
    assert.equal(queued.json.status, "queued");

    let task = queued;
    for (let index = 0; index < 20 && task.json.status === "queued"; index++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      task = await fixture.request(
        `/api/v1/acquisition/copilot/tasks/${queued.json.id}`
      );
    }
    assert.equal(task.response.status, 200);
    assert.equal(task.json.status, "succeeded");
    assert.equal(task.json.result.summary, "分析完成：分析今天值得人工跟进的客户");

    const messages = await fixture.request(
      `/api/v1/acquisition/copilot/sessions/${session.json.id}/messages`
    );
    assert.equal(messages.response.status, 200);
    assert.equal(messages.json.items.length, 2);
    assert.equal("ownerId" in messages.json.items[0], false);

    const hidden = await fixture.request(
      `/api/v1/acquisition/copilot/tasks/${queued.json.id}`,
      {},
      { ownerId: "owner-b", teamId: TEAM_A }
    );
    assert.equal(hidden.response.status, 404);
    assert.equal(hidden.json.code, "resource_not_found");
  } finally {
    await fixture.close();
  }
});
