import type { GrowthHttpClient } from "../http";
import {
  createBusinessAdvisorApi,
  type BusinessAdvisorApi,
  type BusinessReportInput
} from "./api";
import { sampleBusinessReport } from "./sample";
import {
  renderAgentConclusion,
  renderAgentDetail,
  renderAgentsOverview,
  renderDiagnosisReport
} from "./view";
import { parseAgentsHash } from "./entry";

export interface AgentsControllerOptions {
  readonly http: GrowthHttpClient;
  readonly host: HTMLElement;
  readonly input?: BusinessReportInput;
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
  const api: BusinessAdvisorApi = createBusinessAdvisorApi(options.http);
  const input = options.input ?? sampleBusinessReport();
  let lastReport: import("./api").DiagnosisReport | null = null;
  let disposed = false;

  function renderView(): void {
    const route = parseAgentsHash(window.location.hash);
    if (route?.view === "detail") {
      options.host.innerHTML = renderAgentDetail(route.agentId);
    } else if (route?.view === "report" && lastReport) {
      options.host.innerHTML = renderDiagnosisReport(lastReport);
    } else {
      options.host.innerHTML = renderAgentsOverview();
    }
  }

  function onHashChange(): void {
    if (disposed) return;
    renderView();
  }

  async function handleReport(): Promise<void> {
    options.host.innerHTML = renderAgentConclusion("<p>正在生成经营诊断报告…</p>");
    try {
      const report = await api.diagnose(input);
      lastReport = report;
      options.host.innerHTML = renderDiagnosisReport(report);
    } catch (error) {
      options.host.innerHTML = renderAgentConclusion(
        `<p class="growth-error">生成失败：${escapeHtml(
          error instanceof Error ? error.message : String(error)
        )}</p>`
      );
    }
  }

  async function handleAsk(agentId: string, question: string): Promise<void> {
    const output = options.host.querySelector<HTMLElement>("[data-agents-output]");
    if (!output) return;
    output.innerHTML = renderAgentConclusion("<p>正在分析…</p>");
    try {
      if (agentId === "cfo") {
        const report = await api.diagnose(input);
        output.innerHTML = renderAgentConclusion(
          `<p>${escapeHtml(report.summary)}</p>`
          + `<a href="#growth/agents/report" class="agents-back">查看完整报告</a>`
        );
        return;
      }
      const result = await api.analyze(input) as AnalysisResult;
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
    const target = (event.target as HTMLElement | null)
      ?.closest<HTMLElement>("[data-agents-action], [data-agents-form]");
    if (!target || !options.host.contains(target)) return;
    const action = target.dataset.agentsAction;
    if (action === "generate-report" || action === "open-report") {
      void handleReport();
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
    const route = parseAgentsHash(window.location.hash);
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
