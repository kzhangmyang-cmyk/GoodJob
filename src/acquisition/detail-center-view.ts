import type { AcquisitionTaskDetail } from "./runtime-api";

export type AcquisitionDetailCenterMode = "plan" | "candidates";
export type AcquisitionDetailCenterStatus = "loading" | "ready" | "error";

export interface AcquisitionCandidateDetail {
  candidate: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>;
  qualification: Record<string, unknown> | null;
  financialValue: Record<string, unknown> | null;
  battleCard: Record<string, unknown> | null;
  reviews: Array<Record<string, unknown>>;
  intelligenceOperation: Record<string, unknown> | null;
}

export interface AcquisitionDetailCenterState {
  mode: AcquisitionDetailCenterMode;
  status: AcquisitionDetailCenterStatus;
  detail: AcquisitionTaskDetail | null;
  selectedCandidateId: string | null;
  candidateDetail: AcquisitionCandidateDetail | null;
  message: string | null;
  error: string | null;
  loadingMoreCandidates?: boolean;
}

type DataRecord = Record<string, unknown>;

const RUN_STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: "排队中",
  running: "运行中",
  pause_requested: "正在暂停",
  paused: "已暂停",
  cancel_requested: "正在取消",
  cancelled: "已取消",
  succeeded: "已完成",
  succeeded_empty: "已完成 · 无结果",
  partial_success: "部分完成",
  failed: "运行失败",
  budget_exhausted: "预算已用完"
};

const SHARD_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "等待执行",
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  partial_success: "部分完成",
  failed: "执行失败",
  cancelled: "已取消",
  budget_exhausted: "预算已用完"
};

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  baidu_ai_search: "百度 AI 搜索",
  tencent_web_search: "腾讯云联网搜索",
  tavily: "Tavily 搜索",
  serper: "Serper 搜索",
  brave: "Brave 搜索",
  serpapi: "SerpApi 搜索"
};

const MODEL_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  openai: "OpenAI",
  moonshot: "Kimi（月之暗面）",
  minimax: "MiniMax",
  zhipu: "智谱 AI",
  deepseek: "DeepSeek",
  qwen: "通义千问",
  doubao: "豆包",
  hunyuan: "腾讯混元",
  qianfan: "百度千帆"
};

const HARD_GATE_LABELS: Readonly<Record<string, string>> = {
  missing_original_source: "缺少原始公开来源",
  identity_unresolved: "主体身份尚未确认",
  do_not_contact: "已进入勿扰名单",
  explicit_rejection: "客户已明确拒绝",
  non_public_or_sensitive_data: "包含非公开或敏感数据",
  stale_evidence: "证据时效已过",
  schema_invalid: "研判结构无效"
};

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): DataRecord | null {
  return isRecord(value) ? value : null;
}

function records(value: unknown): DataRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function textValue(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character] ?? character);
}

function readableLabel(
  value: unknown,
  labels: Readonly<Record<string, string>>,
  fallback = "待确认"
): string {
  if (typeof value !== "string" || !value) return fallback;
  return labels[value] ?? value;
}

function renderTextList(values: string[], emptyText = "暂未配置"): string {
  if (values.length === 0) {
    return `<span class="replica-acquisition-detail-empty-value">${emptyText}</span>`;
  }
  return `<ul class="replica-acquisition-detail-tags">${values
    .map((value) => `<li>${escapeHtml(value)}</li>`)
    .join("")}</ul>`;
}

