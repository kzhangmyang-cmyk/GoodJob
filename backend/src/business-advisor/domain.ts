export type BusinessCurrency = "CNY" | "USD";

export interface BalanceSheetInput {
  readonly period: string;
  readonly cashMinor: number;
  readonly receivablesMinor: number;
  readonly inventoryMinor: number;
  readonly otherCurrentAssetsMinor: number;
  readonly nonCurrentAssetsMinor: number;
  readonly currentLiabilitiesMinor: number;
  readonly nonCurrentLiabilitiesMinor: number;
  readonly accountsPayableMinor: number;
}

export interface ProductLineInput {
  readonly name: string;
  readonly revenueMinor: number;
  readonly costOfGoodsSoldMinor: number;
  readonly afterSalesCostMinor: number;
  readonly shippingCostMinor: number;
  readonly sellingExpenseMinor: number;
  readonly allocatedOverheadMinor: number;
}

export interface CustomerProfitInput {
  readonly name: string;
  readonly revenueMinor: number;
  readonly grossProfitMinor: number;
  readonly serviceCostMinor: number;
  readonly paymentDays: number;
  readonly outstandingReceivableMinor: number;
}

export interface IncomeStatementInput {
  readonly period: string;
  readonly revenueMinor: number;
  readonly costOfGoodsSoldMinor: number;
  readonly operatingExpensesMinor: number;
  readonly interestExpenseMinor: number;
  readonly taxExpenseMinor: number;
  readonly productLines?: readonly ProductLineInput[];
  readonly customers?: readonly CustomerProfitInput[];
}

export interface ReceivableInput {
  readonly customer: string;
  readonly amountMinor: number;
  readonly daysOutstanding: number;
}

export interface CashFlowInput {
  readonly period: string;
  readonly openingCashMinor: number;
  readonly operatingInflowMinor: number;
  readonly operatingOutflowMinor: number;
  readonly investingNetMinor: number;
  readonly financingNetMinor: number;
  readonly receivables?: readonly ReceivableInput[];
  readonly expectedInflowsNext30DaysMinor: number;
  readonly expectedOutflowsNext30DaysMinor: number;
  readonly expectedInflowsNext31To90DaysMinor: number;
  readonly expectedOutflowsNext31To90DaysMinor: number;
}

export interface CostDetailInput {
  readonly materialCostRateBps: number;
  readonly previousMaterialCostRateBps?: number;
  readonly laborCostMinor: number;
  readonly rawMaterialCostMinor: number;
  readonly salesCommissionRateBps: number;
  readonly fixedOverheadMinor: number;
}

export interface TaxRiskInput {
  readonly invoiceIssues: readonly string[];
  readonly revenueRecognitionIssues: readonly string[];
  readonly costAuthenticityIssues: readonly string[];
  readonly payrollIssues: readonly string[];
  readonly equityIssues: readonly string[];
}

export interface BusinessReportInput {
  readonly currency: BusinessCurrency;
  readonly companyName: string;
  readonly period: string;
  readonly balanceSheet: BalanceSheetInput;
  readonly incomeStatement: IncomeStatementInput;
  readonly cashFlow?: CashFlowInput;
  readonly costDetail?: CostDetailInput;
  readonly taxRisk?: TaxRiskInput;
}

export interface NormalizedBusinessReport {
  readonly currency: BusinessCurrency;
  readonly companyName: string;
  readonly period: string;
  readonly totalAssetsMinor: number;
  readonly totalLiabilitiesMinor: number;
  readonly equityMinor: number;
  readonly grossProfitMinor: number;
  readonly netProfitMinor: number;
  readonly closingCashMinor: number;
}

export function businessAdvisorError(
  code: string,
  message = code
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function requireNonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw businessAdvisorError("business_input_invalid", `${field} must be a non-negative integer`);
  }
  return value;
}

function requirePositive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw businessAdvisorError("business_input_invalid", `${field} must be a positive integer`);
  }
  return value;
}

function requireBps(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw businessAdvisorError("business_input_invalid", `${field} must be 0..10000 bps`);
  }
  return value;
}

