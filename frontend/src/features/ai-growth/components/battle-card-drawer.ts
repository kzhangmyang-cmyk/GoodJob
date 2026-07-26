import {
  advisorHttpStatus,
  type AiGrowthApi,
  type CopilotTaskDto,
  type EvidenceDto
} from "../api.js";
import type {
  BattleCardDto,
  CandidateDto,
  CandidateStatus,
  FinancialValueDto,
  QualificationDto
} from "../types.js";
import { battleCardSectionsVm } from "../view-model.js";
import {
  componentRender,
  escapeHtml,
  percent,
  type ComponentRender
} from "./rendering.js";

type ResourceStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface DrawerResource<T> {
  status: ResourceStatus;
  data: T | null;
  error: string | null;
}

export type BattleCardActionKind =
  | "qualification"
  | "battle_card"
  | "candidate_review"
  | "conversion"
  | "outreach_review";

export interface BattleCardActionState {
  kind: BattleCardActionKind | null;
  status: "idle" | CopilotTaskDto["status"];
  taskId: string | null;
  message: string | null;
  error: string | null;
}

export interface BattleCardDrawerState {
  open: boolean;
  candidateId: string | null;
  candidate: DrawerResource<CandidateDto>;
  evidence: DrawerResource<EvidenceDto[]>;
  qualification: DrawerResource<QualificationDto>;
  financialValue: DrawerResource<FinancialValueDto>;
  battleCard: DrawerResource<BattleCardDto>;
  action: BattleCardActionState;
}

export interface BattleCardDrawerCallbacks {
  onClose(): void;
  onRunQualification(): void;
  onGenerateBattleCard(): void;
  onReview(action:
    | "approved"
    | "rejected"
    | "do_not_contact"
    | "needs_research"
    | "reopen"
  ): void;
  onConvert(): void;
  onCreateOutreachReviewTask(): void;
}

export interface BattleCardDrawer {
  getState(): BattleCardDrawerState;
  render(): ComponentRender<BattleCardDrawerCallbacks>;
  open(candidateId: string): Promise<void>;
  close(): void;
  runQualification(): Promise<void>;
  generateBattleCard(): Promise<void>;
  review(
    action: "approved" | "rejected" | "do_not_contact" | "needs_research" | "reopen",
    reason?: string | null
  ): Promise<void>;
  convert(): Promise<void>;
  createOutreachReviewTask(): Promise<void>;
}

export interface BattleCardDrawerOptions {
  api: AiGrowthApi;
  onCandidateUpdated(candidate: CandidateDto): void;
  onStateChange?(state: BattleCardDrawerState): void;
  wait?: (delayMs: number) => Promise<void>;
  idempotencyKey?: () => string;
  actionPollMs?: number;
}

function emptyResource<T>(): DrawerResource<T> {
  return { status: "idle", data: null, error: null };
}

function loadingResource<T>(): DrawerResource<T> {
  return { status: "loading", data: null, error: null };
}

function actionState(): BattleCardActionState {
  return {
    kind: null,
    status: "idle",
    taskId: null,
    message: null,
    error: null
  };
}

