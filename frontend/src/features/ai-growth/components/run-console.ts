import type {
  AcquisitionShardStatus,
  AdvisorMode,
  AdvisorStatus,
  CandidateCardVm
} from "../types.js";
import {
  advisorStatusLabel
} from "./shell.js";
import {
  renderCandidateList,
  requiresDouyinIdentityVerification,
  type CandidateListCallbacks
} from "./candidate-list.js";
import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

export interface RunTimelineItemVm {
  id: string;
  label: string;
  state: "pending" | "running" | "completed" | "warning" | "failed";
  detail: string;
}

export interface RunProviderVm {
  providerId: string;
  status: AcquisitionShardStatus;
  acceptedResultCount: number;
  failedResultCount: number;
  errorCode: string | null;
}

export interface RunConsoleVm {
  mode: AdvisorMode;
  status: AdvisorStatus;
  timeline: readonly RunTimelineItemVm[];
  queryStream: readonly string[];
  providers: readonly RunProviderVm[];
  candidates: readonly CandidateCardVm[];
}

export interface RunConsoleCallbacks {
  onPause(): void;
  onResume(): void;
  onCancel(): void;
  candidateCallbacks: CandidateListCallbacks;
}

const TIMELINE_LABEL: Readonly<Record<RunTimelineItemVm["state"], string>> = {
  pending: "等待执行",
  running: "正在执行",
  completed: "已完成",
  warning: "受限",
  failed: "失败"
};

const SUCCESS_PROVIDER_STATES = new Set<AcquisitionShardStatus>([
  "succeeded",
  "succeeded_empty"
]);

function providerPresentation(status: AcquisitionShardStatus): {
  state: "success" | "partial" | "limited";
  label: string;
} {
  if (SUCCESS_PROVIDER_STATES.has(status)) {
    return { state: "success", label: "成功来源" };
  }
  if (status === "partial_success") {
    return { state: "partial", label: "部分成功来源" };
  }
  return { state: "limited", label: "失败或受限来源" };
}

function providerRows(providers: readonly RunProviderVm[]): string {
  return providers.map((provider) => {
    const presentation = providerPresentation(provider.status);
    return `
      <li data-provider-state="${presentation.state}">
        <span class="ai-growth-character-icon" aria-hidden="true">${presentation.state === "success" ? "成" : presentation.state === "partial" ? "部" : "限"}</span>
        <span>
          <strong>${escapeHtml(provider.providerId)}</strong>
          <small>${provider.acceptedResultCount} 条有效结果${provider.failedResultCount > 0 ? ` · ${provider.failedResultCount} 条失败` : ""}</small>
        </span>
        <b>${presentation.label}${provider.errorCode ? ` · ${escapeHtml(provider.errorCode)}` : ""}</b>
      </li>
    `;
  }).join("");
}

export function renderRunConsole(
  vm: RunConsoleVm,
  callbacks: RunConsoleCallbacks
): ComponentRender<RunConsoleCallbacks> {
  const timeline = vm.timeline.map((item, index) => `
    <li data-timeline-state="${item.state}">
      <span class="ai-growth-timeline-index">${String(index + 1).padStart(2, "0")}</span>
      <span>
        <strong>${escapeHtml(item.label)}</strong>
        <small>${TIMELINE_LABEL[item.state]} · ${escapeHtml(item.detail)}</small>
      </span>
    </li>
  `).join("");
  const queries = vm.queryStream.length === 0
    ? `<li class="is-empty">等待批准后生成查询</li>`
    : vm.queryStream.map((query) => `<li><code>${escapeHtml(query)}</code></li>`).join("");
  const candidateList = renderCandidateList({
    mode: vm.mode,
    candidates: vm.candidates
  }, callbacks.candidateCallbacks);
  const runActions = vm.status === "paused"
    ? `<button type="button" class="ai-growth-button ai-growth-button--secondary ai-growth-button--compact" data-action="resume-run">继续执行</button>`
    : vm.status === "running"
      ? `<button type="button" class="ai-growth-button ai-growth-button--secondary ai-growth-button--compact" data-action="pause-run">暂停</button>`
      : "";
  const unresolvedDouyinSignals = vm.mode === "real"
    ? vm.candidates.filter(requiresDouyinIdentityVerification).length
    : 0;

  return componentRender(`
    <section class="ai-growth-run-console" aria-labelledby="aiGrowthRunTitle" data-status="${vm.status}">
      <header class="ai-growth-run-console__header">
        <div>
          <p class="ai-growth-eyebrow">03 · 执行与筛选</p>
          <h2 id="aiGrowthRunTitle">商机发现执行台</h2>
          <p>${vm.mode === "demo" ? "演示模式 · 演示数据" : "真实模式"} · ${advisorStatusLabel(vm.status)}</p>
        </div>
        <div>
          ${runActions}
          ${["running", "paused"].includes(vm.status) ? `<button type="button" class="ai-growth-button ai-growth-button--quiet ai-growth-button--compact" data-action="cancel-run">取消运行</button>` : ""}
        </div>
      </header>
      ${vm.status === "partial_success" ? `
        <div class="ai-growth-partial-notice" role="status">
          <strong>部分完成</strong>
          <span>已有来源返回有效客户，同时存在失败或受限来源。现有结果可继续人工审核。</span>
        </div>
      ` : ""}
      ${unresolvedDouyinSignals > 0 ? `
        <div class="ai-growth-identity-notice" data-notice="identity-verification-required" role="status">
          <strong>待核验</strong>
          <span>发现 ${unresolvedDouyinSignals} 个公开需求信号待核验；不是已确认客户</span>
        </div>
      ` : ""}
      <div class="ai-growth-run-grid">
        <aside class="ai-growth-run-activity">
          <section>
            <div class="ai-growth-aside-heading"><h3>执行时间线</h3><span>${vm.timeline.length} 步</span></div>
            <ol class="ai-growth-timeline">${timeline}</ol>
          </section>
          <section>
            <div class="ai-growth-aside-heading"><h3>查询流</h3><span>${vm.queryStream.length} 条</span></div>
            <ul class="ai-growth-query-stream">${queries}</ul>
          </section>
          <section>
            <div class="ai-growth-aside-heading"><h3>来源结果</h3><span>${vm.providers.length} 个</span></div>
            <ul class="ai-growth-provider-results">${providerRows(vm.providers)}</ul>
          </section>
        </aside>
        <div class="ai-growth-run-candidates">${candidateList.html}</div>
      </div>
    </section>
  `, callbacks);
}
