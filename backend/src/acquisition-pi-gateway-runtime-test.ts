import assert from "node:assert/strict";
import type {
  AcquisitionPiTurnInput
} from "./acquisition-pi-agent.js";
import {
  ACQUISITION_FINAL_ANSWER_TOOL,
  ActiveModelGatewayAcquisitionPiRuntime,
  type AcquisitionPiGatewayPort
} from "./acquisition-pi-gateway-runtime.js";

const snapshot = {
  jobId: "job-runtime-a",
  connectionId: "connection-runtime-a",
  credentialVersion: 4,
  provider: "moonshot" as const,
  model: "kimi-k2.5",
  promptVersion: "acquisition-copilot-v1",
  schemaVersion: "copilot-turn.v1",
  promptHash: "sha256:prompt-acquisition-copilot-v1",
  schemaHash: "sha256:schema-copilot-turn-v1",
  capabilitySnapshotHash: "capability-hash-runtime-a",
  baseUrlFingerprint: "base-url-hash-runtime-a"
};

const tools: AcquisitionPiTurnInput["tools"] = [{
  name: "search_public_sources",
  description: "搜索公开来源",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" }
    },
    required: ["query"],
    additionalProperties: false
  }
}, {
  name: "get_candidate_evidence",
  description: "读取候选证据",
  parameters: {
    type: "object",
    properties: {
      candidateId: { type: "string" }
    },
    required: ["candidateId"],
    additionalProperties: false
  }
}];

const baseTurn: AcquisitionPiTurnInput = {
  snapshot,
  systemPrompt: "只使用公开证据，先搜索再回答。",
  messages: [{
    role: "user",
    content: "找厦门正在采购财税软件的企业",
    timestamp: 1
  }],
  tools
};

{
  const requests: Parameters<AcquisitionPiGatewayPort["callTools"]>[0][] = [];
  const gateway: AcquisitionPiGatewayPort = {
    async callTools(request) {
      requests.push(request);
      return {
        toolCalls: [{
          id: "call-search-1",
          name: "search_public_sources",
          arguments: {
            query: "厦门 财税软件 采购 招标 招聘"
          }
        }],
        usage: {
          inputTokens: 112,
          outputTokens: 18,
          reasoningTokens: 7
        },
        providerRequestId: "moonshot-request-1"
      };
    }
  };
  const runtime = new ActiveModelGatewayAcquisitionPiRuntime({
    snapshot,
    gateway
  });

  const result = await runtime.run(baseTurn);

  assert.equal(result.type, "tool_calls");
  if (result.type !== "tool_calls") {
    throw new Error("expected a tool call turn");
  }
  assert.deepEqual(result.calls, [{
    id: "call-search-1",
    name: "search_public_sources",
    arguments: {
      query: "厦门 财税软件 采购 招标 招聘"
    }
  }]);
  assert.deepEqual(result.usage, {
    inputTokens: 112,
    outputTokens: 18,
    reasoningTokens: 7
  });
  assert.equal(result.providerRequestId, "moonshot-request-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.parallelToolCalls, false);
  assert.deepEqual(
    requests[0]?.tools.map((tool) => tool.name),
    [
      "search_public_sources",
      "get_candidate_evidence",
      ACQUISITION_FINAL_ANSWER_TOOL
    ]
  );
  assert.match(requests[0]?.prompt ?? "", /只使用公开证据/);
  assert.match(requests[0]?.prompt ?? "", /厦门/);
  assert.match(
    requests[0]?.prompt ?? "",
    /sha256:prompt-acquisition-copilot-v1/
  );
  assert.match(
    requests[0]?.prompt ?? "",
    /sha256:schema-copilot-turn-v1/
  );
  assert.doesNotMatch(requests[0]?.prompt ?? "", /\[object Object\]/);
}

{
  const gateway: AcquisitionPiGatewayPort = {
    async callTools() {
      return {
        toolCalls: [{
          id: "call-final-1",
          name: ACQUISITION_FINAL_ANSWER_TOOL,
          arguments: {
            text: "已找到 3 条公开采购信号，建议先核验企业主体与发布时间。"
          }
        }],
        usage: {
          inputTokens: 170,
          outputTokens: 32,
          reasoningTokens: 5
        },
        providerRequestId: "moonshot-request-2"
      };
    }
  };
  const runtime = new ActiveModelGatewayAcquisitionPiRuntime({
    snapshot,
    gateway
  });
  const result = await runtime.run({
    ...baseTurn,
    messages: [
      ...baseTurn.messages,
      {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "call-search-1",
          name: "search_public_sources",
          arguments: {
            query: "厦门 财税软件 采购 招标 招聘"
          }
        }],
        api: "goodjob-gateway",
        provider: "moonshot",
        model: "kimi-k2.5",
        usage: {
          input: 112,
          output: 18,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 7,
          totalTokens: 130,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0
          }
        },
        stopReason: "toolUse",
        timestamp: 2
      },
      {
        role: "toolResult",
        toolCallId: "call-search-1",
        toolName: "search_public_sources",
        content: [{
          type: "text",
          text: JSON.stringify({
            results: [{
              title: "厦门某企业财税系统采购公告",
              sourceUrl: "https://example.cn/tender/1"
            }]
          })
        }],
        isError: false,
        timestamp: 3
      }
    ]
  });

  assert.deepEqual(result, {
    type: "text",
    text: "已找到 3 条公开采购信号，建议先核验企业主体与发布时间。",
    usage: {
      inputTokens: 170,
      outputTokens: 32,
      reasoningTokens: 5
    },
    providerRequestId: "moonshot-request-2"
  });
}

