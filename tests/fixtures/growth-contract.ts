import type { Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { components } from "../../src/generated/growth-advisor-quote-roi";

const manifest = JSON.parse(readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "contracts",
    "pinned",
    "growth-advisor-quote-roi.manifest.json"
  ),
  "utf8"
)) as {
  name: string;
  contractVersion: string;
  contractHash: string;
  openapiVersion: string;
};

type Schema<Name extends keyof components["schemas"]> =
  Omit<components["schemas"][Name], "$defs">;
type CopilotMessage = Omit<components["schemas"]["CopilotMessage"], "$defs">;
type CopilotSession = Omit<components["schemas"]["CopilotSession"], "$defs">;
type CopilotTask = Omit<components["schemas"]["CopilotTask"], "$defs">;
type PagedMessages = {
  items: readonly CopilotMessage[];
  nextAfter: string | null;
  hasMore: boolean;
};

export type GrowthPageName =
  | "advisor"
  | "agents"
  | "catalog"
  | "quotes"
  | "finance"
  | "roi";

export type GrowthContractScenarioName =
  | "happy_path"
  | "workspace_selection_required"
  | "contract_mismatch"
  | "sales_redacted"
  | "quote_conflict"
  | "finance_partial_import"
  | "roi_not_computable"
  | "advisor_model_failed";

