import test from "node:test";
import assert from "node:assert/strict";
import { loadSchemaRegistry } from "./helpers.mjs";

const expected = [
  "api-error", "paged-result", "async-operation", "model-provider",
  "model-connection", "model-capability", "model-call-record",
  "discovery-provider", "provider-connection", "content-fetch-operation",
  "import-operation", "acquisition-plan", "acquisition-run",
  "acquisition-operation-shard", "discovery-evidence", "party-ref",
  "organization-candidate", "individual-demand-signal",
  "qualification-decision", "battle-card", "review-event",
  "outcome-feedback", "copilot-session", "copilot-task"
];

test("ai-acquisition.v1 exposes the complete unique schema registry", async () => {
  const registry = await loadSchemaRegistry();
  assert.deepEqual([...registry.names].sort(), [...expected].sort());
  assert.equal(registry.ids.size, expected.length);
  for (const validate of registry.validators.values()) {
    assert.equal(typeof validate, "function");
  }
});
