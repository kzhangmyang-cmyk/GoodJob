import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { encryptAiModelApiKey } from "./credential-security.js";
import {
  bindActiveModelSnapshot,
  createActiveModelGatewayForSnapshot,
  createStoreModelCallLedger,
  resolveSnapshottedModelCredential
} from "./model-providers/runtime.js";
import type {
  ModelRuntimeStore
} from "./model-providers/runtime.js";
import type { AiModelConfig } from "./types.js";
import {
  callAiModelWithRuntime
} from "./ai-model-runtime.js";
import {
  setProviderHttpTestTransport
} from "./provider-http-client.js";

const createdAt = "2026-07-23T10:00:00.000Z";
const ownerId = "u_runtime";
const teamId = "t_runtime";

function config(
  id: string,
  enabled: boolean,
  credentialVersion: number
): AiModelConfig {
  return {
    id,
    provider: "moonshot",
    protocol: "openai-compatible",
    name: id,
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    apiKey: "",
    enabled,
    temperature: 0.1,
    useLeadFinder: true,
    useWebsiteParse: true,
    useScoring: true,
    useEmailDraft: true,
    useExam: false,
    lastTestStatus: "untested",
    lastTestMessage: "",
    ownerId,
    teamId,
    credentialVersion,
    capabilitySnapshot: {
      structuredOutput: true,
      toolCalling: true,
      parallelToolCalling: false,
      streaming: true,
      modelListing: true
    },
    createdAt,
    updatedAt: createdAt
  };
}

function runtimeStore(): ModelRuntimeStore {
  const active = config("conn_active", true, 2);
  const old = config("conn_old", false, 1);
  return {
    aiModelConfigs: [active, old],
    modelCredentialVersions: [
      {
        connectionId: active.id,
        ownerId,
        teamId,
        version: 1,
        credentialRef: "cred_active_v1",
        apiKeyEncrypted: encryptAiModelApiKey({
          id: active.id,
          provider: active.provider,
          ownerId,
          teamId
        }, "sk-active-v1"),
        keyMask: "e-v1",
        createdBy: ownerId,
        createdAt
      },
      {
        connectionId: active.id,
        ownerId,
        teamId,
        version: 2,
        credentialRef: "cred_active_v2",
        apiKeyEncrypted: encryptAiModelApiKey({
          id: active.id,
          provider: active.provider,
          ownerId,
          teamId
        }, "sk-active-v2"),
        keyMask: "e-v2",
        createdBy: ownerId,
        createdAt
      }
    ],
    aiJobModelSnapshots: [],
    pendingAiJobModelSnapshots: [],
    modelCallRecords: [],
    pendingModelCallRecords: []
  };
}

test("binding an AI job snapshots the active connection once for all retries", () => {
  const store = runtimeStore();
  const first = bindActiveModelSnapshot(store, {
    jobId: "job_search_1",
    ownerId,
    teamId,
    promptVersion: "ai-search.v1",
    schemaVersion: "ai-search-result.v1"
  });
  store.aiModelConfigs[0].enabled = false;
  store.aiModelConfigs[1].enabled = true;
  const retry = bindActiveModelSnapshot(store, {
    jobId: "job_search_1",
    ownerId,
    teamId,
    promptVersion: "changed-prompt-must-not-win",
    schemaVersion: "changed-schema-must-not-win"
  });

  assert.deepEqual(retry, first);
  assert.equal(first.connectionId, "conn_active");
  assert.equal(first.credentialVersion, 2);
  assert.equal(first.promptVersion, "ai-search.v1");
  assert.equal(first.baseUrl, "https://api.moonshot.cn/v1");
  assert.match(
    first.baseUrlFingerprint || "",
    /^sha256:[0-9a-f]{64}$/
  );
  assert.equal(store.aiJobModelSnapshots.length, 1);
  assert.equal(store.pendingAiJobModelSnapshots.length, 1);
});

test("credential resolution decrypts the exact snapshotted version", async () => {
  const store = runtimeStore();
  assert.equal(
    await resolveSnapshottedModelCredential(
      store,
      "conn_active",
      2
    ),
    "sk-active-v2"
  );
  await assert.rejects(
    resolveSnapshottedModelCredential(store, "conn_active", 9),
    /credential version/i
  );
});

test("store ledger is append-only and queues only new records", () => {
  const store = runtimeStore();
  const ledger = createStoreModelCallLedger(store, {
    idFactory: () => "model_call_runtime",
    now: () => createdAt
  });
  const stored = ledger.append({
    ownerId,
    teamId,
    jobId: "job_search_1",
    attemptId: "attempt_1",
    connectionId: "conn_active",
    credentialVersion: 2,
    capabilitySnapshotHash: "sha256:capability",
    provider: "moonshot",
    baseUrlFingerprint: "sha256:base",
    model: "moonshot-v1-8k",
    promptVersion: "ai-search.v1",
    schemaVersion: "ai-search-result.v1",
    requestId: "request_1",
    providerRequestId: null,
    inputTokens: 3,
    outputTokens: 2,
    reasoningTokens: 0,
    latencyMs: 5,
    status: "succeeded",
    error: null,
    cost: {
      amountMinor: 0,
      currency: "USD",
      kind: "unknown"
    },
    parameterHash: "sha256:params",
    resultHash: "sha256:result"
  });
  assert.equal(store.modelCallRecords[0], stored);
  assert.equal(store.pendingModelCallRecords[0], stored);
  assert.throws(() => {
    (stored as { status: string }).status = "failed";
  }, TypeError);
});

