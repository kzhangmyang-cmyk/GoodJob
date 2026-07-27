import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AcquisitionCandidateProcessingPipeline
} from "./acquisition-candidate-processing-pipeline.js";
import type {
  AcquisitionOperationShard,
  AcquisitionRun
} from "./acquisition-plan-run-repository.js";
import type {
  AcquisitionAgentToolExecutor,
  AcquisitionToolExecutionInput
} from "./acquisition-pi-tools.js";

const RESEARCH_QUESTIONS = [
  "该主体最近有哪些与目标产品相关的明确需求或经营变化？",
  "哪些公开信息支持或反驳采购可能性？",
  "可能参与采购决策的部门和商务角色有哪些？",
  "是否存在现有供应商、比价、拒绝联系或勿扰信号？"
];

function run(): AcquisitionRun {
  return {
    id: "run-pipeline",
    ownerId: "owner-pipeline",
    teamId: "team-pipeline",
    planId: "plan-pipeline",
    planVersionId: "plan-version-pipeline",
    planVersion: 1,
    planSnapshotHash: "sha256:plan",
    parentRunId: null,
    status: "running",
    terminationIntent: null,
    revision: 2,
    etag: "\"run-pipeline:2\"",
    budgetSnapshotId: "budget-pipeline",
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 20,
      maxResults: 10,
      maxAmountMinor: 1_000,
      maxDurationSeconds: 60
    },
    budgetSnapshotHash: "sha256:budget",
    billingCurrency: "CNY",
    modelSnapshotRef: {
      jobSnapshotId: "model-snapshot",
      connectionId: "model-connection",
      credentialVersion: 1,
      provider: "test-model",
      model: "test-model-v1",
      capabilitySnapshotHash: "sha256:capability",
      promptVersion: "prompt.v1",
      schemaVersion: "acquisition-plan.v1",
      promptHash: "sha256:prompt",
      schemaHash: "sha256:schema"
    },
    consumedBudget: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    },
    evidenceCount: 0,
    reason: null,
    createdBy: "planner",
    createdAt: "2026-07-24T08:00:00.000Z",
    updatedBy: "acquisition-worker",
    updatedAt: "2026-07-24T08:00:01.000Z",
    completedAt: null
  };
}

function shard(): AcquisitionOperationShard {
  return {
    id: "shard-pipeline",
    runId: "run-pipeline",
    ownerId: "owner-pipeline",
    teamId: "team-pipeline",
    operationId: "organization-search",
    parentShardId: null,
    subjectChannel: "organization",
    kind: "search",
    connection: {
      connectionId: "official-search-connection",
      providerId: "official-search",
      kind: "search",
      status: "active",
      credentialVersion: 3
    },
    query: "厦门 企业 公开采购需求",
    sourceRef: "厦门 企业 公开采购需求",
    status: "running",
    budgetSnapshotId: "budget-pipeline",
    allocatedBudget: {
      requests: 20,
      results: 10,
      amountMinor: 1_000,
      durationSeconds: 60
    },
    consumedBudget: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    },
    modelSnapshotRef: run().modelSnapshotRef,
    evidenceCount: 0,
    revision: 2,
    createdAt: "2026-07-24T08:00:00.000Z",
    updatedAt: "2026-07-24T08:00:01.000Z",
    completedAt: null
  };
}

function qualification(
  grade: "S" | "A" | "B" | "C" | "D",
  score: number,
  hardGateFailures: string[] = []
) {
  return {
    qualification: {
      grade,
      score,
      hardGateFailures
    },
    financialValue: {
      currency: "CNY",
      expectedContributionMinor: 10_000
    },
    outreachExecuted: false
  };
}

function processingInput(
  candidateIds: string[],
  signal = new AbortController().signal
) {
  return {
    scope: {
      ownerId: "owner-pipeline",
      teamId: "team-pipeline",
      actorId: "acquisition-worker"
    },
    run: run(),
    shard: shard(),
    candidateIds,
    signal
  };
}

test("runs research, qualification, and a v1 battle card in order for an eligible candidate", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(input);
      if (input.toolName === "qualify_candidate") {
        return qualification("A", 78);
      }
      return { outreachExecuted: false };
    }
  };
  const pipeline = new AcquisitionCandidateProcessingPipeline({ executor });
  const input = processingInput(["candidate-a"]);

  const result = await pipeline.process(input);

  assert.deepEqual(calls.map((call) => call.toolName), [
    "research_candidate",
    "qualify_candidate",
    "build_battle_card"
  ]);
  assert.deepEqual(calls.map((call) => call.payload), [
    {
      candidateId: "candidate-a",
      depth: "standard",
      researchQuestions: RESEARCH_QUESTIONS
    },
    {
      candidateId: "candidate-a",
      policyVersion: "qualification.v2"
    },
    {
      candidateId: "candidate-a",
      templateVersion: "battle-card.v1"
    }
  ]);
  assert.equal(
    calls.every((call) =>
      call.identity.ownerId === "owner-pipeline"
      && call.identity.teamId === "team-pipeline"
      && call.identity.actorId === "acquisition-worker"
      && call.identity.sessionId === "acquisition-plan:run-pipeline"
      && call.signal === input.signal
      && call.toolCallId === call.idempotencyKey
      && /^acquisition-stage:[a-f0-9]{48}$/u.test(call.idempotencyKey)
    ),
    true
  );
  assert.deepEqual(result, {
    processedCandidateIds: ["candidate-a"],
    battleCardCandidateIds: ["candidate-a"],
    failures: []
  });
});

