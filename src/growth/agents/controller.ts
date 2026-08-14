import type { GrowthHttpClient } from "../http";
import { createGrowthHttpClient } from "../http";
import * as XLSX from "xlsx";
import {
  createBusinessAdvisorApi,
  type BusinessAdvisorApi,
  type BusinessReportInput,
  type ParsedCompanyResult,
  type StatementSheet
} from "./api";
import {
  demoAnalysisResult,
  demoDiagnosisReport,
  sampleBusinessReport
} from "./sample";
import {
  renderCompanyPicker,
  renderAgentConclusion,
  renderAgentDetail,
  renderAgentsOverview,
  renderDiagnosisReport
} from "./view";
import { parseAgentsHash } from "./entry";

export interface AgentsControllerOptions {
  readonly http?: GrowthHttpClient;
  readonly host: HTMLElement;
  readonly input?: BusinessReportInput;
  readonly demo?: boolean;
}

export interface AgentsController {
  render(): void;
  dispose(): void;
}

interface AnalysisResult {
  readonly indicators?: {
    readonly grossMarginBps?: number;
    readonly netMarginBps?: number;
    readonly quickRatioBps?: number;
    readonly receivableTurnover?: number;
    readonly inventoryTurnover?: number;
    readonly interestCoverage?: number;
    readonly receivableDays?: number;
    readonly cashCoverageMonths?: number;
    readonly debtRatioBps?: number;
    readonly cashCollectionRatioBps?: number;
    readonly cashProfitRatioBps?: number;
  };
  readonly products?: readonly {
    readonly name: string;
    readonly grossMarginBps: number;
    readonly trueMarginBps: number;
    readonly isFakeProfit: boolean;
  }[];
  readonly customers?: readonly {
    readonly name: string;
    readonly grade: string;
    readonly paymentDays: number;
  }[];
  readonly cashflow?: {
    readonly warning: readonly string[];
  };
  readonly cost?: {
    readonly anomaly: readonly string[];
  };
  readonly tax?: {
    readonly level: string;
    readonly findings: readonly { category: string; issue: string; level: string }[];
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function bpsText(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function sourceBadgesForInput(input: BusinessReportInput): readonly string[] {
  return Object.freeze([
    "资产负债表",
    "利润表",
    "现金流量表",
    ...(input.costDetail ? ["成本明细"] : []),
    ...(input.taxRisk ? ["税务风险"] : [])
  ]);
}

function summarizeAnalysis(agentId: string, result: AnalysisResult): string {
  switch (agentId) {
    case "profit": {
      const fake = (result.products ?? []).filter((item) => item.isFakeProfit);
      const lines = (result.products ?? []).map((product) =>
        `<li>${escapeHtml(product.name)}：毛利率 ${bpsText(product.grossMarginBps)}，
          真实利润率 ${bpsText(product.trueMarginBps)}
          ${product.isFakeProfit ? "（假利润 ⚠）" : ""}</li>`).join("");
      return `<p>按“扣除售后/运费/销售费用后的真实利润”排序：</p>
        <ul>${lines || "<li>无产品明细</li>"}</ul>
        ${fake.length > 0
          ? `<p class="report-evidence">⚠ 假利润产品：${fake.map((item) => escapeHtml(item.name)).join("、")}。建议调整定价或压缩履约成本。</p>`
          : ""}`;
    }
    case "cashflow": {
      const warnings = (result.cashflow?.warning ?? []);
      return warnings.length > 0
        ? `<p class="growth-conflict">${warnings.map(escapeHtml).join("<br/>")}</p>`
        : "<p>未来 90 天现金预测健康。</p>";
    }
    case "cost": {
      const anomalies = (result.cost?.anomaly ?? []);
      return anomalies.length > 0
        ? `<p class="growth-conflict">${anomalies.map(escapeHtml).join("<br/>")}</p>`
        : "<p>未发现明显成本异常。</p>";
    }
    case "tax": {
      const tax = result.tax;
      if (!tax || tax.level === "green") {
        return "<p>未发现税务风险点。</p>";
      }
      const findings = (tax.findings ?? []).map((item) =>
        `<li>[${escapeHtml(item.level)}] ${escapeHtml(item.category)}：${escapeHtml(item.issue)}</li>`)
        .join("");
      return `<p class="growth-conflict">税务风险等级：${escapeHtml(tax.level)}</p><ul>${findings}</ul>`;
    }
    case "finance": {
      const indicators = result.indicators ?? {};
      return `<ul>
        <li>毛利率 ${bpsText(indicators.grossMarginBps ?? 0)}</li>
        <li>净利率 ${bpsText(indicators.netMarginBps ?? 0)}</li>
        <li>速动比率 ${indicators.quickRatioBps !== undefined
          ? (indicators.quickRatioBps / 100).toFixed(1)
          : "0"}</li>
        <li>应收周转天数 ${indicators.receivableDays ?? 0} 天</li>
        <li>应收账款周转率 ${indicators.receivableTurnover ?? 0} 次</li>
        <li>存货周转率 ${indicators.inventoryTurnover ?? 0} 次</li>
        <li>利息保障倍数 ${indicators.interestCoverage ?? 0} 倍</li>
        <li>现金保障月数 ${indicators.cashCoverageMonths ?? 0} 个月</li>
        <li>资产负债率 ${bpsText(indicators.debtRatioBps ?? 0)}</li>
        <li>收现比 ${bpsText(indicators.cashCollectionRatioBps ?? 0)}</li>
        <li>净现比 ${bpsText(indicators.cashProfitRatioBps ?? 0)}</li>
      </ul>`;
    }
    default:
      return "<p>请先生成经营诊断报告。</p>";
  }
}

export function createAgentsController(
  options: AgentsControllerOptions
): AgentsController {
  const api: BusinessAdvisorApi = createBusinessAdvisorApi(
    options.http ?? createGrowthHttpClient()
  );
  let activeInput = options.input ?? sampleBusinessReport();
  let lastReport: import("./api").DiagnosisReport | null = null;
  let sourceLabel = "示例数据";
  let importWarnings: readonly string[] = [];
  let importedCompanies: readonly ParsedCompanyResult[] = [];
  let demoRoute: { view: "overview" } | { view: "report" }
    | { view: "detail"; agentId: string } | null = null;
  let disposed = false;

  function renderView(): void {
    const route = options.demo
      ? demoRoute
      : parseAgentsHash(window.location.hash);
    if (options.demo) {
      if (route?.view === "detail") {
        options.host.innerHTML = renderAgentDetail(route.agentId);
      } else if (route?.view === "report" && lastReport) {
        options.host.innerHTML = renderDiagnosisReport(lastReport, {
          sourceLabel,
          warnings: importWarnings
        });
      } else {
        options.host.innerHTML = renderAgentsOverview({
          sourceLabel,
          showImport: false,
          demo: true,
          healthScoreBps: lastReport?.healthScoreBps
            ?? demoDiagnosisReport().healthScoreBps,
          sources: sourceBadgesForInput(activeInput)
        });
      }
      return;
    }
    if (route?.view === "detail") {
      options.host.innerHTML = renderAgentDetail(route.agentId);
    } else if (route?.view === "report" && lastReport) {
      options.host.innerHTML = renderDiagnosisReport(lastReport, {
        sourceLabel,
        warnings: importWarnings
      });
    } else {
      options.host.innerHTML = renderAgentsOverview({
        sourceLabel,
        healthScoreBps: lastReport?.healthScoreBps,
        sources: sourceBadgesForInput(activeInput)
      });
    }
  }

  function onHashChange(): void {
    if (disposed) return;
    renderView();
  }

  async function handleReport(): Promise<void> {
    options.host.innerHTML = renderAgentConclusion("<p>正在生成经营诊断报告…</p>");
    try {
      const report = options.demo
        ? demoDiagnosisReport()
        : await api.diagnose(activeInput);
      lastReport = report;
      if (options.demo) demoRoute = { view: "report" };
      options.host.innerHTML = renderDiagnosisReport(report, {
        sourceLabel,
        warnings: importWarnings
      });
    } catch (error) {
      options.host.innerHTML = renderAgentConclusion(
        `<p class="growth-error">生成失败：${escapeHtml(
          error instanceof Error ? error.message : String(error)
        )}</p>`
      );
    }
  }

  async function fileToSheets(file: File): Promise<readonly StatementSheet[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    if (workbook.SheetNames.length === 0) {
      throw new Error(`无法读取文件：${file.name}`);
    }
    return Object.freeze(workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (
        readonly (string | number | null)[]
      )[];
      return Object.freeze({
        name,
        rows: Object.freeze(rows)
      });
    }));
  }

  async function handleStatementsDiagnose(): Promise<void> {
    if (options.demo) {
      options.host.innerHTML = renderAgentConclusion(
        '<p class="growth-conflict">演示环境使用内置示例数据；登录真实环境后即可上传报表生成诊断。</p>'
      );
      return;
    }
    const balanceInput = options.host.querySelector<HTMLInputElement>(
      '[data-statements-file="balance"]'
    );
    const incomeInput = options.host.querySelector<HTMLInputElement>(
      '[data-statements-file="income"]'
    );
    const balanceFile = balanceInput?.files?.[0];
    const incomeFile = incomeInput?.files?.[0];
    if (!balanceFile || !incomeFile) {
      options.host.innerHTML = renderAgentConclusion(
        '<p class="growth-error">请先选择资产负债表和利润表各一份</p>'
      );
      return;
    }
    options.host.innerHTML = renderAgentConclusion(
      "<p>正在解析报表并生成诊断报告…</p>"
    );
    try {
      const [balanceSheets, incomeSheets] = await Promise.all([
        fileToSheets(balanceFile),
        fileToSheets(incomeFile)
      ]);
      const result = await api.importStatements([
        ...balanceSheets,
        ...incomeSheets
      ]);
      importedCompanies = result.companies;
      if (result.companies.length === 1 && result.companies[0].input) {
        showCompanyReport(result.companies[0]);
      } else if (result.companies.length === 0) {
        options.host.innerHTML = renderAgentConclusion(
          '<p class="growth-error">未识别到有效报表，请确认上传的是标准资产负债表与利润表</p>'
        );
      } else {
        options.host.innerHTML = renderCompanyPicker(result.companies);
      }
    } catch (error) {
      options.host.innerHTML = renderAgentConclusion(
        `<p class="growth-error">解析失败：${escapeHtml(
          error instanceof Error ? error.message : String(error)
        )}</p>`
      );
    }
  }

  function showCompanyReport(company: ParsedCompanyResult): void {
    if (!company.input || !company.report) {
      options.host.innerHTML = renderAgentConclusion(
        `<p class="growth-error">${escapeHtml(company.error ?? "该公司无法生成诊断")}</p>`
      );
      return;
    }
    sourceLabel = `${company.companyName} · ${company.period}`;
    importWarnings = company.warnings;
    activeInput = company.input;
    lastReport = company.report;
    options.host.innerHTML = renderDiagnosisReport(company.report, {
      sourceLabel,
      warnings: importWarnings
    });
  }

  async function handleAsk(agentId: string, question: string): Promise<void> {
    const output = options.host.querySelector<HTMLElement>("[data-agents-output]");
    if (!output) return;
    output.innerHTML = renderAgentConclusion("<p>正在分析…</p>");
    try {
      if (agentId === "cfo") {
        const report = options.demo
          ? demoDiagnosisReport()
          : await api.diagnose(activeInput);
        output.innerHTML = renderAgentConclusion(
          `<p>${escapeHtml(report.summary)}</p>`
          + `<a href="#growth/agents/report" class="agents-back">查看完整报告</a>`
        );
        return;
      }
      const result = options.demo
        ? demoAnalysisResult() as AnalysisResult
        : await api.analyze(activeInput) as AnalysisResult;
      output.innerHTML = renderAgentConclusion(
        `<p><strong>Q：${escapeHtml(question)}</strong></p>`
        + summarizeAnalysis(agentId, result)
      );
    } catch (error) {
      output.innerHTML = renderAgentConclusion(
        `<p class="growth-error">分析失败：${escapeHtml(
          error instanceof Error ? error.message : String(error)
        )}</p>`
      );
    }
  }

  function onClick(event: MouseEvent): void {
    if (disposed) return;
    const rawTarget = event.target as HTMLElement | null;
    if (options.demo && rawTarget) {
      const demoLink = rawTarget.closest<HTMLElement>("[data-agents-demo-link]");
      if (demoLink?.dataset.agentsDemoLink) {
        event.preventDefault();
        demoRoute = { view: "detail", agentId: demoLink.dataset.agentsDemoLink };
        renderView();
        return;
      }
      const backLink = rawTarget.closest<HTMLElement>("a.agents-back");
      if (backLink) {
        event.preventDefault();
        demoRoute = backLink.getAttribute("href")?.includes("agents/report")
          ? { view: "report" }
          : { view: "overview" };
        renderView();
        return;
      }
    }
    const target = (event.target as HTMLElement | null)
      ?.closest<HTMLElement>("[data-agents-action], [data-agents-form]");
    if (!target || !options.host.contains(target)) return;
    const action = target.dataset.agentsAction;
    if (action === "generate-report" || action === "open-report") {
      void handleReport();
      return;
    }
    if (action === "statements-diagnose") {
      void handleStatementsDiagnose();
      return;
    }
    if (action === "sample-report") {
      sourceLabel = "示例数据";
      importWarnings = [];
      const sample = sampleBusinessReport();
      void (async () => {
        options.host.innerHTML = renderAgentConclusion(
          "<p>正在用示例数据生成诊断报告…</p>"
        );
        try {
          const report = await api.diagnose(sample);
          lastReport = report;
          options.host.innerHTML = renderDiagnosisReport(report, {
            sourceLabel,
            warnings: importWarnings
          });
        } catch (error) {
          options.host.innerHTML = renderAgentConclusion(
            `<p class="growth-error">生成失败：${escapeHtml(
              error instanceof Error ? error.message : String(error)
            )}</p>`
          );
        }
      })();
      return;
    }
    if (action === "pick-company") {
      const index = Number(target.dataset.companyIndex);
      const company = importedCompanies[index];
      if (company) showCompanyReport(company);
      return;
    }
    if (action === "create-todo") {
      window.dispatchEvent(new CustomEvent("goodjob:todo-create-requested", {
        detail: { source: "business-advisor" }
      }));
      return;
    }
    if (action === "open-data") {
      window.location.hash = "#growth/finance";
      return;
    }
  }

  function onSubmit(event: SubmitEvent): void {
    if (disposed) return;
    const form = event.target as HTMLFormElement | null;
    if (form?.dataset?.agentsForm !== "ask") return;
    event.preventDefault();
    const route = options.demo
      ? demoRoute
      : parseAgentsHash(window.location.hash);
    if (!route || route.view !== "detail") return;
    const questionInput = form.querySelector<HTMLInputElement>(
      'input[name="question"]'
    );
    const question = questionInput?.value.trim() || "请分析本期经营";
    void handleAsk(route.agentId, question);
  }

  renderView();
  options.host.addEventListener("click", onClick);
  options.host.addEventListener("submit", onSubmit);
  window.addEventListener("hashchange", onHashChange);

  return Object.freeze({
    render: renderView,
    dispose() {
      disposed = true;
      options.host.removeEventListener("click", onClick);
      options.host.removeEventListener("submit", onSubmit);
      window.removeEventListener("hashchange", onHashChange);
    }
  });
}
