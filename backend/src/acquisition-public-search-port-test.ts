import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptProviderConfiguration } from "./credential-security.js";
import {
  ProviderContractError,
  type LeadProvider,
  type ProviderPage
} from "./provider-contract.js";
import { createDefaultProviderCatalog } from "./provider-catalog.js";
import type { PersistedStoreMutation } from "./store.js";
import type {
  ProviderConnection,
  ProviderRequestLog
} from "./types.js";
import {
  AcquisitionPublicSearchPortError,
  createAcquisitionPublicSearchPort,
  type AcquisitionPublicSearchStore,
  type AcquisitionProviderSearchExecutor
} from "./acquisition-public-search-port.js";

process.env.JWT_SECRET =
  "goodjob-acquisition-public-search-test-secret-at-least-32-characters";

const NOW = "2026-07-24T08:00:00.000Z";

function connection(
  providerId: string,
  overrides: Partial<ProviderConnection> = {}
): ProviderConnection {
  const identity = {
    id: `connection_${providerId}`,
    providerId,
    ownerId: "owner-a",
    teamId: "team-a",
    ...overrides
  };
  return {
    ...identity,
    scope: "personal",
    credentialRef: `credential_${providerId}`,
    configurationEncrypted: encryptProviderConfiguration(identity, {
      apiKey: `${providerId}-official-api-key`,
      baseUrl: ""
    }),
    status: "active",
    quotaPolicy: {},
    budgetPolicy: {},
    lastHealthAt: "",
    lastHealthStatus: "untested",
    lastErrorCode: "",
    lastHealthMessage: "",
    usage: "",
    createdBy: identity.ownerId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function requestLog(input: {
  provider: LeadProvider;
  connection: ProviderConnection;
  runId: string;
}): ProviderRequestLog {
  return {
    id: `log_${input.provider.id}`,
    teamId: input.connection.teamId,
    ownerId: input.connection.ownerId,
    providerId: input.provider.id,
    connectionId: input.connection.id,
    runId: input.runId,
    runShardId: `${input.runId}_${input.provider.id}`,
    requestFingerprint: "a".repeat(64),
    endpointCode: "search",
    httpStatus: 200,
    attempt: 1,
    quotaUnits: 1,
    costAmount: 0,
    currency: "",
    durationMs: 12,
    responseSize: 1024,
    errorCode: "",
    requestedAt: NOW
  };
}

function providerPage(): ProviderPage {
  return {
    status: "success",
    records: [
      {
        company: "厦门增长科技有限公司",
        officialWebsite: "https://growth.example.cn/",
        website: "https://growth.example.cn/",
        country: "中国 福建 厦门",
        business: "企业获客与销售增长",
        contact: "不应输出的联系人",
        contactInfo: "private@example.cn",
        description: "公开采购需求：正在寻找全网商机识别与渠道 ROI 方案。",
        confidence: 0,
        providerRecordId: "public-company-1",
        sourceUrl: "https://news.example.cn/procurement/growth",
        recordType: "discovery_page",
        fetchedAt: NOW,
        payloadHash: "1".repeat(64),
        evidenceSummary: "公开搜索索引摘要",
        matchedFields: ["company", "description", "sourceUrl"],
        adapterVersion: "1.0",
        catalogPolicyVersion: "1.0",
        sourceLevel: "discovery",
        retentionPolicyRef: "public"
      },
      {
        company: "门店主理人林女士",
        officialWebsite: "",
        website: "",
        country: "中国 厦门",
        business: "门店经营",
        contact: "不应输出的手机号",
        contactInfo: "13800000000",
        description: "公开咨询获客系统，正在比较方案并询问报价，请勿电话推销。",
        confidence: 0,
        providerRecordId: "public-profile-1",
        sourceUrl: "https://www.xiaohongshu.com/user/profile/public-actor",
        recordType: "discovery_page",
        fetchedAt: NOW,
        payloadHash: "2".repeat(64),
        evidenceSummary: "公开个人主页的索引摘要",
        matchedFields: ["company", "description", "sourceUrl"],
        adapterVersion: "1.0",
        catalogPolicyVersion: "1.0",
        sourceLevel: "discovery",
        retentionPolicyRef: "public"
      }
    ],
    nextCursor: null,
    exhausted: true,
    rawCount: 2,
    validCount: 2,
    invalidCount: 0,
    duplicateCount: 0,
    warnings: [],
    usage: {
      requestCount: 1,
      quotaUsed: 1,
      quotaRemaining: null,
      costAmount: null,
      currency: null,
      estimated: false,
      display: ""
    }
  };
}

function createStore(input: {
  connections?: ProviderConnection[];
  persist?: () => Promise<void>;
  useAtomicPersistence?: boolean;
} = {}): AcquisitionPublicSearchStore {
  const store: AcquisitionPublicSearchStore = {
    providerCatalog: createDefaultProviderCatalog(),
    providerConnections: input.connections ?? [connection("baidu_ai_search")],
    providerRequestLogs: [],
    persist: input.persist ?? (async () => undefined)
  };
  if (input.useAtomicPersistence) {
    store.persistMutation = async <T>(
      mutation: () => PersistedStoreMutation<T>
    ) => {
      const applied = mutation();
      try {
        await store.persist();
        return applied.value;
      } catch (error) {
        applied.rollback();
        throw error;
      }
    };
  }
  return store;
}

function searchInput(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "actor-a",
    sessionId: "session-a",
    providerConnectionId: "connection_baidu_ai_search",
    query: "厦门 企业 正在寻找 AI 获客系统",
    subjectKinds: ["organization", "individual"] as Array<
      "organization" | "individual"
    >,
    maxResults: 10,
    ...overrides
  };
}

test("uses an authorized official BYOK connection and maps public organization and individual signals", async () => {
  const store = createStore({ useAtomicPersistence: true });
  let executionInput:
    | Parameters<AcquisitionProviderSearchExecutor>[0]
    | undefined;
  const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
    executionInput = input;
    input.onLogs([
      requestLog({
        provider: input.provider,
        connection: input.connection,
        runId: input.context.runId
      })
    ]);
    return providerPage();
  };
  const port = createAcquisitionPublicSearchPort(store, { executeSearch });

  const response = await port.search(searchInput());

  assert.equal(executionInput?.provider.id, "baidu_ai_search");
  assert.equal(executionInput?.connection.id, "connection_baidu_ai_search");
  assert.deepEqual(executionInput?.query, {
    goal: "厦门 企业 正在寻找 AI 获客系统",
    productKeywords: "",
    countries: "",
    industry: "",
    customerType: "企业,个人公开需求",
    excludeKeywords: "",
    limit: 10
  });
  assert.equal(response.provider, "baidu_ai_search");
  assert.equal(response.providerConnectionId, "connection_baidu_ai_search");
  assert.match(response.requestId || "", /^preq_/);
  assert.equal(response.results.length, 2);

  const organization = response.results.find(
    (result) => result.subject.kind === "organization"
  );
  assert(organization);
  assert.equal(organization.accessStatus, "indexed_summary");
  assert.match(organization.rawArtifactHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(organization.subject, {
    kind: "organization",
    name: "厦门增长科技有限公司",
    domain: "growth.example.cn",
    region: "中国 福建 厦门",
    creditCode: null,
    organizationId: null
  });

  const individual = response.results.find(
    (result) => result.subject.kind === "individual"
  );
  assert(individual && individual.subject.kind === "individual");
  assert.match(individual.subject.publicActorKey, /^public:baidu_ai_search:sha256:/);
  assert.equal(
    individual.subject.publicProfileUrl,
    "https://www.xiaohongshu.com/user/profile/public-actor"
  );
  assert.equal(individual.subject.buyingStage, "comparison");
  assert.deepEqual(individual.subject.negativeSignals, ["请勿电话推销"]);
  assert.equal(individual.subject.individualPartyId, null);

  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes("private@example.cn"), false);
  assert.equal(serialized.includes("13800000000"), false);
  assert.equal(serialized.includes("不应输出"), false);
  assert.equal(store.providerRequestLogs.length, 1);
});

