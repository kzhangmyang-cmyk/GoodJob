import { strict as assert } from "node:assert";
import {
  BRIDGE_VERSION,
  parseExtensionEvent,
  parsePageCommand
} from "./protocol";

const nonce = "a".repeat(64);
const limits = {
  maxVideos: 10,
  maxCommentsPerVideo: 30,
  maxScrolls: 5,
  maxOcrCalls: 10,
  maxDurationMs: 120_000
};

for (const command of [
  { version: BRIDGE_VERSION, type: "probe", channelNonce: nonce },
  {
    version: BRIDGE_VERSION,
    type: "start",
    channelNonce: nonce,
    sessionId: "visual-session-1",
    limits,
    artifactUploadEnabled: false
  },
  {
    version: BRIDGE_VERSION,
    type: "acknowledge_batch",
    channelNonce: nonce,
    sessionId: "visual-session-1",
    batchId: "batch-1"
  },
  {
    version: BRIDGE_VERSION,
    type: "abort",
    channelNonce: nonce,
    sessionId: "visual-session-1"
  }
] as const) {
  assert.deepEqual(parsePageCommand(command, "http://127.0.0.1:5191"), command);
  assert.equal(parsePageCommand({ ...command, extra: true }, "http://127.0.0.1:5191"), null);
  assert.equal(parsePageCommand(JSON.stringify(command), "http://127.0.0.1:5191"), null);
}

assert.equal(parsePageCommand({
  version: BRIDGE_VERSION,
  type: "start",
  channelNonce: nonce,
  sessionId: "visual-session-1",
  limits: { ...limits, maxScrolls: 6 },
  artifactUploadEnabled: false
}, "http://127.0.0.1:5191"), null);

const ready = {
  version: BRIDGE_VERSION,
  type: "ready",
  channelNonce: nonce,
  extensionVersion: "1.0.0"
} as const;
assert.deepEqual(parseExtensionEvent(ready), ready);
assert.equal(parseExtensionEvent({ ...ready, channelNonce: "raw-nonce-not-64" }), null);
assert.deepEqual(parseExtensionEvent({
  version: BRIDGE_VERSION,
  type: "terminal",
  channelNonce: nonce,
  sessionId: "visual-session-1",
  status: "aborted",
  errorCodes: ["visual_reader_user_takeover"]
}), {
  version: BRIDGE_VERSION,
  type: "terminal",
  channelNonce: nonce,
  sessionId: "visual-session-1",
  status: "aborted",
  errorCodes: ["visual_reader_user_takeover"]
});
assert.equal(parseExtensionEvent({ ...ready, cookie: "secret" }), null);

console.log("douyin visual reader protocol self-test passed");
