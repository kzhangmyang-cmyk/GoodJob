import { parseGrowthHash } from "./router";
import {
  growthWorkspaceHost,
  startGrowthRuntime
} from "./runtime";

function renderUnavailable(reason: string): void {
  const host = growthWorkspaceHost();
  if (!host) return;
  host.innerHTML = `<div class="growth-unavailable">
    <p>Growth 真实模式不可用：<code>${reason.replace(/[<>&"]/gu, "")}</code></p>
  </div>`;
}

export function startGrowthWhenRequested(): void {
  const host = growthWorkspaceHost();
  if (!parseGrowthHash(window.location.hash)) return;
  if (host) host.hidden = false;
  void startGrowthRuntime().then((mode) => {
    if (mode.kind === "unavailable") {
      renderUnavailable(mode.reason);
    }
  });
  window.addEventListener("hashchange", () => {
    if (!parseGrowthHash(window.location.hash)) return;
    if (host) host.hidden = false;
    void startGrowthRuntime().then((mode) => {
      if (mode.kind === "unavailable") renderUnavailable(mode.reason);
    });
  });
}
