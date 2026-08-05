import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

export type IdentityVerificationStatus =
  | "needs_profile"
  | "ready_to_fetch"
  | "fetching_profile"
  | "fetch_failed"
  | "fetched_no_eligible"
  | "ready_to_confirm"
  | "confirming"
  | "conflict"
  | "validation_error"
  | "confirmed"
  | "researching"
  | "qualifying"
  | "building_card"
  | "complete"
  | "continuation_partial";

export interface IdentityEvidenceVm {
  id: string;
  title: string;
  url: string | null;
  sourcePlatform: string;
  sourceType: string | null;
  excerpt: string;
  accessStatus: string;
  fetchedAt: string | null;
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface IdentityVerificationPanelVm {
  identityResolved: boolean;
  candidateVersion: number | null;
  sourcePlatform: string;
  originalSourceUrl: string | null;
  originalSourceType: string | null;
  originalProvider: string | null;
  originalExcerpt: string | null;
  profileUrl: string;
  rationale: string;
  selectedEvidenceIds: readonly string[];
  evidence: readonly IdentityEvidenceVm[];
  status: IdentityVerificationStatus;
  message: string | null;
  error: string | null;
}

export interface IdentityVerificationPanelCallbacks {
  onFetchProfile(profileUrl: string): void | Promise<void>;
  onToggleEvidence(evidenceId: string, selected: boolean): void;
  onConfirm(input: {
    profileUrl: string;
    rationale: string;
    evidenceIds: string[];
  }): void | Promise<void>;
  onRetryContinuation(): void | Promise<void>;
}

const SOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  profile: "抖音公开主页",
  video: "抖音视频页",
  comment_signal: "评论式需求信号",
  short_link: "抖音短链接",
  other: "公开页面"
};

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  baidu: "百度搜索",
  baidu_ai_search: "百度搜索",
  tencent: "腾讯联网搜索",
  tencent_web_search: "腾讯联网搜索",
  tavily: "Tavily",
  serper: "Serper",
  brave: "Brave Search",
  serpapi: "SerpApi"
};

const STATUS_LABELS: Readonly<Record<IdentityVerificationStatus, string>> = {
  needs_profile: "等待精确公开主页",
  ready_to_fetch: "可以抓取公开主页",
  fetching_profile: "正在抓取公开主页",
  fetch_failed: "公开主页抓取失败",
  fetched_no_eligible: "未获得可核验证据",
  ready_to_confirm: "等待人工确认",
  confirming: "正在保存主体确认",
  conflict: "候选版本已变化",
  validation_error: "核验信息需要修正",
  confirmed: "主体已确认",
  researching: "正在补充客户研究",
  qualifying: "正在重新计算意向与财务价值",
  building_card: "正在生成客户作战卡",
  complete: "作战资料已生成，等待人工审核",
  continuation_partial: "主体已确认，后续生成未全部完成"
};

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeExactDouyinProfileUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    const supportedHost = host === "douyin.com" || host === "www.douyin.com";
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (parsed.protocol !== "https:"
      || !supportedHost
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash
      || segments.length !== 2
      || segments[0] !== "user"
      || !segments[1]) {
      return null;
    }
    return `https://${host}/user/${segments[1]}`;
  } catch {
    return null;
  }
}

export function isExactDouyinProfileUrl(value: string): boolean {
  return normalizeExactDouyinProfileUrl(value) !== null;
}

function eligibleIdentityEvidence(
  item: IdentityEvidenceVm,
  declaredProfileUrl: string
): boolean {
  const declared = normalizeExactDouyinProfileUrl(declaredProfileUrl);
  const evidence = item.url
    ? normalizeExactDouyinProfileUrl(item.url)
    : null;
  return item.eligible
    && declared !== null
    && evidence === declared
    && item.sourcePlatform.toLowerCase() === "douyin"
    && item.sourceType === "profile"
    && item.accessStatus !== "access_restricted"
    && item.fetchedAt !== null;
}

function originalSignal(vm: IdentityVerificationPanelVm): string {
  const sourceUrl = safeHttpsUrl(vm.originalSourceUrl);
  const type = SOURCE_TYPE_LABELS[vm.originalSourceType ?? ""]
    ?? vm.originalSourceType
    ?? "公开来源";
  const provider = PROVIDER_LABELS[vm.originalProvider ?? ""]
    ?? vm.originalProvider
    ?? "来源待确认";
  return `
    <div class="ai-growth-identity-origin">
      <div>
        <span>原始需求信号</span>
        <strong>${escapeHtml(type)}</strong>
      </div>
      <div>
        <span>发现来源</span>
        <strong>${escapeHtml(provider)}</strong>
      </div>
      ${vm.originalExcerpt
        ? `<p>${escapeHtml(vm.originalExcerpt)}</p>`
        : ""}
      ${sourceUrl
        ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原始公开页面</a>`
        : ""}
    </div>
  `;
}

function evidenceItem(
  item: IdentityEvidenceVm,
  selected: boolean,
  eligible: boolean
): string {
  const url = safeHttpsUrl(item.url);
  const disabled = eligible ? "" : " disabled";
  const checked = eligible && selected ? " checked" : "";
  const ineligibleReason = item.ineligibleReason
    ?? (eligible
      ? null
      : "证据必须来自已抓取的精确抖音公开主页，并与声明主页一致");
  return `
    <div class="ai-growth-identity-evidence${eligible ? " is-eligible" : " is-ineligible"}">
      <label>
        <input type="checkbox" data-field="identity-evidence" data-evidence-id="${escapeHtml(item.id)}"${disabled}${checked}>
        <span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.sourcePlatform)} · ${escapeHtml(item.sourceType ?? "页面类型待确认")} · ${escapeHtml(item.accessStatus)}</small>
          ${item.excerpt ? `<p>${escapeHtml(item.excerpt)}</p>` : ""}
          ${ineligibleReason
            ? `<em>${escapeHtml(ineligibleReason)}</em>`
            : ""}
        </span>
      </label>
      ${url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开公开证据</a>`
        : ""}
    </div>
  `;
}

