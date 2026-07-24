import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  createAcquisitionOpenApiPaths
} from "./acquisition-openapi.js";
import {
  createOpenApiDocument
} from "./swagger.js";

test("acquisition OpenAPI publishes the complete agent control surface", () => {
  const paths = createAcquisitionOpenApiPaths();
  const required = [
    "/api/v1/acquisition/providers",
    "/api/v1/acquisition/provider-connections",
    "/api/v1/acquisition/provider-connections/{id}",
    "/api/v1/acquisition/provider-connections/{id}/test",
    "/api/v1/acquisition/content-fetch-operations",
    "/api/v1/acquisition/content-fetch-operations/{id}",
    "/api/v1/acquisition/import-operations",
    "/api/v1/acquisition/import-operations/{id}",
    "/api/v1/acquisition/evidence/{id}",
    "/api/v1/acquisition/candidates",
    "/api/v1/acquisition/candidates/{id}/qualification",
    "/api/v1/acquisition/candidates/{id}/battle-card",
    "/api/v1/acquisition/candidates/{id}/review",
    "/api/v1/acquisition/candidates/{id}/convert",
    "/api/v1/acquisition/copilot/sessions",
    "/api/v1/acquisition/copilot/sessions/{id}/messages",
    "/api/v1/acquisition/copilot/tasks/{id}",
    "/api/v1/acquisition/plans",
    "/api/v1/acquisition/plans/{id}/approval",
    "/api/v1/acquisition/plans/{id}/runs",
    "/api/v1/acquisition/runs/{id}",
    "/api/v1/acquisition/runs/{id}/shards",
    "/api/v1/acquisition/runs/{id}/pause",
    "/api/v1/acquisition/runs/{id}/resume",
    "/api/v1/acquisition/runs/{id}/cancel"
  ];
  for (const path of required) {
    assert.ok(paths[path], `missing acquisition OpenAPI path: ${path}`);
  }
});

test("BYOK credentials are write-only and never appear in response schemas", () => {
  const paths = createAcquisitionOpenApiPaths();
  const create = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.post as Record<string, any>;
  const apiKey = create.requestBody.content["application/json"]
    .schema.properties.apiKey;
  assert.equal(apiKey.writeOnly, true);
  assert.equal(apiKey.type, "string");

  const serializedResponses = JSON.stringify({
    list: (paths[
      "/api/v1/acquisition/provider-connections"
    ]!.get as Record<string, any>).responses,
    patch: paths[
      "/api/v1/acquisition/provider-connections/{id}"
    ]!.patch
      ? (paths[
          "/api/v1/acquisition/provider-connections/{id}"
        ]!.patch as Record<string, any>).responses
      : null,
    test: paths[
      "/api/v1/acquisition/provider-connections/{id}/test"
    ]!.post
      ? (paths[
          "/api/v1/acquisition/provider-connections/{id}/test"
        ]!.post as Record<string, any>).responses
      : null
  });
  assert.doesNotMatch(serializedResponses, /apiKey/u);
  assert.doesNotMatch(serializedResponses, /configurationEncrypted/u);
  assert.doesNotMatch(serializedResponses, /credentialRef/u);
});

test("authorized imports use bounded raw media types rather than base64 JSON", () => {
  const paths = createAcquisitionOpenApiPaths();
  const operation = paths[
    "/api/v1/acquisition/import-operations"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    Object.keys(operation.requestBody.content).sort(),
    [
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv"
    ]
  );
  assert.equal(
    operation.requestBody.content["text/csv"].schema.format,
    "binary"
  );
  assert.equal(operation.requestBody.required, true);
  assert.ok(
    operation.parameters.some(
      (parameter: { name?: string }) => parameter.name === "mapping"
    )
  );
  assert.equal(
    operation.parameters.some(
      (parameter: { name?: string }) =>
        parameter.name === "columnMapping"
    ),
    false
  );
});

test("provider connection response and deletion contracts match the runtime", () => {
  const paths = createAcquisitionOpenApiPaths();
  const providers = paths[
    "/api/v1/acquisition/providers"
  ]!.get as Record<string, any>;
  const providerItem = providers.responses["200"]
    .content["application/json"].schema.properties.items.items;
  assert.ok(providerItem.properties.officialDocsUrl);
  assert.ok(providerItem.properties.defaultBaseUrl);
  assert.ok(providerItem.properties.requiresKey);
  assert.ok(providerItem.properties.keyHint);

  const created = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.post as Record<string, any>;
  const createSchema = created.responses["201"]
    .content["application/json"].schema;
  assert.ok(createSchema.properties.id);
  assert.equal(createSchema.properties.item, undefined);

  const deleted = paths[
    "/api/v1/acquisition/provider-connections/{id}"
  ]!.delete as Record<string, any>;
  assert.ok(deleted.responses["204"]);
  assert.equal(deleted.responses["200"], undefined);
});

test("error responses describe both runtime envelopes used by acquisition routers", () => {
  const paths = createAcquisitionOpenApiPaths();
  const operation = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.post as Record<string, any>;
  const schema = operation.responses["400"]
    .content["application/json"].schema;

  assert.equal(schema.oneOf.length, 2);
  assert.ok(
    schema.oneOf.some((variant: Record<string, any>) =>
      variant.required?.includes("code")
      && variant.required?.includes("retryable")
    )
  );
  assert.ok(
    schema.oneOf.some((variant: Record<string, any>) =>
      variant.required?.includes("error")
    )
  );
});

test("the main Swagger document includes runtime-bridged acquisition routes", () => {
  const document = createOpenApiDocument(express()) as {
    paths: Record<string, unknown>;
    tags: Array<{ name: string }>;
  };
  assert.ok(document.paths["/api/v1/acquisition/providers"]);
  assert.ok(document.paths["/api/v1/acquisition/plans"]);
  assert.ok(
    document.tags.some((tag) => tag.name === "AI 获客智能体")
  );
});
