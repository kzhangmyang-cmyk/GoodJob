import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultIndustryTemplateId,
  industryTemplates
} from "./templates.js";
import type {
  AdvisorRunVm,
  BattleCardClaimDto,
  BattleCardSectionDto,
  CandidatePresentationEventDto,
  CandidateStatus,
  FinancialValueDto,
  QualificationDto,
  RunPresentationDto
} from "./types.js";
import {
  BATTLE_CARD_V2_REGION_ORDER,
  battleCardClaimVm,
  battleCardSectionsVm,
  financialValueVm,
  mergePresentation,
  pageStatusForRun,
  searchProviderLabel
} from "./view-model.js";

const run = {
  id: "run-1",
  status: "running" as const,
  etag: "\"run-1:1\"",
  updatedAt: "2026-07-26T09:00:00.000Z",
  completedAt: null
};

const emptyRun = (): AdvisorRunVm => ({
  run,
  providers: [],
  summary: null,
  candidatesById: new Map(),
  nextAfter: "",
  hasMore: false
});

const presentation = (
  overrides: Partial<RunPresentationDto> = {}
): RunPresentationDto => ({
  run,
  providers: [],
  summary: {
    sourcesSearched: 1,
    pagesAnalyzed: 3,
    organizationsFound: 2,
    dedupedCandidates: 1,
    validOpportunities: 0,
    highIntent: 0,
    financialEvaluatedHighIntentCount: 0,
    financialPendingHighIntentCount: 0,
    discoveredVideos: 0,
    commentsSampled: 0,
    validDemandSignals: 0,
    unresolvedActors: 0,
    highPotentialSignals: 0,
    expectedRevenueByCurrency: []
  },
  automationSteps: [],
  commentSignals: [],
  candidateEvents: [],
  nextAfter: "cursor-1",
  hasMore: false,
  ...overrides
});

const qualification = (
  candidateId: string,
  grade: QualificationDto["grade"],
  overrides: Partial<QualificationDto> = {}
): QualificationDto => ({
  id: `qualification-${candidateId}`,
  candidateId,
  decisionVersion: "qualification-v1",
  decisionEngine: "rules",
  grade,
  score: 90,
  recommendedAction: "priority_review",
  evidence: [],
  positiveSignals: [],
  negativeSignals: [],
  reasons: ["公开信号符合"],
  confidence: 0.9,
  ruleVersion: "rules-v1",
  promptVersion: null,
  modelProvider: null,
  model: null,
  hardGateFailures: [],
  createdAt: "2026-07-26T09:00:00.000Z",
  ...overrides
});

const financial = (
  currency: string,
  expectedRevenueMinor: number
): FinancialValueDto => ({
  id: `financial-${currency}`,
  candidateId: "candidate-1",
  qualificationDecisionId: "qualification-candidate-1",
  version: "financial-value-v1",
  grade: "S",
  score: 95,
  currency,
  expectedRevenueMinor,
  expectedGrossProfitMinor: expectedRevenueMinor / 2,
  expectedContributionMinor: expectedRevenueMinor / 4,
  factors: {
    profitability: 0.9,
    cashFlow: 0.8,
    creditQuality: 0.8,
    repeatPotential: 0.7,
    referralPotential: 0.6,
    closeProbability: 0.8
  },
  createdAt: "2026-07-26T09:00:00.000Z"
});

const candidateEvent = (
  candidateId: string,
  grade: QualificationDto["grade"],
  status: CandidateStatus = "qualified"
): CandidatePresentationEventDto => ({
  eventId: `event-${candidateId}`,
  createdAt: "2026-07-26T09:00:00.000Z",
  candidateId,
  candidate: {
    id: candidateId,
    subjectKind: "organization",
    displayName: candidateId,
    industry: null,
    region: "上海",
    domain: null,
    status,
    version: 1,
    identityResolved: true,
    updatedAt: "2026-07-26T09:00:00.000Z"
  },
  qualification: qualification(candidateId, grade),
  financialValue: null,
  sourcePlatforms: ["baidu"],
  evidenceCount: 1
});

