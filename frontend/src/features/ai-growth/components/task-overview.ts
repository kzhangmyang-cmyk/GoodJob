import type { ProviderConnectionDto } from "../api.js";
import type {
  AcquisitionRunStatus,
  AcquisitionTaskDetailDto,
  AcquisitionTaskDiscoveryMethod,
  AcquisitionTaskOverviewDto,
  AcquisitionTaskSummaryDto,
  AdvisorMode
} from "../types.js";
import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

export type AiGrowthRoute =
  | { name: "overview" }
  | { name: "new" }
  | { name: "task"; planId: string };

export type TaskOverviewStatus =
  | "loading"
  | "ready"
  | "empty"
  | "partial_error"
  | "error"
  | "demo";

export interface TaskOverviewVm {
  mode: AdvisorMode;
  status: TaskOverviewStatus;
  tasks: readonly AcquisitionTaskSummaryDto[];
  totals: AcquisitionTaskOverviewDto["totals"];
  statusCounts: AcquisitionTaskOverviewDto["statusCounts"];
  discoveryMethodCounts: AcquisitionTaskOverviewDto["discoveryMethodCounts"];
  aggregationSource: "overview" | "task_list" | "none";
  connections: readonly ProviderConnectionDto[];
  connectionStatus: "loading" | "ready" | "error";
  generatedAt: string | null;
  errorMessage: string | null;
}

export interface TaskOverviewCallbacks {
  onCreateTask(): void;
  onOpenTask(planId: string): void;
  onRetry(): void;
}

export interface TaskDetailVm {
  status: "loading" | "ready" | "error";
  detail: AcquisitionTaskDetailDto | null;
  runStatus: AcquisitionRunStatus | null;
  errorMessage: string | null;
}

export interface TaskDetailCallbacks {
  onBack(): void;
  onRetry(planId: string): void;
}

const RUN_LABELS: Readonly<Record<AcquisitionRunStatus, string>> = {
  queued: "等待执行",
  running: "正在执行",
  pause_requested: "正在暂停",
  paused: "已暂停",
  cancel_requested: "正在取消",
  cancelled: "已取消",
  succeeded: "已完成",
  succeeded_empty: "已完成 · 无结果",
  partial_success: "部分完成",
  failed: "执行失败",
  budget_exhausted: "预算已用完"
};

const DISCOVERY_LABELS: Readonly<
  Record<AcquisitionTaskDiscoveryMethod, string>
> = {
  public_search: "公开搜索",
  user_import: "用户导入",
  official_authorized: "官方授权"
};

export type AcquisitionRunOperationalBucket =
  | "active"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "budget_exhausted";

export function classifyAcquisitionRunStatus(
  status: AcquisitionRunStatus
): AcquisitionRunOperationalBucket {
  switch (status) {
    case "queued":
    case "running":
    case "pause_requested":
    case "paused":
    case "cancel_requested":
      return "active";
    case "succeeded":
    case "succeeded_empty":
      return "completed";
    case "partial_success":
      return "partial";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "budget_exhausted":
      return "budget_exhausted";
    default: {
      const exhaustiveStatus: never = status;
      throw new Error(`Unknown acquisition run status: ${exhaustiveStatus}`);
    }
  }
}

export function deriveTaskOverviewAggregates(
  tasks: readonly AcquisitionTaskSummaryDto[]
): Pick<
  TaskOverviewVm,
  "totals" | "statusCounts" | "discoveryMethodCounts"
> {
  const statusCounts: AcquisitionTaskOverviewDto["statusCounts"] = {};
  const discoveryMethodCounts:
    AcquisitionTaskOverviewDto["discoveryMethodCounts"] = {};
  for (const task of tasks) {
    const status = task.latestRun?.status ?? "not_started";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    for (const method of task.discoveryMethods) {
      discoveryMethodCounts[method] =
        (discoveryMethodCounts[method] ?? 0) + 1;
    }
  }
  return {
    totals: { tasks: tasks.length },
    statusCounts,
    discoveryMethodCounts
  };
}

export function parseAiGrowthHash(hash: string): AiGrowthRoute {
  if (hash === "#ai-growth/new") return { name: "new" };
  const prefix = "#ai-growth/task/";
  if (hash.startsWith(prefix)) {
    try {
      const planId = decodeURIComponent(hash.slice(prefix.length));
      if (planId) return { name: "task", planId };
    } catch {
      return { name: "overview" };
    }
  }
  return { name: "overview" };
}

export function buildAiGrowthHash(route: AiGrowthRoute): string {
  if (route.name === "new") return "#ai-growth/new";
  if (route.name === "task") {
    return `#ai-growth/task/${encodeURIComponent(route.planId)}`;
  }
  return "#ai-growth";
}