test("does not build cards for lower grades or any hard-gated qualification", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  const decisions = new Map([
    ["candidate-b", qualification("B", 60)],
    ["candidate-c", qualification("C", 45)],
    ["candidate-d", qualification("D", 20)],
    [
      "candidate-gated",
      qualification("A", 78, ["explicit_rejection"])
    ]
  ]);
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(input);
      return input.toolName === "qualify_candidate"
        ? decisions.get(String(input.payload.candidateId))
        : { outreachExecuted: false };
    }
  };
  const pipeline = new AcquisitionCandidateProcessingPipeline({ executor });

  const result = await pipeline.process(processingInput([
    "candidate-b",
    "candidate-c",
    "candidate-d",
    "candidate-gated"
  ]));

  assert.deepEqual(
    calls.filter((call) => call.toolName === "build_battle_card"),
    []
  );
  assert.deepEqual(result, {
    processedCandidateIds: [
      "candidate-b",
      "candidate-c",
      "candidate-d",
      "candidate-gated"
    ],
    battleCardCandidateIds: [],
    failures: []
  });
});

test("keeps failed candidates, records only stable codes, and continues later candidates", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(input);
      const candidateId = String(input.payload.candidateId);
      if (candidateId === "candidate-research-failure"
        && input.toolName === "research_candidate") {
        throw Object.assign(
          new Error("provider secret response must not be persisted"),
          { code: "RESEARCH_FAILED" }
        );
      }
      if (candidateId === "candidate-qualification-failure"
        && input.toolName === "qualify_candidate") {
        throw Object.assign(new Error("apiKey=secret"), {
          code: "QUALIFICATION_FAILED"
        });
      }
      if (candidateId === "candidate-card-failure"
        && input.toolName === "build_battle_card") {
        throw Object.assign(new Error("https://private-base-url.test"), {
          code: "BATTLE_CARD_FAILED"
        });
      }
      if (input.toolName === "qualify_candidate") {
        return qualification("A", 78);
      }
      return { outreachExecuted: false };
    }
  };
  const pipeline = new AcquisitionCandidateProcessingPipeline({ executor });

  const result = await pipeline.process(processingInput([
    "candidate-research-failure",
    "candidate-qualification-failure",
    "candidate-card-failure",
    "candidate-success"
  ]));

  assert.deepEqual(result, {
    processedCandidateIds: [
      "candidate-card-failure",
      "candidate-success"
    ],
    battleCardCandidateIds: ["candidate-success"],
    failures: [
      {
        candidateId: "candidate-research-failure",
        stage: "research",
        errorCode: "RESEARCH_FAILED"
      },
      {
        candidateId: "candidate-qualification-failure",
        stage: "qualification",
        errorCode: "QUALIFICATION_FAILED"
      },
      {
        candidateId: "candidate-card-failure",
        stage: "battle_card",
        errorCode: "BATTLE_CARD_FAILED"
      }
    ]
  });
  assert.equal(
    calls.some((call) =>
      call.payload.candidateId === "candidate-qualification-failure"
      && call.toolName === "build_battle_card"
    ),
    false
  );
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("private-base-url"), false);
});

test("rejects a malformed qualification as a stable qualification-stage failure", async () => {
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      if (input.toolName === "qualify_candidate") {
        return {
          qualification: {
            grade: "A",
            score: "78",
            hardGateFailures: []
          }
        };
      }
      return { outreachExecuted: false };
    }
  };
  const pipeline = new AcquisitionCandidateProcessingPipeline({ executor });

  const result = await pipeline.process(
    processingInput(["candidate-malformed"])
  );

  assert.deepEqual(result, {
    processedCandidateIds: [],
    battleCardCandidateIds: [],
    failures: [{
      candidateId: "candidate-malformed",
      stage: "qualification",
      errorCode: "INVALID_QUALIFICATION_RESULT"
    }]
  });
});

test("never starts another tool after the external signal aborts", async () => {
  const controller = new AbortController();
  const calls: AcquisitionToolExecutionInput[] = [];
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(input);
      controller.abort(new DOMException("cancelled", "AbortError"));
      return { outreachExecuted: false };
    }
  };
  const pipeline = new AcquisitionCandidateProcessingPipeline({ executor });

  await assert.rejects(
    pipeline.process(processingInput(["candidate-aborted"], controller.signal)),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError"
  );
  assert.deepEqual(calls.map((call) => call.toolName), [
    "research_candidate"
  ]);
});

test("reuses every stage idempotency key for the same run, shard, and candidate", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(input);
      return input.toolName === "qualify_candidate"
        ? qualification("A", 78)
        : { outreachExecuted: false };
    }
  };
  const pipeline = new AcquisitionCandidateProcessingPipeline({ executor });

  await pipeline.process(processingInput(["candidate-retry"]));
  await pipeline.process(processingInput(["candidate-retry"]));

  assert.deepEqual(
    calls.slice(0, 3).map((call) => call.idempotencyKey),
    calls.slice(3).map((call) => call.idempotencyKey)
  );
  assert.equal(new Set(
    calls.slice(0, 3).map((call) => call.idempotencyKey)
  ).size, 3);
});
