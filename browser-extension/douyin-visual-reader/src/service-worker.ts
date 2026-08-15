import {
  BRIDGE_VERSION,
  canonicalDouyinVideoUrl,
  parseExtensionEvent,
  parsePageCommand,
  type ExtensionEvent,
  type PageCommand
} from "./protocol";
import {
  createSessionCoordinator,
  sha256,
  type SessionCoordinator,
  type VisualReaderPersistedState
} from "./session-coordinator";

declare const chrome: any;

let coordinator: SessionCoordinator | null = null;

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!record(value)) return false;
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === keys.length && keys.every((key) => key in value)
    && actual.every((key) => allowed.has(key));
}

async function persist(state: VisualReaderPersistedState): Promise<void> {
  await chrome.storage.session.set({ visualReaderSession: state });
}

function safeLog(entry: { event: string; reason?: string; sessionId?: string }): void {
  console.info({ component: "goodjob_visual_reader", ...entry });
}

function createCoordinator(): SessionCoordinator {
  return createSessionCoordinator({ persist, log: safeLog, nonceHash: sha256 });
}

async function sendToGoodJob(tabId: number, event: ExtensionEvent): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { kind: "goodjob_extension_event", event });
}

async function safeAbort(reason: "visual_reader_user_takeover" | "user_requested"): Promise<void> {
  if (!coordinator) return;
  const snapshot = coordinator.snapshot();
  if (["completed", "partial_success", "aborted"].includes(snapshot.status)) return;
  const nonce = coordinator.rawChannelNonce();
  if (snapshot.douyinTabId !== null) {
    await chrome.tabs.sendMessage(snapshot.douyinTabId, {
      kind: "visual_reader_abort",
      sessionId: snapshot.sessionId
    }).catch(() => undefined);
  }
  await coordinator.abort(reason);
  if (nonce) {
    await sendToGoodJob(snapshot.goodJobTabId, {
      version: BRIDGE_VERSION,
      type: "terminal",
      channelNonce: nonce,
      sessionId: snapshot.sessionId,
      status: "aborted",
      errorCodes: reason === "visual_reader_user_takeover" ? ["visual_reader_user_takeover"] : []
    }).catch(() => undefined);
  }
}

async function handleGoodJobCommand(
  raw: unknown,
  sender: any
): Promise<{ event?: ExtensionEvent; accepted?: boolean }> {
  if (!exact(raw, ["kind", "origin", "command"]) || raw.kind !== "goodjob_page_command"
    || typeof raw.origin !== "string" || !sender.tab?.id || sender.origin !== raw.origin) return {};
  const command = parsePageCommand(raw.command, raw.origin);
  if (!command) return {};
  if (command.type === "probe") {
    return { event: {
      version: BRIDGE_VERSION,
      type: "ready",
      channelNonce: command.channelNonce,
      extensionVersion: chrome.runtime.getManifest().version
    } };
  }
  if (command.type === "start") {
    if (coordinator) await safeAbort("user_requested");
    coordinator = createCoordinator();
    await coordinator.authorizeFromGoodJob({
      goodJobTabId: sender.tab.id,
      channelNonce: command.channelNonce,
      sessionId: command.sessionId,
      limits: command.limits,
      artifactUploadEnabled: command.artifactUploadEnabled
    });
    return { accepted: true };
  }
  if (!coordinator) return {};
  const snapshot = coordinator.snapshot();
  if (command.sessionId !== snapshot.sessionId || sender.tab.id !== snapshot.goodJobTabId) return {};
  if (command.type === "acknowledge_batch") {
    if (!coordinator.acknowledgeBatch(command.sessionId, command.batchId)
      || snapshot.douyinTabId === null) return {};
    try {
      await chrome.tabs.sendMessage(snapshot.douyinTabId, {
        kind: "visual_reader_ack",
        sessionId: command.sessionId,
        batchId: command.batchId
      });
    } catch (error) {
      coordinator.beginBatch(command.batchId);
      throw error;
    }
    return { accepted: true };
  }
  await safeAbort("user_requested");
  return { accepted: true };
}

async function popupSnapshot(): Promise<unknown> {
  const snapshot = coordinator?.snapshot() ?? null;
  const tabs = await chrome.tabs.query({ currentWindow: true, url: "https://www.douyin.com/*" });
  return {
    session: snapshot ? {
      sessionId: snapshot.sessionId,
      limits: snapshot.limits,
      usage: snapshot.usage,
      artifactUploadEnabled: snapshot.artifactUploadEnabled,
      status: snapshot.status
    } : null,
    tabs: tabs.flatMap((tab: any) => {
      const canonical = typeof tab.url === "string" ? canonicalDouyinVideoUrl(tab.url) : null;
      return canonical && Number.isSafeInteger(tab.id) ? [{
        id: tab.id,
        title: typeof tab.title === "string" ? tab.title.slice(0, 160) : "抖音视频",
        url: canonical.sourceUrl
      }] : [];
    })
  };
}

