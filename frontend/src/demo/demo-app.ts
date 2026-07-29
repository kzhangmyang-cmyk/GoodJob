import { createDemoRouter, demoModuleMeta } from "./demo-router";
import { renderConversationsView, setConversationFilter } from "./demo-conversations-view";
import { renderDashboardView } from "./demo-dashboard-view";
import { isOpportunityStage, lossReasons, renderConversionView } from "./demo-conversion-view";
import {
  clearCustomerBatchSelection,
  closeOpportunityForm,
  openOpportunityForm,
  renderPrivateDomainView,
  selectedCustomerBatchIds,
  setPrivateDomainFilter,
  toggleCustomerBatchSelection
} from "./demo-private-domain-view";
import { createDemoStore } from "./demo-store";
import type { DemoModule, DemoState } from "./demo-types";
import { showDemoToast } from "./demo-ui";

function renderModule(module: DemoModule, state: DemoState, host: HTMLElement, inspector: HTMLElement): void {
  if (module === "dashboard") {
    renderDashboardView(state, host, inspector);
    return;
  }
  if (module === "conversations") {
    renderConversationsView(state, host, inspector);
    return;
  }
  if (module === "private-domain") {
    renderPrivateDomainView(state, host, inspector);
    return;
  }
  if (module === "conversion") {
    renderConversionView(state, host, inspector);
    return;
  }
  if (module === "acquisition") return;
  const meta = demoModuleMeta[module];
  host.innerHTML = `
    <section class="demo-panel demo-empty">
      <span class="demo-status">演示模块</span>
      <h2>${meta.title}</h2>
      <p>${meta.subtitle}</p>
      <small>已载入 ${state.tasks.filter((task) => task.module === module && !task.done).length} 条待处理演示任务。</small>
    </section>`;
  inspector.innerHTML = `
    <section class="demo-panel demo-empty">
      <span class="demo-chip">演示数据</span>
      <p>在左侧选择其他模块，体验共享工作区外壳。</p>
    </section>`;
}