test("supports all three approved real search providers", async () => {
  for (const providerId of [
    "baidu_ai_search",
    "tencent_web_search",
    "tavily"
  ]) {
    const selected = connection(providerId);
    const store = createStore({ connections: [selected] });
    const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
      input.onLogs([
        requestLog({
          provider: input.provider,
          connection: input.connection,
          runId: input.context.runId
        })
      ]);
      return { ...providerPage(), records: [] };
    };
    const response = await createAcquisitionPublicSearchPort(store, {
      executeSearch
    }).search(searchInput({
      providerConnectionId: selected.id,
      subjectKinds: ["organization"]
    }));
    assert.equal(response.provider, providerId);
  }
});

test("does not misclassify an organization page merely because its snippet mentions a decision maker", async () => {
  const store = createStore();
  const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
    input.onLogs([
      requestLog({
        provider: input.provider,
        connection: input.connection,
        runId: input.context.runId
      })
    ]);
    const page = providerPage();
    page.records = [{
      ...page.records[0]!,
      company: "厦门供应链科技有限公司",
      description: "采购负责人正在公开调研企业获客方案。"
    }];
    return page;
  };

  const response = await createAcquisitionPublicSearchPort(store, {
    executeSearch
  }).search(searchInput({ subjectKinds: ["organization", "individual"] }));

  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.subject.kind, "organization");
});

