import {
  AdvisorConflictError,
  AdvisorPreconditionRequiredError,
  advisorHttpStatus,
  copilotSessionResourceId,
  copilotTaskIncludesToolName,
  type AiGrowthApi,
  type CandidateIdentityConfirmationResultDto,
  type ContentFetchOperationDto,
  type CopilotTaskDto,
  type EvidenceDto
} from "../api.js";
import type {
  BattleCardClaimDto,
  BattleCardConnectionChannel,
  BattleCardDto,
  BattleCardFinancialSummaryDto,
  CandidateDto,
  CandidateStatus,
  FinancialValueDto,
  QualificationDto
} from "../types.js";
import {
  battleCardClaimVm,
  battleCardSectionsVm,
  formatMinorAmount
} from "../view-model.js";
import {
  componentRender,
  escapeHtml,
  percent,
  type ComponentRender
} from "./rendering.js";
import {
  isExactDouyinProfileUrl,
  normalizeExactDouyinProfileUrl,
  renderIdentityVerificationPanel,
  type IdentityEvidenceVm,
  type IdentityVerificationStatus
} from "./identity-verification-panel.js";

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

export type IdentityActionStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "conflict";

export interface IdentityActionResource<T> {
  status: IdentityActionStatus;
  data: T | null;
  error: string | null;
}

export interface IdentityContinuationResult {
  completedTools: Array<
    "research_candidate" | "qualify_candidate" | "build_battle_card"
  >;
}

export interface IdentityVerificationState {
  status: IdentityVerificationStatus;
  profileUrl: string;
  rationale: string;
  fetchedEvidenceIds: string[];
  selectedEvidenceIds: string[];
  fetch: IdentityActionResource<ContentFetchOperationDto>;
  confirmation: IdentityActionResource<CandidateIdentityConfirmationResultDto>;
  continuation: IdentityActionResource<IdentityContinuationResult>;
  message: string | null;
  error: string | null;
}

export interface BattleCardDrawerState {
  open: boolean;
  readOnly: boolean;
  candidateId: string | null;
  candidate: DrawerResource<CandidateDto>;
  evidence: DrawerResource<EvidenceDto[]>;
  qualification: DrawerResource<QualificationDto>;
  financialValue: DrawerResource<FinancialValueDto>;
  battleCard: DrawerResource<BattleCardDto>;
  action: BattleCardActionState;
  identityVerification: IdentityVerificationState;
}

export interface CandidateIdentitySubmission {
  profileUrl: string;
  rationale: string;
  evidenceIds: string[];
}

export type CandidateReviewAction =
  | "approved"
  | "rejected"
  | "do_not_contact"
  | "needs_research"
  | "reopen";

export interface CandidateReviewSubmission {
  action: CandidateReviewAction;
  reason: string | null;
}

export interface BattleCardDrawerCallbacks {
  onClose(): void;
  onFetchIdentityProfile(profileUrl: string): Promise<void>;
  onIdentityDraftChange(
    input: Partial<Pick<CandidateIdentitySubmission, "profileUrl" | "rationale">>
  ): void;
  onToggleIdentityEvidence(evidenceId: string, selected: boolean): void;
  onConfirmCandidateIdentity(input: CandidateIdentitySubmission): Promise<void>;
  onRetryIdentityContinuation(): Promise<void>;
  onRunQualification(): Promise<void>;
  onGenerateBattleCard(): Promise<void>;
  onReview(input: CandidateReviewSubmission): Promise<void>;
  onConvert(): Promise<void>;
  onCreateOutreachReviewTask(): Promise<void>;
}

