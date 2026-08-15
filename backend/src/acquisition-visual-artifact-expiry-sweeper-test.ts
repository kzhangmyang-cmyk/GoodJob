import assert from "node:assert/strict";
import test from "node:test";
import {
  AcquisitionVisualArtifactExpirySweeper
} from "./acquisition-visual-artifact-expiry-sweeper.js";

test("artifact expiry sweeper starts immediately, bounds deletion, unrefs, and closes", async () => {
  const calls: Array<{ before: string; limit: number }> = [];
  const timers: Array<() => void> = [];
  let unrefCount = 0;
  let clearCount = 0;
  const sweeper = new AcquisitionVisualArtifactExpirySweeper({
    repository: {
      async deleteExpiredArtifacts(input) {
        calls.push(input);
        return 0;
      }
    },
    now: () => "2026-08-15T01:00:00.000Z",
    intervalMs: 1_000,
    batchSize: 100,
    setTimer(callback) {
      timers.push(callback);
      return { unref() { unrefCount += 1; } };
    },
    clearTimer() { clearCount += 1; }
  });

  await sweeper.start();
  await sweeper.start();
  assert.deepEqual(calls, [{
    before: "2026-08-15T01:00:00.000Z",
    limit: 100
  }]);
  assert.equal(timers.length, 1);
  assert.equal(unrefCount, 1);

  timers.shift()!();
  await sweeper.whenIdle();
  assert.equal(calls.length, 2);
  assert.equal(timers.length, 1);

  const staleCallback = timers.shift()!;
  await sweeper.close();
  await sweeper.close();
  assert.equal(clearCount, 1);
  staleCallback();
  await sweeper.whenIdle();
  assert.equal(calls.length, 2);
});

test("artifact expiry sweeper isolates failures using only a stable report", async () => {
  const reports: unknown[] = [];
  const timers: Array<() => void> = [];
  let calls = 0;
  const sweeper = new AcquisitionVisualArtifactExpirySweeper({
    repository: {
      async deleteExpiredArtifacts() {
        calls += 1;
        if (calls === 1) {
          throw new Error(
            "must-not-report: image bytes, visible text, URL, secUid, displayName"
          );
        }
        return 0;
      }
    },
    now: () => "2026-08-15T01:00:00.000Z",
    intervalMs: 1_000,
    setTimer(callback) {
      timers.push(callback);
      return { unref() {} };
    },
    clearTimer() {},
    onError(report) { reports.push(report); }
  });

  await sweeper.start();
  assert.deepEqual(reports, [{
    code: "ACQUISITION_VISUAL_ARTIFACT_EXPIRY_SWEEP_FAILED",
    attemptedLimit: 100
  }]);
  assert.equal(
    JSON.stringify(reports).includes("must-not-report"),
    false
  );
  timers.shift()!();
  await sweeper.whenIdle();
  assert.equal(calls, 2);
  await sweeper.close();
});

test("artifact expiry sweeper validates bounds and has bounded close", async () => {
  for (const options of [
    { intervalMs: 999 },
    { intervalMs: 86_400_001 },
    { batchSize: 0 },
    { batchSize: 101 }
  ]) {
    assert.throws(() => new AcquisitionVisualArtifactExpirySweeper({
      repository: { async deleteExpiredArtifacts() { return 0; } },
      ...options
    }), /intervalMs|batchSize/u);
  }

  let release: (() => void) | undefined;
  const sweeper = new AcquisitionVisualArtifactExpirySweeper({
    repository: {
      deleteExpiredArtifacts() {
        return new Promise<number>((resolve) => { release = () => resolve(0); });
      }
    },
    intervalMs: 1_000,
    closeTimeoutMs: 10,
    setTimer() { return { unref() {} }; },
    clearTimer() {}
  });
  const start = sweeper.start();
  while (!release) await Promise.resolve();
  await assert.rejects(
    sweeper.close(),
    /ACQUISITION_VISUAL_ARTIFACT_EXPIRY_SWEEPER_CLOSE_TIMEOUT/u
  );
  release();
  await start;
});
