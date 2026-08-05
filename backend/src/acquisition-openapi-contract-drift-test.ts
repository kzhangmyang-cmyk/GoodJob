import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  createAcquisitionDiscoveryOperationsRouter
} from "./acquisition-discovery-operations-router.js";
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

const discoveryOperations = {
  "/api/v1/acquisition/providers": ["get"],
  "/api/v1/acquisition/provider-connections": ["get", "post"],
  "/api/v1/acquisition/provider-connections/{id}": [
    "get",
    "patch",
    "delete"
  ],
  "/api/v1/acquisition/provider-connections/{id}/test": ["post"],
  "/api/v1/acquisition/content-fetch-operations": ["get", "post"],
  "/api/v1/acquisition/content-fetch-operations/{id}": ["get"],
  "/api/v1/acquisition/import-operations": ["get", "post"],
  "/api/v1/acquisition/import-operations/{id}": ["get"]
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

test("published discovery operations exactly match production", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const production = createAcquisitionOpenApiPaths();

  assert.equal(published["/api/v1/acquisition/fetch-operations"], undefined);
  assert.equal(
    published["/api/v1/acquisition/fetch-operations/{id}"],
    undefined
  );
  for (const [path, methods] of Object.entries(discoveryOperations)) {
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

test("published provider operations preserve runtime status and header semantics", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const collection = published[
    "/api/v1/acquisition/provider-connections"
  ]!;
  const detail = published[
    "/api/v1/acquisition/provider-connections/{id}"
  ]!;
  const connectionTest = published[
    "/api/v1/acquisition/provider-connections/{id}/test"
  ]!.post!;

  assert.ok(collection.post!.responses["201"]);
  assert.ok(collection.post!.responses["200"]);
  assert.ok(
    collection.post!.responses["200"].headers["Idempotency-Replayed"]
  );
  assert.ok(detail.delete!.responses["204"]);
  assert.equal(detail.delete!.responses["204"].headers, undefined);
  assert.equal(hasRequiredHeader(detail.patch!, "If-Match"), false);
  assert.equal(hasRequiredHeader(detail.delete!, "Idempotency-Key"), false);
  assert.ok(connectionTest.responses["200"]);
  assert.equal(connectionTest.responses["202"], undefined);
});

test("published imports accept only the raw media types supported by runtime", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const operation = published[
    "/api/v1/acquisition/import-operations"
  ]!.post!;

  assert.deepEqual(
    Object.keys(operation.requestBody.content).sort(),
    [
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv"
    ]
  );
  assert.equal(operation.requestBody.content["application/json"], undefined);
  assert.ok(operation.responses["415"]);
});

test("mounted import router rejects JSON as unsupported media", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: "contract-owner",
      teamId: "contract-team",
      name: "Contract Owner",
      email: "contract-owner@example.test",
      role: "sales",
      avatar: "",
      authVersion: 1
    };
    next();
  });
  app.use(createAcquisitionDiscoveryOperationsRouter({
    service: {} as never,
    dispatchContentFetchOperation: async () => {},
    dispatchImportOperation: async () => {},
    requestIdFactory: () => "contract-request"
  }));
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/acquisition/import-operations?fileName=leads.csv&subjectChannel=organization&mapping=${encodeURIComponent(JSON.stringify({ sourceTitle: "title", sourceSnippet: "snippet" }))}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "contract-import-json"
        },
        body: "{}"
      }
    );
    const body = await response.json() as { code?: string };

    assert.equal(response.status, 415);
    assert.equal(body.code, "unsupported_media_type");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
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
