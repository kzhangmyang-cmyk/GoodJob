import test from "node:test";
import assert from "node:assert/strict";
import { loadOpenApi } from "./helpers.mjs";

const requiredPaths = [
  "/api/v1/ai/connections",
  "/api/v1/acquisition/runs",
  "/api/v1/acquisition/candidates/{id}/review",
  "/api/v1/acquisition/copilot/sessions",
  "/api/v1/acquisition/copilot/sessions/{id}/messages",
  "/api/v1/acquisition/copilot/tasks/{id}"
];

test("OpenAPI publishes the required authenticated acquisition routes", async () => {
  const document = await loadOpenApi();
  for (const path of requiredPaths) assert.ok(document.paths[path], `missing ${path}`);
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'patch', 'delete'].includes(method)) continue;
      assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${method.toUpperCase()} ${path}`);
      if (['post', 'patch', 'delete'].includes(method)) {
        assert.equal(operation.parameters?.some((parameter) => parameter.name === 'Idempotency-Key' && parameter.in === 'header' && parameter.required), true, `${method.toUpperCase()} ${path}`);
      }
    }
  }
  for (const path of [
    "/api/v1/ai/connections/{id}/test",
    "/api/v1/acquisition/fetch-operations",
    "/api/v1/acquisition/import-operations",
    "/api/v1/acquisition/runs",
    "/api/v1/acquisition/candidates/{id}/research",
    "/api/v1/acquisition/candidates/{id}/qualification",
    "/api/v1/acquisition/candidates/{id}/battle-card",
    "/api/v1/acquisition/copilot/sessions",
    "/api/v1/acquisition/copilot/sessions/{id}/messages"
  ]) {
    const operation = document.paths[path].post;
    assert.ok(operation.responses['202'], `${path} must return 202`);
  }
});
