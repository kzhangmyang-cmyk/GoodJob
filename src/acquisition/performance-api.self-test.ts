import { strict as assert } from "node:assert";
import { createAcquisitionPerformanceApi } from "./performance-api";

const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
const api = createAcquisitionPerformanceApi(async (input, init) => {
  requests.push({ input, init });
  return new Response(JSON.stringify({
    counts: { discovered: 3, highIntent: 1, approved: 1, converted: 1, contacted: 1, quoted: 1, won: 1, lost: 0 },
    rates: { highIntentRate: 1 / 3, approvalRate: 1 / 3, crmConversionRate: 1, contactRate: 1, quoteRate: 1, winRate: 1 },
    valuesByCurrency: [],
    cost: { status: "available", executionCostMinor: 100, currency: "CNY", coverage: "recorded_api_execution_only" },
    roi: { status: "not_computable", reason: "channel_cost_or_verified_margin_unavailable" },
    dataQuality: { missingAttribution: 0, missingFinancial: 0, truncated: false, lastReconciledAt: null },
    briefingFacts: { headlines: [], risks: [], actions: [], metricIds: [] }
  }), { status: 200, headers: { "content-type": "application/json" } });
});

await api.getPerformance({
  platform: "douyin",
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-07T00:00:00.000Z"
});
assert.equal(
  requests[0]?.input,
  "/api/v1/acquisition/performance?platform=douyin&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-07T00%3A00%3A00.000Z"
);
assert.equal(requests[0]?.init?.method, "GET");
assert.equal(requests[0]?.init?.credentials, "same-origin");

const briefingRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
const briefingApi = createAcquisitionPerformanceApi(async (input, init) => {
  briefingRequests.push({ input, init });
  const path = String(input);
  if (path.endsWith("/copilot/sessions")) {
    return new Response(JSON.stringify({ resourceId: "session-a" }), { status: 202 });
  }
  if (path.endsWith("/sessions/session-a/messages")) {
    return new Response(JSON.stringify({ id: "task-a", status: "queued" }), { status: 202 });
  }
  return new Response(JSON.stringify({
    id: "task-a",
    status: "succeeded",
    result: { summary: "成交合同额提升，但 ROI 因渠道成本不完整仍不可计算。" }
  }), { status: 200 });
}, async () => {});
const interpretation = await briefingApi.generateBriefing({
  platform: "douyin",
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-07T00:00:00.000Z"
});
assert.equal(interpretation.includes("ROI"), true);
assert.equal(briefingRequests[0]?.init?.method, "POST");
assert.equal(briefingRequests[1]?.init?.method, "POST");
assert.equal(briefingRequests[2]?.init?.method, "GET");

const failing = createAcquisitionPerformanceApi(async () => new Response(
  JSON.stringify({ error: { message: "真实经营接口不可用" } }),
  { status: 503 }
));
await assert.rejects(
  () => failing.getPerformance({
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-07T00:00:00.000Z"
  }),
  /真实经营接口不可用/
);