test("mergePresentation upserts candidate events by candidateId and replaces the complete summary", () => {
  const firstEvent = candidateEvent("candidate-1", "S");
  firstEvent.candidate.displayName = "上海智造";
  firstEvent.financialValue = financial("CNY", 1_000_000);
  const first = mergePresentation(
    emptyRun(),
    presentation({ candidateEvents: [firstEvent] })
  );

  const updatedEvent = candidateEvent("candidate-1", "A");
  updatedEvent.eventId = "event-candidate-1-update";
  updatedEvent.createdAt = "2026-07-26T09:01:00.000Z";
  updatedEvent.candidate.displayName = "上海智造（更新）";
  updatedEvent.sourcePlatforms = ["baidu", "tavily"];
  updatedEvent.evidenceCount = 2;
  updatedEvent.financialValue = financial("CNY", 2_000_000);
  const latestSummary = {
    ...presentation().summary,
    sourcesSearched: 4,
    dedupedCandidates: 9,
    financialPendingHighIntentCount: 2
  };
  const second = mergePresentation(
    first,
    presentation({
      summary: latestSummary,
      candidateEvents: [updatedEvent]
    })
  );

  assert.equal(second.candidatesById.size, 1);
  assert.equal(
    second.candidatesById.get("candidate-1")?.displayName,
    "上海智造（更新）"
  );
  assert.equal(second.candidatesById.get("candidate-1")?.evidenceCount, 2);
  assert.deepEqual(
    {
      sourcesSearched: second.summary?.sourcesSearched,
      dedupedCandidates: second.summary?.dedupedCandidates,
      financialPendingHighIntentCount:
        second.summary?.financialPendingHighIntentCount
    },
    {
      sourcesSearched: 4,
      dedupedCandidates: 9,
      financialPendingHighIntentCount: 2
    }
  );
});

test("financial values stay separated by currency, put CNY first, and never invent a missing amount", () => {
  assert.deepEqual(financialValueVm(null), {
    status: "pending",
    label: "待评估",
    amounts: []
  });

  assert.deepEqual(financialValueVm(financial("USD", 250_050)), {
    status: "evaluated",
    label: "已评估",
    amounts: [{
      currency: "USD",
      amountMinor: 250_050,
      formatted: "US$2,500.50"
    }]
  });

  const result = mergePresentation(
    emptyRun(),
    presentation({
      summary: {
        ...presentation().summary,
        financialEvaluatedHighIntentCount: 2,
        expectedRevenueByCurrency: [
          { currency: "USD", amountMinor: 250_050 },
          { currency: "CNY", amountMinor: 1_000_000 }
        ]
      }
    })
  );

  assert.deepEqual(result.summary?.expectedRevenueByCurrency, [
    { currency: "CNY", amountMinor: 1_000_000, formatted: "¥10,000.00" },
    { currency: "USD", amountMinor: 250_050, formatted: "US$2,500.50" }
  ]);
});

test("qualification distinctions preserve high intent and valid opportunity gates", () => {
  const highS = candidateEvent("candidate-s", "S");
  const highA = candidateEvent("candidate-a", "A");
  const validB = candidateEvent("candidate-b", "B");
  const hardGateBlocked = candidateEvent("candidate-hard-gate", "B");
  hardGateBlocked.qualification = qualification("candidate-hard-gate", "B", {
    hardGateFailures: ["identity_unresolved"]
  });
  const doNotContact = candidateEvent(
    "candidate-do-not-contact",
    "A",
    "do_not_contact"
  );

  const result = mergePresentation(
    emptyRun(),
    presentation({
      candidateEvents: [
        highS,
        highA,
        validB,
        hardGateBlocked,
        doNotContact
      ]
    })
  );

  assert.equal(result.candidatesById.get("candidate-s")?.isHighIntent, true);
  assert.equal(result.candidatesById.get("candidate-a")?.isHighIntent, true);
  assert.equal(result.candidatesById.get("candidate-b")?.isHighIntent, false);
  assert.equal(
    result.candidatesById.get("candidate-b")?.isValidOpportunity,
    true
  );
  assert.equal(
    result.candidatesById.get("candidate-hard-gate")?.isValidOpportunity,
    false
  );
  assert.equal(
    result.candidatesById.get("candidate-do-not-contact")?.isValidOpportunity,
    false
  );
});

