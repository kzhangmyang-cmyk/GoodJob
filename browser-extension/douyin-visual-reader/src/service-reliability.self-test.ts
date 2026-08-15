import { strict as assert } from "node:assert";
import { createSessionCoordinator, type VisualReaderPersistedState } from "./session-coordinator";
import { createReliableEventTransport } from "./runtime-transport";
import { BRIDGE_VERSION, type ExtensionEvent } from "./protocol";

const limits = {
  maxVideos: 1,
  maxCommentsPerVideo: 30,
  maxScrolls: 5,
  maxOcrCalls: 0,
  maxDurationMs: 120_000
};

{
  const writes: VisualReaderPersistedState[] = [];
  const coordinator = createSessionCoordinator({
    persist: async (state) => { writes.push(structuredClone(state)); },
    log: () => undefined,
    nonceHash: async () => `sha256:${"1".repeat(64)}`
  });
  await coordinator.authorizeFromGoodJob({
    goodJobTabId: 10,
    channelNonce: "a".repeat(64),
    sessionId: "session-replay",
    limits,
    artifactUploadEnabled: false
  });
  assert.equal(await coordinator.confirmDouyinTab(20, 7, "https://www.douyin.com/video/123"), true);
  assert.equal(coordinator.receiveBatch("batch-stable"), "new");
  assert.equal(coordinator.receiveBatch("batch-stable"), "replay");
  assert.equal(coordinator.receiveBatch("batch-other"), "blocked");
  assert.equal(coordinator.canAcknowledgeBatch("session-replay", "batch-stable"), true);
  assert.equal(coordinator.canAcknowledgeBatch("session-replay", "wrong"), false);
  assert.equal(coordinator.commitAcknowledgedBatch("session-replay", "wrong"), false);
  assert.equal(coordinator.snapshot().pendingBatchId, "batch-stable");
  assert.equal(coordinator.commitAcknowledgedBatch("session-replay", "batch-stable"), true);
  assert.equal(coordinator.snapshot().pendingBatchId, null);
  assert.ok(writes.every((state) => !("pendingBatchId" in state)));

  assert.equal(coordinator.receiveBatch("batch-before-terminal"), "new");
  await coordinator.finish("partial_success");
  assert.equal(coordinator.snapshot().pendingBatchId, null, "terminal abandons pending ACK without interlock");
}

class ManualRetries {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();
  schedule = (callback: () => void): number => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (handle: unknown): void => {
    if (typeof handle === "number") this.callbacks.delete(handle);
  };
  runNext(): void {
    const next = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!next) throw new Error("missing retry");
    this.callbacks.delete(next[0]);
    next[1]();
  }
  pending(): number { return this.callbacks.size; }
}

class ManualClock {
  now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  schedule = (callback: () => void, delay: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };

  cancel = (handle: unknown): void => {
    if (typeof handle === "number") this.timers.delete(handle);
  };

  advance(milliseconds: number): void {
    this.now += milliseconds;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.now)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }

  pending(): number { return this.timers.size; }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

{
  const retries = new ManualRetries();
  const attempts: ExtensionEvent[] = [];
  const terminal: ExtensionEvent = {
    version: BRIDGE_VERSION,
    type: "terminal",
    channelNonce: "b".repeat(64),
    sessionId: "session-terminal",
    status: "aborted",
    errorCodes: ["visual_reader_user_takeover"]
  };
  const transport = createReliableEventTransport({
    maxTerminalAttempts: 3,
    retryDelayMs: 10,
    scheduleTimeout: retries.schedule,
    cancelTimeout: retries.cancel,
    send: async (event) => {
      attempts.push(structuredClone(event));
      if (attempts.length === 1) return { accepted: false };
      if (attempts.length === 2) throw new Error("service worker restarted");
      return { accepted: true };
    }
  });
  transport.queueTerminal(terminal);
  await flush();
  retries.runNext();
  await flush();
  retries.runNext();
  await flush();
  await transport.whenIdle();
  assert.deepEqual(attempts, [terminal, terminal, terminal]);
  assert.equal(retries.pending(), 0);
  transport.close();
}

{
  const retries = new ManualRetries();
  let attempts = 0;
  const transport = createReliableEventTransport({
    maxTerminalAttempts: 2,
    attemptTimeoutMs: 5,
    retryDelayMs: 5,
    scheduleTimeout: retries.schedule,
    cancelTimeout: retries.cancel,
    send: async () => {
      attempts += 1;
      return new Promise(() => undefined);
    }
  });
  transport.queueTerminal({
    version: BRIDGE_VERSION,
    type: "terminal",
    channelNonce: "c".repeat(64),
    sessionId: "session-hung-terminal",
    status: "partial_success",
    errorCodes: ["visual_reader_budget_exhausted"]
  });
  await flush();
  retries.runNext();
  await flush();
  retries.runNext();
  await flush();
  retries.runNext();
  await flush();
  await transport.whenIdle();
  assert.equal(attempts, 2, "a hung runtime send is bounded and retried exactly");
  assert.equal(retries.pending(), 0);
}

{
  const clock = new ManualClock();
  let attempts = 0;
  const transport = createReliableEventTransport({
    deadlineAt: 20,
    now: () => clock.now,
    retryDelayMs: 10,
    maxTerminalAttempts: 5,
    scheduleTimeout: clock.schedule,
    cancelTimeout: clock.cancel,
    send: async () => {
      attempts += 1;
      return { accepted: false };
    }
  });
  transport.queueTerminal({
    version: BRIDGE_VERSION,
    type: "terminal",
    channelNonce: "d".repeat(64),
    sessionId: "session-terminal-deadline",
    status: "partial_success",
    errorCodes: ["visual_reader_budget_exhausted"]
  });
  await flush();
  clock.advance(10);
  await flush();
  clock.advance(10);
  await flush();
  assert.equal(attempts, 2, "terminal retry shares the session absolute deadline and never sends after it");
  await transport.whenIdle();
  assert.equal(clock.pending(), 0, "deadline cleanup cancels every terminal retry timer");
}

console.log("douyin service reliability self-test passed");
