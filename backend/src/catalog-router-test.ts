import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { CatalogService } from "./catalog-service.js";
import { createCatalogRouter } from "./catalog-router.js";
import { InMemoryCatalogRepository } from "./catalog-repository.js";
import {
  InMemoryGrowthHttpIdempotencyRepository
} from "./growth-http-idempotency-repository.js";
import { commandContextFromRequest } from "./growth-http-preconditions.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import { capabilitiesForHumanRole } from "./growth-capabilities.js";

const NOW = "2026-08-09T08:00:00.000Z";

function adminContext(workspaceId = "team-a"): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId,
    kind: "team",
    actorId: "admin-1",
    role: "admin",
    teamId: workspaceId,
    capabilities: capabilitiesForHumanRole("admin"),
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

async function catalogRouterFixture() {
  const transactions = new InMemoryGrowthTemporalTransactionRunner(NOW);
  const temporalBarrier = new DefaultGrowthTemporalBarrier(transactions);
  const repository = new InMemoryCatalogRepository({ transactions, temporalBarrier });
  let nextId = 0;
  const catalogService = new CatalogService({
    repository,
    idFactory: () => `item-${++nextId}`
  });
  const httpIdempotency = new InMemoryGrowthHttpIdempotencyRepository();
  let workspaceCalls = 0;
  let commandCalls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.activeWorkspace = adminContext(
      typeof req.header("X-Test-Workspace") === "string"
        ? req.header("X-Test-Workspace")!
        : "team-a"
    );
    next();
  });
  app.use("/api/v1/catalog", createCatalogRouter({
    catalogService,
    httpIdempotency,
    workspaceContext(req) {
      workspaceCalls += 1;
      return req.activeWorkspace!;
    },
    commandContextFactory(req, input) {
      commandCalls += 1;
      return commandContextFromRequest(req, input);
    }
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const request = async (
    method: string,
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      workspaceId?: string | null;
    } = {}
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.workspaceId === null
          ? {} : { "X-Workspace-Id": options.workspaceId ?? "team-a" }),
        ...options.headers
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const body = await response.json();
    return { response, body };
  };
  return {
    repository,
    request,
    calls: () => ({ workspaceCalls, commandCalls }),
    close: () => new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()))
  };
}

const createBody = {
  type: "service",
  code: "SVC-001",
  name: "诊断服务",
  description: "获客诊断",
  unit: "次"
};

test("create replay keeps the released 201 and update requires an ID-scoped ETag", async () => {
  const app = await catalogRouterFixture();
  try {
    const first = await app.request("POST", "/api/v1/catalog/items", {
      headers: { "Idempotency-Key": "catalog-create-0001" },
      body: createBody
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.response.headers.get("etag"), '"catalog-item:item-1:1"');
    assert.equal("createdBy" in first.body, false);
    const replay = await app.request("POST", "/api/v1/catalog/items", {
      headers: { "Idempotency-Key": "catalog-create-0001" },
      body: createBody
    });
    assert.equal(replay.response.status, 201);
    assert.equal(replay.response.headers.get("idempotency-replayed"), "true");
    assert.equal(replay.body.id, first.body.id);
    const missing = await app.request(
      "PATCH",
      `/api/v1/catalog/items/${first.body.id}`,
      {
        headers: { "Idempotency-Key": "catalog-update-0001" },
        body: { name: "无并发保护" }
      }
    );
    assert.equal(missing.response.status, 428);
    assert.equal(missing.body.code, "revision_required");
    assert.deepEqual(app.calls(), { workspaceCalls: 0, commandCalls: 2 });
  } finally {
    await app.close();
  }
});

test("every Catalog operation rejects missing, blank, and all workspace headers before trusted adapters", async () => {
  const app = await catalogRouterFixture();
  try {
    const operations = [
      { method: "GET", path: "/api/v1/catalog/items" },
      {
        method: "POST",
        path: "/api/v1/catalog/items",
        body: createBody,
        headers: { "Idempotency-Key": "workspace-create" }
      },
      { method: "GET", path: "/api/v1/catalog/items/item-1" },
      {
        method: "PATCH",
        path: "/api/v1/catalog/items/item-1",
        body: { name: "Blocked" },
        headers: {
          "Idempotency-Key": "workspace-update",
          "If-Match": '"catalog-item:item-1:1"'
        }
      },
      {
        method: "POST",
        path: "/api/v1/catalog/items/item-1/retire",
        body: {},
        headers: {
          "Idempotency-Key": "workspace-retire",
          "If-Match": '"catalog-item:item-1:1"'
        }
      }
    ] as const;
    for (const workspaceId of [null, " ", "all"] as const) {
      for (const operation of operations) {
        const result = await app.request(operation.method, operation.path, {
          workspaceId,
          body: "body" in operation ? operation.body : undefined,
          headers: "headers" in operation ? operation.headers : undefined
        });
        assert.equal(result.response.status, 403);
        assert.equal(result.body.code, "workspace_required");
      }
    }
    assert.deepEqual(app.calls(), { workspaceCalls: 0, commandCalls: 0 });
  } finally {
    await app.close();
  }
});

test("omitted Catalog list limit uses the released default of 50", async () => {
  const app = await catalogRouterFixture();
  try {
    for (let index = 1; index <= 21; index += 1) {
      const created = await app.request("POST", "/api/v1/catalog/items", {
        headers: { "Idempotency-Key": `default-limit-${index}` },
        body: {
          ...createBody,
          code: `DEFAULT-${String(index).padStart(2, "0")}`,
          name: `Default ${index}`
        }
      });
      assert.equal(created.response.status, 201);
    }
    const listed = await app.request("GET", "/api/v1/catalog/items?sort=code");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.items.length, 21);
    assert.equal(listed.body.hasMore, false);
  } finally {
    await app.close();
  }
});

