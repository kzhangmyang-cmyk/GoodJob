import {
  createAiGrowthApi,
  advisorHttpStatus,
  type AdvisorRequest,
  type AiGrowthApi,
  type CandidateConversionDto,
  type EvidenceDto,
  type PlanDtoWithEtag,
  type ProviderConnectionDto,
  type TodoCreateDto
} from "./api.js";
import {
  createRunPresentationPoller,
  type RunPresentationPoller,
  type RunPresentationPollerOptions
} from "./poll-run.js";
import {
  createDemoRunner,
  type AdvisorDemoEvent,
  type CreateDemoRunnerOptions,
  type DemoRunner
} from "./demo/runner.js";
import {
  createBattleCardDrawer,
  type BattleCardDrawer,
  type BattleCardDrawerOptions,
  type CandidateReviewAction
} from "./components/battle-card-drawer.js";
import { renderAdvisorShell } from "./components/shell.js";
import {
  renderTaskInput,
  type RecentAdvisorTaskVm,
  type SearchConnectionHealthVm
} from "./components/task-input.js";
import { renderPlanApproval } from "./components/plan-approval.js";
import { renderConnectionRequired } from "./components/connection-required.js";
import {
  renderRunConsole,
  type RunProviderVm,
  type RunTimelineItemVm
} from "./components/run-console.js";
import { renderExecutiveSummary } from "./components/executive-summary.js";
import {
  defaultIndustryTemplateId,
  industryTemplates
} from "./templates.js";
import {
  financialValueVm,
  mergePresentation,
  pageStatusForRun,
  searchProviderLabel
} from "./view-model.js";
import type {
  AdvisorMode,
  AdvisorRunVm,
  AdvisorState,
  BattleCardDto,
  CandidateCardVm,
  CandidateDto,
  FinancialValueDto,
  IndustryTemplateId,
  QualificationDto,
  RunDto
} from "./types.js";

export interface AiGrowthUser {
  id: string;
}

export interface AiGrowthDependencies {
  request: AdvisorRequest;
  toast(message: string): void;
  navigate(view: string): void;
  currentUser(): AiGrowthUser | null;
  document?: Document;
}

export type AiGrowthControllerApi = AiGrowthApi;

export interface RecentAdvisorPointer {
  sessionId: string;
  planId: string;
  runId: string;
  updatedAt: string;
}

export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AiGrowthControllerOptions {
  api: AiGrowthControllerApi;
  user(): AiGrowthUser | null;
  toast(message: string): void;
  navigate(view: string): void;
  wait?(delayMs: number): Promise<void>;
  recentStorage?: RecentStorage;
  validateSession?(sessionId: string): Promise<unknown>;
  pollerFactory?(options: RunPresentationPollerOptions): RunPresentationPoller;
  drawerFactory?(options: BattleCardDrawerOptions): BattleCardDrawer;
  demoRunnerFactory?(options: CreateDemoRunnerOptions): DemoRunner;
  onChange?(state: AdvisorState): void;
}

export interface AiGrowthController {
  getState(): AdvisorState;
  getDrawer(): BattleCardDrawer;
  getConnections(): readonly ProviderConnectionDto[];
  getRecentTasks(): readonly RecentAdvisorPointer[];
  setMode(mode: AdvisorMode): void;
  setTaskText(value: string, notify?: boolean): void;
  selectTemplate(templateId: IndustryTemplateId): void;
  editPlan(): void;
  cancelPlan(): void;
  submit(): Promise<void>;
  approve(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  jumpToDemoResult(): void;
  applyCandidateUpdate(candidate: CandidateDto): void;
  openCandidate(candidateId: string): Promise<void>;
  reviewCandidate(
    action: CandidateReviewAction,
    reason?: string | null
  ): Promise<void>;
  convertAndCreateTodo(candidateId: string): Promise<void>;
  createOutreachReviewTask(): Promise<void>;
  continueRecent(runId: string): Promise<void>;
  render(root: HTMLElement): void;
  enter(): void;
  leave(): void;
  dispose(): void;
}

const TERMINAL_COPILOT_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled"
]);

function initialState(): AdvisorState {
  const template = industryTemplates.find(
    (item) => item.id === defaultIndustryTemplateId
  )!;
  return {
    mode: "real",
    status: "idle",
    taskText: template.taskText,
    templateId: template.id,
    planDraft: null,
    runId: null,
    cursor: null,
    candidatesById: new Map(),
    summary: null,
    error: null
  };
}

