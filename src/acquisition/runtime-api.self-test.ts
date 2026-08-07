import { strict as assert } from "node:assert";
import { createAcquisitionApi } from "./runtime-api";

const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
const api = createAcquisitionApi(async (input, init) => {
  requests.push({ input, init });
  return new Response(JSON.stringify({
    generatedAt: "2026-08-07T05:00:00.000Z",
    platform: "douyin",
    totals: { tasks: 0 },
    statusCounts: {},
    discoveryMethodCounts: {},
    tasks: []
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
});

await api.getOverview();
assert.equal(requests[0]?.input, "/api/v1/acquisition/overview?platform=douyin");
assert.equal(requests[0]?.init?.credentials, "same-origin");
assert.equal(requests[0]?.init?.method, "GET");

await api.getTask("plan/with space");
assert.equal(
  requests[1]?.input,
  "/api/v1/acquisition/tasks/plan%2Fwith%20space"
);

const failingApi = createAcquisitionApi(async () => new Response(JSON.stringify({
  error: {
    code: "unauthorized",
    message: "未登录"
  }
}), {
  status: 401,
  headers: { "content-type": "application/json" }
}));

await assert.rejects(
  () => failingApi.getOverview(),
  (error: unknown) => error instanceof Error && error.message === "未登录"
);

