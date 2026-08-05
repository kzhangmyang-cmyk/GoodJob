import type {
  ProviderCatalogPageDto,
  ProviderConnectionDto
} from "../api.js";
import type { ProviderConnectionCenterState } from "../controller.js";
import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

export interface ProviderConnectionCenterCallbacks {
  onClose(): void;
  onSelectProvider(providerId: string): void;
  onSelectConnection(connectionId: string): void;
  onSave(apiKey: string): void | Promise<void>;
  onTest(): void | Promise<void>;
  onEnable(): void | Promise<void>;
  onDisable(): void | Promise<void>;
  onDelete(): void | Promise<void>;
  onContinue(): void | Promise<void>;
}

type Provider = ProviderCatalogPageDto["items"][number];

function safeOfficialDocsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function connectionStatus(
  connection: ProviderConnectionDto | undefined
): string {
  if (!connection) return "未配置";
  if (connection.status === "inactive") return "已禁用";
  if (
    connection.status === "error"
    || connection.lastHealthStatus === "failed"
  ) return "测试失败";
  if (
    connection.status === "active"
    && connection.lastHealthStatus === "passed"
  ) return "已启用·可用于获客";
  if (connection.lastHealthStatus === "passed") return "测试通过·待启用";
  return "已保存·待测试";
}

function providerMeta(provider: Provider): string {
  const capabilities = provider.capabilities
    .map((capability) => `<span>${escapeHtml(capability)}</span>`)
    .join("");
  const cost = provider.costNote
    ? `<p class="ai-growth-provider-card__cost">${escapeHtml(provider.costNote)}</p>`
    : "";
  return `${capabilities
    ? `<div class="ai-growth-provider-card__capabilities">${capabilities}</div>`
    : ""}${cost}`;
}

function providerCard(
  provider: Provider,
  connection: ProviderConnectionDto | undefined,
  selected: boolean
): string {
  const docsUrl = safeOfficialDocsUrl(provider.officialDocsUrl);
  const selectionAttributes = connection
    ? `data-action="select-provider-connection" data-connection-id="${escapeHtml(connection.id)}"`
    : `data-action="select-connection-provider"`;
  return `
    <article class="ai-growth-provider-card${selected ? " is-selected" : ""}" data-provider-id="${escapeHtml(provider.id)}">
      <button type="button" class="ai-growth-provider-card__select" ${selectionAttributes} data-provider-id="${escapeHtml(provider.id)}" aria-pressed="${selected}">
        <span class="ai-growth-provider-card__heading">
          <strong>${escapeHtml(provider.displayName)}</strong>
          <span class="ai-growth-provider-card__status">${connectionStatus(connection)}</span>
        </span>
        ${providerMeta(provider)}
      </button>
      ${docsUrl
        ? `<a class="ai-growth-provider-card__docs" href="${escapeHtml(docsUrl)}" target="_blank" rel="noreferrer noopener">官方文档</a>`
        : ""}
    </article>
  `;
}

function connectionForm(
  state: ProviderConnectionCenterState,
  provider: Provider
): string {
  const pending = state.mutationStatus !== "idle";
  return `
    <section class="ai-growth-connection-editor" aria-labelledby="providerConnectionEditorTitle">
      <p class="ai-growth-eyebrow">连接 ${escapeHtml(provider.displayName)}</p>
      <h3 id="providerConnectionEditorTitle">填写新的 API Key</h3>
      <p>密钥保存后不会再次显示，也无法从 GoodJob 中找回。</p>
      <div class="ai-growth-connection-secret">
        <label for="providerConnectionApiKey">官方 API Key</label>
        <span class="ai-growth-connection-secret__field">
          <input id="providerConnectionApiKey" type="password" data-field="provider-api-key" autocomplete="new-password" spellcheck="false" aria-describedby="providerConnectionSecretHelp"${disabledAttribute(pending)}>
          <button type="button" class="ai-growth-button ai-growth-button--quiet ai-growth-button--compact" data-action="toggle-provider-secret" aria-label="显示 API Key" aria-controls="providerConnectionApiKey" aria-pressed="false"${disabledAttribute(pending)}>显示</button>
        </span>
      </div>
      <p id="providerConnectionSecretHelp">仅在提交连接时读取；离开此表单会立即清除。</p>
      <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="save-provider-connection"${disabledAttribute(pending)}>${mutationLabel(state, "保存连接", "saving", "正在保存…")}</button>
    </section>
  `;
}

function disabledAttribute(disabled: boolean): string {
  return disabled ? " disabled" : "";
}

function mutationLabel(
  state: ProviderConnectionCenterState,
  idleLabel: string,
  status: ProviderConnectionCenterState["mutationStatus"],
  progressLabel: string
): string {
  return state.mutationStatus === status ? progressLabel : idleLabel;
}

