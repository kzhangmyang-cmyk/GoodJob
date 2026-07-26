import assert from "node:assert/strict";
import test from "node:test";
import {
  AcquisitionDomainError,
  AcquisitionDomainService,
  type AcquisitionActorScope,
  type LeadConversionPort
} from "./acquisition-domain-service.js";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import type {
  BattleCardSection,
  DiscoveryEvidenceInput,
  FinancialValueInput,
  QualificationInput
} from "./acquisition-domain.js";

const ownerScope: AcquisitionActorScope = {
  ownerId: "owner-1",
  teamId: "team-1",
  actorId: "reviewer-1"
};
const intruderScope: AcquisitionActorScope = {
  ownerId: "owner-2",
  teamId: "team-1",
  actorId: "reviewer-2"
};

function createHarness() {
  let id = 0;
  let tick = 0;
  const converted: Array<{
    candidateId: string;
    partyType: "organization" | "individual";
  }> = [];
  const leadPort: LeadConversionPort = {
    createLead: async (request) => {
      converted.push({
        candidateId: request.candidateId,
        partyType: request.partyRef.partyType
      });
      return {
        leadId: `lead-${converted.length}`,
        partyRef: request.partyRef
      };
    }
  };
  const repository = new InMemoryAcquisitionDomainRepository();
  const service = new AcquisitionDomainService({
    repository,
    leadConversionPort: leadPort,
    idFactory: (prefix) => `${prefix}-${++id}`,
    now: () => new Date(Date.UTC(2026, 6, 24, 1, 0, tick++)).toISOString()
  });
  return { repository, service, converted };
}

function searchEvidence(
  targetType: "organization" | "individual_signal",
  suffix: string
): DiscoveryEvidenceInput {
  return {
    targetType,
    sourcePlatform: targetType === "organization" ? "baidu" : "xiaohongshu",
    sourceTitle: `公开需求 ${suffix}`,
    sourceSnippet: `可核验的公开需求证据 ${suffix}`,
    publishedAt: "2026-07-23T02:00:00.000Z",
    locale: "zh-CN",
    rawArtifactHash: `sha256:raw-${suffix}`,
    contentHash: `sha256:content-${suffix}`,
    provenance: {
      kind: "search_result",
      provider: "baidu_ai_search",
      queryText: "厦门 获客 系统 采购",
      sourceUrl: `https://example.cn/${suffix}`,
      resultRank: 1
    },
    accessStatus: "indexed_summary"
  };
}