function metricCounts(vm: TaskOverviewVm) {
  const evidence = vm.tasks.reduce(
    (total, task) => total + (task.latestRun?.evidenceCount ?? 0),
    0
  );
  let active = 0;
  let completed = 0;
  let partial = 0;
  let failed = 0;
  let cancelled = 0;
  let budgetExhausted = 0;
  const statuses: readonly AcquisitionRunStatus[] = [
    "queued",
    "running",
    "pause_requested",
    "paused",
    "cancel_requested",
    "cancelled",
    "succeeded",
    "succeeded_empty",
    "partial_success",
    "failed",
    "budget_exhausted"
  ];
  for (const status of statuses) {
    const count = vm.statusCounts[status] ?? 0;
    switch (classifyAcquisitionRunStatus(status)) {
      case "active":
        active += count;
        break;
      case "completed":
        completed += count;
        break;
      case "partial":
        partial += count;
        break;
      case "failed":
        failed += count;
        break;
      case "cancelled":
        cancelled += count;
        break;
      case "budget_exhausted":
        budgetExhausted += count;
        break;
    }
  }
  return {
    evidence,
    active,
    completed,
    partial,
    failed,
    cancelled,
    budgetExhausted,
    notStarted: vm.statusCounts.not_started ?? 0
  };
}

function connectionHealth(vm: TaskOverviewVm): string {
  if (vm.connectionStatus === "loading") return "来源健康检查中";
  if (vm.connectionStatus === "error") return "来源健康状态不可用";
  const active = vm.connections.filter((item) =>
    item.kind === "search" && item.status === "active"
  ).length;
  return active > 0 ? `已连接 · ${active} 个搜索来源` : "需配置";
}

function platformCards(vm: TaskOverviewVm): string {
  const health = connectionHealth(vm);
  const pending = ["快手", "微信公众号", "微博", "小红书"]
    .map((name) => `
      <article class="ai-growth-platform-card is-pending">
        <span aria-hidden="true">·</span>
        <div><strong>${name}</strong><small>待接入</small></div>
      </article>
    `).join("");
  return `
    <div class="ai-growth-platform-grid" aria-label="获客平台">
      <article class="ai-growth-platform-card is-active">
        <span aria-hidden="true">抖</span>
        <div>
          <strong>抖音 · 公开搜索</strong>
          <small>${escapeHtml(health)}</small>
        </div>
      </article>
      ${pending}
    </div>
  `;
}

function taskRows(tasks: readonly AcquisitionTaskSummaryDto[]): string {
  return tasks.map((task) => {
    const run = task.latestRun;
    const methods = task.discoveryMethods.length > 0
      ? task.discoveryMethods.map((method) => DISCOVERY_LABELS[method]).join(" · ")
      : "待确认";
    const planLabel = task.planStatus === "approved"
      ? "已批准"
      : task.planStatus === "archived" ? "已归档" : "草稿";
    return `
      <tr>
        <td><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.objective)}</small></td>
        <td><span class="ai-growth-task-status" data-tone="plan">${planLabel}</span></td>
        <td><span class="ai-growth-task-status" data-tone="${run?.status ?? "not_started"}">${run ? RUN_LABELS[run.status] : "尚未启动"}</span></td>
        <td>${escapeHtml(methods)}</td>
        <td>${run?.evidenceCount ?? 0}</td>
        <td><time datetime="${escapeHtml(task.updatedAt)}">${escapeHtml(new Date(task.updatedAt).toLocaleString("zh-CN"))}</time></td>
        <td><button type="button" class="ai-growth-text-action" data-action="open-task" data-plan-id="${escapeHtml(task.planId)}">打开任务</button></td>
      </tr>
    `;
  }).join("");
}

