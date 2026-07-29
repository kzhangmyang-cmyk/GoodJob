import { createDemoRouter, demoModuleMeta } from "./demo-router";
import { renderConversationsView, setConversationFilter } from "./demo-conversations-view";
import { renderDashboardView } from "./demo-dashboard-view";
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

export function startDemoApp(): void {
  const shell = document.querySelector<HTMLElement>(".replica-shell");
  const host = document.querySelector<HTMLElement>("#demoModuleMain");
  const inspector = document.querySelector<HTMLElement>("#demoModuleInspector");
  if (!shell || !host || !inspector || shell.dataset.demoAppStarted === "true") return;
  shell.dataset.demoAppStarted = "true";

  const store = createDemoStore();
  const router = createDemoRouter();
  const render = () => renderModule(router.current(), store.getState(), host, inspector);

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
    if (target.closest("#replicaNewTaskButton") && router.current() !== "acquisition") {
      event.preventDefault();
      event.stopPropagation();
      showDemoToast(`${demoModuleMeta[router.current()].primaryAction}已模拟完成`);
    }
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
    event.preventDefault();
    showDemoToast("表单提交已模拟完成");
  });

  store.subscribe(render);
  router.subscribe(render);
  render();
}

if (typeof document !== "undefined") startDemoApp();
