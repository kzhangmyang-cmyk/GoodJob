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
  "import-operation", "candidate-intelligence-operation", "douyin-identity-resolution-operation", "douyin-comment-event", "acquisition-plan", "acquisition-run",
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

const douyinCommentEvent = {
  eventId: "comment-event-1",
  platform: "douyin",
  eventType: "comment",
  platformEventId: "comment-123",
  videoId: "video-456",
  parentCommentId: null,
  text: "想了解一下你们的企业服务方案",
  textHash: validSha256,
  occurredAt: "2026-08-15T01:00:00.000Z",
  capturedAt: "2026-08-15T01:01:00.000Z",
  likeCount: 3,
  replyCount: 1,
  ipLabel: "上海",
  actor: {
    displayName: "公开用户",
    handle: "public-user",
    secUid: "sec-user-1"
  },
  sourceUrl: "https://www.douyin.com/video/456",
  coverage: "public_top_level_sample",
  accessStatus: "public_content",
  providerVersion: "douyin-public-comment-provider-v1",
  rawArtifactHash: validSha256
};

function acquisitionPlanPayload(overrides = {}) {
  return {
    targetPlatform: "douyin",
    name: "Douyin public comment plan",
    objective: "Discover public demand signals",
    icp: {
      industries: ["enterprise services"],
      regions: ["China"],
      organizationCriteria: ["public demand"],
      individualCriteria: ["public demand"],
      exclusionRules: []
    },
    subjectChannels: { organization: false, individual: true },
    providerConnections: [{
      connectionId: "public-comment-1",
      providerId: "experimental_public_sample",
      kind: "content_fetch",
      status: "active",
      credentialVersion: 1
    }],
    operations: [{
      operationId: "read-comments",
      subjectChannel: "individual",
      kind: "content_fetch",
      connectionId: "public-comment-1",
      sourceRef: "https://www.douyin.com/video/456",
      allocatedBudget: {
        requests: 3,
        results: 30,
        amountMinor: 0,
        durationSeconds: 120
      }
    }],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 3,
      maxResults: 30,
      maxAmountMinor: 0,
      maxDurationSeconds: 120
    },
    modelSnapshotRef: {
      jobSnapshotId: "snapshot-1",
      connectionId: "model-1",
      credentialVersion: 1,
      provider: "openai",
      model: "gpt-5",
      capabilitySnapshotHash: validSha256,
      promptVersion: "acquisition.v1",
      schemaVersion: "acquisition-plan.v1",
      promptHash: validSha256,
      schemaHash: validSha256
    },
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    },
    ...overrides
  };
}

function acquisitionPlan(payload) {
  return {
    id: "plan-1",
    ownerId: "owner-1",
    teamId: "team-1",
    status: "draft",
    version: 1,
    revision: 1,
    etag: "etag-1",
    currentVersionId: "plan-version-1",
    approvedVersionId: null,
    approvedSnapshotHash: null,
    approvedBy: null,
    approvedAt: null,
    budgetSnapshot: payload.budgetSnapshot,
    payload,
    createdBy: "user-1",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "user-1",
    updatedAt: "2026-08-15T00:00:00.000Z"
  };
}

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

test("candidate intelligence operations expose only the strict public DTO", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("candidate-intelligence-operation");
  const operation = {
    id: "candidate-intelligence-1",
    candidateId: "candidate-1",
    status: "succeeded",
    currentStage: null,
    completedStages: ["research", "qualification", "battle_card"],
    skippedStages: [],
    research: {
      summary: "已形成公开证据支持的客户研究结论",
      findings: [{
        label: "需求信号",
        content: "客户正在调研获客方案",
        evidenceIds: ["evidence-1"],
        confidence: 0.88
      }]
    },
    qualification: {
      grade: "A",
      score: 82,
      hardGateFailures: [],
      financialValueId: "financial-value-1"
    },
    battleCardId: "battle-card-1",
    failure: null,
    createdAt: "2026-08-07T01:00:00.000Z",
    startedAt: "2026-08-07T01:00:01.000Z",
    updatedAt: "2026-08-07T01:00:03.000Z",
    completedAt: "2026-08-07T01:00:03.000Z",
    failedAt: null
  };

  assert.equal(validate(operation), true, JSON.stringify(validate.errors));
  for (const internalField of [
    "ownerId",
    "teamId",
    "actorId",
    "sessionId",
    "identityFingerprint",
    "idempotencyKey",
    "idempotencyKeyHash",
    "requestHash",
    "leaseOwner",
    "leaseToken",
    "leaseExpiresAt"
  ]) {
    assert.equal(
      validate({ ...operation, [internalField]: "internal" }),
      false,
      internalField
    );
  }
});