function connectionDetails(
  state: ProviderConnectionCenterState,
  provider: Provider,
  connection: ProviderConnectionDto
): string {
  const pending = state.mutationStatus !== "idle";
  const readOnly = connection.ownerId === "system";
  const canEnable = connection.lastHealthStatus === "passed"
    && connection.status !== "active";
  const canDisable = connection.status === "active";
  const healthMessage = state.health?.message ?? connection.lastHealthMessage;
  const healthFailed = state.health?.ok === false
    || connection.lastHealthStatus === "failed";
  return `
    <section class="ai-growth-connection-editor" aria-labelledby="providerConnectionEditorTitle">
      <p class="ai-growth-eyebrow">${escapeHtml(provider.displayName)} · 安全连接详情</p>
      <h3 id="providerConnectionEditorTitle">${connectionStatus(connection)}</h3>
      <dl class="ai-growth-connection-facts">
        <div><dt>凭据版本</dt><dd>${escapeHtml(connection.credentialVersion)}</dd></div>
        <div><dt>最近测试</dt><dd>${escapeHtml(connection.lastHealthAt ?? "尚未测试")}</dd></div>
      </dl>
      ${healthMessage
        ? `<p class="ai-growth-provider-drawer__notice${healthFailed ? " is-error" : ""}" role="${healthFailed ? "alert" : "status"}">${escapeHtml(healthMessage)}</p>`
        : ""}
      ${readOnly
        ? `<p class="ai-growth-provider-drawer__notice">系统托管连接为只读，凭据不会显示。</p>`
        : `
          <div class="ai-growth-connection-actions">
            <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="test-provider-connection"${disabledAttribute(pending)}>${mutationLabel(state, "测试连接", "testing", "正在测试…")}</button>
            ${canEnable
              ? `<button type="button" class="ai-growth-button ai-growth-button--primary" data-action="enable-provider-connection"${disabledAttribute(pending)}>${mutationLabel(state, "启用连接", "updating", "正在启用…")}</button>`
              : ""}
            ${canDisable
              ? `<button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="disable-provider-connection"${disabledAttribute(pending)}>${mutationLabel(state, "禁用连接", "updating", "正在禁用…")}</button>`
              : ""}
            <button type="button" class="ai-growth-button ai-growth-button--quiet is-danger" data-action="delete-provider-connection"${disabledAttribute(pending)}>${mutationLabel(state, "删除连接", "deleting", "正在删除…")}</button>
          </div>
          <div class="ai-growth-connection-rotation">
            <h4>轮换凭据</h4>
            <p>GoodJob 无法显示旧密钥。填写新 API Key 会停用连接，需重新测试后启用。</p>
            <div class="ai-growth-connection-secret">
              <label for="providerConnectionRotationApiKey">新的官方 API Key</label>
              <span class="ai-growth-connection-secret__field">
                <input id="providerConnectionRotationApiKey" type="password" data-field="provider-api-key" autocomplete="new-password" spellcheck="false" aria-describedby="providerConnectionRotationHelp">
                <button type="button" class="ai-growth-button ai-growth-button--quiet ai-growth-button--compact" data-action="toggle-provider-secret" aria-label="显示 API Key" aria-controls="providerConnectionRotationApiKey" aria-pressed="false"${disabledAttribute(pending)}>显示</button>
              </span>
            </div>
            <p id="providerConnectionRotationHelp">提交前会再次确认；离开此表单会立即清除。</p>
            <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="rotate-provider-connection"${disabledAttribute(pending)}>${mutationLabel(state, "确认并轮换", "saving", "正在轮换…")}</button>
          </div>
        `}
    </section>
  `;
}

export function renderProviderConnectionCenter(
  state: ProviderConnectionCenterState,
  callbacks: ProviderConnectionCenterCallbacks
): ComponentRender<ProviderConnectionCenterCallbacks> {
  if (!state.open) return componentRender("", callbacks);
  const searchProviders = state.providers.filter((provider) =>
    provider.kind === "search");
  const connectionsByProvider = new Map(
    state.connections
      .filter((connection) => connection.kind === "search")
      .map((connection) => [connection.providerId, connection])
  );
  const selectedProvider = searchProviders.find((provider) =>
    provider.id === state.selectedProviderId);
  const selectedConnection = state.connections.find((connection) =>
    connection.id === state.selectedConnectionId
    && connection.kind === "search");
  const canContinue = state.connections.some((connection) =>
    connection.kind === "search"
    && connection.status === "active"
    && connection.lastHealthStatus === "passed");
  const pending = state.mutationStatus !== "idle";

  return componentRender(`
    <div class="ai-growth-provider-backdrop" aria-hidden="true"></div>
    <aside class="ai-growth-provider-drawer" role="dialog" aria-modal="true" aria-labelledby="providerConnectionCenterTitle">
      <header class="ai-growth-provider-drawer__header">
        <div>
          <p class="ai-growth-eyebrow">官方搜索 API</p>
          <h2 id="providerConnectionCenterTitle">搜索来源连接中心</h2>
          <p>使用你自己的官方 API Key。GoodJob 加密保存，且绝不会再次显示密钥。</p>
        </div>
        <button type="button" class="ai-growth-drawer-close" data-action="close-provider-connections" aria-label="关闭搜索来源连接中心">关闭</button>
      </header>
      <div class="ai-growth-provider-drawer__body">
        ${state.status === "loading"
          ? `<p class="ai-growth-provider-drawer__notice" role="status">正在加载搜索来源…</p>`
          : ""}
        ${state.error
          ? `<p class="ai-growth-provider-drawer__notice is-error" role="alert">${escapeHtml(state.error.message)}</p>`
          : ""}
        <section class="ai-growth-provider-catalog" aria-label="搜索来源">
          ${searchProviders.map((provider) => providerCard(
            provider,
            connectionsByProvider.get(provider.id),
            provider.id === state.selectedProviderId
          )).join("")}
        </section>
        ${selectedProvider
          ? selectedConnection
            ? connectionDetails(state, selectedProvider, selectedConnection)
            : connectionForm(state, selectedProvider)
          : ""}
        ${state.message
          ? `<p class="ai-growth-provider-drawer__notice" role="status" aria-live="polite">${escapeHtml(state.message)}</p>`
          : ""}
        <footer class="ai-growth-provider-drawer__footer">
          <p>至少启用一个测试通过的搜索连接后，即可继续当前获客任务。</p>
          <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="continue-after-connection"${disabledAttribute(!canContinue || pending)}>继续当前任务</button>
        </footer>
      </div>
    </aside>
  `, callbacks);
}