function initialState(): BattleCardDrawerState {
  return {
    open: false,
    candidateId: null,
    candidate: emptyResource(),
    evidence: emptyResource(),
    qualification: emptyResource(),
    financialValue: emptyResource(),
    battleCard: emptyResource(),
    action: actionState()
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "读取失败，请稍后重试";
}

async function settleResource<T>(
  operation: () => Promise<T>
): Promise<DrawerResource<T>> {
  try {
    return { status: "ready", data: await operation(), error: null };
  } catch (error) {
    if (advisorHttpStatus(error) === 404) {
      return { status: "missing", data: null, error: null };
    }
    return { status: "error", data: null, error: errorMessage(error) };
  }
}

function safeSourceUrl(evidence: EvidenceDto): string | null {
  const value = evidence.provenance.sourceUrl;
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function displayName(candidate: CandidateDto | null): string {
  if (candidate === null) return "客户作战卡";
  return candidate.subjectKind === "organization"
    ? candidate.name
    : candidate.publicDisplayName;
}

function approvedCurrentDecision(candidate: CandidateDto | null): boolean {
  return Boolean(
    candidate
    && candidate.status === "approved"
    && candidate.latestDecisionVersion
    && candidate.approvedDecisionVersion === candidate.latestDecisionVersion
  );
}

const TERMINAL_TASK_STATUSES = new Set<CopilotTaskDto["status"]>([
  "succeeded",
  "failed",
  "cancelled"
]);

const REVIEWABLE_ACTIONS: Readonly<
  Partial<Record<CandidateStatus, readonly string[]>>
> = {
  pending_review: ["approved", "rejected", "do_not_contact", "needs_research"],
  rejected: ["reopen"],
  do_not_contact: ["reopen"],
  needs_research: ["reopen"]
};

function actionStatus(state: BattleCardActionState): string {
  if (state.status === "idle") return "";
  if (state.error) {
    return `<p class="ai-growth-drawer-action-status is-error" role="alert">${escapeHtml(state.error)}</p>`;
  }
  const labels: Record<Exclude<BattleCardActionState["status"], "idle">, string> = {
    queued: "任务已排队",
    running: "任务正在执行",
    succeeded: state.message ?? "任务已完成",
    failed: "任务执行失败",
    cancelled: "任务已取消"
  };
  return `<p class="ai-growth-drawer-action-status" role="status" aria-live="polite">${escapeHtml(labels[state.status])}</p>`;
}

function resourceError<T>(resource: DrawerResource<T>): string {
  return resource.status === "error"
    ? `<p class="ai-growth-resource-error" role="alert">${escapeHtml(resource.error ?? "读取失败")}</p>`
    : "";
}

function evidenceIndex(items: EvidenceDto[]): Map<string, EvidenceDto> {
  return new Map(items.map((item) => [item.id, item]));
}

function evidenceReference(
  id: string,
  index: Map<string, EvidenceDto>
): string {
  const item = index.get(id);
  if (!item) {
    return `<span class="ai-growth-evidence-ref" data-evidence-id="${escapeHtml(id)}">${escapeHtml(id)}</span>`;
  }
  const url = safeSourceUrl(item);
  const label = `${item.sourcePlatform}：${item.sourceTitle}`;
  return url
    ? `<a class="ai-growth-evidence-ref" data-evidence-id="${escapeHtml(id)}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : `<span class="ai-growth-evidence-ref" data-evidence-id="${escapeHtml(id)}">${escapeHtml(label)}</span>`;
}

function battleCardContent(state: BattleCardDrawerState): string {
  if (state.battleCard.status === "loading") {
    return `<p class="ai-growth-empty-value">正在读取客户作战卡</p>`;
  }
  if (state.battleCard.status === "missing") {
    return `
      <div class="ai-growth-drawer-empty">
        <strong>客户作战卡尚未生成</strong>
        <p>生成动作将交给受控工具执行，并在任务成功后读取结果。</p>
        <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="generate-battle-card">生成客户作战卡</button>
      </div>
    `;
  }
  if (state.battleCard.status === "error") {
    return resourceError(state.battleCard);
  }
  if (state.battleCard.data === null) return "";

  const items = state.evidence.data ?? [];
  const index = evidenceIndex(items);
  const sections = battleCardSectionsVm(state.battleCard.data.sections);
  const groups = [
    { kind: "fact", title: "事实", note: "来自公开证据，可直接核验" },
    { kind: "inference", title: "推测", note: "基于证据的判断，不等同于事实" },
    { kind: "unknown", title: "未知/待核验", note: "当前证据不足，需要继续确认" }
  ] as const;
  return groups.map((group) => {
    const rows = sections.filter((section) => section.kind === group.kind);
    if (rows.length === 0) return "";
    return `
      <section class="ai-growth-battle-section" data-section-kind="${group.kind}">
        <header><h3>${group.title}</h3><span>${group.note}</span></header>
        ${rows.map((section) => `
          <article>
            <div>
              <strong>${escapeHtml(section.label)}</strong>
              ${section.kind === "inference"
                ? `<span class="ai-growth-inference-label">推测 · ${section.confidence === null
                  ? "置信度待核验"
                  : `置信度 ${percent(section.confidence)}`}</span>`
                : ""}
            </div>
            <p>${escapeHtml(section.content)}</p>
            <div class="ai-growth-evidence-links">
              ${section.evidenceIds.length === 0
                ? `<span class="ai-growth-empty-value">暂无可链接证据</span>`
                : section.evidenceIds.map((id) =>
                  evidenceReference(id, index)
                ).join("")}
            </div>
          </article>
        `).join("")}
      </section>
    `;
  }).join("");
}

function qualificationPanel(state: BattleCardDrawerState): string {
  const qualification = state.qualification.data;
  if (state.qualification.status === "missing") {
    return `
      <section class="ai-growth-drawer-panel">
        <header><h3>资格评估</h3><span>待资格评估</span></header>
        <p>当前候选还没有可核验的资格决定。</p>
        <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="run-qualification">运行资格评估</button>
      </section>
    `;
  }
  if (state.qualification.status === "error") {
    return `<section class="ai-growth-drawer-panel"><h3>资格评估</h3>${resourceError(state.qualification)}</section>`;
  }
  if (qualification === null) return "";
  return `
    <section class="ai-growth-drawer-panel">
      <header>
        <h3>资格评估</h3>
        <span>${qualification.grade} 级 · ${qualification.score} 分</span>
      </header>
      <dl class="ai-growth-drawer-facts">
        <div><dt>决定版本</dt><dd>${escapeHtml(qualification.decisionVersion)}</dd></div>
        <div><dt>置信度</dt><dd>${percent(qualification.confidence)}</dd></div>
        <div><dt>硬门禁</dt><dd>${qualification.hardGateFailures.length === 0
          ? "已通过"
          : escapeHtml(qualification.hardGateFailures.join("、"))}</dd></div>
      </dl>
      <ul class="ai-growth-reason-list">
        ${qualification.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function financialPanel(state: BattleCardDrawerState): string {
  const value = state.financialValue.data;
  if (state.financialValue.status === "missing") {
    return `
      <section class="ai-growth-drawer-panel">
        <header><h3>财务价值</h3><span>待评估</span></header>
        <p>当前没有财务价值结论，不展示推测金额。</p>
      </section>
    `;
  }
  if (state.financialValue.status === "error") {
    return `<section class="ai-growth-drawer-panel"><h3>财务价值</h3>${resourceError(state.financialValue)}</section>`;
  }
  if (value === null) return "";
  const revenue = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: value.currency
  }).format(value.expectedRevenueMinor / 100);
  return `
    <section class="ai-growth-drawer-panel">
      <header><h3>财务价值</h3><span>已评估</span></header>
      <strong class="ai-growth-drawer-amount">${escapeHtml(revenue)}</strong>
      <p>预计收入，基于当前资格版本；实际成交与回款仍需人工确认。</p>
    </section>
  `;
}

function reviewPanel(state: BattleCardDrawerState): string {
  const candidate = state.candidate.data;
  const qualification = state.qualification.data;
  if (!candidate) return "";
  const allowed = REVIEWABLE_ACTIONS[candidate.status] ?? [];
  if (candidate.status === "pending_review") {
    return `
      <section class="ai-growth-drawer-review" aria-labelledby="candidateReviewTitle">
        <header>
          <div>
            <p class="ai-growth-eyebrow">人工决策</p>
            <h3 id="candidateReviewTitle">候选资格人工复核</h3>
          </div>
          <span>${escapeHtml(candidate.latestDecisionVersion ?? "决定版本待生成")}</span>
        </header>
        <p>请核验证据、硬门禁与 AI 理由。系统不会自动批准候选。</p>
        <label>
          <span>复核说明（可选）</span>
          <textarea data-review-reason rows="3" placeholder="记录批准、驳回或补充研究的原因"></textarea>
        </label>
        <div class="ai-growth-drawer-review__actions">
          <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="review-approved">批准</button>
          <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="review-needs_research">需要补充研究</button>
          <button type="button" class="ai-growth-button ai-growth-button--quiet" data-action="review-rejected">驳回</button>
          <button type="button" class="ai-growth-button ai-growth-button--quiet is-danger" data-action="review-do_not_contact">设为勿扰</button>
        </div>
        ${qualification === null ? "" : `<small>当前硬门禁：${qualification.hardGateFailures.length === 0
          ? "全部通过"
          : escapeHtml(qualification.hardGateFailures.join("、"))}</small>`}
      </section>
    `;
  }
  if (allowed.includes("reopen")) {
    return `
      <section class="ai-growth-drawer-review">
        <h3>当前状态：${escapeHtml(candidate.status)}</h3>
        <p>重新打开后才能基于最新决定版本继续复核。</p>
        <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="review-reopen">重新打开</button>
      </section>
    `;
  }
  return "";
}

function approvedActions(state: BattleCardDrawerState): string {
  if (!approvedCurrentDecision(state.candidate.data)) return "";
  return `
    <section class="ai-growth-drawer-approved-actions">
      <p class="ai-growth-eyebrow">已通过当前决定版本</p>
      <h3>把已批准候选交给销售流程</h3>
      <div>
        <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="convert">转为线索</button>
        <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="create-outreach-review">创建外联动作审核任务</button>
      </div>
    </section>
  `;
}

export function renderBattleCardDrawer(
  state: BattleCardDrawerState,
  callbacks: BattleCardDrawerCallbacks
): ComponentRender<BattleCardDrawerCallbacks> {
  if (!state.open) return componentRender("", callbacks);
  const candidate = state.candidate.data;
  const loading = state.candidate.status === "loading";
  return componentRender(`
    <div class="ai-growth-drawer-backdrop" data-action="close-battle-card"></div>
    <aside class="ai-growth-battle-drawer" role="dialog" aria-modal="true" aria-labelledby="battleCardTitle" data-candidate-id="${escapeHtml(state.candidateId ?? "")}">
      <header class="ai-growth-battle-drawer__header">
        <div>
          <p class="ai-growth-eyebrow">客户连接作战室</p>
          <h2 id="battleCardTitle">${escapeHtml(displayName(candidate))}</h2>
          <p>${candidate
            ? `${candidate.subjectKind === "organization" ? "企业候选" : "公开需求信号"} · ${escapeHtml(candidate.status)}`
            : loading ? "正在读取候选信息" : "候选信息不可用"}</p>
        </div>
        <button type="button" class="ai-growth-drawer-close" data-action="close-battle-card" aria-label="关闭客户作战卡">关闭</button>
      </header>
      <div class="ai-growth-battle-drawer__body">
        ${resourceError(state.candidate)}
        ${resourceError(state.evidence)}
        ${qualificationPanel(state)}
        ${financialPanel(state)}
        <section class="ai-growth-drawer-card">
          <div class="ai-growth-section-heading">
            <div><p class="ai-growth-eyebrow">行动依据</p><h2>客户作战卡</h2></div>
            <span>${state.battleCard.data ? `整体置信度 ${percent(state.battleCard.data.confidence)}` : ""}</span>
          </div>
          ${battleCardContent(state)}
        </section>
        ${reviewPanel(state)}
        ${approvedActions(state)}
        ${actionStatus(state.action)}
      </div>
    </aside>
  `, callbacks);
}

export function createBattleCardDrawer(
  options: BattleCardDrawerOptions
): BattleCardDrawer {
  const { api, onCandidateUpdated } = options;
  const wait = options.wait ?? ((delayMs: number) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)));
  const key = options.idempotencyKey ?? (() => globalThis.crypto.randomUUID());
  const pollMs = options.actionPollMs ?? 1_000;
  let state = initialState();
  let sessionId: string | null = null;
  let generation = 0;
  const notify = () => options.onStateChange?.(state);

  const callbacks: BattleCardDrawerCallbacks = {
    onClose: () => drawer.close(),
    onRunQualification: () =>
      void drawer.runQualification().catch(() => undefined),
    onGenerateBattleCard: () =>
      void drawer.generateBattleCard().catch(() => undefined),
    onReview: (action) =>
      void drawer.review(action).catch(() => undefined),
    onConvert: () => void drawer.convert().catch(() => undefined),
    onCreateOutreachReviewTask: () =>
      void drawer.createOutreachReviewTask().catch(() => undefined)
  };

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    sessionId = (await api.createSession({}, key())).id;
    return sessionId;
  }

  async function pollTask(task: CopilotTaskDto): Promise<CopilotTaskDto> {
    let current = task;
    while (!TERMINAL_TASK_STATUSES.has(current.status)) {
      state.action = { ...state.action, status: current.status };
      notify();
      await wait(pollMs);
      current = await api.getCopilotTask(current.id);
    }
    state.action = { ...state.action, status: current.status };
    notify();
    return current;
  }

  async function runTool(
    kind: BattleCardActionKind,
    toolName: string,
    message: string,
    successMessage: string
  ): Promise<boolean> {
    state.action = {
      kind,
      status: "queued",
      taskId: null,
      message: null,
      error: null
    };
    notify();
    try {
      const task = await api.requestAssistantAction(
        await ensureSession(),
        message,
        key()
      );
      state.action.taskId = task.id;
      notify();
      const complete = await pollTask(task);
      if (complete.status !== "succeeded") {
        state.action.error = complete.status === "cancelled"
          ? "任务已取消"
          : "受控任务执行失败";
        notify();
        return false;
      }
      if (!complete.result?.toolNames?.includes(toolName)) {
        state.action = {
          ...state.action,
          status: "failed",
          error: `任务未执行 ${toolName}，未刷新领域结果`
        };
        notify();
        return false;
      }
      state.action = {
        ...state.action,
        status: "succeeded",
        message: successMessage,
        error: null
      };
      notify();
      return true;
    } catch (error) {
      state.action = {
        ...state.action,
        status: "failed",
        error: errorMessage(error)
      };
      notify();
      return false;
    }
  }

  async function refreshQualificationAndFinance() {
    const [qualificationResult, financialResult] = await Promise.all([
      settleResource(() => api.getQualification(state.candidateId!)),
      settleResource(() => api.getFinancialValue(state.candidateId!))
    ]);
    state.qualification = qualificationResult;
    state.financialValue = financialResult;
    notify();
  }

  async function refreshAfterReview() {
    const candidateId = state.candidateId!;
    const [candidateResult, qualificationResult, financialResult] =
      await Promise.all([
        settleResource(() => api.getCandidate(candidateId)),
        settleResource(() => api.getQualification(candidateId)),
        settleResource(() => api.getFinancialValue(candidateId))
      ]);
    state.candidate = candidateResult;
    state.qualification = qualificationResult;
    state.financialValue = financialResult;
    if (candidateResult.data) onCandidateUpdated(candidateResult.data);
    notify();
  }

  const drawer: BattleCardDrawer = {
    getState: () => state,

    render: () => renderBattleCardDrawer(state, callbacks),

    async open(candidateId) {
      const currentGeneration = ++generation;
      state = {
        ...initialState(),
        open: true,
        candidateId,
        candidate: loadingResource(),
        evidence: loadingResource(),
        qualification: loadingResource(),
        financialValue: loadingResource(),
        battleCard: loadingResource()
      };
      notify();
      const publish = async <T>(
        field: "candidate" | "evidence" | "qualification" | "financialValue" | "battleCard",
        operation: () => Promise<T>
      ) => {
        const result = await settleResource(operation);
        if (
          currentGeneration !== generation
          || state.candidateId !== candidateId
        ) {
          return;
        }
        (state[field] as DrawerResource<T>) = result;
        notify();
      };
      await Promise.all([
        publish("candidate", () => api.getCandidate(candidateId)),
        publish("evidence", () =>
          api.getEvidence(candidateId).then((page) => page.items)
        ),
        publish("qualification", () => api.getQualification(candidateId)),
        publish("financialValue", () => api.getFinancialValue(candidateId)),
        publish("battleCard", () => api.getBattleCard(candidateId))
      ]);
    },

    close() {
      generation += 1;
      state = initialState();
      notify();
    },

    async runQualification() {
      if (!state.candidateId) throw new Error("请先打开候选客户");
      const ok = await runTool(
        "qualification",
        "qualify_candidate",
        `请调用 qualify_candidate 工具评估候选。参数：${JSON.stringify({
          candidateId: state.candidateId,
          policyVersion: "qualification.v1"
        })}`,
        "资格评估已完成"
      );
      if (ok) await refreshQualificationAndFinance();
    },

    async generateBattleCard() {
      if (!state.candidateId) throw new Error("请先打开候选客户");
      const ok = await runTool(
        "battle_card",
        "build_battle_card",
        `请调用 build_battle_card 工具生成客户作战卡。参数：${JSON.stringify({
          candidateId: state.candidateId,
          templateVersion: "battle-card.v1"
        })}`,
        "客户作战卡已生成"
      );
      if (ok) {
        state.battleCard = await settleResource(() =>
          api.getBattleCard(state.candidateId!)
        );
        notify();
      }
    },

    async review(action, reason = null) {
      const candidate = state.candidate.data;
      if (!candidate || !state.candidateId) {
        throw new Error("请先读取候选客户");
      }
      const allowed = REVIEWABLE_ACTIONS[candidate.status] ?? [];
      if (!allowed.includes(action)) {
        throw new Error("当前候选状态不允许该人工复核动作");
      }
      if (!candidate.latestDecisionVersion) {
        throw new Error("候选尚无可复核的资格决定版本");
      }
      state.action = {
        kind: "candidate_review",
        status: "running",
        taskId: null,
        message: null,
        error: null
      };
      notify();
      try {
        await api.reviewCandidate(
          state.candidateId,
          {
            action,
            decisionVersion: candidate.latestDecisionVersion,
            reason: reason?.trim() || null
          },
          key()
        );
        await refreshAfterReview();
        state.action = {
          ...state.action,
          status: "succeeded",
          message: "人工复核结果已保存"
        };
        notify();
      } catch (error) {
        state.action = {
          ...state.action,
          status: "failed",
          error: errorMessage(error)
        };
        notify();
        throw error;
      }
    },

    async convert() {
      const candidate = state.candidate.data;
      if (!state.candidateId || !approvedCurrentDecision(candidate)) {
        throw new Error("当前资格决定尚未获得有效批准");
      }
      state.action = {
        kind: "conversion",
        status: "running",
        taskId: null,
        message: null,
        error: null
      };
      notify();
      try {
        await api.convertCandidate(
          state.candidateId,
          { decisionVersion: candidate!.latestDecisionVersion! },
          key()
        );
        state.candidate = await settleResource(() =>
          api.getCandidate(state.candidateId!)
        );
        if (state.candidate.data) onCandidateUpdated(state.candidate.data);
        notify();
        state.action = {
          ...state.action,
          status: "succeeded",
          message: "候选已转为线索"
        };
        notify();
      } catch (error) {
        state.action = {
          ...state.action,
          status: "failed",
          error: errorMessage(error)
        };
        notify();
        throw error;
      }
    },

    async createOutreachReviewTask() {
      const candidate = state.candidate.data;
      if (!state.candidateId || !approvedCurrentDecision(candidate)) {
        throw new Error("当前资格决定尚未获得有效批准");
      }
      await runTool(
        "outreach_review",
        "create_review_task",
        `请调用 create_review_task 工具创建外联动作人工审核任务，不要发送消息。参数：${JSON.stringify({
          candidateId: state.candidateId,
          proposedAction: "private_domain_invitation",
          rationale: "候选已通过当前资格决定版本的人工批准，下一步外联仍需单独审核。"
        })}`,
        "外联动作审核任务已创建"
      );
    }
  };

  return drawer;
}
