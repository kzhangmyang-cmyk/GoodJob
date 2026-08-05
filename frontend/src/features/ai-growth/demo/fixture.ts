import type {
  AcquisitionPlanCreateDto,
  BattleCardDto,
  ExecutiveSummaryDto,
  RunPresentationDto
} from "../types.js";

export interface DemoDuplicateMerge {
  demo: true;
  demoLabel: "演示数据";
  duplicateCandidateId: string;
  survivingCandidateId: string;
  reason: string;
}

export interface DemoOwnerSummary {
  demo: true;
  demoLabel: "演示数据";
  headline: string;
  detail: string;
  summary: ExecutiveSummaryDto;
}

export interface DemoFixture {
  demo: true;
  demoLabel: "演示数据";
  plan: AcquisitionPlanCreateDto;
  runPresentation: RunPresentationDto;
  duplicateMerge: DemoDuplicateMerge;
  battleCard: BattleCardDto;
  ownerSummary: DemoOwnerSummary;
}

const timestamp = "2026-07-26T09:00:00.000Z";
const providerIds = [
  "baidu_ai_search",
  "tencent_web_search",
  "tavily",
  "serper",
  "brave",
  "serpapi"
] as const;
const demoQueries = [
  "上海 装备制造 海外市场 招聘 外贸销售",
  "苏州 工业零部件 扩产 新项目",
  "宁波 制造企业 寻找供应商 合作",
  "长三角 制造业 CRM 招标 采购",
  "site:gov.cn 制造企业 扩产 项目 公示",
  "site:company-domain.example 英文站 海外业务"
] as const;

const plan: AcquisitionPlanCreateDto = {
  targetPlatform: "web",
  name: "演示数据 · 长三角制造企业增长机会",
  objective: "演示数据：识别近期有海外增长和供应链协同需求的制造企业。",
  icp: {
    industries: ["装备制造", "工业零部件", "跨境贸易"],
    regions: ["上海", "苏州", "宁波"],
    organizationCriteria: ["50 人以上", "有公开出口或扩产信号"],
    individualCriteria: [],
    exclusionRules: ["演示数据：仅公开企业信息", "勿扰名单"]
  },
  subjectChannels: { organization: true, individual: false },
  providerConnections: providerIds.map((providerId, index) => ({
    connectionId: `demo-connection-${index + 1}`,
    providerId,
    kind: "search" as const,
    status: "active" as const,
    credentialVersion: 0
  })),
  operations: demoQueries.map((query, index) => ({
    operationId: `demo-search-${index + 1}`,
    subjectChannel: "organization" as const,
    kind: "search" as const,
    connectionId: `demo-connection-${index + 1}`,
    query,
    allocatedBudget: {
      requests: 10,
      results: 20,
      amountMinor: 0,
      durationSeconds: 15
    }
  })),
  budgetSnapshot: {
    billingCurrency: "CNY",
    maxRequests: 60,
    maxResults: 120,
    maxAmountMinor: 0,
    maxDurationSeconds: 90
  },
  stopConditions: {
    stopWhenBudgetExhausted: true,
    stopWhenNoMoreResults: true
  },
  modelConnectionId: null
};

const summary: ExecutiveSummaryDto = {
  sourcesSearched: 6,
  pagesAnalyzed: 88,
  organizationsFound: 9,
  dedupedCandidates: 6,
  validOpportunities: 5,
  highIntent: 3,
  financialEvaluatedHighIntentCount: 2,
  financialPendingHighIntentCount: 1,
  expectedRevenueByCurrency: [
    { currency: "CNY", amountMinor: 2_680_000 },
    { currency: "USD", amountMinor: 180_000 }
  ]
};

const qualification = (
  candidateId: string,
  grade: "S" | "A" | "B" | "C",
  score: number,
  signal: string,
  confidence: number
) => ({
  id: `demo-qualification-${candidateId}`,
  candidateId,
  decisionVersion: "demo-qualification-v1",
  decisionEngine: "rules" as const,
  grade,
  score,
  recommendedAction: grade === "S" || grade === "A"
    ? "priority_review" as const
    : grade === "B"
      ? "nurture" as const
      : "observe" as const,
  evidence: [{
    evidenceId: `demo-evidence-${candidateId}`,
    excerpt: `演示数据：${signal}`
  }],
  positiveSignals: [{ name: `${signal}（演示数据）`, score }],
  negativeSignals: [],
  reasons: [
    `演示数据：证据 demo-evidence-${candidateId} 与目标画像匹配。`
  ],
  confidence,
  ruleVersion: "demo-rules-v1",
  promptVersion: null,
  modelProvider: null,
  model: null,
  hardGateFailures: [],
  createdAt: timestamp
});

