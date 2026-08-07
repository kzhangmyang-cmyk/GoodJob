import { strict as assert } from "node:assert";
import {
  createPlanDraftWorkflow,
  type PlanDraftWorkflowApi
} from "./plan-draft-workflow";
import type { DouyinPlanInput } from "./task-creation-api";

const planDraft: DouyinPlanInput = {
  targetPlatform: "douyin" as const,
  name: "<厦门>企业服务获客",
  objective: "找到公开表达采购需求的企业和老板",
  icp: {
    industries: ["企业服务", "装修"],
    regions: ["厦门", "泉州"],
    organizationCriteria: ["公开询价", "寻找供应商"],
    individualCriteria: ["老板账号", "合作需求"],
    exclusionRules: ["明确拒绝联系"]
  },
  subjectChannels: { organization: true, individual: true },
  providerConnections: [
    { connectionId: "search-a", providerId: "brave", kind: "search" as const, status: "active" as const, credentialVersion: 1 },
    { connectionId: "search-b", providerId: "serper", kind: "search" as const, status: "active" as const, credentialVersion: 2 }
  ],
  operations: [
    { operationId: "a-org", subjectChannel: "organization" as const, kind: "search" as const, connectionId: "search-a", query: "site:douyin.com 企业服务 采购", allocatedBudget: { requests: 2, results: 10, amountMinor: 0, durationSeconds: 30 } },
    { operationId: "a-person", subjectChannel: "individual" as const, kind: "search" as const, connectionId: "search-a", query: "site:iesdouyin.com 老板 询价", allocatedBudget: { requests: 2, results: 10, amountMinor: 0, durationSeconds: 30 } },
    { operationId: "b-org", subjectChannel: "organization" as const, kind: "search" as const, connectionId: "search-b", query: "site:douyin.com 装修 找供应商", allocatedBudget: { requests: 2, results: 10, amountMinor: 0, durationSeconds: 30 } },
    { operationId: "b-person", subjectChannel: "individual" as const, kind: "search" as const, connectionId: "search-b", query: "site:iesdouyin.com 老板 合作", allocatedBudget: { requests: 2, results: 10, amountMinor: 0, durationSeconds: 30 } }
  ],
  budgetSnapshot: { billingCurrency: "CNY", maxRequests: 8, maxResults: 40, maxAmountMinor: 0, maxDurationSeconds: 120 },
  modelConnectionId: "model-a",
  stopConditions: { stopWhenBudgetExhausted: true, stopWhenNoMoreResults: true }
};

const persisted = new Map<string, string>();
const storageWrites: string[] = [];
const calls: Array<{ name: string; value?: unknown }> = [];
let polls = 0;
const api: PlanDraftWorkflowApi = {
  async createCopilotSession(input, idempotencyKey) {
    calls.push({ name: "session", value: { input, idempotencyKey } });
    return { id: "session-a" };
  },
  async createPlanDraftTask(sessionId, input, idempotencyKey) {
    calls.push({ name: "task", value: { sessionId, input, idempotencyKey } });
    return { id: "task-a", status: "queued", result: null };
  },
  async getCopilotTask(taskId) {
    calls.push({ name: "poll", value: taskId });
    polls += 1;
    return polls === 1
      ? { id: taskId, status: "running", result: null, errorCode: null }
      : { id: taskId, status: "succeeded", result: { summary: "已生成", planDraft }, errorCode: null };
  }
};

const workflow = createPlanDraftWorkflow(api, {
  storage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => {
      storageWrites.push(value);
      persisted.set(key, value);
    },
    removeItem: (key) => persisted.delete(key)
  },
  idempotencyKeyFactory: (() => {
    let index = 0;
    return () => `plan-draft-key-${++index}`;
  })(),
  sleep: async () => undefined,
  now: (() => {
    let current = 0;
    return () => current += 50;
  })()
});

const result = await workflow.generate({
  modelConnectionId: "model-a",
  prompt: "帮我找厦门企业服务和装修行业的抖音公开商机"
});

assert.equal(result.planDraft.providerConnections.length, 2);
assert.equal(result.planDraft.operations.length, 4);
assert.deepEqual(result.planDraft.operations.map((operation) => operation.query), planDraft.operations.map((operation) => operation.query));
assert.equal(calls[0]?.name, "session");
assert.deepEqual(calls[0]?.value, {
  input: { connectionId: "model-a" },
  idempotencyKey: "plan-draft-key-1"
});
assert.deepEqual(calls[1]?.value, {
  sessionId: "session-a",
  input: {
    message: "帮我找厦门企业服务和装修行业的抖音公开商机",
    responseMode: "plan_draft",
    targetPlatform: "douyin"
  },
  idempotencyKey: "plan-draft-key-2"
});
assert.equal(JSON.stringify(calls).includes("modelSnapshotRef"), false);
assert.equal(polls, 2);
const saved = storageWrites[0] ?? "";
assert.match(saved, /session-a/);
assert.match(saved, /task-a/);
assert.match(saved, /model-a/);
assert.match(saved, /厦门企业服务/);
assert.equal(saved.includes("providerConnections"), false);
assert.equal(saved.includes("operations"), false);

let timeoutPolls = 0;
const timeoutWorkflow = createPlanDraftWorkflow({
  ...api,
  async getCopilotTask(taskId) {
    timeoutPolls += 1;
    return { id: taskId, status: "running", result: null, errorCode: null };
  }
}, {
  storage: null,
  sleep: async () => undefined,
  now: (() => {
    let current = 0;
    return () => current += 61_000;
  })()
});
await assert.rejects(
  () => timeoutWorkflow.generate({ modelConnectionId: "model-a", prompt: "生成计划" }),
  /120 秒/
);
assert.equal(timeoutPolls > 0, true);
