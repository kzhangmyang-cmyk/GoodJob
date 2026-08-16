import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createFinancialCouncilRouter } from "./financial-council-router.js";
import { repositoryRunFixture, workspace } from
  "./financial-council-repository-contract-test.js";
import { commandContextFromRequest } from "./growth-http-preconditions.js";
import { InMemoryGrowthHttpIdempotencyRepository } from
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

async function listen(service: Record<string, unknown>) {
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
    httpIdempotency: new InMemoryGrowthHttpIdempotencyRepository(),
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
  const forbidden = Object.assign(new Error("forbidden"), {
    code: "capability_forbidden"
  });
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

test("GET tenant isolation is 404 and events use the Task 1 page envelope", async () => {
  const run = frozenRun();
  const notFound = Object.assign(new Error("not found"), {
    code: "financial_council_run_not_found"
  });
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