test("one idempotency key cannot cross catalog resource path IDs", async () => {
  const app = await catalogRouterFixture();
  try {
    for (const item of [
      { ...createBody, code: "ITEM-A", name: "A" },
      { ...createBody, code: "ITEM-B", name: "B" }
    ]) {
      const result = await app.request("POST", "/api/v1/catalog/items", {
        headers: { "Idempotency-Key": `create-${item.code}` },
        body: item
      });
      assert.equal(result.response.status, 201);
    }
    const first = await app.request("PATCH", "/api/v1/catalog/items/item-1", {
      headers: {
        "Idempotency-Key": "catalog-cross-id-0001",
        "If-Match": '"catalog-item:item-1:1"'
      },
      body: { name: "A2" }
    });
    assert.equal(first.response.status, 200);
    const conflict = await app.request("PATCH", "/api/v1/catalog/items/item-2", {
      headers: {
        "Idempotency-Key": "catalog-cross-id-0001",
        "If-Match": '"catalog-item:item-2:1"'
      },
      body: { name: "A2" }
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.code, "idempotency_conflict");
    assert.equal((await app.repository.findCatalogItem("team-a", "item-2"))!.revision, 1);
  } finally {
    await app.close();
  }
});

test("request bodies and list queries are closed to the released 1.0.1 keys", async () => {
  const app = await catalogRouterFixture();
  try {
    const bodyOverride = await app.request("POST", "/api/v1/catalog/items", {
      headers: { "Idempotency-Key": "closed-body-0001" },
      body: { ...createBody, workspaceId: "team-b" }
    });
    assert.equal(bodyOverride.response.status, 400);
    assert.equal(bodyOverride.body.code, "invalid_request");
    const unpublished = await app.request(
      "GET",
      "/api/v1/catalog/items?sort=code&direction=desc&type=service"
    );
    assert.equal(unpublished.response.status, 403);
    assert.equal(unpublished.body.code, "invalid_request");
  } finally {
    await app.close();
  }
});

test("list/get use the sole workspace resolver and preserve nullable descriptions", async () => {
  const app = await catalogRouterFixture();
  try {
    const created = await app.request("POST", "/api/v1/catalog/items", {
      headers: { "Idempotency-Key": "nullable-create-0001" },
      body: { ...createBody, description: null }
    });
    assert.equal(created.response.status, 201);
    const listed = await app.request("GET", "/api/v1/catalog/items?limit=20&sort=updatedAt");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.items[0].description, null);
    assert.deepEqual(Object.keys(listed.body).sort(), ["hasMore", "items", "nextAfter"]);
    const fetched = await app.request("GET", `/api/v1/catalog/items/${created.body.id}`);
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.response.headers.get("etag"), '"catalog-item:item-1:1"');
    assert.deepEqual(app.calls(), { workspaceCalls: 2, commandCalls: 1 });
  } finally {
    await app.close();
  }
});
