import {
  BUSINESS_AGENT_TEAM,
  businessAgentById,
  type BusinessAgent
} from "./agents";
import type {
  DiagnosisReport,
  ParsedCompanyResult
} from "./api";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function agentCard(agent: BusinessAgent, demo: boolean): string {
  const capabilities = agent.capabilities
    .map((item) => `<span class="agent-capability">${escapeHtml(item)}</span>`)
    .join("");
  const workbenchLink = demo
    ? `<a href="#growth/agents/${escapeHtml(agent.id)}"
         data-agents-demo-link="${escapeHtml(agent.id)}">进入工作台</a>`
    : `<a href="#growth/agents/${escapeHtml(agent.id)}">进入工作台</a>`;
  const status = agent.dataReady
    ? '<span class="agent-status agent-status-ready">数据就绪</span>'
    : '<span class="agent-status">待配置</span>';
  return `<article class="agent-card" data-agent-id="${escapeHtml(agent.id)}"
    style="--agent-accent:${agent.accent}">
    <header>
      <span class="agent-avatar" aria-hidden="true">${escapeHtml(agent.name.slice(0, 1))}</span>
      <div>
        <h3>${escapeHtml(agent.name)}</h3>
        <p>${escapeHtml(agent.title)}</p>
      </div>
      ${status}
    </header>
    <p class="agent-summary">${escapeHtml(agent.summary)}</p>
    <div class="agent-capabilities">${capabilities}</div>
    <footer>
      <span>知识库：${escapeHtml(agent.knowledgeBase)}</span>
      ${workbenchLink}
    </footer>
  </article>`;
}

export interface AgentsOverviewOptions {
  readonly sourceLabel?: string;
  readonly showImport?: boolean;
  readonly demo?: boolean;
  readonly healthScoreBps?: number;
  readonly sources?: readonly string[];
}

function healthScoreMarkup(healthScoreBps?: number): string {
  if (healthScoreBps === undefined) {
    return `<div class="health-score-ring is-pending"
      aria-label="企业健康评分待生成" role="img">
      <strong>待生成</strong>
      <span>健康评分</span>
    </div>`;
  }
  const score = Math.max(0, Math.min(100, Math.round(healthScoreBps / 100)));
  return `<div class="health-score-ring" style="--health-score:${score}%"
    aria-label="企业健康评分 ${score} 分" role="img">
    <strong>${score}</strong>
    <span>/ 100</span>
  </div>`;
}

function dataSourceBadges(sources: readonly string[] = []): string {
  if (sources.length === 0) {
    return '<span class="data-source-empty">尚未连接经营数据</span>';
  }
  return sources.map((source) =>
    `<span class="data-source-badge">${escapeHtml(source)}</span>`
  ).join("");
}

