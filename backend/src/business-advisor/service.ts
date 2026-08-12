import {
  normalizeBusinessReport,
  type BusinessReportInput
} from "./domain.js";
import {
  analyzeCashflow,
  analyzeCost,
  analyzeCustomerProfit,
  analyzeFinancialIndicators,
  analyzeProductProfit,
  analyzeTaxRisk,
  minorToYuanText,
  type CostAnalysis,
  type CustomerProfitClass,
  type FinancialIndicators,
  type ProductTrueProfit,
  type TaxRiskLevel
} from "./analysis.js";
import {
  standardAgentKnowledgeBase,
  type AgentKnowledgeBase
} from "./knowledge.js";

export type BusinessAdvisorRole =
  | "cfo"
  | "finance"
  | "profit"
  | "cost"
  | "cashflow"
  | "tax";

export interface BusinessAdvisorAgent {
  readonly id: BusinessAdvisorRole;
  readonly name: string;
  readonly title: string;
  readonly knowledgeBase: AgentKnowledgeBase;
  readonly focus: readonly string[];
}

export interface BusinessAnalysisResult {
  readonly indicators: FinancialIndicators;
  readonly products: readonly ProductTrueProfit[];
  readonly customers: readonly CustomerProfitClass[];
  readonly cashflow: ReturnType<typeof analyzeCashflow>;
  readonly cost: CostAnalysis;
  readonly tax: TaxRiskLevel;
}

export interface DiagnosisIssue {
  readonly title: string;
  readonly reason: string;
  readonly suggestion: string;
  readonly evidence: readonly string[];
}

export interface DiagnosisReport {
  readonly companyName: string;
  readonly period: string;
  readonly healthScoreBps: number;
  readonly summary: string;
  readonly issues: readonly DiagnosisIssue[];
  readonly actionPlan90Days: readonly {
    readonly month: 1 | 2 | 3;
    readonly action: string;
  }[];
  readonly evidence: readonly string[];
}

export interface BusinessAdvisorService {
  readonly agents: readonly BusinessAdvisorAgent[];
  analyze(input: BusinessReportInput): BusinessAnalysisResult;
  diagnose(input: BusinessReportInput): DiagnosisReport;
}

function issue(
  title: string,
  reason: string,
  suggestion: string,
  evidence: readonly string[]
): DiagnosisIssue {
  return Object.freeze({
    title,
    reason,
    suggestion,
    evidence: Object.freeze(evidence)
  });
}