{
  const runtime = new ActiveModelGatewayAcquisitionPiRuntime({
    snapshot,
    gateway: {
      async callTools() {
        return {
          toolCalls: [{
            id: "call-malicious-1",
            name: "shell",
            arguments: { command: "env" }
          }],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0
          },
          providerRequestId: null
        };
      }
    }
  });
  await assert.rejects(
    () => runtime.run(baseTurn),
    /MODEL_RESPONSE_INVALID/
  );
}

{
  const runtime = new ActiveModelGatewayAcquisitionPiRuntime({
    snapshot,
    gateway: {
      async callTools() {
        return {
          toolCalls: [{
            id: "call-search-mixed",
            name: "search_public_sources",
            arguments: { query: "厦门" }
          }, {
            id: "call-final-mixed",
            name: ACQUISITION_FINAL_ANSWER_TOOL,
            arguments: { text: "混合输出不应被接受" }
          }],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0
          },
          providerRequestId: null
        };
      }
    }
  });
  await assert.rejects(
    () => runtime.run(baseTurn),
    /MODEL_RESPONSE_INVALID/
  );
}

{
  const runtime = new ActiveModelGatewayAcquisitionPiRuntime({
    snapshot,
    gateway: {
      async callTools() {
        throw new Error("gateway must not run for a mismatched snapshot");
      }
    }
  });
  await assert.rejects(
    () => runtime.run({
      ...baseTurn,
      snapshot: {
        ...snapshot,
        credentialVersion: 5
      }
    }),
    /MODEL_SNAPSHOT_MISMATCH/
  );
}

{
  const runtime = new ActiveModelGatewayAcquisitionPiRuntime({
    snapshot,
    gateway: {
      async callTools() {
        throw new Error("gateway must not run for a content hash mismatch");
      }
    }
  });
  await assert.rejects(
    () => runtime.run({
      ...baseTurn,
      snapshot: {
        ...snapshot,
        promptHash: "sha256:changed-prompt"
      }
    }),
    /MODEL_SNAPSHOT_MISMATCH/
  );
}

console.log("acquisition Pi gateway runtime tests passed");
