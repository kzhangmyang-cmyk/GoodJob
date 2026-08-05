import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadOpenApiSource, loadSchemaRegistry } from "./helpers.mjs";

const expected = [
  "api-error", "paged-result", "async-operation", "model-provider",
  "model-connection", "model-capability", "model-call-record",
  "discovery-provider", "provider-connection", "content-fetch-operation",
  "import-operation", "acquisition-plan", "acquisition-run",
  "acquisition-run-presentation",
  "acquisition-operation-shard", "discovery-evidence", "party-ref",
  "organization-candidate", "individual-demand-signal",
  "qualification-decision", "battle-card", "review-event",
  "outcome-feedback", "financial-value-decision", "copilot-session",
  "copilot-message", "copilot-task", "platform-connection",
  "platform-capability-snapshot", "platform-event", "action-policy",
  "action-receipt"
];

const validSha256 = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const platformContracts = {
  "platform-connection": {
    id: "platform-connection-1",
    tenantId: "tenant-1",
    teamId: "team-1",
    connectorId: "douyin-official-v1",
    platform: "douyin",
    platformAccountRef: "douyin-account-1",
    scopes: ["video.list", "event.read"],
    credentialVersion: 3,
    sync: {
      mode: "hybrid",
      cursor: "cursor-1"
    },
    status: "active",
    authorizationExpiresAt: "2026-09-05T00:00:00.000Z",
    limits: {
      api_requests_per_day: {
        limit: 1000,
        remaining: 875,
        resetsAt: "2026-08-06T00:00:00.000Z"
      }
    },
    capabilitySnapshotRef: {
      id: "platform-capability-snapshot-1",
      hash: validSha256
    },
    createdBy: "user-1",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:05:00.000Z"
  },
  "platform-capability-snapshot": {
    id: "platform-capability-snapshot-1",
    tenantId: "tenant-1",
    teamId: "team-1",
    connectionId: "platform-connection-1",
    credentialVersion: 3,
    snapshotHash: validSha256,
    capturedAt: "2026-08-05T00:05:00.000Z",
    expiresAt: "2026-08-05T01:05:00.000Z",
    capturedBy: "connector-worker-1",
    capabilities: {
      future_official_capability: {
        status: "available",
        scopes: ["future.scope"],
        limitRefs: ["api_requests_per_day"],
        reasonCode: null
      }
    }
  },
  "platform-event": {
    id: "platform-event-1",
    tenantId: "tenant-1",
    teamId: "team-1",
    platform: "douyin",
    platformAccountRef: "douyin-account-1",
    platformContentRef: "douyin-video-1",
    platformEventRef: "douyin-event-1",
    platformSubjectRef: "douyin-subject-1",
    eventType: "comment.created",
    rawPayloadHash: validSha256,
    normalizedEventHash: validSha256,
    occurredAt: "2026-08-05T00:10:00.000Z",
    capturedAt: "2026-08-05T00:11:00.000Z",
    authorizationSnapshot: {
      connectionId: "platform-connection-1",
      credentialVersion: 3,
      scopeHash: validSha256,
      capabilitySnapshotRef: {
        id: "platform-capability-snapshot-1",
        hash: validSha256
      }
    },
    dedupeKey: "douyin:douyin-account-1:douyin-event-1",
    accessStatus: "available",
    capturedBy: "connector-worker-1"
  },
  "action-policy": {
    id: "action-policy-1",
    tenantId: "tenant-1",
    teamId: "team-1",
    version: 1,
    planRef: {
      id: "acquisition-plan-1",
      version: 4,
      hash: validSha256
    },
    ruleBundleRef: {
      id: "action-rules-1",
      version: "1.0.0",
      hash: validSha256
    },
    policyHash: validSha256,
    actions: {
      future_official_capability: "review_required"
    },
    effectiveAt: "2026-08-05T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    createdBy: "user-1",
    createdAt: "2026-08-05T00:00:00.000Z"
  },
  "action-receipt": {
    id: "action-receipt-1",
    tenantId: "tenant-1",
    teamId: "team-1",
    intentRef: {
      id: "action-intent-1",
      hash: validSha256
    },
    decisionRef: {
      id: "action-decision-1",
      hash: validSha256
    },
    jobRef: {
      id: "action-job-1",
      attempt: 1
    },
    connectionRef: {
      id: "platform-connection-1",
      credentialVersion: 3
    },
    capabilitySnapshotRef: {
      id: "platform-capability-snapshot-1",
      hash: validSha256
    },
    idempotencyKey: "action-idempotency-1",
    externalId: "douyin-action-1",
    outcome: "succeeded",
    error: null,
    requestHash: validSha256,
    resultHash: validSha256,
    requestedAt: "2026-08-05T00:15:00.000Z",
    completedAt: "2026-08-05T00:15:01.000Z",
    recordedAt: "2026-08-05T00:15:01.000Z",
    recordedBy: "connector-worker-1"
  }
};

