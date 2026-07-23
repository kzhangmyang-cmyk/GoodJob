import test from "node:test";
import assert from "node:assert/strict";
import { loadOpenApi, loadOpenApiSource, loadSchemaRegistry } from "./helpers.mjs";
import Ajv from "ajv/dist/2020.js";
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
  "/api/v1/acquisition/runs/{id}/operation-shards",
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
  "/api/v1/acquisition/candidates/{id}": "Candidate",
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
  assert.equal(document.components.schemas.AsyncOperation.$ref, "../json-schema/async-operation.v1.schema.json");
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
  assert.equal(document.paths["/api/v1/acquisition/candidates"].get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/CandidatePagedResult");
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
});

test("every named API resource component accepts a canonical valid instance", async () => {
  const document = await loadOpenApi();
  const registry = await loadSchemaRegistry();
  const names = ["ModelProvider", "ModelConnection", "ModelCallRecord", "DiscoveryProvider", "ProviderConnection", "ContentFetchOperation", "ImportOperation", "AcquisitionPlan", "AcquisitionRun", "AcquisitionOperationShard", "DiscoveryEvidence", "QualificationDecision", "BattleCard", "ReviewEvent", "OutcomeFeedback", "CopilotSession", "CopilotTask"];
  const examples = Object.fromEntries(names.map((name) => [name, buildCanonicalExample(registry.schemaDocuments.get(toKebab(name)))]));
  examples.Candidate = [
    buildCanonicalExample(registry.schemaDocuments.get("organization-candidate")),
    buildCanonicalExample(registry.schemaDocuments.get("individual-demand-signal"))
  ];
  examples.AsyncOperation = { id: "op", kind: "run", status: "running", resourceId: null, error: null, createdAt: "2026-07-23T00:00:00.000Z", completedAt: null };
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  for (const [name, value] of Object.entries(examples)) {
    if (name === "Candidate") {
      assert.deepEqual(document.components.schemas.Candidate.oneOf.map((branch) => branch.$ref), ["../json-schema/organization-candidate.v1.schema.json", "../json-schema/individual-demand-signal.v1.schema.json"]);
      const validate = ajv.compile({ oneOf: [registry.schemaDocuments.get("organization-candidate"), registry.schemaDocuments.get("individual-demand-signal")] });
      for (const instance of value) assert.equal(validate(instance), true, JSON.stringify(validate.errors));
      const paged = document.components.schemas.CandidatePagedResult;
      assert.deepEqual(paged.properties.items.items.oneOf.map((branch) => branch.$ref), ["../json-schema/organization-candidate.v1.schema.json", "../json-schema/individual-demand-signal.v1.schema.json"]);
      const validatePaged = ajv.compile({ ...paged, properties: { ...paged.properties, items: { type: "array", items: { oneOf: [registry.schemaDocuments.get("organization-candidate"), registry.schemaDocuments.get("individual-demand-signal")] } } } });
      assert.equal(validatePaged({ items: value, nextCursor: null }), true, JSON.stringify(validatePaged.errors));
      continue;
    }
    if (name === "AsyncOperation") {
      assert.equal(document.components.schemas.AsyncOperation.$ref, "../json-schema/async-operation.v1.schema.json");
      const validate = registry.validators.get("async-operation");
      assert.equal(validate(value), true, JSON.stringify(validate.errors));
      continue;
    }
    const schema = document.components.schemas[name];
    assert.equal(schema.$ref, `../json-schema/${toKebab(name)}.v1.schema.json`, name);
    const canonical = schema.$ref ? registry.schemaDocuments.get(schema.$ref.split("/").pop().replace(".v1.schema.json", "")) : schema;
    const validate = ajv.compile(canonical);
    for (const instance of [value]) assert.equal(validate(instance), true, `${name}: ${JSON.stringify(validate.errors)}`);
  }
});

test("OpenAPI canonical edge cases preserve optional timestamps, nullable cursors, and typed async errors", async () => {
  const document = await loadOpenApiSource();
  const registry = await loadSchemaRegistry();
  const modelConnection = {
    id: "connection_1", ownerId: "owner_1", provider: "openai", model: "gpt-5",
    credentialVersion: 1,
    capabilitySnapshot: { structuredOutput: true, toolCalling: true, parallelToolCalling: true, streaming: true, modelListing: true },
    status: "active", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T01:00:00.000Z"
  };
  assert.equal(registry.validators.get("model-connection")(modelConnection), true);
  assert.equal(document.components.schemas.ModelConnection.$ref, "../json-schema/model-connection.v1.schema.json");

  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  assert.deepEqual(document.components.schemas.PagedResult.properties.nextCursor.type, ["string", "null"]);
  assert.equal("nullable" in document.components.schemas.PagedResult.properties.nextCursor, false);
  assert.equal(ajv.compile(document.components.schemas.PagedResult)({ items: [], nextCursor: null }), true);

  assert.equal(document.components.schemas.AsyncOperation.$ref, "../json-schema/async-operation.v1.schema.json");
  const validateAsync = registry.validators.get("async-operation");
  const base = { id: "op_1", kind: "run", status: "failed", resourceId: null, createdAt: "2026-07-23T00:00:00.000Z", completedAt: "2026-07-23T00:01:00.000Z" };
  assert.equal(validateAsync({ ...base, error: { code: "provider_failed", message: "Provider failed", details: {}, requestId: "req_1", retryable: true } }), true);
  assert.equal(validateAsync({ ...base, error: { arbitrary: true } }), false);
});

function toKebab(name) { return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(); }
function buildCanonicalExample(schema, root = schema) {
  if (schema.$ref) return buildCanonicalExample(root.$defs[schema.$ref.split("/").pop()], root);
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum.find((value) => value !== null);
  if (schema.oneOf) return buildCanonicalExample(schema.oneOf[0], root);
  const type = Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
  if (type === "string") return schema.format === "date-time" ? "2026-07-23T00:00:00.000Z" : schema.format === "uri" ? "https://example.com" : schema.maxLength === 3 ? "USD" : "value";
  if (type === "integer" || type === "number") return Math.max(schema.minimum ?? 0, 1);
  if (type === "boolean") return true;
  if (type === "array") return Array.from({ length: schema.minItems ?? 0 }, () => buildCanonicalExample(schema.items ?? {}, root));
  if (type === "object" || schema.properties) return Object.fromEntries((schema.required ?? []).map((key) => [key, buildCanonicalExample(schema.properties[key], root)]));
  return {};
}
