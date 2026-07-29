import { createDemoRouter, demoModuleMeta } from "./demo-router";
import { renderDashboardView } from "./demo-dashboard-view";
import { createDemoStore } from "./demo-store";
import type { DemoModule, DemoState } from "./demo-types";
import { showDemoToast } from "./demo-ui";

function renderModule(module: DemoModule, state: DemoState, host: HTMLElement, inspector: HTMLElement): void {
  if (module === "dashboard") {
    renderDashboardView(state, host, inspector);
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
    if (target.closest("#replicaNewTaskButton") && router.current() !== "acquisition") {
      event.preventDefault();
      event.stopPropagation();
      showDemoToast(`${demoModuleMeta[router.current()].primaryAction}已模拟完成`);
    }
  });
  shell.addEventListener("submit", (event) => {
    if (router.current() === "acquisition") return;
    event.preventDefault();
    showDemoToast("表单提交已模拟完成");
  });

  store.subscribe(render);
  router.subscribe(render);
  render();
}

if (typeof document !== "undefined") startDemoApp();
