import {
  componentRender,
  escapeHtml,
  visibleList,
  type ComponentRender
} from "./rendering.js";

export interface ConnectionRequiredVm {
  missingKinds: readonly string[];
  message: string;
}

export interface ConnectionRequiredCallbacks {
  onConfigure(): void;
  onUseDemo(): void;
}

export function renderConnectionRequired(
  vm: ConnectionRequiredVm,
  callbacks: ConnectionRequiredCallbacks
): ComponentRender<ConnectionRequiredCallbacks> {
  return componentRender(`
    <section class="ai-growth-connection-required" aria-labelledby="aiGrowthConnectionTitle">
      <span class="ai-growth-character-icon ai-growth-character-icon--large" aria-hidden="true">连</span>
      <div>
        <p class="ai-growth-eyebrow">真实模式尚未准备好</p>
        <h2 id="aiGrowthConnectionTitle">需要配置搜索来源</h2>
        <p>${escapeHtml(vm.message)}</p>
        <div class="ai-growth-chip-list">${visibleList(vm.missingKinds)}</div>
      </div>
      <div class="ai-growth-connection-required__actions">
        <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="configure-connections">配置搜索来源</button>
        <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="use-demo">使用演示模式</button>
      </div>
    </section>
  `, callbacks);
}
