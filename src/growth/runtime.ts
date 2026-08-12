import { growthHash, parseGrowthHash, type GrowthRoute } from "./router";
import {
  resolveGrowthMode,
  type GrowthMode,
  type GrowthUnavailable
} from "./mode";
import manifest from "../../contracts/pinned/growth-advisor-quote-roi.manifest.json";
import { loadGrowthBootstrap } from "./bootstrap-api";
import { createGrowthHttpClient } from "./http";
import { createCatalogApi } from "./catalog/api";
import {
  createCatalogController,
  type CatalogPageState
} from "./catalog/controller";
import { renderCatalogPage } from "./catalog/view";
import { createQuoteApi } from "./quotes/api";
import { createQuoteController } from "./quotes/controller";
import { renderQuoteWorkbench } from "./quotes/view";

export type GrowthModeState = GrowthMode | GrowthUnavailable;

export interface GrowthPageContext {
  route: GrowthRoute;
  mode: GrowthModeState;
  abort(): void;
}

export interface GrowthPageController {
  mount(context: GrowthPageContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
}

export class GrowthPageRegistry {
  private readonly pages = new Map<string, GrowthPageController>();

  register(name: string, controller: GrowthPageController): void {
    this.pages.set(name, controller);
  }

  get(name: string): GrowthPageController | null {
    return this.pages.get(name) ?? null;
  }
}

export function growthWorkspaceHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#growthWorkspace");
}

let activeAbort: AbortController | null = null;
let activeController: GrowthPageController | null = null;

async function switchPage(
  registry: GrowthPageRegistry,
  route: GrowthRoute,
  mode: GrowthModeState
): Promise<void> {
  activeAbort?.abort();
  await activeController?.unmount?.();
  activeController = null;
  const host = growthWorkspaceHost();
  if (host) host.replaceChildren();
  const controller = registry.get(route.name);
  if (!controller || !host) return;
  const abort = new AbortController();
  activeAbort = abort;
  activeController = controller;
  await controller.mount({
    route,
    mode,
    abort: () => abort.abort()
  });
}

export interface StartGrowthRuntimeOptions {
  requested?: "real" | "demo";
  registry?: GrowthPageRegistry;
  bootstrapLoader?: { load(signal?: AbortSignal): Promise<unknown> };
}

export async function startGrowthRuntime(
  options: StartGrowthRuntimeOptions = {}
): Promise<GrowthModeState> {
  const registry = options.registry ?? new GrowthPageRegistry();
  let mode: GrowthModeState;
  if (options.requested === "demo") {
    mode = { kind: "demo" };
  } else {
    try {
      const bootstrap = await (options.bootstrapLoader
        ? options.bootstrapLoader.load()
        : loadGrowthBootstrap()) as never;
      mode = resolveGrowthMode({
        requested: "real",
        pinned: manifest,
        bootstrap
      });
    } catch {
      mode = { kind: "unavailable", reason: "workspace_selection_required" };
    }
  }
  if (registry.get("catalog") === null && mode.kind === "real") {
    const http = createGrowthHttpClient();
    const catalogController = createCatalogController({
      api: createCatalogApi(http),
      hasFeature: (feature) =>
        mode.kind === "real"
        && (mode.bootstrap.features as readonly string[]).includes(feature),
      hasCapability: (capability) =>
        mode.kind === "real"
        && (mode.bootstrap.capabilities as readonly string[]).includes(capability)
    });
    registry.register("catalog", {
      async mount(context) {
        const host = growthWorkspaceHost();
        if (!host) return;
        host.innerHTML = renderCatalogPage({ kind: "loading" });
        const state = await catalogController.load();
        host.innerHTML = renderCatalogPage(state);
      },
      unmount() {
        const host = growthWorkspaceHost();
        if (host) host.replaceChildren();
      }
    });
  }
  if (registry.get("quote") === null && mode.kind === "real") {
    const http = createGrowthHttpClient();
    const quoteController = createQuoteController({
      api: createQuoteApi(http),
      hasFeature: (feature) =>
        mode.kind === "real"
        && (mode.bootstrap.features as readonly string[]).includes(feature),
      hasCapability: (capability) =>
        mode.kind === "real"
        && (mode.bootstrap.capabilities as readonly string[]).includes(capability)
    });
    registry.register("quote", {
      async mount(context) {
        const host = growthWorkspaceHost();
        if (!host) return;
        const caseId = context.route.name === "quote"
          ? context.route.quoteCaseId : undefined;
        if (!caseId) {
          host.innerHTML = renderQuoteWorkbench({
            kind: "error",
            message: "quote_case_required"
          });
          return;
        }
        host.innerHTML = renderQuoteWorkbench({ kind: "loading_case" });
        const state = await quoteController.loadCase(caseId);
        host.innerHTML = renderQuoteWorkbench(state);
      },
      unmount() {
        const host = growthWorkspaceHost();
        if (host) host.replaceChildren();
      }
    });
  }
  const route = parseGrowthHash(window.location.hash);
  if (route) {
    await switchPage(registry, route, mode);
  }
  window.addEventListener("hashchange", () => {
    const next = parseGrowthHash(window.location.hash);
    if (next) void switchPage(registry, next, mode);
  });
  return mode;
}

export { growthHash };
