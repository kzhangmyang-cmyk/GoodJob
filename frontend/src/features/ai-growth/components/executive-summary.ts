import type {
  AdvisorMode,
  CandidateCardVm,
  ExecutiveSummaryVm
} from "../types.js";
import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

export interface ExecutiveSummaryComponentVm {
  mode: AdvisorMode;
  summary: ExecutiveSummaryVm;
  topCandidate: CandidateCardVm | null;
}

export interface ExecutiveSummaryCallbacks {
  onViewPriority(): void;
  onBuildBattleCard(candidateId: string): void;
  onPreviewConversion(candidateId: string): void;
  onConvert(candidateId: string): void;
}

function conversionAction(vm: ExecutiveSummaryComponentVm): string {
  if (vm.topCandidate === null) {
    return `<span class="ai-growth-action-blocked">没有可转换客户</span>`;
  }
  const id = escapeHtml(vm.topCandidate.id);
  if (vm.mode === "demo") {
    return `<button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="preview-conversion" data-candidate-id="${id}">预览转为线索并创建跟进任务</button>`;
  }
  if (vm.topCandidate.status !== "approved") {
    return `<span class="ai-growth-action-blocked">先完成人工审核</span>`;
  }
  return `<button type="button" class="ai-growth-button ai-growth-button--primary" data-action="convert" data-candidate-id="${id}">转为线索并创建跟进任务</button>`;
}

export function renderExecutiveSummary(
  vm: ExecutiveSummaryComponentVm,
  callbacks: ExecutiveSummaryCallbacks
): ComponentRender<ExecutiveSummaryCallbacks> {
  const { summary } = vm;
  const revenue = summary.expectedRevenueByCurrency.length === 0
    ? `<span class="ai-growth-empty-value">待评估</span>`
    : summary.expectedRevenueByCurrency.map((amount) => `
      <span><b>${escapeHtml(amount.currency)}</b><strong>${escapeHtml(amount.formatted)}</strong></span>
    `).join("");
  const topId = vm.topCandidate === null ? "" : escapeHtml(vm.topCandidate.id);

  return componentRender(`
    <section class="ai-growth-executive-summary" aria-labelledby="aiGrowthSummaryTitle">
      <div class="ai-growth-section-heading">
        <div>
          <p class="ai-growth-eyebrow">04 · 今天的增长结论</p>
          <h2 id="aiGrowthSummaryTitle">老板摘要与下一步动作</h2>
          <p>把公开商机结果转成可审核、可分配、可复盘的销售行动。</p>
        </div>
        <span class="ai-growth-mode">${vm.mode === "demo" ? "演示模式 · 演示数据" : "真实模式"}</span>
      </div>
      <div class="ai-growth-summary-metrics">
        <article><span>搜索来源</span><strong>${summary.sourcesSearched}</strong><small>本次运行实际返回结果的公开来源</small></article>
        <article><span>去重候选</span><strong>${summary.dedupedCandidates}</strong><small>按主体标识合并后的客户数量</small></article>
        <article><span>有效商机</span><strong>${summary.validOpportunities}</strong><small>S、A、B 级且通过硬门槛</small></article>
        <article><span>高意向</span><strong>${summary.highIntent}</strong><small>S、A 级候选，不等于已批准触达</small></article>
      </div>
      <div class="ai-growth-summary-bottom">
        <article class="ai-growth-revenue-card">
          <div>
            <span>高意向客户预计收入</span>
            <small>${summary.financialEvaluatedHighIntentCount} 个已评估 · ${summary.financialPendingHighIntentCount} 个待评估</small>
          </div>
          <div class="ai-growth-revenue-values">${revenue}</div>
          <p>金额按币种分别展示，不做汇率换算。仅统计已完成财务评估的高意向客户。</p>
        </article>
        <article class="ai-growth-next-actions">
          <h3>建议现在做三件事</h3>
          <ol>
            <li><span>01</span><button type="button" data-action="view-priority">查看优先客户</button></li>
            <li><span>02</span><button type="button" data-action="build-battle-card" data-candidate-id="${topId}"${vm.topCandidate === null ? " disabled" : ""}>为首位客户生成作战卡</button></li>
            <li><span>03</span>${conversionAction(vm)}</li>
          </ol>
        </article>
      </div>
    </section>
  `, callbacks);
}
