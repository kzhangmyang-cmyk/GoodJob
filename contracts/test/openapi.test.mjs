import test from "node:test";
import assert from "node:assert/strict";
import { loadOpenApi, loadOpenApiSource } from "./helpers.mjs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { loadContractHarness } from "./helpers.mjs";

const section16 = {
  "/api/v1/ai/providers": ["get"],
  "/api/v1/ai/connections": ["get", "post"],
  "/api/v1/ai/connections/{id}": ["get", "patch", "delete"],
  "/api/v1/ai/connections/{id}/models": ["get"],
  "/api/v1/ai/connections/{id}/test": ["post"],
  "/api/v1/ai/connections/{id}/activate": ["post"],
  "/api/v1/ai/calls": ["get"],
  "/api/v1/ai/calls/{id}": ["get"],
  "/api/v1/acquisition/providers": ["get"],
  "/api/v1/acquisition/provider-connections": ["get", "post"],
  "/api/v1/acquisition/provider-connections/{id}": ["get", "patch", "delete"],
  "/api/v1/acquisition/provider-connections/{id}/test": ["post"],
  "/api/v1/acquisition/fetch-operations": ["post"],
  "/api/v1/acquisition/fetch-operations/{id}": ["get"],
  "/api/v1/acquisition/import-operations": ["post"],
  "/api/v1/acquisition/import-operations/{id}": ["get"],
  "/api/v1/acquisition/plans": ["get", "post"],
  "/api/v1/acquisition/plans/{id}": ["get", "patch"],
  "/api/v1/acquisition/plans/{id}/approve": ["post"],
  "/api/v1/acquisition/runs": ["get", "post"],
  "/api/v1/acquisition/runs/{id}": ["get"],
  "/api/v1/acquisition/runs/{id}/operation-shards": ["get"],
  "/api/v1/acquisition/runs/{id}/pause": ["post"],
  "/api/v1/acquisition/runs/{id}/resume": ["post"],
  "/api/v1/acquisition/runs/{id}/cancel": ["post"],
  "/api/v1/acquisition/candidates": ["get"],
  "/api/v1/acquisition/candidates/{id}": ["get"],
  "/api/v1/acquisition/candidates/{id}/evidence": ["get"],
  "/api/v1/acquisition/candidates/{id}/research": ["post"],
  "/api/v1/acquisition/candidates/{id}/qualification": ["get", "post"],
  "/api/v1/acquisition/candidates/{id}/battle-card": ["get", "post"],
  "/api/v1/acquisition/candidates/{id}/reviews": ["get"],
  "/api/v1/acquisition/candidates/{id}/review": ["post"],
  "/api/v1/acquisition/candidates/{id}/convert": ["post"],
  "/api/v1/acquisition/outcomes": ["get", "post"],
  "/api/v1/acquisition/copilot/sessions": ["post"],
  "/api/v1/acquisition/copilot/sessions/{id}": ["get"],
  "/api/v1/acquisition/copilot/sessions/{id}/messages": ["post"],
  "/api/v1/acquisition/copilot/tasks/{id}": ["get"],
  "/api/v1/acquisition/audit-events": ["get"]
};

const listPaths = [
  "/api/v1/ai/providers", "/api/v1/ai/connections", "/api/v1/ai/connections/{id}/models",
  "/api/v1/ai/calls", "/api/v1/acquisition/providers", "/api/v1/acquisition/provider-connections",
  "/api/v1/acquisition/plans", "/api/v1/acquisition/runs",
  "/api/v1/acquisition/runs/{id}/operation-shards", "/api/v1/acquisition/candidates",
  "/api/v1/acquisition/candidates/{id}/evidence", "/api/v1/acquisition/candidates/{id}/reviews",
  "/api/v1/acquisition/outcomes", "/api/v1/acquisition/audit-events"
];

const asyncPosts = [
  "/api/v1/ai/connections/{id}/test", "/api/v1/acquisition/provider-connections/{id}/test",
  "/api/v1/acquisition/fetch-operations", "/api/v1/acquisition/import-operations",
  "/api/v1/acquisition/runs", "/api/v1/acquisition/candidates/{id}/research",
  "/api/v1/acquisition/candidates/{id}/qualification", "/api/v1/acquisition/candidates/{id}/battle-card",
  "/api/v1/acquisition/copilot/sessions", "/api/v1/acquisition/copilot/sessions/{id}/messages"
];