test("Douyin identity operations expose only the strict public DTO", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("douyin-identity-resolution-operation");
  const operation = {
    id: "douyin-identity-1", candidateId: "candidate-1", candidateVersion: 2,
    status: "failed", currentStage: null, outcome: "provider_unavailable",
    retryable: true, canonicalProfileUrl: null, profileCandidates: [],
    evidence: [], intelligenceOperationId: null,
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    completedAt: "2026-08-08T00:00:00.000Z"
  };
  assert.equal(validate(operation), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...operation, leaseToken: "secret" }), false);
  assert.equal(validate({ ...operation, ownerId: "owner-1" }), false);
});

test("platform and action placeholder components are published without routes", async () => {
  const document = await loadOpenApiSource();
  const componentRefs = {
    PlatformConnection: "../json-schema/platform-connection.v1.schema.json",
    PlatformCapabilitySnapshot: "../json-schema/platform-capability-snapshot.v1.schema.json",
    PlatformEvent: "../json-schema/platform-event.v1.schema.json",
    DouyinCommentEvent: "../json-schema/douyin-comment-event.v1.schema.json",
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

test("Douyin comment events publish a strict top-level public sample", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("douyin-comment-event");

  assert.equal(validate(douyinCommentEvent), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...douyinCommentEvent, parentCommentId: "reply-1" }), false);
  assert.equal(validate({
    ...douyinCommentEvent,
    coverage: "all_comments"
  }), false);
  assert.equal(validate({
    ...douyinCommentEvent,
    actor: { ...douyinCommentEvent.actor, avatar: "https://example.com/a.jpg" }
  }), false);
  assert.equal(validate({ ...douyinCommentEvent, unexpected: true }), false);
  for (const field of ["textHash", "rawArtifactHash"]) {
    for (const invalidDigest of [
      "sha256:abc",
      `sha256:${"A".repeat(64)}`,
      `sha256:${"0".repeat(63)}`
    ]) {
      assert.equal(validate({
        ...douyinCommentEvent,
        [field]: invalidDigest
      }), false, `${field}: ${invalidDigest}`);
    }
  }
});

test("discovery evidence accepts only exact public platform-event provenance", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("discovery-evidence");
  const evidence = {
    id: "evidence-comment-1",
    targetType: "individual_signal",
    sourcePlatform: "douyin",
    sourceTitle: "抖音公开评论",
    sourceSnippet: "我们正在采购 20 套，请报价。",
    publishedAt: "2026-08-15T01:00:00.000Z",
    fetchedAt: "2026-08-15T01:01:00.000Z",
    locale: "zh-CN",
    rawArtifactHash: validSha256,
    contentHash: validSha256,
    provenance: {
      kind: "platform_public_event",
      sourceUrl: "https://www.douyin.com/video/7536012345678909876",
      platformEventId: "comment-1",
      providerVersion: "douyin-public-comment-provider-v1",
      coverage: "public_top_level_sample"
    },
    accessStatus: "public_content"
  };

  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...evidence, targetType: "organization" }), false);
  assert.equal(validate({ ...evidence, accessStatus: "indexed_summary" }), false);
  assert.equal(validate({
    ...evidence,
    provenance: { ...evidence.provenance, coverage: "all_comments" }
  }), false);
  assert.equal(validate({
    ...evidence,
    provenance: { ...evidence.provenance, providerVersion: undefined }
  }), false);
  assert.equal(validate({
    ...evidence,
    provenance: { ...evidence.provenance, unexpected: true }
  }), false);
});

