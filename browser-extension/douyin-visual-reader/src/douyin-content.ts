import {
  BRIDGE_VERSION,
  canonicalDouyinVideoUrl,
  parsePageCommand,
  type ExtensionEvent,
  type VisualReaderLimits
} from "./protocol";
import {
  extractVisibleTopLevelComments,
  findExactReadOnlyAction,
  type DouyinDomAdapter
} from "./douyin-extractor";
import { BoundedReaderError, createBoundedReader, type BoundedReader } from "./douyin-reader";

declare const chrome: any;

const INSTALL_KEY = "__goodjobDouyinVisualReaderInstalledV1";

function browserAdapter(): DouyinDomAdapter {
  return {
    queryAll: (root, selector) => Array.from(root.querySelectorAll(selector)),
    role: (element) => element.getAttribute("role"),
    accessibleName: (element) => element.getAttribute("aria-label")?.trim() ?? "",
    innerText: (element) => (element as HTMLElement).innerText.trim(),
    attribute: (element, name) => element.getAttribute(name),
    parent: (element) => element.parentElement,
    visible: (element) => {
      if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    bounds: (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    viewport: () => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
      deviceScaleFactor: globalThis.devicePixelRatio
    }),
    now: () => new Date()
  };
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value as Record<string, unknown>);
  const allowed = new Set(keys);
  return actual.length === keys.length && keys.every((key) => key in (value as object))
    && actual.every((key) => allowed.has(key));
}

function waitForDomStability(): Promise<void> {
  return new Promise((resolve) => {
    let previous = document.querySelectorAll('[role="article"]').length;
    let stable = 0;
    const check = () => {
      const next = document.querySelectorAll('[role="article"]').length;
      stable = next === previous ? stable + 1 : 0;
      previous = next;
      if (stable >= 2) resolve();
      else globalThis.setTimeout(check, 160);
    };
    globalThis.setTimeout(check, 160);
  });
}

if (typeof chrome !== "undefined" && !(globalThis as any)[INSTALL_KEY]) {
  (globalThis as any)[INSTALL_KEY] = true;
  let reader: BoundedReader | null = null;
  let activeSessionId: string | null = null;
  let internalScrollUntil = 0;
  let internalClick = false;

  const takeover = () => reader?.userTakeover();
  globalThis.addEventListener("wheel", takeover, { capture: true, passive: true });
  globalThis.addEventListener("pointerdown", takeover, { capture: true, passive: true });
  globalThis.addEventListener("touchstart", takeover, { capture: true, passive: true });
  globalThis.addEventListener("keydown", takeover, { capture: true });
  globalThis.addEventListener("click", () => { if (!internalClick) takeover(); }, { capture: true });
  globalThis.addEventListener("scroll", () => {
    if (Date.now() > internalScrollUntil) takeover();
  }, { capture: true, passive: true });

  async function sendEvent(event: ExtensionEvent): Promise<void> {
    await chrome.runtime.sendMessage({ kind: "douyin_reader_event", event });
  }

  async function start(input: {
    sessionId: string;
    limits: VisualReaderLimits;
    artifactUploadEnabled: boolean;
    channelNonce: string;
  }): Promise<void> {
    if (reader) reader.stop();
    activeSessionId = input.sessionId;
    const adapter = browserAdapter();
    const source = canonicalDouyinVideoUrl(globalThis.location.href);
    if (!source) return;
    let attemptedAction = false;
    reader = createBoundedReader({
      sessionId: input.sessionId,
      limits: input.limits,
      artifactUploadEnabled: input.artifactUploadEnabled,
      extract: async () => {
        if (!attemptedAction) {
          attemptedAction = true;
          const action = findExactReadOnlyAction(document, adapter);
          if (action.status === "ambiguous") throw new BoundedReaderError("visual_source_invalid");
          if (action.status === "one") {
            internalClick = true;
            try { (action.element as HTMLElement).click(); } finally { internalClick = false; }
            await waitForDomStability();
          }
        }
        const result = await extractVisibleTopLevelComments({
          document,
          adapter,
          sourceUrl: source.sourceUrl
        });
        if (result.status === "blocked") throw new BoundedReaderError("visual_source_invalid");
        return result.observations;
      },
      programmaticScroll: async () => {
        const videos = Array.from(document.querySelectorAll('[role="region"][aria-label="当前视频"]'));
        if (videos.length !== 1) throw new BoundedReaderError("visual_source_invalid");
        const feeds = Array.from(videos[0].querySelectorAll('[role="feed"]'))
          .filter((feed) => ["评论", "评论区"].includes(feed.getAttribute("aria-label") ?? ""));
        if (feeds.length !== 1) throw new BoundedReaderError("visual_source_invalid");
        internalScrollUntil = Date.now() + 800;
        const feed = feeds[0] as HTMLElement;
        feed.scrollBy({ top: Math.max(240, Math.min(480, feed.clientHeight * 0.8)), behavior: "auto" });
        await waitForDomStability();
        await chrome.runtime.sendMessage({
          kind: "douyin_reader_usage",
          sessionId: input.sessionId,
          scrollCount: reader?.usage().scrollCount ?? 0
        });
      },
      sendBatch: async (batch) => {
        await sendEvent({
          version: BRIDGE_VERSION,
          type: "observation_batch",
          channelNonce: input.channelNonce,
          sessionId: input.sessionId,
          batchId: batch.batchId,
          observations: batch.observations as any
        });
      },
      sendTerminal: async (terminal) => {
        await sendEvent({
          version: BRIDGE_VERSION,
          type: "terminal",
          channelNonce: input.channelNonce,
          sessionId: input.sessionId,
          status: terminal.status,
          errorCodes: terminal.errorCodes
        });
        reader = null;
        activeSessionId = null;
      }
    });
    await reader.start();
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (value: unknown) => void) => {
    if (exact(message, ["kind", "sessionId", "limits", "artifactUploadEnabled", "channelNonce"])
      && message.kind === "visual_reader_start") {
      const command = parsePageCommand({
        version: BRIDGE_VERSION,
        type: "start",
        channelNonce: message.channelNonce,
        sessionId: message.sessionId,
        limits: message.limits,
        artifactUploadEnabled: message.artifactUploadEnabled
      }, "https://www.douyin.com");
      if (!command || command.type !== "start") return;
      sendResponse({ accepted: true });
      void start(command).catch(async () => {
        await sendEvent({
          version: BRIDGE_VERSION,
          type: "terminal",
          channelNonce: command.channelNonce,
          sessionId: command.sessionId,
          status: "partial_success",
          errorCodes: ["visual_source_invalid"]
        }).catch(() => undefined);
        reader = null;
        activeSessionId = null;
      });
      return;
    }
    if (exact(message, ["kind", "sessionId", "batchId"])
      && message.kind === "visual_reader_ack"
      && message.sessionId === activeSessionId && typeof message.batchId === "string") {
      void reader?.acknowledge(message.batchId);
      sendResponse({ accepted: true });
      return;
    }
    if (exact(message, ["kind", "sessionId"]) && message.kind === "visual_reader_abort"
      && message.sessionId === activeSessionId) {
      reader?.stop();
      sendResponse({ accepted: true });
    }
  });
}