export function renderAgentsOverview(
  options: AgentsOverviewOptions = {}
): string {
  const cards = BUSINESS_AGENT_TEAM
    .map((agent) => agentCard(agent, options.demo === true))
    .join("");
  return `<section class="growth-panel agents-home">
    <header class="agents-hero">
      <div class="agents-hero-copy">
        <span class="agents-eyebrow">BUSINESS ADVISOR CENTER</span>
        <h2>AI 经营顾问团队</h2>
        <p>没有请 CFO 的老板，也能拥有一支虚拟经营管理团队。
          ${options.demo ? '<span class="demo-badge">演示数据</span>' : ""}
        </p>
      </div>
      <div class="agents-hero-actions">
        <button type="button" class="agents-primary"
          data-agents-action="generate-report">生成经营诊断报告</button>
      </div>
    </header>
    <section class="agents-overview-strip" aria-label="经营数据概览">
      ${healthScoreMarkup(options.healthScoreBps)}
      <div class="agents-source-overview">
        <div class="agents-source-heading">
          <div>
            <span class="agents-overline">当前数据源</span>
            <strong>${escapeHtml(options.sourceLabel ?? "示例数据")}</strong>
          </div>
          <span class="agents-source-count">${options.sources?.length ?? 0} 项已连接</span>
        </div>
        <div class="data-source-badges">${dataSourceBadges(options.sources)}</div>
      </div>
    </section>
    ${options.showImport !== false ? `<section class="statements-import">
      <header class="statements-import-heading">
        <div>
          <span class="agents-overline">STATEMENT IMPORT</span>
          <h3>上传真实报表（xls / xlsx）</h3>
          <p>选择资产负债表与利润表各一份，系统解析后直接生成经营诊断报告。</p>
        </div>
        <span class="statements-security">文件仅用于本次经营分析</span>
      </header>
      <div class="statements-import-fields">
        <label class="statement-dropzone" data-statements-drop="balance">
          <input class="statements-file-input" type="file" accept=".xls,.xlsx"
            data-statements-file="balance" />
          <span class="statement-file-type" aria-hidden="true">XLS</span>
          <span class="statement-file-copy">
            <strong>资产负债表</strong>
            <span>点击选择，或拖入 xls / xlsx 文件</span>
          </span>
          <span class="statement-file-name" data-statements-file-name="balance">
            未选择文件
          </span>
        </label>
        <label class="statement-dropzone" data-statements-drop="income">
          <input class="statements-file-input" type="file" accept=".xls,.xlsx"
            data-statements-file="income" />
          <span class="statement-file-type" aria-hidden="true">XLS</span>
          <span class="statement-file-copy">
            <strong>利润表</strong>
            <span>点击选择，或拖入 xls / xlsx 文件</span>
          </span>
          <span class="statement-file-name" data-statements-file-name="income">
            未选择文件
          </span>
        </label>
      </div>
      <div class="statements-import-status">
        <p data-statements-selection>已选择 0 / 2 份必需报表</p>
        <p class="statements-feedback" data-statements-feedback
          aria-live="polite" role="status"></p>
      </div>
      <div class="statements-import-actions">
        <button type="button" data-agents-action="statements-diagnose">
          解析并生成诊断报告
        </button>
        <button type="button" class="statements-sample" data-agents-action="sample-report">
          改用示例数据
        </button>
      </div>
      <p class="statements-source">
        当前数据源：${escapeHtml(options.sourceLabel ?? "示例数据")}
      </p>
    </section>` : ""}
    <div class="agents-grid">${cards}</div>
  </section>`;
}

export function renderAgentDetail(agentId: string): string {
  const agent = businessAgentById(agentId);
  if (!agent) {
    return `<section class="growth-panel"><p class="growth-error">
      未知智能体：${escapeHtml(agentId)}</p></section>`;
  }
  const capabilities = agent.capabilities
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  return `<section class="growth-panel agent-workbench">
    <a href="#growth/agents" class="agents-back">← 返回团队</a>
    <header style="--agent-accent:${agent.accent}">
      <span class="agent-avatar" aria-hidden="true">${escapeHtml(agent.name.slice(0, 1))}</span>
      <div>
        <h2>${escapeHtml(agent.name)}</h2>
        <p>${escapeHtml(agent.title)}</p>
      </div>
      <span class="agent-status ${agent.dataReady ? "agent-status-ready" : ""}">
        ${agent.dataReady ? "数据就绪" : "待配置"}
      </span>
    </header>
    <div class="agent-workbench-grid">
      <aside class="agent-info">
        <h3>职责</h3>
        <p>${escapeHtml(agent.summary)}</p>
        <h3>能力</h3>
        <ul>${capabilities}</ul>
        <h3>专属知识库</h3>
        <p>${escapeHtml(agent.knowledgeBase)}</p>
      </aside>
      <section class="agent-chat">
        <h3>向 ${escapeHtml(agent.name)} 提问</h3>
        <form data-agents-form="ask">
          <label for="agents-ask-input">例如：${escapeHtml(agentPromptExample(agent.id))}</label>
          <div class="agents-ask-row">
            <input id="agents-ask-input" name="question"
              placeholder="输入你的经营问题…" />
            <button type="submit">分析</button>
          </div>
        </form>
        <div class="agent-conclusion" data-agents-output>
          <p class="agent-conclusion-empty">输入问题后，这里会给出带来源引用的分析结论。</p>
        </div>
      </section>
      <aside class="agent-actions">
        <h3>可执行动作</h3>
        <button type="button" data-agents-action="create-todo">生成跟进待办</button>
        <button type="button" data-agents-action="open-report">查看经营诊断报告</button>
        <button type="button" data-agents-action="open-data">补充经营数据</button>
      </aside>
    </div>
  </section>`;
}

function agentPromptExample(id: string): string {
  switch (id) {
    case "profit":
      return "哪个产品是假利润？";
    case "cashflow":
      return "未来 30 天现金够不够？";
    case "cost":
      return "本月材料成本率为什么从 35% 涨到 42%？";
    case "tax":
      return "有哪些税务健康风险？";
    case "finance":
      return "公司财务健康吗？哪里在恶化？";
    default:
      return "今天最该先改什么？";
  }
}

