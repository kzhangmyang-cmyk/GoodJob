import assert from "node:assert/strict";
import test from "node:test";
import {
  executeModelConnectionWriteIdempotently,
  requireModelConnectionIdempotencyKey
} from "./model-providers/idempotency.js";
import type {
  ModelConnectionIdempotencyRecord
} from "./model-providers/types.js";

test("failed persistence leaves no phantom replay or business mutation", async () => {
  const records: ModelConnectionIdempotencyRecord[] = [];
  const pending: ModelConnectionIdempotencyRecord[] = [];
  const mutations: string[] = [];
  let shouldFail = true;
  const store = {
    modelConnectionIdempotencyRecords: records,
    pendingModelConnectionIdempotencyRecords: pending,
    async persist() {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("injected persistence failure");
      }
    }
  };
  const request = {
    ownerId: "owner_1",
    teamId: "team_1",
    idempotencyKey: "retry-after-failure",
    method: "POST",
    path: "/api/v1/ai/connections",
    body: { provider: "openai", model: "gpt-test" }
  };
  const mutate = async () => {
    mutations.push("connection_1");
    return {
      status: 200,
      body: { id: "connection_1" },
      rollback() {
        mutations.pop();
      }
    };
  };

  await assert.rejects(
    executeModelConnectionWriteIdempotently(store, request, mutate),
    /injected persistence failure/
  );
  assert.deepEqual(mutations, []);
  assert.deepEqual(records, []);
  assert.deepEqual(pending, []);

  const retry = await executeModelConnectionWriteIdempotently(
    store,
    request,
    mutate
  );
  assert.equal(retry.replayed, false);
  assert.deepEqual(mutations, ["connection_1"]);
  assert.equal(records.length, 1);

  const replay = await executeModelConnectionWriteIdempotently(
    store,
    request,
    async () => {
      throw new Error("replay must not run the mutation");
    }
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.body, retry.body);
  assert.deepEqual(mutations, ["connection_1"]);
});

test("Idempotency-Key accepts 200 characters and rejects 201", () => {
  assert.equal(
    requireModelConnectionIdempotencyKey("k".repeat(200)).length,
    200
  );
  assert.throws(
    () => requireModelConnectionIdempotencyKey("k".repeat(201)),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "idempotency_key_invalid"
      );
      assert.equal((error as { status?: number }).status, 400);
      return true;
    }
  );
});
