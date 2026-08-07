import {
  createAcquisitionDetailApi,
  type AcquisitionDetailApi,
  type AcquisitionRunControlAction,
  type AcquisitionRunWithEtag,
  type CandidateReviewAction
} from "./detail-center-api";
import {
  renderAcquisitionDetailCenter,
  type AcquisitionDetailCenterMode,
  type AcquisitionDetailCenterState
} from "./detail-center-view";

export type AcquisitionCandidateReviewAction = CandidateReviewAction;

export interface AcquisitionDetailCenterControllerOptions {
  api?: AcquisitionDetailApi;
  eventTarget?: EventTarget;
  root?: HTMLElement | null;
  body?: HTMLElement | null;
  keyFactory?: () => string;
  confirm?: (message: string) => boolean;
}

export interface AcquisitionDetailCenterController {
  getState(): Readonly<AcquisitionDetailCenterState>;
  whenIdle(): Promise<void>;
  open(mode: AcquisitionDetailCenterMode, planId: string): Promise<void>;
  close(): void;
  switchMode(mode: AcquisitionDetailCenterMode): void;
  selectCandidate(candidateId: string): Promise<void>;
  loadMoreCandidates(): Promise<void>;
  startRun(reason?: string): Promise<void>;
  controlRun(action: AcquisitionRunControlAction, reason: string): Promise<void>;
  reviewCandidate(
    action: AcquisitionCandidateReviewAction,
    reason?: string
  ): Promise<void>;
  startIntelligence(): Promise<void>;
  destroy(): void;
}

interface MutationContext {
  serial: number;
  requestSerial: number;
  planId: string | null;
  candidateId: string;
  mode: AcquisitionDetailCenterMode;
}

interface RunMutationContext {
  serial: number;
  requestSerial: number;
  planId: string;
  runId: string | null;
  action: "start" | AcquisitionRunControlAction;
}

interface DetailOpenRequest {
  mode?: unknown;
  planId?: unknown;
}

function defaultEventTarget(): EventTarget {
  return typeof document === "undefined" ? new EventTarget() : document;
}

function requestedMode(value: unknown): AcquisitionDetailCenterMode | null {
  return value === "plan" || value === "candidates" ? value : null;
}

