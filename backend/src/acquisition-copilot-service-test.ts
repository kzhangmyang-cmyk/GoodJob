import assert from "node:assert/strict";
import type {
  AgentMessage
} from "@earendil-works/pi-agent-core";
import {
  AcquisitionCopilotError,
  AcquisitionCopilotService,
  InMemoryAcquisitionCopilotRepository,
  type AcquisitionCopilotRunInput
} from "./acquisition-copilot-service.js";

const repository = new InMemoryAcquisitionCopilotRepository();
const runs: AcquisitionCopilotRunInput[] = [];
let releaseRun: (() => void) | undefined;
const waitForRelease = new Promise<void>((resolve) => {
  releaseRun = resolve;
});

const service = new AcquisitionCopilotService({
  repository,
  idempotencySecret:
    "copilot-idempotency-test-secret-at-least-32-characters",
  runner: {
    async run(input) {
      runs.push(input);
      if (input.prompt === "并发测试") await waitForRelease;
      if (input.prompt === "触发失败") {
        throw new Error("MODEL_RATE_LIMITED apiKey=must-not-leak");
      }
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: input.prompt,
          timestamp: Date.parse("2026-07-24T01:00:00.000Z")
        },
        {
          role: "assistant",
          content: [{
            type: "text",
            text: `已分析：${input.prompt}`
          }],
          api: "goodjob-gateway",
          provider: input.snapshot.provider,
          model: input.snapshot.model,
          usage: {
            input: 10,
            output: 8,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            totalTokens: 18,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0
            }
          },
          stopReason: "stop",
          timestamp: Date.parse("2026-07-24T01:00:01.000Z")
        }
      ];
      return {
        newMessages: messages,
        result: {
          summary: `已分析：${input.prompt}`,
          toolNames: []
        }
      };
    }
  },
  idFactory: (() => {
    let sequence = 0;
    return (prefix) => `${prefix}-${++sequence}`;
  })(),
  now: (() => {
    let timestamp = Date.parse("2026-07-24T00:00:00.000Z");
    return () => new Date(timestamp++).toISOString();
  })()
});

const scope = {
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "owner-a"
};
const snapshot = {
  jobId: "job-a",
  connectionId: "connection-a",
  credentialVersion: 2,
  provider: "qwen" as const,
  model: "qwen-plus",
  promptVersion: "acquisition-copilot-v1",
  schemaVersion: "copilot-turn.v1",
  capabilitySnapshotHash: "capability-hash",
  baseUrlFingerprint: "base-url-hash"
};

const created = await service.createSession(
  scope,
  snapshot,
  "create-session-a"
);
const replayed = await service.createSession(
  scope,
  snapshot,
  "create-session-a"
);
assert.equal(created.id, replayed.id);
assert.equal(created.status, "active");
assert.equal(created.modelSnapshot.credentialVersion, 2);
assert.equal(
  JSON.stringify(created).includes("apiKey"),
  false,
  "session snapshots must never persist credentials"
);

await assert.rejects(
  service.createSession(
    scope,
    { ...snapshot, model: "qwen-max" },
    "create-session-a"
  ),
  (error: unknown) =>
    error instanceof AcquisitionCopilotError
    && error.code === "idempotency_conflict"
);

const queued = await service.enqueueMessage(
  scope,
  created.id,
  "分析今天最值得跟进的客户",
  "message-a"
);
const queuedReplay = await service.enqueueMessage(
  scope,
  created.id,
  "分析今天最值得跟进的客户",
  "message-a"
);
assert.equal(queued.id, queuedReplay.id);
assert.equal(queued.status, "queued");

const succeeded = await service.runTask(scope, queued.id);
assert.equal(succeeded.status, "succeeded");
assert.equal(succeeded.result?.summary, "已分析：分析今天最值得跟进的客户");
assert.equal(runs.length, 1);
assert.equal(runs[0]?.snapshot.connectionId, "connection-a");
assert.deepEqual(runs[0]?.transcript, []);
assert.equal((await service.listMessages(scope, created.id)).length, 2);
assert.equal(
  (await service.runTask(scope, queued.id)).id,
  queued.id,
  "terminal tasks must replay without running the model again"
);
assert.equal(runs.length, 1);

await assert.rejects(
  service.getSession(
    { ownerId: "owner-b", teamId: "team-a", actorId: "owner-b" },
    created.id
  ),
  (error: unknown) =>
    error instanceof AcquisitionCopilotError
    && error.code === "resource_not_found"
);

const concurrentTask = await service.enqueueMessage(
  scope,
  created.id,
  "并发测试",
  "message-concurrent"
);
const concurrentOne = service.runTask(scope, concurrentTask.id);
const concurrentTwo = service.runTask(scope, concurrentTask.id);
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(
  runs.filter((item) => item.prompt === "并发测试").length,
  1,
  "only one worker may claim a queued task"
);
releaseRun?.();
const concurrentResults = await Promise.all([concurrentOne, concurrentTwo]);
assert.deepEqual(
  concurrentResults.map((item) => item.status),
  ["succeeded", "succeeded"]
);

const failedTask = await service.enqueueMessage(
  scope,
  created.id,
  "触发失败",
  "message-failure"
);
const failed = await service.runTask(scope, failedTask.id);
assert.equal(failed.status, "failed");
assert.equal(failed.errorCode, "MODEL_RATE_LIMITED");
assert.equal(JSON.stringify(failed).includes("must-not-leak"), false);

const completed = await service.completeSession(
  scope,
  created.id,
  "complete-session-a"
);
assert.equal(completed.status, "completed");
await assert.rejects(
  service.enqueueMessage(
    scope,
    created.id,
    "完成后不能继续",
    "message-after-complete"
  ),
  (error: unknown) =>
    error instanceof AcquisitionCopilotError
    && error.code === "invalid_state"
);

console.log("acquisition copilot service tests passed");
