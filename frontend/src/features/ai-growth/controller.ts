import {
  createAiGrowthApi,
  advisorHttpStatus,
  copilotSessionResourceId,
  copilotTaskPlanDraft,
  type AdvisorRequest,
  type AiGrowthApi,
  type CandidateConversionDto,
  type EvidenceDto,
  type PlanDtoWithEtag,
  type ProviderCatalogPageDto,
  type ProviderConnectionDto,
  type ProviderConnectionTestDto,
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
import { renderProviderConnectionCenter } from "./components/provider-connection-center.js";
import {
  renderRunConsole,
  type RunProviderVm,
  type RunTimelineItemVm
} from "./components/run-console.js";
import { renderExecutiveSummary } from "./components/executive-summary.js";
import {
  buildAiGrowthHash,
  deriveTaskOverviewAggregates,
  parseAiGrowthHash,
  renderTaskDetail,
  renderTaskOverview,
  type AiGrowthRoute,
  type TaskDetailVm,
  type TaskOverviewVm
} from "./components/task-overview.js";
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
  AcquisitionTaskPlatform,
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
  initialView?: "overview" | "workflow";
  onChange?(state: AdvisorState): void;
}

export type ProviderConnectionCenterStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export type ProviderConnectionCenterMutationStatus =
  | "idle"
  | "saving"
  | "testing"
  | "updating"
  | "deleting";

export interface ProviderConnectionCenterState {
  open: boolean;
  status: ProviderConnectionCenterStatus;
  providers: ProviderCatalogPageDto["items"];
  connections: ProviderConnectionDto[];
  selectedProviderId: string | null;
  selectedConnectionId: string | null;
  mutationStatus: ProviderConnectionCenterMutationStatus;
  health: ProviderConnectionTestDto | null;
  message: string | null;
  error: AdvisorState["error"];
}

