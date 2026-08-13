import {
  yuanToMinor,
  type BusinessReportInput
} from "./api";

export function sampleBusinessReport(): BusinessReportInput {
  const money = yuanToMinor;
  return {
    currency: "CNY",
    companyName: "示例贸易公司",
    period: "2026-08",
    balanceSheet: {
      period: "2026-08-31",
      cashMinor: money(800_000),
      receivablesMinor: money(1_200_000),
      inventoryMinor: money(900_000),
      otherCurrentAssetsMinor: money(100_000),
      nonCurrentAssetsMinor: money(500_000),
      currentLiabilitiesMinor: money(1_000_000),
      nonCurrentLiabilitiesMinor: money(300_000),
      accountsPayableMinor: money(700_000)
    },
    incomeStatement: {
      period: "2026-08",
      revenueMinor: money(5_000_000),
      costOfGoodsSoldMinor: money(3_000_000),
      operatingExpensesMinor: money(1_000_000),
      interestExpenseMinor: money(50_000),
      taxExpenseMinor: money(60_000),
      productLines: [
        {
          name: "产品 A",
          revenueMinor: money(2_000_000),
          costOfGoodsSoldMinor: money(1_100_000),
          afterSalesCostMinor: money(300_000),
          shippingCostMinor: money(200_000),
          sellingExpenseMinor: money(300_000),
          allocatedOverheadMinor: money(100_000)
        },
        {
          name: "产品 B",
          revenueMinor: money(3_000_000),
          costOfGoodsSoldMinor: money(1_900_000),
          afterSalesCostMinor: money(80_000),
          shippingCostMinor: money(100_000),
          sellingExpenseMinor: money(150_000),
          allocatedOverheadMinor: money(100_000)
        }
      ],
      customers: [
        {
          name: "大客户甲",
          revenueMinor: money(2_500_000),
          grossProfitMinor: money(600_000),
          serviceCostMinor: money(450_000),
          paymentDays: 120,
          outstandingReceivableMinor: money(1_000_000)
        },
        {
          name: "客户乙",
          revenueMinor: money(1_000_000),
          grossProfitMinor: money(350_000),
          serviceCostMinor: money(60_000),
          paymentDays: 30,
          outstandingReceivableMinor: money(100_000)
        }
      ]
    },
    cashFlow: {
      period: "2026-08",
      openingCashMinor: money(600_000),
      operatingInflowMinor: money(4_500_000),
      operatingOutflowMinor: money(3_900_000),
      investingNetMinor: 0,
      financingNetMinor: money(200_000),
      receivables: [
        {
          customer: "大客户甲",
          amountMinor: money(1_000_000),
          daysOutstanding: 120
        },
        {
          customer: "客户乙",
          amountMinor: money(100_000),
          daysOutstanding: 25
        }
      ],
      expectedInflowsNext30DaysMinor: money(800_000),
      expectedOutflowsNext30DaysMinor: money(1_100_000),
      expectedInflowsNext31To90DaysMinor: money(1_600_000),
      expectedOutflowsNext31To90DaysMinor: money(1_500_000)
    },
    costDetail: {
      materialCostRateBps: 4_200,
      previousMaterialCostRateBps: 3_500,
      laborCostMinor: money(400_000),
      rawMaterialCostMinor: money(2_100_000),
      salesCommissionRateBps: 500,
      fixedOverheadMinor: money(300_000)
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
