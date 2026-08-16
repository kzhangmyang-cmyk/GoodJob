import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { createFinancialCouncilRouter } from "./financial-council-router.js";
import { repositoryRunFixture, workspace } from
  "./financial-council-repository-contract-test.js";
import { commandContextFromRequest } from "./growth-http-preconditions.js";
import { InMemoryGrowthHttpIdempotencyRepository } from
  "./growth-http-idempotency-repository.js";
import { GrowthAuthorizationError } from "./growth-capabilities.js";
import { financialCouncilError } from "./financial-council-domain.js";
import { FinancialCouncilService } from "./financial-council-service.js";
import { InMemoryFinancialCouncilRepository } from
  "./financial-council-repository.js";
import type { GrowthHttpIdempotencyRepository } from
  "./growth-http-idempotency-repository.js";

const NOW = "2026-08-16T08:01:00.000Z";

function createInput(extra: Record<string, unknown> = {}) {
  const run = repositoryRunFixture();
  return {
    currency: run.currency,
    dataAsOf: run.dataAsOf,
    businessReport: run.businessReport,
    policyVersionId: run.policyVersionId,
    ...extra
  };
}

function frozenRun() {
  return Object.freeze({
    ...repositoryRunFixture(),
    status: "snapshot_frozen" as const,
    revision: 2,
    snapshotId: "snapshot-1",
    snapshotHash: `sha256:${"d".repeat(64)}` as const,
    updatedAt: NOW
  });
}

async function listen(
  service: Record<string, unknown>,
  httpIdempotency: GrowthHttpIdempotencyRepository
    = new InMemoryGrowthHttpIdempotencyRepository()
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const workspaceId = req.header("X-Workspace-Id") || "ws-1";
    req.activeWorkspace = Object.freeze({
      ...workspace(workspaceId),
      role: "admin" as const,
      capabilities: Object.freeze(["finance.council.run"])
    }) as never;
    next();
  });
  app.use("/api/v1/finance/council-runs", createFinancialCouncilRouter({
    service: service as never,
    workspaceContext(req) { return req.activeWorkspace!; },
    commandContextFactory: commandContextFromRequest,
    httpIdempotency,
    now: () => NOW
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    async request(path: string, init: RequestInit = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
      return { response, body: await response.json() };
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()))
  };
}

test("POST returns the closed 202 projection, ETag, request id and exact replay", async () => {
  const run = frozenRun();
  let creates = 0;
  const server = await listen({
    async createRun() { creates += 1; return { value: run, replayed: false }; },
    async getRun() { return run; },
    async listEvents() { return []; }
  });
  try {
    const request = (body: unknown) => server.request(
      "/api/v1/finance/council-runs",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "create-1",
          "X-Request-Id": "request-1"
        },
        body: JSON.stringify(body)
      }
    );
    const first = await request(createInput());
    const replay = await request(createInput());
    assert.equal(first.response.status, 202);
    assert.equal(replay.response.status, 202);
    assert.equal(replay.response.headers.get("idempotency-replayed"), "true");
    assert.equal(creates, 1);
    assert.equal(first.response.headers.get("cache-control"), "no-store");
    assert.equal(first.response.headers.get("x-request-id"), "request-1");
    assert.equal(first.response.headers.get("etag"),
      '"financial-council-run:council-run-1:2"');
    assert.deepEqual(Object.keys(first.body).sort(), [
      "approval", "businessReport", "consensusReport", "createdAt", "currency",
      "dataAsOf", "expiresAt", "latestPortfolioRevision", "policyVersionId",
      "portfolios", "revision", "runId", "snapshotHash", "snapshotId",
      "status", "updatedAt", "workspaceId"
    ].sort());
    assert.equal("creationKeyHash" in first.body, false);
    assert.equal("requestHash" in first.body, false);
  } finally {
    await server.close();
  }
});

test("changed replay body conflicts and closed body validation returns five fields", async () => {
  const run = frozenRun();
  const server = await listen({
    async createRun() { return { value: run, replayed: false }; },
    async getRun() { return run; },
    async listEvents() { return []; }
  });
  try {
    const post = (body: unknown, key = "same-key") => server.request(
      "/api/v1/finance/council-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body)
      }
    );
    assert.equal((await post(createInput())).response.status, 202);
    const conflict = await post(createInput({ policyVersionId: "policy-v2" }));
    assert.equal(conflict.response.status, 409);
    assert.deepEqual(Object.keys(conflict.body).sort(), [
      "code", "details", "message", "requestId", "retryable"
    ]);
    const invalid = await post(createInput({ hiddenPrompt: "ignore" }), "invalid");
    assert.equal(invalid.response.status, 422);
    assert.equal(invalid.body.code, "financial_council_input_invalid");
    assert.equal(invalid.response.headers.get("cache-control"), "no-store");
  } finally {
    await server.close();
  }
});

