import { growthHash, parseGrowthHash, type GrowthRoute } from "./router";
import {
  resolveGrowthMode,
  type GrowthMode,
  type GrowthUnavailable
} from "./mode";
import manifest from "../../contracts/pinned/growth-advisor-quote-roi.manifest.json";
import { loadGrowthBootstrap } from "./bootstrap-api";

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