const presentation: RunPresentationDto = {
  run: {
    id: "demo-run-growth-20260726",
    status: "succeeded",
    etag: "\"demo-run-growth-20260726:1\"",
    updatedAt: timestamp,
    completedAt: timestamp
  },
  providers: [
    ["baidu_ai_search", "succeeded", 21, 4, 1, null],
    ["tencent_web_search", "succeeded", 18, 3, 1, null],
    ["tavily", "succeeded", 17, 3, 2, null],
    ["serper", "partial_success", 12, 2, 0, "DEMO_PARTIAL_PAGE"],
    ["brave", "succeeded", 11, 2, 0, null],
    ["serpapi", "partial_success", 9, 1, 0, "DEMO_RATE_LIMIT" ]
  ].map(([providerId, status, rawResultCount, acceptedResultCount, duplicateResultCount, errorCode], index) => ({
    shardId: `demo-shard-${index + 1}`,
    connectionId: `demo-connection-${index + 1}`,
    providerId: providerId as string,
    status: status as "succeeded" | "partial_success",
    rawResultCount: rawResultCount as number,
    acceptedResultCount: acceptedResultCount as number,
    duplicateResultCount: duplicateResultCount as number,
    failedResultCount: errorCode ? 1 : 0,
    errorCode: errorCode as string | null,
    retryAfterAt: null
  })),
  summary,
  candidateEvents: [
    ["demo-candidate-1", "远岚智能装备（演示数据）", "上海", "S", 96, "招聘外贸销售", 0.91, "baidu_ai_search", "CNY", 1_280_000],
    ["demo-candidate-2", "海桥工业零部件（演示数据）", "苏州", "A", 88, "英文站上线", 0.84, "tencent_web_search", "USD", 180_000],
    ["demo-candidate-3", "蓝港供应链科技（演示数据）", "宁波", "B", 76, "扩产公告", 0.79, "tavily", null, null],
    ["demo-candidate-4", "晨拓精密制造（演示数据）", "上海", "C", 61, "CRM 招标", 0.73, "serper", null, null],
    ["demo-candidate-5", "星港出口服务（演示数据）", "苏州", "A", 84, "海外展会", 0.87, "brave", null, null],
    ["demo-candidate-6", "新原工业系统（演示数据）", "宁波", "B", 73, "供应商服务投诉", 0.68, "serpapi", "CNY", 1_400_000]
  ].map(([
    id,
    displayName,
    region,
    grade,
    score,
    signal,
    confidence,
    sourcePlatform,
    currency,
    amountMinor
  ], index) => {
    const candidateId = id as string;
    const financialValue = currency === null ? null : {
      id: `demo-financial-${candidateId}`,
      candidateId,
      qualificationDecisionId: `demo-qualification-${candidateId}`,
      version: "demo-financial-v1",
      grade: grade as "S" | "A" | "B" | "C",
      score: score as number,
      currency: currency as string,
      expectedRevenueMinor: amountMinor as number,
      expectedGrossProfitMinor: Math.round((amountMinor as number) * 0.42),
      expectedContributionMinor: Math.round((amountMinor as number) * 0.2),
      factors: {
        profitability: 0.76,
        cashFlow: 0.7,
        creditQuality: 0.72,
        repeatPotential: 0.74,
        referralPotential: 0.64,
        closeProbability: 0.58
      },
      createdAt: timestamp
    };
    return {
      eventId: `demo-event-${index + 1}`,
      createdAt: timestamp,
      candidateId,
      candidate: {
        id: candidateId,
        subjectKind: "organization" as const,
        displayName: displayName as string,
        industry: "装备制造（演示数据）",
        region: region as string,
        domain: `https://demo-company-${index + 1}.example.invalid`,
        status: grade === "C" ? "pending_review" as const : "qualified" as const,
        updatedAt: timestamp
      },
      qualification: qualification(
        candidateId,
        grade as "S" | "A" | "B" | "C",
        score as number,
        signal as string,
        confidence as number
      ),
      financialValue,
      sourcePlatforms: [sourcePlatform as string],
      evidenceCount: 2 + index
    };
  }),
  nextAfter: "demo-cursor-complete",
  hasMore: false
};