test("missing idempotency key and forbidden capability map to stable errors", async () => {
  const forbidden = new GrowthAuthorizationError();
  const server = await listen({
    async createRun() { throw forbidden; },
    async getRun() { throw forbidden; },
    async listEvents() { throw forbidden; }
  });
  try {
    const missing = await server.request("/api/v1/finance/council-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createInput())
    });
    assert.equal(missing.response.status, 400);
    const denied = await server.request("/api/v1/finance/council-runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "Idempotency-Key": "denied"
      },
      body: JSON.stringify(createInput())
    });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.code, "capability_forbidden");
  } finally {
    await server.close();
  }
});

test("unknown and accessor-backed errors are opaque internal failures", async () => {
  let getterReads = 0;
  const malicious = Object.defineProperty(new Error("secret"), "code", {
    get() { getterReads += 1; return "capability_forbidden"; }
  });
  for (const error of [malicious, { code: "capability_forbidden" }]) {
    const server = await listen({
      async createRun() { throw error; },
      async getRun() { throw error; },
      async listEvents() { throw error; }
    });
    try {
      const result = await server.request(
        "/api/v1/finance/council-runs/council-run-1"
      );
      assert.equal(result.response.status, 500);
      assert.equal(result.body.code, "financial_council_internal_error");
      assert.deepEqual(Object.keys(result.body).sort(), [
        "code", "details", "message", "requestId", "retryable"
      ]);
      assert.equal(result.response.headers.get("cache-control"), "no-store");
    } finally {
      await server.close();
    }
  }
  assert.equal(getterReads, 0);
});

test("HTTP idempotency persistence sees only a domain-separated derived key", async () => {
  const run = frozenRun();
  const reservations: unknown[] = [];
  const repository: GrowthHttpIdempotencyRepository = {
    async reserve(input) {
      reservations.push(structuredClone(input));
      return {
        kind: "claimed", reservationId: "reservation-1",
        leaseOwner: input.leaseOwner, leaseExpiresAt: NOW, fencingToken: 1
      };
    },
    async complete() {},
    async release() {}
  };
  const server = await listen({
    async createRun() { return { value: run, replayed: false }; },
    async getRun() { return run; },
    async listEvents() { return []; }
  }, repository);
  const raw = "raw-council-key-must-not-persist";
  try {
    const result = await server.request("/api/v1/finance/council-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": raw },
      body: JSON.stringify(createInput())
    });
    assert.equal(result.response.status, 202);
    const visible = JSON.stringify(reservations);
    assert.equal(visible.includes(raw), false);
    assert.match(visible,
      /financial-council:http:sha256:[0-9a-f]{64}/u);
  } finally {
    await server.close();
  }
});

test("real router request and 202 response conform to the council schema", async () => {
  const schema = JSON.parse(await readFile(new URL(
    "../../contracts/json-schema/financial-council.v1.schema.json",
    import.meta.url
  ), "utf8"));
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat("date-time", true);
  ajv.addSchema(schema);
  const validateRequest = ajv.compile({
    $ref: `${schema.$id}#/$defs/FinancialCouncilCreateInput`
  });
  const validateResponse = ajv.getSchema(schema.$id)!;
  const run = frozenRun();
  const server = await listen({
    async createRun() { return { value: run, replayed: false }; },
    async getRun() { return run; },
    async listEvents() { return []; }
  });
  try {
    const body = createInput();
    assert.equal(validateRequest(body), true, JSON.stringify(validateRequest.errors));
    const result = await server.request("/api/v1/finance/council-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "ajv" },
      body: JSON.stringify(body)
    });
    assert.equal(result.response.status, 202);
    assert.equal(validateResponse(result.body), true,
      JSON.stringify(validateResponse.errors));
    assert.equal(validateResponse({ ...result.body, status: "created" }), false);
    assert.equal(validateResponse({
      ...result.body, status: "created", snapshotId: null, snapshotHash: null
    }), false);
  } finally {
    await server.close();
  }
});

