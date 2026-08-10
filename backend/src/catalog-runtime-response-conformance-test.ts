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
  InMemoryGrowthHttpIdempotencyRepository
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
  return { item, page };
}

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
  app.use("/api/v1/catalog", createCatalogRouter({
    catalogService: service,
    httpIdempotency: new InMemoryGrowthHttpIdempotencyRepository(),
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
      headers: Record<string, string> = {}
    ) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
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
    assert.equal(
      validators.item(created.body),
      true,
      JSON.stringify(validators.item.errors)
    );
    assert.equal(
      created.response.headers.get("etag"),
      '"catalog-item:catalog-item-conformance:1"'
    );

    const listed = await call("GET", "/api/v1/catalog/items?sort=code&limit=20");
    assert.equal(listed.response.status, 200);
    assert.equal(
      validators.page(listed.body),
      true,
      JSON.stringify(validators.page.errors)
    );

    const fetched = await call(
      "GET",
      "/api/v1/catalog/items/catalog-item-conformance"
    );
    assert.equal(fetched.response.status, 200);
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
    assert.equal(validators.item(retired.body), true);
    assert.equal(retired.body.status, "retired");
    assert.equal(
      retired.response.headers.get("etag"),
      '"catalog-item:catalog-item-conformance:3"'
    );
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
