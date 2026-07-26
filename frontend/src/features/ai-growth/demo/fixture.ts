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

const plan: AcquisitionPlanCreateDto = {
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
  providerConnections: [
    "Bing 公开搜索",
    "Google 新闻公开索引",
    "百度公开搜索",
    "必应新闻公开索引",
    "企业官网公开页",
    "行业协会公开目录"
  ].map((providerId, index) => ({
    connectionId: `demo-connection-${index + 1}`,
    providerId,
    kind: "search" as const,
    status: "active" as const,
    credentialVersion: 0
  })),
  operations: [],
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
  score: number
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
    excerpt: "演示数据：来自公开页面的企业动态摘要。"
  }],
  positiveSignals: [{ name: "公开增长信号（演示数据）", score }],
  negativeSignals: [],
  reasons: ["演示数据：公开信息与目标画像匹配。"],
  confidence: 0.82,
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
    ["Bing 公开搜索", "succeeded", 21, 4, 1, null],
    ["Google 新闻公开索引", "succeeded", 18, 3, 1, null],
    ["百度公开搜索", "succeeded", 17, 3, 2, null],
    ["必应新闻公开索引", "partial_success", 12, 2, 0, "DEMO_PARTIAL_PAGE"],
    ["企业官网公开页", "succeeded", 11, 2, 0, null],
    ["行业协会公开目录", "partial_success", 9, 1, 0, "DEMO_RATE_LIMIT" ]
  ].map(([providerId, status, rawResultCount, acceptedResultCount, duplicateResultCount, errorCode], index) => ({
    shardId: `demo-shard-${index + 1}`,
    connectionId: `demo-connection-${index + 1}`,
    providerId: `${providerId}（演示数据）`,
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
    ["demo-candidate-1", "远岚智能装备（演示数据）", "上海", "S", 96, "CNY", 1_280_000],
    ["demo-candidate-2", "海桥工业零部件（演示数据）", "苏州", "A", 88, "USD", 180_000],
    ["demo-candidate-3", "蓝港供应链科技（演示数据）", "宁波", "B", 76, null, null],
    ["demo-candidate-4", "晨拓精密制造（演示数据）", "上海", "C", 61, null, null],
    ["demo-candidate-5", "星港出口服务（演示数据）", "苏州", "A", 84, null, null],
    ["demo-candidate-6", "新原工业系统（演示数据）", "宁波", "B", 73, "CNY", 1_400_000]
  ].map(([id, displayName, region, grade, score, currency, amountMinor], index) => {
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
      qualification: qualification(candidateId, grade as "S" | "A" | "B" | "C", score as number),
      financialValue,
      sourcePlatforms: ["公开搜索（演示数据）"],
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
    sections: [
      {
        label: "已确认事实（演示数据）",
        kind: "fact",
        content: "公开页面显示该企业正在更新出口产品资料。",
        evidenceIds: ["demo-evidence-demo-candidate-1"]
      },
      {
        label: "下一步推测（演示数据）",
        kind: "inference",
        content: "推测其正在比较海外获客与供应链协同方案。",
        confidence: 0.82,
        evidenceIds: ["demo-evidence-demo-candidate-1"]
      },
      {
        label: "待人工核实（演示数据）",
        kind: "unknown",
        content: "尚不清楚预算窗口和采购决策节奏。"
      }
    ],
    evidenceIds: ["demo-evidence-demo-candidate-1"],
    confidence: 0.82,
    modelProvider: "演示数据：本地规则",
    model: "demo-rules-v1",
    promptVersion: "demo-prompt-v1",
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
