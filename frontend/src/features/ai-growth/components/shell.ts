import type { AdvisorMode, AdvisorStatus } from "../types.js";
import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

const STATUS_LABELS: Readonly<Record<AdvisorStatus, string>> = {
  idle: "等待任务",
  planning: "正在生成方案",
  awaiting_approval: "等待人工批准",
  running: "正在执行",
  paused: "已暂停",
  partial_success: "部分完成",
  completed: "已完成",
  cancelled: "已取消",
  connection_required: "需要配置连接",
  empty: "未发现符合条件的客户",
  failed: "执行失败"
};

export interface AdvisorShellVm {
  mode: AdvisorMode;
  status: AdvisorStatus;
  stageHtml: string;
  statusDetail?: string;
}

export interface AdvisorShellCallbacks {
  onContinue(): void;
}

export function advisorStatusLabel(status: AdvisorStatus): string {
  return STATUS_LABELS[status];
}

export function renderAdvisorShell(
  vm: AdvisorShellVm,
  callbacks: AdvisorShellCallbacks
): ComponentRender<AdvisorShellCallbacks> {
  const modeLabel = vm.mode === "demo"
    ? "演示模式 · 演示数据"
    : "真实模式";
  const statusLabel = advisorStatusLabel(vm.status);
  const continueAction = ["paused", "cancelled", "failed"].includes(vm.status)
    ? `<button class="ai-growth-button ai-growth-button--quiet" type="button" data-action="continue">继续任务</button>`
    : "";

  return componentRender(`
    <section class="ai-growth-shell" aria-labelledby="aiGrowthTitle" data-mode="${vm.mode}" data-status="${vm.status}">
      <header class="ai-growth-command-header">
        <div class="ai-growth-command-header__copy">
          <p class="ai-growth-eyebrow">增长作战工作区</p>
          <h1 id="aiGrowthTitle">AI 正在为你发现全网商机</h1>
          <p>先确定今天该跟谁，再看为什么值得跟，最后把下一步动作交给团队。</p>
        </div>
        <div class="ai-growth-command-header__state">
          <span class="ai-growth-mode" data-mode-label="${vm.mode}">${modeLabel}</span>
          <span class="ai-growth-state-label" data-state="${vm.status}">${statusLabel}</span>
          ${continueAction}
        </div>
      </header>
      <div id="aiGrowthStatus" class="ai-growth-live-status" role="status" aria-live="polite">
        <strong>${statusLabel}</strong>
        ${vm.statusDetail ? `<span>${escapeHtml(vm.statusDetail)}</span>` : ""}
      </div>
      <div id="aiGrowthStage" class="ai-growth-stage">${vm.stageHtml}</div>
    </section>
  `, callbacks);
}