function idempotencyKey(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${id}`;
}

function messageOf(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "操作失败，请稍后重试";
}

function candidateCardFromDomain(
  candidate: CandidateDto,
  previous?: CandidateCardVm
): CandidateCardVm {
  const displayName = candidate.subjectKind === "organization"
    ? candidate.name
    : candidate.publicDisplayName;
  return {
    id: candidate.id,
    subjectKind: candidate.subjectKind,
    displayName,
    industry: previous?.industry ?? null,
    region: candidate.subjectKind === "organization"
      ? candidate.region
      : candidate.locationHint,
    domain: candidate.subjectKind === "organization"
      ? candidate.domain
      : candidate.publicProfileUrl,
    status: candidate.status,
    updatedAt: candidate.updatedAt,
    qualification: previous?.qualification ?? null,
    financialValue: previous?.financialValue ?? financialValueVm(null),
    sourcePlatforms: previous?.sourcePlatforms ?? (
      candidate.subjectKind === "individual"
        ? [candidate.sourcePlatform]
        : []
    ),
    evidenceCount: candidate.evidenceIds.length,
    isHighIntent: previous?.isHighIntent ?? false,
    isValidOpportunity: previous?.isValidOpportunity ?? false
  };
}

function demoCandidateFromPresentation(
  candidate: CandidateCardVm,
  qualification: QualificationDto | null,
  evidence: readonly EvidenceDto[]
): CandidateDto {
  const common = {
    id: candidate.id,
    status: candidate.status,
    latestDecisionVersion: qualification?.decisionVersion ?? null,
    approvedDecisionVersion: candidate.status === "approved"
      ? qualification?.decisionVersion ?? null
      : null,
    updatedAt: candidate.updatedAt,
    evidenceIds: evidence.map((item) => item.id)
  };
  if (candidate.subjectKind === "organization") {
    return {
      ...common,
      subjectKind: "organization",
      name: candidate.displayName,
      domain: candidate.domain,
      region: candidate.region,
      creditCode: null,
      createdAt: candidate.updatedAt
    };
  }
  return {
    ...common,
    subjectKind: "individual",
    publicActorKey: candidate.id,
    publicDisplayName: candidate.displayName,
    publicProfileUrl: candidate.domain ?? "",
    sourcePlatform: candidate.sourcePlatforms[0] ?? "demo",
    demandCategory: "公开需求信号",
    demandSummary: qualification?.reasons.join("；") ?? "演示数据",
    locationHint: candidate.region ?? "",
    buyingStage: "awareness",
    negativeSignals: qualification?.negativeSignals.map(
      (item) => item.name
    ) ?? [],
    firstSeenAt: candidate.updatedAt,
    lastSeenAt: candidate.updatedAt
  };
}

function healthyConnections(
  connections: readonly ProviderConnectionDto[]
): ProviderConnectionDto[] {
  return connections.filter((connection) =>
    connection.status === "active"
    && connection.kind === "search"
  );
}

function cloneState(state: AdvisorState): AdvisorState {
  return {
    ...state,
    candidatesById: new Map(state.candidatesById)
  };
}

function recentKey(userId: string) {
  return `goodjob.ai-growth.recent.${userId}`;
}

function parseRecent(value: string | null): RecentAdvisorPointer[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): RecentAdvisorPointer[] =>
      Boolean(
        item
        && typeof item.sessionId === "string"
        && typeof item.planId === "string"
        && typeof item.runId === "string"
        && typeof item.updatedAt === "string"
      )
        ? [{
            sessionId: item.sessionId,
            planId: item.planId,
            runId: item.runId,
            updatedAt: item.updatedAt
          }]
        : []
    ).slice(0, 10);
  } catch {
    return [];
  }
}

function runTimeline(
  status: AdvisorState["status"]
): RunTimelineItemVm[] {
  const order = [
    ["plan", "方案已批准"],
    ["search", "搜索公开来源"],
    ["normalize", "整理与去重"],
    ["qualify", "意向与财务评估"]
  ] as const;
  return order.map(([id, label], index) => {
    if (["completed", "partial_success", "empty"].includes(status)) {
      return {
        id,
        label,
        state: status === "partial_success" && index === 1
          ? "warning" as const
          : "completed" as const,
        detail: status === "partial_success" && index === 1
          ? "部分来源受限"
          : "服务端已确认"
      };
    }
    if (status === "failed") {
      return {
        id,
        label,
        state: index === 1 ? "failed" as const : "pending" as const,
        detail: index === 1 ? "执行失败" : "等待结果"
      };
    }
    return {
      id,
      label,
      state: index === 0
        ? "completed" as const
        : index === 1
          ? status === "paused"
            ? "warning" as const
            : "running" as const
          : "pending" as const,
      detail: index === 0
        ? "人工批准完成"
        : index === 1
          ? status === "paused" ? "已暂停" : "真实运行中"
          : "等待上一步"
    };
  });
}

export function createAiGrowthController(
  options: AiGrowthControllerOptions
): AiGrowthController {
  const wait = options.wait ?? ((delayMs: number) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)));
  const storage = options.recentStorage
    ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  const makePoller = options.pollerFactory ?? createRunPresentationPoller;
  const makeDrawer = options.drawerFactory ?? createBattleCardDrawer;
  const makeDemoRunner = options.demoRunnerFactory ?? createDemoRunner;
  let state = initialState();
  let connections: ProviderConnectionDto[] = [];
  let recentTasks: RecentAdvisorPointer[] = [];
  let runVm: AdvisorRunVm | null = null;
  let sessionId: string | null = null;
  let plan: PlanDtoWithEtag | null = null;
  let currentRun: RunDto | null = null;
  let demoRunner: DemoRunner | null = null;
  let disposed = false;
  let operationGeneration = 0;
  let approvalInFlight: Promise<void> | null = null;
  const pendingConversions = new Map<string, {
    conversion: CandidateConversionDto;
    todo: TodoCreateDto;
  }>();
  const conversionOperations = new Map<string, Promise<void>>();
  const demoBattleCards = new Map<string, BattleCardDto>();
  const demoDuplicateMerges: Array<
    Extract<AdvisorDemoEvent, { type: "duplicate_merged" }>["duplicateMerge"]
  > = [];
  const demoQualifications = new Map<string, QualificationDto>();
  const demoFinancialValues = new Map<string, FinancialValueDto>();
  const demoEvidence = new Map<string, EvidenceDto[]>();

  const resetDemoArtifacts = () => {
    demoBattleCards.clear();
    demoDuplicateMerges.length = 0;
    demoQualifications.clear();
    demoFinancialValues.clear();
    demoEvidence.clear();
  };

  const publish = () => {
    options.onChange?.(cloneState(state));
  };

  const setError = (error: unknown, fallbackCode = "advisor_error") => {
    state = {
      ...state,
      status: "failed",
      error: {
        code: fallbackCode,
        message: messageOf(error),
        retryable: advisorHttpStatus(error) === null
          || advisorHttpStatus(error)! >= 500
      }
    };
    publish();
  };

  const poller = makePoller({
    getRunPresentation: (runId, input, signal) =>
      options.api.getRunPresentation(runId, input, signal),
    onUpdate(viewModel) {
      runVm = viewModel;
      currentRun = viewModel.run;
      state = {
        ...state,
        status: pageStatusForRun(viewModel.run.status),
        runId: viewModel.run.id,
        cursor: viewModel.nextAfter,
        candidatesById: new Map(viewModel.candidatesById),
        summary: viewModel.summary,
        error: null
      };
      publish();
    },
    onState(event) {
      if (event.type === "error") setError(event.error, "presentation_error");
    }
  });

  const drawer = makeDrawer({
    api: options.api,
    onCandidateUpdated(candidate) {
      controller.applyCandidateUpdate(candidate);
    },
    onStateChange() {
      publish();
    },
    wait
  });

  const stopDemo = () => {
    demoRunner?.dispose();
    demoRunner = null;
  };

  const applyDemoEvent = (event: AdvisorDemoEvent) => {
    if (state.mode !== "demo" || disposed) return;
    if (event.type === "state") {
      state = {
        ...state,
        status: event.state.status,
        planDraft: event.state.planDraft,
        runId: event.state.runId,
        cursor: event.state.cursor,
        error: null
      };
    } else if (event.type === "presentation") {
      for (const candidateEvent of event.presentation.candidateEvents) {
        const qualification = candidateEvent.qualification;
        if (qualification) {
          demoQualifications.set(candidateEvent.candidateId, qualification);
          demoEvidence.set(
            candidateEvent.candidateId,
            qualification.evidence.map((item) => ({
              id: item.evidenceId,
              targetType: candidateEvent.candidate.subjectKind === "organization"
                ? "organization"
                : "individual_signal",
              sourcePlatform:
                candidateEvent.sourcePlatforms[0] ?? "demo_search",
              sourceTitle:
                `${candidateEvent.candidate.displayName} · 演示公开信号`,
              sourceSnippet: item.excerpt,
              publishedAt: candidateEvent.createdAt,
              fetchedAt: candidateEvent.createdAt,
              locale: "zh-CN",
              rawArtifactHash: `demo-raw-${item.evidenceId}`,
              contentHash: `demo-content-${item.evidenceId}`,
              provenance: {},
              accessStatus: "indexed_summary"
            }))
          );
        }
        if (candidateEvent.financialValue) {
          demoFinancialValues.set(
            candidateEvent.candidateId,
            candidateEvent.financialValue
          );
        }
      }
      runVm = mergePresentation(
        runVm ?? {
          run: event.presentation.run,
          providers: [],
          summary: null,
          candidatesById: new Map(),
          nextAfter: "",
          hasMore: false
        },
        event.presentation
      );
      currentRun = runVm.run;
      state = {
        ...state,
        status: pageStatusForRun(runVm.run.status),
        runId: runVm.run.id,
        cursor: runVm.nextAfter,
        candidatesById: new Map(runVm.candidatesById),
        summary: runVm.summary
      };
    } else if (event.type === "battle_card") {
      demoBattleCards.set(event.battleCard.candidateId, event.battleCard);
    } else if (event.type === "duplicate_merged") {
      demoDuplicateMerges.push(event.duplicateMerge);
    } else if (event.type === "summary" && runVm) {
      state = { ...state, summary: runVm.summary };
    }
    publish();
  };

  const ensureDemoRunner = () => {
    if (demoRunner) return demoRunner;
    demoRunner = makeDemoRunner({ onEvent: applyDemoEvent });
    return demoRunner;
  };

  const saveRecent = () => {
    const user = options.user();
    if (!storage || !user || !sessionId || !plan || !currentRun) return;
    const pointer: RecentAdvisorPointer = {
      sessionId,
      planId: plan.id,
      runId: currentRun.id,
      updatedAt: currentRun.updatedAt
    };
    recentTasks = [
      pointer,
      ...recentTasks.filter((item) => item.runId !== pointer.runId)
    ].slice(0, 10);
    storage.setItem(recentKey(user.id), JSON.stringify(recentTasks));
  };

  const readRecent = () => {
    const user = options.user();
    recentTasks = !storage || !user
      ? []
      : parseRecent(storage.getItem(recentKey(user.id)));
  };

  const validateRecent = async (generation: number) => {
    const user = options.user();
    if (!storage || !user) return;
    const validated: RecentAdvisorPointer[] = [];
    for (const pointer of recentTasks) {
      if (
        disposed
        || generation !== operationGeneration
        || state.mode !== "real"
      ) return;
      try {
        await Promise.all([
          options.api.getRun(pointer.runId),
          options.validateSession?.(pointer.sessionId) ?? Promise.resolve()
        ]);
        if (
          disposed
          || generation !== operationGeneration
          || state.mode !== "real"
        ) return;
        validated.push(pointer);
      } catch (error) {
        if (
          disposed
          || generation !== operationGeneration
          || state.mode !== "real"
        ) return;
        if (advisorHttpStatus(error) !== 404) validated.push(pointer);
      }
    }
    if (
      disposed
      || generation !== operationGeneration
      || state.mode !== "real"
    ) return;
    recentTasks = validated.slice(0, 10);
    storage.setItem(recentKey(user.id), JSON.stringify(recentTasks));
    publish();
  };

  const pollCopilotTask = async (
    initial: Awaited<ReturnType<AiGrowthApi["requestPlanDraft"]>>,
    generation: number
  ) => {
    let task = initial;
    while (!TERMINAL_COPILOT_STATUSES.has(task.status)) {
      await wait(1_000);
      if (
        disposed
        || generation !== operationGeneration
        || state.mode !== "real"
      ) return null;
      task = await options.api.getCopilotTask(task.id);
    }
    return task;
  };

  const controller: AiGrowthController = {
    getState: () => cloneState(state),
    getDrawer: () => drawer,
    getConnections: () => connections,
    getRecentTasks: () => recentTasks,

    setMode(mode) {
      if (state.mode === mode) {
        if (mode === "demo") ensureDemoRunner();
        return;
      }
      operationGeneration += 1;
      poller.stop();
      stopDemo();
      resetDemoArtifacts();
      drawer.close();
      runVm = null;
      currentRun = null;
      sessionId = null;
      plan = null;
      pendingConversions.clear();
      state = {
        ...initialState(),
        mode,
        taskText: state.taskText,
        templateId: state.templateId
      };
      if (mode === "demo") ensureDemoRunner();
      publish();
    },

    setTaskText(value, notify = true) {
      state = { ...state, taskText: value };
      if (notify) publish();
    },

    selectTemplate(templateId) {
      const selected = industryTemplates.find(
        (template) => template.id === templateId
      );
      if (!selected) return;
      state = {
        ...state,
        templateId,
        taskText: selected.taskText,
        planDraft: null,
        status: "idle",
        error: null
      };
      publish();
    },

    editPlan() {
      if (state.status !== "awaiting_approval") return;
      state = {
        ...state,
        status: "idle",
        planDraft: null,
        error: null
      };
      publish();
    },

    cancelPlan() {
      if (state.status !== "awaiting_approval") return;
      state = {
        ...state,
        status: "cancelled",
        planDraft: null,
        error: null
      };
      publish();
    },

    async submit() {
      if (disposed) return;
      const taskText = state.taskText.trim();
      if (!taskText) throw new Error("请先填写商机搜索任务");
      if (state.mode === "demo") {
        stopDemo();
        resetDemoArtifacts();
        drawer.close();
        ensureDemoRunner().start();
        return;
      }

      const generation = ++operationGeneration;
      state = { ...state, status: "planning", error: null };
      publish();
      try {
        const listed = await options.api.listProviderConnections();
        if (generation !== operationGeneration) return;
        connections = listed.items;
        if (healthyConnections(connections).length === 0) {
          state = {
            ...state,
            status: "connection_required",
            error: null
          };
          publish();
          return;
        }
        if (!sessionId) {
          sessionId = (await options.api.createSession(
            {},
            idempotencyKey("ai-growth-session")
          )).id;
        }
        if (generation !== operationGeneration) return;
        const requested = await options.api.requestPlanDraft(
          sessionId,
          taskText,
          idempotencyKey("ai-growth-plan-draft")
        );
        const task = await pollCopilotTask(requested, generation);
        if (!task || generation !== operationGeneration) return;
        if (task.status !== "succeeded" || !task.result?.planDraft) {
          throw new Error(
            task.status === "cancelled"
              ? "方案生成已取消"
              : "方案生成失败，请重新提交"
          );
        }
        state = {
          ...state,
          status: "awaiting_approval",
          planDraft: task.result.planDraft,
          error: null
        };
        publish();
      } catch (error) {
        if (generation === operationGeneration) {
          setError(error, "plan_draft_failed");
        }
        throw error;
      }
    },

    approve() {
      if (approvalInFlight) return approvalInFlight;
      if (state.status !== "awaiting_approval" || !state.planDraft) {
        return Promise.reject(new Error("当前没有等待批准的搜索方案"));
      }
      if (state.mode === "demo") {
        ensureDemoRunner().approve();
        return Promise.resolve();
      }
      const generation = operationGeneration;
      const draft = state.planDraft;
      const planOperationKey = idempotencyKey("ai-growth-plan");
      const runOperationKey = idempotencyKey("ai-growth-run");
      const operation = (async () => {
        try {
          plan = await options.api.createPlan(draft, planOperationKey);
          if (generation !== operationGeneration) return;
          plan = await options.api.approvePlan(
            plan.id,
            plan.etag,
            { decision: "approve", reason: "用户确认方案与预算后开始执行" }
          );
          if (generation !== operationGeneration) return;
          currentRun = await options.api.createRun(
            plan.id,
            { reason: "已完成人工批准，开始执行公开商机搜索" },
            runOperationKey
          );
          if (generation !== operationGeneration) return;
          state = {
            ...state,
            status: pageStatusForRun(currentRun.status),
            runId: currentRun.id,
            cursor: null,
            candidatesById: new Map(),
            summary: null,
            error: null
          };
          saveRecent();
          publish();
          poller.start(currentRun.id, "real");
        } catch (error) {
          if (generation === operationGeneration && !disposed) {
            setError(error, "run_start_failed");
          }
          throw error;
        }
      })();
      approvalInFlight = operation;
      publish();
      const clearApproval = () => {
        if (approvalInFlight !== operation) return;
        approvalInFlight = null;
        if (state.status === "awaiting_approval" && !disposed) publish();
      };
      void operation.then(clearApproval, clearApproval);
      return operation;
    },

    async pause() {
      if (state.mode === "demo") {
        ensureDemoRunner().pause();
        return;
      }
      if (!currentRun || state.status !== "running") {
        throw new Error("当前没有可暂停的运行");
      }
      currentRun = await options.api.pauseRun(
        currentRun.id,
        currentRun.etag,
        "用户暂停运行"
      );
      state = { ...state, status: pageStatusForRun(currentRun.status) };
      publish();
    },

    async resume() {
      if (state.mode === "demo") {
        ensureDemoRunner().resume();
        return;
      }
      if (!currentRun || state.status !== "paused") {
        throw new Error("当前没有可继续的运行");
      }
      currentRun = await options.api.resumeRun(
        currentRun.id,
        currentRun.etag,
        "用户继续运行"
      );
      state = { ...state, status: pageStatusForRun(currentRun.status) };
      publish();
      poller.start(currentRun.id, "real");
    },

    async cancel() {
      if (state.mode === "demo") {
        stopDemo();
        resetDemoArtifacts();
        drawer.close();
        state = { ...state, status: "cancelled" };
        publish();
        return;
      }
      if (!currentRun || !["running", "paused"].includes(state.status)) {
        throw new Error("当前没有可取消的运行");
      }
      currentRun = await options.api.cancelRun(
        currentRun.id,
        currentRun.etag,
        "用户取消运行"
      );
      poller.stop();
      state = { ...state, status: pageStatusForRun(currentRun.status) };
      publish();
    },

    jumpToDemoResult() {
      if (state.mode === "demo") ensureDemoRunner().jumpToResult();
    },

    applyCandidateUpdate(candidate) {
      const candidatesById = new Map(state.candidatesById);
      candidatesById.set(
        candidate.id,
        candidateCardFromDomain(candidate, candidatesById.get(candidate.id))
      );
      state = { ...state, candidatesById };
      publish();
    },

    async openCandidate(candidateId) {
      if (state.mode === "demo") {
        const candidate = state.candidatesById.get(candidateId);
        const card = demoBattleCards.get(candidateId);
        if (!candidate || !card) {
          drawer.close();
          options.toast("演示作战卡尚未生成");
          publish();
          return;
        }
        const qualification =
          demoQualifications.get(candidateId) ?? candidate.qualification;
        const evidence = demoEvidence.get(candidateId) ?? [];
        drawer.openFixture(
          demoCandidateFromPresentation(
            candidate,
            qualification ?? null,
            evidence
          ),
          card,
          evidence,
          qualification ?? null,
          demoFinancialValues.get(candidateId) ?? null
        );
        publish();
        return;
      }
      await drawer.open(candidateId);
      publish();
    },

    async reviewCandidate(action, reason = null) {
      if (state.mode === "demo") {
        throw new Error("演示模式不会提交真实审核");
      }
      await drawer.review(action, reason);
      publish();
    },

    convertAndCreateTodo(candidateId) {
      if (state.mode === "demo") {
        return Promise.reject(
          new Error("演示模式不会写入真实线索或待办")
        );
      }
      const inFlight = conversionOperations.get(candidateId);
      if (inFlight) return inFlight;
      const conversionOperationKey = idempotencyKey("ai-growth-convert");
      const operation = (async () => {
        let pending = pendingConversions.get(candidateId);
        if (!pending) {
          const candidate = await options.api.getCandidate(candidateId);
          if (
            candidate.status !== "approved"
            || !candidate.latestDecisionVersion
            || candidate.approvedDecisionVersion
              !== candidate.latestDecisionVersion
          ) {
            throw new Error("当前资格决定尚未获得有效批准");
          }
          const conversion = await options.api.convertCandidate(
            candidateId,
            { decisionVersion: candidate.latestDecisionVersion },
            conversionOperationKey
          );
          const title = candidate.subjectKind === "organization"
            ? candidate.name
            : candidate.publicDisplayName;
          pending = {
            conversion,
            todo: {
              title: `跟进${title}`,
              type: "customer",
              priority: "high",
              dueAt: new Date(
                Date.now() + 24 * 60 * 60 * 1_000
              ).toISOString(),
              related: conversion.leadId
            }
          };
          pendingConversions.set(candidateId, pending);
        }
        await options.api.createTodoForConversion(
          pending.conversion.id,
          pending.todo
        );
        pendingConversions.delete(candidateId);
        const updated = await options.api.getCandidate(candidateId);
        controller.applyCandidateUpdate(updated);
        options.toast("已转为线索并创建跟进任务");
      })();
      conversionOperations.set(candidateId, operation);
      const clearConversion = () => {
        if (conversionOperations.get(candidateId) === operation) {
          conversionOperations.delete(candidateId);
        }
      };
      void operation.then(clearConversion, clearConversion);
      return operation;
    },

    async createOutreachReviewTask() {
      if (state.mode === "demo") {
        throw new Error("演示模式不会创建真实触达审核任务");
      }
      await drawer.createOutreachReviewTask();
      publish();
    },

    async continueRecent(runId) {
      if (state.mode === "demo") {
        throw new Error("演示模式不能继续真实任务");
      }
      const pointer = recentTasks.find((item) => item.runId === runId);
      if (!pointer) throw new Error("最近任务已失效");
      currentRun = await options.api.getRun(pointer.runId);
      sessionId = pointer.sessionId;
      plan = await options.api.getPlan(pointer.planId);
      state = {
        ...state,
        mode: "real",
        status: pageStatusForRun(currentRun.status),
        taskText: plan.objective,
        planDraft: plan,
        runId: currentRun.id,
        cursor: null,
        error: null
      };
      publish();
      poller.start(currentRun.id, "real");
    },

    render(root) {
      const selectedTemplate = industryTemplates.find(
        (item) => item.id === state.templateId
      ) ?? industryTemplates[0]!;
      const connectionVms: SearchConnectionHealthVm[] =
        connections.map((connection) => ({
          providerId: connection.providerId,
          label: searchProviderLabel(connection.providerId),
          status: connection.status === "active"
            ? "healthy"
            : connection.status === "inactive"
              ? "degraded"
              : "unavailable",
          detail: `${connection.kind} · 凭据版本 ${connection.credentialVersion}`
        }));
      const recentVms: RecentAdvisorTaskVm[] = state.mode === "real"
        ? recentTasks.map((item) => ({
            id: item.runId,
            title: `商机任务 ${item.runId}`,
            statusLabel: "真实任务",
            updatedAtLabel: new Date(item.updatedAt).toLocaleString("zh-CN")
          }))
        : [];
      const candidates = [...state.candidatesById.values()];
      const candidateCallbacks = {
        onOpenBattleCard: (id: string) => void controller.openCandidate(id),
        onPreviewReview: () => options.toast("演示模式仅预览人工审核"),
        onApprove: (id: string) => void controller.openCandidate(id),
        onReject: (id: string) => void controller.openCandidate(id),
        onDoNotContact: (id: string) => void controller.openCandidate(id),
        onRequestResearch: (id: string) => void controller.openCandidate(id),
        onReopen: (id: string) => void controller.openCandidate(id),
        onConvert: (id: string) =>
          void controller.convertAndCreateTodo(id)
      };
      let stage = "";
      if (state.status === "connection_required") {
        const input = renderTaskInput({
          mode: state.mode,
          taskText: state.taskText,
          templates: industryTemplates,
          selectedTemplateId: state.templateId,
          connections: connectionVms,
          recentTasks: recentVms
        }, {
          onModeChange: (mode) => controller.setMode(mode),
          onTaskTextChange: (value) => controller.setTaskText(value),
          onTemplateSelect: (id) => controller.selectTemplate(id),
          onSubmit: () => void controller.submit(),
          onContinueTask: (id) => void controller.continueRecent(id)
        });
        const required = renderConnectionRequired({
          missingKinds: ["搜索 API"],
          message: "真实搜索需要至少一个已启用的官方搜索来源。你的任务内容已保留。"
        }, {
          onConfigure: () => options.navigate("settings"),
          onUseDemo: () => controller.setMode("demo")
        });
        stage = input.html + required.html;
      } else if (state.status === "awaiting_approval" && state.planDraft) {
        stage = renderPlanApproval({
          mode: state.mode,
          approvalStatus: approvalInFlight
            ? "submitting"
            : "awaiting_approval",
          plan: state.planDraft,
          targetProfile: selectedTemplate.draft.targetProfile,
          companySize: selectedTemplate.draft.companySize,
          demandSignals: selectedTemplate.draft.demandSignals,
          searchTopics: state.planDraft.operations
            .map((item) => item.query ?? item.sourceRef ?? "")
            .filter(Boolean)
        }, {
          onApprove: () => void controller.approve(),
          onEdit: () => controller.editPlan(),
          onCancel: () => controller.cancelPlan()
        }).html;
      } else if (
        state.runId
        || ["running", "paused", "partial_success", "completed", "empty"]
          .includes(state.status)
      ) {
        const providers: RunProviderVm[] = (runVm?.providers ?? []).map(
          (provider) => ({
            providerId: searchProviderLabel(
              provider.providerId,
              state.mode === "demo"
            ),
            status: provider.status,
            acceptedResultCount: provider.acceptedResultCount,
            failedResultCount: provider.failedResultCount,
            errorCode: provider.errorCode
          })
        );
        stage = renderRunConsole({
          mode: state.mode,
          status: state.status,
          timeline: runTimeline(state.status),
          queryStream: (state.planDraft?.operations ?? [])
            .map((item) => item.query ?? item.sourceRef ?? "")
            .filter(Boolean),
          providers,
          candidates
        }, {
          onPause: () => void controller.pause(),
          onResume: () => void controller.resume(),
          onCancel: () => void controller.cancel(),
          candidateCallbacks
        }).html;
        if (state.summary) {
          stage += renderExecutiveSummary({
            mode: state.mode,
            summary: state.summary,
            topCandidate: candidates[0] ?? null
          }, {
            onViewPriority: () => undefined,
            onBuildBattleCard: (id) =>
              void controller.openCandidate(id).then(() => {
                if (
                  state.mode === "real"
                  && drawer.getState().battleCard.status === "missing"
                ) {
                  return drawer.generateBattleCard();
                }
              }),
            onPreviewConversion: () =>
              options.toast("演示模式不会写入真实线索或待办"),
            onConvert: (id) =>
              void controller.convertAndCreateTodo(id)
          }).html;
        }
      } else {
        stage = renderTaskInput({
          mode: state.mode,
          taskText: state.taskText,
          templates: industryTemplates,
          selectedTemplateId: state.templateId,
          connections: connectionVms,
          recentTasks: recentVms
        }, {
          onModeChange: (mode) => controller.setMode(mode),
          onTaskTextChange: (value) => controller.setTaskText(value),
          onTemplateSelect: (id) => controller.selectTemplate(id),
          onSubmit: () => void controller.submit(),
          onContinueTask: (id) => void controller.continueRecent(id)
        }).html;
      }
      const shell = renderAdvisorShell({
        mode: state.mode,
        status: state.status,
        stageHtml: stage,
        statusDetail: state.error?.message
      }, {
        onContinue: () => {
          if (state.status === "paused") void controller.resume();
        }
      });
      root.innerHTML = shell.html + drawer.render().html;
    },

    enter() {
      if (disposed) return;
      readRecent();
      const generation = operationGeneration;
      if (state.mode === "real") void validateRecent(generation);
      if (
        state.mode === "real"
        && currentRun
        && !["completed", "cancelled", "empty", "failed"]
          .includes(state.status)
      ) {
        poller.start(currentRun.id, "real");
      }
      publish();
    },

    leave() {
      operationGeneration += 1;
      poller.stop();
      stopDemo();
      resetDemoArtifacts();
      drawer.close();
      publish();
    },

    dispose() {
      if (disposed) return;
      controller.leave();
      disposed = true;
      poller.dispose();
      drawer.close();
    }
  };

  return controller;
}

export function createMountedAiGrowthAdvisor(
  root: HTMLElement,
  dependencies: AiGrowthDependencies
) {
  const doc = dependencies.document ?? root.ownerDocument;
  const api = createAiGrowthApi(dependencies.request);
  let previousFocus: HTMLElement | null = null;
  let drawerLocked = false;
  let controller!: AiGrowthController;
  function syncDrawerA11y() {
    const drawerOpen = controller.getDrawer().getState().open;
    if (drawerOpen && !drawerLocked) {
      previousFocus = doc.activeElement instanceof HTMLElement
        ? doc.activeElement
        : null;
      doc.body.style.overflow = "hidden";
      drawerLocked = true;
      queueMicrotask(() =>
        root.querySelector<HTMLElement>(".ai-growth-battle-drawer button")
          ?.focus()
      );
    } else if (!drawerOpen && drawerLocked) {
      doc.body.style.removeProperty("overflow");
      drawerLocked = false;
      previousFocus?.focus();
      previousFocus = null;
    }
  }

  controller = createAiGrowthController({
    api,
    user: dependencies.currentUser,
    toast: dependencies.toast,
    navigate: dependencies.navigate,
    recentStorage: doc.defaultView?.localStorage,
    validateSession: (sessionId) =>
      dependencies.request(
        `/api/v1/acquisition/copilot/sessions/${encodeURIComponent(sessionId)}`
      ),
    onChange() {
      controller.render(root);
      syncDrawerA11y();
    }
  });

  const runAction = async (action: string, element: HTMLElement) => {
    const candidateId = element.dataset.candidateId ?? "";
    switch (action) {
      case "set-mode":
        controller.setMode(element.dataset.mode as AdvisorMode);
        break;
      case "select-template":
        controller.selectTemplate(
          element.dataset.templateId as IndustryTemplateId
        );
        break;
      case "submit-task":
        await controller.submit();
        break;
      case "continue-task":
        await controller.continueRecent(element.dataset.taskId ?? "");
        break;
      case "approve-plan":
        await controller.approve();
        break;
      case "edit-plan":
        controller.editPlan();
        break;
      case "cancel-plan":
        controller.cancelPlan();
        break;
      case "pause-run":
        await controller.pause();
        break;
      case "resume-run":
      case "continue":
        await controller.resume();
        break;
      case "cancel-run":
        await controller.cancel();
        break;
      case "configure-connections":
        dependencies.navigate("settings");
        break;
      case "use-demo":
        controller.setMode("demo");
        break;
      case "open-battle-card":
      case "approve":
      case "reject":
      case "do-not-contact":
      case "request-research":
      case "reopen":
        await controller.openCandidate(candidateId);
        break;
      case "preview-review":
        dependencies.toast("演示模式仅预览人工审核");
        break;
      case "build-battle-card":
        if (controller.getState().mode === "demo") {
          await controller.openCandidate(candidateId);
          break;
        }
        await controller.openCandidate(candidateId);
        if (controller.getDrawer().getState().battleCard.status === "missing") {
          await controller.getDrawer().generateBattleCard();
        }
        break;
      case "close-battle-card":
        controller.getDrawer().close();
        break;
      case "run-qualification":
        await controller.getDrawer().runQualification();
        break;
      case "generate-battle-card":
        await controller.getDrawer().generateBattleCard();
        break;
      case "create-outreach-review":
        await controller.createOutreachReviewTask();
        break;
      case "convert": {
        const drawerCandidate =
          controller.getDrawer().getState().candidateId;
        await controller.convertAndCreateTodo(
          candidateId || drawerCandidate || ""
        );
        break;
      }
      case "preview-conversion":
        dependencies.toast("演示模式不会写入真实线索或待办");
        break;
      case "view-priority":
        root.querySelector("#aiGrowthCandidatesTitle")
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
        break;
      default:
        if (action.startsWith("review-")) {
          const reviewAction = action.slice(
            "review-".length
          ) as CandidateReviewAction;
          const reason = root
            .querySelector<HTMLTextAreaElement>("[data-review-reason]")
            ?.value ?? "";
          await controller.reviewCandidate(reviewAction, reason);
        }
    }
  };

  const onClick = (event: Event) => {
    const element = (event.target as HTMLElement)
      .closest<HTMLElement>("[data-action]");
    if (!element || !root.contains(element)) return;
    event.preventDefault();
    void runAction(element.dataset.action ?? "", element).catch((error) =>
      dependencies.toast(messageOf(error))
    );
  };
  const onInput = (event: Event) => {
    const field = event.target as HTMLTextAreaElement;
    if (field.matches("[data-field='task-text']")) {
      controller.setTaskText(field.value, false);
    }
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (!controller.getDrawer().getState().open) return;
    if (event.key === "Escape") {
      controller.getDrawer().close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...root.querySelectorAll<HTMLElement>(
      ".ai-growth-battle-drawer button:not([disabled]),"
      + ".ai-growth-battle-drawer textarea:not([disabled]),"
      + ".ai-growth-battle-drawer a[href]"
    )];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  doc.addEventListener("keydown", onKeydown);
  controller.render(root);

  return {
    enter: () => controller.enter(),
    leave() {
      controller.leave();
      syncDrawerA11y();
    },
    dispose() {
      controller.dispose();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      doc.removeEventListener("keydown", onKeydown);
      if (drawerLocked) doc.body.style.removeProperty("overflow");
    }
  };
}
