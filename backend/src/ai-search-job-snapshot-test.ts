import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  bindAiSearchJobModelSnapshot
} from "./prospect-run-queue-bridge.js";
import {
  createAiSearchProvider,
  resolveAiSearchProviderFromSnapshot
} from "./ai-search-provider.js";
import {
  encryptAiModelApiKey
} from "./credential-security.js";
import type { CrmStore } from "./store.js";
import type { AiModelConfig } from "./types.js";

const now = "2026-07-23T11:00:00.000Z";

function officialConfig(
  id: string,
  enabled: boolean
): AiModelConfig {
  return {
    id,
    provider: "moonshot",
    protocol: "openai-compatible",
    name: id,
    baseUrl: `https://${id}.example/v1`,
    model: `${id}-model`,
    apiKey: "",
    enabled,
    temperature: 0.1,
    useLeadFinder: true,
    useWebsiteParse: false,
    useScoring: false,
    useEmailDraft: false,
    useExam: false,
    lastTestStatus: "passed",
    lastTestMessage: "",
    ownerId: "u1",
    teamId: "t1",
    credentialVersion: enabled ? 4 : 8,
    capabilitySnapshot: {
      structuredOutput: true,
      toolCalling: true,
      parallelToolCalling: false,
      streaming: true,
      modelListing: true
    },
    createdAt: now,
    updatedAt: now
  };
}

test("queue bridge binds ai_search child jobs to one immutable model snapshot", () => {
  const store = {
    aiModelConfigs: [
      officialConfig("active", true),
      officialConfig("inactive", false)
    ],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: []
  } as unknown as CrmStore;
  const first = bindAiSearchJobModelSnapshot(store, {
    providerCode: "ai_search",
    jobId: "job_ai_search",
    ownerId: "u1",
    teamId: "t1"
  });
  store.aiModelConfigs[0].enabled = false;
  store.aiModelConfigs[1].enabled = true;
  const retry = bindAiSearchJobModelSnapshot(store, {
    providerCode: "ai_search",
    jobId: "job_ai_search",
    ownerId: "u1",
    teamId: "t1"
  });

  assert.deepEqual(retry, first);
  assert.equal(first?.connectionId, "active");
  assert.equal(first?.credentialVersion, 4);
  assert.equal(first?.baseUrl, "https://active.example/v1");
  assert.equal(first?.promptVersion, "ai-search.v1");
  assert.equal(first?.schemaVersion, "ai-search-result.v1");
  assert.equal(store.aiJobModelSnapshots.length, 1);
  assert.equal(store.pendingAiJobModelSnapshots.length, 1);
});

test("queue bridge ignores enabled legacy configs when selecting the official lead-finder model", () => {
  const legacy = {
    ...officialConfig("legacy", true),
    provider: "custom-openai-compatible"
  };
  const official = officialConfig("official", true);
  const store = {
    aiModelConfigs: [legacy, official],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: []
  } as unknown as CrmStore;

  const snapshot = bindAiSearchJobModelSnapshot(store, {
    providerCode: "ai_search",
    jobId: "job_official_ai_search",
    ownerId: "u1",
    teamId: "t1"
  });

  assert.equal(snapshot?.connectionId, "official");
  assert.equal(snapshot?.provider, "moonshot");
});

test("queue bridge does not create model snapshots for non-AI providers", () => {
  const store = {
    aiModelConfigs: [],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: []
  } as unknown as CrmStore;
  assert.equal(bindAiSearchJobModelSnapshot(store, {
    providerCode: "serper",
    jobId: "job_serper",
    ownerId: "u1",
    teamId: "t1"
  }), null);
  assert.equal(store.aiJobModelSnapshots.length, 0);
});

test("worker resolves ai_search from the child job snapshot instead of live active config", () => {
  const active = officialConfig("active", true);
  const next = officialConfig("next", false);
  const store = {
    aiModelConfigs: [active, next],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: [],
    prospectRunQueueChildBindings: [{
      id: "binding_1",
      teamId: "t1",
      runId: "run_1",
      shardId: "shard_1",
      ownerId: "u1",
      jobId: "job_ai_search",
      jobType: "prospect.provider.fetch",
      parentJobId: "job_parent",
      bridgeVersion: "v1",
      executionSnapshotHash: "sha256:run",
      bindingHash: "sha256:binding",
      createdAt: now
    }]
  } as unknown as CrmStore;
  const snapshot = bindAiSearchJobModelSnapshot(store, {
    providerCode: "ai_search",
    jobId: "job_ai_search",
    ownerId: "u1",
    teamId: "t1"
  });
  assert.ok(snapshot);
  store.pendingAiJobModelSnapshots.splice(0);
  active.enabled = false;
  active.baseUrl = "https://mutated.invalid/v1";
  next.enabled = true;

  const resolved = resolveAiSearchProviderFromSnapshot(store, {
    providerCode: "ai_search",
    runId: "run_1",
    shardId: "shard_1",
    ownerId: "u1",
    teamId: "t1"
  });

  assert.ok(resolved);
  assert.equal(resolved.provider.defaultBaseUrl, "https://active.example/v1");
  assert.deepEqual(resolved.credential, {
    apiKey: "",
    baseUrl: "https://active.example/v1"
  });
});

