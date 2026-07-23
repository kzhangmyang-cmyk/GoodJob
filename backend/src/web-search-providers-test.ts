import assert from "node:assert/strict";
import {
  ProviderContractError,
  normalizeProviderPage,
  normalizeProviderQuery,
  providerErrorFromUnknown,
  type LeadProvider
} from "./provider-contract.js";
import { createDefaultProviderCatalog } from "./provider-catalog.js";
import {
  createProviderHttpClient,
  setProviderHttpTestTransport
} from "./provider-http-client.js";
import { LEAD_PROVIDERS } from "./lead-providers.js";
import {
  BAIDU_AI_SEARCH_PROVIDER,
  REAL_WEB_SEARCH_PROVIDERS,
  TAVILY_SEARCH_PROVIDER,
  TENCENT_WEB_SEARCH_PROVIDER
} from "./web-search-providers.js";

const query = normalizeProviderQuery({
  goal: "寻找正在采购工业照明的中国企业",
  productKeywords: "工业照明, LED",
  countries: "中国",
  industry: "制造业",
  customerType: "采购商",
  excludeKeywords: "招聘",
  limit: 7
});

function tools(provider: LeadProvider) {
  return {
    http: createProviderHttpClient(provider.networkPolicy)
  };
}

function catalog(provider: LeadProvider) {
  const item = createDefaultProviderCatalog()
    .find((candidate) => candidate.code === provider.id);
  assert.ok(item, `${provider.id} should be visible in the provider catalog`);
  return item;
}

function normalize(provider: LeadProvider, page: unknown) {
  const item = catalog(provider);
  return normalizeProviderPage({
    provider,
    catalogPolicyVersion: item.version,
    sourceLevel: item.sourceLevel,
    allowedFields: item.allowedFields,
    retentionPolicy: item.retentionPolicy,
    page
  });
}

let requestedUrl = "";
let requestedInit: RequestInit | undefined;
setProviderHttpTestTransport(async (url, init) => {
  requestedUrl = url;
  requestedInit = init;
  return new Response(JSON.stringify({
    request_id: "baidu-request-1",
    references: [
      {
        id: 1,
        title: "华东照明有限公司 - 工业照明方案",
        url: "https://lighting.example.cn/solutions/industrial",
        snippet: "华东照明公开发布的工业照明方案摘要。",
        content: "不应替代 snippet 的索引片段。",
        date: "2026-07-22 09:00:00",
        type: "web"
      },
      {
        id: 2,
        title: "视频结果",
        url: "https://video.example.cn/2",
        content: "视频摘要",
        type: "video"
      },
      {
        id: 3,
        title: "缺少 URL",
        snippet: "无效网页结果",
        type: "web"
      }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });
});

const baiduPage = await BAIDU_AI_SEARCH_PROVIDER.search!(
  { query, cursor: "" },
  { apiKey: "baidu-private-key" },
  tools(BAIDU_AI_SEARCH_PROVIDER)
);
assert.equal(requestedUrl, "https://qianfan.baidubce.com/v2/ai_search/web_search");
assert.equal(new URL(requestedUrl).search, "");
const baiduHeaders = new Headers(requestedInit?.headers);
assert.equal(baiduHeaders.get("x-appbuilder-authorization"), "Bearer baidu-private-key");
assert.equal(baiduHeaders.get("authorization"), null);
assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
  messages: [{ role: "user", content: "寻找正在采购工业照明的中国企业 led 工业照明 制造业 采购商 中国 -招聘" }],
  search_source: "baidu_search_v2",
  resource_type_filter: [{ type: "web", top_k: 7 }],
  safe_search: true
});
assert.equal(baiduPage.rawCount, 3);
assert.equal(baiduPage.records.length, 1);
assert.equal(baiduPage.invalidCount, 1);
assert.match(baiduPage.warnings?.join("\n") || "", /非网页结果 1 条/);
assert.match(baiduPage.warnings?.join("\n") || "", /无效网页结果 1 条/);
assert.equal(baiduPage.records[0]?.sourceUrl, "https://lighting.example.cn/solutions/industrial");
assert.equal(baiduPage.records[0]?.description, "华东照明公开发布的工业照明方案摘要。");
assert.equal(baiduPage.records[0]?.recordType, "discovery_page");
assert.equal(baiduPage.records[0]?.providerRecordId, "baidu-request-1:1");
assert.match(baiduPage.records[0]?.evidenceSummary || "", /百度索引第 1 名/);
assert.match(baiduPage.records[0]?.evidenceSummary || "", /2026-07-22/);
assert.equal(normalize(BAIDU_AI_SEARCH_PROVIDER, baiduPage).status, "partial_success");
assert.equal(String(requestedUrl).includes("baidu-private-key"), false);

