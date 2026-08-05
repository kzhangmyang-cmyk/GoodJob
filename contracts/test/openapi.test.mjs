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
  "/api/v1/acquisition/content-fetch-operations": ["get", "post"],
  "/api/v1/acquisition/content-fetch-operations/{id}": ["get"],
  "/api/v1/acquisition/import-operations": ["get", "post"],
  "/api/v1/acquisition/import-operations/{id}": ["get"],
  "/api/v1/acquisition/evidence/{id}": ["get"],
  "/api/v1/acquisition/plans": ["post"],
  "/api/v1/acquisition/plans/{id}": ["get", "patch"],
  "/api/v1/acquisition/plans/{id}/revisions": ["post"],
  "/api/v1/acquisition/plans/{id}/approval": ["post"],
  "/api/v1/acquisition/plans/{id}/runs": ["post"],
  "/api/v1/acquisition/runs/{id}": ["get"],
  "/api/v1/acquisition/runs/{id}/shards": ["get"],
  "/api/v1/acquisition/runs/{id}/presentation": ["get"],
  "/api/v1/acquisition/runs/{id}/pause": ["post"],
  "/api/v1/acquisition/runs/{id}/resume": ["post"],
  "/api/v1/acquisition/runs/{id}/cancel": ["post"],
  "/api/v1/acquisition/candidates": ["get"],
  "/api/v1/acquisition/candidates/{id}": ["get"],
  "/api/v1/acquisition/candidates/{id}/evidence": ["get"],
  "/api/v1/acquisition/candidates/{id}/identity-confirmation": ["post"],
  "/api/v1/acquisition/candidates/{id}/qualification": ["get"],
  "/api/v1/acquisition/candidates/{id}/financial-value": ["get"],
  "/api/v1/acquisition/candidates/{id}/battle-card": ["get"],
  "/api/v1/acquisition/candidates/{id}/reviews": ["get"],
  "/api/v1/acquisition/candidates/{id}/review": ["post"],
  "/api/v1/acquisition/candidates/{id}/convert": ["post"],
  "/api/v1/acquisition/outcomes": ["get"],
  "/api/v1/acquisition/copilot/sessions": ["post"],
  "/api/v1/acquisition/copilot/sessions/{id}": ["get"],
  "/api/v1/acquisition/copilot/sessions/{id}/messages": ["get", "post"],
  "/api/v1/acquisition/copilot/tasks/{id}": ["get"],
  "/api/v1/acquisition/audit-events": ["get"]
};

const listPaths = [
  "/api/v1/ai/providers", "/api/v1/ai/connections", "/api/v1/ai/connections/{id}/models",
  "/api/v1/ai/calls",
  "/api/v1/acquisition/runs/{id}/shards"
];

const typedListReads = {
  "/api/v1/acquisition/candidates/{id}/evidence": "DiscoveryEvidencePagedResult",
  "/api/v1/acquisition/candidates/{id}/reviews": "ReviewEventPagedResult",
  "/api/v1/acquisition/outcomes": "OutcomeFeedbackPagedResult",
  "/api/v1/acquisition/audit-events": "AuditEventPagedResult",
  "/api/v1/acquisition/copilot/sessions/{id}/messages": "CopilotMessagePagedResult"
};

const asyncPosts = [
  "/api/v1/ai/connections/{id}/test",
  "/api/v1/acquisition/copilot/sessions"
];

const reads = {
  "/api/v1/ai/connections/{id}": "ModelConnection",
  "/api/v1/ai/calls/{id}": "ModelCallRecord",
  "/api/v1/acquisition/evidence/{id}": "DiscoveryEvidence",
  "/api/v1/acquisition/plans/{id}": "AcquisitionPlan",
  "/api/v1/acquisition/runs/{id}": "AcquisitionRun",
  "/api/v1/acquisition/runs/{id}/presentation": "AcquisitionRunPresentation",
  "/api/v1/acquisition/candidates/{id}": "Candidate",
  "/api/v1/acquisition/candidates/{id}/qualification": "QualificationDecision",
  "/api/v1/acquisition/candidates/{id}/financial-value": "FinancialValueDecision",
  "/api/v1/acquisition/candidates/{id}/battle-card": "BattleCard",
  "/api/v1/acquisition/copilot/sessions/{id}": "CopilotSession",
  "/api/v1/acquisition/copilot/tasks/{id}": "CopilotTask"
};

