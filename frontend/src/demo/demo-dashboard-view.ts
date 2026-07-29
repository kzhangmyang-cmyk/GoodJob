import type { DemoActivity, DemoModule, DemoState } from "./demo-types";
import { escapeHtml, formatMoney } from "./demo-ui";

type DashboardPeriod = "today" | "week" | "month";

const periods: Record<DashboardPeriod, { label: string; multiplier: number; note: string }> = {
  today: { label: "今日", multiplier: 1, note: "截至今日 16:45 的演示快照" },
  week: { label: "本周", multiplier: 4, note: "按本周节奏推演的演示快照" },
  month: { label: "本月", multiplier: 14, note: "按本月节奏推演的演示快照" }
};

const taskPriority = { "高": 0, "中": 1, "低": 2 } as const;
const activityMark: Record<DemoActivity["kind"], string> = {
  message: "对话",
  transfer: "私域",
  "follow-up": "跟进",
  opportunity: "商机",
  quote: "报价",
  stage: "阶段"
};

let activePeriod: DashboardPeriod = "today";

function scaledCount(value: number, multiplier: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value * multiplier));
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function actionButton(module: DemoModule, content: string, className = ""): string {
  return `<button type="button" class="${className}" data-demo-action="open-module" data-demo-module="${module}">${content}</button>`;
}

