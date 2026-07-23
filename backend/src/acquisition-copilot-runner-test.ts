import assert from "node:assert/strict";
import type {
  AgentMessage
} from "@earendil-works/pi-agent-core";
import type {
  AcquisitionPiTurnInput
} from "./acquisition-pi-agent.js";
import {
  createPiAcquisitionCopilotRunner,
  type AcquisitionPiRuntimeFactoryInput
} from "./acquisition-copilot-runner.js";
import {
  InMemoryAcquisitionToolAuditLedger,
  type AcquisitionToolExecutionInput
} from "./acquisition-pi-tools.js";

const snapshot = {
  jobId: "job-runner-a",
  connectionId: "connection-runner-a",
  credentialVersion: 2,
  provider: "zhipu" as const,
  model: "glm-5",
  promptVersion: "acquisition-copilot-v1",
  schemaVersion: "copilot-turn.v1",
  capabilitySnapshotHash: "capability-runner-a",
  baseUrlFingerprint: "base-url-runner-a"
};

const previousTranscript: AgentMessage[] = [{
  role: "user",
  content: "上一轮先确认了目标行业。",
  timestamp: 1
}, {
  role: "assistant",
  content: [{
    type: "text",
    text: "目标行业为企业服务。"
  }],
  api: "goodjob-gateway",
  provider: "zhipu",
  model: "glm-5",
  usage: {
    input: 5,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 10,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  },
  stopReason: "stop",
  timestamp: 2
}];

const runtimeFactoryInputs: AcquisitionPiRuntimeFactoryInput[] = [];
const turns: AcquisitionPiTurnInput[] = [];
const executions: AcquisitionToolExecutionInput[] = [];
const audit = new InMemoryAcquisitionToolAuditLedger();

const runner = createPiAcquisitionCopilotRunner({
  runtimeFactory: {
    async create(input) {
      runtimeFactoryInputs.push(input);
      return {
        async run(turn) {
          turns.push(turn);
          if (turns.length === 1) {
            return {
              type: "tool_calls",
              calls: [{
                id: "candidate-evidence-call-1",
                name: "get_candidate_evidence",
                arguments: { candidateId: "candidate-a" }
              }],
              usage: {
                inputTokens: 20,
                outputTokens: 10,
                reasoningTokens: 0
              },
              providerRequestId: "glm-request-1"
            };
          }
          return {
            type: "text",
            text: "candidate-a 有两条可核验需求证据，建议进入人工审核。",
            usage: {
              inputTokens: 30,
              outputTokens: 12,
              reasoningTokens: 1
            },
            providerRequestId: "glm-request-2"
          };
        }
      };
    }
  },
  toolExecutor: {
    async execute(input) {
      executions.push(input);
      return {
        candidateId: "candidate-a",
        evidence: [{
          sourceUrl: "https://example.cn/public/1",
          excerpt: "公开采购需求"
        }]
      };
    }
  },
  toolAudit: audit,
  toolAuditSecret: "copilot-runner-audit-secret-at-least-32-characters"
});

const response = await runner.run({
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "sales-a",
  sessionId: "session-a",
  snapshot,
  transcript: previousTranscript,
  prompt: "分析 candidate-a，并说明下一步。"
});

assert.deepEqual(runtimeFactoryInputs, [{
  identity: {
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "sales-a",
    sessionId: "session-a"
  },
  snapshot
}]);
assert.equal(turns.length, 2);
assert.equal(
  turns[0]?.messages.some((message) =>
    message.role === "user"
    && message.content === "上一轮先确认了目标行业。"
  ),
  true,
  "the snapshotted runner must restore the persisted transcript"
);
assert.equal(executions.length, 1);
assert.equal(executions[0]?.identity.actorId, "sales-a");
assert.equal(response.newMessages[0]?.role, "user");
assert.equal(
  response.newMessages.some((message) =>
    message.role === "user"
    && message.content === "上一轮先确认了目标行业。"
  ),
  false,
  "only messages created by this task may be persisted again"
);
assert.deepEqual(response.result, {
  summary: "candidate-a 有两条可核验需求证据，建议进入人工审核。",
  toolNames: ["get_candidate_evidence"]
});
assert.equal(
  audit.list({
    ownerId: "owner-a",
    teamId: "team-a",
    sessionId: "session-a"
  }).length,
  1
);

{
  const failingRunner = createPiAcquisitionCopilotRunner({
    runtimeFactory: {
      async create() {
        return {
          async run() {
            throw new Error("MODEL_RATE_LIMITED apiKey=must-not-leak");
          }
        };
      }
    },
    toolExecutor: {
      async execute() {
        return {};
      }
    },
    toolAudit: audit,
    toolAuditSecret:
      "copilot-runner-failure-secret-at-least-32-characters"
  });
  await assert.rejects(
    () => failingRunner.run({
      ownerId: "owner-a",
      teamId: "team-a",
      actorId: "sales-a",
      sessionId: "session-failure",
      snapshot,
      transcript: [],
      prompt: "触发失败"
    }),
    (error: unknown) =>
      error instanceof Error
      && error.message === "MODEL_RATE_LIMITED"
      && !error.message.includes("must-not-leak")
  );
}

console.log("acquisition copilot runner tests passed");