test("OpenAPI exactly covers Section 16 with typed, authenticated responses", async () => {
  await loadOpenApi();
  const document = await loadOpenApiSource();
  const registry = await loadSchemaRegistry();
  assert.equal(document.servers[0].url, "/");
  assert.equal(new URL("/api/v1/acquisition/plans/plan-1/runs", `https://contract.test${document.servers[0].url}`).pathname, "/api/v1/acquisition/plans/plan-1/runs");
  assert.deepEqual(Object.keys(document.paths).sort(), Object.keys(section16).sort());
  assert.equal(document.components.schemas.ApiError.oneOf.length, 2);
  assert.equal(document.components.schemas.ApiError.oneOf[0].additionalProperties, false);
  assert.equal(document.components.schemas.ApiError.oneOf[1].additionalProperties, false);
  assert.equal(document.components.schemas.AsyncOperation.$ref, "../json-schema/async-operation.v1.schema.json");
  assert.deepEqual(
    document.components.schemas.BattleCard.oneOf.map((branch) => branch.$ref),
    [
      "#/components/schemas/BattleCardV1",
      "#/components/schemas/BattleCardV2"
    ]
  );
  assert.equal(document.components.schemas.PagedResult.additionalProperties, false);
  assert.equal(document.components.parameters.idempotencyKey.schema.minLength, 1);
  assert.equal(document.components.parameters.idempotencyKey.schema.maxLength, 200);
  for (const [path, methods] of Object.entries(section16)) {
    const actualMethods = Object.keys(document.paths[path]).filter((key) => ["get", "post", "patch", "delete"].includes(key)).sort();
    assert.deepEqual(actualMethods, [...methods].sort(), path);
    for (const method of methods) {
      const operation = document.paths[path][method];
      const isPlanRunOperation = path.startsWith("/api/v1/acquisition/plans")
        || path.startsWith("/api/v1/acquisition/runs");
      const isDiscoveryOperation = path.startsWith("/api/v1/acquisition/providers")
        || path.startsWith("/api/v1/acquisition/provider-connections")
        || path.startsWith("/api/v1/acquisition/content-fetch-operations")
        || path.startsWith("/api/v1/acquisition/import-operations");
      const isAcquisitionOperation = path.startsWith(
        "/api/v1/acquisition/"
      );
      assert.deepEqual(
        operation.security,
        isAcquisitionOperation
          ? method === "get"
            ? [{ bearerAuth: [] }, { cookieAuth: [] }]
            : [{ bearerAuth: [] }, { cookieAuth: [], csrfToken: [] }]
          : [{ bearerAuth: [] }],
        `${method.toUpperCase()} ${path}`
      );
      assert.equal(operation.responses["401"].content["application/json"].schema.$ref, "#/components/schemas/ApiError");
      if (["post", "patch", "delete"].includes(method)) {
        const requiresDiscoveryIdempotency = path === "/api/v1/acquisition/provider-connections"
          || path === "/api/v1/acquisition/content-fetch-operations"
          || path === "/api/v1/acquisition/import-operations";
        assert.equal(
          (operation.parameters ?? []).some((parameter) => [
            "#/components/parameters/idempotencyKey",
            "#/components/parameters/planIdempotencyKey"
          ].includes(parameter.$ref) || (parameter.name === "Idempotency-Key" && parameter.in === "header" && parameter.required)),
          isDiscoveryOperation
            ? requiresDiscoveryIdempotency
            : !isPlanRunOperation
              || path === "/api/v1/acquisition/plans"
              || path === "/api/v1/acquisition/plans/{id}/runs"
        );
      }
    }
  }
  for (const path of listPaths) {
    assert.equal(document.paths[path].get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/PagedResult", path);
  }
  for (const [path, schema] of Object.entries(typedListReads)) {
    assert.equal(document.paths[path].get.responses["200"].content["application/json"].schema.$ref, `#/components/schemas/${schema}`, path);
  }
  assert.equal(document.paths["/api/v1/acquisition/candidates"].get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/CandidatePagedResult");
  for (const [path, schema] of Object.entries(reads)) {
    assert.equal(document.paths[path].get.responses["200"].content["application/json"].schema.$ref, `#/components/schemas/${schema}`, path);
  }
  for (const path of asyncPosts) {
    assert.equal(document.paths[path].post.responses["202"].content["application/json"].schema.$ref, "#/components/schemas/AsyncOperation", path);
  }
  assert.equal(
    document.paths["/api/v1/acquisition/copilot/sessions/{id}/messages"]
      .post.responses["202"].content["application/json"].schema.$ref,
    "#/components/schemas/CopilotTask"
  );
  assert.equal(
    document.paths["/api/v1/acquisition/outcomes"].get.parameters.some(
      (parameter) =>
        parameter.$ref === "#/components/parameters/candidateId"
    ),
    true
  );
  const connectionWrites = [
    document.paths["/api/v1/ai/connections"].post,
    document.paths["/api/v1/ai/connections/{id}"].patch,
    document.paths["/api/v1/ai/connections/{id}/activate"].post
  ];
  for (const operation of connectionWrites) {
    assert.equal(operation.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/ModelConnection");
  }
  assert.deepEqual(
    document.paths["/api/v1/ai/connections/{id}"].delete.responses["200"].content["application/json"].schema,
    { type: "object", additionalProperties: false }
  );
  const connectionDelete = document.paths["/api/v1/ai/connections/{id}"].delete.responses["409"];
  assert.equal(connectionDelete.content["application/json"].schema.$ref, "#/components/schemas/ApiError");
  assert.deepEqual(connectionDelete.headers["X-Error-Code"].schema.enum, ["connection_in_use"]);
  const resume = document.paths["/api/v1/acquisition/runs/{id}/resume"].post.responses["409"];
  assert.equal(resume.content["application/json"].schema.$ref, "#/components/schemas/ApiError");
  assert.equal(resume.headers, undefined);
  const approval = document.paths["/api/v1/acquisition/plans/{id}/approval"].post;
  assert.deepEqual(approval.requestBody.content["application/json"].schema.required, ["decision", "reason"]);
  assert.ok(approval.responses["200"].headers.ETag);
  assert.deepEqual(Object.keys(approval.responses).sort(), ["200", "400", "401", "404", "409", "412", "428", "500"]);
  assert.equal(document.paths["/api/v1/acquisition/plans"].post.responses["201"].content["application/json"].schema.$ref, "#/components/schemas/AcquisitionPlan");
  assert.equal(document.paths["/api/v1/acquisition/plans/{id}/revisions"].post.responses["201"].content["application/json"].schema.$ref, "#/components/schemas/AcquisitionPlan");
  assert.equal(document.paths["/api/v1/acquisition/plans/{id}/runs"].post.responses["202"].content["application/json"].schema.$ref, "#/components/schemas/AcquisitionRun");
  const providerCreate = document.paths["/api/v1/acquisition/provider-connections"].post;
  assert.ok(providerCreate.responses["201"]);
  assert.ok(providerCreate.responses["200"].headers["Idempotency-Replayed"]);
  const providerDelete = document.paths["/api/v1/acquisition/provider-connections/{id}"].delete;
  assert.ok(providerDelete.responses["204"]);
  assert.equal(providerDelete.responses["204"].headers, undefined);
  assert.equal((providerDelete.parameters ?? []).some((parameter) => parameter.name === "Idempotency-Key"), false);
  const providerTest = document.paths["/api/v1/acquisition/provider-connections/{id}/test"].post;
  assert.ok(providerTest.responses["200"]);
  assert.equal(providerTest.responses["202"], undefined);
  const importOperation = document.paths["/api/v1/acquisition/import-operations"].post;
  assert.deepEqual(Object.keys(importOperation.requestBody.content).sort(), [
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv"
  ]);
  assert.equal(importOperation.requestBody.content["application/json"], undefined);
  assert.ok(importOperation.responses["415"]);
  assert.equal(document.components.schemas.AcquisitionRunPresentation.$ref, "../json-schema/acquisition-run-presentation.v1.schema.json");
  assert.equal(document.components.schemas.FinancialValueDecision.$ref, "../json-schema/financial-value-decision.v1.schema.json");
  assert.equal(document.components.schemas.CopilotMessage.$ref, "../json-schema/copilot-message.v1.schema.json");
  const presentation = registry.schemaDocuments.get("acquisition-run-presentation");
  assert.deepEqual(presentation.required, ["run", "providers", "summary", "candidateEvents", "nextAfter", "hasMore"]);
  assert.deepEqual(presentation.properties.candidateEvents.items.properties.financialValue.type, ["null", "object"]);
  assert.equal(presentation.properties.summary.properties.expectedRevenueByCurrency.type, "array");
});

test("workflow-internal candidate and outcome writes stay outside the release contract", async () => {
  const document = await loadOpenApiSource();
  const blockedDirectWrites = [
    "/api/v1/acquisition/evidence",
    "/api/v1/acquisition/candidates",
    "/api/v1/acquisition/candidates/{id}/evidence",
    "/api/v1/acquisition/candidates/{id}/research",
    "/api/v1/acquisition/candidates/{id}/qualification",
    "/api/v1/acquisition/candidates/{id}/battle-card",
    "/api/v1/acquisition/outcomes"
  ];
  for (const path of blockedDirectWrites) {
    assert.equal(document.paths[path]?.post, undefined, path);
  }
  assert.ok(document.paths["/api/v1/acquisition/evidence/{id}"].get);
  assert.ok(document.paths["/api/v1/acquisition/candidates/{id}/financial-value"].get);
  assert.ok(document.paths["/api/v1/acquisition/copilot/sessions/{id}/messages"].get);
});

test("every named API resource component accepts a canonical valid instance", async () => {
  const document = await loadOpenApi();
  const registry = await loadSchemaRegistry();
  const names = ["ModelProvider", "ModelConnection", "ModelCallRecord", "DiscoveryProvider", "ProviderConnection", "ContentFetchOperation", "ImportOperation", "AcquisitionPlan", "AcquisitionRun", "AcquisitionOperationShard", "AcquisitionRunPresentation", "DiscoveryEvidence", "QualificationDecision", "BattleCard", "ReviewEvent", "OutcomeFeedback", "FinancialValueDecision", "CopilotSession", "CopilotMessage", "CopilotTask"];
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
    if (name === "BattleCard") {
      assert.deepEqual(
        schema.oneOf.map((branch) => branch.$ref),
        [
          "../json-schema/battle-card.v1.schema.json",
          "../json-schema/battle-card.v2.schema.json"
        ]
      );
      continue;
    }
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
  if (type === "string") return schema.format === "date-time"
    ? "2026-07-23T00:00:00.000Z"
    : schema.format === "uri"
      ? "https://example.com"
      : schema.maxLength === 3
        ? "USD"
        : schema.pattern === "^[A-Z][A-Z0-9_]{2,63}$"
          ? "COPILOT_TASK_FAILED"
          : "value";
  if (type === "integer" || type === "number") return Math.max(schema.minimum ?? 0, 1);
  if (type === "boolean") return true;
  if (type === "array") return Array.from({ length: schema.minItems ?? 0 }, () => buildCanonicalExample(schema.items ?? {}, root));
  if (type === "object" || schema.properties) return Object.fromEntries((schema.required ?? []).map((key) => [key, buildCanonicalExample(schema.properties[key], root)]));
  return {};
}
