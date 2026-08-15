import { strict as assert } from "node:assert";
import { BRIDGE_VERSION, type ExtensionEvent } from "./protocol";

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (value: unknown) => void
) => unknown;

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
const originalAddEventListener = Object.getOwnPropertyDescriptor(globalThis, "addEventListener");
const originalDateNow = Date.now;
let clock = 0;
let listener: RuntimeListener | null = null;
const attempts: ExtensionEvent[] = [];
let sourceUrl = "https://www.douyin.com/video/123";
let advanceClockDuringSourceSetup = true;
let sourceSetupReads = 0;

try {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        onMessage: {
          addListener(value: RuntimeListener) { listener = value; }
        },
        async sendMessage(message: { kind?: unknown; event?: ExtensionEvent }) {
          if (message.kind === "douyin_reader_event" && message.event) {
            attempts.push(structuredClone(message.event));
          }
          return { accepted: true };
        }
      }
    }
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { querySelectorAll: () => [] }
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      get href() {
        sourceSetupReads += 1;
        if (advanceClockDuringSourceSetup) clock = 1;
        return sourceUrl;
      }
    }
  });
  Object.defineProperty(globalThis, "addEventListener", {
    configurable: true,
    value: () => undefined
  });
  Date.now = () => clock;

  await import("./douyin-content");
  assert.ok(listener, "content script installs its runtime start listener");

  let response: unknown = null;
  const invoke = listener as RuntimeListener;
  invoke({
    kind: "visual_reader_start",
    sessionId: "minimum-duration-content-start",
    limits: {
      maxVideos: 1,
      maxCommentsPerVideo: 30,
      maxScrolls: 5,
      maxOcrCalls: 0,
      maxDurationMs: 1
    },
    artifactUploadEnabled: false,
    channelNonce: "0".repeat(64)
  }, null, (value) => { response = value; });

  assert.deepEqual(response, { accepted: true });
  await flush();
  assert.equal(sourceSetupReads, 0,
    "an empty work window queues terminal before source setup can consume the session");
  assert.equal(attempts.length, 1,
    "a legal minimum-duration start initiates its budget terminal before setup consumes the session");
  assert.deepEqual(attempts[0], {
    version: BRIDGE_VERSION,
    type: "terminal",
    channelNonce: "0".repeat(64),
    sessionId: "minimum-duration-content-start",
    status: "partial_success",
    errorCodes: ["visual_reader_budget_exhausted"]
  });

  attempts.length = 0;
  clock = 0;
  sourceUrl = "https://www.douyin.com/not-a-video";
  advanceClockDuringSourceSetup = false;
  response = null;
  invoke({
    kind: "visual_reader_start",
    sessionId: "invalid-source-fallback",
    limits: {
      maxVideos: 1,
      maxCommentsPerVideo: 30,
      maxScrolls: 5,
      maxOcrCalls: 0,
      maxDurationMs: 100
    },
    artifactUploadEnabled: false,
    channelNonce: "1".repeat(64)
  }, null, (value) => { response = value; });

  assert.deepEqual(response, { accepted: true });
  await flush();
  assert.deepEqual(attempts, [{
    version: BRIDGE_VERSION,
    type: "terminal",
    channelNonce: "1".repeat(64),
    sessionId: "invalid-source-fallback",
    status: "partial_success",
    errorCodes: ["visual_source_invalid"]
  }], "a setup failure emits one fallback terminal");
  await flush();
  assert.equal(attempts.length, 1, "fallback settlement cannot duplicate its terminal");
} finally {
  Date.now = originalDateNow;
  for (const [name, descriptor] of [
    ["chrome", originalChrome],
    ["document", originalDocument],
    ["location", originalLocation],
    ["addEventListener", originalAddEventListener]
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  Reflect.deleteProperty(globalThis, "__goodjobDouyinVisualReaderInstalledV1");
}

console.log("douyin content start self-test passed");