export interface BattleCardDrawer {
  getState(): BattleCardDrawerState;
  render(): ComponentRender<BattleCardDrawerCallbacks>;
  open(candidateId: string): Promise<void>;
  openFixture(
    candidate: CandidateDto,
    card: BattleCardDto,
    evidence: EvidenceDto[],
    qualification: QualificationDto | null,
    financialValue: FinancialValueDto | null
  ): void;
  close(): void;
  setIdentityDraft(
    input: Partial<Pick<CandidateIdentitySubmission, "profileUrl" | "rationale">>
  ): void;
  toggleIdentityEvidence(evidenceId: string, selected: boolean): void;
  fetchIdentityProfile(profileUrl: string): Promise<void>;
  confirmCandidateIdentity(input: CandidateIdentitySubmission): Promise<void>;
  retryIdentityContinuation(): Promise<void>;
  runQualification(): Promise<void>;
  generateBattleCard(): Promise<void>;
  review(
    action: CandidateReviewAction,
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

function identityActionResource<T>(): IdentityActionResource<T> {
  return { status: "idle", data: null, error: null };
}

function identityVerificationState(): IdentityVerificationState {
  return {
    status: "needs_profile",
    profileUrl: "",
    rationale: "",
    fetchedEvidenceIds: [],
    selectedEvidenceIds: [],
    fetch: identityActionResource(),
    confirmation: identityActionResource(),
    continuation: identityActionResource(),
    message: null,
    error: null
  };
}

function initialState(): BattleCardDrawerState {
  return {
    open: false,
    readOnly: false,
    candidateId: null,
    candidate: emptyResource(),
    evidence: emptyResource(),
    qualification: emptyResource(),
    financialValue: emptyResource(),
    battleCard: emptyResource(),
    action: actionState(),
    identityVerification: identityVerificationState()
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

const TERMINAL_CONTENT_FETCH_STATUSES = new Set<
  ContentFetchOperationDto["status"]
>(["succeeded", "failed", "access_restricted"]);

function candidateVersion(candidate: CandidateDto | null): number | null {
  if (!candidate) return null;
  const value: unknown = candidate.version;
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

function identityResolved(candidate: CandidateDto | null): boolean {
  return candidate?.identityResolved === true;
}

function requiresDouyinIdentityVerification(
  candidate: CandidateDto | null
): boolean {
  return candidate?.subjectKind === "individual"
    && isDouyinEvidencePlatform(candidate.sourcePlatform)
    && !identityResolved(candidate);
}

function exactDouyinProfileUrl(value: string): string {
  const normalized = normalizeExactDouyinProfileUrl(value);
  if (normalized === null) {
    throw new Error("仅支持 HTTPS 的抖音 /user/ 精确公开主页");
  }
  return normalized;
}

function evidenceSourceType(evidence: EvidenceDto): string | null {
  const value = evidence.provenance.sourceType;
  if (typeof value === "string" && value.trim()) return value.trim();
  return evidence.provenance.kind === "user_submitted_url"
    ? "profile"
    : null;
}

function isDouyinEvidencePlatform(value: string): boolean {
  return ["douyin", "douyin.com", "www.douyin.com"].includes(
    value.trim().toLowerCase()
  );
}

function eligibleIdentityEvidence(
  evidence: EvidenceDto,
  declaredProfileUrl: string
): boolean {
  const sourceUrl = evidence.provenance.sourceUrl;
  if (typeof sourceUrl !== "string") return false;
  let canonicalSource: string;
  try {
    canonicalSource = exactDouyinProfileUrl(sourceUrl);
  } catch {
    return false;
  }
  return evidence.targetType === "individual_signal"
    && isDouyinEvidencePlatform(evidence.sourcePlatform)
    && evidenceSourceType(evidence) === "profile"
    && evidence.accessStatus !== "access_restricted"
    && typeof evidence.fetchedAt === "string"
    && evidence.fetchedAt.trim().length > 0
    && canonicalSource === declaredProfileUrl;
}

function provenanceText(
  evidence: EvidenceDto | null,
  field: "sourceUrl" | "provider"
): string | null {
  const value = evidence?.provenance[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identityEvidenceVm(
  evidence: EvidenceDto,
  state: BattleCardDrawerState
): IdentityEvidenceVm {
  const url = provenanceText(evidence, "sourceUrl");
  const sourceType = evidenceSourceType(evidence);
  const fetchedByCurrentOperation =
    state.identityVerification.fetchedEvidenceIds.includes(evidence.id);
  const exactProfile = url !== null
    && normalizeExactDouyinProfileUrl(url)
      === normalizeExactDouyinProfileUrl(state.identityVerification.profileUrl);
  const eligible = fetchedByCurrentOperation
    && evidence.targetType === "individual_signal"
    && isDouyinEvidencePlatform(evidence.sourcePlatform)
    && sourceType === "profile"
    && evidence.accessStatus !== "access_restricted"
    && Boolean(evidence.fetchedAt)
    && exactProfile;
  let ineligibleReason: string | null = null;
  if (!eligible) {
    if (!fetchedByCurrentOperation) {
      ineligibleReason = "原始发现证据仅用于判断需求，不能直接确认主体";
    } else if (evidence.accessStatus === "access_restricted") {
      ineligibleReason = "公开主页访问受限，不能用于主体核验";
    } else if (!exactProfile || sourceType !== "profile") {
      ineligibleReason = "证据页面与声明的精确抖音主页不一致";
    } else {
      ineligibleReason = "证据缺少可核验的公开抓取信息";
    }
  }
  return {
    id: evidence.id,
    title: evidence.sourceTitle,
    url,
    sourcePlatform: evidence.sourcePlatform,
    sourceType,
    excerpt: evidence.sourceSnippet,
    accessStatus: evidence.accessStatus,
    fetchedAt: evidence.fetchedAt,
    eligible,
    ineligibleReason
  };
}

function identityVerificationPanel(
  state: BattleCardDrawerState,
  callbacks: BattleCardDrawerCallbacks
): string {
  const candidate = state.candidate.data;
  if (
    candidate?.subjectKind !== "individual"
    || !isDouyinEvidencePlatform(candidate.sourcePlatform)
  ) {
    return "";
  }
  const evidence = state.evidence.data ?? [];
  const original = candidate.evidenceIds
    .map((id) => evidence.find((item) => item.id === id) ?? null)
    .find((item): item is EvidenceDto => item !== null)
    ?? evidence[0]
    ?? null;
  return renderIdentityVerificationPanel({
    identityResolved: identityResolved(candidate),
    candidateVersion: candidateVersion(candidate),
    sourcePlatform: candidate.sourcePlatform,
    originalSourceUrl: provenanceText(original, "sourceUrl"),
    originalSourceType: original ? evidenceSourceType(original) : null,
    originalProvider: provenanceText(original, "provider"),
    originalExcerpt: original?.sourceSnippet ?? null,
    profileUrl: state.identityVerification.profileUrl,
    rationale: state.identityVerification.rationale,
    selectedEvidenceIds: state.identityVerification.selectedEvidenceIds,
    evidence: evidence.map((item) => identityEvidenceVm(item, state)),
    status: state.identityVerification.status,
    message: state.identityVerification.message,
    error: state.identityVerification.error
  }, {
    onFetchProfile: callbacks.onFetchIdentityProfile,
    onToggleEvidence: callbacks.onToggleIdentityEvidence,
    onConfirm: callbacks.onConfirmCandidateIdentity,
    onRetryContinuation: callbacks.onRetryIdentityContinuation
  }).html;
}

function identityLockedPanel(): string {
  return `
    <section class="ai-growth-drawer-panel ai-growth-identity-lock" role="status">
      <header><h3>判断与作战资料暂未开放</h3><span>等待主体确认</span></header>
      <p>主体确认后自动继续客户研究、意向与财务价值评估，并生成客户作战卡。</p>
    </section>
  `;
}

function identityStateForLoadedCandidate(
  current: IdentityVerificationState,
  candidate: CandidateDto
): IdentityVerificationState {
  if (!identityResolved(candidate)) return current;
  return {
    ...current,
    status: "confirmed",
    profileUrl: candidate.subjectKind === "individual"
      ? candidate.publicProfileUrl
      : current.profileUrl,
    message: "主体已确认",
    error: null
  };
}

function eligibleForBattleCard(
  qualification: QualificationDto | null
): boolean | null {
  if (qualification === null) return null;
  return qualification.hardGateFailures.length === 0
    && (
      qualification.grade === "S"
      || qualification.grade === "A"
      || qualification.score >= 70
    );
}

function mergeEvidence(
  current: EvidenceDto[],
  incoming: EvidenceDto[]
): EvidenceDto[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

const REVIEWABLE_ACTIONS: Readonly<
  Partial<Record<CandidateStatus, readonly CandidateReviewAction[]>>
> = {
  pending_review: ["approved", "rejected", "do_not_contact", "needs_research"],
  rejected: ["reopen"]
};

const REASON_REQUIRED_ACTIONS = new Set<CandidateReviewAction>([
  "rejected",
  "needs_research",
  "reopen"
]);

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

function inferenceStatus(
  kind: BattleCardClaimDto["kind"],
  confidence: number | null
): string {
  return kind === "inference"
    ? `<span class="ai-growth-inference-label">推测 · ${confidence === null
      ? "置信度待核验"
      : `置信度 ${percent(confidence)}`}</span>`
    : "";
}

function claimEvidence(
  claim: BattleCardClaimDto,
  index: Map<string, EvidenceDto>
): string {
  const vm = battleCardClaimVm(claim);
  return `
    <div class="ai-growth-battle-claim__heading">
      ${inferenceStatus(vm.kind, vm.confidence)}
    </div>
    <p>${escapeHtml(vm.content)}</p>
    <div class="ai-growth-evidence-links">
      ${vm.evidenceIds.length === 0
        ? `<span class="ai-growth-empty-value">暂无可链接证据</span>`
        : vm.evidenceIds.map((id) => evidenceReference(id, index)).join("")}
    </div>
  `;
}

function claimsRegion(
  id: string,
  title: string,
  claims: BattleCardClaimDto[],
  index: Map<string, EvidenceDto>
): string {
  return `
    <section class="ai-growth-battle-section ai-growth-battle-section--v2" data-v2-region="${id}">
      <header><h3>${title}</h3></header>
      ${claims.length === 0
        ? `<p class="ai-growth-empty-value">暂无可核验结论</p>`
        : claims.map((claim) => `
          <article data-claim-kind="${claim.kind}">
            ${claimEvidence(claim, index)}
          </article>
        `).join("")}
    </section>
  `;
}

const CHANNEL_LABELS: Readonly<
  Record<BattleCardConnectionChannel, string>
> = {
  public_reply: "公开回复",
  wecom: "企业微信",
  phone: "电话",
  email: "邮件",
  referral: "转介绍"
};

const INFLUENCE_LABELS = {
  decision_maker: "决策人",
  influencer: "影响人",
  user: "使用者",
  gatekeeper: "把关人"
} as const;

function financialSummaryContent(
  value: BattleCardFinancialSummaryDto | null
): string {
  if (value === null) {
    return `<p class="ai-growth-empty-value">待财务评估，不展示推测金额</p>`;
  }
  const amounts = [
    ["预计收入", value.expectedRevenueMinor],
    ["预计毛利", value.expectedGrossProfitMinor],
    ["预计贡献", value.expectedContributionMinor]
  ] as const;
  return `
    <div class="ai-growth-battle-financial-grid">
      ${amounts.map(([label, amountMinor]) => `
        <div>
          <span>${label}</span>
          <strong>${escapeHtml(formatMinorAmount({
            currency: value.currency,
            amountMinor
          }))}</strong>
        </div>
      `).join("")}
    </div>
    <p>财务等级 ${value.grade} · ${value.score} 分；金额来自当前财务决定，仍需人工确认。</p>
  `;
}

function renderBattleCardV2(
  card: Extract<BattleCardDto, { schemaVersion: "battle-card.v2" }>,
  index: Map<string, EvidenceDto>
): string {
  const intelligence = card.intelligence;
  return [
    claimsRegion(
      "account-overview",
      "客户概况",
      intelligence.accountOverview,
      index
    ),
    claimsRegion(
      "need-assessment",
      "需求证据",
      intelligence.needAssessment,
      index
    ),
    claimsRegion(
      "suppliers",
      "供应商",
      intelligence.supplierHypotheses,
      index
    ),
    `
      <section class="ai-growth-battle-section ai-growth-battle-section--v2" data-v2-region="buying-committee">
        <header><h3>决策链</h3></header>
        ${intelligence.buyingCommittee.length === 0
          ? `<p class="ai-growth-empty-value">尚未识别可核验的商务角色</p>`
          : intelligence.buyingCommittee.map((item) => `
            <article>
              <div class="ai-growth-battle-role">
                <strong>${escapeHtml(item.role)}</strong>
                <span>优先级 ${item.priority} · ${INFLUENCE_LABELS[item.influence]}</span>
              </div>
              ${item.concerns.length === 0
                ? ""
                : `<p>关注：${escapeHtml(item.concerns.join("、"))}</p>`}
              ${claimEvidence(item.claim, index)}
            </article>
          `).join("")}
      </section>
    `,
    claimsRegion(
      "procurement-preferences",
      "采购偏好",
      intelligence.procurementPreferences,
      index
    ),
    `
      <section class="ai-growth-battle-section ai-growth-battle-section--v2" data-v2-region="connection-strategies">
        <header><h3>连接策略</h3></header>
        ${intelligence.connectionStrategies.length === 0
          ? `<p class="ai-growth-empty-value">暂无建议连接路径</p>`
          : intelligence.connectionStrategies.map((item) => `
            <article>
              <div class="ai-growth-battle-role">
                <strong>${CHANNEL_LABELS[item.channel]}</strong>
                <span>目标角色：${escapeHtml(item.targetRole)}</span>
              </div>
              ${claimEvidence(item.rationale, index)}
              <p><strong>开场草稿：</strong>${escapeHtml(item.openingDraft)}</p>
            </article>
          `).join("")}
      </section>
    `,
    `
      <section class="ai-growth-battle-section ai-growth-battle-section--v2" data-v2-region="role-openers">
        <header><h3>角色话术</h3></header>
        ${intelligence.roleSpecificOpeners.length === 0
          ? `<p class="ai-growth-empty-value">暂无分角色开场草稿</p>`
          : intelligence.roleSpecificOpeners.map((item) => `
            <article>
              <div class="ai-growth-battle-role">
                <strong>${escapeHtml(item.role)}</strong>
                <span>${CHANNEL_LABELS[item.channel]} · 人工审核后使用</span>
              </div>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `).join("")}
      </section>
    `,
    `
      <section class="ai-growth-battle-section ai-growth-battle-section--v2" data-v2-region="do-not-actions">
        <header><h3>不建议动作</h3></header>
        ${intelligence.doNotActions.length === 0
          ? `<p class="ai-growth-empty-value">暂无额外限制</p>`
          : `<ul class="ai-growth-reason-list">${intelligence.doNotActions
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}</ul>`}
      </section>
    `,
    `
      <section class="ai-growth-battle-section ai-growth-battle-section--v2" data-v2-region="financial-summary">
        <header><h3>财务摘要</h3></header>
        ${financialSummaryContent(intelligence.financialSummary)}
      </section>
    `
  ].join("");
}

function renderBattleCardV1(
  card: Exclude<BattleCardDto, { schemaVersion: "battle-card.v2" }>,
  index: Map<string, EvidenceDto>
): string {
  const sections = battleCardSectionsVm(card.sections);
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

function battleCardContent(state: BattleCardDrawerState): string {
  if (state.battleCard.status === "loading") {
    return `<p class="ai-growth-empty-value">正在读取客户作战卡</p>`;
  }
  if (state.battleCard.status === "missing") {
    return `
      <div class="ai-growth-drawer-empty">
        <strong>客户作战卡尚未生成</strong>
        <p>生成动作将交给受控工具执行，并在任务成功后读取结果。</p>
        ${state.readOnly
          ? ""
          : `<button type="button" class="ai-growth-button ai-growth-button--primary" data-action="generate-battle-card">生成客户作战卡</button>`}
      </div>
    `;
  }
  if (state.battleCard.status === "error") {
    return resourceError(state.battleCard);
  }
  const card = state.battleCard.data;
  if (card === null) return "";

  const index = evidenceIndex(state.evidence.data ?? []);
  if (card.schemaVersion === "battle-card.v2" && card.intelligence) {
    return renderBattleCardV2(card, index);
  }
  return renderBattleCardV1(card, index);
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
          <span>复核说明（批准、勿扰可选；驳回、补充研究时必填）</span>
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
        <p>只有存在新增公开证据时才能重新打开，并需记录明确原因。</p>
        <label>
          <span>重新打开原因（必填）</span>
          <textarea data-review-reason rows="3" required placeholder="说明新增证据及重新评估原因"></textarea>
        </label>
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
  const v2Card = state.battleCard.data?.schemaVersion === "battle-card.v2";
  const identityBlocked = requiresDouyinIdentityVerification(candidate);
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
          ${state.readOnly
            ? `<span class="ai-growth-inference-label">演示数据 · 只读</span>`
            : ""}
        </div>
        <button type="button" class="ai-growth-drawer-close" data-action="close-battle-card" aria-label="关闭客户作战卡">关闭</button>
      </header>
      <div class="ai-growth-battle-drawer__body">
        ${resourceError(state.candidate)}
        ${resourceError(state.evidence)}
        ${identityVerificationPanel(state, callbacks)}
        ${identityBlocked
          ? identityLockedPanel()
          : `
            ${qualificationPanel(state)}
            ${v2Card ? "" : financialPanel(state)}
            <section class="ai-growth-drawer-card">
              <div class="ai-growth-section-heading">
                <div><p class="ai-growth-eyebrow">行动依据</p><h2>客户作战卡</h2></div>
                <span>${state.battleCard.data ? `整体置信度 ${percent(state.battleCard.data.confidence)}` : ""}</span>
              </div>
              ${battleCardContent(state)}
            </section>
            ${state.readOnly ? "" : reviewPanel(state)}
            ${state.readOnly ? "" : approvedActions(state)}
          `}
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
  let identityFetchPromise: Promise<void> | null = null;
  let identityConfirmationPromise: Promise<void> | null = null;
  let identityContinuationPromise: Promise<void> | null = null;
  const notify = () => options.onStateChange?.(state);

  const callbacks: BattleCardDrawerCallbacks = {
    onClose: () => drawer.close(),
    onFetchIdentityProfile: (profileUrl) =>
      drawer.fetchIdentityProfile(profileUrl),
    onIdentityDraftChange: (input) => drawer.setIdentityDraft(input),
    onToggleIdentityEvidence: (evidenceId, selected) =>
      drawer.toggleIdentityEvidence(evidenceId, selected),
    onConfirmCandidateIdentity: (input) =>
      drawer.confirmCandidateIdentity(input),
    onRetryIdentityContinuation: () => drawer.retryIdentityContinuation(),
    onRunQualification: () => drawer.runQualification(),
    onGenerateBattleCard: () => drawer.generateBattleCard(),
    onReview: ({ action, reason }) => drawer.review(action, reason),
    onConvert: () => drawer.convert(),
    onCreateOutreachReviewTask: () =>
      drawer.createOutreachReviewTask()
  };

  interface ActionContext {
    candidateId: string;
    generation: number;
  }

  function assertMutable() {
    if (state.readOnly) {
      throw new Error("演示作战卡为只读，不能执行真实写入动作");
    }
  }

  function captureContext(): ActionContext {
    assertMutable();
    if (!state.candidateId || !state.open) {
      throw new Error("请先打开候选客户");
    }
    return { candidateId: state.candidateId, generation };
  }

  function isActive(context: ActionContext): boolean {
    return state.open
      && context.generation === generation
      && state.candidateId === context.candidateId;
  }

  function publishAction(
    context: ActionContext,
    next: BattleCardActionState
  ): boolean {
    if (!isActive(context)) return false;
    state.action = next;
    notify();
    return true;
  }

  function publishIdentity(
    context: ActionContext,
    update: (current: IdentityVerificationState) => IdentityVerificationState
  ): boolean {
    if (!isActive(context)) return false;
    state.identityVerification = update(state.identityVerification);
    notify();
    return true;
  }

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    sessionId = copilotSessionResourceId(
      await api.createSession({}, key())
    );
    return sessionId;
  }

  async function pollTask(
    context: ActionContext,
    task: CopilotTaskDto
  ): Promise<CopilotTaskDto | null> {
    let current = task;
    while (!TERMINAL_TASK_STATUSES.has(current.status)) {
      if (!isActive(context)) return null;
      publishAction(context, { ...state.action, status: current.status });
      await wait(pollMs);
      if (!isActive(context)) return null;
      current = await api.getCopilotTask(current.id);
    }
    if (!isActive(context)) return null;
    publishAction(context, { ...state.action, status: current.status });
    return current;
  }

  async function pollContentFetch(
    context: ActionContext,
    operation: ContentFetchOperationDto
  ): Promise<ContentFetchOperationDto | null> {
    let current = operation;
    while (!TERMINAL_CONTENT_FETCH_STATUSES.has(current.status)) {
      if (!isActive(context)) return null;
      await wait(pollMs);
      if (!isActive(context)) return null;
      current = await api.getContentFetchOperation(current.id);
    }
    return isActive(context) ? current : null;
  }

  async function pollIdentityTask(
    context: ActionContext,
    task: CopilotTaskDto
  ): Promise<CopilotTaskDto | null> {
    let current = task;
    while (!TERMINAL_TASK_STATUSES.has(current.status)) {
      if (!isActive(context)) return null;
      await wait(pollMs);
      if (!isActive(context)) return null;
      current = await api.getCopilotTask(current.id);
    }
    return isActive(context) ? current : null;
  }

  async function runIdentityFetch(
    context: ActionContext,
    profileUrl: string
  ): Promise<void> {
    publishIdentity(context, (current) => ({
      ...current,
      status: "fetching_profile",
      profileUrl,
      selectedEvidenceIds: [],
      fetchedEvidenceIds: [],
      fetch: { status: "running", data: null, error: null },
      confirmation: identityActionResource(),
      message: "正在受控抓取公开主页",
      error: null
    }));
    try {
      const created = await api.createContentFetchOperation(
        { sourceUrl: profileUrl, subjectChannel: "individual" },
        key()
      );
      if (!isActive(context)) return;
      const completed = await pollContentFetch(context, created);
      if (completed === null || !isActive(context)) return;
      if (completed.status === "access_restricted") {
        publishIdentity(context, (current) => ({
          ...current,
          status: "fetch_failed",
          fetch: {
            status: "failed",
            data: completed,
            error: "公开主页访问受限"
          },
          message: null,
          error: "公开主页访问受限，系统未绕过登录、验证码或访问控制。"
        }));
        return;
      }
      if (completed.status !== "succeeded") {
        const detail = completed.errorCode
          ? `公开主页抓取失败（${completed.errorCode}）`
          : "公开主页抓取失败";
        publishIdentity(context, (current) => ({
          ...current,
          status: "fetch_failed",
          fetch: { status: "failed", data: completed, error: detail },
          message: null,
          error: detail
        }));
        return;
      }
      const fetchedEvidence = await Promise.all(
        completed.evidenceIds.map((id) => api.getEvidenceById(id))
      );
      if (!isActive(context)) return;
      const eligibleEvidenceIds = fetchedEvidence
        .filter((item) => eligibleIdentityEvidence(item, profileUrl))
        .map((item) => item.id);
      state.evidence = {
        status: "ready",
        data: mergeEvidence(state.evidence.data ?? [], fetchedEvidence),
        error: null
      };
      publishIdentity(context, (current) => ({
        ...current,
        status: eligibleEvidenceIds.length > 0
          ? "ready_to_confirm"
          : "fetched_no_eligible",
        fetchedEvidenceIds: eligibleEvidenceIds,
        selectedEvidenceIds: [],
        fetch: { status: "succeeded", data: completed, error: null },
        message: eligibleEvidenceIds.length > 0
          ? "公开主页已抓取，请人工核验证据"
          : null,
        error: eligibleEvidenceIds.length > 0
          ? null
          : "抓取完成，但没有返回可核验的公开证据"
      }));
    } catch (error) {
      if (!isActive(context)) return;
      const detail = errorMessage(error);
      publishIdentity(context, (current) => ({
        ...current,
        status: "fetch_failed",
        fetch: { status: "failed", data: null, error: detail },
        message: null,
        error: detail
      }));
      throw error;
    }
  }

  async function runTool(
    context: ActionContext,
    kind: BattleCardActionKind,
    toolName: string,
    message: string,
    successMessage: string
  ): Promise<boolean> {
    if (!publishAction(context, {
      kind,
      status: "queued",
      taskId: null,
      message: null,
      error: null
    })) return false;
    try {
      const activeSessionId = await ensureSession();
      if (!isActive(context)) return false;
      const task = await api.requestAssistantAction(
        activeSessionId,
        message,
        key()
      );
      if (!isActive(context)) return false;
      publishAction(context, { ...state.action, taskId: task.id });
      const complete = await pollTask(context, task);
      if (complete === null || !isActive(context)) return false;
      if (complete.status !== "succeeded") {
        publishAction(context, {
          ...state.action,
          error: complete.status === "cancelled"
            ? "任务已取消"
            : "受控任务执行失败"
        });
        return false;
      }
      if (!copilotTaskIncludesToolName(complete, toolName)) {
        publishAction(context, {
          ...state.action,
          status: "failed",
          error: `任务未执行 ${toolName}，未刷新领域结果`
        });
        return false;
      }
      publishAction(context, {
        ...state.action,
        status: "succeeded",
        message: successMessage,
        error: null
      });
      return true;
    } catch (error) {
      if (isActive(context)) {
        publishAction(context, {
          ...state.action,
          status: "failed",
          error: errorMessage(error)
        });
      }
      return false;
    }
  }

  async function refreshQualificationAndFinance(context: ActionContext) {
    const [qualificationResult, financialResult] = await Promise.all([
      settleResource(() => api.getQualification(context.candidateId)),
      settleResource(() => api.getFinancialValue(context.candidateId))
    ]);
    if (!isActive(context)) return;
    state.qualification = qualificationResult;
    state.financialValue = financialResult;
    notify();
  }

  async function refreshAfterReview(context: ActionContext) {
    const [candidateResult, qualificationResult, financialResult] =
      await Promise.all([
        settleResource(() => api.getCandidate(context.candidateId)),
        settleResource(() => api.getQualification(context.candidateId)),
        settleResource(() => api.getFinancialValue(context.candidateId))
      ]);
    if (!isActive(context)) return;
    state.candidate = candidateResult;
    state.qualification = qualificationResult;
    state.financialValue = financialResult;
    if (candidateResult.data) onCandidateUpdated(candidateResult.data);
    notify();
  }

  async function refreshCandidateAndEvidence(context: ActionContext) {
    const [candidateResult, evidenceResult] = await Promise.all([
      settleResource(() => api.getCandidate(context.candidateId)),
      settleResource(() =>
        api.getEvidence(context.candidateId).then((page) => page.items)
      )
    ]);
    if (!isActive(context)) return;
    state.candidate = candidateResult;
    state.evidence = evidenceResult;
    if (candidateResult.data) onCandidateUpdated(candidateResult.data);
    notify();
  }

  async function refreshCandidateQualificationAndFinance(
    context: ActionContext
  ) {
    const [candidateResult, qualificationResult, financialResult] =
      await Promise.all([
        settleResource(() => api.getCandidate(context.candidateId)),
        settleResource(() => api.getQualification(context.candidateId)),
        settleResource(() => api.getFinancialValue(context.candidateId))
      ]);
    if (!isActive(context)) return;
    state.candidate = candidateResult;
    state.qualification = qualificationResult;
    state.financialValue = financialResult;
    if (candidateResult.data) onCandidateUpdated(candidateResult.data);
    notify();
  }

  async function refreshAllAfterIdentity(context: ActionContext) {
    const [
      candidateResult,
      evidenceResult,
      qualificationResult,
      financialResult,
      battleCardResult
    ] = await Promise.all([
      settleResource(() => api.getCandidate(context.candidateId)),
      settleResource(() =>
        api.getEvidence(context.candidateId).then((page) => page.items)
      ),
      settleResource(() => api.getQualification(context.candidateId)),
      settleResource(() => api.getFinancialValue(context.candidateId)),
      settleResource(() => api.getBattleCard(context.candidateId))
    ]);
    if (!isActive(context)) return;
    state.candidate = candidateResult;
    state.evidence = evidenceResult;
    state.qualification = qualificationResult;
    state.financialValue = financialResult;
    state.battleCard = battleCardResult;
    if (candidateResult.data) onCandidateUpdated(candidateResult.data);
    notify();
  }

  async function runIdentityTool(
    context: ActionContext,
    toolName:
      | "research_candidate"
      | "qualify_candidate"
      | "build_battle_card",
    message: string
  ): Promise<boolean> {
    try {
      const activeSessionId = await ensureSession();
      if (!isActive(context)) return false;
      const task = await api.requestAssistantAction(
        activeSessionId,
        message,
        key()
      );
      if (!isActive(context)) return false;
      const completed = await pollIdentityTask(context, task);
      if (completed === null || !isActive(context)) return false;
      return completed.status === "succeeded"
        && copilotTaskIncludesToolName(completed, toolName);
    } catch {
      return false;
    }
  }

  async function runIdentityContinuation(
    context: ActionContext
  ): Promise<void> {
    const completedTools = [
      ...(state.identityVerification.continuation.data?.completedTools ?? [])
    ];
    publishIdentity(context, (current) => ({
      ...current,
      continuation: {
        status: "running",
        data: { completedTools: [...completedTools] },
        error: null
      },
      error: null
    }));
    const steps = [
      {
        toolName: "research_candidate" as const,
        status: "researching" as const,
        message: "正在补充客户研究",
        prompt: `请调用 research_candidate 工具补充候选研究。参数：${JSON.stringify({
          candidateId: context.candidateId,
          depth: "standard"
        })}`,
        refresh: () => refreshCandidateAndEvidence(context)
      },
      {
        toolName: "qualify_candidate" as const,
        status: "qualifying" as const,
        message: "正在重新计算意向与财务价值",
        prompt: `请调用 qualify_candidate 工具评估候选。参数：${JSON.stringify({
          candidateId: context.candidateId,
          policyVersion: "qualification.v1"
        })}`,
        refresh: () => refreshCandidateQualificationAndFinance(context)
      },
      {
        toolName: "build_battle_card" as const,
        status: "building_card" as const,
        message: "正在生成客户作战卡",
        prompt: `请调用 build_battle_card 工具生成客户作战卡。参数：${JSON.stringify({
          candidateId: context.candidateId,
          templateVersion: "battle-card.v2"
        })}`,
        refresh: () => refreshAllAfterIdentity(context)
      }
    ];
    for (const step of steps) {
      if (completedTools.includes(step.toolName)) continue;
      if (!publishIdentity(context, (current) => ({
        ...current,
        status: step.status,
        message: step.message,
        error: null
      }))) return;
      const ok = await runIdentityTool(
        context,
        step.toolName,
        step.prompt
      );
      if (!isActive(context)) return;
      if (!ok) {
        const detail = `${step.message}失败，请重试后续生成`;
        publishIdentity(context, (current) => ({
          ...current,
          status: "continuation_partial",
          continuation: {
            status: "failed",
            data: { completedTools: [...completedTools] },
            error: detail
          },
          message: "主体已确认，后续生成未全部完成",
          error: detail
        }));
        return;
      }
      completedTools.push(step.toolName);
      publishIdentity(context, (current) => ({
        ...current,
        continuation: {
          status: "running",
          data: { completedTools: [...completedTools] },
          error: null
        }
      }));
      await step.refresh();
      if (!isActive(context)) return;
      if (step.toolName === "qualify_candidate") {
        const eligible = eligibleForBattleCard(state.qualification.data);
        if (eligible === false) {
          publishIdentity(context, (current) => ({
            ...current,
            status: "complete",
            continuation: {
              status: "succeeded",
              data: { completedTools: [...completedTools] },
              error: null
            },
            message: "资格评估已完成；当前不满足作战卡生成条件",
            error: null
          }));
          return;
        }
      }
    }
    publishIdentity(context, (current) => ({
      ...current,
      status: "complete",
      continuation: {
        status: "succeeded",
        data: { completedTools: [...completedTools] },
        error: null
      },
      message: "作战资料已生成，等待人工审核",
      error: null
    }));
  }

  function startIdentityContinuation(
    context: ActionContext
  ): Promise<void> {
    if (identityContinuationPromise) return identityContinuationPromise;
    const promise = runIdentityContinuation(context);
    identityContinuationPromise = promise;
    void promise.then(
      () => {
        if (identityContinuationPromise === promise) {
          identityContinuationPromise = null;
        }
      },
      () => {
        if (identityContinuationPromise === promise) {
          identityContinuationPromise = null;
        }
      }
    );
    return promise;
  }

  function validateIdentitySubmission(
    input: CandidateIdentitySubmission
  ): {
    profileUrl: string;
    rationale: string;
    evidenceIds: string[];
    version: number;
  } {
    if (state.identityVerification.status !== "ready_to_confirm") {
      throw new Error("请先完成公开主页抓取并取得可核验证据");
    }
    const profileUrl = exactDouyinProfileUrl(input.profileUrl);
    if (profileUrl !== state.identityVerification.profileUrl) {
      throw new Error("确认主页与已抓取的公开主页不一致");
    }
    const rationale = input.rationale.trim();
    if (!rationale) throw new Error("请填写人工核验说明");
    const evidenceIds = [...new Set(
      input.evidenceIds.map((id) => id.trim()).filter(Boolean)
    )];
    if (evidenceIds.length === 0) {
      throw new Error("请至少选择一条公开证据");
    }
    const allowed = new Set(state.identityVerification.fetchedEvidenceIds);
    if (evidenceIds.some((id) => !allowed.has(id))) {
      throw new Error("所选证据不是本次受控抓取返回的公开证据");
    }
    const version = candidateVersion(state.candidate.data);
    if (version === null) {
      throw new AdvisorPreconditionRequiredError(
        Object.assign(new Error("候选版本缺失"), { status: 428 })
      );
    }
    return { profileUrl, rationale, evidenceIds, version };
  }

  async function runIdentityConfirmation(
    context: ActionContext,
    input: CandidateIdentitySubmission
  ): Promise<void> {
    let validated: ReturnType<typeof validateIdentitySubmission>;
    try {
      validated = validateIdentitySubmission(input);
    } catch (error) {
      const detail = errorMessage(error);
      publishIdentity(context, (current) => ({
        ...current,
        status: "validation_error",
        confirmation: { status: "failed", data: null, error: detail },
        message: null,
        error: detail
      }));
      throw error;
    }
    publishIdentity(context, (current) => ({
      ...current,
      status: "confirming",
      confirmation: { status: "running", data: null, error: null },
      message: "正在保存主体确认",
      error: null
    }));
    try {
      const result = await api.confirmCandidateIdentity(
        context.candidateId,
        validated.version,
        {
          subjectKind: "individual",
          publicProfileUrl: validated.profileUrl,
          sourcePlatform: "douyin",
          evidenceIds: validated.evidenceIds,
          rationale: validated.rationale
        },
        key()
      );
      if (!isActive(context)) return;
      state.candidate = { status: "ready", data: result.candidate, error: null };
      onCandidateUpdated(result.candidate);
      publishIdentity(context, (current) => ({
        ...current,
        status: "confirmed",
        profileUrl: validated.profileUrl,
        rationale: validated.rationale,
        selectedEvidenceIds: [...validated.evidenceIds],
        confirmation: { status: "succeeded", data: result, error: null },
        continuation: identityActionResource(),
        message: "主体已确认",
        error: null
      }));
      await startIdentityContinuation(context);
    } catch (error) {
      if (!isActive(context)) return;
      if (error instanceof AdvisorConflictError) {
        await refreshCandidateAndEvidence(context);
        if (!isActive(context)) return;
        if (identityResolved(state.candidate.data)) {
          publishIdentity(context, (current) => ({
            ...current,
            status: "confirmed",
            profileUrl: state.candidate.data?.subjectKind === "individual"
              ? state.candidate.data.publicProfileUrl
              : validated.profileUrl,
            rationale: validated.rationale,
            selectedEvidenceIds: [...validated.evidenceIds],
            confirmation: {
              status: "succeeded",
              data: null,
              error: null
            },
            continuation: identityActionResource(),
            message: "主体已由其他成员确认，继续生成作战资料",
            error: null
          }));
          await startIdentityContinuation(context);
          return;
        }
        publishIdentity(context, (current) => ({
          ...current,
          status: "conflict",
          confirmation: {
            status: "conflict",
            data: null,
            error: "候选已被其他成员更新"
          },
          message: null,
          error: "候选已被其他成员更新，请核对最新版本后重试。"
        }));
        throw error;
      }
      const detail = error instanceof AdvisorPreconditionRequiredError
        ? "候选版本信息缺失，请刷新后重试。"
        : errorMessage(error);
      publishIdentity(context, (current) => ({
        ...current,
        status: "validation_error",
        confirmation: { status: "failed", data: null, error: detail },
        message: null,
        error: detail
      }));
      throw error;
    }
  }

  const drawer: BattleCardDrawer = {
    getState: () => state,

    render: () => renderBattleCardDrawer(state, callbacks),

    async open(candidateId) {
      identityFetchPromise = null;
      identityConfirmationPromise = null;
      identityContinuationPromise = null;
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
      if (
        currentGeneration === generation
        && state.candidateId === candidateId
        && state.candidate.data
      ) {
        state.identityVerification = identityStateForLoadedCandidate(
          state.identityVerification,
          state.candidate.data
        );
        notify();
      }
    },

    openFixture(
      candidate,
      card,
      evidenceItems,
      qualificationValue,
      financialValue
    ) {
      identityFetchPromise = null;
      identityConfirmationPromise = null;
      identityContinuationPromise = null;
      generation += 1;
      state = {
        ...initialState(),
        open: true,
        readOnly: true,
        candidateId: candidate.id,
        candidate: { status: "ready", data: candidate, error: null },
        evidence: {
          status: "ready",
          data: [...evidenceItems],
          error: null
        },
        qualification: qualificationValue === null
          ? { status: "missing", data: null, error: null }
          : { status: "ready", data: qualificationValue, error: null },
        financialValue: financialValue === null
          ? { status: "missing", data: null, error: null }
          : { status: "ready", data: financialValue, error: null },
        battleCard: { status: "ready", data: card, error: null }
      };
      state.identityVerification = identityStateForLoadedCandidate(
        state.identityVerification,
        candidate
      );
      notify();
    },

    close() {
      identityFetchPromise = null;
      identityConfirmationPromise = null;
      identityContinuationPromise = null;
      generation += 1;
      state = initialState();
      notify();
    },

    setIdentityDraft(input) {
      const context = captureContext();
      publishIdentity(context, (current) => {
        const profileUrl = input.profileUrl ?? current.profileUrl;
        const profileChanged = profileUrl !== current.profileUrl;
        const canRetryConfirmation = !profileChanged
          && current.status === "validation_error"
          && current.fetchedEvidenceIds.length > 0;
        let transition: Partial<IdentityVerificationState> = {};
        if (profileChanged) {
          transition = {
            status: isExactDouyinProfileUrl(profileUrl)
              ? "ready_to_fetch"
              : "needs_profile",
            fetchedEvidenceIds: [],
            selectedEvidenceIds: [],
            fetch: identityActionResource<ContentFetchOperationDto>(),
            confirmation:
              identityActionResource<CandidateIdentityConfirmationResultDto>(),
            continuation: identityActionResource<IdentityContinuationResult>(),
            message: null,
            error: null
          };
        } else if (canRetryConfirmation) {
          transition = {
            status: "ready_to_confirm",
            confirmation:
              identityActionResource<CandidateIdentityConfirmationResultDto>(),
            message: "请核验公开主页证据并确认主体",
            error: null
          };
        }
        return {
          ...current,
          profileUrl,
          rationale: input.rationale ?? current.rationale,
          ...transition
        };
      });
    },

    toggleIdentityEvidence(evidenceId, selected) {
      const context = captureContext();
      const normalizedId = evidenceId.trim();
      if (!normalizedId) throw new Error("证据 ID 不能为空");
      if (
        selected
        && !state.identityVerification.fetchedEvidenceIds.includes(normalizedId)
      ) {
        throw new Error("该证据不属于本次可核验的公开主页证据");
      }
      publishIdentity(context, (current) => {
        const selectedEvidenceIds = new Set(current.selectedEvidenceIds);
        if (selected) selectedEvidenceIds.add(normalizedId);
        else selectedEvidenceIds.delete(normalizedId);
        return {
          ...current,
          selectedEvidenceIds: [...selectedEvidenceIds],
          ...(current.status === "validation_error"
            && current.fetchedEvidenceIds.length > 0
            ? {
                status: "ready_to_confirm" as const,
                confirmation:
                  identityActionResource<CandidateIdentityConfirmationResultDto>(),
                message: "请核验公开主页证据并确认主体",
                error: null
              }
            : {})
        };
      });
    },

    fetchIdentityProfile(rawProfileUrl) {
      if (identityFetchPromise) return identityFetchPromise;
      let context: ActionContext;
      let profileUrl: string;
      try {
        context = captureContext();
        profileUrl = exactDouyinProfileUrl(rawProfileUrl);
      } catch (error) {
        if (state.open && state.candidateId) {
          state.identityVerification = {
            ...state.identityVerification,
            status: "validation_error",
            error: errorMessage(error),
            message: null
          };
          notify();
        }
        return Promise.reject(error);
      }
      const promise = runIdentityFetch(context, profileUrl);
      identityFetchPromise = promise;
      void promise.then(
        () => {
          if (identityFetchPromise === promise) {
            identityFetchPromise = null;
          }
        },
        () => {
          if (identityFetchPromise === promise) {
            identityFetchPromise = null;
          }
        }
      );
      return promise;
    },

    confirmCandidateIdentity(input) {
      if (identityConfirmationPromise) return identityConfirmationPromise;
      let context: ActionContext;
      try {
        context = captureContext();
      } catch (error) {
        return Promise.reject(error);
      }
      const promise = runIdentityConfirmation(context, input);
      identityConfirmationPromise = promise;
      void promise.then(
        () => {
          if (identityConfirmationPromise === promise) {
            identityConfirmationPromise = null;
          }
        },
        () => {
          if (identityConfirmationPromise === promise) {
            identityConfirmationPromise = null;
          }
        }
      );
      return promise;
    },

    retryIdentityContinuation() {
      if (identityContinuationPromise) return identityContinuationPromise;
      let context: ActionContext;
      try {
        context = captureContext();
        if (!identityResolved(state.candidate.data)) {
          throw new Error("请先完成主体核验");
        }
        if (![
          "confirmed",
          "continuation_partial"
        ].includes(state.identityVerification.status)) {
          throw new Error("当前没有可重试的主体核验续跑任务");
        }
      } catch (error) {
        return Promise.reject(error);
      }
      return startIdentityContinuation(context);
    },

    async runQualification() {
      const context = captureContext();
      const ok = await runTool(
        context,
        "qualification",
        "qualify_candidate",
        `请调用 qualify_candidate 工具评估候选。参数：${JSON.stringify({
          candidateId: context.candidateId,
          policyVersion: "qualification.v1"
        })}`,
        "资格评估已完成"
      );
      if (ok && isActive(context)) {
        await refreshQualificationAndFinance(context);
      }
    },

    async generateBattleCard() {
      const context = captureContext();
      const ok = await runTool(
        context,
        "battle_card",
        "build_battle_card",
        `请调用 build_battle_card 工具生成客户作战卡。参数：${JSON.stringify({
          candidateId: context.candidateId,
          templateVersion: "battle-card.v2"
        })}`,
        "客户作战卡已生成"
      );
      if (ok && isActive(context)) {
        const result = await settleResource(() =>
          api.getBattleCard(context.candidateId)
        );
        if (!isActive(context)) return;
        state.battleCard = result;
        notify();
      }
    },

    async review(action, reason = null) {
      assertMutable();
      const candidate = state.candidate.data;
      if (!candidate || !state.candidateId || !state.open) {
        throw new Error("请先读取候选客户");
      }
      const context = captureContext();
      const allowed = REVIEWABLE_ACTIONS[candidate.status] ?? [];
      if (!allowed.includes(action)) {
        throw new Error("当前候选状态不允许该人工复核动作");
      }
      if (!candidate.latestDecisionVersion) {
        throw new Error("候选尚无可复核的资格决定版本");
      }
      const normalizedReason = reason?.trim() || null;
      if (REASON_REQUIRED_ACTIONS.has(action) && normalizedReason === null) {
        throw new Error("该审核动作必须填写原因");
      }
      publishAction(context, {
        kind: "candidate_review",
        status: "running",
        taskId: null,
        message: null,
        error: null
      });
      try {
        await api.reviewCandidate(
          context.candidateId,
          {
            action,
            decisionVersion: candidate.latestDecisionVersion,
            reason: normalizedReason
          },
          key()
        );
        if (!isActive(context)) return;
        await refreshAfterReview(context);
        if (!isActive(context)) return;
        publishAction(context, {
          ...state.action,
          status: "succeeded",
          message: "人工复核结果已保存"
        });
      } catch (error) {
        if (!isActive(context)) return;
        publishAction(context, {
          ...state.action,
          status: "failed",
          error: errorMessage(error)
        });
        throw error;
      }
    },

    async convert() {
      assertMutable();
      const candidate = state.candidate.data;
      if (!state.candidateId || !state.open
        || !approvedCurrentDecision(candidate)) {
        throw new Error("当前资格决定尚未获得有效批准");
      }
      const context = captureContext();
      publishAction(context, {
        kind: "conversion",
        status: "running",
        taskId: null,
        message: null,
        error: null
      });
      try {
        await api.convertCandidate(
          context.candidateId,
          { decisionVersion: candidate!.latestDecisionVersion! },
          key()
        );
        if (!isActive(context)) return;
        const result = await settleResource(() =>
          api.getCandidate(context.candidateId)
        );
        if (!isActive(context)) return;
        state.candidate = result;
        if (state.candidate.data) onCandidateUpdated(state.candidate.data);
        notify();
        publishAction(context, {
          ...state.action,
          status: "succeeded",
          message: "候选已转为线索"
        });
      } catch (error) {
        if (!isActive(context)) return;
        publishAction(context, {
          ...state.action,
          status: "failed",
          error: errorMessage(error)
        });
        throw error;
      }
    },

    async createOutreachReviewTask() {
      assertMutable();
      const candidate = state.candidate.data;
      if (!state.candidateId || !state.open
        || !approvedCurrentDecision(candidate)) {
        throw new Error("当前资格决定尚未获得有效批准");
      }
      const context = captureContext();
      await runTool(
        context,
        "outreach_review",
        "create_review_task",
        `请调用 create_review_task 工具创建外联动作人工审核任务，不要发送消息。参数：${JSON.stringify({
          candidateId: context.candidateId,
          proposedAction: "private_domain_invitation",
          rationale: "候选已通过当前资格决定版本的人工批准，下一步外联仍需单独审核。"
        })}`,
        "外联动作审核任务已创建"
      );
    }
  };

  return drawer;
}