function strongQualification(): QualificationInput {
  return {
    decisionEngine: "rules",
    ruleVersion: "qualification-rules.v1",
    promptVersion: null,
    modelProvider: null,
    model: null,
    dimensions: {
      demandStrength: 95,
      fit: 90,
      identityConfidence: 95,
      buyingStage: 90,
      budgetPotential: 80,
      decisionReachability: 75,
      freshness: 95,
      evidenceDiversity: 80,
      negativeSignalRisk: 0,
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
    evidenceExcerpts: {},
    reasons: ["需求明确，主体可靠，存在采购准备信号"]
  };
}

function healthyFinancialValue(): FinancialValueInput {
  return {
    currency: "CNY",
    predictedDealAmountMinor: 5_000_000,
    grossMarginBps: 6_000,
    closeProbabilityBps: 8_000,
    acquisitionCostMinor: 100_000,
    salesCostMinor: 100_000,
    serviceCostMinor: 300_000,
    benchmarkDealAmountMinor: 5_000_000,
    collectionDays: 15,
    creditRisk: 10,
    repeatPotential: 90,
    referralPotential: 80
  };
}

async function createOrganizationCandidate(
  service: AcquisitionDomainService,
  suffix = "org"
) {
  const evidence = await service.appendEvidence(
    ownerScope,
    searchEvidence("organization", suffix),
    `evidence:${suffix}`
  );
  const candidate = await service.createOrganizationCandidate(
    ownerScope,
    {
      name: "厦门增长科技有限公司",
      domain: "growth.example.cn",
      region: "福建厦门",
      creditCode: "91350200TEST000001",
      organizationId: "org-1",
      tenantProspectId: "prospect-1",
      evidenceIds: [evidence.id]
    },
    `candidate:${suffix}`
  );
  return { candidate, evidence };
}

async function createIndividualCandidate(
  service: AcquisitionDomainService,
  suffix = "person"
) {
  const evidence = await service.appendEvidence(
    ownerScope,
    searchEvidence("individual_signal", suffix),
    `evidence:${suffix}`
  );
  const candidate = await service.createIndividualCandidate(
    ownerScope,
    {
      publicActorKey: "xiaohongshu:user-100",
      publicDisplayName: "厦门门店主理人",
      publicProfileUrl: "https://example.cn/profiles/user-100",
      sourcePlatform: "xiaohongshu",
      demandSignalId: "signal-100",
      demandCategory: "门店获客",
      demandSummary: "正在比较获客系统并要求近期上线",
      locationHint: "厦门",
      buyingStage: "comparison",
      negativeSignals: [],
      individualPartyId: "person-100",
      evidenceIds: [evidence.id]
    },
    `candidate:${suffix}`
  );
  return { candidate, evidence };
}

test("organization and individual candidates keep separate party identities and immutable evidence", async () => {
  const { service } = createHarness();
  const organization = await createOrganizationCandidate(service);
  const individual = await createIndividualCandidate(service);

  assert.equal(organization.candidate.partyRef.partyType, "organization");
  assert.deepEqual(organization.candidate.partyRef, {
    partyType: "organization",
    organizationId: "org-1",
    tenantProspectId: "prospect-1"
  });
  assert.equal(individual.candidate.partyRef.partyType, "individual");
  assert.deepEqual(individual.candidate.partyRef, {
    partyType: "individual",
    individualPartyId: "person-100",
    demandSignalId: "signal-100"
  });
  assert.equal(organization.candidate.status, "normalized");
  assert.equal(individual.candidate.status, "normalized");

  const replayed = await service.appendEvidence(
    ownerScope,
    searchEvidence("organization", "org"),
    "evidence:org"
  );
  assert.equal(replayed.id, organization.evidence.id);

  await assert.rejects(
    service.getCandidate(intruderScope, organization.candidate.id),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "resource_not_found"
  );
  await assert.rejects(
    service.getEvidence(intruderScope, organization.evidence.id),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "resource_not_found"
  );
});

test("rules qualification creates append-only decisions and a separate financial value score", async () => {
  const { service } = createHarness();
  const { candidate, evidence } = await createOrganizationCandidate(service);

  const first = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:org:v1"
  );

  assert.equal(first.qualification.grade, "S");
  assert.equal(first.qualification.recommendedAction, "priority_review");
  assert.equal(first.qualification.decisionEngine, "rules");
  assert.equal(first.qualification.promptVersion, null);
  assert.deepEqual(first.qualification.evidence, [{
    evidenceId: evidence.id,
    excerpt: "可核验的公开需求证据 org"
  }]);
  assert.equal(first.financialValue.grade, "S");
  assert.ok(first.financialValue.expectedContributionMinor > 0);
  assert.equal(first.candidate.status, "pending_review");

  const weaker = strongQualification();
  weaker.dimensions.demandStrength = 58;
  weaker.dimensions.buyingStage = 45;
  const second = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    weaker,
    healthyFinancialValue(),
    "qualify:org:v2"
  );
  assert.notEqual(second.qualification.id, first.qualification.id);
  assert.equal(
    (await service.listQualificationDecisions(ownerScope, candidate.id)).length,
    2
  );
  assert.equal(
    (await service.getQualificationDecision(
      ownerScope,
      candidate.id,
      first.qualification.id
    )).score,
    first.qualification.score
  );
  assert.equal(
    (await service.listFinancialValueDecisions(ownerScope, candidate.id)).length,
    2
  );
});

test("current financial value selects the newest record for the latest qualification without mutating state", async () => {
  const { repository, service } = createHarness();
  const { candidate } = await createOrganizationCandidate(service);
  const qualified = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:current-financial"
  );
  const timestamp = "2026-07-25T00:00:00.000Z";
  await repository.appendFinancialValue({
    ...qualified.financialValue,
    id: "financial-value-a",
    createdAt: timestamp
  });
  await repository.appendFinancialValue({
    ...qualified.financialValue,
    id: "financial-value-z",
    createdAt: timestamp
  });

  const candidateBefore = await service.getCandidate(
    ownerScope,
    candidate.id
  );
  const valuesBefore = await repository.listFinancialValues(
    ownerScope,
    candidate.id
  );
  const current = await service.getCurrentFinancialValueDecision(
    ownerScope,
    candidate.id
  );

  assert.equal(current.id, "financial-value-z");
  assert.deepEqual(
    await repository.listFinancialValues(ownerScope, candidate.id),
    valuesBefore
  );
  assert.deepEqual(
    await service.getCandidate(ownerScope, candidate.id),
    candidateBefore
  );
});