function continuationStatus(vm: IdentityVerificationPanelVm): string {
  const retry = vm.status === "continuation_partial"
    ? `<button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="retry-identity-continuation">继续生成判断</button>`
    : "";
  return `
    <section class="ai-growth-drawer-panel ai-growth-identity-panel is-resolved" aria-labelledby="identityVerificationTitle">
      <header>
        <h3 id="identityVerificationTitle">主体核验</h3>
        <span>主体已确认</span>
      </header>
      <div class="ai-growth-identity-progress" role="status" aria-live="polite">
        <strong>${escapeHtml(vm.message ?? STATUS_LABELS[vm.status])}</strong>
        <ol>
          <li data-state="complete">主体已确认</li>
          <li data-state="${["researching", "qualifying", "building_card", "complete"].includes(vm.status) ? "active" : "pending"}">补充客户研究</li>
          <li data-state="${["qualifying", "building_card", "complete"].includes(vm.status) ? "active" : "pending"}">意向与财务价值</li>
          <li data-state="${["building_card", "complete"].includes(vm.status) ? "active" : "pending"}">客户作战卡</li>
        </ol>
      </div>
      ${vm.error ? `<p class="ai-growth-resource-error" role="alert">${escapeHtml(vm.error)}</p>` : ""}
      ${retry}
    </section>
  `;
}

export function renderIdentityVerificationPanel(
  vm: IdentityVerificationPanelVm,
  callbacks: IdentityVerificationPanelCallbacks
): ComponentRender<IdentityVerificationPanelCallbacks> {
  if (vm.identityResolved) {
    return componentRender(continuationStatus(vm), callbacks);
  }

  const pending = ["fetching_profile", "confirming"].includes(vm.status);
  const profileReady = isExactDouyinProfileUrl(vm.profileUrl);
  const selectedEligible = vm.evidence.some((item) =>
    eligibleIdentityEvidence(item, vm.profileUrl)
    && vm.selectedEvidenceIds.includes(item.id)
  );
  const canConfirm = vm.status === "ready_to_confirm"
    && profileReady
    && selectedEligible
    && vm.rationale.trim().length > 0
    && Number.isInteger(vm.candidateVersion)
    && (vm.candidateVersion ?? 0) > 0;

  return componentRender(`
    <section class="ai-growth-drawer-panel ai-growth-identity-panel" aria-labelledby="identityVerificationTitle">
      <header>
        <h3 id="identityVerificationTitle">主体核验</h3>
        <span>${escapeHtml(STATUS_LABELS[vm.status])}</span>
      </header>
      <p class="ai-growth-identity-boundary">搜索结果不是已核验的客户身份。请先补充精确公开主页，再由人工选择证据并确认。</p>
      ${originalSignal(vm)}
      <div class="ai-growth-identity-form">
        <label for="candidateIdentityProfileUrl">
          <span>抖音公开主页 URL</span>
          <input id="candidateIdentityProfileUrl" type="url" inputmode="url" data-field="identity-profile-url" value="${escapeHtml(vm.profileUrl)}" placeholder="https://www.douyin.com/user/MS4wLjABAAAA" aria-describedby="candidateIdentityProfileHelp"${pending ? " disabled" : ""}>
        </label>
        <p id="candidateIdentityProfileHelp">仅接受 HTTPS 的 <code>/user/</code> 精确公开主页；视频页、分享短链和评论摘要不能直接核验主体。</p>
        <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="fetch-identity-profile"${pending || !profileReady ? " disabled" : ""}>${vm.status === "fetching_profile" ? "正在抓取…" : "抓取公开主页"}</button>
      </div>
      <fieldset class="ai-growth-identity-evidence-list">
        <legend>选择用于主体核验的公开证据</legend>
        ${vm.evidence.length === 0
          ? `<p class="ai-growth-empty-value">抓取精确公开主页后，可核验证据会显示在这里。</p>`
          : vm.evidence.map((item) => {
              const eligible = eligibleIdentityEvidence(item, vm.profileUrl);
              return evidenceItem(
                item,
                vm.selectedEvidenceIds.includes(item.id),
                eligible
              );
            }).join("")}
      </fieldset>
      <label class="ai-growth-identity-rationale" for="candidateIdentityRationale">
        <span>人工核验说明</span>
        <textarea id="candidateIdentityRationale" data-field="identity-rationale" rows="3" placeholder="说明公开主页与原始需求信号为何属于同一主体"${pending ? " disabled" : ""}>${escapeHtml(vm.rationale)}</textarea>
      </label>
      ${vm.error ? `<p class="ai-growth-resource-error" role="alert">${escapeHtml(vm.error)}</p>` : ""}
      ${vm.message ? `<p class="ai-growth-drawer-action-status" role="status" aria-live="polite">${escapeHtml(vm.message)}</p>` : ""}
      <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="confirm-candidate-identity"${canConfirm ? "" : " disabled"}>${vm.status === "confirming" ? "正在确认…" : "确认主体并继续"}</button>
    </section>
  `, callbacks);
}
