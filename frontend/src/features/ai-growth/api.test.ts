import assert from "node:assert/strict";
import test from "node:test";

import {
  AdvisorConflictError,
  AdvisorPreconditionRequiredError,
  createAiGrowthApi,
  readAdvisorResponse,
  type AdvisorRequest,
  type CandidateIdentityConfirmationDto,
  type ContentFetchCreateDto,
  type ContentFetchOperationDto,
  type ImportOperationCreateDto,
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

test("provider lifecycle requests preserve generic 422, 428, 429, and 503 errors", async () => {
  for (const status of [422, 428, 429, 503]) {
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

const contentFetchOperation: ContentFetchOperationDto = {
  id: "fetch-1",
  ownerId: "owner-1",
  teamId: "team-1",
  actorId: "actor-1",
  sourceUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
  finalUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
  subjectChannel: "individual",
  status: "succeeded",
  accessStatus: "public_content",
  httpStatus: 200,
  contentType: "text/html",
  title: "公开抖音主页",
  rawArtifactHash: "sha256:raw",
  contentHash: "sha256:content",
  evidenceCount: 1,
  evidenceIds: ["evidence-profile-1"],
  candidateCount: 0,
  candidateIds: [],
  errorCode: null,
  createdAt: "2026-08-06T00:00:00.000Z",
  startedAt: "2026-08-06T00:00:01.000Z",
  completedAt: "2026-08-06T00:00:02.000Z"
};

test("createContentFetchOperation sends only the public URL, subject channel, and idempotency key", async () => {
  const input: ContentFetchCreateDto = {
    sourceUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    subjectChannel: "individual"
  };
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { ...contentFetchOperation, status: "queued" };
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).createContentFetchOperation(
    input,
    "fixture-fetch-key"
  );

  assert.equal(result.status, "queued");
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/content-fetch-operations",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "fixture-fetch-key"
      },
      body: JSON.stringify(input)
    }
  }]);
});

test("getContentFetchOperation URL-encodes the operation id", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return contentFetchOperation;
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).getContentFetchOperation(
    "fetch/with ?"
  );

  assert.deepEqual(result, contentFetchOperation);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/content-fetch-operations/fetch%2Fwith%20%3F",
    init: undefined
  }]);
});

test("createImportOperation uploads raw CSV bytes with generated query metadata", async () => {
  const content = new TextEncoder().encode(
    "标题,摘要,链接\n公开需求,正在寻找 CRM,https://www.douyin.com/video/1"
  ).buffer;
  const input: ImportOperationCreateDto = {
    fileName: "抖音 线索.csv",
    mediaType: "text/csv",
    content,
    subjectChannel: "individual",
    mapping: {
      sourceTitle: "标题",
      sourceSnippet: "摘要",
      sourcePlatform: "平台",
      sourceUrl: "链接",
      publishedAt: "发布时间",
      locale: "语言"
    }
  };
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { id: "import-1", status: "queued" };
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).createImportOperation(
    input,
    "fixture-import-key"
  );

  assert.deepEqual(result, { id: "import-1", status: "queued" });
  const expectedQuery = new URLSearchParams({
    fileName: input.fileName,
    subjectChannel: input.subjectChannel,
    mapping: JSON.stringify(input.mapping)
  });
  assert.deepEqual(calls, [{
    path: `/api/v1/acquisition/import-operations?${expectedQuery}`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "text/csv",
        "Idempotency-Key": "fixture-import-key"
      },
      body: content
    }
  }]);
});

test("getImportOperation URL-encodes the operation id for truthful status polling", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { id: "import-1", status: "running" };
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).getImportOperation(
    "import/with ?"
  );

  assert.deepEqual(result, { id: "import-1", status: "running" });
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/import-operations/import%2Fwith%20%3F",
    init: undefined
  }]);
});

