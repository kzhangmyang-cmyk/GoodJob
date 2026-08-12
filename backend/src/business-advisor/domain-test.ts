import assert from "node:assert/strict";
import test from "node:test";
import {
  businessAdvisorError,
  moneyYuanToMinor,
  normalizeBusinessReport,
  type BusinessReportInput
} from "./domain.js";

function validInput(): BusinessReportInput {
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
      taxExpenseMinor: moneyYuanToMinor(60_000)
    },
    cashFlow: {
      period: "2026-08",
      openingCashMinor: moneyYuanToMinor(600_000),
      operatingInflowMinor: moneyYuanToMinor(4_500_000),
      operatingOutflowMinor: moneyYuanToMinor(3_900_000),
      investingNetMinor: 0,
      financingNetMinor: moneyYuanToMinor(200_000),
      expectedInflowsNext30DaysMinor: moneyYuanToMinor(1_000_000),
      expectedOutflowsNext30DaysMinor: moneyYuanToMinor(1_300_000),
      expectedInflowsNext31To90DaysMinor: moneyYuanToMinor(2_000_000),
      expectedOutflowsNext31To90DaysMinor: moneyYuanToMinor(1_800_000)
    }
  };
}

test("money conversion keeps integer minor units", () => {
  assert.equal(moneyYuanToMinor(1), 100);
  assert.equal(moneyYuanToMinor(0.5), 50);
});

test("balanced statements normalize into derived totals", () => {
  const input = validInput();
  const normalized = normalizeBusinessReport(input);
  assert.equal(normalized.totalAssetsMinor, moneyYuanToMinor(3_500_000));
  assert.equal(normalized.totalLiabilitiesMinor, moneyYuanToMinor(1_300_000));
  assert.equal(normalized.equityMinor, moneyYuanToMinor(2_200_000));
  assert.equal(normalized.grossProfitMinor, moneyYuanToMinor(2_000_000));
  assert.equal(normalized.netProfitMinor, moneyYuanToMinor(890_000));
  assert.equal(normalized.closingCashMinor, moneyYuanToMinor(1_400_000));
});

test("negative equity breaks the balance sheet", () => {
  const input = validInput();
  input.balanceSheet.currentLiabilitiesMinor = moneyYuanToMinor(4_000_000);
  assert.throws(
    () => normalizeBusinessReport(input),
    (error: unknown) =>
      (error as { code?: string }).code === "business_balance_break"
  );
});

test("negative closing cash breaks the cashflow", () => {
  const input = validInput();
  input.cashFlow.operatingOutflowMinor = moneyYuanToMinor(9_000_000);
  assert.throws(
    () => normalizeBusinessReport(input),
    (error: unknown) =>
      (error as { code?: string }).code === "business_cash_break"
  );
});

test("domain errors carry stable codes", () => {
  const error = businessAdvisorError("business_input_invalid");
  assert.equal(error.code, "business_input_invalid");
});
