import { strict as assert } from "node:assert";
import { BRIDGE_VERSION } from "./protocol";

type Listener = (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

let listener: Listener | null = null;
let releaseSelectedTab: ((value: unknown) => void) | null = null;
let deferSelectedTab = false;
const stored: { visualReaderSession?: unknown } = {};
const passiveListener = { addListener() { return undefined; } };

(globalThis as typeof globalThis & { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener(value: Listener) { listener = value; } },
    sendMessage: async () => ({ accepted: true }),
    getManifest: () => ({ version: "1.0.0" })
  },
  offscreen: {
    hasDocument: async () => false,
    closeDocument: async () => undefined,
    createDocument: async () => undefined
  },
  storage: {
    session: {
      async get() { return { ...stored }; },
      async set(value: { visualReaderSession?: unknown }) {
        stored.visualReaderSession = structuredClone(value.visualReaderSession);
      },
      async remove() { delete stored.visualReaderSession; }
    }
  },
  tabs: {
    async get(tabId: number) {
      if (deferSelectedTab) {
        deferSelectedTab = false;
        return new Promise((resolve) => { releaseSelectedTab = resolve; });
      }
      return {
        id: tabId,
        windowId: 7,
        url: "https://www.douyin.com/video/123",
        active: true
      };
    },
    async update() { return undefined; },
    async query() { return []; },
    async sendMessage() { return { accepted: true }; },
    captureVisibleTab: async () => "data:image/png;base64,unused",
    onActivated: passiveListener,
    onUpdated: passiveListener,
    onReplaced: passiveListener,
    onRemoved: passiveListener
  },
  windows: {
    WINDOW_ID_NONE: -1,
    async getLastFocused() { return { id: 7 }; },
    async update() { return undefined; },
    onFocusChanged: passiveListener
  },
  scripting: { async executeScript() { return []; } }
};

await import("./service-worker");

function dispatch(message: unknown, sender: unknown = {}): Promise<unknown> {
  const active = listener;
  if (!active) throw new Error("service worker listener was not installed");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("service worker response timeout")), 2_000);
    active(message, sender, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}

const limits = {
  maxVideos: 1,
  maxCommentsPerVideo: 10,
  maxScrolls: 1,
  maxOcrCalls: 1,
  maxDurationMs: 60_000
};
const origin = "http://127.0.0.1:5191";
const start = (sessionId: string, nonce: string) => dispatch({
  kind: "goodjob_page_command",
  origin,
  command: {
    version: BRIDGE_VERSION,
    type: "start",
    channelNonce: nonce,
    sessionId,
    limits,
    artifactUploadEnabled: true
  }
}, { tab: { id: 10 }, origin });

assert.deepEqual(await start("old-session", "a".repeat(64)), { accepted: true });
deferSelectedTab = true;
const oldConfirmation = dispatch({
  kind: "popup_confirm",
  tab: { id: 20, windowId: 7, url: "https://www.douyin.com/video/123" }
});
while (!releaseSelectedTab) await Promise.resolve();

assert.deepEqual(await start("replacement-session", "b".repeat(64)), { accepted: true });
const release = releaseSelectedTab as ((value: unknown) => void) | null;
if (!release) throw new Error("missing deferred selected-tab resolver");
release({ id: 20, windowId: 7, url: "https://www.douyin.com/video/123", active: true });
assert.deepEqual(await oldConfirmation, { accepted: false },
  "a popup confirmation pending in tabs.get cannot bind the replacement coordinator");

const snapshot = await dispatch({ kind: "popup_snapshot" }) as {
  session?: { sessionId?: unknown; status?: unknown } | null;
};
assert.equal(snapshot.session?.sessionId, "replacement-session");
assert.equal(snapshot.session?.status, "authorized",
  "the replacement remains unbound after a stale popup confirmation settles");

releaseSelectedTab = null;
deferSelectedTab = true;
const abortedConfirmation = dispatch({
  kind: "popup_confirm",
  tab: { id: 20, windowId: 7, url: "https://www.douyin.com/video/123" }
});
while (!releaseSelectedTab) await Promise.resolve();
assert.deepEqual(await dispatch({ kind: "popup_abort" }), { accepted: true });
const releaseAborted = releaseSelectedTab as ((value: unknown) => void) | null;
if (!releaseAborted) throw new Error("missing aborted selected-tab resolver");
releaseAborted({ id: 20, windowId: 7, url: "https://www.douyin.com/video/123", active: true });
assert.deepEqual(await abortedConfirmation, { accepted: false },
  "popup abort synchronously invalidates a confirmation pending in tabs.get");

delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;

console.log("service-worker popup confirmation self-test passed");
