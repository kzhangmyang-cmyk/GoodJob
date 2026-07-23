import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createAcquisitionPiRuntimeFactory
} from "./acquisition-pi-runtime-factory.js";
import type {
  AcquisitionPiGatewayPort
} from "./acquisition-pi-gateway-runtime.js";
import type {
  StoredAiJobModelSnapshot
} from "./model-providers/types.js";

const storedSnapshot: StoredAiJobModelSnapshot = {
  jobId: "job-a",
  ownerId: "owner-a",
  teamId: "team-a",
  connectionId: "connection-a",
  credentialVersion: 4,
  provider: "moonshot",
  model: "kimi-k3",
  capabilitySnapshot: {
    structuredOutput: true,
    toolCalling: true,
    parallelToolCalling: true,
    streaming: true,
    modelListing: false
  },
  promptVersion: "acquisition-copilot-v1",
  schemaVersion: "copilot-turn.v1",
  promptHash: "sha256:prompt-acquisition-copilot-v1",
  schemaHash: "sha256:schema-copilot-turn-v1",
  baseUrl: "https://api.moonshot.cn/v1",
  baseUrlFingerprint: "sha256:moonshot-base-url",
  createdAt: "2026-07-23T00:00:00.000Z"
};

const capabilitySnapshotHash = `sha256:${createHash("sha256")
  .update(JSON.stringify(storedSnapshot.capabilitySnapshot))
  .digest("hex")}`;

const gateway: AcquisitionPiGatewayPort = {
  async callTools() {
    return {
      toolCalls: [{
        id: "final-a",
        name: "__goodjob_submit_final_answer",
        arguments: {
          text: "已按冻结模型快照完成公开商机分析。"
        }
      }],
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        reasoningTokens: 0
      },
      providerRequestId: "provider-request-a"
    };
  }
};

const gatewaySnapshots: StoredAiJobModelSnapshot[] = [];
const factory = createAcquisitionPiRuntimeFactory({
  store: {
    aiJobModelSnapshots: [storedSnapshot]
  },
  gatewayFactory(snapshot) {
    gatewaySnapshots.push(structuredClone(snapshot));
    return gateway;
  }
});

const piSnapshot = {
  jobId: storedSnapshot.jobId,
  connectionId: storedSnapshot.connectionId,
  credentialVersion: storedSnapshot.credentialVersion,
  provider: storedSnapshot.provider,
  model: storedSnapshot.model,
  promptVersion: storedSnapshot.promptVersion,
  schemaVersion: storedSnapshot.schemaVersion,
  promptHash: storedSnapshot.promptHash,
  schemaHash: storedSnapshot.schemaHash,
  capabilitySnapshotHash,
  baseUrlFingerprint: storedSnapshot.baseUrlFingerprint
};

const runtime = await factory.create({
  identity: {
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "sales-a",
    sessionId: "session-a"
  },
  snapshot: piSnapshot
});

const result = await runtime.run({
  snapshot: piSnapshot,
  systemPrompt: "只使用公开证据。",
  messages: [{
    role: "user",
    content: "分析中国市场商机",
    timestamp: 1
  }],
  tools: []
});
assert.equal(result.type, "text");
assert.equal(gatewaySnapshots.length, 1);
assert.equal(gatewaySnapshots[0]?.jobId, "job-a");

await assert.rejects(
  () => factory.create({
    identity: {
      ownerId: "owner-b",
      teamId: "team-a",
      actorId: "sales-b",
      sessionId: "session-b"
    },
    snapshot: piSnapshot
  }),
  /MODEL_SNAPSHOT_UNAVAILABLE/
);

await assert.rejects(
  () => factory.create({
    identity: {
      ownerId: "owner-a",
      teamId: "team-a",
      actorId: "sales-a",
      sessionId: "session-c"
    },
    snapshot: {
      ...piSnapshot,
      promptHash: "sha256:tampered-prompt"
    }
  }),
  /MODEL_SNAPSHOT_MISMATCH/
);

await assert.rejects(
  () => createAcquisitionPiRuntimeFactory({
    store: {
      aiJobModelSnapshots: [{
        ...storedSnapshot,
        capabilitySnapshot: {
          ...storedSnapshot.capabilitySnapshot,
          toolCalling: false
        }
      }]
    },
    gatewayFactory() {
      return gateway;
    }
  }).create({
    identity: {
      ownerId: "owner-a",
      teamId: "team-a",
      actorId: "sales-a",
      sessionId: "session-d"
    },
    snapshot: {
      ...piSnapshot,
      capabilitySnapshotHash: `sha256:${createHash("sha256")
        .update(JSON.stringify({
          ...storedSnapshot.capabilitySnapshot,
          toolCalling: false
        }))
        .digest("hex")}`
    }
  }),
  /MODEL_TOOL_CALLING_UNAVAILABLE/
);

console.log("acquisition Pi runtime factory tests passed");