export interface GrowthRequestRecord {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface GrowthMockResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const readyBootstrap = {
  status: "ready",
  workspaceId: "workspace-e2e",
  capabilityRegistryVersion: "growth-capabilities.v1",
  capabilities: [
    "catalog.read",
    "catalog.manage",
    "pricing.sensitive.read",
    "quote.draft.create",
    "quote.confirm",
    "quote.exception.discount.approve",
    "ledger.pending.create",
    "ledger.verify",
    "roi.close",
    "growth.performance.workspace.read"
  ],
  contractVersion: manifest.contractVersion,
  contractHash: manifest.contractHash,
  features: ["catalog", "quotes", "finance", "roi", "advisor"]
} satisfies Schema<"GrowthBootstrapResponse">;

const selectionRequiredBootstrap = {
  status: "workspace_selection_required",
  workspaceId: null,
  capabilityRegistryVersion: "growth-capabilities.v1",
  capabilities: [],
  contractVersion: manifest.contractVersion,
  contractHash: manifest.contractHash,
  features: []
} satisfies Schema<"GrowthBootstrapResponse">;

const mismatchBootstrap = {
  ...readyBootstrap,
  contractHash: `sha256:${"f".repeat(64)}`
} satisfies Schema<"GrowthBootstrapResponse">;

const coverageFull = {
  costCoverageBps: 10_000,
  marginCoverageBps: 10_000,
  cashCoverageBps: 10_000,
  attributionCoverageBps: 10_000
} satisfies Schema<"GrowthPerformanceResponse_RoiCoverageSnapshot">;

const happyPerformance = {
  query: {
    cohortId: "cohort-1",
    currency: "CNY",
    asOf: "2026-08-09T08:00:00.000Z",
    planId: null,
    closureVersionId: "closure-cny-v1",
    sliceKey: "all"
  },
  expectedRoiByCurrency: [{
    currency: "CNY",
    status: "computed",
    basis: "probability_weighted_gross_profit",
    formulaVersion: "expected-roi.v1",
    costCoverageBps: 10_000,
    roiBps: 9_200,
    amountVisibility: "full",
    probabilityWeightedGrossProfitMinor: 96_000,
    attributedEstimatedAcquisitionCostMinor: 50_000
  }],
  actualRoiByCurrency: [{
    currency: "CNY",
    status: "computed",
    basis: "verified_gross_profit",
    formulaVersion: "actual-roi.v1",
    roiBps: 17_600,
    closureVersionId: "closure-cny-v1",
    dataAsOf: "2026-08-09T08:00:00.000Z",
    calculationHash: `sha256:${"c".repeat(64)}`,
    membershipSnapshotHash: `sha256:${"d".repeat(64)}`,
    coverage: coverageFull,
    sliceKey: "all",
    amountVisibility: "full",
    verifiedGrossProfitMinor: 138_000,
    verifiedAcquisitionCostMinor: 50_000
  }],
  cashByCurrency: [{
    currency: "CNY",
    amountVisibility: "full",
    verifiedContractMinor: 320_000,
    verifiedAcquisitionCostMinor: 50_000,
    paymentReceivedMinor: 320_000,
    refundMinor: 0,
    badDebtMinor: 0,
    netCashMinor: 320_000,
    coverage: coverageFull,
    contractRoas: {
      formulaVersion: "contract-roas.v1",
      status: "computed",
      valueBps: 64_000
    },
    cashMultiple: {
      formulaVersion: "cash-multiple.v1",
      status: "computed",
      valueBps: 64_000
    },
    collectionRate: {
      formulaVersion: "collection-rate.v1",
      status: "computed",
      valueBps: 10_000
    }
  }],
  coverage: coverageFull,
  dataGaps: [],
  dataAsOf: "2026-08-09T08:00:00.000Z"
} satisfies Schema<"GrowthPerformanceResponse">;

const notComputablePerformance = {
  ...happyPerformance,
  query: { ...happyPerformance.query, closureVersionId: null },
  actualRoiByCurrency: [{
    currency: "CNY",
    status: "not_computable",
    reason: "cohort_not_closed",
    basis: "verified_gross_profit",
    amountVisibility: "redacted",
    closureVersionId: null,
    formulaVersion: "actual-roi.v1",
    coverage: {
      costCoverageBps: 0,
      marginCoverageBps: 0,
      cashCoverageBps: 0,
      attributionCoverageBps: 0
    },
    dataAsOf: "2026-08-09T08:00:00.000Z",
    sliceKey: "all"
  }],
  cashByCurrency: [],
  dataGaps: ["cohort_not_closed"],
  coverage: {
    costCoverageBps: 0,
    marginCoverageBps: 0,
    cashCoverageBps: 0,
    attributionCoverageBps: 0
  }
} satisfies Schema<"GrowthPerformanceResponse">;

const advisorToday = {
  workspaceId: "workspace-e2e",
  audienceRole: "manager",
  dataAsOf: "2026-08-09T08:00:00.000Z",
  priorityCustomers: [{
    candidateId: "candidate-1",
    customerId: "customer-1",
    dealId: "deal-1",
    displayName: "示例企业",
    priorityScoreBps: 7_800,
    qualificationDecisionId: "qualification-1",
    qualificationDecisionVersion: "qualification-v1",
    inputSnapshotHash: `sha256:${"1".repeat(64)}`
  }],
  pendingQuoteApprovals: [],
  expectedRoi: [],
  actualRoi: [],
  financialDataGaps: [],
  recommendations: [],
  sourceSnapshotHash: `sha256:${"2".repeat(64)}`
} satisfies Schema<"AdvisorTodayResponse">;

const salesRedactedPerformance = {
  ...happyPerformance,
  expectedRoiByCurrency: [{
    currency: "CNY",
    status: "computed",
    basis: "probability_weighted_gross_profit",
    formulaVersion: "expected-roi.v1",
    costCoverageBps: 10_000,
    roiBps: 9_200,
    amountVisibility: "redacted"
  }],
  actualRoiByCurrency: [{
    currency: "CNY",
    status: "computed",
    basis: "verified_gross_profit",
    formulaVersion: "actual-roi.v1",
    roiBps: 17_600,
    closureVersionId: "closure-cny-v1",
    dataAsOf: "2026-08-09T08:00:00.000Z",
    calculationHash: `sha256:${"c".repeat(64)}`,
    membershipSnapshotHash: `sha256:${"d".repeat(64)}`,
    coverage: coverageFull,
    sliceKey: "all",
    amountVisibility: "redacted"
  }],
  cashByCurrency: [{
    currency: "CNY",
    amountVisibility: "redacted",
    coverage: coverageFull,
    contractRoas: {
      formulaVersion: "contract-roas.v1",
      status: "computed",
      valueBps: 64_000
    },
    cashMultiple: {
      formulaVersion: "cash-multiple.v1",
      status: "computed",
      valueBps: 64_000
    },
    collectionRate: {
      formulaVersion: "collection-rate.v1",
      status: "computed",
      valueBps: 10_000
    }
  }]
} satisfies Schema<"GrowthPerformanceResponse">;

const copilotSession = {
  id: "advisor-session-1",
  ownerId: "owner-e2e",
  teamId: "team-e2e",
  status: "active",
  modelSnapshot: {
    connectionId: "model-e2e",
    credentialVersion: 1,
    provider: "zhipu",
    model: "glm-4.5",
    promptVersion: "acquisition-model-prompt-bundle.v5",
    schemaVersion: "acquisition-model-schema-bundle.v6",
    promptHash: `sha256:${"3".repeat(64)}`,
    schemaHash: `sha256:${"4".repeat(64)}`
  },
  createdAt: "2026-08-09T08:00:00.000Z"
} satisfies CopilotSession;

const copilotMessages = {
  items: [{
    id: "advisor-message-1",
    sessionId: "advisor-session-1",
    sequence: 1,
    message: {
      role: "user",
      content: [{ type: "text", text: "今天先做什么" }],
      timestamp: 1_752_160_000_000
    },
    createdAt: "2026-08-09T08:00:00.000Z"
  }],
  nextAfter: null,
  hasMore: false
} satisfies PagedMessages;

type GrowthAdvisorCopilotTask =
  & CopilotTask
  & {
    result: Schema<"AdvisorRecommendation_AdvisorCopilotTaskResult"> | null;
  };

const copilotQueuedTask = {
  id: "advisor-task-1",
  sessionId: "advisor-session-1",
  kind: "message",
  status: "queued",
  responseMode: "assistant",
  targetPlatform: "douyin",
  result: null,
  errorCode: null,
  createdAt: "2026-08-09T08:00:00.000Z",
  completedAt: null
} satisfies GrowthAdvisorCopilotTask;

const copilotCompletedTask = {
  id: "advisor-task-1",
  sessionId: "advisor-session-1",
  kind: "message",
  status: "succeeded",
  responseMode: "assistant",
  targetPlatform: "douyin",
  result: {
    actionHash: `sha256:${"6".repeat(64)}`,
    actionReceiptId: "receipt-1",
    recommendationId: "recommendation-1",
    recommendationRevision: 2
  },
  errorCode: null,
  createdAt: "2026-08-09T08:00:00.000Z",
  completedAt: "2026-08-09T08:00:01.000Z"
} satisfies GrowthAdvisorCopilotTask;

const copilotFailedTask = {
  ...copilotCompletedTask,
  status: "failed",
  result: null,
  errorCode: "AI_EXPLANATION_UNAVAILABLE"
} satisfies GrowthAdvisorCopilotTask;

const verifiedCostEntries = [{
  id: "cost-1",
  workspaceId: "workspace-e2e",
  status: "verified",
  category: "media",
  amountMinor: 50_000,
  currency: "CNY",
  businessOccurredAt: "2026-08-09T01:00:00.000Z",
  recordedAt: "2026-08-09T08:00:00.000Z",
  createdBy: "manager-e2e",
  revision: 2,
  sourceIdentityRoot: "source-1",
  sourceRef: null,
  sourceVersion: 1,
  externalId: null,
  evidenceHash: `sha256:${"5".repeat(64)}`,
  correctionGroupId: null,
  correctsCostEntryId: null,
  occurredAt: "2026-08-09T01:00:00.000Z",
  planId: null,
  platform: "douyin",
  provenance: "manual_verified",
  providerId: null,
  runId: null
}] satisfies Schema<"AcquisitionCostEntry">[];

const importPreviewErrors = [{
  rowNumber: 3,
  code: "money_invalid",
  field: "amountMinor",
  message: "金额无效"
}] satisfies Schema<"FinanceImportOperation_FinanceImportRowError">[];

export interface GrowthContractScenario {
  readonly name: GrowthContractScenarioName;
  readonly bootstrap: Schema<"GrowthBootstrapResponse">;
  readonly performance: Schema<"GrowthPerformanceResponse">;
  readonly advisorToday: Schema<"AdvisorTodayResponse">;
  readonly costEntries: readonly Schema<"AcquisitionCostEntry">[];
  readonly importRowErrors: readonly Schema<
    "FinanceImportOperation_FinanceImportRowError"
  >[];
  readonly copilotSessionOperation: {
    kind: "copilot_session_creation";
    requestId: string;
  };
  readonly copilotSession: CopilotSession;
  readonly copilotMessages: PagedMessages;
  readonly copilotQueuedTask: GrowthAdvisorCopilotTask;
  readonly copilotCompletedTask: GrowthAdvisorCopilotTask;
  readonly responses: Readonly<Record<string, GrowthMockResponse>>;
  readonly statusOverrides?: Readonly<Record<string, number>>;
}

const COHORT_ROW = {
  id: "cohort-1",
  workspaceId: "workspace-e2e",
  platform: "douyin",
  cohortFrom: "2026-08-01T00:00:00.000Z",
  cohortTo: "2026-08-31T00:00:00.000Z",
  definitionVersion: "acquisition-cohort.v1",
  firstTouchRuleVersion: "first-touch.v1",
  status: "closed",
  createdAt: "2026-08-09T08:00:00.000Z"
};

function baseResponses(scenario: GrowthContractScenario) {
  return {
    "GET /api/v1/growth/bootstrap": {
      status: 200,
      headers: {},
      body: scenario.bootstrap
    },
    "GET /api/v1/acquisition/growth-performance": {
      status: 200,
      headers: {},
      body: scenario.performance
    },
    "GET /api/v1/acquisition/advisor/today": {
      status: 200,
      headers: {},
      body: scenario.advisorToday
    },
    "GET /api/v1/acquisition/cohorts": {
      status: 200,
      headers: {},
      body: { items: [COHORT_ROW], nextCursor: null }
    },
    "GET /api/v1/catalog/items": {
      status: 200,
      headers: {},
      body: {
        items: [{
          id: "catalog-1",
          workspaceId: "workspace-e2e",
          code: "PRODUCT-A",
          name: "标准产品",
          type: "product",
          status: "active",
          unit: "件",
          description: null,
          revision: 1,
          createdAt: "2026-08-09T08:00:00.000Z",
          updatedAt: "2026-08-09T08:00:00.000Z"
        }],
        nextCursor: null
      }
    },
    "GET /api/v1/catalog/pricing-policies": {
      status: 200,
      headers: {},
      body: { items: [], nextCursor: null }
    },
    "GET /api/v1/catalog/packages/catalog-1/versions": {
      status: 200,
      headers: {},
      body: { items: [], nextCursor: null }
    },
    "GET /api/v1/acquisition/cost-entries": {
      status: 200,
      headers: {},
      body: { items: scenario.costEntries, nextCursor: null }
    },
    "GET /api/v1/acquisition/cost-estimates": {
      status: 200,
      headers: {},
      body: { items: [], nextCursor: null }
    },
    "GET /api/v1/finance/facts": {
      status: 200,
      headers: {},
      body: { items: [], nextCursor: null }
    },
    "GET /api/v1/quotes/cases": {
      status: 200,
      headers: {},
      body: { items: [], nextCursor: null }
    },
    "GET /api/v1/quotes/cases/case-1": {
      status: 200,
      headers: {},
      body: {
        id: "case-1",
        workspaceId: "workspace-e2e",
        candidateId: "candidate-1",
        customerId: "customer-1",
        dealId: "deal-1",
        assignedTo: "sales-e2e",
        status: "open",
        currentDraftVersionId: null,
        revision: 4,
        bindingSnapshotId: null,
        createdAt: "2026-08-09T08:00:00.000Z",
        updatedAt: "2026-08-09T08:00:00.000Z"
      }
    },
    "GET /api/v1/quotes/cases/case-1/versions": {
      status: 200,
      headers: {},
      body: { items: [{
        id: "quote-v1",
        workspaceId: "workspace-e2e",
        quoteCaseId: "case-1",
        version: 1,
        versionKind: "draft",
        sourceDraftVersionId: null,
        status: "draft",
        lifecycleRevision: 1,
        currency: "CNY",
        quotedAmountMinor: 1_000_000,
        createdAt: "2026-08-09T08:00:00.000Z",
        updatedAt: "2026-08-09T08:00:00.000Z"
      }], nextCursor: null }
    },
    "POST /api/v1/acquisition/copilot/sessions": {
      status: 201,
      headers: {},
      body: scenario.copilotSession
    },
    "GET /api/v1/acquisition/copilot/sessions/advisor-session-1": {
      status: 200,
      headers: {},
      body: scenario.copilotSession
    },
    "GET /api/v1/acquisition/copilot/sessions/advisor-session-1/messages": {
      status: 200,
      headers: {},
      body: scenario.copilotMessages
    },
    "POST /api/v1/acquisition/copilot/sessions/advisor-session-1/messages": {
      status: 201,
      headers: {},
      body: { id: "advisor-message-2", taskId: "advisor-task-1" }
    },
    "GET /api/v1/acquisition/copilot/tasks/advisor-task-1": {
      status: 200,
      headers: {},
      body: scenario.copilotCompletedTask
    },
    "GET /api/v1/business-advisor/agents": {
      status: 200,
      headers: {},
      body: {
        items: [{
          id: "profit",
          name: "利润分析",
          title: "找出钱到底赚在哪",
          focus: ["产品利润", "假利润"],
          knowledgeBase: []
        }]
      }
    },
    "POST /api/v1/business-advisor/analyze": {
      status: 200,
      headers: {},
      body: {
        result: {
          products: [{
            name: "产品 A",
            grossMarginBps: 4_500,
            trueMarginBps: 0,
            isFakeProfit: true
          }],
          customers: [],
          cashflow: { warning: [] },
          cost: { anomaly: [] },
          tax: { level: "green", findings: [] },
          indicators: {}
        }
      }
    },
    "POST /api/v1/business-advisor/diagnose": {
      status: 200,
      headers: {},
      body: {
        report: {
          companyName: "示例贸易公司",
          period: "2026-08",
          healthScoreBps: 4_600,
          summary: "本期经营存在需要关注的问题。",
          issues: [{
            category: "利润",
            level: "red",
            title: "存在假利润产品",
            reason: "产品 A 扣除费用后真实利润率过低",
            risk: "假利润产品会虚增收入规模、掩盖真实盈利结构",
            suggestion: "调整定价或收缩产品线",
            evidence: ["假利润产品：产品 A"]
          }],
          actionPlan90Days: [
            { month: 1, action: "清理低质产品" },
            { month: 2, action: "调整报价" },
            { month: 3, action: "建立月度经营分析会" }
          ],
          evidence: ["假利润产品：产品 A"]
        }
      }
    },
    "POST /api/v1/business-advisor/statements/diagnose": {
      status: 200,
      headers: {},
      body: {
        companyName: "河南元能信息科技有限公司",
        period: "2026-06",
        warnings: ["未提供现金流量表，现金流预测与资金预警暂不可用"],
        input: {
          currency: "CNY",
          companyName: "河南元能信息科技有限公司",
          period: "2026-06",
          balanceSheet: {
            period: "2026-06",
            cashMinor: 11_035_683,
            receivablesMinor: 38_744_930,
            inventoryMinor: 0,
            otherCurrentAssetsMinor: 40_764_124,
            nonCurrentAssetsMinor: 5_045_745,
            currentLiabilitiesMinor: 198_622_389,
            nonCurrentLiabilitiesMinor: 0,
            accountsPayableMinor: 285_990
          },
          incomeStatement: {
            period: "2026-06",
            revenueMinor: 0,
            costOfGoodsSoldMinor: 5_551_587,
            operatingExpensesMinor: 9_431_587,
            interestExpenseMinor: 1_605,
            taxExpenseMinor: 0
          }
        },
        report: {
          companyName: "河南元能信息科技有限公司",
          period: "2026-06",
          healthScoreBps: 0,
          summary: "本期经营存在 6 个需要关注的问题。",
          issues: [{
            category: "财务",
            level: "red",
            title: "毛利为负",
            reason: "毛利率 -100.0%，收入无法覆盖直接成本",
            risk: "持续毛利为负会直接消耗现金",
            suggestion: "核对收入确认与成本归集口径，识别亏损业务线并限期改善",
            evidence: ["毛利率 -100.0%"]
          }],
          actionPlan90Days: [
            { month: 1, action: "收紧应收与库存，做一次现金流压力测试" },
            { month: 2, action: "调整报价与价格体系" },
            { month: 3, action: "建立月度经营分析会机制" }
          ],
          evidence: ["毛利率 -100.0%"]
        }
      }
    },
    "POST /api/v1/business-advisor/statements/import": {
      status: 200,
      headers: {},
      body: {
        imported: 2,
        failed: 0,
        companies: [{
          companyName: "河南元能信息科技有限公司",
          period: "2026-06",
          warnings: ["未提供现金流量表，现金流预测与资金预警暂不可用"],
          input: {
            currency: "CNY",
            companyName: "河南元能信息科技有限公司",
            period: "2026-06",
            balanceSheet: {
              period: "2026-06",
              cashMinor: 11_035_683,
              receivablesMinor: 38_744_930,
              inventoryMinor: 0,
              otherCurrentAssetsMinor: 40_764_124,
              nonCurrentAssetsMinor: 5_045_745,
              currentLiabilitiesMinor: 198_622_389,
              nonCurrentLiabilitiesMinor: 0,
              accountsPayableMinor: 285_990
            },
            incomeStatement: {
              period: "2026-06",
              revenueMinor: 0,
              costOfGoodsSoldMinor: 5_551_587,
              operatingExpensesMinor: 9_431_587,
              interestExpenseMinor: 1_605,
              taxExpenseMinor: 0
            }
          },
          report: {
            companyName: "河南元能信息科技有限公司",
            period: "2026-06",
            healthScoreBps: 0,
            summary: "本期经营存在 6 个需要关注的问题。",
            issues: [{
              category: "财务",
              level: "red",
              title: "毛利为负",
              reason: "毛利率 -100.0%，收入无法覆盖直接成本",
              risk: "持续毛利为负会直接消耗现金",
              suggestion: "核对收入确认与成本归集口径，识别亏损业务线并限期改善",
              evidence: ["毛利率 -100.0%"]
            }],
            actionPlan90Days: [
              { month: 1, action: "收紧应收与库存，做一次现金流压力测试" },
              { month: 2, action: "调整报价与价格体系" },
              { month: 3, action: "建立月度经营分析会机制" }
            ],
            evidence: ["毛利率 -100.0%"]
          }
        }, {
          companyName: "中原影视孵化器有限公司",
          period: "2026-06",
          warnings: ["未提供现金流量表，现金流预测与资金预警暂不可用"],
          input: {
            currency: "CNY",
            companyName: "中原影视孵化器有限公司",
            period: "2026-06",
            balanceSheet: {
              period: "2026-06",
              cashMinor: 5_077_311,
              receivablesMinor: 143_534_091,
              inventoryMinor: 0,
              otherCurrentAssetsMinor: 101_041_864,
              nonCurrentAssetsMinor: 55_950_300,
              currentLiabilitiesMinor: 193_460_225,
              nonCurrentLiabilitiesMinor: 100_000_000,
              accountsPayableMinor: 10_800_000
            },
            incomeStatement: {
              period: "2026-06",
              revenueMinor: 58_000_000,
              costOfGoodsSoldMinor: 30_000_000,
              operatingExpensesMinor: 14_600_000,
              interestExpenseMinor: 1_000_000,
              taxExpenseMinor: 3_100_000
            }
          },
          report: {
            companyName: "中原影视孵化器有限公司",
            period: "2026-06",
            healthScoreBps: 2_000,
            summary: "本期经营存在 4 个需要关注的问题。",
            issues: [{
              category: "财务",
              level: "red",
              title: "净利率过低",
              reason: "净利率 9.6%，低于 5% 警戒线",
              risk: "持续低净利率会侵蚀现金流与偿债能力",
              suggestion: "按 毛利率-期间费用率 拆解改善",
              evidence: ["净利率 9.6%"]
            }],
            actionPlan90Days: [
              { month: 1, action: "收紧应收与库存" },
              { month: 2, action: "调整报价" },
              { month: 3, action: "建立月度经营分析会机制" }
            ],
            evidence: ["净利率 9.6%"]
          }
        }]
      }
    }
  };
}

export function growthContractScenario(
  name: GrowthContractScenarioName
): GrowthContractScenario {
  const scenario: Omit<GrowthContractScenario, "responses"> & {
    responses: Record<string, GrowthMockResponse>;
  } = {
    name,
    bootstrap: name === "workspace_selection_required"
      ? selectionRequiredBootstrap
      : name === "contract_mismatch" ? mismatchBootstrap : readyBootstrap,
    performance: name === "roi_not_computable"
      ? notComputablePerformance
      : name === "sales_redacted"
        ? salesRedactedPerformance
        : happyPerformance,
    advisorToday,
    costEntries: verifiedCostEntries,
    importRowErrors: name === "finance_partial_import"
      ? importPreviewErrors : [],
    copilotSessionOperation: {
      kind: "copilot_session_creation",
      requestId: "request-session-1"
    },
    copilotSession,
    copilotMessages,
    copilotQueuedTask,
    copilotCompletedTask: name === "advisor_model_failed"
      ? copilotFailedTask : copilotCompletedTask,
    responses: {}
  };
  const responses: Record<string, GrowthMockResponse> = {
    ...baseResponses(scenario)
  };
  if (name === "finance_partial_import") {
    responses["POST /api/v1/finance/imports/preview"] = {
      status: 200,
      headers: {},
      body: {
        previewId: "preview-1",
        kind: "acquisition_cost",
        totalRows: 4,
        acceptedRows: 3,
        rejectedRows: 1,
        errors: scenario.importRowErrors,
        expiresAt: "2026-08-10T08:00:00.000Z"
      }
    };
    responses["POST /api/v1/finance/imports/preview-1/commit"] = {
      status: 200,
      headers: {},
      body: {
        id: "import-1",
        workspaceId: "workspace-e2e",
        kind: "acquisition_cost",
        status: "requires_review",
        totalRows: 4,
        acceptedRows: 3,
        rejectedRows: 1,
        createdAt: "2026-08-09T08:00:00.000Z",
        completedAt: null
      }
    };
  }
  if (name === "quote_conflict") {
    responses["POST /api/v1/quotes/versions/quote-v1/submit"] = {
      status: 412,
      headers: {},
      body: {
        code: "revision_conflict",
        message: "报价版本已变化",
        details: null,
        requestId: "quote-conflict-1",
        retryable: false
      }
    };
  }
  return Object.freeze({
    ...scenario,
    responses: Object.freeze(responses)
  });
}

export function responseFor(
  scenario: GrowthContractScenario,
  method: string,
  url: URL
): GrowthMockResponse {
  const key = `${method.toUpperCase()} ${url.pathname}`;
  const configured = scenario.responses[key];
  if (!configured) {
    return {
      status: 404,
      headers: {},
      body: {
        code: "resource_not_found",
        message: `No typed fixture for ${key}`,
        details: null,
        requestId: "growth-mock-missing",
        retryable: false
      } satisfies Schema<"ApiError">
    };
  }
  return {
    ...configured,
    status: scenario.statusOverrides?.[key] ?? configured.status
  };
}

const ROUTE_PATTERNS = [
  "**/api/v1/growth/**",
  "**/api/v1/catalog/**",
  "**/api/v1/quotes/**",
  "**/api/v1/finance/**",
  "**/api/v1/business-advisor/**",
  "**/api/v1/acquisition/cost-entries**",
  "**/api/v1/acquisition/cost-estimates**",
  "**/api/v1/acquisition/cohorts**",
  "**/api/v1/acquisition/roi-closures**",
  "**/api/v1/acquisition/growth-performance**",
  "**/api/v1/acquisition/advisor/**",
  "**/api/v1/acquisition/copilot/**"
] as const;

export interface InstalledGrowthScenario {
  readonly requests: readonly GrowthRequestRecord[];
  requestsFor(method: string, path: string): readonly GrowthRequestRecord[];
  dispose(): Promise<void>;
}

export async function installGrowthContractScenario(
  page: Page,
  scenario: GrowthContractScenario
): Promise<InstalledGrowthScenario> {
  const requests: GrowthRequestRecord[] = [];
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const postData = request.postDataBuffer();
    const body = postData === null
      ? null
      : (request.headers()["content-type"] ?? "").includes("application/json")
        ? JSON.parse(postData.toString("utf8"))
        : {
            mediaType: request.headers()["content-type"]
              ?? "application/octet-stream",
            base64: postData.toString("base64")
          };
    requests.push({
      method: request.method(),
      path: `${url.pathname}${url.search}`,
      headers: request.headers(),
      body
    });
    const response = responseFor(scenario, request.method(), url);
    await route.fulfill({
      status: response.status,
      headers: {
        "content-type": "application/json",
        ...response.headers
      },
      body: JSON.stringify(response.body)
    });
  };
  for (const pattern of ROUTE_PATTERNS) {
    await page.route(pattern, handler);
  }
  return Object.freeze({
    requests,
    requestsFor(method: string, path: string) {
      return requests.filter(
        (entry) => entry.method === method
          && entry.path.split("?")[0] === path
      );
    },
    async dispose() {
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

export async function enterRealGrowth(
  page: Page,
  route: GrowthPageName
): Promise<void> {
  await page.goto(`/#growth/${route}`);
  const control = page.getByRole("button", { name: "真实模式" });
  if (await control.isVisible()) await control.click();
}
