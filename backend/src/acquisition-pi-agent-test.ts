import assert from "node:assert/strict";
import type {
  AgentEvent
} from "@earendil-works/pi-agent-core";
import {
  createAcquisitionPiAgent,
  type AcquisitionPiTurnInput,
  type AcquisitionPiTurnRuntime
} from "./acquisition-pi-agent.js";
import {
  InMemoryAcquisitionToolAuditLedger,
  type AcquisitionToolExecutionInput
} from "./acquisition-pi-tools.js";

const turns: AcquisitionPiTurnInput[] = [];
const runtime: AcquisitionPiTurnRuntime = {
  async run(input) {
    turns.push(input);
    if (turns.length === 1) {
      return {
        type: "tool_calls",
        providerRequestId: "provider-request-1",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 0
        },
        calls: [{
          id: "tool-call-1",
          name: "get_candidate_evidence",
          arguments: { candidateId: "candidate-a" }
        }]
      };
    }
    return {
      type: "text",
      providerRequestId: "provider-request-2",
      usage: {
        inputTokens: 140,
        outputTokens: 30,
        reasoningTokens: 4
      },
      text: "候选客户存在明确需求信号；结论基于已核验的公开证据。"
    };
  }
};

const toolExecutions: AcquisitionToolExecutionInput[] = [];
const audit = new InMemoryAcquisitionToolAuditLedger();
const agent = createAcquisitionPiAgent({
  identity: {
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "owner-a",
    sessionId: "copilot-a"
  },
  snapshot: {
    jobId: "job-a",
    connectionId: "connection-a",
    credentialVersion: 3,
    provider: "moonshot",
    model: "kimi-k2.5",
    promptVersion: "acquisition-copilot-v1",
    schemaVersion: "copilot-turn.v1",
    promptHash: "sha256:prompt-acquisition-copilot-v1",
    schemaHash: "sha256:schema-copilot-turn-v1",
    capabilitySnapshotHash: "capability-hash-a",
    baseUrlFingerprint: "base-url-hash-a"
  },
  runtime,
  toolExecutor: {
    async execute(input) {
      toolExecutions.push(input);
      return {
        candidateId: input.payload.candidateId,
        evidence: [{
          sourceUrl: "https://example.cn/procurement/1",
          summary: "公开采购需求"
        }]
      };
    }
  },
  toolAudit: audit,
  toolAuditSecret: "pi-agent-test-audit-secret-at-least-32-characters"
});

const events: AgentEvent[] = [];
agent.subscribe((event) => {
  events.push(event);
});

await agent.prompt("分析 candidate-a 是否值得跟进，并说明证据。");

assert.equal(turns.length, 2);
assert.equal(turns[0]?.snapshot.credentialVersion, 3);
assert.equal(turns[0]?.snapshot.connectionId, "connection-a");
assert.deepEqual(
  turns[0]?.tools.map((tool) => tool.name),
  [
    "search_public_sources",
    "get_candidate_evidence",
    "research_candidate",
    "qualify_candidate",
    "build_battle_card",
    "estimate_financial_value",
    "draft_connection_strategy",
    "list_priority_candidates",
    "create_review_task",
    "record_outcome"
  ]
);
assert.equal(toolExecutions.length, 1);
assert.equal(toolExecutions[0]?.identity.ownerId, "owner-a");
assert.equal(toolExecutions[0]?.payload.candidateId, "candidate-a");
assert.equal(
  turns[1]?.messages.some((message) => message.role === "toolResult"),
  true,
  "the gateway turn after a tool must receive the audited tool result"
);
assert.equal(
  agent.state.messages.some((message) =>
    message.role === "assistant"
    && message.content.some((content) =>
      content.type === "text"
      && content.text.includes("公开证据")
    )
  ),
  true
);
assert.equal(
  events.some((event) => event.type === "tool_execution_end"),
  true
);
assert.equal(
  audit.list({
    ownerId: "owner-a",
    teamId: "team-a",
    sessionId: "copilot-a"
  }).length,
  1
);

const failingAgent = createAcquisitionPiAgent({
  identity: {
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "owner-a",
    sessionId: "copilot-failure"
  },
  snapshot: {
    jobId: "job-b",
    connectionId: "connection-a",
    credentialVersion: 3,
    provider: "moonshot",
    model: "kimi-k2.5",
    promptVersion: "acquisition-copilot-v1",
    schemaVersion: "copilot-turn.v1",
    promptHash: "sha256:prompt-acquisition-copilot-v1",
    schemaHash: "sha256:schema-copilot-turn-v1",
    capabilitySnapshotHash: "capability-hash-a",
    baseUrlFingerprint: "base-url-hash-a"
  },
  runtime: {
    async run() {
      throw new Error("MODEL_RATE_LIMITED apiKey=must-not-leak");
    }
  },
  toolExecutor: {
    async execute() {
      throw new Error("not expected");
    }
  },
  toolAudit: audit,
  toolAuditSecret: "pi-agent-test-audit-secret-at-least-32-characters"
});

await failingAgent.prompt("分析客户");
assert.equal(failingAgent.state.errorMessage, "MODEL_RATE_LIMITED");
assert.equal(
  JSON.stringify(failingAgent.state.messages).includes("must-not-leak"),
  false
);

assert.throws(
  () => createAcquisitionPiAgent({
    identity: {
      ownerId: "owner-a",
      teamId: "team-a",
      actorId: "owner-a",
      sessionId: "copilot-invalid"
    },
    snapshot: {
      jobId: "",
      connectionId: "connection-a",
      credentialVersion: 3,
      provider: "moonshot",
      model: "kimi-k2.5",
      promptVersion: "acquisition-copilot-v1",
      schemaVersion: "copilot-turn.v1",
      promptHash: "sha256:prompt-acquisition-copilot-v1",
      schemaHash: "sha256:schema-copilot-turn-v1",
      capabilitySnapshotHash: "capability-hash-a",
      baseUrlFingerprint: "base-url-hash-a"
    },
    runtime,
    toolExecutor: {
      async execute() {
        return {};
      }
    },
    toolAudit: audit,
    toolAuditSecret: "pi-agent-test-audit-secret-at-least-32-characters"
  }),
  /snapshot.jobId/
);

const restoredTranscript = [{
  role: "user" as const,
  content: "上一轮已要求只分析公开采购信号。",
  timestamp: 10
}];
const resumedAgent = createAcquisitionPiAgent({
  identity: {
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "owner-a",
    sessionId: "copilot-resumed"
  },
  snapshot: {
    jobId: "job-resumed",
    connectionId: "connection-a",
    credentialVersion: 3,
    provider: "moonshot",
    model: "kimi-k2.5",
    promptVersion: "acquisition-copilot-v1",
    schemaVersion: "copilot-turn.v1",
    promptHash: "sha256:prompt-acquisition-copilot-v1",
    schemaHash: "sha256:schema-copilot-turn-v1",
    capabilitySnapshotHash: "capability-hash-a",
    baseUrlFingerprint: "base-url-hash-a"
  },
  runtime,
  toolExecutor: {
    async execute() {
      return {};
    }
  },
  toolAudit: audit,
  toolAuditSecret: "pi-agent-test-audit-secret-at-least-32-characters",
  initialMessages: restoredTranscript
});
assert.deepEqual(resumedAgent.state.messages, restoredTranscript);
restoredTranscript[0]!.content = "调用者后续修改不得污染智能体状态";
assert.equal(
  resumedAgent.state.messages[0]?.role === "user"
    ? resumedAgent.state.messages[0].content
    : "",
  "上一轮已要求只分析公开采购信号。"
);

console.log("acquisition Pi agent tests passed");