setProviderHttpTestTransport(async (url, init) => {
  requestedUrl = url;
  requestedInit = init;
  return new Response(JSON.stringify({
    Response: {
      Query: "工业照明",
      RequestId: "tencent-request-1",
      Pages: [
        JSON.stringify({
          title: "华南工厂采购公告",
          date: "2026-07-21 12:00:00",
          url: "https://factory.example.cn/purchase/lighting",
          passage: "该工厂发布的工业照明采购信息索引摘要。",
          content: "尊享版动态摘要不应覆盖标准摘要。",
          site: "示例工厂",
          score: 0.87
        }),
        "{broken-json",
        JSON.stringify({ title: "缺少 URL", passage: "无效" })
      ]
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
});

const tencentPage = await TENCENT_WEB_SEARCH_PROVIDER.search!(
  { query, cursor: "" },
  { apiKey: "tencent-private-key" },
  tools(TENCENT_WEB_SEARCH_PROVIDER)
);
assert.equal(requestedUrl, "https://api.wsa.cloud.tencent.com/SearchPro");
assert.equal(new URL(requestedUrl).search, "");
const tencentHeaders = new Headers(requestedInit?.headers);
assert.equal(tencentHeaders.get("authorization"), "Bearer tencent-private-key");
assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
  Query: "寻找正在采购工业照明的中国企业 led 工业照明 制造业 采购商 中国 -招聘",
  Mode: 0,
  Cnt: 10
});
assert.equal(tencentPage.rawCount, 3);
assert.equal(tencentPage.records.length, 1);
assert.equal(tencentPage.invalidCount, 2);
assert.match(tencentPage.warnings?.join("\n") || "", /无效结果 2 条/);
assert.equal(tencentPage.records[0]?.sourceUrl, "https://factory.example.cn/purchase/lighting");
assert.equal(tencentPage.records[0]?.description, "该工厂发布的工业照明采购信息索引摘要。");
assert.equal(tencentPage.records[0]?.providerRecordId, "tencent-request-1:1");
assert.equal(tencentPage.records[0]?.confidence, 87);
assert.match(tencentPage.records[0]?.evidenceSummary || "", /腾讯联网搜索第 1 名/);
assert.match(tencentPage.records[0]?.evidenceSummary || "", /示例工厂/);
assert.equal(String(requestedUrl).includes("tencent-private-key"), false);

const largerTencentQuery = normalizeProviderQuery({
  ...query,
  productKeywords: query.productKeywords.join(","),
  countries: query.countries.join(","),
  industry: query.industries.join(","),
  customerType: query.customerTypes.join(","),
  excludeKeywords: query.excludeKeywords.join(","),
  limit: 30
});
setProviderHttpTestTransport(async (_url, init) => {
  requestedInit = init;
  return new Response(JSON.stringify({
    Response: { Query: "test", RequestId: "tencent-request-2", Pages: [] }
  }), { status: 200 });
});
await TENCENT_WEB_SEARCH_PROVIDER.search!(
  { query: largerTencentQuery, cursor: "" },
  { apiKey: "tencent-private-key" },
  tools(TENCENT_WEB_SEARCH_PROVIDER)
);
assert.equal(JSON.parse(String(requestedInit?.body)).Cnt, 20);

setProviderHttpTestTransport(async (url, init) => {
  requestedUrl = url;
  requestedInit = init;
  return new Response(JSON.stringify({
    query: "工业照明",
    results: [
      {
        title: "北方设备公司采购动态",
        url: "https://equipment.example.cn/news/lighting",
        content: "Tavily 返回的索引摘要，不是目标网页全文。",
        score: 0.91
      },
      {
        title: "无效分数",
        url: "https://invalid.example.cn/",
        content: "无效",
        score: 2
      }
    ],
    usage: { credits: 1 },
    request_id: "tavily-request-1",
    response_time: 0.42
  }), { status: 200, headers: { "content-type": "application/json" } });
});

const tavilyPage = await TAVILY_SEARCH_PROVIDER.search!(
  { query, cursor: "" },
  { apiKey: "tavily-private-key" },
  tools(TAVILY_SEARCH_PROVIDER)
);
assert.equal(requestedUrl, "https://api.tavily.com/search");
assert.equal(new URL(requestedUrl).search, "");
const tavilyHeaders = new Headers(requestedInit?.headers);
assert.equal(tavilyHeaders.get("authorization"), "Bearer tavily-private-key");
assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
  query: "寻找正在采购工业照明的中国企业 led 工业照明 制造业 采购商 中国 -招聘",
  search_depth: "basic",
  topic: "general",
  max_results: 7,
  include_answer: false,
  include_raw_content: false,
  include_usage: true
});
assert.equal(tavilyPage.records.length, 1);
assert.equal(tavilyPage.invalidCount, 1);
assert.equal(tavilyPage.records[0]?.sourceUrl, "https://equipment.example.cn/news/lighting");
assert.equal(tavilyPage.records[0]?.description, "Tavily 返回的索引摘要，不是目标网页全文。");
assert.equal(tavilyPage.records[0]?.providerRecordId, "tavily-request-1:1");
assert.equal(tavilyPage.records[0]?.confidence, 91);
assert.equal(tavilyPage.usage?.quotaUsed, 1);
assert.equal(tavilyPage.usage?.requestCount, 1);
assert.match(tavilyPage.usage?.display || "", /1 credit/);
assert.match(tavilyPage.records[0]?.evidenceSummary || "", /Tavily 索引第 1 名/);
assert.equal(String(requestedUrl).includes("tavily-private-key"), false);