test("ai-acquisition.v1 exposes the complete unique schema registry", async () => {
  const registry = await loadSchemaRegistry();
  assert.deepEqual([...registry.names].sort(), [...expected].sort());
  assert.equal(registry.ids.size, expected.length);
  for (const validate of registry.validators.values()) {
    assert.equal(typeof validate, "function");
  }
});

test("platform and action placeholder components are published without routes", async () => {
  const document = await loadOpenApiSource();
  const componentRefs = {
    PlatformConnection: "../json-schema/platform-connection.v1.schema.json",
    PlatformCapabilitySnapshot: "../json-schema/platform-capability-snapshot.v1.schema.json",
    PlatformEvent: "../json-schema/platform-event.v1.schema.json",
    ActionPolicy: "../json-schema/action-policy.v1.schema.json",
    ActionReceipt: "../json-schema/action-receipt.v1.schema.json"
  };
  for (const [name, ref] of Object.entries(componentRefs)) {
    assert.equal(document.components.schemas[name]?.$ref, ref);
  }
  assert.equal(
    Object.keys(document.paths).some((route) => /platform|action/i.test(route)),
    false
  );
});

test("platform and action contracts accept canonical objects and reject unknown fields", async () => {
  const registry = await loadSchemaRegistry();
  for (const [name, value] of Object.entries(platformContracts)) {
    const validate = registry.validators.get(name);
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`);
    assert.equal(validate({ ...value, unexpected: true }), false, name);
  }
});

test("capability and action keys remain extensible but reject empty keys", async () => {
  const registry = await loadSchemaRegistry();
  const capability = registry.validators.get("platform-capability-snapshot");
  const policy = registry.validators.get("action-policy");

  assert.equal(capability(platformContracts["platform-capability-snapshot"]), true);
  assert.equal(capability({
    ...platformContracts["platform-capability-snapshot"],
    capabilities: {
      "": platformContracts["platform-capability-snapshot"].capabilities.future_official_capability
    }
  }), false);
  assert.equal(policy(platformContracts["action-policy"]), true);
  assert.equal(policy({
    ...platformContracts["action-policy"],
    actions: { "": "blocked" }
  }), false);
});

test("capability and action keys reject whitespace, controls, and unsupported punctuation", async () => {
  const registry = await loadSchemaRegistry();
  const capability = registry.validators.get("platform-capability-snapshot");
  const policy = registry.validators.get("action-policy");
  const capabilityEntry = platformContracts["platform-capability-snapshot"]
    .capabilities.future_official_capability;

  for (const invalidKey of [
    " ",
    "\t",
    "\u0001",
    "future official capability",
    "future/capability",
    "!future"
  ]) {
    assert.equal(capability({
      ...platformContracts["platform-capability-snapshot"],
      capabilities: { [invalidKey]: capabilityEntry }
    }), false, `capability key ${JSON.stringify(invalidKey)}`);
    assert.equal(policy({
      ...platformContracts["action-policy"],
      actions: { [invalidKey]: "blocked" }
    }), false, `action key ${JSON.stringify(invalidKey)}`);
  }
});

test("all immutable digest fields require canonical lowercase SHA-256 values", async () => {
  const registry = await loadSchemaRegistry();
  const digestPaths = {
    "platform-connection": [
      ["capabilitySnapshotRef", "hash"]
    ],
    "platform-capability-snapshot": [
      ["snapshotHash"]
    ],
    "platform-event": [
      ["rawPayloadHash"],
      ["normalizedEventHash"],
      ["authorizationSnapshot", "scopeHash"],
      ["authorizationSnapshot", "capabilitySnapshotRef", "hash"]
    ],
    "action-policy": [
      ["planRef", "hash"],
      ["ruleBundleRef", "hash"],
      ["policyHash"]
    ],
    "action-receipt": [
      ["intentRef", "hash"],
      ["decisionRef", "hash"],
      ["capabilitySnapshotRef", "hash"],
      ["requestHash"],
      ["resultHash"]
    ]
  };

  for (const [name, paths] of Object.entries(digestPaths)) {
    const validate = registry.validators.get(name);
    for (const pathParts of paths) {
      for (const invalidDigest of [
        " ",
        "sha256:abc",
        "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "md5:0123456789abcdef0123456789abcdef"
      ]) {
        const value = structuredClone(platformContracts[name]);
        const target = pathParts.slice(0, -1)
          .reduce((object, part) => object[part], value);
        target[pathParts.at(-1)] = invalidDigest;
        assert.equal(
          validate(value),
          false,
          `${name}.${pathParts.join(".")}: ${JSON.stringify(invalidDigest)}`
        );
      }
    }
  }
});

test("action receipt idempotency keys are bounded and contain non-whitespace", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("action-receipt");

  for (const idempotencyKey of ["short", "        ", "x".repeat(201)]) {
    assert.equal(validate({
      ...platformContracts["action-receipt"],
      idempotencyKey
    }), false, JSON.stringify(idempotencyKey));
  }
});

test("pending connections may precede capability capture but active connections may not", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("platform-connection");

  assert.equal(validate({
    ...platformContracts["platform-connection"],
    status: "pending",
    capabilitySnapshotRef: null
  }), true, JSON.stringify(validate.errors));
  assert.equal(validate({
    ...platformContracts["platform-connection"],
    status: "active",
    capabilitySnapshotRef: null
  }), false);
});

test("action policy decisions are exactly the three fail-closed outcomes", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("action-policy");
  for (const decision of ["auto_allowed", "review_required", "blocked"]) {
    assert.equal(validate({
      ...platformContracts["action-policy"],
      actions: { future_official_capability: decision }
    }), true, decision);
  }
  assert.equal(validate({
    ...platformContracts["action-policy"],
    actions: { future_official_capability: "allowed" }
  }), false);
});

test("action receipts require immutable request/result hashes and normalized outcomes", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("action-receipt");
  const { requestHash, ...withoutRequestHash } = platformContracts["action-receipt"];
  const { resultHash, ...withoutResultHash } = platformContracts["action-receipt"];

  assert.equal(validate(platformContracts["action-receipt"]), true);
  assert.equal(validate({
    ...platformContracts["action-receipt"],
    externalId: null,
    outcome: "failed",
    error: {
      category: "rate_limited",
      code: "PLATFORM_RATE_LIMITED",
      message: "The official platform rate limit was reached.",
      retryable: true
    }
  }), true, JSON.stringify(validate.errors));
  assert.equal(validate(withoutRequestHash), false);
  assert.equal(validate(withoutResultHash), false);
  assert.equal(validate({
    ...platformContracts["action-receipt"],
    outcome: "ok"
  }), false);
  assert.equal(validate({
    ...platformContracts["action-receipt"],
    outcome: "failed",
    error: "RATE_LIMITED"
  }), false);
});

test("battle-card.v2 enforces evidence-bound structured intelligence", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const schema = JSON.parse(await readFile(
    path.join(root, "json-schema", "battle-card.v2.schema.json"),
    "utf8"
  ));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const claim = {
    kind: "fact",
    text: "客户官网公开发布了采购需求。",
    evidenceIds: ["evidence-1"],
    confidence: 1
  };
  const valid = {
    id: "battle-card-2",
    candidateId: "candidate-1",
    qualificationDecisionId: "decision-1",
    partyType: "organization",
    schemaVersion: "battle-card.v2",
    intelligence: {
      accountOverview: [claim],
      needAssessment: [claim],
      supplierHypotheses: [{
        kind: "unknown",
        text: "没有足够证据确认现有供应商。",
        evidenceIds: [],
        confidence: null
      }],
      buyingCommittee: [{
        role: "业务负责人",
        priority: 1,
        influence: "decision_maker",
        concerns: ["投入产出"],
        claim
      }],
      procurementPreferences: [{
        kind: "inference",
        text: "采购更关注可量化效果。",
        evidenceIds: ["evidence-1"],
        confidence: 0.72
      }],
      connectionStrategies: [{
        channel: "email",
        targetRole: "业务负责人",
        rationale: claim,
        openingDraft: "建议人工审核后，以公开需求为背景提供诊断。"
      }],
      roleSpecificOpeners: [{
        role: "业务负责人",
        channel: "email",
        text: "看到贵司公开的采购需求，我们整理了一页诊断供参考。"
      }],
      doNotActions: ["不要在没有证据时声称了解现有供应商"],
      financialSummary: {
        decisionId: "financial-1",
        decisionVersion: "financial-v1",
        grade: "A",
        score: 82,
        currency: "CNY",
        expectedRevenueMinor: 1_000_000,
        expectedGrossProfitMinor: 600_000,
        expectedContributionMinor: 500_000,
        factors: {
          profitability: 80,
          cashFlow: 70,
          creditQuality: 75,
          repeatPotential: 60,
          referralPotential: 40,
          closeProbability: 65
        }
      }
    },
    evidenceIds: ["evidence-1"],
    confidence: 0.8,
    modelProvider: "openai",
    model: "gpt-5",
    promptVersion: "acquisition-model-prompt-bundle.v5",
    createdAt: "2026-07-26T00:00:00.000Z"
  };

  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  for (const invalidClaim of [{
    ...claim,
    evidenceIds: []
  }, {
    kind: "inference",
    text: "没有置信度的推断",
    evidenceIds: ["evidence-1"],
    confidence: null
  }, {
    kind: "unknown",
    text: "未知项不得引用证据",
    evidenceIds: ["evidence-1"],
    confidence: null
  }]) {
    assert.equal(validate({
      ...valid,
      intelligence: {
        ...valid.intelligence,
        accountOverview: [invalidClaim]
      }
    }), false);
  }
});

test("financial values expose only the current closed public projection", async () => {
  const registry = await loadSchemaRegistry();
  const schema = registry.schemaDocuments.get("financial-value-decision");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "id",
    "candidateId",
    "qualificationDecisionId",
    "version",
    "grade",
    "score",
    "currency",
    "expectedRevenueMinor",
    "expectedGrossProfitMinor",
    "expectedContributionMinor",
    "factors",
    "createdAt"
  ]);
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  for (const name of [
    "expectedRevenueMinor",
    "expectedGrossProfitMinor",
    "expectedContributionMinor"
  ]) {
    assert.equal(schema.properties[name].type, "integer");
  }
  assert.deepEqual(schema.properties.factors.required, [
    "profitability",
    "cashFlow",
    "creditQuality",
    "repeatPotential",
    "referralPotential",
    "closeProbability"
  ]);
  assert.equal(schema.properties.factors.additionalProperties, false);
});

test("copilot messages preserve identity, session, content, and linkage", async () => {
  const registry = await loadSchemaRegistry();
  const schema = registry.schemaDocuments.get("copilot-message");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "id",
    "sessionId",
    "sequence",
    "message",
    "createdAt"
  ]);
  const variants = schema.properties.message.oneOf;
  assert.deepEqual(
    variants.map((variant) => variant.properties.role.const),
    ["user", "assistant", "toolResult"]
  );
  for (const variant of variants) {
    assert.equal(variant.additionalProperties, false);
    assert.ok(variant.required.includes("role"));
    assert.ok(variant.required.includes("content"));
    assert.ok(variant.required.includes("timestamp"));
  }
  const toolResult = variants.find(
    (variant) => variant.properties.role.const === "toolResult"
  );
  assert.ok(toolResult.required.includes("toolCallId"));
  assert.equal(schema.properties.taskId, undefined);
});

test("acquisition plan and copilot task schemas expose the optional target platform", async () => {
  const registry = await loadSchemaRegistry();
  const plan = registry.schemaDocuments.get("acquisition-plan");
  const task = registry.schemaDocuments.get("copilot-task");

  assert.deepEqual(plan.$defs.payload.properties.targetPlatform, {
    enum: ["douyin", "web"]
  });
  assert.equal(plan.$defs.payload.required.includes("targetPlatform"), false);
  assert.deepEqual(task.properties.targetPlatform, {
    enum: ["douyin", "web"]
  });
  assert.equal(task.required.includes("targetPlatform"), false);
});