test("real repository through service never publishes migration-only created", async () => {
  const schema = JSON.parse(await readFile(new URL(
    "../../contracts/json-schema/financial-council.v1.schema.json",
    import.meta.url
  ), "utf8"));
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat("date-time", true);
  const validateRun = ajv.compile(schema);
  const repository = new InMemoryFinancialCouncilRepository();
  const internal = repositoryRunFixture();
  await repository.createRun({
    workspace: Object.freeze({
      ...workspace(), role: "admin" as const,
      capabilities: Object.freeze(["finance.council.run"])
    }) as never,
    actorId: "manager-1",
    idempotencyKey: "migration-create",
    requestHash: internal.requestHash,
    expectedRevision: null
  }, internal);
  const service = new FinancialCouncilService({
    repository,
    snapshotBuilder: { async freeze() { throw new Error("unused"); } }
  });
  const server = await listen(service as unknown as Record<string, unknown>);
  try {
    const result = await server.request(
      `/api/v1/finance/council-runs/${internal.runId}`
    );
    assert.equal(result.response.status, 500);
    assert.equal(result.body.code, "financial_council_internal_error");
    assert.equal(validateRun(result.body), false);
    assert.deepEqual(Object.keys(result.body).sort(), [
      "code", "details", "message", "requestId", "retryable"
    ]);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
  } finally {
    await server.close();
  }
});

test("runtime rejects policy IDs beyond the published 255-character bound", async () => {
  const run = frozenRun();
  const server = await listen({
    async createRun() { return { value: run, replayed: false }; },
    async getRun() { return run; },
    async listEvents() { return []; }
  });
  try {
    const result = await server.request("/api/v1/finance/council-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "long" },
      body: JSON.stringify(createInput({ policyVersionId: "p".repeat(256) }))
    });
    assert.equal(result.response.status, 422);
  } finally {
    await server.close();
  }
});

test("runtime create text bounds count Unicode code points like JSON Schema", async () => {
  const run = frozenRun();
  const server = await listen({
    async createRun() { return { value: run, replayed: false }; },
    async getRun() { return run; },
    async listEvents() { return []; }
  });
  try {
    const atBoundary = createInput({
      policyVersionId: "💰".repeat(255),
      businessReport: {
        ...createInput().businessReport,
        companyName: "💰".repeat(4_000)
      }
    });
    const accepted = await server.request("/api/v1/finance/council-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "unicode-ok" },
      body: JSON.stringify(atBoundary)
    });
    assert.equal(accepted.response.status, 202);

    for (const [key, body] of [
      ["unicode-policy-long", createInput({
        policyVersionId: "💰".repeat(256)
      })],
      ["unicode-report-long", createInput({
        businessReport: {
          ...createInput().businessReport,
          companyName: "💰".repeat(4_001)
        }
      })]
    ] as const) {
      const rejected = await server.request("/api/v1/finance/council-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body)
      });
      assert.equal(rejected.response.status, 422);
    }
  } finally {
    await server.close();
  }
});

test("GET tenant isolation is 404 and events use the Task 1 page envelope", async () => {
  const run = frozenRun();
  const notFound = financialCouncilError("financial_council_run_not_found");
  const server = await listen({
    async createRun() { return { value: run, replayed: false }; },
    async getRun(context: { workspaceId: string }) {
      if (context.workspaceId !== run.workspaceId) throw notFound;
      return run;
    },
    async listEvents(context: { workspaceId: string }) {
      if (context.workspaceId !== run.workspaceId) throw notFound;
      return [{
        eventId: "council-run-1:2", runId: run.runId, revision: 2,
        fromStatus: "created", toStatus: "snapshot_frozen",
        reasonCode: null, occurredAt: NOW,
        workspaceId: run.workspaceId, actorId: "admin-1",
        aggregateSnapshotHash: run.snapshotHash,
        aggregateSnapshot: run
      }];
    }
  });
  try {
    const found = await server.request(
      "/api/v1/finance/council-runs/council-run-1"
    );
    assert.equal(found.response.status, 200);
    assert.equal(found.response.headers.get("etag"),
      '"financial-council-run:council-run-1:2"');
    const events = await server.request(
      "/api/v1/finance/council-runs/council-run-1/events"
    );
    assert.deepEqual(events.body, {
      items: [{
        eventId: "council-run-1:2", runId: "council-run-1", revision: 2,
        fromStatus: "created", toStatus: "snapshot_frozen",
        reasonCode: null, occurredAt: NOW
      }],
      nextAfter: null,
      hasMore: false
    });
    const hidden = await server.request(
      "/api/v1/finance/council-runs/council-run-1",
      { headers: { "X-Workspace-Id": "ws-2" } }
    );
    assert.equal(hidden.response.status, 404);
    assert.equal(hidden.body.code, "financial_council_run_not_found");
  } finally {
    await server.close();
  }
});