test("raw artifact hashes change when the indexed public evidence changes", async () => {
  async function hashFor(description: string) {
    const store = createStore();
    const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
      input.onLogs([
        requestLog({
          provider: input.provider,
          connection: input.connection,
          runId: input.context.runId
        })
      ]);
      const page = providerPage();
      page.records = [{ ...page.records[0]!, description }];
      return page;
    };
    const response = await createAcquisitionPublicSearchPort(store, {
      executeSearch
    }).search(searchInput({ subjectKinds: ["organization"] }));
    return response.results[0]!.rawArtifactHash;
  }

  assert.notEqual(
    await hashFor("公开需求版本一"),
    await hashFor("公开需求版本二")
  );
});

test("does not reveal whether a missing, cross-tenant, disabled, or non-personal connection exists", async () => {
  const inaccessibleConnections = [
    connection("baidu_ai_search", { ownerId: "other-owner" }),
    connection("baidu_ai_search", {
      id: "disabled",
      status: "disabled"
    }),
    connection("baidu_ai_search", {
      id: "team-scope",
      scope: "team"
    })
  ];
  let calls = 0;
  const executeSearch: AcquisitionProviderSearchExecutor = async () => {
    calls += 1;
    return providerPage();
  };
  const port = createAcquisitionPublicSearchPort(
    createStore({ connections: inaccessibleConnections }),
    { executeSearch }
  );

  for (const providerConnectionId of [
    inaccessibleConnections[0]!.id,
    "disabled",
    "team-scope",
    "does-not-exist"
  ]) {
    await assert.rejects(
      port.search(searchInput({ providerConnectionId })),
      (error: unknown) =>
        error instanceof AcquisitionPublicSearchPortError
        && error.code === "PROVIDER_CONNECTION_UNAVAILABLE"
        && !error.message.includes(providerConnectionId)
    );
  }
  assert.equal(calls, 0);
});

test("rejects unsupported or unreadable BYOK connections before execution", async () => {
  let calls = 0;
  const executeSearch: AcquisitionProviderSearchExecutor = async () => {
    calls += 1;
    return providerPage();
  };
  const unsupported = connection("serper");
  const broken = connection("tavily", {
    id: "broken",
    configurationEncrypted: "not-an-encrypted-credential"
  });

  await assert.rejects(
    createAcquisitionPublicSearchPort(
      createStore({ connections: [unsupported] }),
      { executeSearch }
    ).search(searchInput({ providerConnectionId: unsupported.id })),
    (error: unknown) =>
      error instanceof AcquisitionPublicSearchPortError
      && error.code === "PROVIDER_NOT_SUPPORTED"
  );
  await assert.rejects(
    createAcquisitionPublicSearchPort(
      createStore({ connections: [broken] }),
      { executeSearch }
    ).search(searchInput({ providerConnectionId: "broken" })),
    (error: unknown) =>
      error instanceof AcquisitionPublicSearchPortError
      && error.code === "PROVIDER_CONNECTION_UNAVAILABLE"
  );
  assert.equal(calls, 0);
});