function minorText(minor: number): string {
  return `${(minor / 100).toLocaleString("zh-CN", {
    maximumFractionDigits: 0
  })} 元`;
}

export interface DiagnosisReportOptions {
  readonly sourceLabel?: string;
  readonly warnings?: readonly string[];
}

export function renderCompanyPicker(
  companies: readonly ParsedCompanyResult[]
): string {
  const items = companies.map((company, index) => {
    if (company.error) {
      return `<li class="company-picker-item company-picker-row company-picker-error has-error">
        <div class="company-picker-row-main">
          <span class="company-picker-name">${escapeHtml(company.companyName)}</span>
          <span class="company-picker-period">${escapeHtml(company.period)}</span>
        </div>
        <span class="company-picker-status">解析失败</span>
        <p class="company-picker-error-text">${escapeHtml(company.error)}</p>
      </li>`;
    }
    return `<li class="company-picker-item company-picker-row">
      <div class="company-picker-row-main">
        <span class="company-picker-name">${escapeHtml(company.companyName)}</span>
        <span class="company-picker-period">${escapeHtml(company.period)}</span>
      </div>
      <span class="company-picker-status company-picker-ready">已就绪</span>
      <button type="button" data-agents-action="pick-company"
        data-company-index="${index}">查看诊断报告</button>
    </li>`;
  }).join("");
  return `<section class="growth-panel company-picker">
    <a href="#growth/agents" class="agents-back">← 返回团队</a>
    <header class="company-picker-heading">
      <div>
        <span class="agents-overline">COMPANY MATCHING</span>
        <h2>报表解析完成</h2>
        <p>选择一家已就绪公司查看经营诊断报告。</p>
      </div>
      <strong>${companies.length} 家公司</strong>
    </header>
    <ol class="company-picker-list">${items}</ol>
  </section>`;
}

export function renderDiagnosisReport(
  report: DiagnosisReport,
  options: DiagnosisReportOptions = {}
): string {
  const score = report.healthScoreBps;
  const issues = report.issues.map((item) =>
    `<li class="report-issue">
      <h4>
        <span class="issue-level issue-${escapeHtml(item.level)}">
          ${item.level === "red" ? "高风险" : "关注"}
        </span>
        ${item.category
          ? `<span class="issue-category">${escapeHtml(item.category)}</span>`
          : ""}
        ${escapeHtml(item.title)}
      </h4>
      <p>原因：${escapeHtml(item.reason)}</p>
      ${item.risk ? `<p>风险：${escapeHtml(item.risk)}</p>` : ""}
      <p>建议：${escapeHtml(item.suggestion)}</p>
      ${item.evidence.length > 0
        ? `<p class="report-evidence">来源：${item.evidence.map(escapeHtml).join("；")}</p>`
        : ""}
    </li>`).join("");
  const actions = report.actionPlan90Days.map((item) =>
    `<li>第 ${item.month} 月：${escapeHtml(item.action)}</li>`).join("");
  return `<section class="growth-panel diagnosis-report">
    <a href="#growth/agents" class="agents-back">← 返回团队</a>
    <header>
      <h2>《经营诊断报告》</h2>
      <p>${escapeHtml(report.companyName)} · ${escapeHtml(report.period)}</p>
      ${options.sourceLabel
        ? `<p class="report-source">数据源：${escapeHtml(options.sourceLabel)}</p>`
        : ""}
    </header>
    ${options.warnings && options.warnings.length > 0
      ? `<section class="report-block"><h3>数据说明</h3>
          <ul>${options.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>`
      : ""}
    <section class="report-score">
      <strong>${(score / 100).toFixed(0)}</strong>
      <span>企业健康评分（满分 100）</span>
    </section>
    <p class="report-summary">${escapeHtml(report.summary)}</p>
    <section class="report-block">
      <h3>问题清单（按优先级）</h3>
      <ol>${issues || "<li>本期未发现突出问题</li>"}</ol>
    </section>
    <section class="report-block">
      <h3>未来 90 天行动计划</h3>
      <ol>${actions}</ol>
    </section>
    ${report.evidence.length > 0
      ? `<section class="report-block"><h3>证据链</h3>
          <ul>${report.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>`
      : ""}
  </section>`;
}

export function renderAgentConclusion(html: string): string {
  return `<div class="agent-conclusion">${html}</div>`;
}

export function minorTextForConclusion(minor: number): string {
  return minorText(minor);
}
