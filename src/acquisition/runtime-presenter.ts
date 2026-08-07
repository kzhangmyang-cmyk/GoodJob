import type { AcquisitionTaskRowModel } from "./runtime-model";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character] ?? character);
}

function statusClass(tone: AcquisitionTaskRowModel["statusTone"]): string {
  if (tone === "danger") return " danger";
  if (tone === "normal") return " medium";
  return "";
}

export function renderRealTaskRows(tasks: AcquisitionTaskRowModel[]): string {
  if (tasks.length === 0) {
    return `
      <div class="replica-real-empty" role="status">
        <i class="ph ph-radar" aria-hidden="true"></i>
        <strong>暂无真实抖音获客任务</strong>
        <span>创建并批准任务后，真实运行状态会显示在这里。</span>
      </div>
    `;
  }

  return tasks.map((task) => {
    const tags = task.tags.length > 0 ? task.tags.join(",") : "待配置来源";
    return `
      <button
        type="button"
        class="replica-task-row"
        data-acquisition-real-task="true"
        data-acquisition-plan-id="${escapeHtml(task.planId)}"
        data-task-id="${escapeHtml(task.id)}"
        data-task-name="${escapeHtml(task.name)}"
        data-task-summary="${escapeHtml(task.objective)}"
        data-task-owner="智能体"
        data-task-project="${escapeHtml(task.platformLabel)}"
        data-task-due="${escapeHtml(task.updatedAt)}"
        data-task-status="${escapeHtml(task.statusLabel)}"
        data-task-priority="待判断"
        data-task-tags="${escapeHtml(tags)}"
        data-evidence-count="${task.evidenceCount}"
        data-request-count="${task.requests}"
        data-result-count="${task.results}"
        data-duration-seconds="${task.durationSeconds}"
      >
        <span>${escapeHtml(task.id)}</span>
        <b>${escapeHtml(task.name)}</b>
        <span><span class="priority${statusClass(task.statusTone)}">${escapeHtml(task.statusLabel)}</span> ${task.evidenceCount} 条公开证据</span>
      </button>
    `;
  }).join("");
}