test("individual demand signals bound profile fields without narrowing v1 negative signals", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("individual-demand-signal");
  const signal = {
    id: "signal-1",
    publicActorKey: "douyin:sec_uid:MS4wLjABAAAA_actor-1",
    publicDisplayName: "公开用户",
    publicProfileUrl: "https://www.douyin.com/video/7536012345678909876",
    sourcePlatform: "douyin",
    evidenceIds: ["evidence-1"],
    demandCategory: "抖音公开评论需求信号",
    demandSummary: "公开评论信号，非已核实客户事实。",
    locationHint: "上海",
    buyingStage: "purchase_ready",
    negativeSignals: [],
    subjectKind: "individual",
    status: "needs_research",
    version: 1,
    identityResolved: false,
    latestDecisionVersion: null,
    approvedDecisionVersion: null,
    updatedAt: "2026-08-15T01:00:00.000Z",
    firstSeenAt: "2026-08-15T01:00:00.000Z",
    lastSeenAt: "2026-08-15T01:00:00.000Z"
  };

  assert.equal(validate(signal), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...signal, publicActorKey: "a".repeat(301) }), false);
  assert.equal(validate({ ...signal, demandSummary: "a".repeat(2_001) }), false);
  const legacyNegativeSignals = [
    ...Array.from({ length: 13 }, (_, index) => `reason-${index}`),
    "reason-1",
    "x".repeat(150)
  ];
  assert.equal(validate({
    ...signal,
    negativeSignals: legacyNegativeSignals
  }), true, JSON.stringify(validate.errors));
});

test("acquisition plans version an optional Douyin public comment policy", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("acquisition-plan");
  const policy = {
    enabled: true,
    maxVideosPerRun: 20,
    maxCommentsPerVideo: 100,
    maxPagesPerVideo: 5
  };

  const legacyPayload = acquisitionPlanPayload();
  assert.equal(validate(acquisitionPlan(legacyPayload)), true, JSON.stringify(validate.errors));
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    douyinPublicCommentSample: policy
  }))), true, JSON.stringify(validate.errors));
  const providerBinding = acquisitionPlanPayload().providerConnections[0];
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    providerConnections: [
      { ...providerBinding, providerId: "another-provider" },
      providerBinding
    ],
    douyinPublicCommentSample: policy
  }))), true, JSON.stringify(validate.errors));
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    providerConnections: [],
    douyinPublicCommentSample: policy
  }))), false, "enabled sampling must reject an empty provider set");
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    providerConnections: [
      { ...providerBinding, providerId: "another-provider" },
      { ...providerBinding, kind: "search" },
      { ...providerBinding, status: "inactive" }
    ],
    douyinPublicCommentSample: policy
  }))), false, "enabled sampling must reject a provider set with no exact match");
  for (const invalidBinding of [
    { ...providerBinding, providerId: "another-provider" },
    { ...providerBinding, kind: "search" },
    { ...providerBinding, status: "inactive" }
  ]) {
    assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
      providerConnections: [invalidBinding],
      douyinPublicCommentSample: policy
    }))), false, JSON.stringify(invalidBinding));
  }
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    targetPlatform: "web",
    douyinPublicCommentSample: policy
  }))), false);
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    targetPlatform: "web",
    douyinPublicCommentSample: { ...policy, enabled: false }
  }))), true, JSON.stringify(validate.errors));
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    douyinPublicCommentSample: { ...policy, maxCommentsPerVideo: 101 }
  }))), false);
  assert.equal(validate(acquisitionPlan(acquisitionPlanPayload({
    douyinPublicCommentSample: { ...policy, unexpected: true }
  }))), false);
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

test("live outcome attribution publishes the complete persisted acquisition run chain", async () => {
  const registry = await loadSchemaRegistry();
  const attribution = registry.schemaDocuments.get("outcome-feedback")
    .$defs.liveAttribution;
  for (const field of [
    "attributionVersion",
    "planId",
    "planVersionId",
    "planVersion",
    "planSnapshotHash",
    "discoveredEventId",
    "discoveredAt",
    "shardId",
    "operationId",
    "connectionId",
    "providerId"
  ]) {
    assert.ok(attribution.required.includes(field), `${field} is required`);
    assert.ok(attribution.properties[field], `${field} is published`);
  }
});
