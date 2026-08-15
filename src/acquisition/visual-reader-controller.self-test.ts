import { strict as assert } from "node:assert";
import type {
  VisualObservationBatchResponse,
  VisualObservationSubmission,
  VisualReaderApi,
  VisualReaderSession
} from "./visual-reader-api";
import type {
  VisualReaderBridge,
  VisualReaderBridgeHandlers,
  VisualReaderExtensionEvent
} from "./visual-reader-bridge";
import {
  createVisualReaderController,
  type AuthorizedVisualReaderProjection
} from "./visual-reader-controller";

const timestamp = "2026-08-15T08:00:00.000Z";

function session(overrides: Partial<VisualReaderSession> = {}): VisualReaderSession {
  return {
    sessionId: "visual-session-1",
    runId: "run-1",
    planId: "plan-1",
    planVersionId: "plan-version-1",
    platform: "douyin",
    coverage: "authorized_visible_top_level_sample",
    status: "collecting",
    artifactUploadEnabled: true,
    limits: {
      maxVideos: 10,
      maxCommentsPerVideo: 30,
      maxScrolls: 5,
      maxOcrCalls: 10,
      maxDurationMs: 120_000
    },
    usage: {
      videoCount: 1,
      observationCount: 1,
      scrollCount: 1,
      ocrCallCount: 0,
      domObservationCount: 1,
      accessibilityObservationCount: 0,
      ocrObservationCount: 0,
      lowConfidenceObservationCount: 0,
      artifactCount: 0
    },
    outcome: null,
    lastErrorCode: null,
    createdAt: timestamp,
    authorizedAt: timestamp,
    updatedAt: timestamp,
    expiresAt: "2026-08-15T08:02:00.000Z",
    completedAt: null,
    ...overrides
  };
}

function terminalSession(
  status: "completed" | "partial_success" | "aborted"
): VisualReaderSession {
  return session({
    status,
    completedAt: "2026-08-15T08:01:00.000Z",
    outcome: {
      status,
      videoCount: 1,
      observationCount: 1,
      domObservationCount: 1,
      accessibilityObservationCount: 0,
      ocrObservationCount: 0,
      lowConfidenceObservationCount: 0,
      artifactCount: 0,
      errorCodes: status === "partial_success"
        ? ["visual_extraction_low_confidence"]
        : []
    }
  });
}

function observation(
  key = "client-observation-1",
  overrides: Partial<VisualObservationSubmission> = {}
): VisualObservationSubmission {
  return {
    clientObservationKey: key,
    sourceUrl: "https://www.douyin.com/video/123456789",
    videoId: "123456789",
    visibleText: "想了解企业获客方案",
    displayName: "林经理",
    visibleTimeText: "1小时前",
    likeCount: 2,
    replyCount: 0,
    platformCommentId: "987654321",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    secUid: "MS4wLjABAAAA",
    extractionMethod: "dom",
    fieldConfidences: { visibleText: 0.99 },
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    cardBounds: { x: 720, y: 220, width: 520, height: 140 },
    readerVersion: "goodjob-visual-reader/1.0.0",
    capturedAt: timestamp,
    redactedCrop: null,
    ...overrides
  };
}

function crop() {
  return {
    mediaType: "image/webp" as const,
    contentBase64: "AAAA",
    redactionProof: {
      version: "opaque-rect-v1" as const,
      maskColorRgba: [17, 61, 51, 255] as [17, 61, 51, 255],
      avatarBounds: { x: 0, y: 0, width: 20, height: 20 },
      visibleRegions: [{ x: 24, y: 0, width: 200, height: 60 }],
      maskedRegions: [{ x: 0, y: 0, width: 20, height: 20 }]
    }
  };
}

