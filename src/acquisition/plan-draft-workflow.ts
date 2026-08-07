import type { DouyinPlanInput } from "./task-creation-api";

export interface CopilotPlanDraftTask {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result: { summary: string; planDraft?: DouyinPlanInput } | null;
  errorCode?: string | null;
}

export interface PlanDraftWorkflowApi {
  createCopilotSession(
    input: { connectionId: string },
    idempotencyKey: string
  ): Promise<{ id: string }>;
  createPlanDraftTask(
    sessionId: string,
    input: {
      message: string;
      responseMode: "plan_draft";
      targetPlatform: "douyin";
    },
    idempotencyKey: string
  ): Promise<CopilotPlanDraftTask>;
  getCopilotTask(taskId: string): Promise<CopilotPlanDraftTask>;
}

export interface PlanDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredPlanDraftTask {
  sessionId: string;
  taskId: string;
  modelConnectionId: string;
  prompt: string;
  sessionKey: string;
  taskKey: string;
}

export interface PlanDraftWorkflowOptions {
  storage?: PlanDraftStorage | null;
  idempotencyKeyFactory?: () => string;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

const STORAGE_KEY = "goodjob.acquisition.plan-draft-workflow.v1";
const DEFAULT_TIMEOUT_MS = 120_000;

function requiredText(value: string, label: string, max = 20_000): string {
  const text = value.trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return text;
}

function defaultStorage(): PlanDraftStorage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("已取消生成", "AbortError"));
    }, { once: true });
  });
}

function readStored(storage: PlanDraftStorage | null): StoredPlanDraftTask | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredPlanDraftTask> | null;
    if (!value || typeof value.sessionId !== "string" || typeof value.taskId !== "string"
      || typeof value.modelConnectionId !== "string" || typeof value.prompt !== "string"
      || typeof value.sessionKey !== "string" || typeof value.taskKey !== "string") return null;
    return value as StoredPlanDraftTask;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

function taskError(task: CopilotPlanDraftTask): Error {
  return new Error(task.errorCode
    ? `AI 计划生成失败：${task.errorCode}`
    : "AI 计划生成失败，请修改描述后重新生成");
}

export function createPlanDraftWorkflow(
  api: PlanDraftWorkflowApi,
  options: PlanDraftWorkflowOptions = {}
) {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const idempotencyKeyFactory = options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let activeController: AbortController | null = null;

  function clearStored(): void {
    storage?.removeItem(STORAGE_KEY);
  }

  function saveStored(value: StoredPlanDraftTask): void {
    storage?.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  async function waitForPlanDraft(
    stored: StoredPlanDraftTask,
    signal: AbortSignal
  ): Promise<DouyinPlanInput> {
    const startedAt = now();
    let attempt = 0;
    while (true) {
      if (signal.aborted) throw new DOMException("已取消生成", "AbortError");
      const task = await api.getCopilotTask(stored.taskId);
      if (task.status === "succeeded") {
        const planDraft = task.result?.planDraft;
        if (!planDraft) throw new Error("AI 任务完成但未返回完整计划草稿");
        clearStored();
        return planDraft;
      }
      if (task.status === "failed" || task.status === "cancelled") {
        clearStored();
        throw taskError(task);
      }
      if (now() - startedAt >= timeoutMs) {
        throw new Error("AI 计划生成超过 120 秒，请稍后重试");
      }
      const backoff = Math.min(1_000 * 2 ** attempt, 8_000);
      attempt += 1;
      await sleep(backoff, signal);
    }
  }

  return {
    async generate(input: {
      modelConnectionId: string;
      prompt: string;
      signal?: AbortSignal;
    }): Promise<{ planDraft: DouyinPlanInput }> {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      input.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const modelConnectionId = requiredText(input.modelConnectionId, "AI 模型连接", 255);
      const prompt = requiredText(input.prompt, "一句话需求");
      try {
        let stored = readStored(storage);
        if (!stored || stored.modelConnectionId !== modelConnectionId || stored.prompt !== prompt) {
          clearStored();
          const sessionKey = idempotencyKeyFactory();
          const session = await api.createCopilotSession(
            { connectionId: modelConnectionId },
            sessionKey
          );
          const taskKey = idempotencyKeyFactory();
          const task = await api.createPlanDraftTask(session.id, {
            message: prompt,
            responseMode: "plan_draft",
            targetPlatform: "douyin"
          }, taskKey);
          stored = {
            sessionId: session.id,
            taskId: task.id,
            modelConnectionId,
            prompt,
            sessionKey,
            taskKey
          };
          saveStored(stored);
          if (task.status === "succeeded") {
            const planDraft = task.result?.planDraft;
            if (!planDraft) throw new Error("AI 任务完成但未返回完整计划草稿");
            clearStored();
            return { planDraft };
          }
        }
        return { planDraft: await waitForPlanDraft(stored, controller.signal) };
      } finally {
        if (activeController === controller) activeController = null;
      }
    },

    cancel(): void {
      activeController?.abort();
      activeController = null;
    },

    clear(): void {
      this.cancel();
      clearStored();
    }
  };
}
