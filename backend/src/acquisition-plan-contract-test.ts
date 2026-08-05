import assert from "node:assert/strict";
import test from "node:test";
import {
  acquisitionPublicPlanCreateSchema,
  type AcquisitionPublicPlanCreateInput
} from "./acquisition-plan-contract.js";

const modelSnapshotRef = {
  jobSnapshotId: "snapshot-1",
  connectionId: "model-connection-1",
  credentialVersion: 1,
  provider: "moonshot",
  model: "kimi-k3",
  capabilitySnapshotHash: "sha256:capabilities",
  promptVersion: "acquisition.v1",
  schemaVersion: "acquisition-plan.v1",
  promptHash: "sha256:prompt",
  schemaHash: "sha256:schema"
};

function publicPlanInput(): AcquisitionPublicPlanCreateInput {
  return {
    name: "全国通用 AI 获客计划",
    objective: "同时发现组织和个人公开商机",
    icp: {
      industries: ["企业服务"],
      regions: ["中国大陆"],
      organizationCriteria: ["存在公开采购或增长信号"],
      individualCriteria: ["公开表达经营需求"],
      exclusionRules: ["明确拒绝联系"]
    },
    subjectChannels: { organization: true, individual: true },
    providerConnections: [{
      connectionId: "search-baidu",
      providerId: "baidu-ai-search",
      kind: "search",
      status: "active",
      credentialVersion: 1
    }],
    operations: [{
      operationId: "organization-search",
      subjectChannel: "organization",
      kind: "search",
      connectionId: "search-baidu",
      query: "招聘销售 OR 寻找供应商",
      allocatedBudget: {
        requests: 2,
        results: 20,
        amountMinor: 200,
        durationSeconds: 120
      }
    }],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 2,
      maxResults: 20,
      maxAmountMinor: 200,
      maxDurationSeconds: 120
    },
    modelConnectionId: "model-connection-1",
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    }
  };
}

test("public plan create accepts model connection, ICP, operations, and budget", () => {
  const input = publicPlanInput();

  assert.deepEqual(acquisitionPublicPlanCreateSchema.parse(input), input);
});

test("public plan create accepts an explicit acquisition target platform", () => {
  const input = {
    ...publicPlanInput(),
    targetPlatform: "douyin" as const
  };

  assert.deepEqual(acquisitionPublicPlanCreateSchema.parse(input), input);
});

test("public plan create rejects unsupported acquisition target platforms", () => {
  assert.throws(
    () => acquisitionPublicPlanCreateSchema.parse({
      ...publicPlanInput(),
      targetPlatform: "xiaohongshu"
    }),
    /Invalid enum value/
  );
});

test("public plan create rejects client supplied model snapshot", () => {
  assert.throws(
    () => acquisitionPublicPlanCreateSchema.parse({
      ...publicPlanInput(),
      modelSnapshotRef
    }),
    /Unrecognized key\(s\) in object: 'modelSnapshotRef'/
  );
});

test("public plan create rejects extra operation fields", () => {
  const input = publicPlanInput();

  assert.throws(
    () => acquisitionPublicPlanCreateSchema.parse({
      ...input,
      operations: [{ ...input.operations[0], untrusted: true }]
    }),
    /Unrecognized key\(s\) in object: 'untrusted'/
  );
});