export function createBusinessAdvisorService(): BusinessAdvisorService {
  const agents: readonly BusinessAdvisorAgent[] = Object.freeze([
    Object.freeze({
      id: "cfo",
      name: "AI 经营总管",
      title: "老板身边的虚拟 CFO",
      knowledgeBase: standardAgentKnowledgeBase("cfo"),
      focus: Object.freeze(["综合诊断", "健康评分", "90 天行动"])
    }),
    Object.freeze({
      id: "finance",
      name: "财务分析",
      title: "企业财务健康检查医生",
      knowledgeBase: standardAgentKnowledgeBase("finance"),
      focus: Object.freeze(["三大报表", "盈利能力", "运营效率", "安全能力"])
    }),
    Object.freeze({
      id: "profit",
      name: "利润分析",
      title: "找出钱到底赚在哪",
      knowledgeBase: standardAgentKnowledgeBase("profit"),
      focus: Object.freeze(["产品利润", "客户 ABC", "假利润", "改善模拟"])
    }),
    Object.freeze({
      id: "cost",
      name: "成本分析",
      title: "降本增效专家",
      knowledgeBase: standardAgentKnowledgeBase("cost"),
      focus: Object.freeze(["成本结构", "异常提醒", "降本方案"])
    }),
    Object.freeze({
      id: "cashflow",
      name: "现金流分析",
      title: "企业资金安全管家",
      knowledgeBase: standardAgentKnowledgeBase("cashflow"),
      focus: Object.freeze(["现金预测", "应收分析", "资金预警"])
    }),
    Object.freeze({
      id: "tax",
      name: "税务健康",
      title: "税务风险体检（非避税）",
      knowledgeBase: standardAgentKnowledgeBase("tax"),
      focus: Object.freeze(["发票", "收入确认", "成本真实性", "个税", "股权"])
    })
  ]);

  function analyze(input: BusinessReportInput): BusinessAnalysisResult {
    const normalized = normalizeBusinessReport(input);
    return Object.freeze({
      indicators: analyzeFinancialIndicators(input, normalized),
      products: analyzeProductProfit(input),
      customers: analyzeCustomerProfit(input),
      cashflow: analyzeCashflow(input, normalized.closingCashMinor),
      cost: analyzeCost(input),
      tax: analyzeTaxRisk(input)
    });
  }

  function diagnose(input: BusinessReportInput): DiagnosisReport {
    const normalized = normalizeBusinessReport(input);
    const result = analyze(input);
    const issues: DiagnosisIssue[] = [];
    const evidence: string[] = [];
    const indicators = result.indicators;

    if (indicators.netMarginBps < 800) {
      issues.push(issue(
        "净利率偏低",
        `净利率 ${(indicators.netMarginBps / 100).toFixed(1)}%，低于健康线 8%`,
        "优先从产品结构、费用与成本三处找改善空间",
        [`净利率 ${(indicators.netMarginBps / 100).toFixed(1)}%`]
      ));
      evidence.push(`净利率 ${(indicators.netMarginBps / 100).toFixed(1)}%`);
    }
    if (result.products.some((product) => product.isFakeProfit)) {
      const fake = result.products.filter((product) => product.isFakeProfit)
        .map((product) => product.name).join("、");
      issues.push(issue(
        "存在假利润产品",
        `${fake} 毛利尚可，但扣除售后/运费/销售费用后真实利润率过低`,
        "调整定价、压缩履约成本，或逐步收缩该产品线",
        [`假利润产品：${fake}`]
      ));
      evidence.push(`假利润产品：${fake}`);
    }
    if (result.customers.some((customer) => customer.grade === "C")) {
      const cCustomers = result.customers
        .filter((customer) => customer.grade === "C")
        .map((customer) => customer.name).join("、");
      issues.push(issue(
        "存在低质客户",
        `${cCustomers} 真实利润率低或回款超过 90 天`,
        "评估淘汰或重新议价，收紧账期",
        [`C 类客户：${cCustomers}`]
      ));
      evidence.push(`C 类客户：${cCustomers}`);
    }
    if (result.cashflow.warning.length > 0) {
      issues.push(issue(
        "现金流预警",
        result.cashflow.warning.join("；"),
        "压缩应收与库存、重排付款优先级，必要时补充短期资金",
        [...result.cashflow.warning]
      ));
      evidence.push(...result.cashflow.warning);
    }
    if (result.cost.anomaly.length > 0) {
      issues.push(issue(
        "成本异常",
        result.cost.anomaly.join("；"),
        "核查原材料涨价、采购异常与产品结构变化",
        [...result.cost.anomaly]
      ));
      evidence.push(...result.cost.anomaly);
    }
    if (result.tax.level === "red") {
      issues.push(issue(
        "税务风险红色预警",
        `发现 ${result.tax.redCount} 项风险点`,
        "立即交由执业税务师复核并整改",
        result.tax.findings.map(
          (finding) => `${finding.category}: ${finding.issue}`
        )
      ));
      evidence.push(`税务红色风险 ${result.tax.redCount} 项`);
    }

    const healthScoreBps = Math.max(
      0,
      Math.min(
        10_000,
        5_000
        + Math.max(-2_500, (indicators.netMarginBps - 800) * 20)
        + (result.products.some((item) => item.isFakeProfit) ? -1_000 : 0)
        + (result.customers.some((item) => item.grade === "C") ? -800 : 0)
        + (result.cashflow.warning.length > 0 ? -1_200 : 0)
        + (result.cost.anomaly.length > 0 ? -500 : 0)
        + (result.tax.level === "red" ? -1_000
          : result.tax.level === "yellow" ? -300 : 0)
      )
    );
    const topIssues = issues.slice(0, 3);
    const summary = topIssues.length === 0
      ? "整体经营稳健，建议维持当前节奏并滚动做月度复盘。"
      : `本期经营存在 ${topIssues.length} 个需要关注的问题，详见下方诊断。`;
    const actionPlan90Days: DiagnosisReport["actionPlan90Days"] = [
      {
        month: 1,
        action: topIssues.some((item) => item.title.includes("客户"))
          ? "清理低质客户：重新议价或收缩账期"
          : topIssues.some((item) => item.title.includes("利润"))
            ? "启动产品结构梳理：识别并处理假利润产品"
            : "收紧应收与库存，做一次现金流压力测试"
      },
      {
        month: 2,
        action: topIssues.some((item) => item.title.includes("成本"))
          ? "执行成本优化：核查采购与费用，落实降本方案"
          : "调整报价与价格体系，按 A/B/C 客户差异化定价"
      },
      {
        month: 3,
        action: "建立月度经营分析会机制，滚动跟踪健康评分与行动项"
      }
    ];
    return Object.freeze({
      companyName: normalized.companyName,
      period: normalized.period,
      healthScoreBps,
      summary,
      issues: Object.freeze(topIssues),
      actionPlan90Days: Object.freeze(actionPlan90Days),
      evidence: Object.freeze(evidence)
    });
  }

  return Object.freeze({
    agents,
    analyze,
    diagnose
  });
}

export { minorToYuanText };
