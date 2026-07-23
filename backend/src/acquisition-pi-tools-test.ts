import assert from "node:assert/strict";
import type {
  AgentTool
} from "@earendil-works/pi-agent-core";
import {
  InMemoryAcquisitionToolAuditLedger,
  createAcquisitionAgentTools,
  type AcquisitionAgentToolExecutor,
  type AcquisitionToolExecutionInput
} from "./acquisition-pi-tools.js";

const EXPECTED_TOOLS = [
  "search_public_sources",
  "get_candidate_evidence",
  "research_candidate",
  "qualify_candidate",
  "build_battle_card",
  "estimate_financial_value",
  "draft_connection_strategy",
  "list_priority_candidates",
  "create_review_task",
  "record_outcome"
] as const;

function byName(tools: AgentTool[], name: string) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

const calls: AcquisitionToolExecutionInput[] = [];
const executor: AcquisitionAgentToolExecutor = {
  async execute(input) {
    calls.push(input);
    if (input.toolName === "record_outcome" && input.payload.forceFailure) {
      const error = new Error("OUTCOME_REJECTED secret=should-not-leak");
      error.name = "AcquisitionToolExecutionError";
      throw error;
    }
    return {
      ok: true,
      toolName: input.toolName,
      candidateId: input.payload.candidateId ?? null,
      apiKey: "sk-must-be-redacted",
      nested: {
        authorization: "Bearer must-be-redacted",
        publicSummary: "safe"
      }
    };
  }
};

const audit = new InMemoryAcquisitionToolAuditLedger();
const tools = createAcquisitionAgentTools({
  identity: {
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "owner-a",
    sessionId: "copilot-session-a"
  },
  executor,
  audit,
  auditSecret: "test-acquisition-tool-audit-secret-at-least-32-bytes",
  now: (() => {
    let value = Date.parse("2026-07-24T00:00:00.000Z");
    return () => value++;
  })()
});

assert.deepEqual(
  tools.map((tool) => tool.name),
  EXPECTED_TOOLS,
  "Pi must receive only the ten acquisition tools"
);
assert.equal(
  tools.some((tool) => ["bash", "shell", "read_file", "write_file", "database"].includes(tool.name)),
  false,
  "Pi must never receive general host authority"
);
for (const tool of tools) {
  assert.equal(
    (tool.parameters as { additionalProperties?: unknown }).additionalProperties,
    false,
    `${tool.name} must reject undeclared arguments`
  );
}

await byName(tools, "search_public_sources").execute(
  "call-search-1",
  {
    query: "厦门 装修公司 招聘 销售",
    providerConnectionIds: ["connection-baidu"],
    subjectKinds: ["organization", "individual"],
    maxResults: 20
  },
  undefined
);

assert.equal(calls.length, 1);
assert.deepEqual(calls[0]?.identity, {
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "owner-a",
  sessionId: "copilot-session-a"
});
assert.equal(calls[0]?.toolName, "search_public_sources");
assert.equal(calls[0]?.toolCallId, "call-search-1");
assert.match(calls[0]?.idempotencyKey ?? "", /^pi-tool:/);
assert.equal(
  byName(tools, "search_public_sources").executionMode,
  "parallel"
);
assert.equal(
  byName(tools, "create_review_task").executionMode,
  "sequential"
);
assert.equal(
  byName(tools, "record_outcome").executionMode,
  "sequential"
);

const evidenceResult = await byName(tools, "get_candidate_evidence").execute(
  "call-evidence-1",
  { candidateId: "candidate-a" },
  undefined
);
const evidenceText = evidenceResult.content
  .filter((item) => item.type === "text")
  .map((item) => item.text)
  .join("");
assert.equal(evidenceText.includes("sk-must-be-redacted"), false);
assert.equal(evidenceText.includes("Bearer must-be-redacted"), false);
assert.equal(evidenceText.includes("[REDACTED]"), true);
assert.equal(evidenceText.includes("publicSummary"), true);

const abortController = new AbortController();
abortController.abort();
const beforeAbortCalls = calls.length;
await assert.rejects(
  () => byName(tools, "qualify_candidate").execute(
    "call-aborted",
    { candidateId: "candidate-a", policyVersion: "qualification-v1" },
    abortController.signal
  ),
  (error: unknown) => error instanceof DOMException && error.name === "AbortError"
);
assert.equal(calls.length, beforeAbortCalls);

await assert.rejects(
  () => byName(tools, "record_outcome").execute(
    "call-failure-1",
    {
      candidateId: "candidate-a",
      reviewTaskId: "review-a",
      outcome: "won",
      occurredAt: "2026-07-24T00:00:00.000Z",
      forceFailure: true
    } as never,
    undefined
  ),
  /OUTCOME_REJECTED/
);

const records = audit.list({
  ownerId: "owner-a",
  teamId: "team-a",
  sessionId: "copilot-session-a"
});
assert.equal(records.length, 4);
assert.deepEqual(records.map((item) => item.status), [
  "succeeded",
  "succeeded",
  "aborted",
  "failed"
]);
for (const record of records) {
  assert.equal(record.ownerId, "owner-a");
  assert.equal(record.teamId, "team-a");
  assert.equal(record.sessionId, "copilot-session-a");
  assert.match(record.parameterHash, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(record).includes("sk-must-be-redacted"),
    false
  );
  assert.equal(
    JSON.stringify(record).includes("should-not-leak"),
    false
  );
}

assert.deepEqual(
  audit.list({
    ownerId: "other-owner",
    teamId: "team-a",
    sessionId: "copilot-session-a"
  }),
  [],
  "audit reads must be owner/team isolated"
);

assert.throws(
  () => createAcquisitionAgentTools({
    identity: {
      ownerId: "owner-a",
      teamId: "team-a",
      actorId: "owner-a",
      sessionId: "copilot-session-a"
    },
    executor,
    audit,
    auditSecret: "too-short"
  }),
  /auditSecret/
);

console.log("acquisition Pi tool boundary tests passed");