export function renderTaskOverview(
  vm: TaskOverviewVm,
  callbacks: TaskOverviewCallbacks
): ComponentRender<TaskOverviewCallbacks> {
  const counts = metricCounts(vm);
  const settled = counts.completed + counts.partial + counts.failed
    + counts.cancelled + counts.budgetExhausted + counts.notStarted;
  const modeNotice = vm.mode === "demo" || vm.status === "demo"
    ? `<div class="ai-growth-overview-notice" data-tone="demo" role="status"><strong>演示模式 · 演示数据</strong><span>仅用于预览；未经现有批准流程，不会调用正式获客写接口。</span></div>`
    : "";
  const errorNotice = vm.errorMessage
    ? `<div class="ai-growth-overview-notice" data-tone="${vm.status === "error" ? "error" : "warning"}" role="alert"><strong>${vm.status === "error" ? "任务数据加载失败" : "部分数据加载失败"}</strong><span>${escapeHtml(vm.errorMessage)}</span>${vm.status === "error" ? `<button type="button" class="ai-growth-button ai-growth-button--quiet ai-growth-button--compact" data-action="retry-overview">重试</button>` : ""}</div>`
    : "";
  const aggregationNotice = vm.aggregationSource === "task_list"
    ? `<div class="ai-growth-overview-notice" data-tone="warning" role="status"><strong>聚合总览不可用，指标按任务列表降级计算</strong><span>任务行仍来自真实任务列表。</span></div>`
    : "";
  const body = vm.status === "loading"
    ? `<div class="ai-growth-overview-state" role="status" aria-live="polite"><strong>正在加载真实任务总览…</strong></div>`
    : vm.status === "error"
      ? errorNotice
      : `
        ${modeNotice}${errorNotice}${aggregationNotice}
        <div class="ai-growth-metric-grid">
          <article data-metric="tasks"><span>真实任务</span><strong>${vm.totals.tasks}</strong><small>${vm.aggregationSource === "overview" ? "来自权威总览" : "按当前任务列表降级计算"}</small></article>
          <article><span>公开证据</span><strong>${counts.evidence}</strong><small>来自 latest Run</small></article>
          <article data-metric="active"><span>执行中 / 已暂停</span><strong>${counts.active}</strong><small>需持续关注</small></article>
          <article><span>已收口 / 待启动</span><strong>${settled}</strong><small>完成 ${counts.completed} · 部分 ${counts.partial} · 失败 ${counts.failed} · 已取消 ${counts.cancelled} · 预算耗尽 ${counts.budgetExhausted} · 待启动 ${counts.notStarted}</small></article>
        </div>
        <div class="ai-growth-overview-grid">
          <section class="ai-growth-task-table-panel" aria-labelledby="aiGrowthOverviewTasks">
            <div class="ai-growth-list-heading"><div><p class="ai-growth-eyebrow">抖音获客任务</p><h2 id="aiGrowthOverviewTasks">真实任务总览</h2></div><span>${vm.generatedAt ? `更新于 ${escapeHtml(new Date(vm.generatedAt).toLocaleString("zh-CN"))}` : "权威数据"}</span></div>
            ${vm.tasks.length === 0
              ? `<div class="ai-growth-overview-state"><strong>还没有真实抖音获客任务</strong><span>新建任务后，先审批方案再启动真实搜索。</span></div>`
              : `<div class="ai-growth-task-table-scroll"><table class="ai-growth-task-table"><thead><tr><th>任务</th><th>Plan</th><th>latest Run</th><th>发现方式</th><th>证据</th><th>更新时间</th><th></th></tr></thead><tbody>${taskRows(vm.tasks)}</tbody></table></div>`}
          </section>
          <aside class="ai-growth-lifecycle" aria-labelledby="aiGrowthLifecycleTitle">
            <div class="ai-growth-aside-heading"><h3 id="aiGrowthLifecycleTitle">任务生命周期</h3><span>权威流程</span></div>
            <ol><li><b>01</b><span><strong>定义目标</strong><small>自然语言生成可编辑方案</small></span></li><li><b>02</b><span><strong>人工批准</strong><small>确认来源、查询与预算</small></span></li><li><b>03</b><span><strong>公开搜索</strong><small>只读取公开线索与证据</small></span></li><li><b>04</b><span><strong>人工审核</strong><small>通过后才可转入 CRM</small></span></li></ol>
          </aside>
        </div>
      `;

  return componentRender(`
    <section class="ai-growth-task-overview" data-overview-status="${vm.status}" aria-labelledby="aiGrowthOverviewTitle">
      <header class="ai-growth-overview-header">
        <div><p class="ai-growth-eyebrow">ACQUISITION COMMAND CENTER</p><h2 id="aiGrowthOverviewTitle">抖音获客中心</h2><p>用真实 Plan 与 latest Run 掌握任务进度。</p></div>
        <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="new-task">新建获客任务</button>
      </header>
      ${platformCards(vm)}
      <div aria-live="polite">${body}</div>
    </section>
  `, callbacks);
}

export function renderTaskDetail(
  vm: TaskDetailVm,
  callbacks: TaskDetailCallbacks
): ComponentRender<TaskDetailCallbacks> {
  const back = `<button type="button" class="ai-growth-text-action ai-growth-task-back" data-action="back-overview">← 返回任务总览</button>`;
  if (vm.status === "loading") {
    return componentRender(`<section class="ai-growth-task-detail">${back}<div class="ai-growth-overview-state" role="status" aria-live="polite"><strong>正在加载权威任务详情…</strong></div></section>`, callbacks);
  }
  if (vm.status === "error" || !vm.detail) {
    return componentRender(`<section class="ai-growth-task-detail">${back}<div class="ai-growth-overview-notice" data-tone="error" role="alert"><strong>任务详情加载失败</strong><span>${escapeHtml(vm.errorMessage ?? "请稍后重试")}</span></div></section>`, callbacks);
  }
  const { task, latestRun } = vm.detail;
  const methods = task.discoveryMethods.map((method) =>
    DISCOVERY_LABELS[method]
  ).join(" · ") || "待确认";
  const noRun = latestRun === null
    ? `<div class="ai-growth-not-started" role="status"><span aria-hidden="true">00</span><div><strong>尚未启动</strong><p>该真实 Plan 还没有 Run。可返回总览或在新建流程中完成人工批准。</p></div></div>`
    : "";
  return componentRender(`
    <section class="ai-growth-task-detail" data-plan-id="${escapeHtml(task.planId)}">
      ${back}
      <header><div><p class="ai-growth-eyebrow">AUTHORITATIVE TASK</p><h2>${escapeHtml(task.name)}</h2><p>${escapeHtml(task.objective)}</p></div><div><span>${escapeHtml(methods)}</span><strong>${vm.runStatus ? RUN_LABELS[vm.runStatus] : "尚未启动"}</strong></div></header>
      ${noRun}
    </section>
  `, callbacks);
}
