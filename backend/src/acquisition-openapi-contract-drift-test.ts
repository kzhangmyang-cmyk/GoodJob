import assert from "node:assert/strict";
import test from "node:test";
import { createAcquisitionOpenApiPaths } from "./acquisition-openapi.js";
import {
  loadPublishedAcquisitionPaths,
  mergeOperationParameters,
  operationSurface
} from "./acquisition-openapi-contract-test-helpers.js";

test("published acquisition operations can be normalized", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const operation = published["/api/v1/acquisition/plans/{id}"]?.get;

  assert.ok(operation);
  const surface = operationSurface(operation);
  assert.deepEqual(surface.security, [{ bearerAuth: [] }]);
  assert.ok(surface.responses["200"]);
});

test("published plan approval matches the production contract", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const production = createAcquisitionOpenApiPaths();
  const path = "/api/v1/acquisition/plans/{id}/approval";
  assert.equal(published["/api/v1/acquisition/plans/{id}/approve"], undefined);
  assert.deepEqual(
    operationSurface(published[path]!.post!),
    operationSurface(production[path]!.post!)
  );
  assert.deepEqual(
    published[path]!.post!.requestBody.content["application/json"].schema.required,
    ["decision", "reason"]
  );
  assert.ok(published[path]!.post!.responses["200"].headers.ETag);
});

test("operation parameters override path parameters by name and location", () => {
  const pathId = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", maxLength: 255 }
  };
  const operationId = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", maxLength: 32 }
  };
  const merged = mergeOperationParameters(
    [
      pathId,
      { name: "id", in: "header", schema: { type: "string" } },
      { name: "limit", in: "query", schema: { type: "integer" } }
    ],
    [
      operationId,
      { name: "cursor", in: "query", schema: { type: "string" } }
    ]
  );

  assert.equal(merged.length, 4);
  assert.deepEqual(
    merged.filter((parameter) =>
      parameter.name === "id" && parameter.in === "path"
    ),
    [operationId]
  );
  assert.ok(merged.some((parameter) =>
    parameter.name === "id" && parameter.in === "header"
  ));
});

test("operation surfaces ignore semantic collection order only", () => {
  const schema = {
    type: "array",
    prefixItems: [{ type: "string" }, { type: "integer" }],
    enum: ["first", "second"],
    oneOf: [{ type: "string" }, { type: "integer" }]
  };
  const left = {
    security: [
      { oauth: ["write", "read"], apiKey: [] },
      { cookieAuth: [], csrfToken: [] }
    ],
    parameters: [
      { name: "If-Match", in: "header", required: true, schema: { type: "string" } },
      { name: "id", in: "path", required: true, schema: { type: "string" } }
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema } }
    },
    responses: {}
  };
  const reordered = {
    ...left,
    security: [
      { csrfToken: [], cookieAuth: [] },
      { apiKey: [], oauth: ["read", "write"] }
    ],
    parameters: [...left.parameters].reverse()
  };

  const leftSurface = operationSurface(left);
  assert.deepEqual(leftSurface, operationSurface(reordered));
  assert.deepEqual(
    leftSurface.requestBody!.schemas["application/json"],
    schema
  );
  assert.notDeepEqual(
    leftSurface,
    operationSurface({
      ...reordered,
      requestBody: {
        ...reordered.requestBody,
        content: {
          "application/json": {
            schema: { ...schema, enum: [...schema.enum].reverse() }
          }
        }
      }
    })
  );
});
