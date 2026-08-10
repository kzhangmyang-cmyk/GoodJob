import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  InMemoryGrowthHttpIdempotencyRepository,
  executeGrowthIdempotentCommand
} from "./growth-http-idempotency-repository.js";
import type { GrowthHttpIdempotencyReservationInput } from "./growth-http-idempotency-repository.js";

const reservation = (overrides: Partial<GrowthHttpIdempotencyReservationInput> = {}): GrowthHttpIdempotencyReservationInput => ({
  workspaceId: "team-a", actorId: "manager-1", method: "POST",
  canonicalPath: "/api/v1/quotes/versions/:id/approve", key: "approve-key-0001",
  requestHash: `sha256:${"c".repeat(64)}`,
  attemptedAt: "2026-08-09T08:00:00.000Z", leaseOwner: "request-a", leaseDurationMs: 30_000,
  ...overrides
});

test("same request replays by IDs while a changed request conflicts", async () => {
  const repository = new InMemoryGrowthHttpIdempotencyRepository();
  const first = await repository.reserve(reservation());
  assert.equal(first.kind, "claimed");
  if (first.kind !== "claimed") throw new Error("expected_claim");
  await repository.complete(first.reservationId, first.leaseOwner, first.fencingToken, {
    resourceId: "quote-case-1", operationId: null
  });
  assert.deepEqual(await repository.reserve(reservation()), {
    kind: "replay", resourceId: "quote-case-1", operationId: null
  });
  assert.deepEqual(await repository.reserve(reservation({ requestHash: `sha256:${"b".repeat(64)}` })), { kind: "conflict" });
});

test("current authorization projects a replay instead of returning cached response fields", async () => {
  const repository = new InMemoryGrowthHttpIdempotencyRepository();
  let allowed = true;
  const command = () => executeGrowthIdempotentCommand({
    repository,
    reservation: reservation({ leaseOwner: randomUUID() })
  }, async () => {
    if (!allowed) throw Object.assign(new Error("forbidden"), { code: "capability_forbidden" });
    return { id: "approval-1", sensitiveCostMinor: 123 };
  }, async () => ({ resourceId: "approval-1", operationId: null }));
  assert.deepEqual(await command(), { value: { id: "approval-1", sensitiveCostMinor: 123 }, replayed: false });
  allowed = false;
  await assert.rejects(command, (error: unknown) => (error as { code?: string }).code === "capability_forbidden");
});

test("an expired claim is reclaimed with a larger fence and rejects stale completion", async () => {
  const repository = new InMemoryGrowthHttpIdempotencyRepository();
  const first = await repository.reserve(reservation({ leaseDurationMs: 1_000 }));
  assert.equal(first.kind, "claimed");
  assert.deepEqual(await repository.reserve(reservation({ leaseOwner: "request-b", leaseDurationMs: 1_000, attemptedAt: "2026-08-09T08:00:00.500Z" })), { kind: "in_progress", retryAfterMs: 500 });
  const reclaimed = await repository.reserve(reservation({ leaseOwner: "request-b", leaseDurationMs: 1_000, attemptedAt: "2026-08-09T08:00:01.001Z" }));
  assert.equal(reclaimed.kind, "claimed");
  if (first.kind !== "claimed" || reclaimed.kind !== "claimed") throw new Error("expected_claims");
  assert.ok(reclaimed.fencingToken > first.fencingToken);
  await assert.rejects(() => repository.complete(first.reservationId, first.leaseOwner, first.fencingToken, { resourceId: "stale", operationId: null }), /stale_idempotency_fence/u);
  await repository.complete(reclaimed.reservationId, reclaimed.leaseOwner, reclaimed.fencingToken, { resourceId: "resource-1", operationId: null });
});

test("a reclaimed command returns its stable domain resource after lost completion", async () => {
  const repository = new InMemoryGrowthHttpIdempotencyRepository();
  const domain = new Map<string, { id: string }>();
  const base = reservation({ leaseDurationMs: 1_000 });
  const first = await repository.reserve(base);
  assert.equal(first.kind, "claimed");
  domain.set("stable-command-key", { id: "resource-stable-key" });
  const replay = await executeGrowthIdempotentCommand({
    repository, reservation: { ...base, attemptedAt: "2026-08-09T08:00:01.001Z", leaseOwner: "request-b" }
  }, async (resourceId) => domain.get("stable-command-key") ?? { id: resourceId ?? "missing" }, async () => ({
    resourceId: domain.get("stable-command-key")!.id, operationId: null
  }));
  assert.deepEqual(replay, { value: { id: "resource-stable-key" }, replayed: false });
  assert.deepEqual(await repository.reserve({ ...base, attemptedAt: "2026-08-09T08:00:02.000Z", leaseOwner: "request-c" }), { kind: "replay", resourceId: "resource-stable-key", operationId: null });
});
