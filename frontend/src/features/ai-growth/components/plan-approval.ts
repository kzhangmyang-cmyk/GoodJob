import type {
  AcquisitionPlanCreateDto,
  AdvisorMode
} from "../types.js";
import {
  componentRender,
  escapeHtml,
  visibleList,
  type ComponentRender
} from "./rendering.js";

export interface PlanApprovalVm {
  mode: AdvisorMode;
  approvalStatus: "awaiting_approval" | "approved";
  plan: AcquisitionPlanCreateDto;
  targetProfile: string;
  companySize: string;
  demandSignals: readonly string[];
  searchTopics: readonly string[];
}

export interface PlanApprovalCallbacks {
  onApprove(): void;
  onEdit(): void;
  onCancel(): void;
}

function money(currency: string, amountMinor: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol"
  }).format(amountMinor / 100);
}

export function renderPlanApproval(
  vm: PlanApprovalVm,
  callbacks: PlanApprovalCallbacks
): ComponentRender<PlanApprovalCallbacks> {
  const { plan } = vm;
  const providerNames = plan.providerConnections.map((provider) => provider.providerId);
  const operationQueries = plan.operations
    .map((operation) => operation.query ?? operation.sourceRef)
    .filter((value): value is string => Boolean(value));

  return componentRender(`
    <section class="ai-growth-plan" aria-labelledby="aiGrowthPlanTitle">
      <div class="ai-growth-section-heading">
        <div>
          <p class="ai-growth-eyebrow">02 · 检查方案边界</p>
          <h2 id="aiGrowthPlanTitle">${escapeHtml(plan.name)}</h2>
          <p>${escapeHtml(plan.objective)}</p>
        </div>
        <div class="ai-growth-plan__state">
          <span class="ai-growth-mode">${vm.mode === "demo" ? "演示模式 · 演示数据" : "真实模式"}</span>
          <strong>${vm.approvalStatus === "approved" ? "方案已批准" : "等待人工批准"}</strong>
        </div>
      </div>
      <div class="ai-growth-plan-grid">
        <article class="ai-growth-plan-card ai-growth-plan-card--priority">
          <span class="ai-growth-plan-card__number">01</span>
          <h3>目标客户</h3>
          <dl>
            <div><dt>目标画像</dt><dd>${escapeHtml(vm.targetProfile)}</dd></div>
            <div><dt>行业</dt><dd class="ai-growth-chip-list">${visibleList(plan.icp.industries)}</dd></div>
            <div><dt>地区</dt><dd class="ai-growth-chip-list">${visibleList(plan.icp.regions)}</dd></div>
            <div><dt>企业规模</dt><dd>${escapeHtml(vm.companySize || "未设置")}</dd></div>
          </dl>
        </article>
        <article class="ai-growth-plan-card">
          <span class="ai-growth-plan-card__number">02</span>
          <h3>判断信号与排除</h3>
          <dl>
            <div><dt>需求信号</dt><dd class="ai-growth-chip-list">${visibleList(vm.demandSignals)}</dd></div>
            <div><dt>企业条件</dt><dd class="ai-growth-chip-list">${visibleList(plan.icp.organizationCriteria)}</dd></div>
            <div><dt>排除条件</dt><dd class="ai-growth-chip-list">${visibleList(plan.icp.exclusionRules)}</dd></div>
          </dl>
        </article>
        <article class="ai-growth-plan-card">
          <span class="ai-growth-plan-card__number">03</span>
          <h3>搜索主题与来源</h3>
          <dl>
            <div><dt>搜索主题</dt><dd class="ai-growth-chip-list">${visibleList(vm.searchTopics)}</dd></div>
            <div><dt>数据来源</dt><dd class="ai-growth-chip-list">${visibleList(providerNames)}</dd></div>
            <div><dt>查询任务</dt><dd class="ai-growth-query-list">${visibleList(operationQueries, "将在批准后生成")}</dd></div>
          </dl>
        </article>
        <article class="ai-growth-plan-card ai-growth-plan-card--budget">
          <span class="ai-growth-plan-card__number">04</span>
          <h3>预算上限</h3>
          <ul class="ai-growth-budget-list">
            <li><strong>${plan.budgetSnapshot.maxRequests} 次请求</strong><span>请求上限</span></li>
            <li><strong>${plan.budgetSnapshot.maxResults} 条结果</strong><span>结果上限</span></li>
            <li><strong>${money(plan.budgetSnapshot.billingCurrency, plan.budgetSnapshot.maxAmountMinor)}</strong><span>费用上限</span></li>
            <li><strong>${plan.budgetSnapshot.maxDurationSeconds} 秒</strong><span>时长上限</span></li>
          </ul>
        </article>
      </div>
      <footer class="ai-growth-plan__footer">
        <p><strong>批准前不会执行搜索。</strong> 方案、来源与预算可以继续修改。</p>
        <div>
          <button type="button" class="ai-growth-button ai-growth-button--quiet" data-action="cancel-plan">取消</button>
          <button type="button" class="ai-growth-button ai-growth-button--secondary" data-action="edit-plan">编辑方案</button>
          <button type="button" class="ai-growth-button ai-growth-button--primary" data-action="approve-plan"${vm.approvalStatus === "approved" ? " disabled" : ""}>批准并开始执行</button>
        </div>
      </footer>
    </section>
  `, callbacks);
}