const reads = {
  "/api/v1/ai/connections/{id}": "ModelConnection",
  "/api/v1/ai/calls/{id}": "ModelCallRecord",
  "/api/v1/acquisition/provider-connections/{id}": "ProviderConnection",
  "/api/v1/acquisition/fetch-operations/{id}": "ContentFetchOperation",
  "/api/v1/acquisition/import-operations/{id}": "ImportOperation",
  "/api/v1/acquisition/plans/{id}": "AcquisitionPlan",
  "/api/v1/acquisition/runs/{id}": "AcquisitionRun",
  "/api/v1/acquisition/candidates/{id}": "OrganizationCandidate",
  "/api/v1/acquisition/candidates/{id}/qualification": "QualificationDecision",
  "/api/v1/acquisition/candidates/{id}/battle-card": "BattleCard",
  "/api/v1/acquisition/copilot/sessions/{id}": "CopilotSession",
  "/api/v1/acquisition/copilot/tasks/{id}": "CopilotTask"
};

test("OpenAPI exactly covers Section 16 with typed, authenticated responses", async () => {
  await loadOpenApi();
  const document = await loadOpenApiSource();
  assert.equal(document.servers[0].url, "/");
  assert.equal(new URL("/api/v1/acquisition/runs", `https://contract.test${document.servers[0].url}`).pathname, "/api/v1/acquisition/runs");
  assert.deepEqual(Object.keys(document.paths).sort(), Object.keys(section16).sort());
  assert.equal(document.components.schemas.ApiError.additionalProperties, false);
  assert.equal(document.components.schemas.AsyncOperation.additionalProperties, false);
  assert.equal(document.components.schemas.PagedResult.additionalProperties, false);
  for (const [path, methods] of Object.entries(section16)) {
    const actualMethods = Object.keys(document.paths[path]).filter((key) => ["get", "post", "patch", "delete"].includes(key)).sort();
    assert.deepEqual(actualMethods, [...methods].sort(), path);
    for (const method of methods) {
      const operation = document.paths[path][method];
      assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${method.toUpperCase()} ${path}`);
      assert.equal(operation.responses["401"].content["application/json"].schema.$ref, "#/components/schemas/ApiError");
      if (["post", "patch", "delete"].includes(method)) {
        assert.equal(operation.parameters.some((parameter) => parameter.$ref === "#/components/parameters/idempotencyKey" || (parameter.name === "Idempotency-Key" && parameter.in === "header" && parameter.required)), true);
      }
    }
  }
  for (const path of listPaths) {
    assert.equal(document.paths[path].get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/PagedResult", path);
  }
  for (const [path, schema] of Object.entries(reads)) {
    assert.equal(document.paths[path].get.responses["200"].content["application/json"].schema.$ref, `#/components/schemas/${schema}`, path);
  }
  for (const path of asyncPosts) {
    assert.equal(document.paths[path].post.responses["202"].content["application/json"].schema.$ref, "#/components/schemas/AsyncOperation", path);
  }
  const connectionDelete = document.paths["/api/v1/ai/connections/{id}"].delete.responses["409"];
  assert.equal(connectionDelete.content["application/json"].schema.$ref, "#/components/schemas/ApiError");
  assert.deepEqual(connectionDelete.headers["X-Error-Code"].schema.enum, ["connection_in_use"]);
  const resume = document.paths["/api/v1/acquisition/runs/{id}/resume"].post.responses["409"];
  assert.equal(resume.content["application/json"].schema.$ref, "#/components/schemas/ApiError");
  assert.deepEqual(resume.headers["X-Error-Code"].schema.enum, ["budget_revision_requires_new_run"]);
  const { loadExamples } = await loadContractHarness();
  const examples = await loadExamples();
  const organizationCandidate = examples.organization.records.find((record) => record.schema === "organization-candidate").value;
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  assert.equal(ajv.compile(document.components.schemas.OrganizationCandidate)(organizationCandidate), true);
});
