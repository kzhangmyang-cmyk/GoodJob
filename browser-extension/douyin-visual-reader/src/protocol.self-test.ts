import { strict as assert } from "node:assert";
import {
  BRIDGE_VERSION,
  isObservation,
  parseExtensionEvent,
  parsePageCommand
} from "./protocol";
import { isVisualObservationSubmission } from "../../../src/acquisition/visual-reader-api";

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

const validObservation = {
  clientObservationKey: `dom:${"1".repeat(64)}`,
  sourceUrl: "https://www.douyin.com/video/123456789",
  videoId: "123456789",
  visibleText: "正".repeat(2_000),
  displayName: "林经理",
  visibleTimeText: "1小时前",
  likeCount: 12,
  replyCount: 3,
  platformCommentId: "987654321",
  publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
  secUid: "MS4wLjABAAAA",
  extractionMethod: "dom",
  fieldConfidences: { visibleText: 0.99 },
  viewport: { width: 8192, height: 8192, deviceScaleFactor: 2 },
  cardBounds: { x: 0, y: 0, width: 8192, height: 8192 },
  readerVersion: "goodjob-visual-reader/1.0.0",
  capturedAt: "2026-08-15T08:00:00.000Z",
  redactedCrop: null
} as const;

assert.equal(isVisualObservationSubmission(validObservation, false), true);
assert.equal(isObservation(validObservation), true, "2,000 visible characters are accepted across both layers");

const invalidContractCases: Array<[string, unknown]> = [
  ["2,001 visible characters", { ...validObservation, visibleText: "正".repeat(2_001) }],
  ["whitespace-only visible text", { ...validObservation, visibleText: "   " }],
  ["missing visibleText confidence", { ...validObservation, fieldConfidences: {} }],
  ["viewport beyond 8,192", {
    ...validObservation,
    viewport: { ...validObservation.viewport, width: 8193 }
  }],
  ["bounds beyond 8,192", {
    ...validObservation,
    cardBounds: { ...validObservation.cardBounds, x: 8193 }
  }],
  ["non-public comment ID", { ...validObservation, platformCommentId: "comment-private" }],
  ["invalid secUid", { ...validObservation, secUid: "bad uid" }],
  ["profile/secUid mismatch", { ...validObservation, secUid: "different" }],
  ["count beyond signed int", { ...validObservation, likeCount: 2_147_483_648 }],
  ["whitespace-only reader version", { ...validObservation, readerVersion: "   " }]
];

for (const [name, candidate] of invalidContractCases) {
  assert.equal(isVisualObservationSubmission(candidate, false), false, `${name} is rejected by Task 4`);
  assert.equal(isObservation(candidate), false, `${name} is rejected by the extension protocol`);
}

console.log("douyin visual reader protocol self-test passed");