export function parseFollowUpAt(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function startDemoApp(): void {
  const shell = document.querySelector<HTMLElement>(".replica-shell");
  const host = document.querySelector<HTMLElement>("#demoModuleMain");
  const inspector = document.querySelector<HTMLElement>("#demoModuleInspector");
  if (!shell || !host || !inspector || shell.dataset.demoAppStarted === "true") return;
  shell.dataset.demoAppStarted = "true";

  const store = createDemoStore();
  const router = createDemoRouter();
  const render = () => renderModule(router.current(), store.getState(), host, inspector);
  let draggedOpportunityId = "";

  function sendConversationMessage(conversationId: string, body: string): void {
    const text = body.trim();
    if (!text) {
      showDemoToast("请输入演示消息");
      return;
    }
    const conversation = store.getState().conversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    const shouldReply = conversation.mode === "agent";
    store.sendMessage(conversationId, text);
    if (shouldReply) store.sendAgentReply(conversationId);
  }

  shell.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const moduleButton = target.closest<HTMLButtonElement>("[data-demo-action=\"open-module\"]");
    const module = moduleButton?.dataset.demoModule;
    if (module && Object.prototype.hasOwnProperty.call(demoModuleMeta, module)) {
      router.navigate(module as DemoModule);
      return;
    }
    const nav = target.closest<HTMLButtonElement>("[data-replica-view]");
    if (nav?.dataset.replicaView) {
      router.navigate(nav.dataset.replicaView as DemoModule);
      return;
    }
    const actionTarget = target.closest<HTMLElement>("[data-demo-action]");
    const action = actionTarget?.dataset.demoAction;
    const conversationId = actionTarget?.dataset.conversationId;
    const opportunityId = actionTarget?.dataset.opportunityId;
    if (action === "select-conversation" && conversationId) {
      store.selectConversation(conversationId);
      return;
    }
    if (action === "filter-conversations") {
      setConversationFilter(actionTarget?.dataset.conversationFilter ?? "all", actionTarget?.dataset.platform);
      render();
      return;
    }
    if (action === "quick-reply" && conversationId) {
      sendConversationMessage(conversationId, actionTarget?.dataset.reply ?? "");
      return;
    }
    if (action === "set-conversation-mode" && conversationId) {
      const mode = actionTarget?.dataset.mode;
      if (mode === "agent" || mode === "manual" || mode === "paused") {
        store.setConversationMode(conversationId, mode);
        showDemoToast(`已切换为${mode === "agent" ? "智能体跟进" : mode === "manual" ? "人工接管" : "已暂停"}`);
      }
      return;
    }
    if (action === "transfer-to-private" && conversationId) {
      const customerId = store.transferConversationToPrivate(conversationId);
      if (customerId) showDemoToast("演示：客户已转入私域");
      return;
    }
    if (action === "open-private-customer") {
      const customerId = actionTarget?.dataset.customerId;
      if (customerId) {
        store.selectCustomer(customerId);
        router.navigate("private-domain");
      }
      return;
    }
    if (action === "filter-customers" && actionTarget instanceof HTMLButtonElement) {
      setPrivateDomainFilter({ group: actionTarget.dataset.customerGroup });
      render();
      return;
    }
    if (action === "toggle-customer-batch" && actionTarget instanceof HTMLInputElement) {
      const customerId = actionTarget.dataset.customerId;
      if (customerId) {
        toggleCustomerBatchSelection(customerId, actionTarget.checked);
        render();
      }
      return;
    }
    if (action === "select-customer") {
      const customerId = actionTarget?.dataset.customerId;
      if (customerId) store.selectCustomer(customerId);
      return;
    }
    if (action === "simulate-outreach") {
      const customerIds = selectedCustomerBatchIds();
      if (!customerIds.length) return;
      store.simulateOutreach(customerIds);
      clearCustomerBatchSelection();
      showDemoToast("演示：已模拟触达");
      return;
    }
    if (action === "open-opportunity-form") {
      const customerId = actionTarget?.dataset.customerId;
      if (customerId) {
        openOpportunityForm(customerId);
        render();
      }
      return;
    }
    if (action === "select-opportunity" && opportunityId) {
      store.selectOpportunity(opportunityId);
      return;
    }
    if (action === "move-opportunity" && opportunityId && isOpportunityStage(actionTarget?.dataset.opportunityStage)) {
      store.moveOpportunity(opportunityId, actionTarget.dataset.opportunityStage);
      showDemoToast("已移动演示商机阶段");
      return;
    }
    if (action === "mark-quote-sent" && opportunityId) {
      store.markQuoteSent(opportunityId);
      showDemoToast("演示：报价已标记发送");
      return;
    }
    if (action === "close-won" && opportunityId) {
      store.closeOpportunity(opportunityId, "won");
      showDemoToast("演示：商机已标记成交");
      return;
    }
    if (target.closest("#replicaNewTaskButton") && router.current() !== "acquisition") {
      event.preventDefault();
      event.stopPropagation();
      showDemoToast(`${demoModuleMeta[router.current()].primaryAction}已模拟完成`);
    }
  });
  shell.addEventListener("dragstart", (event) => {
    if (router.current() !== "conversion") return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-demo-action="select-opportunity"][draggable="true"]');
    const opportunityId = card?.dataset.opportunityId;
    if (!opportunityId) return;
    draggedOpportunityId = opportunityId;
    event.dataTransfer?.setData("text/plain", opportunityId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  shell.addEventListener("dragover", (event) => {
    if (router.current() !== "conversion" || !(event.target as HTMLElement).closest("[data-opportunity-stage]")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });
  shell.addEventListener("drop", (event) => {
    if (router.current() !== "conversion") return;
    const lane = (event.target as HTMLElement).closest<HTMLElement>("[data-opportunity-stage]");
    const stage = lane?.dataset.opportunityStage;
    const opportunityId = event.dataTransfer?.getData("text/plain") || draggedOpportunityId;
    draggedOpportunityId = "";
    if (!opportunityId || !isOpportunityStage(stage)) return;
    event.preventDefault();
    store.moveOpportunity(opportunityId, stage);
    showDemoToast("已拖动更新演示阶段");
  });
  shell.addEventListener("submit", (event) => {
    if (router.current() === "acquisition") return;
    const form = event.target as HTMLFormElement;
    const action = form.dataset.demoAction;
    const conversationId = form.dataset.conversationId;
    if (action === "send-message" && conversationId) {
      event.preventDefault();
      const message = form.querySelector<HTMLTextAreaElement>('textarea[name="demo-message"]')?.value ?? "";
      sendConversationMessage(conversationId, message);
      return;
    }
    if (action === "add-conversation-tag" && conversationId) {
      event.preventDefault();
      const tag = form.querySelector<HTMLInputElement>('input[name="demo-tag"]')?.value ?? "";
      if (!tag.trim()) {
        showDemoToast("请输入演示标签");
        return;
      }
      store.addConversationTag(conversationId, tag);
      showDemoToast("已添加演示标签");
      return;
    }
    const customerId = form.dataset.customerId;
    const opportunityId = form.dataset.opportunityId;
    if (action === "filter-customers") {
      event.preventDefault();
      setPrivateDomainFilter({
        search: form.querySelector<HTMLInputElement>('input[name="customer-search"]')?.value,
        intent: form.querySelector<HTMLSelectElement>('select[name="customer-intent"]')?.value,
        platform: form.querySelector<HTMLSelectElement>('select[name="customer-platform"]')?.value
      });
      render();
      return;
    }
    if (action === "add-customer-tag" && customerId) {
      event.preventDefault();
      const tag = form.querySelector<HTMLInputElement>('input[name="customer-tag"]')?.value ?? "";
      if (!tag.trim()) {
        showDemoToast("请输入演示标签");
        return;
      }
      store.addCustomerTag(customerId, tag);
      showDemoToast("已添加客户标签");
      return;
    }
    if (action === "change-customer-group" && customerId) {
      event.preventDefault();
      const group = form.querySelector<HTMLSelectElement>('select[name="customer-group"]')?.value;
      if (group === "重点客户" || group === "待跟进" || group === "沉默客户" || group === "已创建商机") {
        store.updateCustomer(customerId, { group });
        showDemoToast("已更新客户分组");
      }
      return;
    }
    if (action === "create-follow-up" && customerId) {
      event.preventDefault();
      const note = form.querySelector<HTMLInputElement>('input[name="follow-up-note"]')?.value ?? "";
      const dueValue = form.querySelector<HTMLInputElement>('input[name="follow-up-at"]')?.value ?? "";
      const dueAt = parseFollowUpAt(dueValue);
      if (!note.trim() || !dueAt) {
        showDemoToast("请补全跟进内容和时间");
        return;
      }
      store.createFollowUp(customerId, note, dueAt);
      showDemoToast("已创建跟进计划");
      return;
    }
    if (action === "create-opportunity" && customerId) {
      event.preventDefault();
      const title = form.querySelector<HTMLInputElement>('input[name="opportunity-title"]')?.value ?? "";
      const amount = Number(form.querySelector<HTMLInputElement>('input[name="opportunity-amount"]')?.value);
      if (!title.trim() || !Number.isFinite(amount) || amount <= 0) {
        showDemoToast("请填写商机名称和有效金额");
        return;
      }
      const opportunityId = store.createOpportunity(customerId, { title, amount });
      if (!opportunityId) return;
      closeOpportunityForm();
      router.navigate("conversion");
      showDemoToast("已创建演示商机");
      return;
    }
    if (action === "create-quote" && opportunityId) {
      event.preventDefault();
      const amount = Number(form.querySelector<HTMLInputElement>('input[name="quote-amount"]')?.value);
      if (!Number.isFinite(amount) || amount < 1) {
        showDemoToast("报价金额需大于 0");
        return;
      }
      store.createQuote(opportunityId, amount);
      showDemoToast("已创建演示报价");
      return;
    }
    if (action === "update-opportunity" && opportunityId) {
      event.preventDefault();
      const probability = Number(form.querySelector<HTMLInputElement>('input[name="opportunity-probability"]')?.value);
      const nextAction = form.querySelector<HTMLInputElement>('input[name="opportunity-next-action"]')?.value.trim() ?? "";
      if (!Number.isFinite(probability) || probability < 0 || probability > 100 || !nextAction) {
        showDemoToast("请填写 0–100 的概率和下一步行动");
        return;
      }
      store.updateOpportunity(opportunityId, { probability, nextAction });
      showDemoToast("已更新演示商机");
      return;
    }
    if (action === "close-lost" && opportunityId) {
      event.preventDefault();
      const reason = form.querySelector<HTMLSelectElement>('select[name="loss-reason"]')?.value;
      if (!reason || !lossReasons.includes(reason as typeof lossReasons[number])) {
        showDemoToast("请选择有效的流失原因");
        return;
      }
      store.closeOpportunity(opportunityId, "lost", reason);
      showDemoToast("演示：商机已标记流失");
      return;
    }
    event.preventDefault();
    showDemoToast("表单提交已模拟完成");
  });

  store.subscribe(render);
  router.subscribe(render);
  render();
}

if (typeof document !== "undefined") startDemoApp();