test("current financial value is absent when the candidate has no current qualification", async () => {
  const { service } = createHarness();
  const { candidate } = await createOrganizationCandidate(service);
  const qualified = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:historical-financial"
  );
  const evidence = await service.appendEvidence(
    ownerScope,
    searchEvidence("organization", "invalidate-financial"),
    "evidence:invalidate-financial"
  );
  await service.attachEvidenceToCandidate(
    ownerScope,
    candidate.id,
    evidence.id,
    "attach:invalidate-financial"
  );
  assert.equal(
    (await service.listFinancialValueDecisions(ownerScope, candidate.id))[0]
      ?.qualificationDecisionId,
    qualified.qualification.id
  );

  await assert.rejects(
    service.getCurrentFinancialValueDecision(ownerScope, candidate.id),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "resource_not_found"
      && error.status === 404
  );
});

test("current financial value never falls back to an older qualification", async () => {
  const { repository, service } = createHarness();
  const { candidate } = await createOrganizationCandidate(service);
  const old = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:old-financial"
  );
  const currentQualification = {
    ...old.qualification,
    id: "qualification-current",
    decisionVersion: "decision-v2",
    createdAt: "2026-07-25T00:00:00.000Z"
  };
  await repository.appendQualificationDecision(currentQualification);
  const currentCandidate = await service.getCandidate(
    ownerScope,
    candidate.id
  );
  await repository.saveCandidate({
    ...currentCandidate,
    latestDecisionId: currentQualification.id,
    latestDecisionVersion: currentQualification.decisionVersion,
    version: currentCandidate.version + 1,
    updatedAt: "2026-07-25T00:00:00.000Z"
  });

  await assert.rejects(
    service.getCurrentFinancialValueDecision(ownerScope, candidate.id),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "resource_not_found"
      && error.status === 404
  );
});

test("hard gates cannot be overridden by high model scores", async () => {
  const { service } = createHarness();
  const { candidate } = await createIndividualCandidate(service);
  const input = strongQualification();
  input.decisionEngine = "model";
  input.promptVersion = "qualification.individual.v1";
  input.modelProvider = "zhipu";
  input.model = "glm-4.5";
  input.hardGates.noExplicitRejection = false;
  input.reasons = ["模型认为意向很高"];

  const result = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    input,
    healthyFinancialValue(),
    "qualify:person:blocked"
  );

  assert.equal(result.qualification.grade, "D");
  assert.equal(result.qualification.recommendedAction, "do_not_contact");
  assert.match(result.qualification.reasons.join("\n"), /明确拒绝/);
  await assert.rejects(
    service.reviewCandidate(ownerScope, candidate.id, {
      action: "approved",
      decisionVersion: result.qualification.decisionVersion,
      reason: null,
      idempotencyKey: "review:blocked:approve"
    }),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "hard_gate_blocked"
  );
});

test("battle cards require evidence for facts and inferences and remain versioned", async () => {
  const { service } = createHarness();
  const { candidate, evidence } = await createOrganizationCandidate(service);
  await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:battle-card"
  );

  const validSections: BattleCardSection[] = [
    {
      label: "需求事实",
      kind: "fact",
      content: "公开页面显示正在比较获客方案",
      evidenceIds: [evidence.id],
      confidence: 1
    },
    {
      label: "推荐切入",
      kind: "inference",
      content: "先以渠道 ROI 诊断切入",
      evidenceIds: [evidence.id],
      confidence: 0.82
    },
    {
      label: "现有供应商",
      kind: "unknown",
      content: "暂无足够信息",
      evidenceIds: [],
      confidence: null
    }
  ];
  const first = await service.createBattleCard(ownerScope, candidate.id, {
    sections: validSections,
    modelProvider: "moonshot",
    model: "kimi-k2",
    promptVersion: "battle-card.v1",
    confidence: 0.84
  }, "battle-card:v1");
  const replay = await service.createBattleCard(ownerScope, candidate.id, {
    sections: validSections,
    modelProvider: "moonshot",
    model: "kimi-k2",
    promptVersion: "battle-card.v1",
    confidence: 0.84
  }, "battle-card:v1");
  assert.equal(replay.id, first.id);

  await assert.rejects(
    service.createBattleCard(ownerScope, candidate.id, {
      sections: [{
        label: "无依据性格",
        kind: "inference",
        content: "决策人一定非常激进",
        evidenceIds: [],
        confidence: 0.9
      }],
      modelProvider: "moonshot",
      model: "kimi-k2",
      promptVersion: "battle-card.v1",
      confidence: 0.9
    }, "battle-card:invalid"),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "evidence_required"
  );
  assert.equal(
    (await service.listBattleCards(ownerScope, candidate.id)).length,
    1
  );
});

