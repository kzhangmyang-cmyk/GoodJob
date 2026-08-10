import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import express from "express";
import { CatalogService } from "./catalog-service.js";
import { createCatalogRouter } from "./catalog-router.js";
import { InMemoryCatalogRepository } from "./catalog-repository.js";
import {
  InMemoryGrowthHttpIdempotencyRepository,
  type GrowthHttpIdempotencyRepository
} from "./growth-http-idempotency-repository.js";
import { commandContextFromRequest } from "./growth-http-preconditions.js";
import { loadGrowthContractRelease } from "./growth-openapi.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";
import { capabilitiesForHumanRole } from "./growth-capabilities.js";

function releasedValidators(): {
  item: ValidateFunction;
  page: ValidateFunction;
  assertOperationResponse(
    operationId: CatalogOperationId,
    status: number,
    body: unknown
  ): void;
} {
  const release = loadGrowthContractRelease();
  assert.equal(release.manifest.contractVersion, "1.0.1");
  const root = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    components: (release.document as Record<string, any>).components
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const item = ajv.compile({
    ...root,
    $ref: "#/components/schemas/CatalogItem"
  });
  const page = ajv.compile({
    ...root,
    $ref: "#/components/schemas/CatalogItemPagedResult"
  });
  const apiError = ajv.compile({
    ...root,
    $ref: "#/components/schemas/ApiError"
  });
  const operationLocations: Record<CatalogOperationId, readonly [string, string]> = {
    listCatalogItems: ["/api/v1/catalog/items", "get"],
    createCatalogItem: ["/api/v1/catalog/items", "post"],
    getCatalogItem: ["/api/v1/catalog/items/{id}", "get"],
    updateCatalogItem: ["/api/v1/catalog/items/{id}", "patch"],
    retireCatalogItem: ["/api/v1/catalog/items/{id}/retire", "post"]
  };
  return {
    item,
    page,
    assertOperationResponse(operationId, status, body) {
      const [path, method] = operationLocations[operationId];
      const operation = (release.document as Record<string, any>)
        .paths[path][method];
      assert.equal(operation.operationId, operationId);
      assert.ok(
        operation.responses[String(status)],
        `${operationId} does not release response status ${status}`
      );
      const validate = status >= 400
        ? apiError : operationId === "listCatalogItems" ? page : item;
      assert.equal(validate(body), true, JSON.stringify(validate.errors));
    }
  };
}

type CatalogOperationId =
  | "listCatalogItems"
  | "createCatalogItem"
  | "getCatalogItem"
  | "updateCatalogItem"
  | "retireCatalogItem";