export const demoFixture: DemoFixture = {
  demo: true,
  demoLabel: "演示数据",
  plan,
  runPresentation: presentation,
  duplicateMerge: {
    demo: true,
    demoLabel: "演示数据",
    duplicateCandidateId: "demo-candidate-duplicate-1",
    survivingCandidateId: "demo-candidate-1",
    reason: "演示数据：域名与统一社会信用代码指向同一公开企业主体。"
  },
  battleCard: {
    id: "demo-battle-card-1",
    candidateId: "demo-candidate-1",
    qualificationDecisionId: "demo-qualification-demo-candidate-1",
    partyType: "organization",
    schemaVersion: "battle-card.v2",
    intelligence: {
      accountOverview: [{
        kind: "fact",
        text: "演示数据：远岚智能装备为上海装备制造企业。",
        evidenceIds: ["demo-evidence-demo-candidate-1"],
        confidence: 1
      }],
      needAssessment: [{
        kind: "fact",
        text: "演示数据：公开招聘信息显示正在招聘外贸销售。",
        evidenceIds: ["demo-evidence-demo-candidate-1"],
        confidence: 1
      }],
      supplierHypotheses: [{
        kind: "unknown",
        text: "演示数据：没有充分公开证据确认现有获客供应商。",
        evidenceIds: [],
        confidence: null
      }],
      buyingCommittee: [{
        role: "海外业务负责人",
        priority: 1,
        influence: "decision_maker",
        concerns: ["海外询盘质量", "销售转化效率"],
        claim: {
          kind: "inference",
          text: "演示数据：海外业务负责人可能参与方案决策。",
          evidenceIds: ["demo-evidence-demo-candidate-1"],
          confidence: 0.76
        }
      }],
      procurementPreferences: [{
        kind: "inference",
        text: "演示数据：可能更关注可量化的询盘质量与转化结果。",
        confidence: 0.72,
        evidenceIds: ["demo-evidence-demo-candidate-1"]
      }],
      connectionStrategies: [{
        channel: "email",
        targetRole: "海外业务负责人",
        rationale: {
          kind: "fact",
          text: "演示数据：公开招聘页确认其正在扩充外贸团队。",
          evidenceIds: ["demo-evidence-demo-candidate-1"],
          confidence: 1
        },
        openingDraft: "建议人工审核后，以外贸团队线索筛选诊断作为切入。"
      }],
      roleSpecificOpeners: [{
        role: "海外业务负责人",
        channel: "email",
        text: "看到贵司正在扩充外贸团队，我们整理了一页公开线索筛选诊断，供您评估。"
      }],
      doNotActions: [
        "不要声称已经确认企业预算",
        "不要未经人工审核直接发送开场草稿"
      ],
      financialSummary: {
        decisionId: "demo-financial-demo-candidate-1",
        decisionVersion: "demo-financial-v1",
        grade: "S",
        score: 96,
        currency: "CNY",
        expectedRevenueMinor: 1_280_000,
        expectedGrossProfitMinor: 537_600,
        expectedContributionMinor: 256_000,
        factors: {
          profitability: 0.76,
          cashFlow: 0.7,
          creditQuality: 0.72,
          repeatPotential: 0.74,
          referralPotential: 0.64,
          closeProbability: 0.58
        }
      }
    },
    evidenceIds: ["demo-evidence-demo-candidate-1"],
    confidence: 0.81,
    modelProvider: "demo-local",
    model: "demo-rules-v2",
    promptVersion: "battle-card.v2.demo",
    createdAt: timestamp
  },
  ownerSummary: {
    demo: true,
    demoLabel: "演示数据",
    headline: "演示数据：已完成 6 个公开来源的企业机会筛选。",
    detail: "演示数据：6 家去重候选中有 3 家高意向；金额按币种分别展示，需人工确认后跟进。",
    summary
  }
};