test("persists provider audit logs on search failure and sanitizes an unknown provider error", async () => {
  const selected = connection("tavily");
  let persisted = 0;
  const store = createStore({
    connections: [selected],
    persist: async () => {
      persisted += 1;
    }
  });
  const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
    const log = requestLog({
      provider: input.provider,
      connection: input.connection,
      runId: input.context.runId
    });
    log.httpStatus = 500;
    log.errorCode = "provider_internal_error";
    input.onLogs([log]);
    throw new Error("SECRET_API_KEY=must-never-leak");
  };

  await assert.rejects(
    createAcquisitionPublicSearchPort(store, { executeSearch })
      .search(searchInput({
        providerConnectionId: selected.id,
        subjectKinds: ["organization"]
      })),
    (error: unknown) =>
      error instanceof ProviderContractError
      && error.code === "PROVIDER_INTERNAL_ERROR"
      && !error.message.includes("SECRET_API_KEY")
  );
  assert.equal(persisted, 1);
  assert.equal(store.providerRequestLogs.length, 1);
});

test("rolls back transient logs and returns a safe combined error when provider and persistence both fail", async () => {
  const store = createStore({
    persist: async () => {
      throw new Error("mysql://private-user:private-pass@db.internal");
    }
  });
  const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
    input.onLogs([
      requestLog({
        provider: input.provider,
        connection: input.connection,
        runId: input.context.runId
      })
    ]);
    throw new Error("SECRET_API_KEY=must-never-leak");
  };

  await assert.rejects(
    createAcquisitionPublicSearchPort(store, { executeSearch })
      .search(searchInput()),
    (error: unknown) =>
      error instanceof AcquisitionPublicSearchPortError
      && error.code === "SEARCH_AND_AUDIT_PERSISTENCE_FAILED"
      && !error.message.includes("SECRET_API_KEY")
      && !error.message.includes("private-pass")
  );
  assert.equal(store.providerRequestLogs.length, 0);
});

test("rejects a successful response when its audit log cannot be made durable", async () => {
  const store = createStore({
    useAtomicPersistence: true,
    persist: async () => {
      throw new Error("database credentials must not leak");
    }
  });
  const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
    input.onLogs([
      requestLog({
        provider: input.provider,
        connection: input.connection,
        runId: input.context.runId
      })
    ]);
    return providerPage();
  };

  await assert.rejects(
    createAcquisitionPublicSearchPort(store, { executeSearch })
      .search(searchInput()),
    (error: unknown) =>
      error instanceof AcquisitionPublicSearchPortError
      && error.code === "AUDIT_PERSISTENCE_FAILED"
      && !error.message.includes("credentials")
  );
  assert.equal(store.providerRequestLogs.length, 0);
});

test("rejects mismatched audit logs and does not persist them", async () => {
  const store = createStore();
  const executeSearch: AcquisitionProviderSearchExecutor = async (input) => {
    const forged = requestLog({
      provider: input.provider,
      connection: input.connection,
      runId: input.context.runId
    });
    forged.ownerId = "other-owner";
    input.onLogs([forged]);
    return providerPage();
  };

  await assert.rejects(
    createAcquisitionPublicSearchPort(store, { executeSearch })
      .search(searchInput()),
    (error: unknown) =>
      error instanceof AcquisitionPublicSearchPortError
      && error.code === "INVALID_PROVIDER_AUDIT_LOG"
  );
  assert.equal(store.providerRequestLogs.length, 0);
});

test("honors a pre-aborted acquisition request without calling a provider", async () => {
  let calls = 0;
  const executeSearch: AcquisitionProviderSearchExecutor = async () => {
    calls += 1;
    return providerPage();
  };
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    createAcquisitionPublicSearchPort(createStore(), { executeSearch })
      .search(searchInput({ signal: controller.signal })),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError"
  );
  assert.equal(calls, 0);
});