function requestedPlanId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function defaultKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return `acquisition-detail-${random ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function defaultConfirm(message: string): boolean {
  return typeof window === "undefined" ? true : window.confirm(message);
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function customEvent<T>(name: string, detail: T): Event {
  if (typeof CustomEvent === "function") {
    return new CustomEvent<T>(name, { detail });
  }
  const event = new Event(name);
  Object.defineProperty(event, "detail", { value: detail });
  return event;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.map(record).filter(Boolean) as Array<Record<string, unknown>>;
  const container = record(value);
  const items = container?.items;
  return Array.isArray(items)
    ? items.map(record).filter(Boolean) as Array<Record<string, unknown>>
    : [];
}

function firstCandidateId(detail: unknown): string | null {
  const taskDetail = record(detail);
  const presentation = record(taskDetail?.presentation);
  for (const event of records(presentation?.candidateEvents)) {
    const eventCandidateId = requestedPlanId(event.candidateId);
    if (eventCandidateId) return eventCandidateId;
    const candidateId = requestedPlanId(record(event.candidate)?.id);
    if (candidateId) return candidateId;
  }
  return null;
}

interface ResourceLoad<T> {
  value: T;
  errors: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "请求失败";
}

async function loadResource<T>(
  label: string,
  load: () => Promise<T>,
  fallback: T
): Promise<ResourceLoad<T>> {
  try {
    return { value: await load(), errors: [] };
  } catch (error) {
    return { value: fallback, errors: [`${label}：${errorText(error)}`] };
  }
}

async function loadCursorPages(
  label: string,
  loadPage: (cursor?: string) => Promise<unknown>
): Promise<ResourceLoad<Array<Record<string, unknown>>>> {
  const items: Array<Record<string, unknown>> = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    let page: unknown;
    try {
      page = await loadPage(cursor);
    } catch (error) {
      return {
        value: items,
        errors: [`${label}：${errorText(error)}`]
      };
    }
    items.push(...records(page));
    const nextCursor = requestedPlanId(record(page)?.nextCursor);
    if (!nextCursor) return { value: items, errors: [] };
    if (seenCursors.has(nextCursor)) {
      return {
        value: items,
        errors: [`${label}：服务端返回重复分页游标，已停止继续读取`]
      };
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export function createAcquisitionDetailCenterController(
  options: AcquisitionDetailCenterControllerOptions = {}
): AcquisitionDetailCenterController {
  const api = options.api ?? createAcquisitionDetailApi();
  const eventTarget = options.eventTarget ?? defaultEventTarget();
  const keyFactory = options.keyFactory ?? defaultKey;
  const ask = options.confirm ?? defaultConfirm;
  const pendingIdempotencyKeys = new Map<string, string>();
  const state: AcquisitionDetailCenterState = {
    mode: "plan",
    status: "ready",
    detail: null,
    selectedCandidateId: null,
    candidateDetail: null,
    message: null,
    error: null,
    loadingMoreCandidates: false,
    runControlBusy: false,
    runControlReason: ""
  };
  let disposed = false;
  let requestSerial = 0;
  let candidateSerial = 0;
  let mutationSerial = 0;
  let runMutationSerial = 0;
  let currentPlanId: string | null = null;
  let mutating = false;
  let runMutating = false;
  let idlePromise = Promise.resolve();
  let root = options.root
    ?? (typeof document === "undefined"
      ? null
      : document.getElementById("replicaAcquisitionDetailCenter"));
  let body = options.body
    ?? (root?.querySelector<HTMLElement>("#replicaAcquisitionDetailCenterBody") ?? null);
  let returnFocus: { focus(): void } | null = null;

  function render(): void {
    if (body) {
      body.innerHTML = renderAcquisitionDetailCenter(state);
    }
  }

  function rejectValidation(message: string): Promise<never> {
    state.error = message;
    state.message = null;
    render();
    return Promise.reject(new Error(message));
  }

  function resolveDom(): void {
    if (typeof document === "undefined") return;
    root ??= document.getElementById("replicaAcquisitionDetailCenter");
    body ??= root?.querySelector<HTMLElement>("#replicaAcquisitionDetailCenterBody") ?? null;
  }

  function showRoot(): void {
    resolveDom();
    if (!root) return;
    const dialog = root as HTMLDialogElement;
    if (!dialog.open) {
      const activeElement = root.ownerDocument?.activeElement;
      returnFocus = activeElement && "focus" in activeElement
        ? activeElement as { focus(): void }
        : null;
    }
    root.hidden = false;
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    if (typeof dialog.showModal === "function" && !dialog.open) {
      dialog.showModal();
    }
  }

  function finishClose(): void {
    if (root) {
      root.hidden = true;
      root.classList.remove("is-open");
      root.setAttribute("aria-hidden", "true");
    }
    const focus = returnFocus;
    returnFocus = null;
    focus?.focus();
  }

  function hideRoot(): void {
    if (!root) {
      finishClose();
      return;
    }
    const dialog = root as HTMLDialogElement;
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    }
    finishClose();
  }

  function stableKey(operation: string, payload: unknown): {
    id: string;
    value: string;
  } {
    const id = `${operation}:${fingerprint(payload)}`;
    let value = pendingIdempotencyKeys.get(id);
    if (!value) {
      value = keyFactory();
      pendingIdempotencyKeys.set(id, value);
    }
    return { id, value };
  }

  function invalidateMutation(): void {
    mutationSerial += 1;
    mutating = false;
  }

  function invalidateRunMutation(): void {
    runMutationSerial += 1;
    runMutating = false;
    state.runControlBusy = false;
  }

  function beginMutation(candidateId: string): MutationContext {
    mutating = true;
    return {
      serial: ++mutationSerial,
      requestSerial,
      planId: currentPlanId,
      candidateId,
      mode: state.mode
    };
  }

  function mutationIsCurrent(context: MutationContext): boolean {
    return !disposed
      && context.serial === mutationSerial
      && context.requestSerial === requestSerial
      && context.planId === currentPlanId
      && context.candidateId === state.selectedCandidateId
      && context.mode === state.mode;
  }

  function beginRunMutation(
    planId: string,
    action: RunMutationContext["action"],
    runId: string | null
  ): RunMutationContext {
    runMutating = true;
    state.runControlBusy = true;
    return {
      serial: ++runMutationSerial,
      requestSerial,
      planId,
      runId,
      action
    };
  }

  function runMutationIsCurrent(context: RunMutationContext): boolean {
    return !disposed
      && context.serial === runMutationSerial
      && context.requestSerial === requestSerial
      && context.planId === currentPlanId;
  }

  function applyRunResult(result: AcquisitionRunWithEtag): void {
    if (!state.detail) return;
    const run = result.run;
    const runChanged = state.detail.latestRun?.id !== run.id;
    state.detail = {
      ...state.detail,
      latestRun: {
        id: run.id,
        status: run.status,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt,
        evidenceCount: run.evidenceCount,
        consumedBudget: { ...run.consumedBudget },
        etag: result.etag ?? run.etag,
        planVersion: run.planVersion
      },
      ...(runChanged ? { shards: [], presentation: null } : {})
    };
  }

  async function refreshAfterRunMutation(
    context: RunMutationContext,
    result: AcquisitionRunWithEtag,
    completedMessage: string
  ): Promise<void> {
    if (!runMutationIsCurrent(context)) return;
    state.runControlReason = "";
    applyRunResult(result);
    state.error = null;
    state.message = `${completedMessage}，正在刷新任务状态…`;
    render();
    const eventDetail = {
      planId: context.planId,
      action: context.action,
      runId: result.run.id
    };
    eventTarget.dispatchEvent(customEvent(
      "goodjob:acquisition-refresh-requested",
      eventDetail
    ));
    eventTarget.dispatchEvent(customEvent(
      "goodjob:acquisition-notify",
      { message: completedMessage }
    ));
    try {
      const detail = await api.getTask(context.planId);
      if (!runMutationIsCurrent(context)) return;
      state.detail = detail;
      state.message = completedMessage;
      state.error = null;
    } catch (error) {
      if (!runMutationIsCurrent(context)) return;
      state.message = completedMessage;
      state.error = `${completedMessage}，但详情刷新失败：${errorText(error)}`;
    }
    render();
  }

  async function loadCandidateSnapshot(
    candidateId: string,
    serial: number,
    applies: () => boolean = () => true
  ): Promise<void> {
    const [candidateResult, evidenceResult, qualificationResult,
      financialResult, battleCardResult, reviewsResult, operationResult] =
      await Promise.all([
        loadResource(
          "候选基本信息",
          () => api.getCandidate(candidateId),
          null
        ),
        loadCursorPages("公开证据", (cursor) => api.getCandidateEvidence(candidateId, {
          ...(cursor ? { cursor } : {}),
          limit: 100
        })),
        loadResource(
          "资格研判",
          () => api.getCandidateQualification(candidateId),
          null
        ),
        loadResource(
          "财务价值",
          () => api.getCandidateFinancialValue(candidateId),
          null
        ),
        loadResource(
          "客户作战卡",
          () => api.getCandidateBattleCard(candidateId),
          null
        ),
        loadCursorPages("审核记录", (cursor) => api.getCandidateReviews(candidateId, {
          ...(cursor ? { cursor } : {}),
          limit: 100
        })),
        loadResource(
          "AI 研判任务",
          () => api.getLatestIntelligenceOperation(candidateId),
          null
        )
      ]);
    if (disposed || serial !== candidateSerial || !applies()) return;
    const candidateContainer = record(candidateResult.value);
    state.candidateDetail = {
      candidate: record(candidateContainer?.candidate),
      evidence: evidenceResult.value,
      qualification: record(qualificationResult.value),
      financialValue: record(financialResult.value),
      battleCard: record(battleCardResult.value),
      reviews: reviewsResult.value,
      intelligenceOperation: record(operationResult.value)
    };
    const failures = [
      ...candidateResult.errors,
      ...evidenceResult.errors,
      ...qualificationResult.errors,
      ...financialResult.errors,
      ...battleCardResult.errors,
      ...reviewsResult.errors,
      ...operationResult.errors
    ];
    if (failures.length === 0) {
      state.message = null;
      state.error = null;
      state.loadingMoreCandidates = false;
    } else {
      state.message = "部分资料暂不可用，已保留成功加载的数据";
      state.error = `部分候选资料加载失败：${failures.join("；")}`;
    }
  }

  async function refreshAfterMutation(
    context: MutationContext,
    progressMessage: string,
    completedMessage: string
  ): Promise<void> {
    if (!mutationIsCurrent(context)) return;
    const taskSerial = requestSerial;
    const refreshSerial = ++candidateSerial;
    state.error = null;
    state.message = progressMessage;
    render();
    const taskPromise = context.planId
      ? api.getTask(context.planId)
      : Promise.resolve(null);
    const [detail] = await Promise.all([
      taskPromise,
      loadCandidateSnapshot(
        context.candidateId,
        refreshSerial,
        () => mutationIsCurrent(context)
      )
    ]);
    if (!mutationIsCurrent(context)
      || taskSerial !== requestSerial
      || refreshSerial !== candidateSerial) return;
    if (detail) state.detail = detail;
    state.message = state.error
      ? `${completedMessage}，部分资料刷新失败`
      : completedMessage;
    render();
  }

  function remember<T>(promise: Promise<T>): Promise<T> {
    idlePromise = promise.then(() => undefined, () => undefined);
    return promise;
  }

  const controller: AcquisitionDetailCenterController = {
    getState() {
      return state;
    },

    whenIdle() {
      return idlePromise;
    },

    open(mode, planId) {
      invalidateMutation();
      invalidateRunMutation();
      const serial = ++requestSerial;
      currentPlanId = planId;
      showRoot();
      state.mode = mode;
      state.status = "loading";
      state.detail = null;
      state.selectedCandidateId = null;
      state.candidateDetail = null;
      state.message = null;
      state.error = null;
      state.runControlReason = "";
      candidateSerial += 1;
      render();
      return remember((async () => {
        try {
          const detail = await api.getTask(planId);
          if (disposed || serial !== requestSerial) return;
          state.detail = detail;
          state.status = "ready";
          if (state.mode === "candidates" && !state.selectedCandidateId) {
            const candidateId = firstCandidateId(detail);
            if (candidateId) {
              await controller.selectCandidate(candidateId);
              return;
            }
          }
        } catch (error) {
          if (disposed || serial !== requestSerial) return;
          state.status = "error";
          state.error = error instanceof Error ? error.message : "任务详情加载失败";
          render();
          throw error;
        }
        render();
      })());
    },

    close() {
      invalidateMutation();
      invalidateRunMutation();
      requestSerial += 1;
      candidateSerial += 1;
      hideRoot();
    },

    switchMode(mode) {
      invalidateMutation();
      state.mode = mode;
      state.error = null;
      state.message = null;
      if (mode === "candidates" && !state.selectedCandidateId) {
        const candidateId = firstCandidateId(state.detail);
        if (candidateId) {
          void controller.selectCandidate(candidateId).catch(() => undefined);
          return;
        }
      }
      render();
    },

    selectCandidate(candidateId) {
      const id = requestedPlanId(candidateId);
      if (!id) return rejectValidation("候选 ID 不能为空");
      invalidateMutation();
      const serial = ++candidateSerial;
      state.selectedCandidateId = id;
      state.candidateDetail = null;
      state.error = null;
      state.message = "正在读取候选证据与 AI 研判…";
      render();
      return remember((async () => {
        try {
          await loadCandidateSnapshot(id, serial);
        } catch (error) {
          if (disposed || serial !== candidateSerial) return;
          state.candidateDetail = null;
          state.message = null;
          state.error = error instanceof Error ? error.message : "候选研判读取失败";
          render();
          throw error;
        }
        render();
      })());
    },

    loadMoreCandidates() {
      const detail = state.detail;
      const presentation = detail?.presentation;
      const runId = requestedPlanId(detail?.latestRun?.id);
      const cursor = requestedPlanId(presentation?.nextAfter);
      if (!detail || !presentation || presentation.hasMore !== true || !runId || !cursor) {
        return rejectValidation("当前没有更多候选可加载");
      }
      if (state.loadingMoreCandidates) {
        return rejectValidation("更多候选正在加载");
      }
      const serial = requestSerial;
      const planId = currentPlanId;
      state.loadingMoreCandidates = true;
      state.error = null;
      state.message = "正在加载更多真实候选…";
      render();
      return remember((async () => {
        try {
          const nextPage = await api.getRunPresentation(runId, {
            after: cursor,
            limit: 100
          });
          if (disposed || serial !== requestSerial || planId !== currentPlanId) return;
          const currentDetail = state.detail;
          const currentPresentation = currentDetail?.presentation;
          if (!currentDetail || !currentPresentation
            || requestedPlanId(currentDetail.latestRun?.id) !== runId) return;

          const eventKeys = new Set<string>();
          const mergedEvents = [
            ...currentPresentation.candidateEvents,
            ...nextPage.candidateEvents.map((event) => ({ ...event }))
          ].filter((event) => {
            const key = requestedPlanId(event.candidateId)
              ?? requestedPlanId(event.eventId);
            if (!key) return true;
            if (eventKeys.has(key)) return false;
            eventKeys.add(key);
            return true;
          });
          const providerKeys = new Set<string>();
          const mergedProviders = [
            ...currentPresentation.providers,
            ...nextPage.providers.map((provider) => ({ ...provider }))
          ].filter((provider) => {
            const key = requestedPlanId(provider.shardId)
              ?? `${String(provider.connectionId ?? "")}:${String(provider.providerId ?? "")}`;
            if (providerKeys.has(key)) return false;
            providerKeys.add(key);
            return true;
          });
          const repeatedCursor = nextPage.hasMore && nextPage.nextAfter === cursor;
          state.detail = {
            ...currentDetail,
            presentation: {
              ...currentPresentation,
              ...nextPage,
              candidateEvents: mergedEvents,
              providers: mergedProviders,
              hasMore: repeatedCursor ? false : nextPage.hasMore,
              nextAfter: repeatedCursor ? null : nextPage.nextAfter
            }
          };
          state.loadingMoreCandidates = false;
          state.message = repeatedCursor
            ? "已加载可用候选；服务端分页游标未前进，已停止继续加载"
            : `已加载 ${nextPage.candidateEvents.length} 条更多候选`;
          state.error = repeatedCursor
            ? "候选分页游标重复，已停止继续读取以避免循环请求"
            : null;
          render();
        } catch (error) {
          if (disposed || serial !== requestSerial || planId !== currentPlanId) return;
          state.loadingMoreCandidates = false;
          state.message = null;
          state.error = error instanceof Error ? error.message : "更多候选加载失败";
          render();
          throw error;
        }
      })());
    },

    startRun(reason) {
      const detail = state.detail;
      const planId = currentPlanId;
      const planStatus = requestedPlanId(detail?.plan.status);
      const latestRun = detail?.latestRun ?? null;
      const latestStatus = latestRun?.status ?? null;
      const normalizedReason = (
        reason === undefined ? state.runControlReason ?? "" : reason
      ).trim();
      const planVersion = typeof detail?.plan.version === "number"
        && Number.isFinite(detail.plan.version)
        ? detail.plan.version
        : null;
      const runPlanVersion = typeof latestRun?.planVersion === "number"
        && Number.isFinite(latestRun.planVersion)
        ? latestRun.planVersion
        : null;
      const isBudgetContinuation = latestStatus === "budget_exhausted"
        && planVersion !== null
        && runPlanVersion !== null
        && planVersion > runPlanVersion;
      const restartableStatuses = new Set([
        "cancelled",
        "succeeded",
        "succeeded_empty",
        "partial_success",
        "failed"
      ]);
      if (!detail || !planId) {
        return rejectValidation("请先打开一个获客计划");
      }
      if (planStatus !== "approved") {
        return rejectValidation("只有已人工审批的计划可以启动运行");
      }
      if (latestStatus === "budget_exhausted" && !isBudgetContinuation) {
        return rejectValidation("预算已用完，请先调整预算并重新审批后再续跑");
      }
      if (latestStatus !== null
        && !restartableStatuses.has(latestStatus)
        && !isBudgetContinuation) {
        return rejectValidation("当前运行尚未结束，不能再次启动");
      }
      if (runMutating) return rejectValidation("另一项运行操作正在进行");

      const input = {
        ...(isBudgetContinuation && latestRun
          ? { parentRunId: latestRun.id }
          : {}),
        ...(normalizedReason ? { reason: normalizedReason } : {})
      };
      const idempotency = stableKey("start-run", { planId, ...input });
      const context = beginRunMutation(planId, "start", latestRun?.id ?? null);
      state.runControlReason = normalizedReason;
      state.error = null;
      state.message = isBudgetContinuation
        ? "正在按新预算继续运行…"
        : latestRun ? "正在创建新的独立运行…" : "正在启动获客运行…";
      render();
      return remember((async () => {
        try {
          const result = await api.createRun(planId, input, idempotency.value);
          pendingIdempotencyKeys.delete(idempotency.id);
          await refreshAfterRunMutation(
            context,
            result,
            isBudgetContinuation
              ? "追加预算后的运行已启动"
              : latestRun ? "新的独立运行已启动" : "获客运行已启动"
          );
        } catch (error) {
          if (runMutationIsCurrent(context)) {
            state.error = errorText(error);
            state.message = null;
            render();
          }
          throw error;
        } finally {
          if (context.serial === runMutationSerial) {
            runMutating = false;
            state.runControlBusy = false;
            render();
          }
        }
      })());
    },

    controlRun(action, reason) {
      const detail = state.detail;
      const planId = currentPlanId;
      const latestRun = detail?.latestRun ?? null;
      const normalizedReason = reason.trim();
      const allowedActions: AcquisitionRunControlAction[] = [
        "pause",
        "resume",
        "cancel"
      ];
      if (!allowedActions.includes(action)) {
        return rejectValidation("运行控制动作无效");
      }
      if (!detail || !planId || !latestRun) {
        return rejectValidation("当前计划还没有可控制的运行");
      }
      if (!normalizedReason) {
        return rejectValidation("暂停、继续或取消运行必须填写操作理由");
      }
      const status = latestRun.status;
      const actionAllowed = action === "pause"
        ? status === "queued" || status === "running"
        : action === "resume"
          ? status === "paused"
          : ["queued", "running", "pause_requested", "paused"].includes(status);
      if (!actionAllowed) {
        return rejectValidation(
          action === "pause"
            ? "只有排队中或运行中的任务可以暂停"
            : action === "resume"
              ? "只有已暂停的任务可以继续"
              : "当前运行状态不能取消"
        );
      }
      const etag = typeof latestRun.etag === "string" ? latestRun.etag.trim() : "";
      if (!etag) {
        return rejectValidation("运行 ETag 缺失，请刷新详情后重试");
      }
      if (action === "cancel" && !ask("确认取消当前获客运行？")) {
        return Promise.resolve();
      }
      if (runMutating) return rejectValidation("另一项运行操作正在进行");

      const context = beginRunMutation(planId, action, latestRun.id);
      state.runControlReason = normalizedReason;
      const progressLabel = action === "pause"
        ? "正在请求安全暂停…"
        : action === "resume"
          ? "正在继续运行…"
          : "正在取消运行…";
      const completedLabel = action === "pause"
        ? "暂停请求已提交"
        : action === "resume"
          ? "运行已继续"
          : "取消请求已提交";
      state.error = null;
      state.message = progressLabel;
      render();
      return remember((async () => {
        try {
          const result = await api.controlRun(
            latestRun.id,
            action,
            etag,
            normalizedReason
          );
          await refreshAfterRunMutation(context, result, completedLabel);
        } catch (error) {
          if (runMutationIsCurrent(context)) {
            state.error = errorText(error);
            state.message = null;
            render();
          }
          throw error;
        } finally {
          if (context.serial === runMutationSerial) {
            runMutating = false;
            state.runControlBusy = false;
            render();
          }
        }
      })());
    },

    reviewCandidate(action, reason = "") {
      const candidateId = state.selectedCandidateId;
      const candidate = state.candidateDetail?.candidate;
      const status = typeof candidate?.status === "string" ? candidate.status : null;
      const decisionVersion = typeof candidate?.latestDecisionVersion === "string"
        ? candidate.latestDecisionVersion.trim()
        : "";
      const normalizedReason = reason.trim();
      const allowed = [
        "approved",
        "rejected",
        "do_not_contact",
        "needs_research",
        "reopen"
      ].includes(action);
      if (!allowed) return rejectValidation("审核动作无效");
      if (!candidateId || !candidate) {
        return rejectValidation("请先选择一个候选");
      }
      if (!decisionVersion) {
        return rejectValidation("候选缺少当前资格决定版本，不能审核");
      }
      if (action === "reopen" ? status !== "rejected" : status !== "pending_review") {
        return rejectValidation(
          action === "reopen"
            ? "只有已驳回候选可以重开"
            : "候选当前不在待审核状态"
        );
      }
      if (["rejected", "needs_research", "reopen"].includes(action)
        && !normalizedReason) {
        return rejectValidation("该审核动作必须填写原因");
      }
      if (action === "do_not_contact"
        && !ask("确认将该候选标记为禁止联系？")) {
        return Promise.resolve();
      }
      if (mutating) return rejectValidation("另一项候选操作正在进行");

      const input = {
        action,
        decisionVersion,
        reason: normalizedReason || null
      };
      const idempotency = stableKey("review-candidate", { candidateId, ...input });
      const context = beginMutation(candidateId);
      state.error = null;
      state.message = "正在提交人工审核…";
      render();
      return remember((async () => {
        try {
          await api.reviewCandidate(candidateId, input, idempotency.value);
          pendingIdempotencyKeys.delete(idempotency.id);
          if (!mutationIsCurrent(context)) return;
          eventTarget.dispatchEvent(customEvent(
            "goodjob:acquisition-candidate-changed",
            { planId: context.planId, candidateId, action }
          ));
          await refreshAfterMutation(
            context,
            "审核已记录，正在刷新候选…",
            "审核已记录"
          );
        } catch (error) {
          if (mutationIsCurrent(context)) {
            state.error = error instanceof Error ? error.message : "审核提交失败";
            state.message = null;
            render();
          }
          throw error;
        } finally {
          if (context.serial === mutationSerial) mutating = false;
        }
      })());
    },

    startIntelligence() {
      const candidateId = state.selectedCandidateId;
      const candidate = state.candidateDetail?.candidate;
      if (!candidateId || !candidate) {
        return rejectValidation("请先选择一个候选");
      }
      if (candidate.identityResolved !== true) {
        return rejectValidation("候选主体尚未完成公开身份核验");
      }
      if (state.candidateDetail?.qualification) {
        return rejectValidation("候选已有有效资格研判，无需重复启动");
      }
      if (mutating) return rejectValidation("另一项候选操作正在进行");

      const idempotency = stableKey("start-intelligence", { candidateId });
      const context = beginMutation(candidateId);
      state.error = null;
      state.message = "正在启动 AI 客户情报与资格研判…";
      render();
      return remember((async () => {
        try {
          await api.startIntelligenceOperation(candidateId, idempotency.value);
          pendingIdempotencyKeys.delete(idempotency.id);
          if (!mutationIsCurrent(context)) return;
          eventTarget.dispatchEvent(customEvent(
            "goodjob:acquisition-candidate-changed",
            {
              planId: context.planId,
              candidateId,
              action: "intelligence_started"
            }
          ));
          await refreshAfterMutation(
            context,
            "AI 研判任务已启动，正在刷新状态…",
            "AI 研判任务已启动"
          );
        } catch (error) {
          if (mutationIsCurrent(context)) {
            state.error = error instanceof Error ? error.message : "AI 研判任务启动失败";
            state.message = null;
            render();
          }
          throw error;
        } finally {
          if (context.serial === mutationSerial) mutating = false;
        }
      })());
    },

    destroy() {
      if (disposed) return;
      disposed = true;
      invalidateMutation();
      invalidateRunMutation();
      requestSerial += 1;
      candidateSerial += 1;
      pendingIdempotencyKeys.clear();
      eventTarget.removeEventListener(
        "goodjob:acquisition-detail-open-requested",
        onOpenRequested as EventListener
      );
      root?.removeEventListener("click", onRootClick);
      root?.removeEventListener("submit", onRootSubmit);
      root?.removeEventListener("close", onRootClose);
    }
  };

  function onOpenRequested(event: Event): void {
    const detail = (event as CustomEvent<DetailOpenRequest>).detail;
    const mode = requestedMode(detail?.mode);
    const planId = requestedPlanId(detail?.planId);
    if (!mode || !planId) return;
    void controller.open(mode, planId).catch(() => undefined);
  }

  function consume(promise: Promise<void>): void {
    void promise.catch(() => undefined);
  }

  function actionTarget(event: Event): HTMLElement | null {
    const target = event.target as {
      closest?: (selector: string) => HTMLElement | null;
    } | null;
    const action = target?.closest?.("[data-acquisition-detail-action]") ?? null;
    return action && root?.contains(action) ? action : null;
  }

  function onRootClick(event: Event): void {
    const target = actionTarget(event);
    if (!target) return;
    const action = target.dataset.acquisitionDetailAction;
    if (action === "close") {
      controller.close();
    } else if (action === "switch-mode") {
      const mode = requestedMode(target.dataset.mode);
      if (mode) controller.switchMode(mode);
    } else if (action === "select-candidate") {
      consume(controller.selectCandidate(target.dataset.candidateId ?? ""));
    } else if (action === "load-more-candidates") {
      consume(controller.loadMoreCandidates());
    } else if (action === "retry") {
      if (currentPlanId) consume(controller.open(state.mode, currentPlanId));
    } else if (action === "start-intelligence") {
      event.preventDefault();
      consume(controller.startIntelligence());
    } else if (action === "review") {
      event.preventDefault();
      const reviewAction = target.dataset.reviewAction as AcquisitionCandidateReviewAction;
      const reasonControl = root?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[name="reviewReason"]'
      );
      consume(controller.reviewCandidate(reviewAction, reasonControl?.value ?? ""));
    } else if (action === "run-control") {
      event.preventDefault();
      const runAction = target.dataset.acquisitionRunAction;
      const reasonControl = root?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[name="runControlReason"]'
      );
      const reason = reasonControl?.value ?? "";
      if (runAction === "start") {
        consume(controller.startRun(reason));
      } else {
        consume(controller.controlRun(
          runAction as AcquisitionRunControlAction,
          reason
        ));
      }
    }
  }

  function onRootSubmit(event: Event): void {
    const form = event.target as HTMLFormElement | null;
    if (form?.dataset?.acquisitionDetailForm !== "review") return;
    event.preventDefault();
    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;
    const submitter = (event as SubmitEvent).submitter as HTMLElement | null;
    const action = submitter?.dataset.reviewAction
      ?? (form.elements.namedItem("action") as HTMLInputElement | null)?.value;
    const reason = (form.elements.namedItem("reviewReason") as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null)?.value ?? "";
    consume(controller.reviewCandidate(
      action as AcquisitionCandidateReviewAction,
      reason
    ));
  }

  function onRootClose(): void {
    invalidateMutation();
    invalidateRunMutation();
    requestSerial += 1;
    candidateSerial += 1;
    finishClose();
  }

  eventTarget.addEventListener(
    "goodjob:acquisition-detail-open-requested",
    onOpenRequested as EventListener
  );
  resolveDom();
  root?.addEventListener("click", onRootClick);
  root?.addEventListener("submit", onRootSubmit);
  root?.addEventListener("close", onRootClose);
  render();

  return controller;
}

let singleton: AcquisitionDetailCenterController | null = null;

export function startAcquisitionDetailCenter(): AcquisitionDetailCenterController {
  singleton ??= createAcquisitionDetailCenterController();
  return singleton;
}