function formatMinorAmount(currency: unknown, amountMinor: unknown): string {
  const code = textValue(currency, "CNY").toUpperCase();
  const amount = finiteNumber(amountMinor) / 100;
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function tabButton(
  mode: AcquisitionDetailCenterMode,
  current: AcquisitionDetailCenterMode,
  label: string
): string {
  const selected = current === mode;
  const tabId = `acquisition-detail-tab-${mode}`;
  const panelId = `acquisition-detail-panel-${mode}`;
  return `
    <button
      type="button"
      id="${tabId}"
      role="tab"
      aria-selected="${selected}"
      aria-controls="${panelId}"
      tabindex="${selected ? 0 : -1}"
      data-acquisition-detail-action="switch-mode"
      data-mode="${mode}"
      class="${selected ? "is-active" : ""}"
    >${label}</button>
  `;
}

function renderTabs(mode: AcquisitionDetailCenterMode): string {
  return `
    <div class="replica-acquisition-detail-tabs" role="tablist" aria-label="任务详情视图">
      ${tabButton("plan", mode, "计划详情")}
      ${tabButton("candidates", mode, "候选研判")}
    </div>
  `;
}

function renderStateMessage(state: AcquisitionDetailCenterState): string | null {
  if (state.status === "loading") {
    return `
      <div class="replica-acquisition-detail-state" role="status" aria-live="polite">
        <strong>${escapeHtml(state.message ?? "正在加载真实任务详情…")}</strong>
        <span>正在读取计划、运行与候选数据。</span>
      </div>
    `;
  }
  if (state.status === "error") {
    return `
      <div class="replica-acquisition-detail-state is-error" role="alert">
        <strong>任务详情加载失败</strong>
        <span>${escapeHtml(state.error ?? "请稍后重试")}</span>
        <button type="button" data-acquisition-detail-action="retry">重新加载</button>
      </div>
    `;
  }
  if (state.detail === null) {
    return `
      <div class="replica-acquisition-detail-state" role="status">
        <strong>尚未选择真实任务</strong>
        <span>请先从任务列表选择一项。</span>
      </div>
    `;
  }
  return null;
}

function renderPlanOverview(detail: AcquisitionTaskDetail): string {
  const plan = record(detail.plan) ?? {};
  const payload = record(plan.payload) ?? plan;
  const icp = record(payload.icp) ?? {};
  const operations = records(payload.operations);
  const connections = records(payload.providerConnections);
  const budget = record(payload.budgetSnapshot)
    ?? record(plan.budgetSnapshot)
    ?? {};
  const latestRun = record(detail.latestRun);
  const runModel = record(latestRun?.modelSnapshotRef);
  const planModel = record(payload.modelSnapshotRef);
  const model = runModel ?? planModel ?? {};
  const runBudget = record(latestRun?.consumedBudget) ?? {};
  const objective = textValue(payload.objective, detail.task.objective);
  const planStatus = plan.status === "approved"
    ? "已批准"
    : plan.status === "archived" ? "已归档" : "草稿";

  const operationHtml = operations.length === 0
    ? `<div class="replica-acquisition-detail-empty-value">暂未配置搜索操作</div>`
    : operations.map((operation) => {
      const operationId = textValue(operation.operationId);
      const subject = operation.subjectChannel === "individual"
        ? "个人主体" : "企业主体";
      const allocated = record(operation.allocatedBudget) ?? {};
      return `
        <article class="replica-acquisition-operation">
          <div><strong>${escapeHtml(operationId)}</strong><span>${subject}</span></div>
          <p>${escapeHtml(textValue(operation.query, textValue(operation.sourceRef, "未配置查询")))}</p>
          <small>${finiteNumber(allocated.requests)} 次请求 · ${finiteNumber(allocated.results)} 条结果 · ${finiteNumber(allocated.durationSeconds)} 秒</small>
        </article>
      `;
    }).join("");

  const connectionHtml = connections.length === 0
    ? `<span class="replica-acquisition-detail-empty-value">暂未配置搜索连接</span>`
    : connections.map((connection) => {
      const provider = readableLabel(connection.providerId, PROVIDER_LABELS);
      const connectionStatus = connection.status === "active" ? "已启用" : textValue(connection.status);
      return `<li><strong>${escapeHtml(provider)}</strong><span>${escapeHtml(connectionStatus)} · ${escapeHtml(textValue(connection.connectionId))}</span></li>`;
    }).join("");

  const shardHtml = detail.shards.length === 0
    ? `<span class="replica-acquisition-detail-empty-value">当前运行尚未生成分片</span>`
    : detail.shards.map((rawShard) => {
      const shard = record(rawShard) ?? {};
      return `
        <li>
          <div><strong>${escapeHtml(textValue(shard.operationId, textValue(shard.id)))}</strong><span>${escapeHtml(readableLabel(shard.status, SHARD_STATUS_LABELS))}</span></div>
          <small>${finiteNumber(shard.evidenceCount)} 条证据</small>
        </li>
      `;
    }).join("");

  const runHtml = latestRun === null
    ? `<div class="replica-acquisition-run-empty"><strong>尚未运行</strong><span>计划已保存，但还没有真实运行记录。</span></div>`
    : `
      <div class="replica-acquisition-run-summary">
        <strong>${escapeHtml(readableLabel(latestRun.status, RUN_STATUS_LABELS))}</strong>
        <span>${finiteNumber(latestRun.evidenceCount)} 条证据</span>
        <span>${finiteNumber(runBudget.requests)} 次请求</span>
        <span>${finiteNumber(runBudget.results)} 条结果</span>
        <span>${finiteNumber(runBudget.durationSeconds)} 秒</span>
      </div>
    `;

  return `
    <section class="replica-acquisition-detail-panel" id="acquisition-detail-panel-plan" role="tabpanel" aria-labelledby="acquisition-detail-tab-plan" data-acquisition-detail-panel="plan">
      <header class="replica-acquisition-detail-heading">
        <div><span>当前计划 · v${finiteNumber(plan.version, 1)}</span><h3>${escapeHtml(textValue(payload.name, detail.task.name))}</h3></div>
        <strong>${planStatus}</strong>
      </header>

      <article class="replica-acquisition-detail-section">
        <h4>获客目标</h4>
        <p>${escapeHtml(objective)}</p>
      </article>

      <div class="replica-acquisition-detail-grid">
        <article class="replica-acquisition-detail-section"><h4>目标行业</h4>${renderTextList(strings(icp.industries))}</article>
        <article class="replica-acquisition-detail-section"><h4>目标地区</h4>${renderTextList(strings(icp.regions))}</article>
        <article class="replica-acquisition-detail-section"><h4>企业 ICP</h4>${renderTextList(strings(icp.organizationCriteria))}</article>
        <article class="replica-acquisition-detail-section"><h4>个人 ICP</h4>${renderTextList(strings(icp.individualCriteria))}</article>
      </div>

      <article class="replica-acquisition-detail-section">
        <h4>排除项</h4>
        ${renderTextList(strings(icp.exclusionRules), "暂无排除规则")}
      </article>

      <article class="replica-acquisition-detail-section">
        <h4>搜索操作</h4>
        <div class="replica-acquisition-operation-list">${operationHtml}</div>
      </article>

      <div class="replica-acquisition-detail-grid">
        <article class="replica-acquisition-detail-section">
          <h4>预算上限</h4>
          <p>${finiteNumber(budget.maxRequests)} 次请求 · ${finiteNumber(budget.maxResults)} 条结果</p>
          <small>${escapeHtml(formatMinorAmount(budget.billingCurrency, budget.maxAmountMinor))} · ${finiteNumber(budget.maxDurationSeconds)} 秒</small>
        </article>
        <article class="replica-acquisition-detail-section">
          <h4>AI 模型</h4>
          <p>${escapeHtml(readableLabel(model.provider, MODEL_PROVIDER_LABELS))}</p>
          <small>${escapeHtml(textValue(model.model))}</small>
        </article>
        <article class="replica-acquisition-detail-section">
          <h4>搜索连接</h4>
          <ul class="replica-acquisition-connection-list">${connectionHtml}</ul>
        </article>
      </div>

      <article class="replica-acquisition-detail-section">
        <h4>最新运行</h4>
        ${runHtml}
      </article>

      <article class="replica-acquisition-detail-section">
        <h4>运行分片</h4>
        <ul class="replica-acquisition-shard-list">${shardHtml}</ul>
      </article>
    </section>
  `;
}

function decisionEngineLabel(value: unknown): string {
  if (value === "model") return "AI 模型研判";
  if (value === "rules") return "规则引擎研判";
  return "尚未研判";
}

function candidateSubjectLabel(value: unknown): string {
  return value === "individual" ? "个人主体" : "企业主体";
}

function candidateEventId(event: DataRecord): string {
  return textValue(event.candidateId, textValue(record(event.candidate)?.id, ""));
}

function renderCandidateList(
  events: DataRecord[],
  selectedCandidateId: string | null
): string {
  return events.map((event) => {
    const candidate = record(event.candidate) ?? {};
    const qualification = record(event.qualification);
    const financial = record(event.financialValue);
    const candidateId = candidateEventId(event);
    const grade = textValue(qualification?.grade, "待评估");
    const score = qualification === null ? "待评分" : `${finiteNumber(qualification.score)} 分`;
    const financialLabel = financial === null
      ? "财务价值待评估"
      : `财务等级 ${textValue(financial.grade)} · ${formatMinorAmount(financial.currency, financial.expectedRevenueMinor)}`;
    const selected = candidateId === selectedCandidateId;
    return `
      <button
        type="button"
        class="replica-acquisition-candidate${selected ? " is-selected" : ""}"
        data-acquisition-detail-action="select-candidate"
        data-candidate-id="${escapeHtml(candidateId)}"
        aria-pressed="${selected}"
      >
        <span class="replica-acquisition-candidate-name">${escapeHtml(textValue(candidate.displayName, "未命名候选"))}</span>
        <span>${candidateSubjectLabel(candidate.subjectKind)}</span>
        <strong>意向等级 ${escapeHtml(grade)}</strong>
        <span>${escapeHtml(score)} · ${decisionEngineLabel(qualification?.decisionEngine)}</span>
        <span>${finiteNumber(event.evidenceCount)} 条证据</span>
        <span>${escapeHtml(financialLabel)}</span>
      </button>
    `;
  }).join("");
}

function renderSignals(value: unknown, emptyText: string): string {
  const signals = records(value);
  if (signals.length === 0) return `<li>${emptyText}</li>`;
  return signals.map((signal) => `
    <li><strong>${escapeHtml(textValue(signal.name))}</strong><span>${finiteNumber(signal.score)} 分</span></li>
  `).join("");
}

function renderReasons(value: unknown): string {
  const reasons = strings(value);
  if (reasons.length === 0) return `<li>暂无资格理由</li>`;
  return reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
}

function renderHardGates(value: unknown): string {
  const failures = strings(value);
  if (failures.length === 0) return `<li>未命中硬门禁</li>`;
  return failures.map((failure) => `<li>${escapeHtml(readableLabel(failure, HARD_GATE_LABELS))}</li>`).join("");
}

function renderFinancialDetail(value: DataRecord | null): string {
  if (value === null) {
    return `<div class="replica-acquisition-detail-empty-value">财务价值待评估</div>`;
  }
  const factors = record(value.factors) ?? {};
  return `
    <div class="replica-acquisition-financial-summary">
      <strong>财务等级 ${escapeHtml(textValue(value.grade))} · ${finiteNumber(value.score)} 分</strong>
      <span>预计收入 ${escapeHtml(formatMinorAmount(value.currency, value.expectedRevenueMinor))}</span>
      <span>预计毛利 ${escapeHtml(formatMinorAmount(value.currency, value.expectedGrossProfitMinor))}</span>
      <span>预计贡献 ${escapeHtml(formatMinorAmount(value.currency, value.expectedContributionMinor))}</span>
    </div>
    <dl class="replica-acquisition-factor-list">
      <div><dt>盈利能力</dt><dd>${Math.round(finiteNumber(factors.profitability))}%</dd></div>
      <div><dt>现金流</dt><dd>${Math.round(finiteNumber(factors.cashFlow))}%</dd></div>
      <div><dt>信用质量</dt><dd>${Math.round(finiteNumber(factors.creditQuality))}%</dd></div>
      <div><dt>成交概率</dt><dd>${Math.round(finiteNumber(factors.closeProbability))}%</dd></div>
    </dl>
  `;
}

function renderEvidenceDetail(items: DataRecord[]): string {
  if (items.length === 0) {
    return `<div class="replica-acquisition-detail-empty-value">尚未读取到公开证据详情</div>`;
  }
  return `<ol class="replica-acquisition-evidence-list">${items.map((item) => `
    <li>
      <div><strong>${escapeHtml(textValue(item.sourceTitle, "公开来源"))}</strong><span>${escapeHtml(textValue(item.sourcePlatform, "公开网页"))}</span></div>
      <p>${escapeHtml(textValue(item.sourceSnippet, "来源未提供摘要"))}</p>
      <small>${escapeHtml(textValue(item.publishedAt, textValue(item.fetchedAt, "时间未知")))}</small>
    </li>
  `).join("")}</ol>`;
}

function renderBattleCard(value: DataRecord | null): string {
  if (value === null) {
    return `<div class="replica-acquisition-detail-empty-value">客户作战建议尚未生成</div>`;
  }
  const sections = records(value.sections);
  const intelligence = record(value.intelligence);
  const strategies = records(intelligence?.connectionStrategies);
  const openers = records(intelligence?.roleSpecificOpeners);
  const doNotActions = strings(intelligence?.doNotActions);
  const sectionHtml = sections.map((section) => `
    <li><strong>${escapeHtml(textValue(section.label, "作战建议"))}</strong><p>${escapeHtml(textValue(section.content))}</p></li>
  `);
  const strategyHtml = strategies.map((strategy) => `
    <li><strong>${escapeHtml(textValue(strategy.targetRole, "目标角色"))}</strong><p>${escapeHtml(textValue(strategy.openingDraft))}</p></li>
  `);
  const openerHtml = openers.map((opener) => `
    <li><strong>${escapeHtml(textValue(opener.role, "目标角色"))}</strong><p>${escapeHtml(textValue(opener.text))}</p></li>
  `);
  const avoidHtml = doNotActions.map((item) => `
    <li><strong>不建议动作</strong><p>${escapeHtml(item)}</p></li>
  `);
  const content = [...sectionHtml, ...strategyHtml, ...openerHtml, ...avoidHtml];
  return content.length > 0
    ? `<ul class="replica-acquisition-battle-card-list">${content.join("")}</ul>`
    : `<div class="replica-acquisition-detail-empty-value">客户作战卡已生成，但暂无可展示建议</div>`;
}

const REVIEW_ACTION_LABELS: Readonly<Record<string, string>> = {
  approved: "批准跟进",
  rejected: "驳回候选",
  do_not_contact: "禁止联系",
  needs_research: "补充研究",
  reopen: "重新进入研判"
};

function renderReviewHistory(items: DataRecord[]): string {
  if (items.length === 0) {
    return `<div class="replica-acquisition-detail-empty-value">暂无人工审核记录</div>`;
  }
  return `<ol class="replica-acquisition-review-history">${items.map((item) => `
    <li>
      <div><strong>${escapeHtml(readableLabel(item.action, REVIEW_ACTION_LABELS, "人工审核"))}</strong><span>${escapeHtml(textValue(item.createdAt, "时间未知"))}</span></div>
      <p>${escapeHtml(textValue(item.reason, "未填写补充说明"))}</p>
    </li>
  `).join("")}</ol>`;
}

function renderIntelligenceAction(
  candidate: DataRecord,
  operation: DataRecord | null
): string {
  if (candidate.identityResolved !== true) {
    return `<div class="replica-acquisition-review-note is-warning">主体身份尚未确认，暂不能启动 AI 资格研判。</div>`;
  }
  if (operation?.status === "queued" || operation?.status === "running") {
    return `<div class="replica-acquisition-review-note">AI 客户情报任务正在${operation.status === "queued" ? "排队" : "运行"}，完成后刷新资格与作战卡。</div>`;
  }
  if (operation?.status === "failed") {
    return `<div class="replica-acquisition-review-note is-warning">最近一次 AI 研判失败，请在任务刷新后重试。</div>`;
  }
  return `
    <div class="replica-acquisition-intelligence-start">
      <div><strong>尚未完成 AI 资格研判</strong><span>系统将研究公开证据、计算意向等级与财务价值，并生成客户作战卡。</span></div>
      <button type="button" data-acquisition-detail-action="start-intelligence">启动 AI 研判</button>
    </div>
  `;
}

function reviewButton(
  action: string,
  className = "",
  disabled = false
): string {
  return `<button type="button" class="${className}" data-acquisition-detail-action="review" data-review-action="${action}"${disabled ? " disabled" : ""}>${escapeHtml(readableLabel(action, REVIEW_ACTION_LABELS))}</button>`;
}

function renderReviewActions(
  candidate: DataRecord,
  qualification: DataRecord | null,
  operation: DataRecord | null
): string {
  if (qualification === null) {
    return renderIntelligenceAction(candidate, operation);
  }
  const status = textValue(candidate.status, "normalized");
  const hardGateFailures = strings(qualification.hardGateFailures);
  if (status === "pending_review") {
    return `
      <form class="replica-acquisition-review-form" data-acquisition-detail-form="review">
        ${hardGateFailures.length > 0
          ? `<div class="replica-acquisition-review-note is-warning">当前命中 ${hardGateFailures.length} 项硬门禁，不能批准跟进；可驳回或补充研究。</div>`
          : `<div class="replica-acquisition-review-note">AI 只提供建议。请人工核对证据后作出最终决定。</div>`}
        <label><span>审核原因或补充说明</span><textarea name="reviewReason" maxlength="2000" placeholder="驳回、补充研究时必须填写原因"></textarea></label>
        <div class="replica-acquisition-review-actions">
          ${reviewButton("approved", "is-primary", hardGateFailures.length > 0)}
          ${reviewButton("needs_research")}
          ${reviewButton("rejected")}
          ${reviewButton("do_not_contact", "is-danger")}
        </div>
      </form>
    `;
  }
  if (status === "rejected") {
    return `
      <form class="replica-acquisition-review-form" data-acquisition-detail-form="review">
        <div class="replica-acquisition-review-note">候选已被驳回。只有出现新的公开证据后，服务端才会允许重新研判。</div>
        <label><span>重开原因</span><textarea name="reviewReason" maxlength="2000" required placeholder="说明新增证据或重开理由"></textarea></label>
        <div class="replica-acquisition-review-actions">${reviewButton("reopen", "is-primary")}</div>
      </form>
    `;
  }
  return `<div class="replica-acquisition-review-note">当前候选状态：${escapeHtml(status)}。此状态没有可提交的人工审核动作。</div>`;
}

function renderCandidateDetail(
  event: DataRecord | undefined,
  detail: AcquisitionCandidateDetail | null
): string {
  if (!event) {
    return `
      <div class="replica-acquisition-detail-state">
        <strong>请选择一个候选</strong>
        <span>选择后可查看资格理由、信号、硬门禁与财务价值。</span>
      </div>
    `;
  }
  const candidate = record(event.candidate) ?? {};
  const candidateSnapshot = detail?.candidate ?? candidate;
  const qualification = detail
    ? detail.qualification
    : record(event.qualification);
  const financial = detail
    ? detail.financialValue
    : record(event.financialValue);
  return `
    <article class="replica-acquisition-selected-candidate" data-selected-candidate-id="${escapeHtml(candidateEventId(event))}">
      <header>
        <div><span>${candidateSubjectLabel(candidate.subjectKind)}</span><h4>${escapeHtml(textValue(candidate.displayName, "未命名候选"))}</h4></div>
        <strong>${qualification ? `意向等级 ${escapeHtml(textValue(qualification.grade))}` : "意向待评估"}</strong>
      </header>
      ${qualification === null ? `
        <div class="replica-acquisition-detail-empty-value">该候选尚未完成资格研判。</div>
      ` : `
        <div class="replica-acquisition-detail-grid">
          <section><h5>资格理由</h5><ul>${renderReasons(qualification.reasons)}</ul></section>
          <section><h5>正向信号</h5><ul>${renderSignals(qualification.positiveSignals, "暂无正向信号")}</ul></section>
          <section><h5>负向信号</h5><ul>${renderSignals(qualification.negativeSignals, "暂无负向信号")}</ul></section>
          <section><h5>硬门禁</h5><ul>${renderHardGates(qualification.hardGateFailures)}</ul></section>
        </div>
        <p class="replica-acquisition-qualification-meta">${decisionEngineLabel(qualification.decisionEngine)} · ${finiteNumber(qualification.score)} 分 · 置信度 ${Math.round(finiteNumber(qualification.confidence) * 100)}%</p>
      `}
      <section class="replica-acquisition-detail-section">
        <h5>财务价值</h5>
        ${renderFinancialDetail(financial)}
      </section>
      <section class="replica-acquisition-detail-section">
        <h5>公开证据链</h5>
        ${renderEvidenceDetail(detail?.evidence ?? [])}
      </section>
      <section class="replica-acquisition-detail-section">
        <h5>客户作战建议</h5>
        ${renderBattleCard(detail?.battleCard ?? null)}
      </section>
      <section class="replica-acquisition-detail-section replica-acquisition-review-section">
        <h5>人工审核</h5>
        ${renderReviewActions(candidateSnapshot, qualification, detail?.intelligenceOperation ?? null)}
      </section>
      <section class="replica-acquisition-detail-section">
        <h5>审核历史</h5>
        ${renderReviewHistory(detail?.reviews ?? [])}
      </section>
    </article>
  `;
}

function renderCandidateSummary(summary: DataRecord | null): string {
  if (summary === null) return "";
  const revenues = records(summary.expectedRevenueByCurrency);
  const revenueText = revenues.length === 0
    ? "预计收入待评估"
    : revenues.map((item) => formatMinorAmount(item.currency, item.amountMinor)).join(" · ");
  return `
    <div class="replica-acquisition-candidate-summary" aria-label="候选统计">
      <span>已搜索来源 ${finiteNumber(summary.sourcesSearched)}</span>
      <span>已分析页面 ${finiteNumber(summary.pagesAnalyzed)}</span>
      <span>发现主体 ${finiteNumber(summary.organizationsFound)}</span>
      <span>去重候选 ${finiteNumber(summary.dedupedCandidates)}</span>
      <span>有效商机 ${finiteNumber(summary.validOpportunities)}</span>
      <span>高意向 ${finiteNumber(summary.highIntent)}</span>
      <span>${escapeHtml(revenueText)}</span>
    </div>
  `;
}

function renderCandidatePanel(state: AcquisitionDetailCenterState): string {
  const detail = state.detail;
  if (detail === null) return "";
  const latestRun = record(detail.latestRun);
  if (latestRun === null) {
    return `
      <section class="replica-acquisition-detail-panel" id="acquisition-detail-panel-candidates" role="tabpanel" aria-labelledby="acquisition-detail-tab-candidates" data-acquisition-detail-panel="candidates">
        <div class="replica-acquisition-detail-state" role="status">
          <strong>任务尚未运行</strong>
          <span>启动真实运行后，候选与研判结果会显示在这里。</span>
        </div>
      </section>
    `;
  }
  const presentation = record(detail.presentation);
  const events = records(presentation?.candidateEvents);
  const runStatus = textValue(latestRun.status, "queued");
  const active = ["queued", "running", "pause_requested", "paused", "cancel_requested"]
    .includes(runStatus);
  if (events.length === 0) {
    const evidenceCount = finiteNumber(latestRun.evidenceCount);
    return `
      <section class="replica-acquisition-detail-panel" id="acquisition-detail-panel-candidates" role="tabpanel" aria-labelledby="acquisition-detail-tab-candidates" data-acquisition-detail-panel="candidates">
        ${renderCandidateSummary(record(presentation?.summary))}
        <div class="replica-acquisition-detail-state" role="status">
          <strong>${active ? "运行中，尚未形成候选" : "运行已结束，未发现符合条件的候选"}</strong>
          <span>已发现 ${evidenceCount} 条公开证据${active ? "，系统仍在去重和研判。" : "，但没有候选通过当前筛选条件。"}</span>
        </div>
      </section>
    `;
  }
  const selectedEvent = events.find((event) =>
    candidateEventId(event) === state.selectedCandidateId
  );
  return `
    <section class="replica-acquisition-detail-panel" id="acquisition-detail-panel-candidates" role="tabpanel" aria-labelledby="acquisition-detail-tab-candidates" data-acquisition-detail-panel="candidates">
      ${renderCandidateSummary(record(presentation?.summary))}
      <div class="replica-acquisition-candidate-layout">
        <div class="replica-acquisition-candidate-list" aria-label="候选列表">
          ${renderCandidateList(events, state.selectedCandidateId)}
        </div>
        <div class="replica-acquisition-candidate-inspector">
          ${renderCandidateDetail(selectedEvent, state.candidateDetail)}
        </div>
      </div>
      ${presentation?.hasMore === true ? `
        <div class="replica-acquisition-candidate-pagination">
          <span>已加载 ${events.length} 条候选</span>
          <button type="button" data-acquisition-detail-action="load-more-candidates"${state.loadingMoreCandidates ? " disabled" : ""}>
            ${state.loadingMoreCandidates ? "正在加载…" : "加载更多候选"}
          </button>
        </div>
      ` : ""}
    </section>
  `;
}

export function renderAcquisitionDetailCenter(
  state: AcquisitionDetailCenterState
): string {
  const statusMessage = renderStateMessage(state);
  const content = statusMessage ?? (state.mode === "plan"
    ? renderPlanOverview(state.detail as AcquisitionTaskDetail)
    : renderCandidatePanel(state));
  return `
    <section
      class="replica-acquisition-detail-view"
      data-acquisition-detail-mode="${state.mode}"
      data-acquisition-detail-status="${state.status}"
      aria-busy="${state.status === "loading"}"
    >
      ${renderTabs(state.mode)}
      ${state.message && state.status === "ready"
        ? `<div class="replica-acquisition-detail-message" role="status">${escapeHtml(state.message)}</div>`
        : ""}
      ${state.error && state.status === "ready"
        ? `<div class="replica-acquisition-detail-message is-error" role="alert">${escapeHtml(state.error)}</div>`
        : ""}
      ${content}
    </section>
  `;
}
