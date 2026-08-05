import assert from "node:assert/strict";
import test from "node:test";

import {
  createAiGrowthApi,
  readAdvisorResponse,
  type AdvisorRequest,
  type ProviderCatalogPageDto,
  type ProviderConnectionCreateDto,
  type ProviderConnectionDto,
  type ProviderConnectionTestDto,
  type ProviderConnectionUpdateDto
} from "./api.js";

const providerConnection: ProviderConnectionDto = {
  id: "connection-1",
  ownerId: "owner-1",
  teamId: null,
  providerId: "tavily",
  kind: "search",
  status: "active",
  credentialVersion: 1,
  lastHealthAt: null,
  lastHealthStatus: "untested",
  lastErrorCode: null,
  lastHealthMessage: "Not tested",
  usage: "search",
  createdAt: "2026-08-06T00:00:00.000Z"
};

test("readAdvisorResponse does not parse an empty 204 response", async () => {
  const response = new Response(null, { status: 204 });

  assert.equal(await readAdvisorResponse<void>(response), undefined);
  assert.equal(response.bodyUsed, false);
});

test("listProviders requests the generated provider catalog contract", async () => {
  const catalog: ProviderCatalogPageDto = {
    items: [{
      id: "tavily",
      kind: "search",
      displayName: "Tavily",
      officialDocsUrl: "https://docs.tavily.com",
      requiresKey: true,
      capabilities: ["web_search"]
    }],
    nextCursor: null
  };
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return catalog;
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).listProviders();

  assert.deepEqual(result, catalog);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/providers",
    init: undefined
  }]);
});

test("createProviderConnection sends only the approved JSON and idempotency headers", async () => {
  const input: ProviderConnectionCreateDto = {
    providerId: "tavily",
    apiKey: "fixture-secret-never-log",
    status: "active"
  };
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return providerConnection;
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).createProviderConnection(
    input,
    "fixture-idempotency-1"
  );

  assert.deepEqual(result, providerConnection);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/provider-connections",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "fixture-idempotency-1"
      },
      body: JSON.stringify(input)
    }
  }]);
});

test("getProviderConnection URL-encodes the connection id", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return providerConnection;
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).getProviderConnection(
    "connection/with ?"
  );

  assert.deepEqual(result, providerConnection);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/provider-connections/connection%2Fwith%20%3F",
    init: undefined
  }]);
});

test("updateProviderConnection sends PATCH JSON without invented write headers", async () => {
  const input: ProviderConnectionUpdateDto = {
    apiKey: "fixture-secret-never-log",
    status: "active"
  };
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { ...providerConnection, credentialVersion: 2 };
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).updateProviderConnection(
    "connection/with ?",
    input
  );

  assert.equal(result.credentialVersion, 2);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/provider-connections/connection%2Fwith%20%3F",
    init: {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  }]);
});

test("deleteProviderConnection accepts a 204 without parsing a response body", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return undefined;
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).deleteProviderConnection(
    "connection/with ?"
  );

  assert.equal(result, undefined);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/provider-connections/connection%2Fwith%20%3F",
    init: { method: "DELETE" }
  }]);
});

test("testProviderConnection preserves both successful and failed HTTP 200 health payloads", async () => {
  const healthy: ProviderConnectionTestDto = {
    ok: true,
    message: "Connection passed",
    errorCode: null,
    retryable: false,
    retryAfterAt: null,
    usage: "search"
  };
  const unhealthy: ProviderConnectionTestDto = {
    ok: false,
    message: "Provider unavailable",
    errorCode: "PROVIDER_UNAVAILABLE",
    retryable: true,
    retryAfterAt: "2026-08-06T00:01:00.000Z",
    usage: "search"
  };
  const responses = [healthy, unhealthy];
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return responses.shift();
  }) as AdvisorRequest;
  const api = createAiGrowthApi(request);

  assert.deepEqual(await api.testProviderConnection("connection/1"), healthy);
  assert.deepEqual(await api.testProviderConnection("connection/1"), unhealthy);
  assert.deepEqual(calls, [
    {
      path: "/api/v1/acquisition/provider-connections/connection%2F1/test",
      init: { method: "POST" }
    },
    {
      path: "/api/v1/acquisition/provider-connections/connection%2F1/test",
      init: { method: "POST" }
    }
  ]);
});

test("provider lifecycle requests preserve generic 422, 429, and 503 errors", async () => {
  for (const status of [422, 429, 503]) {
    const expected = Object.assign(new Error(`HTTP ${status}`), { status });
    const request = (async () => {
      throw expected;
    }) as AdvisorRequest;

    await assert.rejects(
      createAiGrowthApi(request).testProviderConnection("connection-1"),
      (error: unknown) => error === expected
    );
  }
});