function projection(sessionId = "visual-session-1"): AuthorizedVisualReaderProjection {
  return {
    sessionId,
    coverage: "authorized_visible_top_level_sample",
    status: "collecting",
    usage: session().usage,
    lastErrorCode: null,
    visualSteps: []
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

class FakeBridge implements VisualReaderBridge {
  readonly channelNonce = "a".repeat(64);
  handlers: VisualReaderBridgeHandlers | null = null;
  readonly starts: Array<{
    sessionId: string;
    limits: VisualReaderSession["limits"];
    artifactUploadEnabled: boolean;
  }> = [];
  readonly acknowledgements: Array<{ sessionId: string; batchId: string }> = [];
  readonly aborts: string[] = [];
  destroyed = false;

  connect(handlers: VisualReaderBridgeHandlers): void {
    this.handlers = handlers;
    handlers.onAvailability("probing");
  }

  ready(): void {
    this.handlers?.onAvailability("ready");
    this.emit({
      version: "goodjob.visual-reader.bridge.v1",
      type: "ready",
      channelNonce: this.channelNonce,
      extensionVersion: "1.0.0"
    });
  }

  unavailable(): void {
    this.handlers?.onAvailability("unavailable");
  }

  emit(event: VisualReaderExtensionEvent): void {
    this.handlers?.onEvent(event);
  }

  startSession(
    sessionId: string,
    limits: VisualReaderSession["limits"],
    artifactUploadEnabled: boolean
  ): void {
    this.starts.push({ sessionId, limits, artifactUploadEnabled });
  }

  acknowledgeBatch(sessionId: string, batchId: string): void {
    this.acknowledgements.push({ sessionId, batchId });
  }

  abortSession(sessionId: string): void {
    this.aborts.push(sessionId);
  }

  destroy(): void {
    this.destroyed = true;
    this.handlers = null;
  }
}

function batchEvent(
  observations: VisualObservationSubmission[],
  batchId = "batch-1"
): VisualReaderExtensionEvent {
  return {
    version: "goodjob.visual-reader.bridge.v1",
    type: "observation_batch",
    channelNonce: "a".repeat(64),
    sessionId: "visual-session-1",
    batchId,
    observations
  };
}

{
  const bridge = new FakeBridge();
  let sessionReads = 0;
  const api = {
    async getSession() {
      sessionReads += 1;
      return session();
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({
    api,
    bridgeFactory: () => bridge,
    keyFactory: () => "key-1"
  });

  await controller.open({ planId: "plan-1", runId: "run-1", projection: undefined });
  assert.equal(sessionReads, 0, "legacy presentations without the optional field stay compatible");
  assert.equal(controller.getState().extensionStatus, "probing");
  bridge.unavailable();
  assert.equal(controller.getState().extensionStatus, "unavailable");
  assert.match(controller.getState().message ?? "", /未检测到/u);
  controller.close();
  assert.equal(bridge.destroyed, true);
}

{
  const bridge = new FakeBridge();
  const api = {
    async getSession() {
      return session();
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({
    api,
    bridgeFactory: () => bridge,
    keyFactory: () => "key-1"
  });

  await controller.open({ planId: "plan-1", runId: "run-1", projection: projection() });
  assert.equal(controller.getState().session?.sessionId, "visual-session-1");
  assert.equal(bridge.starts.length, 0, "a recovered session waits for an authenticated ready event");
  bridge.ready();
  assert.equal(bridge.starts[0]?.sessionId, "visual-session-1");
  assert.deepEqual(bridge.starts[0]?.limits, session().limits);
  assert.equal(bridge.starts[0]?.artifactUploadEnabled, true);
  controller.destroy();
}

{
  const bridge = new FakeBridge();
  const created = session({ status: "created", usage: { ...session().usage, observationCount: 0 } });
  const api = {
    async createSession(input: unknown, key: string) {
      assert.deepEqual(input, { runId: "run-1", artifactUploadEnabled: true });
      assert.equal(key, "authorize-key");
      return created;
    },
    async getSession() {
      return created;
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({
    api,
    bridgeFactory: () => bridge,
    keyFactory: () => "authorize-key"
  });
  await controller.open({ planId: "plan-1", runId: "run-1" });
  await assert.rejects(() => controller.authorize(), /浏览器读取器/u);
  bridge.ready();
  await controller.authorize();
  assert.equal(controller.getState().session?.sessionId, "visual-session-1");
  assert.equal(bridge.starts.at(-1)?.sessionId, "visual-session-1");
  assert.equal(bridge.starts.at(-1)?.artifactUploadEnabled, true);
  controller.destroy();
}

{
  const bridge = new FakeBridge();
  const append = deferred<VisualObservationBatchResponse>();
  const batchKeys: string[] = [];
  const refreshes: string[] = [];
  let attempts = 0;
  const api = {
    async getSession() {
      return session();
    },
    appendObservationBatch(_sessionId: string, _input: unknown, key: string) {
      attempts += 1;
      batchKeys.push(key);
      if (attempts === 1) return append.promise;
      return Promise.resolve({ session: session(), accepted: [], duplicates: [] });
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({
    api,
    bridgeFactory: () => bridge,
    keyFactory: () => "stable-batch-key",
    onRequestPresentationRefresh: () => refreshes.push("refresh")
  });
  await controller.open({ planId: "plan-1", runId: "run-1", projection: projection() });
  bridge.ready();
  bridge.emit(batchEvent([observation()]));
  assert.equal(bridge.acknowledgements.length, 0, "the client queue is not cleared before persistence");
  assert.doesNotMatch(controller.getState().message ?? "", /已保存/u);
  append.reject(new TypeError("network unavailable"));
  await assert.rejects(() => controller.whenIdle(), /network unavailable/);
  assert.equal(bridge.acknowledgements.length, 0, "API failure never acknowledges the batch");
  assert.match(controller.getState().error ?? "", /网络|network/u);

  bridge.emit(batchEvent([observation()]));
  await controller.whenIdle();
  assert.deepEqual(batchKeys, ["stable-batch-key", "stable-batch-key"]);
  assert.deepEqual(bridge.acknowledgements, [{
    sessionId: "visual-session-1",
    batchId: "batch-1"
  }]);
  assert.match(controller.getState().message ?? "", /已保存/u);
  assert.deepEqual(refreshes, ["refresh"]);
  controller.destroy();
}

{
  const bridge = new FakeBridge();
  const submitted: VisualObservationSubmission[][] = [];
  const api = {
    async getSession() {
      return session({ artifactUploadEnabled: false });
    },
    async appendObservationBatch(
      _sessionId: string,
      input: { observations: VisualObservationSubmission[] }
    ) {
      submitted.push(input.observations);
      return { session: session({ artifactUploadEnabled: false }), accepted: [], duplicates: [] };
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({
    api,
    bridgeFactory: () => bridge,
    keyFactory: () => "batch-key"
  });
  await controller.open({ planId: "plan-1", runId: "run-1", projection: projection() });
  bridge.ready();
  assert.equal(bridge.starts[0]?.artifactUploadEnabled, false);
  bridge.emit(batchEvent([observation("crop-observation", { redactedCrop: crop() })]));
  await controller.whenIdle();
  assert.equal(submitted[0]?.[0]?.redactedCrop, null, "artifact-off mode strips every crop before API submission");
  controller.destroy();
}

{
  const bridge = new FakeBridge();
  let appendCalls = 0;
  const api = {
    async getSession() {
      return session();
    },
    async appendObservationBatch() {
      appendCalls += 1;
      return { session: session(), accepted: [], duplicates: [] };
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({ api, bridgeFactory: () => bridge });
  await controller.open({ planId: "plan-1", runId: "run-1", projection: projection() });
  bridge.ready();
  bridge.emit(batchEvent(Array.from({ length: 21 }, (_, index) => observation(`client-${index}`))));
  await controller.whenIdle();
  assert.equal(appendCalls, 0, "controller rechecks limits even when a bridge implementation is faulty");
  assert.match(controller.getState().error ?? "", /超过/u);
  controller.destroy();
}

{
  const bridge = new FakeBridge();
  const complete = deferred<VisualReaderSession>();
  const refreshes: string[] = [];
  const api = {
    async getSession() {
      return session();
    },
    completeSession() {
      return complete.promise;
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({
    api,
    bridgeFactory: () => bridge,
    keyFactory: () => "complete-key",
    onRequestPresentationRefresh: () => refreshes.push("refresh")
  });
  await controller.open({ planId: "plan-1", runId: "run-1", projection: projection() });
  bridge.ready();
  bridge.emit({
    version: "goodjob.visual-reader.bridge.v1",
    type: "terminal",
    channelNonce: bridge.channelNonce,
    sessionId: "visual-session-1",
    status: "completed",
    errorCodes: []
  });
  assert.equal(controller.getState().session?.status, "collecting", "extension terminal is not a success fact");
  complete.resolve(terminalSession("completed"));
  await controller.whenIdle();
  assert.equal(controller.getState().session?.status, "completed");
  assert.deepEqual(refreshes, ["refresh"]);
  controller.destroy();
}

{
  const bridge = new FakeBridge();
  const abort = deferred<VisualReaderSession>();
  let abortReason: unknown;
  const api = {
    async getSession() {
      return session();
    },
    abortSession(_sessionId: string, input: unknown) {
      abortReason = input;
      return abort.promise;
    }
  } as unknown as VisualReaderApi;
  const controller = createVisualReaderController({
    api,
    bridgeFactory: () => bridge,
    keyFactory: () => "abort-key"
  });
  await controller.open({ planId: "plan-1", runId: "run-1", projection: projection() });
  bridge.ready();
  const stopping = controller.stop();
  assert.deepEqual(bridge.aborts, ["visual-session-1"]);
  assert.equal(controller.getState().session?.status, "collecting");
  abort.resolve(terminalSession("aborted"));
  await stopping;
  assert.deepEqual(abortReason, { reasonCode: "user_requested" });
  assert.equal(controller.getState().session?.status, "aborted");
  controller.close();
  assert.deepEqual(bridge.aborts, ["visual-session-1"], "page close does not abort the server session");
}