export function normalizeBusinessReport(
  input: BusinessReportInput
): NormalizedBusinessReport {
  requirePositive(input.balanceSheet.period.length, "period");
  const assets = [
    input.balanceSheet.cashMinor,
    input.balanceSheet.receivablesMinor,
    input.balanceSheet.inventoryMinor,
    input.balanceSheet.otherCurrentAssetsMinor,
    input.balanceSheet.nonCurrentAssetsMinor
  ];
  const liabilities = [
    input.balanceSheet.currentLiabilitiesMinor,
    input.balanceSheet.nonCurrentLiabilitiesMinor
  ];
  for (const value of assets) requireNonNegative(value, "balanceSheet.assets");
  for (const value of liabilities) requireNonNegative(value, "balanceSheet.liabilities");
  requireNonNegative(input.balanceSheet.accountsPayableMinor, "balanceSheet.accountsPayable");
  requireNonNegative(input.incomeStatement.revenueMinor, "incomeStatement.revenue");
  requireNonNegative(input.incomeStatement.costOfGoodsSoldMinor, "incomeStatement.costOfGoodsSold");
  requireNonNegative(input.incomeStatement.operatingExpensesMinor, "incomeStatement.operatingExpenses");
  requireNonNegative(input.incomeStatement.interestExpenseMinor, "incomeStatement.interestExpense");
  requireNonNegative(input.incomeStatement.taxExpenseMinor, "incomeStatement.taxExpense");

  const totalAssetsMinor = assets.reduce((sum, value) => sum + value, 0);
  const totalLiabilitiesMinor = liabilities.reduce((sum, value) => sum + value, 0);
  const equityMinor = totalAssetsMinor - totalLiabilitiesMinor;
  const grossProfitMinor =
    input.incomeStatement.revenueMinor - input.incomeStatement.costOfGoodsSoldMinor;
  const netProfitMinor =
    grossProfitMinor
    - input.incomeStatement.operatingExpensesMinor
    - input.incomeStatement.interestExpenseMinor
    - input.incomeStatement.taxExpenseMinor;
  if (input.cashFlow) {
    requireNonNegative(input.cashFlow.openingCashMinor, "cashFlow.openingCash");
    requireNonNegative(input.cashFlow.operatingInflowMinor, "cashFlow.operatingInflow");
    requireNonNegative(input.cashFlow.operatingOutflowMinor, "cashFlow.operatingOutflow");
    const netOperatingMinor =
      input.cashFlow.operatingInflowMinor - input.cashFlow.operatingOutflowMinor;
    const closingCashMinor =
      input.cashFlow.openingCashMinor
      + netOperatingMinor
      + input.cashFlow.investingNetMinor
      + input.cashFlow.financingNetMinor;
    if (closingCashMinor < 0) {
      throw businessAdvisorError("business_cash_break", "期末现金为负，现金流勾稽不平");
    }
  }
  if (input.costDetail) {
    requireBps(input.costDetail.materialCostRateBps, "costDetail.materialCostRate");
    requireBps(input.costDetail.salesCommissionRateBps, "costDetail.salesCommissionRate");
    if (input.costDetail.previousMaterialCostRateBps !== undefined) {
      requireBps(
        input.costDetail.previousMaterialCostRateBps,
        "costDetail.previousMaterialCostRate"
      );
    }
  }
  return Object.freeze({
    currency: input.currency,
    companyName: input.companyName,
    period: input.period,
    totalAssetsMinor,
    totalLiabilitiesMinor,
    equityMinor,
    grossProfitMinor,
    netProfitMinor,
    closingCashMinor: input.cashFlow
      ? input.cashFlow.openingCashMinor
        + (input.cashFlow.operatingInflowMinor - input.cashFlow.operatingOutflowMinor)
        + input.cashFlow.investingNetMinor
        + input.cashFlow.financingNetMinor
      : input.balanceSheet.cashMinor
  });
}

export function moneyYuanToMinor(yuan: number): number {
  if (!Number.isFinite(yuan)) {
    throw businessAdvisorError("business_input_invalid", "金额必须是有限数值");
  }
  return Math.round(yuan * 100);
}

export function minorToYuan(minor: number): number {
  return minor / 100;
}
