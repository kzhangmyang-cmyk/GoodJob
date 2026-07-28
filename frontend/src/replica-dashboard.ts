type ReplicaTaskRow = HTMLButtonElement & {
  dataset: DOMStringMap & {
    taskId?: string;
    taskName?: string;
    taskSummary?: string;
    taskOwner?: string;
    taskProject?: string;
    taskDue?: string;
    taskStatus?: string;
    taskPriority?: string;
    taskTags?: string;
  };
};

const replica = document.querySelector<HTMLElement>(".replica-shell");

if (replica) {
  const searchInput = document.querySelector<HTMLInputElement>("#replicaSearchInput");
  const toast = document.querySelector<HTMLElement>("#replicaToast");
  const flow = document.querySelector<HTMLElement>("#replicaFlowStage");
  const modal = document.querySelector<HTMLDialogElement>("#replicaTaskModal");
  const taskForm = document.querySelector<HTMLFormElement>("#replicaTaskForm");
  let activeScope = "all";
  let activeFilter = "all";
  let searchQuery = "";
  let selectedTask = document.querySelector<ReplicaTaskRow>(".replica-task-row.active");
  let toastTimer = 0;

  const detail = {
    id: document.querySelector<HTMLElement>("#replicaDetailId"),
    name: document.querySelector<HTMLElement>("#replicaDetailNameText"),
    summary: document.querySelector<HTMLElement>("#replicaDetailSummary"),
    owner: document.querySelector<HTMLElement>("#replicaDetailOwner"),
    project: document.querySelector<HTMLElement>("#replicaDetailProject"),
    due: document.querySelector<HTMLElement>("#replicaDetailDue"),
    status: document.querySelector<HTMLElement>("#replicaDetailStatus"),
    priority: document.querySelector<HTMLElement>("#replicaDetailPriority"),
    priorityText: document.querySelector<HTMLElement>("#replicaDetailPriorityText"),
    tags: document.querySelector<HTMLElement>("#replicaDetailTags"),
    advice: document.querySelector<HTMLElement>("#replicaAdvicePrimary")
  };

  function escapeText(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character] || character);
  }

  function showToast(message: string) {
    if (!toast) return;
    const label = toast.querySelector("span");
    if (label) label.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function taskRows() {
    return Array.from(document.querySelectorAll<ReplicaTaskRow>(".replica-task-row"));
  }

  function updateGroupCounts() {
    document.querySelectorAll<HTMLElement>(".replica-task-group").forEach((group) => {
      const count = Array.from(group.querySelectorAll<HTMLElement>(".replica-task-row")).filter((row) => !row.hidden).length;
      const countLabel = group.querySelector<HTMLElement>(".replica-group-head small");
      if (countLabel) countLabel.textContent = String(count);
      group.hidden = Boolean(group.querySelector(".replica-task-list")) && count === 0;
    });
  }

  function applyFilters() {
    const query = searchQuery.trim().toLowerCase();
    taskRows().forEach((row) => {
      const text = `${row.dataset.taskId || ""} ${row.dataset.taskName || ""} ${row.dataset.taskSummary || ""} ${row.dataset.taskProject || ""}`.toLowerCase();
      const scopeMatches = activeScope === "all"
        || (activeScope === "agent" && row.dataset.taskOwner === "智能体")
        || (activeScope === "script" && row.dataset.taskOwner === "自动脚本");
      const filterMatches = activeFilter === "all"
        || (activeFilter === "high" && row.dataset.taskPriority === "高")
        || (activeFilter === "active" && row.dataset.taskStatus === "进行中");
      row.hidden = !scopeMatches || !filterMatches || (query.length > 0 && !text.includes(query));
    });
    updateGroupCounts();
  }

  function renderTaskDetail(row: ReplicaTaskRow) {
    selectedTask?.classList.remove("active");
    selectedTask = row;
    selectedTask.classList.add("active");
    if (detail.id) detail.id.textContent = row.dataset.taskId || "--";
    if (detail.name) detail.name.textContent = row.dataset.taskName || "未命名任务";
    if (detail.summary) detail.summary.textContent = row.dataset.taskSummary || "暂无任务说明。";
    if (detail.owner) detail.owner.textContent = row.dataset.taskOwner || "--";
    if (detail.project) detail.project.textContent = row.dataset.taskProject || "--";
    if (detail.due) detail.due.textContent = row.dataset.taskDue || "--";
    if (detail.status) detail.status.textContent = row.dataset.taskStatus || "--";
    if (detail.priority) detail.priority.textContent = `${row.dataset.taskPriority || "普通"}意向`;
    if (detail.priorityText) detail.priorityText.textContent = row.dataset.taskPriority || "普通";
    if (detail.tags) {
      detail.tags.innerHTML = (row.dataset.taskTags || "待整理")
        .split(",")
        .map((tag) => `<span>${escapeText(tag.trim())}</span>`)
        .join("");
    }
    if (detail.advice) {
      detail.advice.textContent = `建议优先处理“${row.dataset.taskProject || "当前平台"}”中包含明确购买、咨询或合作意图的内容`;
    }
    flow?.classList.add("is-focused");
    window.setTimeout(() => flow?.classList.remove("is-focused"), 460);
  }

  replica.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const task = target.closest<ReplicaTaskRow>(".replica-task-row");
    if (task) {
      renderTaskDetail(task);
      return;
    }

    const navButton = target.closest<HTMLButtonElement>("[data-replica-view]");
    if (navButton) {
      document.querySelectorAll("[data-replica-view]").forEach((button) => button.classList.toggle("active", button === navButton));
      const label = navButton.querySelector("span")?.textContent?.trim() || "当前模块";
      showToast(`${label}入口已选中，业务内容待继续完善`);
      return;
    }

    const scopeButton = target.closest<HTMLButtonElement>("[data-replica-scope]");
    if (scopeButton) {
      activeScope = scopeButton.dataset.replicaScope || "all";
      document.querySelectorAll<HTMLButtonElement>("[data-replica-scope]").forEach((button) => {
        const active = button === scopeButton;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
      applyFilters();
      return;
    }

    const groupButton = target.closest<HTMLButtonElement>("[data-group-toggle]");
    if (groupButton) {
      const group = groupButton.closest<HTMLElement>(".replica-task-group");
      const list = group?.querySelector<HTMLElement>(".replica-task-list");
      if (list) {
        list.hidden = !list.hidden;
        groupButton.querySelector("i")?.classList.toggle("ph-caret-right", list.hidden);
        groupButton.querySelector("i")?.classList.toggle("ph-caret-down", !list.hidden);
      }
      return;
    }

    const toolButton = target.closest<HTMLButtonElement>("[data-replica-tool]");
    if (toolButton) {
      const tool = toolButton.dataset.replicaTool;
      if (tool === "filter") {
        const willEnable = activeFilter !== "high";
        activeFilter = willEnable ? "high" : "all";
        toolButton.classList.toggle("active", willEnable);
        applyFilters();
        showToast(willEnable ? "已只显示高意向获客任务" : "已显示全部获客任务");
      }
      if (tool === "sort") {
        document.querySelectorAll<HTMLElement>(".replica-task-list").forEach((list) => {
          const rows = Array.from(list.querySelectorAll<ReplicaTaskRow>(".replica-task-row"));
          rows.reverse().forEach((row) => list.append(row));
        });
        toolButton.classList.toggle("active");
        showToast("任务顺序已调整");
      }
      return;
    }

    const timelineButton = target.closest<HTMLButtonElement>("[data-timeline-scale]");
    if (timelineButton) {
      document.querySelectorAll<HTMLButtonElement>("[data-timeline-scale]").forEach((button) => button.classList.toggle("active", button === timelineButton));
      showToast(timelineButton.dataset.timelineScale === "today" ? "已定位到今天" : "已切换为周视图");
    }
  });

  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value;
    applyFilters();
  });

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchInput.value = "";
      searchQuery = "";
      applyFilters();
    }
  });

  document.querySelector("#replicaNewTaskButton")?.addEventListener("click", () => modal?.showModal());
  document.querySelector("#replicaModalClose")?.addEventListener("click", () => modal?.close());
  document.querySelector("#replicaModalCancel")?.addEventListener("click", () => modal?.close());
  document.querySelector("#replicaEditTask")?.addEventListener("click", () => {
    if (!selectedTask) return;
    const nameInput = document.querySelector<HTMLInputElement>("#replicaTaskName");
    const dueInput = document.querySelector<HTMLInputElement>("#replicaTaskDue");
    const summaryInput = document.querySelector<HTMLTextAreaElement>("#replicaTaskSummary");
    const platformInput = document.querySelector<HTMLSelectElement>("#replicaTaskStage");
    const modeInput = document.querySelector<HTMLSelectElement>("#replicaTaskMode");
    if (nameInput) nameInput.value = selectedTask.dataset.taskName || "";
    if (summaryInput) summaryInput.value = selectedTask.dataset.taskSummary || "";
    if (dueInput) dueInput.value = "";
    if (platformInput) platformInput.value = selectedTask.dataset.taskProject || "抖音";
    if (modeInput) modeInput.value = selectedTask.dataset.taskOwner || "智能体";
    modal?.showModal();
  });

  document.querySelector("#replicaCompleteTask")?.addEventListener("click", () => {
    if (!selectedTask) return;
    selectedTask.dataset.taskStatus = "已同步私域";
    selectedTask.style.opacity = "0.5";
    if (detail.status) detail.status.textContent = "已同步私域";
    const count = document.querySelector<HTMLElement>("#replicaCompletedCount");
    if (count) count.textContent = String(Number(count.textContent || "24") + 1);
    showToast(`“${selectedTask.dataset.taskName || "获客任务"}”已同步到私域客户池`);
  });

  document.querySelector("#replicaAdviceButton")?.addEventListener("click", () => {
    showToast("已展开 AI 建议：确认需求和联系方式后，再将客户转入微信私域");
  });

  taskForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector<HTMLInputElement>("#replicaTaskName")?.value.trim() || "新获客任务";
    const summary = document.querySelector<HTMLTextAreaElement>("#replicaTaskSummary")?.value.trim() || "扫描相关话题和评论，识别有需求的客户并发起沟通。";
    const stage = document.querySelector<HTMLSelectElement>("#replicaTaskStage")?.value || "抖音";
    const mode = document.querySelector<HTMLSelectElement>("#replicaTaskMode")?.value || "智能体";
    const due = document.querySelector<HTMLInputElement>("#replicaTaskDue")?.value.replace("T", " ") || "立即启动";
    const list = document.querySelector<HTMLElement>(".replica-task-group .replica-task-list");
    if (list) {
      const nextId = `ACQ-${stage.toUpperCase()}-${String(taskRows().length + 1).padStart(2, "0")}`;
      const row = document.createElement("button") as ReplicaTaskRow;
      row.type = "button";
      row.className = "replica-task-row";
      row.dataset.taskId = nextId;
      row.dataset.taskName = name;
      row.dataset.taskSummary = summary;
      row.dataset.taskOwner = mode;
      row.dataset.taskProject = stage;
      row.dataset.taskDue = due;
      row.dataset.taskStatus = "准备启动";
      row.dataset.taskPriority = "中";
      row.dataset.taskTags = `${stage},${mode},新建`;
      row.innerHTML = `<span>${escapeText(nextId)}</span><b>${escapeText(name)}</b><span><span class="priority medium">${escapeText(mode === "智能体" ? "智能体" : "脚本")}</span> 待启动</span>`;
      list.prepend(row);
      renderTaskDetail(row);
      applyFilters();
    }
    taskForm.reset();
    modal?.close();
    showToast(`“${name}”已创建`);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInput?.focus();
    }
  });
}
