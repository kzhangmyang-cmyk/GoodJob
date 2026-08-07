import {
  buildDouyinPlanInput,
  createAcquisitionTaskCreationApi,
  type AcquisitionSearchConnection,
  type ToolCallingModelConnection
} from "./task-creation-api";
import { createTaskCreationWorkflow } from "./task-creation-workflow";

let started = false;

export interface TaskCreationSubmitState {
  searchConnectionId: string;
  modelConnectionId: string;
  approvalConfirmed: boolean;
  loading: boolean;
  submitting: boolean;
}

export function isTaskCreationSubmitReady(
  state: TaskCreationSubmitState
): boolean {
  return Boolean(
    state.searchConnectionId
    && state.modelConnectionId
    && state.approvalConfirmed
    && !state.loading
    && !state.submitting
  );
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function inputValue(id: string): string {
  return byId<HTMLInputElement | HTMLTextAreaElement>(id)?.value.trim() ?? "";
}

function numberValue(id: string): number {
  return Number(byId<HTMLInputElement>(id)?.value ?? "");
}

function splitValues(value: string): string[] {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionLabel(connection: AcquisitionSearchConnection): string {
  const provider = connection.providerId.replace(/_/g, " ");
  return `${provider} · 凭据 v${connection.credentialVersion}`;
}

function modelOptionLabel(connection: ToolCallingModelConnection): string {
  return `${connection.provider} · ${connection.model} · 凭据 v${connection.credentialVersion}`;
}

function initialise(): void {
  const dialog = byId<HTMLDialogElement>("replicaRealTaskModal");
  const form = byId<HTMLFormElement>("replicaRealTaskForm");
  const close = byId<HTMLButtonElement>("replicaRealTaskClose");
  const cancel = byId<HTMLButtonElement>("replicaRealTaskCancel");
  const refresh = byId<HTMLButtonElement>("replicaRealConnectionsRefresh");
  const configure = byId<HTMLButtonElement>("replicaRealConnectionsConfigure");
  const searchSelect = byId<HTMLSelectElement>("replicaRealSearchConnection");
  const modelSelect = byId<HTMLSelectElement>("replicaRealModelConnection");
  const approvalConfirmed = byId<HTMLInputElement>("replicaRealApprovalConfirmed");
  const submit = byId<HTMLButtonElement>("replicaRealTaskSubmit");
  const preflight = byId("replicaRealPreflightStatus");
  const submitStatus = byId("replicaRealTaskSubmitStatus");
  if (!dialog || !form || !searchSelect || !modelSelect || !submit) return;

  const taskDialog = dialog;
  const taskForm = form;
  const searchConnectionSelect = searchSelect;
  const modelConnectionSelect = modelSelect;
  const submitButton = submit;

  const api = createAcquisitionTaskCreationApi();
  const workflow = createTaskCreationWorkflow(api);
  let searchConnections: AcquisitionSearchConnection[] = [];
  let modelConnections: ToolCallingModelConnection[] = [];
  let loadingConnections = false;
  let submitting = false;

  function setPreflight(message: string, state: "loading" | "ready" | "blocked"): void {
    if (!preflight) return;
    preflight.textContent = message;
    preflight.dataset.state = state;
  }

  function setSubmitStatus(message: string, state: "loading" | "success" | "error"): void {
    if (!submitStatus) return;
    submitStatus.hidden = false;
    submitStatus.dataset.state = state;
    submitStatus.textContent = message;
  }

  function updateSubmitAvailability(): void {
    submitButton.disabled = !isTaskCreationSubmitReady({
      searchConnectionId: searchConnectionSelect.value,
      modelConnectionId: modelConnectionSelect.value,
      approvalConfirmed: approvalConfirmed?.checked === true,
      loading: loadingConnections,
      submitting
    });
  }

  function renderConnections(): void {
    searchConnectionSelect.replaceChildren();
    modelConnectionSelect.replaceChildren();

    if (searchConnections.length === 0) {
      searchConnectionSelect.add(new Option("未配置已启用的真实搜索 API", ""));
    } else {
      searchConnections.forEach((connection) => {
        searchConnectionSelect.add(new Option(optionLabel(connection), connection.id));
      });
    }

    if (modelConnections.length === 0) {
      modelConnectionSelect.add(new Option("未配置支持工具调用的 AI 模型", ""));
    } else {
      modelConnections.forEach((connection) => {
        modelConnectionSelect.add(new Option(modelOptionLabel(connection), connection.id));
      });
    }

    if (searchConnections.length > 0 && modelConnections.length > 0) {
      setPreflight(
        `运行条件已满足：${optionLabel(searchConnections[0]!)}；${modelOptionLabel(modelConnections[0]!)}。`,
        "ready"
      );
    } else if (searchConnections.length === 0 && modelConnections.length === 0) {
      setPreflight("还缺 2 项：请先配置并测试真实搜索 API，以及支持工具调用的 AI 模型连接。", "blocked");
    } else if (searchConnections.length === 0) {
      setPreflight("还缺 1 项：请先配置并测试一个真实搜索 API 连接。", "blocked");
    } else {
      setPreflight("还缺 1 项：请先配置一个支持工具调用的 AI 模型连接。", "blocked");
    }
    updateSubmitAvailability();
  }

  async function loadConnections(): Promise<void> {
    if (loadingConnections) return;
    loadingConnections = true;
    updateSubmitAvailability();
    setPreflight("正在核验真实搜索 API 与 AI 模型连接…", "loading");
    searchConnectionSelect.replaceChildren(new Option("正在读取可用连接…", ""));
    modelConnectionSelect.replaceChildren(new Option("正在读取可用模型…", ""));
    try {
      [searchConnections, modelConnections] = await Promise.all([
        api.listActiveSearchConnections(),
        api.listToolCallingModelConnections()
      ]);
      renderConnections();
    } catch (error) {
      searchConnections = [];
      modelConnections = [];
      const message = error instanceof Error ? error.message : "连接检查失败";
      renderConnections();
      setPreflight(`真实连接检查失败：${message}`, "blocked");
    } finally {
      loadingConnections = false;
      updateSubmitAvailability();
    }
  }

  function openDialog(): void {
    if (submitStatus) submitStatus.hidden = true;
    if (!taskDialog.open) taskDialog.showModal();
    void loadConnections();
  }

  function closeDialog(): void {
    if (submitting) return;
    taskDialog.close();
  }

  document.addEventListener("goodjob:acquisition-create-requested", openDialog);
  close?.addEventListener("click", closeDialog);
  cancel?.addEventListener("click", closeDialog);
  refresh?.addEventListener("click", () => void loadConnections());
  configure?.addEventListener("click", () => {
    const mode = searchConnections.length === 0 ? "search" : "model";
    document.dispatchEvent(new CustomEvent("goodjob:connections-open-requested", {
      detail: { mode, returnTo: "task-creation" }
    }));
  });
  document.addEventListener("goodjob:connections-changed", () => {
    if (taskDialog.open) void loadConnections();
  });
  searchConnectionSelect.addEventListener("change", updateSubmitAvailability);
  modelConnectionSelect.addEventListener("change", updateSubmitAvailability);
  approvalConfirmed?.addEventListener("change", updateSubmitAvailability);

  taskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitting || !taskForm.reportValidity()) return;
    const providerConnection = searchConnections.find(
      (connection) => connection.id === searchConnectionSelect.value
    );
    if (!providerConnection || !modelConnectionSelect.value) {
      setSubmitStatus("真实运行条件尚未满足，请先完成连接检查。", "error");
      return;
    }

    let planInput: ReturnType<typeof buildDouyinPlanInput>;
    try {
      planInput = buildDouyinPlanInput({
        name: inputValue("replicaRealTaskName"),
        objective: inputValue("replicaRealObjective"),
        industries: splitValues(inputValue("replicaRealIndustries")),
        regions: splitValues(inputValue("replicaRealRegions")),
        organizationCriteria: splitValues(inputValue("replicaRealOrganizationCriteria")),
        individualCriteria: splitValues(inputValue("replicaRealIndividualCriteria")),
        exclusionRules: splitValues(inputValue("replicaRealExclusions")),
        organizationQuery: inputValue("replicaRealOrganizationQuery"),
        individualQuery: inputValue("replicaRealIndividualQuery"),
        providerConnection,
        modelConnectionId: modelConnectionSelect.value,
        budget: {
          billingCurrency: "CNY",
          maxRequests: numberValue("replicaRealMaxRequests"),
          maxResults: numberValue("replicaRealMaxResults"),
          maxAmountMinor: numberValue("replicaRealMaxAmount"),
          maxDurationSeconds: numberValue("replicaRealMaxDuration")
        }
      });
    } catch (error) {
      setSubmitStatus(error instanceof Error ? error.message : "任务参数不完整", "error");
      return;
    }

    submitting = true;
    updateSubmitAvailability();
    void (async () => {
      try {
        const result = await workflow.execute({
          planInput,
          approval: {
            decision: "approve",
            reason: inputValue("replicaRealApprovalReason")
          },
          run: {
            reason: inputValue("replicaRealRunReason")
          },
          onStage(stage) {
            if (stage === "creating-plan") {
              setSubmitStatus("第 1/3 步：正在创建可审计的获客计划…", "loading");
            } else if (stage === "approving-plan") {
              setSubmitStatus("第 2/3 步：计划已创建，正在记录人工批准…", "loading");
            } else {
              setSubmitStatus("第 3/3 步：方案已批准，正在创建真实运行…", "loading");
            }
          }
        });
        const run = result.run;
        const runId = typeof run.id === "string" ? run.id : "--";
        const runStatus = typeof run.status === "string" ? run.status : "queued";
        setSubmitStatus(`任务已开始 · Run ${runId} · ${runStatus}`, "success");
        document.dispatchEvent(new CustomEvent("goodjob:acquisition-notify", {
          detail: { message: "真实抖音获客任务已批准并开始运行" }
        }));
        document.dispatchEvent(new Event("goodjob:acquisition-refresh-requested"));
        window.setTimeout(() => {
          taskDialog.close();
          taskForm.reset();
        }, 900);
      } catch (error) {
        const message = error instanceof Error ? error.message : "真实任务创建失败";
        const pendingPlanId = workflow.pendingPlanId();
        setSubmitStatus(
          pendingPlanId
            ? `创建失败：${message}。计划 ${pendingPlanId} 已保留，重试不会重复创建计划。`
            : `创建失败：${message}`,
          "error"
        );
      } finally {
        submitting = false;
        updateSubmitAvailability();
      }
    })();
  });
}

export function startAcquisitionTaskCreation(): void {
  if (started || typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAcquisitionTaskCreation, { once: true });
    return;
  }
  started = true;
  initialise();
}
