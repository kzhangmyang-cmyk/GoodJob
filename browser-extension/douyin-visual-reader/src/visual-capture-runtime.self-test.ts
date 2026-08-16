import { strict as assert } from "node:assert";
import {
  createVisualCaptureRuntime,
  type VisualCaptureRuntimeDependencies
} from "./visual-capture-runtime";
import type { VisualCaptureRequest } from "./visual-capture-guard";

const request: VisualCaptureRequest = {
  kind: "visual_capture_request",
  sessionId: "session-capture",
  domTextState: "missing",
  viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
  cardBounds: { x: 600, y: 200, width: 400, height: 180 },
  avatarBounds: { x: 620, y: 220, width: 48, height: 48 },
  visibleRegions: [{ x: 690, y: 220, width: 240, height: 80 }]
};

const evidence = {
  mediaType: "image/webp" as const,
  contentBase64: "UklGRg==",
  width: 800,
  height: 360,
  redactionProof: {
    version: "opaque-rect-v1" as const,
    maskColorRgba: [17, 61, 51, 255] as [17, 61, 51, 255],
    avatarBounds: { x: 40, y: 40, width: 96, height: 96 },
    visibleRegions: [{ x: 180, y: 40, width: 480, height: 160 }],
    maskedRegions: [{ x: 0, y: 0, width: 180, height: 360 }]
  },
  ocrResult: {
    text: "本地 OCR 可见正文",
    confidence: 0.96,
    words: [{
      text: "OCR",
      confidence: 0.98,
      bounds: { x: 180, y: 40, width: 80, height: 40 }
    }]
  }
};

function dependencies(overrides: Partial<VisualCaptureRuntimeDependencies> = {}) {
  const calls: string[] = [];
  let authorizations = 0;
  const deps: VisualCaptureRuntimeDependencies = {
    authorize: async () => {
      authorizations += 1;
      calls.push(`authorize:${authorizations}`);
      return request;
    },
    ensureOffscreen: async () => { calls.push("offscreen"); },
    reserveOcrCall: async () => { calls.push("reserve"); return true; },
    captureVisibleTab: async () => {
      calls.push("capture");
      return "data:image/png;base64,iVBORw0KGgo=";
    },
    processOffscreen: async (message) => {
      calls.push("process");
      assert.deepEqual(Object.keys(message).sort(), [
        "avatarBounds", "cardBounds", "domTextState", "kind", "screenshotDataUrl",
        "sessionId", "viewport", "visibleRegions"
      ]);
      assert.equal(message.kind, "visual_process_capture");
      return { accepted: true, evidence };
    },
    endOffscreenSession: async () => { calls.push("end"); return true; },
    ...overrides
  };
  return { deps, calls };
}

{
  const { deps, calls } = dependencies();
  const runtime = createVisualCaptureRuntime(deps);
  const result = await runtime.handle(request, 41);
  assert.deepEqual(result, { accepted: true, evidence });
  assert.deepEqual(calls, [
    "authorize:1", "offscreen", "authorize:2", "reserve", "authorize:3", "capture", "process"
  ], "authorization is repeated after reservation immediately before the only raw screenshot capture");
  await runtime.endSession();
  assert.equal(calls.at(-1), "end");
}

for (const [name, overrides] of [
  ["not authorized", { authorize: async () => null }],
  ["budget race", {
    authorize: (() => {
      let calls = 0;
      return async () => (++calls === 1 ? request : null);
    })()
  }],
  ["focus race after reservation", {
    authorize: (() => {
      let calls = 0;
      return async () => (++calls < 3 ? request : null);
    })()
  }],
  ["reservation rejected", { reserveOcrCall: async () => false }]
] as const) {
  let captures = 0;
  const { deps } = dependencies({
    ...overrides,
    captureVisibleTab: async () => {
      captures += 1;
      return "data:image/png;base64,forbidden";
    }
  });
  const result = await createVisualCaptureRuntime(deps).handle(request, 41);
  assert.deepEqual(result, { accepted: false }, name);
  assert.equal(captures, 0, `${name} never captures`);
}

{
  let active = 0;
  let maximum = 0;
  const { deps } = dependencies({
    processOffscreen: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { accepted: true, evidence };
    }
  });
  const runtime = createVisualCaptureRuntime(deps);
  await Promise.all([runtime.handle(request, 41), runtime.handle(request, 41)]);
  assert.equal(maximum, 1, "capture/OCR ownership is serialized per service worker");
}

{
  const { deps } = dependencies({
    processOffscreen: async () => ({
      accepted: true,
      evidence: { ...evidence, contentBase64: "raw comment text must not pass" }
    })
  });
  assert.deepEqual(await createVisualCaptureRuntime(deps).handle(request, 41), { accepted: false },
    "the service worker rejects malformed offscreen evidence before content sees it");
}

console.log("visual capture runtime self-test passed");