test("pageStatusForRun maps connection, partial, empty, and failed runs explicitly", () => {
  assert.equal(pageStatusForRun("connection_required"), "connection_required");
  assert.equal(pageStatusForRun("partial_success"), "partial_success");
  assert.equal(pageStatusForRun("succeeded_empty"), "empty");
  assert.equal(pageStatusForRun("failed"), "failed");
});

test("battleCardSectionsVm labels inference with confidence and evidence references", () => {
  const sections: BattleCardSectionDto[] = [{
    label: "采购时机",
    kind: "inference",
    content: "推测正在评估数字化供应商",
    confidence: 0.82,
    evidenceIds: ["evidence-1", "evidence-2"]
  }];

  assert.deepEqual(battleCardSectionsVm(sections), [{
    label: "采购时机",
    kind: "inference",
    content: "推测正在评估数字化供应商",
    inferenceLabel: "推测",
    confidence: 0.82,
    evidenceIds: ["evidence-1", "evidence-2"]
  }]);
});

test("battleCardClaimVm keeps evidence and labels only evidence-backed inference as 推测", () => {
  const inference: BattleCardClaimDto = {
    kind: "inference",
    text: "可能更重视可量化的海外增长结果",
    confidence: 0.74,
    evidenceIds: ["evidence-growth"]
  };
  const fact: BattleCardClaimDto = {
    kind: "fact",
    text: "官网已上线英文站",
    confidence: 1,
    evidenceIds: ["evidence-site"]
  };

  assert.deepEqual(battleCardClaimVm(inference), {
    kind: "inference",
    content: "可能更重视可量化的海外增长结果",
    confidence: 0.74,
    evidenceIds: ["evidence-growth"],
    inferenceLabel: "推测"
  });
  assert.equal(battleCardClaimVm(fact).inferenceLabel, null);
});

test("battle-card v2 regions have one stable evidence-led order", () => {
  assert.deepEqual(BATTLE_CARD_V2_REGION_ORDER, [
    "客户概况",
    "需求证据",
    "供应商",
    "决策链",
    "采购偏好",
    "连接策略",
    "角色话术",
    "不建议动作",
    "财务摘要"
  ]);
});

test("canonical search provider ids are translated only in the display layer", () => {
  assert.equal(searchProviderLabel("baidu_ai_search"), "百度 AI 搜索");
  assert.equal(
    searchProviderLabel("tencent_web_search", true),
    "腾讯云联网搜索（演示数据）"
  );
  assert.equal(
    searchProviderLabel("custom_search", true),
    "custom_search（演示数据）"
  );
});

test("industry templates expose only editable targeting fields", () => {
  assert.equal(defaultIndustryTemplateId, "enterprise-services");
  assert.deepEqual(
    industryTemplates.map(({ label }) => label),
    ["企业服务", "外贸制造", "装修", "美业", "教培", "自定义行业"]
  );
  assert.equal(
    industryTemplates[0]?.taskText,
    "帮我寻找上海近期可能有数字化采购需求、员工规模 50 人以上的制造企业。"
  );
  const serialized = JSON.stringify(industryTemplates);
  for (const forbidden of [
    "connectionId",
    "providerConnections",
    "operations",
    "budgetSnapshot",
    "financialValue"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
