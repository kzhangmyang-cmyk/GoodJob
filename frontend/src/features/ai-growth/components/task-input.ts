import type {
  AcquisitionTaskPlatform,
  AdvisorMode,
  IndustryTemplateId
} from "../types.js";
import type { IndustryTemplate } from "../templates.js";
import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

export interface SearchConnectionHealthVm {
  providerId: string;
  label: string;
  status: "healthy" | "degraded" | "unavailable";
  detail: string;
}

export interface RecentAdvisorTaskVm {
  id: string;
  title: string;
  statusLabel: string;
  updatedAtLabel: string;
}

export interface TaskInputVm {
  mode: AdvisorMode;
  taskText: string;
  targetPlatform: AcquisitionTaskPlatform;
  templates: readonly IndustryTemplate[];
  selectedTemplateId: IndustryTemplateId;
  connections: readonly SearchConnectionHealthVm[];
  recentTasks: readonly RecentAdvisorTaskVm[];
}

export interface TaskInputCallbacks {
  onModeChange(mode: AdvisorMode): void;
  onTargetPlatformChange(platform: AcquisitionTaskPlatform): void;
  onTaskTextChange(value: string): void;
  onTemplateSelect(templateId: IndustryTemplateId): void;
  onSubmit(): void;
  onContinueTask(taskId: string): void;
}

const CONNECTION_LABELS: Readonly<Record<SearchConnectionHealthVm["status"], string>> = {
  healthy: "连接正常",
  degraded: "连接受限",
  unavailable: "连接不可用"
};

const TARGET_PLATFORMS = [{
  id: "douyin",
  label: "抖音公开商机",
  detail: "限定抖音公开索引页面",
  mark: "抖",
  enabled: true
}, {
  id: "web",
  label: "全网公开网页",
  detail: "公开网站与企业资料",
  mark: "网",
  enabled: true
}, {
  id: "kuaishou",
  label: "快手",
  detail: "待接入",
  mark: "快",
  enabled: false
}, {
  id: "wechat_official_account",
  label: "微信公众号",
  detail: "待接入",
  mark: "微",
  enabled: false
}, {
  id: "weibo",
  label: "微博",
  detail: "待接入",
  mark: "博",
  enabled: false
}, {
  id: "xiaohongshu",
  label: "小红书",
  detail: "待接入",
  mark: "红",
  enabled: false
}] as const;

export function renderTaskInput(
  vm: TaskInputVm,
  callbacks: TaskInputCallbacks
): ComponentRender<TaskInputCallbacks> {
  const platformButtons = TARGET_PLATFORMS.map((platform) => {
    const selected = platform.enabled && platform.id === vm.targetPlatform;
    const enabledAttributes = platform.enabled
      ? `data-action="set-target-platform" data-platform="${platform.id}"`
      : `data-future-platform="${platform.id}" disabled`;
    return `
      <button
        type="button"
        class="ai-growth-target-platform${selected ? " is-selected" : ""}"
        ${enabledAttributes}
        aria-pressed="${selected}"
      >
        <span aria-hidden="true">${platform.mark}</span>
        <span><strong>${platform.label}</strong><small>${platform.detail}</small></span>
      </button>
    `;
  }).join("");
  const templateButtons = vm.templates.map((template) => `
    <button
      class="ai-growth-template${template.id === vm.selectedTemplateId ? " is-selected" : ""}"
      type="button"
      data-action="select-template"
      data-template-id="${template.id}"
      aria-pressed="${template.id === vm.selectedTemplateId}"
    >
      <span class="ai-growth-template__index">${String(vm.templates.indexOf(template) + 1).padStart(2, "0")}</span>
      <span>${escapeHtml(template.label)}</span>
    </button>
  `).join("");

  const connectionRows = vm.connections.length === 0
    ? `<li class="ai-growth-connection-row is-empty"><span>尚未连接真实搜索来源</span><strong>需要配置</strong></li>`
    : vm.connections.map((connection) => `
      <li class="ai-growth-connection-row" data-health="${connection.status}">
        <span class="ai-growth-character-icon" aria-hidden="true">源</span>
        <span>
          <strong>${escapeHtml(connection.label)}</strong>
          <small>${escapeHtml(connection.detail)}</small>
        </span>
        <b>${CONNECTION_LABELS[connection.status]}</b>
      </li>
    `).join("");

  const recentRows = vm.recentTasks.length === 0
    ? `<li class="ai-growth-recent-task is-empty">还没有最近任务</li>`
    : vm.recentTasks.map((task) => `
      <li class="ai-growth-recent-task">
        <span>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${escapeHtml(task.statusLabel)} · ${escapeHtml(task.updatedAtLabel)}</small>
        </span>
        <button type="button" class="ai-growth-text-action" data-action="continue-task" data-task-id="${escapeHtml(task.id)}">继续任务</button>
      </li>
    `).join("");

  return componentRender(`
    <section class="ai-growth-task-input" aria-labelledby="aiGrowthTaskTitle">
      <div class="ai-growth-task-input__main">
        <div class="ai-growth-section-heading">
          <div>
            <p class="ai-growth-eyebrow">01 · 定义今天的增长任务</p>
            <h2 id="aiGrowthTaskTitle">告诉参谋，你希望发现什么商机</h2>
          </div>
          <div class="ai-growth-mode-switch" aria-label="运行模式">
            <button type="button" data-action="set-mode" data-mode="real" aria-pressed="${vm.mode === "real"}">真实模式</button>
            <button type="button" data-action="set-mode" data-mode="demo" aria-pressed="${vm.mode === "demo"}">演示模式 · 演示数据</button>
          </div>
        </div>
        <section class="ai-growth-target-platform-picker" aria-labelledby="aiGrowthTargetPlatformTitle">
          <div>
            <h3 id="aiGrowthTargetPlatformTitle">目标内容平台</h3>
            <p>平台决定内容范围，搜索服务商只负责检索公开页面。</p>
          </div>
          <div class="ai-growth-target-platform-grid">${platformButtons}</div>
        </section>
        <div class="ai-growth-template-grid" aria-label="行业模板">${templateButtons}</div>
        <label class="ai-growth-command-composer">
          <span>自然语言任务</span>
          <textarea data-field="task-text" rows="4" placeholder="例如：帮我寻找上海近期可能有数字化采购需求、员工规模 50 人以上的制造企业。">${escapeHtml(vm.taskText)}</textarea>
          <small>提交后先生成可编辑搜索方案。未经批准，不会启动真实搜索。</small>
        </label>
        <div class="ai-growth-task-input__actions">
          <span>${vm.mode === "demo" ? "演示数据不会写入真实客户或待办。" : "真实模式将使用客户已配置的官方 API 连接。"}</span>
          <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="submit-task">生成商机搜索方案</button>
        </div>
      </div>
      <aside class="ai-growth-task-input__aside" aria-label="运行准备情况">
        <section>
          <div class="ai-growth-aside-heading">
            <h3>搜索来源健康状态</h3>
            <span>${vm.connections.length} 个来源</span>
          </div>
          <ul class="ai-growth-connection-list">${connectionRows}</ul>
        </section>
        <section>
          <div class="ai-growth-aside-heading">
            <h3>最近任务</h3>
            <span>${vm.recentTasks.length} 项</span>
          </div>
          <ul class="ai-growth-recent-list">${recentRows}</ul>
        </section>
      </aside>
    </section>
  `, callbacks);
}