test("new evidence invalidates an approval and requires a new qualification version", async () => {
  const { service } = createHarness();
  const { candidate } = await createOrganizationCandidate(service, "invalidate");
  const qualified = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:invalidate:v1"
  );
  await service.reviewCandidate(ownerScope, candidate.id, {
    action: "approved",
    decisionVersion: qualified.qualification.decisionVersion,
    reason: "首轮证据完整",
    idempotencyKey: "review:invalidate:approve"
  });
  const newEvidence = await service.appendEvidence(
    ownerScope,
    searchEvidence("organization", "invalidate-new"),
    "evidence:invalidate:new"
  );

  const invalidated = await service.attachEvidenceToCandidate(
    ownerScope,
    candidate.id,
    newEvidence.id,
    "candidate-evidence:invalidate:new"
  );
  assert.equal(invalidated.status, "pending_review");
  assert.equal(invalidated.approvedDecisionVersion, null);
  assert.equal(invalidated.latestDecisionVersion, null);
  assert.ok(invalidated.evidenceIds.includes(newEvidence.id));
  await assert.rejects(
    service.reviewCandidate(ownerScope, candidate.id, {
      action: "approved",
      decisionVersion: qualified.qualification.decisionVersion,
      reason: "尝试复用旧评分",
      idempotencyKey: "review:invalidate:stale"
    }),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "stale_decision"
  );
});

test("human review and bounded research follow the approved candidate state machine", async () => {
  const { service } = createHarness();
  const { candidate } = await createOrganizationCandidate(service);
  const qualified = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:research"
  );

  const review = await service.reviewCandidate(ownerScope, candidate.id, {
    action: "needs_research",
    decisionVersion: qualified.qualification.decisionVersion,
    reason: "缺少现有供应商证据",
    idempotencyKey: "review:research"
  });
  assert.equal(review.candidate.status, "needs_research");
  assert.ok(review.research);
  assert.equal(review.research.status, "pending");

  const started = await service.startResearch(
    ownerScope,
    candidate.id,
    review.research.id,
    "research:start"
  );
  assert.equal(started.status, "running");
  const completed = await service.completeResearch(
    ownerScope,
    candidate.id,
    started.id,
    {
      result: "access_restricted",
      newEvidenceIds: [],
      terminationReason: "目标页面要求登录"
    },
    "research:complete"
  );
  assert.equal(completed.research.status, "access_restricted");
  assert.equal(completed.candidate.status, "pending_review");

  const reviews = await service.listReviewEvents(ownerScope, candidate.id);
  const audits = await service.listAuditEvents(ownerScope, candidate.id);
  assert.equal(reviews.length, 1);
  assert.ok(audits.length >= 6);
  assert.equal(reviews[0]?.action, "needs_research");
});

test("a rejected candidate needs new evidence and an explicit human reopen before rescoring", async () => {
  const { service } = createHarness();
  const { candidate } = await createOrganizationCandidate(service, "reopen");
  const first = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:reopen:v1"
  );
  await service.reviewCandidate(ownerScope, candidate.id, {
    action: "rejected",
    decisionVersion: first.qualification.decisionVersion,
    reason: "现有证据不足",
    idempotencyKey: "review:reopen:reject"
  });

  await assert.rejects(
    service.qualifyCandidate(
      ownerScope,
      candidate.id,
      strongQualification(),
      healthyFinancialValue(),
      "qualify:reopen:forbidden"
    ),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "invalid_state"
  );

  const newEvidence = await service.appendEvidence(
    ownerScope,
    searchEvidence("organization", "reopen-new"),
    "evidence:reopen:new"
  );
  await service.attachEvidenceToCandidate(
    ownerScope,
    candidate.id,
    newEvidence.id,
    "candidate-evidence:reopen:new"
  );
  const reopened = await service.reviewCandidate(ownerScope, candidate.id, {
    action: "reopen",
    decisionVersion: first.qualification.decisionVersion,
    reason: "已补充新的公开采购证据",
    idempotencyKey: "review:reopen:explicit"
  });
  assert.equal(reopened.candidate.status, "normalized");
  const rescored = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:reopen:v2"
  );
  assert.equal(rescored.qualification.decisionVersion, "decision-v2");
});