export interface AiGrowthController {
  getState(): AdvisorState;
  getConnectionCenter(): ProviderConnectionCenterState;
  getDrawer(): BattleCardDrawer;
  getConnections(): readonly ProviderConnectionDto[];
  getRecentTasks(): readonly RecentAdvisorPointer[];
  getView(): "overview" | "workflow" | "task";
  getTaskOverview(): TaskOverviewVm;
  openConnectionCenter(): Promise<void>;
  closeConnectionCenter(): void;
  selectConnectionCenterProvider(providerId: string | null): void;
  selectConnectionCenterConnection(connectionId: string | null): void;
  saveProviderConnection(apiKey: string, baseUrl?: string): Promise<void>;
  testProviderConnection(): Promise<void>;
  setProviderConnectionEnabled(enabled: boolean): Promise<void>;
  deleteProviderConnection(): Promise<void>;
  continueAfterConnection(): Promise<void>;
  showOverview(): Promise<void>;
  showNewTask(): void;
  openTask(planId: string): Promise<void>;
  setMode(mode: AdvisorMode): void;
  setTargetPlatform(platform: AcquisitionTaskPlatform): void;
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

const ACTIVE_ACQUISITION_RUN_STATUSES = new Set([
  "queued",
  "running",
  "pause_requested",
  "paused",
  "cancel_requested"
]);

function initialTaskOverview(mode: AdvisorMode): TaskOverviewVm {
  return {
    mode,
    status: mode === "demo" ? "demo" : "loading",
    tasks: [],
    totals: { tasks: 0 },
    statusCounts: {},
    discoveryMethodCounts: {},
    aggregationSource: "none",
    connections: [],
    connectionStatus: mode === "demo" ? "ready" : "loading",
    generatedAt: null,
    errorMessage: null
  };
}

function initialState(): AdvisorState {
  const template = industryTemplates.find(
    (item) => item.id === defaultIndustryTemplateId
  )!;
  return {
    mode: "real",
    status: "idle",
    taskText: template.taskText,
    templateId: template.id,
    targetPlatform: "douyin",
    planDraft: null,
    runId: null,
    cursor: null,
    candidatesById: new Map(),
    summary: null,
    error: null
  };
}

function initialConnectionCenter(): ProviderConnectionCenterState {
  return {
    open: false,
    status: "idle",
    providers: [],
    connections: [],
    selectedProviderId: null,
    selectedConnectionId: null,
    mutationStatus: "idle",
    health: null,
    message: null,
    error: null
  };
}

function cloneConnectionCenter(
  state: ProviderConnectionCenterState
): ProviderConnectionCenterState {
  return {
    ...state,
    providers: state.providers.map((provider) => ({
      ...provider,
      capabilities: [...provider.capabilities]
    })),
    connections: state.connections.map((connection) => ({ ...connection })),
    error: state.error ? { ...state.error } : null
  };
}

function connectionCenterError(
  error: unknown,
  code: string
): NonNullable<AdvisorState["error"]> {
  const status = advisorHttpStatus(error);
  const message = status === 401
    ? "登录已失效，请重新登录"
    : status === 403
      ? "当前搜索来源不可修改"
      : status === 404
        ? "搜索来源不存在或已删除"
        : status === 409
          ? "搜索来源状态已变化，请刷新后重试"
          : status === 422
            ? "连接配置无效，请检查后重试"
            : status === 429
              ? "请求过于频繁，请稍后重试"
              : status !== null && status >= 500
                ? "连接服务暂时不可用，请稍后重试"
                : "操作失败，请稍后重试";
  return {
    code,
    message,
    retryable: status === null || status === 429 || status >= 500
  };
}

function idempotencyKey(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${id}`;
}

function runEtagRevision(etag: string): number | null {
  const match = /^".+:([0-9]+)"$/u.exec(etag);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

function monotonicRunSnapshot(
  current: RunDto | null,
  incoming: RunDto
): RunDto {
  if (current === null || current.id !== incoming.id) return incoming;
  const currentRevision = runEtagRevision(current.etag);
  const incomingRevision = runEtagRevision(incoming.etag);
  return currentRevision !== null
    && incomingRevision !== null
    && incomingRevision < currentRevision
    ? current
    : incoming;
}

function messageOf(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "操作失败，请稍后重试";
}

function isTargetPlatform(value: unknown): value is AcquisitionTaskPlatform {
  return value === "douyin" || value === "web";
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
    && connection.lastHealthStatus === "passed"
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
  let connectionCenter = initialConnectionCenter();
  let connectionCenterGeneration = 0;
  let connectionCenterMutationToken = 0;
  let connectionCenterMutation: Promise<void> | null = null;
  let workspaceView: "overview" | "workflow" | "task" =
    options.initialView ?? "workflow";
  let taskOverview = initialTaskOverview(state.mode);
  let taskDetail: Omit<TaskDetailVm, "runStatus"> = {
    status: "loading",
    detail: null,
    errorMessage: null
  };
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
      currentRun = monotonicRunSnapshot(currentRun, viewModel.run);
      runVm = { ...viewModel, run: currentRun };
      state = {
        ...state,
        status: pageStatusForRun(currentRun.status),
        runId: currentRun.id,
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
        targetPlatform: event.state.targetPlatform,
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

  type ConnectionCenterMutationPatch = Partial<Pick<
    ProviderConnectionCenterState,
    | "selectedProviderId"
    | "selectedConnectionId"
    | "health"
    | "message"
  >>;

  const currentConnectionCenterMutation = (
    generation: number,
    mutationToken: number
  ) => !disposed
    && connectionCenter.open
    && generation === connectionCenterGeneration
    && mutationToken === connectionCenterMutationToken;

  const runConnectionCenterMutation = (
    mutationStatus: Exclude<
      ProviderConnectionCenterMutationStatus,
      "idle"
    >,
    errorCode: string,
    action: () => Promise<(
      searchConnections: ProviderConnectionDto[]
    ) => ConnectionCenterMutationPatch>,
    startPatch: ConnectionCenterMutationPatch = {}
  ): Promise<void> => {
    if (connectionCenterMutation) return connectionCenterMutation;
    const generation = connectionCenterGeneration;
    const mutationToken = ++connectionCenterMutationToken;
    connectionCenter = {
      ...connectionCenter,
      mutationStatus,
      message: null,
      error: null,
      ...startPatch
    };
    publish();
    const operation = (async () => {
      try {
        const resultPatch = await action();
        const listed = await options.api.listProviderConnections();
        if (!currentConnectionCenterMutation(generation, mutationToken)) {
          return;
        }
        connections = [...listed.items];
        const searchConnections = listed.items.filter((connection) =>
          connection.kind === "search");
        connectionCenter = {
          ...connectionCenter,
          connections: searchConnections,
          mutationStatus: "idle",
          message: null,
          error: null,
          ...resultPatch(searchConnections)
        };
        publish();
      } catch (error) {
        if (!currentConnectionCenterMutation(generation, mutationToken)) {
          return;
        }
        const safeError = connectionCenterError(error, errorCode);
        connectionCenter = {
          ...connectionCenter,
          mutationStatus: "idle",
          message: null,
          error: safeError
        };
        publish();
        throw new Error(safeError.message);
      }
    })();
    connectionCenterMutation = operation;
    const clearMutation = () => {
      if (connectionCenterMutation === operation) {
        connectionCenterMutation = null;
      }
    };
    void operation.then(clearMutation, clearMutation);
    return operation;
  };

  const controller: AiGrowthController = {
    getState: () => cloneState(state),
    getConnectionCenter: () => cloneConnectionCenter(connectionCenter),
    getDrawer: () => drawer,
    getConnections: () => connections,
    getRecentTasks: () => recentTasks,
    getView: () => workspaceView,
    getTaskOverview: () => ({
      ...taskOverview,
      tasks: [...taskOverview.tasks],
      totals: { ...taskOverview.totals },
      statusCounts: { ...taskOverview.statusCounts },
      discoveryMethodCounts: { ...taskOverview.discoveryMethodCounts },
      connections: [...taskOverview.connections]
    }),

    async openConnectionCenter() {
      if (disposed) return;
      const generation = ++connectionCenterGeneration;
      connectionCenterMutationToken += 1;
      connectionCenterMutation = null;
      connectionCenter = {
        ...initialConnectionCenter(),
        open: true,
        status: "loading"
      };
      publish();
      const [providersResult, connectionsResult] = await Promise.allSettled([
        options.api.listProviders(),
        options.api.listProviderConnections()
      ]);
      if (
        disposed
        || generation !== connectionCenterGeneration
        || !connectionCenter.open
      ) return;
      if (connectionsResult.status === "fulfilled") {
        connections = [...connectionsResult.value.items];
      }
      connectionCenter = {
        ...connectionCenter,
        status: providersResult.status === "fulfilled"
          && connectionsResult.status === "fulfilled"
          ? "ready"
          : "error",
        providers: providersResult.status === "fulfilled"
          ? providersResult.value.items.filter((provider) =>
              provider.kind === "search")
          : [],
        connections: connectionsResult.status === "fulfilled"
          ? connectionsResult.value.items.filter((connection) =>
              connection.kind === "search")
          : [],
        error: providersResult.status === "fulfilled"
          && connectionsResult.status === "fulfilled"
          ? null
          : {
              code: "connection_center_load_failed",
              message: "搜索来源暂时无法加载，请稍后重试",
              retryable: true
            }
      };
      publish();
    },

    closeConnectionCenter() {
      connectionCenterGeneration += 1;
      connectionCenterMutationToken += 1;
      connectionCenterMutation = null;
      connectionCenter = initialConnectionCenter();
      publish();
    },

    selectConnectionCenterProvider(providerId) {
      if (!connectionCenter.open || connectionCenter.mutationStatus !== "idle") {
        return;
      }
      const selected = providerId === null
        ? null
        : connectionCenter.providers.find((provider) =>
            provider.id === providerId && provider.kind === "search")?.id
          ?? null;
      connectionCenter = {
        ...connectionCenter,
        selectedProviderId: selected,
        selectedConnectionId: null,
        health: null,
        message: null,
        error: null
      };
      publish();
    },

    selectConnectionCenterConnection(connectionId) {
      if (!connectionCenter.open || connectionCenter.mutationStatus !== "idle") {
        return;
      }
      const selected = connectionId === null
        ? null
        : connectionCenter.connections.find((connection) =>
            connection.id === connectionId && connection.kind === "search")
          ?? null;
      connectionCenter = {
        ...connectionCenter,
        selectedProviderId: selected?.providerId
          ?? connectionCenter.selectedProviderId,
        selectedConnectionId: selected?.id ?? null,
        health: null,
        message: null,
        error: null
      };
      publish();
    },

    saveProviderConnection(apiKey, baseUrl) {
      if (connectionCenterMutation) {
        apiKey = "";
        baseUrl = undefined;
        return connectionCenterMutation;
      }
      const providerId = connectionCenter.selectedProviderId;
      const selectedConnectionId = connectionCenter.selectedConnectionId;
      const selectedConnection = connectionCenter.connections.find(
        (connection) => connection.id === selectedConnectionId
      );
      if (!connectionCenter.open || !providerId || !apiKey.trim()) {
        apiKey = "";
        baseUrl = undefined;
        return Promise.reject(new Error("请选择搜索来源并填写 API Key"));
      }
      if (selectedConnection?.ownerId === "system") {
        apiKey = "";
        baseUrl = undefined;
        return Promise.reject(new Error("系统托管来源为只读连接"));
      }
      const operationKey = idempotencyKey("ai-growth-provider-connection");
      return runConnectionCenterMutation(
        "saving",
        "connection_save_failed",
        async () => {
          try {
            const saved = selectedConnectionId
              ? await options.api.updateProviderConnection(
                  selectedConnectionId,
                  baseUrl === undefined
                    ? { apiKey, status: "disabled" }
                    : { apiKey, baseUrl, status: "disabled" }
                )
              : await options.api.createProviderConnection(
                  baseUrl === undefined
                    ? { providerId, apiKey, status: "disabled" }
                    : { providerId, apiKey, baseUrl, status: "disabled" },
                  operationKey
                );
            return () => ({
              selectedProviderId: saved.providerId,
              selectedConnectionId: saved.id,
              health: null,
              message: "连接已保存，请测试后再启用"
            });
          } finally {
            apiKey = "";
            baseUrl = undefined;
          }
        },
        { health: null }
      );
    },

    testProviderConnection() {
      if (connectionCenterMutation) return connectionCenterMutation;
      const selected = connectionCenter.connections.find((connection) =>
        connection.id === connectionCenter.selectedConnectionId);
      if (!connectionCenter.open || !selected) {
        return Promise.reject(new Error("请选择要测试的搜索连接"));
      }
      if (selected.ownerId === "system") {
        return Promise.reject(new Error("系统托管来源为只读连接"));
      }
      return runConnectionCenterMutation(
        "testing",
        "connection_test_failed",
        async () => {
          const health = await options.api.testProviderConnection(selected.id);
          return () => ({
            health,
            message: health.message
          });
        },
        { health: null }
      );
    },

    setProviderConnectionEnabled(enabled) {
      if (connectionCenterMutation) return connectionCenterMutation;
      const selected = connectionCenter.connections.find((connection) =>
        connection.id === connectionCenter.selectedConnectionId);
      if (!connectionCenter.open || !selected) {
        return Promise.reject(new Error("请选择要更新的搜索连接"));
      }
      if (selected.ownerId === "system") {
        return Promise.reject(new Error("系统托管来源为只读连接"));
      }
      if (enabled && selected.lastHealthStatus !== "passed") {
        return Promise.reject(new Error("连接测试通过后才能启用"));
      }
      return runConnectionCenterMutation(
        "updating",
        "connection_update_failed",
        async () => {
          await options.api.updateProviderConnection(selected.id, {
            status: enabled ? "active" : "disabled"
          });
          return () => ({
            message: enabled ? "连接已启用" : "连接已禁用"
          });
        }
      );
    },

    deleteProviderConnection() {
      if (connectionCenterMutation) return connectionCenterMutation;
      const selected = connectionCenter.connections.find((connection) =>
        connection.id === connectionCenter.selectedConnectionId);
      if (!connectionCenter.open || !selected) {
        return Promise.reject(new Error("请选择要删除的搜索连接"));
      }
      if (selected.ownerId === "system") {
        return Promise.reject(new Error("系统托管来源为只读连接"));
      }
      return runConnectionCenterMutation(
        "deleting",
        "connection_delete_failed",
        async () => {
          await options.api.deleteProviderConnection(selected.id);
          return (searchConnections) => ({
            selectedConnectionId: searchConnections.some((connection) =>
              connection.id === selected.id)
              ? selected.id
              : null,
            health: null,
            message: "连接已删除"
          });
        },
        { health: null }
      );
    },

    async continueAfterConnection() {
      if (connectionCenterMutation) {
        throw new Error("请等待当前连接操作完成");
      }
      if (healthyConnections(connectionCenter.connections).length === 0) {
        throw new Error("请先测试并启用一个搜索连接");
      }
      controller.closeConnectionCenter();
      await controller.submit();
    },

    async showOverview() {
      if (disposed) return;
      const generation = ++operationGeneration;
      poller.stop();
      stopDemo();
      drawer.close();
      runVm = null;
      currentRun = null;
      plan = null;
      sessionId = null;
      workspaceView = "overview";
      taskDetail = { status: "loading", detail: null, errorMessage: null };
      state = {
        ...initialState(),
        mode: state.mode,
        taskText: state.taskText,
        templateId: state.templateId,
        targetPlatform: state.targetPlatform
      };
      taskOverview = initialTaskOverview(state.mode);
      publish();
      if (state.mode === "demo" || !options.user()) return;

      const [overviewResult, tasksResult, connectionsResult] =
        await Promise.allSettled([
          options.api.getTaskOverview(),
          options.api.listAcquisitionTasks(),
          options.api.listProviderConnections()
        ]);
      if (
        disposed
        || generation !== operationGeneration
        || workspaceView !== "overview"
      ) return;

      const overviewFailed = overviewResult.status === "rejected";
      const tasksFailed = tasksResult.status === "rejected";
      const availableTasks = tasksResult.status === "fulfilled"
        ? tasksResult.value.items
        : overviewResult.status === "fulfilled"
          ? overviewResult.value.tasks
          : [];
      const aggregates = overviewResult.status === "fulfilled"
        ? {
            totals: overviewResult.value.totals,
            statusCounts: overviewResult.value.statusCounts,
            discoveryMethodCounts:
              overviewResult.value.discoveryMethodCounts
          }
        : tasksResult.status === "fulfilled"
          ? deriveTaskOverviewAggregates(tasksResult.value.items)
          : {
              totals: { tasks: 0 },
              statusCounts: {},
              discoveryMethodCounts: {}
            };
      if (connectionsResult.status === "fulfilled") {
        connections = [...connectionsResult.value.items];
      } else {
        connections = [];
      }
      const dataStatus = overviewFailed && tasksFailed
        ? "error" as const
        : overviewFailed || tasksFailed
          ? "partial_error" as const
          : availableTasks.length === 0
            ? "empty" as const
            : "ready" as const;
      taskOverview = {
        mode: "real",
        status: dataStatus,
        tasks: [...availableTasks],
        totals: { ...aggregates.totals },
        statusCounts: { ...aggregates.statusCounts },
        discoveryMethodCounts: { ...aggregates.discoveryMethodCounts },
        aggregationSource: overviewResult.status === "fulfilled"
          ? "overview"
          : tasksResult.status === "fulfilled" ? "task_list" : "none",
        connections: [...connections],
        connectionStatus: connectionsResult.status === "fulfilled"
          ? "ready"
          : "error",
        generatedAt: overviewResult.status === "fulfilled"
          ? overviewResult.value.generatedAt
          : null,
        errorMessage: dataStatus === "error"
          ? "任务总览暂时不可用，请稍后重试"
          : dataStatus === "partial_error"
            ? "部分数据加载失败，已保留可用的真实任务数据"
            : null
      };
      publish();
    },

    showNewTask() {
      if (disposed) return;
      operationGeneration += 1;
      poller.stop();
      stopDemo();
      drawer.close();
      runVm = null;
      currentRun = null;
      plan = null;
      sessionId = null;
      workspaceView = "workflow";
      taskOverview = initialTaskOverview(state.mode);
      taskDetail = { status: "loading", detail: null, errorMessage: null };
      state = {
        ...initialState(),
        mode: state.mode,
        taskText: state.taskText,
        templateId: state.templateId,
        targetPlatform: state.targetPlatform
      };
      publish();
    },

    async openTask(planId) {
      if (disposed) return;
      const generation = ++operationGeneration;
      poller.stop();
      stopDemo();
      drawer.close();
      runVm = null;
      currentRun = null;
      plan = null;
      sessionId = null;
      workspaceView = "task";
      taskDetail = { status: "loading", detail: null, errorMessage: null };
      state = {
        ...initialState(),
        mode: "real",
        taskText: state.taskText,
        templateId: state.templateId,
        targetPlatform: state.targetPlatform
      };
      publish();
      if (!options.user()) {
        taskDetail = {
          status: "error",
          detail: null,
          errorMessage: "请登录后查看获客任务"
        };
        publish();
        return;
      }
      try {
        const detail = await options.api.getAcquisitionTask(planId);
        if (
          disposed
          || generation !== operationGeneration
          || workspaceView !== "task"
        ) return;
        taskDetail = { status: "ready", detail, errorMessage: null };
        const draft = detail.plan.payload;
        currentRun = detail.latestRun;
        if (detail.presentation) {
          runVm = mergePresentation({
            run: detail.presentation.run,
            providers: [],
            summary: null,
            candidatesById: new Map(),
            nextAfter: "",
            hasMore: false
          }, detail.presentation);
        }
        state = {
          ...state,
          status: currentRun ? pageStatusForRun(currentRun.status) : "idle",
          taskText: draft.objective,
          targetPlatform: draft.targetPlatform ?? detail.task.platform,
          planDraft: draft,
          runId: currentRun?.id ?? null,
          cursor: runVm?.nextAfter ?? null,
          candidatesById: new Map(runVm?.candidatesById ?? []),
          summary: runVm?.summary ?? null,
          error: null
        };
        publish();
        if (
          currentRun
          && ACTIVE_ACQUISITION_RUN_STATUSES.has(currentRun.status)
        ) {
          poller.start(currentRun.id, "real");
        }
      } catch (error) {
        if (
          disposed
          || generation !== operationGeneration
          || workspaceView !== "task"
        ) return;
        taskDetail = {
          status: "error",
          detail: null,
          errorMessage: messageOf(error)
        };
        state = {
          ...state,
          status: "failed",
          error: {
            code: "task_detail_failed",
            message: messageOf(error),
            retryable: advisorHttpStatus(error) === null
              || advisorHttpStatus(error)! >= 500
          }
        };
        publish();
      }
    },

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
        templateId: state.templateId,
        targetPlatform: state.targetPlatform
      };
      if (mode === "demo") ensureDemoRunner();
      publish();
    },

    setTaskText(value, notify = true) {
      state = { ...state, taskText: value };
      if (notify) publish();
    },

    setTargetPlatform(platform) {
      if (!isTargetPlatform(platform) || state.targetPlatform === platform) {
        return;
      }
      operationGeneration += 1;
      state = {
        ...state,
        targetPlatform: platform,
        planDraft: null,
        status: "idle",
        error: null
      };
      publish();
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
          sessionId = copilotSessionResourceId(
            await options.api.createSession(
              {},
              idempotencyKey("ai-growth-session")
            )
          );
        }
        if (generation !== operationGeneration) return;
        const requested = await options.api.requestPlanDraft(
          sessionId,
          taskText,
          idempotencyKey("ai-growth-plan-draft"),
          state.targetPlatform
        );
        const task = await pollCopilotTask(requested, generation);
        if (!task || generation !== operationGeneration) return;
        const planDraft = task.status === "succeeded"
          ? copilotTaskPlanDraft(task)
          : null;
        if (!planDraft) {
          throw new Error(
            task.status === "cancelled"
              ? "方案生成已取消"
              : "方案生成失败，请重新提交"
          );
        }
        state = {
          ...state,
          status: "awaiting_approval",
          targetPlatform: planDraft.targetPlatform ?? state.targetPlatform,
          planDraft,
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
        targetPlatform: plan.targetPlatform ?? state.targetPlatform,
        planDraft: plan,
        runId: currentRun.id,
        cursor: null,
        error: null
      };
      publish();
      poller.start(currentRun.id, "real");
    },

    render(root) {
      const overlays = () => drawer.render().html
        + renderProviderConnectionCenter(connectionCenter, {
          onClose: () => controller.closeConnectionCenter(),
          onSelectProvider: (providerId) =>
            controller.selectConnectionCenterProvider(providerId),
          onSelectConnection: (connectionId) =>
            controller.selectConnectionCenterConnection(connectionId),
          onSave: (apiKey) => controller.saveProviderConnection(apiKey),
          onTest: () => controller.testProviderConnection(),
          onEnable: () => controller.setProviderConnectionEnabled(true),
          onDisable: () => controller.setProviderConnectionEnabled(false),
          onDelete: () => controller.deleteProviderConnection(),
          onContinue: () => controller.continueAfterConnection()
        }).html;
      if (workspaceView === "overview") {
        const overview = renderTaskOverview(taskOverview, {
          onCreateTask: () => controller.showNewTask(),
          onOpenTask: (planId) => void controller.openTask(planId),
          onRetry: () => void controller.showOverview()
        });
        const shell = renderAdvisorShell({
          mode: taskOverview.mode,
          status: state.status,
          stageHtml: overview.html,
          statusDetail: taskOverview.errorMessage ?? undefined
        }, { onContinue: () => undefined });
        root.innerHTML = shell.html + overlays();
        return;
      }

      const detailHeader = workspaceView === "task"
        ? renderTaskDetail({
            ...taskDetail,
            runStatus: currentRun?.status ?? null
          }, {
            onBack: () => void controller.showOverview(),
            onRetry: (planId) => void controller.openTask(planId)
          }).html
        : "";
      if (
        workspaceView === "task"
        && (
          taskDetail.status !== "ready"
          || taskDetail.detail?.latestRun === null
        )
      ) {
        const shell = renderAdvisorShell({
          mode: state.mode,
          status: state.status,
          stageHtml: detailHeader,
          statusDetail: taskDetail.errorMessage ?? undefined
        }, { onContinue: () => undefined });
        root.innerHTML = shell.html + overlays();
        return;
      }

      const selectedTemplate = industryTemplates.find(
        (item) => item.id === state.templateId
      ) ?? industryTemplates[0]!;
      const connectionVms: SearchConnectionHealthVm[] =
        connections
          .filter((connection) => connection.kind === "search")
          .map((connection) => ({
          providerId: connection.providerId,
          label: searchProviderLabel(connection.providerId),
          status: connection.status === "active"
            && connection.lastHealthStatus === "passed"
            ? "healthy"
            : connection.lastHealthStatus === "passed"
              ? "degraded"
              : "unavailable",
          detail: `${connection.status === "active" ? "已启用" : "未启用"} · ${
            connection.lastHealthStatus === "passed"
              ? "测试通过"
              : connection.lastHealthStatus === "failed"
                ? "测试失败"
                : "尚未测试"
          } · 凭据版本 ${connection.credentialVersion}`
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
          targetPlatform: state.targetPlatform,
          templates: industryTemplates,
          selectedTemplateId: state.templateId,
          connections: connectionVms,
          recentTasks: recentVms
        }, {
          onModeChange: (mode) => controller.setMode(mode),
          onTargetPlatformChange: (platform) =>
            controller.setTargetPlatform(platform),
          onTaskTextChange: (value) => controller.setTaskText(value),
          onTemplateSelect: (id) => controller.selectTemplate(id),
          onSubmit: () => void controller.submit(),
          onContinueTask: (id) => void controller.continueRecent(id)
        });
        const required = renderConnectionRequired({
          missingKinds: ["搜索 API"],
          message: "真实搜索需要至少一个已启用的官方搜索来源。你的任务内容已保留。"
        }, {
          onConfigure: () => void controller.openConnectionCenter(),
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
          targetPlatform: state.targetPlatform,
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
          targetPlatform: state.targetPlatform,
          templates: industryTemplates,
          selectedTemplateId: state.templateId,
          connections: connectionVms,
          recentTasks: recentVms
        }, {
          onModeChange: (mode) => controller.setMode(mode),
          onTargetPlatformChange: (platform) =>
            controller.setTargetPlatform(platform),
          onTaskTextChange: (value) => controller.setTaskText(value),
          onTemplateSelect: (id) => controller.selectTemplate(id),
          onSubmit: () => void controller.submit(),
          onContinueTask: (id) => void controller.continueRecent(id)
        }).html;
      }
      if (workspaceView === "task") stage = detailHeader + stage;
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
      root.innerHTML = shell.html + overlays();
    },

    enter() {
      if (disposed) return;
      if (workspaceView === "overview") {
        void controller.showOverview();
        return;
      }
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
      controller.closeConnectionCenter();
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
  const win = doc.defaultView;
  const initialRoute = parseAiGrowthHash(win?.location.hash ?? "");
  const initialHash = buildAiGrowthHash(initialRoute);
  if (win && win.location.hash !== initialHash) {
    win.history.replaceState(null, "", initialHash);
  }
  const api = createAiGrowthApi(dependencies.request);
  let previousFocus: HTMLElement | null = null;
  let previousFocusAction: { action: string; candidateId: string } | null = null;
  let previousBodyOverflow = "";
  let lockedDrawer: "provider" | "battle" | null = null;
  let drawerFocusDescriptor: {
    action: string | null;
    field: string | null;
    candidateId: string;
    providerId: string;
    connectionId: string;
    reviewReason: boolean;
  } | null = null;
  let entered = false;
  let controller!: AiGrowthController;
  const activeDrawer = () => {
    if (controller.getConnectionCenter().open) {
      return {
        kind: "provider" as const,
        selector: ".ai-growth-provider-drawer"
      };
    }
    if (controller.getDrawer().getState().open) {
      return {
        kind: "battle" as const,
        selector: ".ai-growth-battle-drawer"
      };
    }
    return null;
  };
  const focusableInDrawer = (selector: string) => [
    ...root.querySelectorAll<HTMLElement>(
      `${selector} a[href],`
      + `${selector} button:not([disabled]),`
      + `${selector} input:not([disabled]),`
      + `${selector} textarea:not([disabled]),`
      + `${selector} select:not([disabled]),`
      + `${selector} [tabindex]:not([tabindex='-1'])`
    )
  ];
  const describeDrawerFocus = (
    element: HTMLElement
  ): NonNullable<typeof drawerFocusDescriptor> | null => {
    const action = element.dataset.action ?? null;
    const field = element.dataset.field ?? null;
    const reviewReason = element.hasAttribute("data-review-reason");
    if (!action && !field && !reviewReason) return null;
    return {
      action,
      field,
      candidateId: element.dataset.candidateId ?? "",
      providerId: element.dataset.providerId ?? "",
      connectionId: element.dataset.connectionId ?? "",
      reviewReason
    };
  };
  const captureDrawerFocus = () => {
    const element = doc.activeElement;
    if (!(element instanceof HTMLElement)) return;
    const drawerElement = element.closest(
      ".ai-growth-provider-drawer, .ai-growth-battle-drawer"
    );
    if (!drawerElement || !root.contains(drawerElement)) return;
    drawerFocusDescriptor = describeDrawerFocus(element)
      ?? drawerFocusDescriptor;
  };
  const matchingDrawerFocus = (
    drawerElement: HTMLElement
  ): HTMLElement | null => {
    const descriptor = drawerFocusDescriptor;
    if (!descriptor) return null;
    return [...drawerElement.querySelectorAll<HTMLElement>(
      "[data-action], [data-field], [data-review-reason]"
    )].find((element) => {
      const candidate = describeDrawerFocus(element);
      return candidate !== null
        && candidate.action === descriptor.action
        && candidate.field === descriptor.field
        && candidate.candidateId === descriptor.candidateId
        && candidate.providerId === descriptor.providerId
        && candidate.connectionId === descriptor.connectionId
        && candidate.reviewReason === descriptor.reviewReason;
    }) ?? null;
  };
  const restorePreviousFocus = () => {
    const connected = previousFocus?.isConnected ? previousFocus : null;
    const origin = previousFocusAction;
    const matching = origin
      ? [...root.querySelectorAll<HTMLElement>("[data-action]")].find(
          (element) => element.dataset.action === origin.action
            && (element.dataset.candidateId ?? "")
              === origin.candidateId
        ) ?? null
      : null;
    (connected ?? matching)?.focus();
  };
  const rememberDrawerTrigger = (element: HTMLElement) => {
    if (lockedDrawer !== null) return;
    previousFocus = element;
    previousFocusAction = element.dataset.action
      ? {
          action: element.dataset.action,
          candidateId: element.dataset.candidateId ?? ""
        }
      : null;
  };
  function syncDrawerA11y() {
    const active = activeDrawer();
    const initialFocus = active !== null && lockedDrawer !== active.kind;
    if (active && lockedDrawer === null) {
      if (previousFocus === null && previousFocusAction === null) {
        previousFocus = doc.activeElement instanceof HTMLElement
          ? doc.activeElement
          : null;
        previousFocusAction = previousFocus?.dataset.action
          ? {
              action: previousFocus.dataset.action,
              candidateId: previousFocus.dataset.candidateId ?? ""
            }
          : null;
      }
      previousBodyOverflow = doc.body.style.overflow;
      doc.body.style.overflow = "hidden";
    }
    if (active) {
      lockedDrawer = active.kind;
      queueMicrotask(() => {
        const drawerElement = root.querySelector<HTMLElement>(active.selector);
        if (!drawerElement || drawerElement.contains(doc.activeElement)) return;
        if (initialFocus) {
          drawerFocusDescriptor = null;
          focusableInDrawer(active.selector)[0]?.focus();
          return;
        }
        const matching = matchingDrawerFocus(drawerElement);
        const disabled = matching !== null
          && "disabled" in matching
          && Boolean((matching as HTMLButtonElement | HTMLInputElement).disabled);
        if (matching && !disabled) {
          matching.focus({ preventScroll: true });
          return;
        }
        drawerElement.setAttribute("tabindex", "-1");
        drawerElement.focus({ preventScroll: true });
      });
    } else if (lockedDrawer !== null) {
      if (previousBodyOverflow) {
        doc.body.style.overflow = previousBodyOverflow;
      } else {
        doc.body.style.removeProperty("overflow");
      }
      lockedDrawer = null;
      restorePreviousFocus();
      previousFocus = null;
      previousFocusAction = null;
      previousBodyOverflow = "";
      drawerFocusDescriptor = null;
    }
  }

  controller = createAiGrowthController({
    api,
    user: dependencies.currentUser,
    toast: dependencies.toast,
    navigate: dependencies.navigate,
    initialView: initialRoute.name === "overview" ? "overview" : "workflow",
    recentStorage: doc.defaultView?.localStorage,
    validateSession: (sessionId) =>
      dependencies.request(
        `/api/v1/acquisition/copilot/sessions/${encodeURIComponent(sessionId)}`
    ),
    onChange() {
      captureDrawerFocus();
      controller.render(root);
      syncDrawerA11y();
    }
  });

  const applyRoute = async (route: AiGrowthRoute) => {
    if (route.name === "overview") {
      await controller.showOverview();
    } else if (route.name === "new") {
      controller.showNewTask();
      controller.enter();
    } else {
      await controller.openTask(route.planId);
    }
  };

  const setRoute = (route: AiGrowthRoute) => {
    const nextHash = buildAiGrowthHash(route);
    if (win && win.location.hash !== nextHash) {
      win.location.hash = nextHash;
      return;
    }
    if (entered) void applyRoute(route);
  };

  const onHashChange = () => {
    controller.leave();
    if (entered) void applyRoute(parseAiGrowthHash(win?.location.hash ?? ""));
  };

  const takeProviderApiKey = () => {
    const input = root.querySelector<HTMLInputElement>(
      ".ai-growth-provider-drawer [data-field='provider-api-key']"
    );
    const apiKey = input?.value ?? "";
    if (input) {
      input.value = "";
      input.type = "password";
    }
    return apiKey;
  };

  const runAction = async (action: string, element: HTMLElement) => {
    const candidateId = element.dataset.candidateId ?? "";
    if (
      action === "configure-connections"
      || action === "open-battle-card"
      || action === "approve"
      || action === "reject"
      || action === "do-not-contact"
      || action === "request-research"
      || action === "reopen"
      || action === "build-battle-card"
    ) {
      rememberDrawerTrigger(element);
    }
    switch (action) {
      case "new-task":
        setRoute({ name: "new" });
        break;
      case "open-task":
        setRoute({
          name: "task",
          planId: element.dataset.planId ?? ""
        });
        break;
      case "back-overview":
        setRoute({ name: "overview" });
        break;
      case "retry-overview":
        await controller.showOverview();
        break;
      case "set-mode":
        controller.setMode(element.dataset.mode as AdvisorMode);
        break;
      case "set-target-platform":
        controller.setTargetPlatform(
          element.dataset.platform as AcquisitionTaskPlatform
        );
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
        await controller.openConnectionCenter();
        break;
      case "select-connection-provider":
        controller.selectConnectionCenterProvider(
          element.dataset.providerId ?? null
        );
        break;
      case "select-provider-connection":
        controller.selectConnectionCenterConnection(
          element.dataset.connectionId ?? null
        );
        break;
      case "save-provider-connection": {
        await controller.saveProviderConnection(takeProviderApiKey());
        break;
      }
      case "rotate-provider-connection": {
        if (!win?.confirm("轮换后旧 API Key 将立即失效，确认继续？")) {
          break;
        }
        await controller.saveProviderConnection(takeProviderApiKey());
        break;
      }
      case "delete-provider-connection":
        if (win?.confirm("确认删除这个搜索来源连接？此操作无法撤销。")) {
          await controller.deleteProviderConnection();
        }
        break;
      case "test-provider-connection":
        await controller.testProviderConnection();
        break;
      case "enable-provider-connection":
        await controller.setProviderConnectionEnabled(true);
        break;
      case "disable-provider-connection":
        await controller.setProviderConnectionEnabled(false);
        break;
      case "continue-after-connection":
        await controller.continueAfterConnection();
        break;
      case "close-provider-connections":
        controller.closeConnectionCenter();
        break;
      case "toggle-provider-secret": {
        const input = element
          .closest(".ai-growth-connection-editor")
          ?.querySelector<HTMLInputElement>("[data-field='provider-api-key']");
        if (!input) break;
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        element.setAttribute("aria-pressed", String(visible));
        element.setAttribute(
          "aria-label",
          visible ? "隐藏 API Key" : "显示 API Key"
        );
        element.textContent = visible ? "隐藏" : "显示";
        break;
      }
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
    const active = activeDrawer();
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (active.kind === "provider") {
        controller.closeConnectionCenter();
      } else {
        controller.getDrawer().close();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableInDrawer(active.selector);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const drawerElement = root.querySelector<HTMLElement>(active.selector);
    if (!drawerElement?.contains(doc.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && doc.activeElement === first) {
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
  win?.addEventListener("hashchange", onHashChange);
  controller.render(root);

  return {
    enter() {
      entered = true;
      void applyRoute(parseAiGrowthHash(win?.location.hash ?? ""));
    },
    leave() {
      entered = false;
      controller.leave();
      syncDrawerA11y();
    },
    dispose() {
      entered = false;
      controller.dispose();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      doc.removeEventListener("keydown", onKeydown);
      win?.removeEventListener("hashchange", onHashChange);
      if (lockedDrawer !== null) {
        if (previousBodyOverflow) {
          doc.body.style.overflow = previousBodyOverflow;
        } else {
          doc.body.style.removeProperty("overflow");
        }
      }
    }
  };
}
