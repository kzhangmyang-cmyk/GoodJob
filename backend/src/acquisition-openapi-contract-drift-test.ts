import assert from "node:assert/strict";
import test from "node:test";
import { createAcquisitionOpenApiPaths } from "./acquisition-openapi.js";
import {
  loadPublishedAcquisitionPaths,
  mergeOperationParameters,
  operationSurface
} from "./acquisition-openapi-contract-test-helpers.js";

const planRunOperations = {
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
  "/api/v1/acquisition/runs/{id}/cancel": ["post"]
} as const;

function hasRequiredHeader(
  operation: Record<string, any>,
  name: string
) {
  return operation.parameters?.some((parameter: Record<string, any>) =>
    parameter.name === name
    && parameter.in === "header"
    && parameter.required === true
  ) ?? false;
}

test("published acquisition operations can be normalized", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const operation = published["/api/v1/acquisition/plans/{id}"]?.get;

  assert.ok(operation);
  const surface = operationSurface(operation);
  assert.deepEqual(
    surface.security,
    [{ bearerAuth: [] }, { cookieAuth: [] }]
  );
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

test("published plan and run operations exactly match production", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const production = createAcquisitionOpenApiPaths();

  for (const [path, methods] of Object.entries(planRunOperations)) {
    const publishedPath = published[path];
    assert.ok(publishedPath, path);
    assert.deepEqual(Object.keys(publishedPath).sort(), [...methods].sort(), path);
    for (const method of methods) {
      assert.deepEqual(
        operationSurface(publishedPath[method]!),
        operationSurface(production[path]![method]!),
        `${method.toUpperCase()} ${path}`
      );
    }
  }
});

test("obsolete plan and run operations stay unpublished", async () => {
  const published = await loadPublishedAcquisitionPaths();

  assert.equal(published["/api/v1/acquisition/plans"]?.get, undefined);
  assert.equal(published["/api/v1/acquisition/runs"], undefined);
  assert.equal(
    published["/api/v1/acquisition/runs/{id}/operation-shards"],
    undefined
  );
});

test("published plan and run controls preserve status and header semantics", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const createPlan = published["/api/v1/acquisition/plans"]?.post;
  const createRun = published["/api/v1/acquisition/plans/{id}/runs"]?.post;

  assert.ok(createPlan);
  assert.ok(createRun);
  assert.ok(createPlan.responses["201"]);
  assert.ok(createRun.responses["202"]);
  assert.equal(hasRequiredHeader(createPlan, "Idempotency-Key"), true);
  assert.equal(hasRequiredHeader(createRun, "Idempotency-Key"), true);

  for (const [path, method] of [
    ["/api/v1/acquisition/plans/{id}", "patch"],
    ["/api/v1/acquisition/plans/{id}/revisions", "post"],
    ["/api/v1/acquisition/plans/{id}/approval", "post"],
    ["/api/v1/acquisition/runs/{id}/pause", "post"],
    ["/api/v1/acquisition/runs/{id}/resume", "post"],
    ["/api/v1/acquisition/runs/{id}/cancel", "post"]
  ] as const) {
    assert.equal(
      hasRequiredHeader(published[path]![method]!, "If-Match"),
      true,
      `${method.toUpperCase()} ${path}`
    );
  }

  for (const [path, method, status] of [
    ["/api/v1/acquisition/plans", "post", "201"],
    ["/api/v1/acquisition/plans/{id}", "get", "200"],
    ["/api/v1/acquisition/plans/{id}", "patch", "200"],
    ["/api/v1/acquisition/plans/{id}/revisions", "post", "201"],
    ["/api/v1/acquisition/plans/{id}/approval", "post", "200"],
    ["/api/v1/acquisition/plans/{id}/runs", "post", "202"],
    ["/api/v1/acquisition/runs/{id}", "get", "200"],
    ["/api/v1/acquisition/runs/{id}/pause", "post", "200"],
    ["/api/v1/acquisition/runs/{id}/resume", "post", "200"],
    ["/api/v1/acquisition/runs/{id}/cancel", "post", "200"]
  ] as const) {
    assert.ok(
      published[path]![method]!.responses[status].headers.ETag,
      `${method.toUpperCase()} ${path} ${status}`
    );
  }
});

test("published run presentation uses event pagination", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const presentation = published[
    "/api/v1/acquisition/runs/{id}/presentation"
  ]?.get;
  assert.ok(presentation);
  const queryParameters = presentation.parameters
    .filter((parameter: Record<string, any>) => parameter.in === "query")
    .map((parameter: Record<string, any>) => parameter.name)
    .sort();
  const responseSchema = presentation.responses["200"]
    .content["application/json"].schema;

  assert.deepEqual(queryParameters, ["after", "limit"]);
  assert.ok(responseSchema.required.includes("hasMore"));
  assert.ok(responseSchema.required.includes("nextAfter"));
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