test("worker refuses ai_search dispatch without its immutable child-job snapshot", () => {
  const store = {
    aiModelConfigs: [officialConfig("active", true)],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: [],
    prospectRunQueueChildBindings: [{
      id: "binding_1",
      teamId: "t1",
      runId: "run_1",
      shardId: "shard_1",
      ownerId: "u1",
      jobId: "job_missing_snapshot",
      jobType: "prospect.provider.fetch",
      parentJobId: "job_parent",
      bridgeVersion: "v1",
      executionSnapshotHash: "sha256:run",
      bindingHash: "sha256:binding",
      createdAt: now
    }]
  } as unknown as CrmStore;

  assert.equal(resolveAiSearchProviderFromSnapshot(store, {
    providerCode: "ai_search",
    runId: "run_1",
    shardId: "shard_1",
    ownerId: "u1",
    teamId: "t1"
  }), undefined);
});

test("AI search reports provider and audit persistence failures together", async () => {
  const active = officialConfig("active", true);
  const store = {
    aiModelConfigs: [active],
    modelCredentialVersions: [{
      connectionId: active.id,
      ownerId: active.ownerId,
      teamId: active.teamId,
      version: active.credentialVersion,
      credentialRef: "credential_active_v4",
      apiKeyEncrypted: encryptAiModelApiKey({
        id: active.id,
        provider: active.provider,
        ownerId: active.ownerId,
        teamId: active.teamId
      }, "sk-active-v4"),
      keyMask: "e-v4",
      createdBy: active.ownerId,
      createdAt: now
    }],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: [],
    modelCallRecords: [],
    pendingModelCallRecords: [],
    async persist() {
      throw new Error("AI search audit database unavailable");
    }
  } as unknown as CrmStore;
  const snapshot = bindAiSearchJobModelSnapshot(store, {
    providerCode: "ai_search",
    jobId: "job_ai_search_dual_failure",
    ownerId: "u1",
    teamId: "t1"
  });
  assert.ok(snapshot);
  store.pendingAiJobModelSnapshots.splice(0);
  const provider = createAiSearchProvider(store, snapshot);

  await assert.rejects(
    provider.search!(
      {
        query: {
          goal: "find buyers",
          productKeywords: ["lighting"],
          countries: ["China"],
          industries: ["manufacturing"],
          customerTypes: ["buyer"],
          excludeKeywords: [],
          limit: 3
        },
        cursor: ""
      },
      { apiKey: "", baseUrl: snapshot.baseUrl },
      {
        http: {
          async fetch() {
            return new Response(
              JSON.stringify({ error: { message: "provider unavailable" } }),
              {
                status: 503,
                headers: { "content-type": "application/json" }
              }
            );
          }
        }
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(String(error.errors[0]), /503|provider|服务/i);
      assert.match(
        String(error.errors[1]),
        /AI search audit database unavailable/
      );
      return true;
    }
  );
  assert.equal(store.modelCallRecords.length, 1);
  assert.equal(store.modelCallRecords[0].status, "failed");
});

test("production AI search paths cannot regress to live-config direct model HTTP", () => {
  const serverSource = readFileSync(
    new URL("./server.ts", import.meta.url),
    "utf8"
  );
  const workerSource = readFileSync(
    new URL("./prospect-worker-service.ts", import.meta.url),
    "utf8"
  );

  assert.match(
    serverSource,
    /from "\.\/ai-model-runtime\.js"/
  );
  assert.doesNotMatch(
    serverSource,
    /\nasync function callAiModel\(/
  );
  assert.doesNotMatch(
    serverSource,
    /\nasync function aiGenerateLeads\(/
  );
  assert.doesNotMatch(
    serverSource,
    /createAiHttpClient/
  );
  assert.match(
    workerSource,
    /resolveAiSearchProviderFromSnapshot\(this\.store, request\)/
  );
  assert.doesNotMatch(
    workerSource,
    /this\.store\.aiModelConfigs/
  );
});
