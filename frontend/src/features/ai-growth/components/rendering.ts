export interface ComponentRender<TCallbacks> {
  html: string;
  callbacks: TCallbacks;
}

export function componentRender<TCallbacks>(
  html: string,
  callbacks: TCallbacks
): ComponentRender<TCallbacks> {
  return { html, callbacks };
}

export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function visibleList(
  values: readonly string[],
  emptyLabel = "未设置"
): string {
  if (values.length === 0) {
    return `<span class="ai-growth-empty-value">${escapeHtml(emptyLabel)}</span>`;
  }
  return values
    .map((value) => `<span class="ai-growth-chip">${escapeHtml(value)}</span>`)
    .join("");
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