async function confirmPopup(tabId: number): Promise<{ accepted: boolean }> {
  if (!coordinator || !Number.isSafeInteger(tabId)) return { accepted: false };
  const snapshot = coordinator.snapshot();
  if (snapshot.status !== "authorized") return { accepted: false };
  const tab = await chrome.tabs.get(tabId);
  const url = typeof tab?.url === "string" ? tab.url : "";
  if (!coordinator.confirmDouyinTab(tabId, url)) return { accepted: false };
  await chrome.scripting.executeScript({ target: { tabId }, files: ["douyin-content.js"] });
  await chrome.tabs.sendMessage(tabId, {
    kind: "visual_reader_start",
    sessionId: snapshot.sessionId,
    limits: snapshot.limits,
    artifactUploadEnabled: snapshot.artifactUploadEnabled,
    channelNonce: coordinator.rawChannelNonce()
  });
  return { accepted: true };
}

async function handleReaderEvent(raw: unknown, sender: any): Promise<{ accepted: boolean }> {
  if (!exact(raw, ["kind", "event"]) || raw.kind !== "douyin_reader_event" || !coordinator) {
    return { accepted: false };
  }
  const event = parseExtensionEvent(raw.event);
  if (!event || event.type === "ready") return { accepted: false };
  const snapshot = coordinator.snapshot();
  if (sender.tab?.id !== snapshot.douyinTabId || event.sessionId !== snapshot.sessionId
    || event.channelNonce !== coordinator.rawChannelNonce()) return { accepted: false };
  if (event.type === "observation_batch") {
    if (!coordinator.beginBatch(event.batchId)) return { accepted: false };
    await sendToGoodJob(snapshot.goodJobTabId, event);
    await coordinator.updateUsage({ observationCount:
      Math.min(snapshot.limits.maxCommentsPerVideo,
        snapshot.usage.observationCount + event.observations.length) });
    return { accepted: true };
  }
  if (snapshot.pendingBatchId !== null) return { accepted: false };
  await sendToGoodJob(snapshot.goodJobTabId, event);
  if (event.status === "aborted") {
    await coordinator.abort(event.errorCodes.includes("visual_reader_user_takeover")
      ? "visual_reader_user_takeover" : "user_requested");
  } else {
    await coordinator.finish(event.status === "completed" ? "completed" : "partial_success");
  }
  return { accepted: true };
}

async function handleReaderUsage(raw: unknown, sender: any): Promise<{ accepted: boolean }> {
  if (!exact(raw, ["kind", "sessionId", "scrollCount"])
    || raw.kind !== "douyin_reader_usage" || typeof raw.sessionId !== "string"
    || !Number.isSafeInteger(raw.scrollCount) || !coordinator) return { accepted: false };
  const snapshot = coordinator.snapshot();
  if (sender.tab?.id !== snapshot.douyinTabId || raw.sessionId !== snapshot.sessionId
    || (raw.scrollCount as number) < 0 || (raw.scrollCount as number) > snapshot.limits.maxScrolls) {
    return { accepted: false };
  }
  await coordinator.updateUsage({ scrollCount: raw.scrollCount as number });
  return { accepted: true };
}

if (typeof chrome !== "undefined") {
  chrome.runtime.onMessage.addListener((message: unknown, sender: any, sendResponse: (value: unknown) => void) => {
    void (async () => {
      if (record(message) && message.kind === "goodjob_page_command") {
        return handleGoodJobCommand(message, sender);
      }
      if (exact(message, ["kind"]) && message.kind === "popup_snapshot") return popupSnapshot();
      if (exact(message, ["kind", "tabId"]) && message.kind === "popup_confirm"
        && Number.isSafeInteger(message.tabId)) return confirmPopup(message.tabId as number);
      if (exact(message, ["kind"]) && message.kind === "popup_abort") {
        await safeAbort("user_requested");
        return { accepted: true };
      }
      if (record(message) && message.kind === "douyin_reader_event") return handleReaderEvent(message, sender);
      if (record(message) && message.kind === "douyin_reader_usage") return handleReaderUsage(message, sender);
      return { accepted: false };
    })().then(sendResponse).catch(() => sendResponse({ accepted: false }));
    return true;
  });

  chrome.runtime.onConnect.addListener((port: any) => {
    if (port.name !== "visual-reader-popup") return;
    port.onDisconnect.addListener(() => { void safeAbort("visual_reader_user_takeover"); });
  });
  chrome.tabs.onActivated.addListener(({ tabId }: { tabId: number }) => {
    const snapshot = coordinator?.snapshot();
    if (snapshot?.status === "reading" && tabId !== snapshot.douyinTabId) {
      void safeAbort("visual_reader_user_takeover");
    }
  });
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    const snapshot = coordinator?.snapshot();
    if (snapshot && [snapshot.goodJobTabId, snapshot.douyinTabId].includes(tabId)) {
      void safeAbort("visual_reader_user_takeover");
    }
  });
}