export function renderDashboardView(
  state: DemoState,
  main: HTMLElement,
  inspector: HTMLElement
): void {
  const period = periods[activePeriod];
  const activeConversations = state.conversations.filter((item) => item.mode !== "paused").length;
  const manualTakeover = state.conversations.filter((item) => item.mode === "manual" || item.mode === "paused").length;
  const expectedRevenue = state.opportunities.reduce((sum, item) => sum + item.amount * item.probability / 100, 0);
  const metrics: Array<{ label: string; value: string; module: DemoModule; hint: string }> = [
    { label: "今日发现", value: scaledCount(state.conversations.length, period.multiplier), module: "acquisition", hint: "来自全渠道的新增线索" },
    { label: "正在沟通", value: scaledCount(activeConversations, period.multiplier), module: "conversations", hint: "智能体与人工协同会话" },
    { label: "转入私域", value: scaledCount(state.customers.length, period.multiplier), module: "private-domain", hint: "已沉淀为可持续触达客户" },
    { label: "新建商机", value: scaledCount(state.opportunities.length, period.multiplier), module: "conversion", hint: "已进入成交工作台" },
    { label: "预计成交", value: formatMoney(expectedRevenue * period.multiplier), module: "conversion", hint: "按当前商机概率加权" },
    { label: "待人工接管", value: scaledCount(manualTakeover, period.multiplier), module: "conversations", hint: "需要顾问确认或继续跟进" }
  ];
  const funnel = [
    { label: "发现客户", value: state.conversations.length, module: "acquisition" as const },
    { label: "有效沟通", value: state.conversations.filter((item) => item.intent !== "低").length, module: "conversations" as const },
    { label: "进入私域", value: state.customers.length, module: "private-domain" as const },
    { label: "形成商机", value: state.opportunities.length, module: "conversion" as const }
  ];
  const priorityCustomers = [
    ...state.conversations
      .filter((item) => item.intent === "高")
      .map((item) => ({ name: item.customerName, platform: item.platform, summary: item.needSummary, module: "conversations" as const, updatedAt: item.updatedAt })),
    ...state.customers
      .filter((item) => item.intent === "高")
      .map((item) => ({ name: item.name, platform: item.platform, summary: item.needSummary, module: "private-domain" as const, updatedAt: item.lastContactAt }))
  ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 3);
  const tasks = state.tasks
    .filter((item) => !item.done)
    .sort((a, b) => taskPriority[a.priority] - taskPriority[b.priority] || a.title.localeCompare(b.title, "zh-CN"));
  const activities = [...state.activities]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);

  main.innerHTML = `
    <section class="demo-dashboard" aria-label="自动营销总览">
      <header class="demo-dashboard-header">
        <div>
          <span class="demo-status">自动营销总览</span>
          <h2>让每一次客户信号，都进入下一步</h2>
          <p>${period.note} · 所有数字均为本地演示数据。</p>
        </div>
        <div class="demo-period-tabs" role="group" aria-label="时间范围">
          ${Object.entries(periods).map(([key, item]) => `<button type="button" class="${activePeriod === key ? "active" : ""}" data-dashboard-period="${key}">${item.label}</button>`).join("")}
        </div>
      </header>

      <div class="demo-metric-rail">
        ${metrics.map((metric) => actionButton(metric.module, `<span>${metric.label}</span><strong>${metric.value}</strong><small>${metric.hint}</small>`, "demo-dashboard-metric")).join("")}
      </div>

      <section class="demo-panel demo-funnel-panel">
        <div class="demo-section-heading">
          <div><span class="demo-chip">业务转化</span><h3>今日业务漏斗</h3></div>
          <small>从识别到商机，逐步收敛高价值客户</small>
        </div>
        <div class="demo-funnel">
          ${funnel.map((item, index) => `${actionButton(item.module, `<span class="demo-funnel-step">0${index + 1}</span><b>${item.value}</b><span>${item.label}</span>`, "demo-funnel-item")}${index < funnel.length - 1 ? '<span class="demo-funnel-link" aria-hidden="true">→</span>' : ""}`).join("")}
        </div>
      </section>

      <div class="demo-dashboard-columns">
        <section class="demo-panel demo-priority-panel">
          <div class="demo-section-heading"><div><span class="demo-chip">高意向</span><h3>优先跟进客户</h3></div><small>${priorityCustomers.length} 位待推进</small></div>
          <div class="demo-priority-list">
            ${priorityCustomers.map((customer, index) => actionButton(customer.module, `<span class="demo-priority-index">0${index + 1}</span><span><b>${escapeHtml(customer.name)}</b><small>${escapeHtml(customer.platform)} · ${escapeHtml(customer.summary)}</small></span><span class="demo-arrow">→</span>`, "demo-priority-item")).join("")}
          </div>
        </section>
        <section class="demo-panel demo-task-panel">
          <div class="demo-section-heading"><div><span class="demo-chip">待办</span><h3>待处理任务</h3></div><small>按优先级排序</small></div>
          <div class="demo-task-list">
            ${tasks.map((task) => actionButton(task.module, `<span class="demo-task-priority priority-${task.priority}">${task.priority}</span><span>${escapeHtml(task.title)}</span><span class="demo-arrow">→</span>`, "demo-task-item")).join("")}
          </div>
        </section>
      </div>

      <section class="demo-panel demo-activity-panel">
        <div class="demo-section-heading"><div><span class="demo-chip">实时动态</span><h3>最近业务活动</h3></div><small>最新 ${activities.length} 条记录</small></div>
        <div class="demo-activity-rail">
          ${activities.map((activity) => `<article class="demo-activity-item"><span class="demo-activity-kind">${activityMark[activity.kind]}</span><b>${escapeHtml(activity.title)}</b><p>${escapeHtml(activity.detail)}</p><time>${formatActivityTime(activity.createdAt)}</time></article>`).join("")}
        </div>
      </section>
    </section>`;

  inspector.innerHTML = `
    <section class="demo-panel demo-dashboard-inspector">
      <span class="demo-chip">今日摘要</span>
      <h3>自动营销保持运行</h3>
      <p>当前有 <b>${activeConversations}</b> 个沟通会话、<b>${manualTakeover}</b> 个需要人工关注的节点，预计成交 ${formatMoney(expectedRevenue)}。</p>
      <div class="demo-inspector-note"><b>演示模式</b><span>数据只保存在当前浏览器，不会请求后端或发送真实消息。</span></div>
      <div class="demo-inspector-note"><b>重置提示</b><span>如需恢复初始演示数据，请在浏览器中清除本站点存储后刷新页面。</span></div>
    </section>`;

  main.querySelectorAll<HTMLButtonElement>("[data-dashboard-period]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPeriod = button.dataset.dashboardPeriod;
      if (nextPeriod === "today" || nextPeriod === "week" || nextPeriod === "month") {
        activePeriod = nextPeriod;
        renderDashboardView(state, main, inspector);
      }
    });
  });
}