test("getEvidenceById reads each evidence returned by a completed fetch", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const response = {
    id: "evidence-profile-1",
    targetType: "individual_signal",
    sourcePlatform: "www.douyin.com",
    sourceTitle: "公开抖音主页",
    sourceSnippet: "公开主页简介",
    publishedAt: null,
    fetchedAt: "2026-08-06T00:00:02.000Z",
    locale: "zh-CN",
    rawArtifactHash: "sha256:raw",
    contentHash: "sha256:content",
    provenance: {
      kind: "user_submitted_url",
      sourceUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
    },
    accessStatus: "public_content"
  } as const;
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return response;
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).getEvidenceById(
    "evidence/profile ?"
  );

  assert.deepEqual(result, response);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/evidence/evidence%2Fprofile%20%3F",
    init: undefined
  }]);
});

test("confirmCandidateIdentity sends the exact candidate version and idempotency headers", async () => {
  const input: CandidateIdentityConfirmationDto = {
    subjectKind: "individual",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    sourcePlatform: "douyin",
    evidenceIds: ["evidence-profile-1"],
    rationale: "已人工核对公开主页与原始需求信号。"
  };
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return {
      candidate: {
        id: "candidate-1",
        subjectKind: "individual",
        status: "normalized",
        version: 4,
        identityResolved: true
      },
      resolution: {
        status: "resolved",
        basis: "provider_public_actor",
        resolverVersion: "identity-resolver.v1",
        evidenceIds: ["evidence-profile-1"],
        resolvedAt: "2026-08-06T00:01:00.000Z",
        resolvedBy: "actor-1"
      }
    };
  }) as AdvisorRequest;

  const result = await createAiGrowthApi(request).confirmCandidateIdentity(
    "candidate/1",
    3,
    input,
    "fixture-confirm-key"
  );

  assert.equal(result.candidate.identityResolved, true);
  assert.equal(result.candidate.version, 4);
  assert.deepEqual(calls, [{
    path: "/api/v1/acquisition/candidates/candidate%2F1/identity-confirmation",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "fixture-confirm-key",
        "If-Match": "\"candidate-v3\""
      },
      body: JSON.stringify(input)
    }
  }]);
});

test("confirmCandidateIdentity rejects an invalid candidate version before a request", async () => {
  let requests = 0;
  const request = (async () => {
    requests += 1;
    return {};
  }) as AdvisorRequest;
  const input: CandidateIdentityConfirmationDto = {
    subjectKind: "individual",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    sourcePlatform: "douyin",
    evidenceIds: ["evidence-profile-1"],
    rationale: "已人工核对。"
  };

  await assert.rejects(
    createAiGrowthApi(request).confirmCandidateIdentity(
      "candidate-1",
      0,
      input,
      "fixture-confirm-key"
    ),
    /候选版本必须为正整数/
  );
  assert.equal(requests, 0);
});

test("identity confirmation classifies 409 and 412 without classifying 428 as a conflict", async () => {
  const input: CandidateIdentityConfirmationDto = {
    subjectKind: "individual",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    sourcePlatform: "douyin",
    evidenceIds: ["evidence-profile-1"],
    rationale: "已人工核对。"
  };

  for (const status of [409, 412] as const) {
    const request = (async () => {
      throw Object.assign(new Error(`HTTP ${status}`), { status });
    }) as AdvisorRequest;
    await assert.rejects(
      createAiGrowthApi(request).confirmCandidateIdentity(
        "candidate-1",
        3,
        input,
        "fixture-confirm-key"
      ),
      (error: unknown) =>
        error instanceof AdvisorConflictError && error.status === status
    );
  }

  const request = (async () => {
    throw Object.assign(new Error("HTTP 428"), { status: 428 });
  }) as AdvisorRequest;
  await assert.rejects(
    createAiGrowthApi(request).confirmCandidateIdentity(
      "candidate-1",
      3,
      input,
      "fixture-confirm-key"
    ),
    (error: unknown) =>
      error instanceof AdvisorPreconditionRequiredError
      && error.status === 428
  );
});