test("only an explicit approved conversion creates one party-correct CRM lead", async () => {
  const { service, converted } = createHarness();
  const { candidate } = await createIndividualCandidate(service);
  const qualified = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:convert"
  );
  await service.reviewCandidate(ownerScope, candidate.id, {
    action: "approved",
    decisionVersion: qualified.qualification.decisionVersion,
    reason: "证据完整，允许进入 CRM",
    idempotencyKey: "review:approve"
  });

  assert.equal(converted.length, 0, "approval must never auto-convert or auto-contact");
  const [first, replay] = await Promise.all([
    service.convertCandidate(ownerScope, candidate.id, {
      decisionVersion: qualified.qualification.decisionVersion,
      idempotencyKey: "convert:person"
    }),
    service.convertCandidate(ownerScope, candidate.id, {
      decisionVersion: qualified.qualification.decisionVersion,
      idempotencyKey: "convert:person"
    })
  ]);

  assert.equal(first.leadId, "lead-1");
  assert.deepEqual(replay, first);
  assert.deepEqual(converted, [{
    candidateId: candidate.id,
    partyType: "individual"
  }]);
  assert.equal((await service.getCandidate(ownerScope, candidate.id)).status, "converted_to_lead");
});

test("live outcomes are append-only, idempotent, attributed, and tenant isolated", async () => {
  const { service } = createHarness();
  const { candidate, evidence } = await createOrganizationCandidate(service);
  const qualified = await service.qualifyCandidate(
    ownerScope,
    candidate.id,
    strongQualification(),
    healthyFinancialValue(),
    "qualify:outcome"
  );
  await service.reviewCandidate(ownerScope, candidate.id, {
    action: "approved",
    decisionVersion: qualified.qualification.decisionVersion,
    reason: "批准转换",
    idempotencyKey: "review:outcome"
  });
  const conversion = await service.convertCandidate(ownerScope, candidate.id, {
    decisionVersion: qualified.qualification.decisionVersion,
    idempotencyKey: "convert:outcome"
  });

  const outcomeInput = {
    leadId: conversion.leadId,
    customerId: null,
    eventType: "won" as const,
    occurredAt: "2026-07-24T08:00:00.000Z",
    amount: { amountMinor: 4_800_000, currency: "CNY" },
    reasonCode: "solution_fit",
    reasonText: "客户认可全网商机与经营决策闭环",
    candidateId: candidate.id,
    idempotencyKey: "outcome:won:1",
    attribution: {
      runId: "run-1",
      evidenceIds: [evidence.id],
      providerIds: ["baidu_ai_search"],
      queryIds: ["query-1"],
      strategyVersion: "strategy.v1",
      qualificationDecisionId: qualified.qualification.id,
      decisionVersion: qualified.qualification.decisionVersion,
      decisionSnapshotHash: qualified.qualification.snapshotHash
    }
  };
  const first = await service.recordOutcome(ownerScope, outcomeInput);
  const replay = await service.recordOutcome(ownerScope, outcomeInput);
  assert.equal(replay.id, first.id);
  assert.equal(first.recordKind, "live");
  assert.equal(first.attribution.ruleVersion, "qualification-rules.v1");
  assert.deepEqual(first.partyRef, candidate.partyRef);
  assert.equal((await service.listOutcomes(ownerScope, candidate.id)).length, 1);
  await assert.rejects(
    service.recordOutcome(ownerScope, {
      ...outcomeInput,
      idempotencyKey: "outcome:negative-amount",
      amount: { amountMinor: -1, currency: "CNY" }
    }),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "invalid_request"
  );
  await assert.rejects(
    service.listOutcomes(intruderScope, candidate.id),
    (error: unknown) => error instanceof AcquisitionDomainError
      && error.code === "resource_not_found"
  );
});

test("domain mutations roll back state when the audit append fails", async () => {
  const baseRepository = new InMemoryAcquisitionDomainRepository();
  const repository = new Proxy(baseRepository, {
    get(target, property, receiver) {
      if (property === "appendAuditEvent") {
        return async () => {
          throw new Error("simulated audit persistence failure");
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const service = new AcquisitionDomainService({
    repository,
    leadConversionPort: {
      createLead: async (request) => ({
        leadId: "unused",
        partyRef: request.partyRef
      })
    },
    idFactory: (prefix) => `${prefix}-rollback`,
    now: () => "2026-07-24T12:00:00.000Z"
  });

  await assert.rejects(
    service.appendEvidence(
      ownerScope,
      searchEvidence("organization", "rollback"),
      "append-evidence-rollback"
    ),
    /simulated audit persistence failure/
  );

  assert.equal(
    await baseRepository.findEvidence(ownerScope, "evidence-rollback"),
    null,
    "business state must not survive without its audit and idempotency record"
  );
  assert.equal(
    await baseRepository.findIdempotency(
      ownerScope,
      "append_evidence",
      "append-evidence-rollback"
    ),
    null
  );
});