test("runtime gateway uses the stored snapshot, exact credential, and durable ledger", async () => {
  const store = runtimeStore();
  const snapshot = bindActiveModelSnapshot(store, {
    jobId: "job_search_2",
    ownerId,
    teamId,
    promptVersion: "ai-search.v1",
    schemaVersion: "ai-search-result.v1"
  });
  const requests: RequestInit[] = [];
  let requestedUrl = "";
  store.aiModelConfigs[0].baseUrl = "https://changed.invalid/v1";
  const gateway = createActiveModelGatewayForSnapshot(store, {
    storedSnapshot: snapshot,
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requests.push(init || {});
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: "{\"companies\":[]}"
          },
          finish_reason: "stop"
        }],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 2
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const result = await gateway.generateStructured({
    prompt: "private prompt",
    schema: (await import("zod")).z.object({
      companies: (await import("zod")).z.array(
        (await import("zod")).z.unknown()
      )
    }).strict()
  });
  assert.deepEqual(result.value, { companies: [] });
  assert.equal(
    requestedUrl,
    "https://api.moonshot.cn/v1/chat/completions"
  );
  const authorization = new Headers(requests[0].headers)
    .get("authorization");
  assert.equal(authorization, "Bearer sk-active-v2");
  assert.equal(store.modelCallRecords.length, 1);
  assert.equal(store.pendingModelCallRecords.length, 1);
  assert.equal(
    JSON.stringify(store.modelCallRecords).includes("private prompt"),
    false
  );
  assert.equal(
    store.modelCallRecords[0].capabilitySnapshotHash,
    `sha256:${createHash("sha256")
      .update(JSON.stringify(snapshot.capabilitySnapshot))
      .digest("hex")}`
  );
});

test("official compatibility runtime delegates to the gateway and durable ledger", async () => {
  const store = runtimeStore();
  const ordering: string[] = [];
  const persistedStore = {
    ...store,
    async persist() {
      ordering.push(`persist:${this.pendingAiJobModelSnapshots.length}:`
        + `${this.pendingModelCallRecords.length}`);
      this.pendingAiJobModelSnapshots.splice(0);
      this.pendingModelCallRecords.splice(0);
    }
  };
  const active = store.aiModelConfigs[0];
  const content = await callAiModelWithRuntime(
    persistedStore,
    active,
    "return json",
    4_000,
    async () => {
      ordering.push("fetch");
      return new Response(JSON.stringify({
        choices: [{
          message: { content: "{\"ok\":true}" },
          finish_reason: "stop"
        }],
        usage: {
          prompt_tokens: 2,
          completion_tokens: 1
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    {
      jobId: "job_compatibility",
      promptVersion: "legacy-json.v1",
      schemaVersion: "legacy-json-object.v1"
    }
  );
  assert.equal(content, "{\"ok\":true}");
  assert.equal(store.aiJobModelSnapshots.length, 1);
  assert.equal(store.modelCallRecords.length, 1);
  assert.equal(store.modelCallRecords[0].jobId, "job_compatibility");
  assert.deepEqual(ordering, [
    "persist:1:0",
    "fetch",
    "persist:0:1"
  ]);
});

test("compatibility retries keep the snapshotted endpoint after live config mutation", async (t) => {
  const store = runtimeStore();
  const active = store.aiModelConfigs[0];
  let persistCount = 0;
  const persistedStore = {
    ...store,
    async persist() {
      persistCount += 1;
      this.pendingAiJobModelSnapshots.splice(0);
      this.pendingModelCallRecords.splice(0);
      if (persistCount === 1) {
        active.baseUrl = "https://changed.invalid/v1";
      }
    }
  };
  let requestedUrl = "";
  setProviderHttpTestTransport(async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({
      choices: [{
        message: { content: "{\"ok\":true}" },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 1
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  t.after(() => setProviderHttpTestTransport(null));

  const content = await callAiModelWithRuntime(
    persistedStore,
    active,
    "return json",
    4_000,
    undefined,
    {
      jobId: "job_endpoint_retry",
      promptVersion: "legacy-json.v1",
      schemaVersion: "legacy-json-object.v1"
    }
  );

  assert.equal(content, "{\"ok\":true}");
  assert.equal(
    requestedUrl,
    "https://api.moonshot.cn/v1/chat/completions"
  );
  assert.equal(
    store.aiJobModelSnapshots[0].baseUrl,
    "https://api.moonshot.cn/v1"
  );
});

test("compatibility runtime reports provider and audit persistence failures together", async () => {
  const store = runtimeStore();
  let persistCount = 0;
  const persistedStore = {
    ...store,
    async persist() {
      persistCount += 1;
      if (persistCount === 1) {
        this.pendingAiJobModelSnapshots.splice(0);
        return;
      }
      throw new Error("audit database unavailable");
    }
  };

  await assert.rejects(
    callAiModelWithRuntime(
      persistedStore,
      store.aiModelConfigs[0],
      "return json",
      4_000,
      async () => new Response(
        JSON.stringify({ error: { message: "provider rejected" } }),
        {
          status: 503,
          headers: { "content-type": "application/json" }
        }
      ),
      {
        jobId: "job_dual_failure",
        promptVersion: "legacy-json.v1",
        schemaVersion: "legacy-json-object.v1"
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(String(error.errors[0]), /503|provider|服务/i);
      assert.match(String(error.errors[1]), /audit database unavailable/);
      return true;
    }
  );
  assert.equal(store.modelCallRecords.length, 1);
  assert.equal(store.modelCallRecords[0].status, "failed");
});
