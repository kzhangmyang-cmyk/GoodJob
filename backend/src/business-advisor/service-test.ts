import assert from "node:assert/strict";
import test from "node:test";
import {
  moneyYuanToMinor,
  type BusinessReportInput
} from "./domain.js";
import {
  createBusinessAdvisorService
} from "./service.js";

function sampleCompany(): BusinessReportInput {
  return {
    currency: "CNY",
    companyName: "示例贸易公司",
    period: "2026-08",
    balanceSheet: {
      period: "2026-08-31",
      cashMinor: moneyYuanToMinor(800_000),
      receivablesMinor: moneyYuanToMinor(1_200_000),
      inventoryMinor: moneyYuanToMinor(900_000),
      otherCurrentAssetsMinor: moneyYuanToMinor(100_000),
      nonCurrentAssetsMinor: moneyYuanToMinor(500_000),
      currentLiabilitiesMinor: moneyYuanToMinor(1_000_000),
      nonCurrentLiabilitiesMinor: moneyYuanToMinor(300_000),
      accountsPayableMinor: moneyYuanToMinor(700_000)
    },
    incomeStatement: {
      period: "2026-08",
      revenueMinor: moneyYuanToMinor(5_000_000),
      costOfGoodsSoldMinor: moneyYuanToMinor(3_000_000),
      operatingExpensesMinor: moneyYuanToMinor(1_000_000),
      interestExpenseMinor: moneyYuanToMinor(50_000),
      taxExpenseMinor: moneyYuanToMinor(60_000),
      productLines: [
        {
          name: "产品 A",
          revenueMinor: moneyYuanToMinor(2_000_000),
          costOfGoodsSoldMinor: moneyYuanToMinor(1_100_000),
          afterSalesCostMinor: moneyYuanToMinor(300_000),
          shippingCostMinor: moneyYuanToMinor(200_000),
          sellingExpenseMinor: moneyYuanToMinor(300_000),
          allocatedOverheadMinor: moneyYuanToMinor(100_000)
        },
        {
          name: "产品 B",
          revenueMinor: moneyYuanToMinor(3_000_000),
          costOfGoodsSoldMinor: moneyYuanToMinor(1_900_000),
          afterSalesCostMinor: moneyYuanToMinor(80_000),
          shippingCostMinor: moneyYuanToMinor(100_000),
          sellingExpenseMinor: moneyYuanToMinor(150_000),
          allocatedOverheadMinor: moneyYuanToMinor(100_000)
        }
      ],
      customers: [
        {
          name: "大客户甲",
          revenueMinor: moneyYuanToMinor(2_500_000),
          grossProfitMinor: moneyYuanToMinor(600_000),
          serviceCostMinor: moneyYuanToMinor(450_000),
          paymentDays: 120,
          outstandingReceivableMinor: moneyYuanToMinor(1_000_000)
        },
        {
          name: "客户乙",
          revenueMinor: moneyYuanToMinor(1_000_000),
          grossProfitMinor: moneyYuanToMinor(350_000),
          serviceCostMinor: moneyYuanToMinor(60_000),
          paymentDays: 30,
          outstandingReceivableMinor: moneyYuanToMinor(100_000)
        }
      ]
    },
    cashFlow: {
      period: "2026-08",
      openingCashMinor: moneyYuanToMinor(600_000),
      operatingInflowMinor: moneyYuanToMinor(4_500_000),
      operatingOutflowMinor: moneyYuanToMinor(3_900_000),
      investingNetMinor: 0,
      financingNetMinor: moneyYuanToMinor(200_000),
      receivables: [
        { customer: "大客户甲", amountMinor: moneyYuanToMinor(1_000_000), daysOutstanding: 120 },
        { customer: "客户乙", amountMinor: moneyYuanToMinor(100_000), daysOutstanding: 25 }
      ],
      expectedInflowsNext30DaysMinor: moneyYuanToMinor(800_000),
      expectedOutflowsNext30DaysMinor: moneyYuanToMinor(1_100_000),
      expectedInflowsNext31To90DaysMinor: moneyYuanToMinor(1_600_000),
      expectedOutflowsNext31To90DaysMinor: moneyYuanToMinor(1_500_000)
    },
    costDetail: {
      materialCostRateBps: 4_200,
      previousMaterialCostRateBps: 3_500,
      laborCostMinor: moneyYuanToMinor(400_000),
      rawMaterialCostMinor: moneyYuanToMinor(2_100_000),
      salesCommissionRateBps: 500,
      fixedOverheadMinor: moneyYuanToMinor(300_000)
    },
    taxRisk: {
      invoiceIssues: ["部分采购发票抬头与合同主体不一致"],
      revenueRecognitionIssues: [],
      costAuthenticityIssues: [],
      payrollIssues: [],
      equityIssues: []
    }
  };
}

test("the agent team registers six specialist roles with knowledge bases", () => {
  const service = createBusinessAdvisorService();
  assert.deepEqual(
    service.agents.map((agent) => agent.id),
    ["cfo", "finance", "profit", "cost", "cashflow", "tax"]
  );
  for (const agent of service.agents) {
    assert.equal(agent.knowledgeBase.agentId, agent.id);
    assert.equal(agent.knowledgeBase.entries.length > 0, true);
  }
});

test("analysis produces indicators, fake-profit flags, customer grades and cashflow warnings", () => {
  const service = createBusinessAdvisorService();
  const result = service.analyze(sampleCompany());
  assert.equal(result.indicators.grossMarginBps, 4_000);
  assert.equal(result.indicators.netMarginBps, 1_780);
  assert.equal(result.indicators.debtRatioBps, 3_714);

  const fake = result.products.find((product) => product.name === "产品 A");
  assert.ok(fake);
  assert.equal(fake.grossMarginBps, 4_500);
  assert.equal(fake.trueMarginBps, 0);
  assert.equal(fake.isFakeProfit, true);

  const gradeA = result.customers.find((customer) => customer.name === "客户乙");
  const gradeC = result.customers.find((customer) => customer.name === "大客户甲");
  assert.equal(gradeA?.grade, "A");
  assert.equal(gradeC?.grade, "C");

  assert.equal(result.cashflow.warning.length, 1);
  assert.equal(result.cashflow.projectedClosingCash30DaysMinor, moneyYuanToMinor(1_100_000));
  assert.equal(result.cost.anomaly.length, 1);
  assert.equal(result.tax.level, "red");
});

test("diagnose produces a sourced report with issues and a 90-day plan", () => {
  const service = createBusinessAdvisorService();
  const report = service.diagnose(sampleCompany());
  assert.equal(report.companyName, "示例贸易公司");
  assert.equal(report.period, "2026-08");
  assert.equal(report.healthScoreBps >= 0 && report.healthScoreBps <= 10_000, true);
  assert.equal(report.issues.length >= 3, true);
  assert.ok(report.issues.some((item) => item.title.includes("假利润")));
  assert.ok(report.issues.some((item) => item.title.includes("现金流")));
  assert.ok(report.issues.some((item) => item.title.includes("客户")));
  assert.equal(report.actionPlan90Days.length, 3);
  assert.deepEqual(report.actionPlan90Days.map((item) => item.month), [1, 2, 3]);
  assert.equal(report.evidence.length > 0, true);
  for (const item of report.issues) {
    assert.equal(item.reason.length > 0, true);
    assert.equal(item.suggestion.length > 0, true);
  }
});