for (const [provider, malformedResponse] of [
  [BAIDU_AI_SEARCH_PROVIDER, {}],
  [TENCENT_WEB_SEARCH_PROVIDER, { Response: { RequestId: "x" } }],
  [TAVILY_SEARCH_PROVIDER, { request_id: "x" }]
] as const) {
  setProviderHttpTestTransport(async () =>
    new Response(JSON.stringify(malformedResponse), { status: 200 })
  );
  await assert.rejects(
    provider.search!(
      { query, cursor: "" },
      { apiKey: "private-key" },
      tools(provider)
    ),
    (error: unknown) => error instanceof ProviderContractError
      && error.code === "PROVIDER_SCHEMA_CHANGED"
  );
}

for (const [status, expectedCode] of [
  [401, "PROVIDER_AUTH_FAILED"],
  [403, "PROVIDER_AUTH_FAILED"],
  [429, "PROVIDER_RATE_LIMITED"],
  [503, "PROVIDER_UNAVAILABLE"]
] as const) {
  setProviderHttpTestTransport(async () => new Response("error", { status }));
  await assert.rejects(
    BAIDU_AI_SEARCH_PROVIDER.search!(
      { query, cursor: "" },
      { apiKey: "private-key" },
      tools(BAIDU_AI_SEARCH_PROVIDER)
    ).catch((error) => {
      throw providerErrorFromUnknown(error, "search");
    }),
    (error: unknown) => error instanceof ProviderContractError
      && error.code === expectedCode
  );
}

setProviderHttpTestTransport(async () => new Response(JSON.stringify({
  detail: { error: "This request exceeds the plan usage limit." }
}), { status: 432 }));
await assert.rejects(
  TAVILY_SEARCH_PROVIDER.search!(
    { query, cursor: "" },
    { apiKey: "private-key" },
    tools(TAVILY_SEARCH_PROVIDER)
  ),
  (error: unknown) => error instanceof ProviderContractError
    && error.code === "PROVIDER_QUOTA_EXHAUSTED"
);

let networkCalls = 0;
setProviderHttpTestTransport(async () => {
  networkCalls += 1;
  return new Response("{}");
});
await assert.rejects(
  BAIDU_AI_SEARCH_PROVIDER.search!(
    { query, cursor: "" },
    { apiKey: "private-key", baseUrl: "https://example.com" },
    tools(BAIDU_AI_SEARCH_PROVIDER)
  ).catch((error) => {
    throw providerErrorFromUnknown(error, "search");
  }),
  (error: unknown) => error instanceof ProviderContractError
    && error.code === "PROVIDER_POLICY_BLOCKED"
);
assert.equal(networkCalls, 0);

const healthFixtures = new Map<string, unknown>([
  ["baidu_ai_search", { request_id: "health-baidu", references: [] }],
  ["tencent_web_search", {
    Response: { Query: "GoodJob", RequestId: "health-tencent", Pages: [] }
  }],
  ["tavily", {
    query: "GoodJob",
    results: [],
    usage: { credits: 1 },
    request_id: "health-tavily",
    response_time: 0.1
  }]
]);
for (const provider of REAL_WEB_SEARCH_PROVIDERS) {
  let healthCalls = 0;
  setProviderHttpTestTransport(async () => {
    healthCalls += 1;
    return new Response(JSON.stringify(healthFixtures.get(provider.id)), { status: 200 });
  });
  const result = await provider.health(
    { apiKey: `${provider.id}-private-key` },
    tools(provider)
  );
  assert.equal(result.ok, true);
  assert.equal(healthCalls, 1, `${provider.id} health should issue one minimal real request`);
}

assert.deepEqual(
  REAL_WEB_SEARCH_PROVIDERS.map((provider) => provider.id),
  ["baidu_ai_search", "tencent_web_search", "tavily"]
);
for (const provider of REAL_WEB_SEARCH_PROVIDERS) {
  assert.equal(provider.requiresKey, true);
  assert.equal(provider.category, "web");
  assert.equal(provider.capabilities.includes("web"), true);
  assert.equal(LEAD_PROVIDERS.includes(provider), true);
  const item = catalog(provider);
  assert.equal(item.licensePolicy.requiresKey, true);
  assert.equal(item.accessMode, "api");
}

setProviderHttpTestTransport(null);
console.log("Real web search provider tests passed");
