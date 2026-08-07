import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { Server } from "node:http";
import {
  createAcquisitionPerformanceRouter
} from "./acquisition-performance-router.js";

async function fixture() {
  const calls: unknown[] = [];
  const app = express();
  app.use((req, _res, next) => {
    if (req.header("x-owner")) {
      (req as any).user = {
        id: req.header("x-owner")!,
        teamId: req.header("x-team")!
      };
    }
    next();
  });
  app.use(createAcquisitionPerformanceRouter({
    query: {
      async get(scope, input) {
        calls.push({ scope, input });
        return {
          counts: { discovered: 0, highIntent: 0, approved: 0, converted: 0, contacted: 0, quoted: 0, won: 0, lost: 0 },
          rates: { highIntentRate: null, approvalRate: null, crmConversionRate: null, contactRate: null, quoteRate: null, winRate: null },
          valuesByCurrency: [],
          cost: { status: "available", executionCostMinor: 0, currency: "CNY", coverage: "recorded_api_execution_only" },
          roi: { status: "not_computable", reason: "channel_cost_or_verified_margin_unavailable" },
          dataQuality: { missingAttribution: 0, missingFinancial: 0, truncated: false, lastReconciledAt: null },
          briefingFacts: { headlines: [], risks: [], actions: [], metricIds: [] }
        };
      }
    },
    requestIdFactory: () => "request-performance"
  }));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const request = async (path: string, authenticated = true, method = "GET") => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: authenticated ? { "x-owner": "owner-a", "x-team": "team-a" } : {}
    });
    return { response, body: await response.json().catch(() => null) };
  };
  return {
    calls,
    request,
    close: () => new Promise<void>((resolve, reject) => server.close(
      (error) => error ? reject(error) : resolve()
    ))
  };
}

test("serves the authenticated read-only performance endpoint", async () => {
  const app = await fixture();
  try {
    const result = await app.request(
      "/api/v1/acquisition/performance?platform=douyin&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-07T00%3A00%3A00.000Z"
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.equal(result.response.headers.get("x-request-id"), "request-performance");
    assert.equal(result.body.roi.status, "not_computable");
    assert.deepEqual(app.calls, [{
      scope: { ownerId: "owner-a", teamId: "team-a" },
      input: {
        platform: "douyin",
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-07T00:00:00.000Z"
      }
    }]);
    assert.equal((await app.request(
      "/api/v1/acquisition/performance",
      true,
      "POST"
    )).response.status, 404);
  } finally {
    await app.close();
  }
});

test("rejects anonymous, invalid and over-90-day windows", async () => {
  const app = await fixture();
  try {
    assert.equal((await app.request(
      "/api/v1/acquisition/performance?from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-07T00%3A00%3A00.000Z",
      false
    )).response.status, 401);
    assert.equal((await app.request(
      "/api/v1/acquisition/performance?from=2026-01-01T00%3A00%3A00.000Z&to=2026-08-07T00%3A00%3A00.000Z"
    )).response.status, 400);
    assert.equal((await app.request(
      "/api/v1/acquisition/performance?platform=unknown&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-07T00%3A00%3A00.000Z"
    )).response.status, 400);
  } finally {
    await app.close();
  }
});