export async function assertCatalogRuntimeResponsesConform(): Promise<void> {
  const transactions = new InMemoryGrowthTemporalTransactionRunner(
    "2026-08-09T08:00:00.000Z"
  );
  const temporalBarrier = new DefaultGrowthTemporalBarrier(transactions);
  const repository = new InMemoryCatalogRepository({ transactions, temporalBarrier });
  const service = new CatalogService({
    repository,
    idFactory: () => "catalog-item-conformance"
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.activeWorkspace = Object.freeze({
      workspaceId: "team-a",
      kind: "team",
      actorId: "admin-1",
      role: "admin",
      teamId: "team-a",
      capabilities: capabilitiesForHumanRole("admin"),
      capabilityRegistryVersion: "growth-capabilities.v1"
    });
    next();
  });
  const storedIdempotency = new InMemoryGrowthHttpIdempotencyRepository();
  const httpIdempotency: GrowthHttpIdempotencyRepository = {
    async reserve(input) {
      if (input.key === "catalog-conformance-in-progress") {
        return { kind: "in_progress", retryAfterMs: 1_500 };
      }
      return storedIdempotency.reserve(input);
    },
    complete: (...args) => storedIdempotency.complete(...args),
    release: (...args) => storedIdempotency.release(...args)
  };
  app.use("/api/v1/catalog", createCatalogRouter({
    catalogService: service,
    httpIdempotency,
    workspaceContext: (req) => req.activeWorkspace!,
    commandContextFactory: commandContextFromRequest
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const call = async (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
      workspaceId: string | null = "team-a"
    ) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(workspaceId === null ? {} : { "X-Workspace-Id": workspaceId }),
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { response, body: await response.json() };
    };
    const input = {
      type: "service",
      code: "SVC-CONFORMANCE",
      name: "Contract service",
      description: null,
      unit: "case"
    };
    const validators = releasedValidators();
    const created = await call(
      "POST",
      "/api/v1/catalog/items",
      input,
      { "Idempotency-Key": "catalog-conformance-create" }
    );
    assert.equal(created.response.status, 201);
    validators.assertOperationResponse(
      "createCatalogItem", created.response.status, created.body
    );
    assert.equal(
      validators.item(created.body),
      true,
      JSON.stringify(validators.item.errors)
    );
    assert.equal(
      created.response.headers.get("etag"),
      '"catalog-item:catalog-item-conformance:1"'
    );

    const replayed = await call(
      "POST",
      "/api/v1/catalog/items",
      input,
      { "Idempotency-Key": "catalog-conformance-create" }
    );
    assert.equal(replayed.response.status, 201);
    assert.equal(replayed.response.headers.get("idempotency-replayed"), "true");
    validators.assertOperationResponse(
      "createCatalogItem", replayed.response.status, replayed.body
    );

    const listed = await call("GET", "/api/v1/catalog/items?sort=code&limit=20");
    assert.equal(listed.response.status, 200);
    validators.assertOperationResponse(
      "listCatalogItems", listed.response.status, listed.body
    );
    assert.equal(
      validators.page(listed.body),
      true,
      JSON.stringify(validators.page.errors)
    );

    const malformedCursor = await call(
      "GET",
      "/api/v1/catalog/items?cursor=not-a-cursor"
    );
    assert.equal(malformedCursor.response.status, 403);
    assert.equal(malformedCursor.body.code, "invalid_catalog_cursor");
    validators.assertOperationResponse(
      "listCatalogItems", malformedCursor.response.status, malformedCursor.body
    );

    const inProgress = await call(
      "POST",
      "/api/v1/catalog/items",
      { ...input, code: "SVC-IN-PROGRESS" },
      { "Idempotency-Key": "catalog-conformance-in-progress" }
    );
    assert.equal(inProgress.response.status, 409);
    assert.equal(inProgress.response.headers.get("retry-after"), "2");
    assert.equal(inProgress.body.code, "idempotency_in_progress");
    assert.equal(inProgress.body.retryable, true);
    validators.assertOperationResponse(
      "createCatalogItem", inProgress.response.status, inProgress.body
    );

    const fetched = await call(
      "GET",
      "/api/v1/catalog/items/catalog-item-conformance"
    );
    assert.equal(fetched.response.status, 200);
    validators.assertOperationResponse(
      "getCatalogItem", fetched.response.status, fetched.body
    );
    assert.equal(validators.item(fetched.body), true);

    const updated = await call(
      "PATCH",
      "/api/v1/catalog/items/catalog-item-conformance",
      { name: "Contract service v2" },
      {
        "Idempotency-Key": "catalog-conformance-update",
        "If-Match": '"catalog-item:catalog-item-conformance:1"'
      }
    );
    assert.equal(updated.response.status, 200);
    validators.assertOperationResponse(
      "updateCatalogItem", updated.response.status, updated.body
    );
    assert.equal(validators.item(updated.body), true);
    assert.equal(
      updated.response.headers.get("etag"),
      '"catalog-item:catalog-item-conformance:2"'
    );

    const retired = await call(
      "POST",
      "/api/v1/catalog/items/catalog-item-conformance/retire",
      {},
      {
        "Idempotency-Key": "catalog-conformance-retire",
        "If-Match": '"catalog-item:catalog-item-conformance:2"'
      }
    );
    assert.equal(retired.response.status, 200);
    validators.assertOperationResponse(
      "retireCatalogItem", retired.response.status, retired.body
    );
    assert.equal(validators.item(retired.body), true);
    assert.equal(retired.body.status, "retired");
    assert.equal(
      retired.response.headers.get("etag"),
      '"catalog-item:catalog-item-conformance:3"'
    );

    for (const operation of [
      ["listCatalogItems", "GET", "/api/v1/catalog/items", undefined, {}],
      ["createCatalogItem", "POST", "/api/v1/catalog/items", input,
        { "Idempotency-Key": "missing-workspace-create" }],
      ["getCatalogItem", "GET",
        "/api/v1/catalog/items/catalog-item-conformance", undefined, {}],
      ["updateCatalogItem", "PATCH",
        "/api/v1/catalog/items/catalog-item-conformance",
        { name: "Blocked" }, {
          "Idempotency-Key": "missing-workspace-update",
          "If-Match": '"catalog-item:catalog-item-conformance:3"'
        }],
      ["retireCatalogItem", "POST",
        "/api/v1/catalog/items/catalog-item-conformance/retire", {}, {
          "Idempotency-Key": "missing-workspace-retire",
          "If-Match": '"catalog-item:catalog-item-conformance:3"'
        }]
    ] as const) {
      const [operationId, method, path, body, headers] = operation;
      const missingWorkspace = await call(method, path, body, headers, null);
      assert.equal(missingWorkspace.response.status, 403);
      assert.equal(missingWorkspace.body.code, "workspace_required");
      validators.assertOperationResponse(
        operationId, missingWorkspace.response.status, missingWorkspace.body
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
}

if (process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test(
    "Catalog create/list/get/update/retire responses conform to release 1.0.1",
    assertCatalogRuntimeResponsesConform
  );
}
