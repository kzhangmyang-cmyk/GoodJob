import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DiscoveryEvidence } from "./acquisition-domain.js";
import type {
  DouyinPublicProfileDiscoveryResult
} from "./acquisition-douyin-public-profile-discovery.js";
import type {
  SearchPublicSourcesResponse
} from "./acquisition-tool-executor.js";
import {
  AcquisitionDouyinIdentityResolutionOperationError,
  AcquisitionDouyinIdentityResolutionOperationService,
  InMemoryAcquisitionDouyinIdentityResolutionOperationRepository,
  type AcquisitionDouyinIdentityResolutionScope
} from "./acquisition-douyin-identity-resolution-operations.js";

const SCOPE: AcquisitionDouyinIdentityResolutionScope = {
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "actor-a"
};

function evidence(
  id: string,
  contentHash: string,
  rawArtifactHash: string
): DiscoveryEvidence {
  return {
    id,
    ownerId: SCOPE.ownerId,
    teamId: SCOPE.teamId,
    targetType: "individual_signal",
    sourcePlatform: "douyin",
    sourceTitle: id,
    sourceSnippet: "公开证据",
    publishedAt: null,
    fetchedAt: "2026-08-08T00:00:00.000Z",
    locale: "zh-CN",
    rawArtifactHash,
    contentHash,
    provenance: {
      kind: "search_result",
      provider: "douyin",
      queryText: id,
      sourceUrl: `https://www.douyin.com/video/${id}`,
      resultRank: 1
    },
    accessStatus: "public_content",
    supersedesEvidenceId: null
  };
}

function fixture() {
  const repository =
    new InMemoryAcquisitionDouyinIdentityResolutionOperationRepository();
  const evidenceById = new Map([
    ["evidence-a", evidence("evidence-a", "sha256:content-a", "sha256:raw-a")],
    ["evidence-b", evidence("evidence-b", "sha256:content-b", "sha256:raw-b")]
  ]);
  let now = "2026-08-08T00:00:00.000Z";
  let sequence = 0;
  const service = new AcquisitionDouyinIdentityResolutionOperationService({
    repository,
    evidence: {
      async getEvidence(scope, evidenceId) {
        const item = evidenceById.get(evidenceId);
        return item
          && item.ownerId === scope.ownerId
          && item.teamId === scope.teamId
          ? structuredClone(item)
          : null;
      }
    },
    idFactory: () => `identity-operation-${++sequence}`,
    now: () => now
  });
  return {
    repository,
    evidenceById,
    service,
    setNow(value: string) {
      now = value;
    }
  };
}

const CREATE_INPUT = {
  candidateId: "candidate-1",
  expectedCandidateVersion: 3,
  sourceEvidenceIds: ["evidence-a", "evidence-b"],
  providerConnectionIds: ["search-connection-2", "search-connection-1"],
  planSessionId: "acquisition-plan:run-1"
};

test("create persists a queued operation at the expected candidate version", async () => {
  const { service } = fixture();

  const created = await service.create(
    SCOPE,
    CREATE_INPUT,
    "identity-create-key"
  );

  assert.equal(created.status, "queued");
  assert.equal(created.candidateVersion, 3);
  assert.equal(created.candidateId, "candidate-1");
  assert.deepEqual(created.providerConnectionIds, [
    "search-connection-1",
    "search-connection-2"
  ]);
  assert.equal(created.planSessionId, "acquisition-plan:run-1");
  assert.equal(created.outcome, null);
  assert.deepEqual(created.evidence, []);
});

test("idempotency replays equivalent requests independent of source order and time", async () => {
  const { service, setNow } = fixture();
  const created = await service.create(
    SCOPE,
    CREATE_INPUT,
    "identity-create-key"
  );
  setNow("2026-08-08T01:00:00.000Z");

  const replayed = await service.create(SCOPE, {
    ...CREATE_INPUT,
    sourceEvidenceIds: ["evidence-b", "evidence-a"],
    providerConnectionIds: ["search-connection-1", "search-connection-2"]
  }, "identity-create-key");

  assert.deepEqual(replayed, created);
});

test("idempotency conflicts when the candidate or original evidence hashes change", async () => {
  const { service, evidenceById } = fixture();
  await service.create(SCOPE, CREATE_INPUT, "identity-create-key");

  await assert.rejects(
    service.create(SCOPE, {
      ...CREATE_INPUT,
      candidateId: "candidate-2"
    }, "identity-create-key"),
    (error: unknown) => error instanceof AcquisitionDouyinIdentityResolutionOperationError
      && error.code === "IDEMPOTENCY_CONFLICT"
  );

  evidenceById.set(
    "evidence-a",
    evidence("evidence-a", "sha256:changed", "sha256:raw-a")
  );
  await assert.rejects(
    service.create(SCOPE, CREATE_INPUT, "identity-create-key"),
    (error: unknown) => error instanceof AcquisitionDouyinIdentityResolutionOperationError
      && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("create rejects duplicate source evidence IDs", async () => {
  const { service } = fixture();

  await assert.rejects(
    service.create(SCOPE, {
      ...CREATE_INPUT,
      sourceEvidenceIds: ["evidence-a", "evidence-a"]
    }, "duplicate-source-key"),
    (error: unknown) => error instanceof AcquisitionDouyinIdentityResolutionOperationError
      && error.code === "INVALID_REQUEST"
  );
});

test("create rejects an untrusted plan session before persistence", async () => {
  const { service, repository } = fixture();

  await assert.rejects(
    service.create(SCOPE, {
      ...CREATE_INPUT,
      planSessionId: "model-session:not-a-frozen-plan"
    }, "invalid-plan-session"),
    (error: unknown) => error instanceof AcquisitionDouyinIdentityResolutionOperationError
      && error.code === "INVALID_REQUEST"
  );
  assert.equal(
    await repository.findOperationByIdempotency({
      ownerId: SCOPE.ownerId,
      teamId: SCOPE.teamId,
      idempotencyKeyHash: createHash("sha256")
        .update("invalid-plan-session")
        .digest("hex")
    }),
    null
  );
});

test("latest candidate lookup is tenant scoped", async () => {
  const { service, evidenceById } = fixture();
  const otherScope = { ...SCOPE, ownerId: "owner-b", actorId: "actor-b" };
  evidenceById.set("evidence-other", {
    ...evidence("evidence-other", "sha256:content-other", "sha256:raw-other"),
    ownerId: otherScope.ownerId
  });
  const first = await service.create(SCOPE, {
    ...CREATE_INPUT,
    sourceEvidenceIds: ["evidence-a"]
  }, "latest-a");
  const other = await service.create(otherScope, {
    ...CREATE_INPUT,
    sourceEvidenceIds: ["evidence-other"]
  }, "latest-b");

  assert.equal(
    (await service.findLatestForCandidate(SCOPE, "candidate-1"))?.id,
    first.id
  );
  assert.equal(
    (await service.findLatestForCandidate(otherScope, "candidate-1"))?.id,
    other.id
  );
  assert.equal(
    await service.findLatestForCandidate(
      { ...SCOPE, teamId: "other-team" },
      "candidate-1"
    ),
    null
  );
});

test("only the active lease token can save an operation", async () => {
  const { service, repository } = fixture();
  const created = await service.create(SCOPE, CREATE_INPUT, "lease-save");
  const claimed = await repository.claimOperation(SCOPE, created.id, {
    leaseOwner: "worker-a",
    leaseToken: "lease-token-a",
    claimedAt: "2026-08-08T00:01:00.000Z",
    leaseExpiresAt: "2026-08-08T00:11:00.000Z"
  });
  assert.equal(claimed.claimed, true);
  const completed = {
    ...claimed.operation!,
    status: "succeeded" as const,
    outcome: "verified_consensus" as const,
    completedAt: "2026-08-08T00:02:00.000Z",
    updatedAt: "2026-08-08T00:02:00.000Z"
  };

  await assert.rejects(
    repository.saveOperation(completed, "lease-token-b"),
    (error: unknown) => error instanceof AcquisitionDouyinIdentityResolutionOperationError
      && error.code === "OPERATION_ALREADY_RUNNING"
  );
  await repository.saveOperation(completed, "lease-token-a");
  assert.equal((await repository.getOperation(SCOPE, created.id))?.status, "succeeded");
});

test("concurrent claimants produce exactly one lease winner", async () => {
  const { service, repository } = fixture();
  const created = await service.create(SCOPE, CREATE_INPUT, "concurrent-claim");
  const claims = [
    {
      leaseOwner: "worker-a",
      leaseToken: "lease-token-a",
      claimedAt: "2026-08-08T00:01:00.000Z",
      leaseExpiresAt: "2026-08-08T00:11:00.000Z"
    },
    {
      leaseOwner: "worker-b",
      leaseToken: "lease-token-b",
      claimedAt: "2026-08-08T00:01:00.000Z",
      leaseExpiresAt: "2026-08-08T00:11:00.000Z"
    }
  ];

  const results = await Promise.all(claims.map((claim) =>
    repository.claimOperation(SCOPE, created.id, claim)
  ));
  const winners = results.filter((result) => result.claimed);
  const stored = await repository.getOperation(SCOPE, created.id);

  assert.equal(winners.length, 1);
  assert.equal(stored?.leaseToken, winners[0]?.operation?.leaseToken);
  assert.equal(stored?.leaseOwner, winners[0]?.operation?.leaseOwner);
});

test("request identity replays across case and non-ASCII ordering without localeCompare", async () => {
  const { service, evidenceById } = fixture();
  evidenceById.set(
    "Evidence-Z",
    evidence("Evidence-Z", "sha256:内容-Z", "sha256:原文-Z")
  );
  evidenceById.set(
    "证据-é",
    evidence("证据-é", "sha256:内容-é", "sha256:原文-é")
  );
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function forbiddenLocaleCompare() {
    throw new Error("localeCompare must not define request identity");
  };
  try {
    const created = await service.create(SCOPE, {
      ...CREATE_INPUT,
      sourceEvidenceIds: ["证据-é", "Evidence-Z"],
      providerConnectionIds: ["搜索-é", "Connection-Z"]
    }, "locale-independent-request");
    const replayed = await service.create(SCOPE, {
      ...CREATE_INPUT,
      sourceEvidenceIds: ["Evidence-Z", "证据-é"],
      providerConnectionIds: ["Connection-Z", "搜索-é"]
    }, "locale-independent-request");

    assert.deepEqual(replayed, created);
    assert.deepEqual(created.providerConnectionIds, [
      "Connection-Z",
      "搜索-é"
    ]);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("terminal operations are never claimed", async () => {
  const { service, repository } = fixture();
  for (const status of ["succeeded", "requires_review", "failed"] as const) {
    const created = await service.create(SCOPE, CREATE_INPUT, `terminal-${status}`);
    const firstClaim = await repository.claimOperation(SCOPE, created.id, {
      leaseOwner: "worker-a",
      leaseToken: `token-${status}`,
      claimedAt: "2026-08-08T00:01:00.000Z",
      leaseExpiresAt: "2026-08-08T00:11:00.000Z"
    });
    await repository.saveOperation({
      ...firstClaim.operation!,
      status,
      retryable: status === "failed",
      outcome: status === "succeeded" ? "verified_consensus" : "ambiguous",
      updatedAt: "2026-08-08T00:02:00.000Z",
      completedAt: "2026-08-08T00:02:00.000Z"
    }, `token-${status}`);

    const secondClaim = await repository.claimOperation(SCOPE, created.id, {
      leaseOwner: "worker-b",
      leaseToken: `second-${status}`,
      claimedAt: "2026-08-08T01:00:00.000Z",
      leaseExpiresAt: "2026-08-08T01:10:00.000Z"
    });
    assert.equal(secondClaim.claimed, false, status);
  }
});

test("recovery returns queued and expired-running operations in creation order", async () => {
  const { service, repository, setNow } = fixture();
  const queued = await service.create(SCOPE, CREATE_INPUT, "recovery-queued");
  setNow("2026-08-08T00:00:01.000Z");
  const expired = await service.create(SCOPE, CREATE_INPUT, "recovery-expired");
  await repository.claimOperation(SCOPE, expired.id, {
    leaseOwner: "worker-old",
    leaseToken: "expired-token",
    claimedAt: "2026-08-08T00:00:02.000Z",
    leaseExpiresAt: "2026-08-08T00:01:00.000Z"
  });
  setNow("2026-08-08T00:00:03.000Z");
  const active = await service.create(SCOPE, CREATE_INPUT, "recovery-active");
  await repository.claimOperation(SCOPE, active.id, {
    leaseOwner: "worker-active",
    leaseToken: "active-token",
    claimedAt: "2026-08-08T00:00:04.000Z",
    leaseExpiresAt: "2026-08-08T02:00:00.000Z"
  });

  const recoverable = await repository.listRecoverableOperations({
    now: "2026-08-08T01:00:00.000Z",
    limit: 100
  });

  assert.deepEqual(recoverable.map((operation) => operation.id), [
    queued.id,
    expired.id
  ]);
});

const PROFILE_URL = "https://www.douyin.com/user/MS4wLjABAAAAverified";
const OTHER_PROFILE_URL =
  "https://www.douyin.com/user/MS4wLjABAAAAconflicting";
const SOURCE_URL = "https://www.douyin.com/video/7536012345678901234";

type ExecutionScenario =
  | "verified"
  | "not_found"
  | "insufficient_evidence"
  | "ambiguous"
  | "conflicting"
  | "access_restricted"
  | "redirect_not_allowed"
  | "stale_candidate"
  | "provider_unavailable";

function executionFixture(
  scenario: ExecutionScenario,
  options: {
    beforeDiscover?: (sourceUrl: string) => Promise<void>;
    heartbeatIntervalMs?: number;
    heartbeatScheduler?: {
      setInterval(callback: () => void, delayMs: number): unknown;
      clearInterval(handle: unknown): void;
    };
    leaseDurationMs?: number;
    now?: () => string;
  } = {}
) {
  const repository =
    new InMemoryAcquisitionDouyinIdentityResolutionOperationRepository();
  const sourceEvidence: DiscoveryEvidence = {
    ...evidence(
      "source-evidence",
      "sha256:source-content",
      "sha256:source-raw"
    ),
    sourceTitle: "厦门门店主理人寻找 AI 获客方案",
    sourceSnippet: "作者线索：林老师，近期正在比较供应商。",
    provenance: {
      kind: "user_submitted_url",
      sourceUrl: SOURCE_URL,
      submittedBy: SCOPE.actorId
    }
  };
  const evidenceById = new Map([[sourceEvidence.id, sourceEvidence]]);
  const appendedEvidence: DiscoveryEvidence[] = [];
  const discoveryCalls: string[] = [];
  const searchCalls: Array<{
    providerConnectionId: string;
    query: string;
    sessionId: string;
  }> = [];
  const identityCommits: Array<{
    candidateId: string;
    input: {
      expectedCandidateVersion: number;
      evidenceIds: string[];
      subject: { publicProfileUrl: string };
    };
    idempotencyKey: string;
  }> = [];
  const intelligenceCreates: Array<{
    candidateId: string;
    idempotencyKey: string;
    options: { trustedSessionId?: string };
  }> = [];
  const intelligenceExecutes: string[] = [];
  let generatedEvidence = 0;
  let generatedOperation = 0;
  let candidateVersion = scenario === "stale_candidate" ? 4 : 3;

  const discoveryResult = (
    sourceUrl: string
  ): DouyinPublicProfileDiscoveryResult => {
    if (sourceUrl === SOURCE_URL) {
      if (scenario === "not_found") {
        return { status: "not_found", redirectChain: [SOURCE_URL], publicProfileUrls: [] };
      }
      if (scenario === "access_restricted") {
        return { status: "access_restricted", redirectChain: [SOURCE_URL], publicProfileUrls: [] };
      }
      if (scenario === "redirect_not_allowed") {
        return { status: "redirect_not_allowed", redirectChain: [], publicProfileUrls: [] };
      }
      return {
        status: "succeeded",
        redirectChain: [SOURCE_URL],
        publicProfileUrls: scenario === "ambiguous"
          ? [PROFILE_URL, OTHER_PROFILE_URL]
          : [PROFILE_URL],
        rawArtifactHash: "sha256:source-page-raw",
        contentHash: "sha256:source-page-content"
      };
    }
    return {
      status: "succeeded",
      redirectChain: [sourceUrl],
      publicProfileUrls: [sourceUrl],
      rawArtifactHash: sourceUrl === PROFILE_URL
        ? "sha256:profile-page-raw"
        : "sha256:other-profile-page-raw",
      contentHash: sourceUrl === PROFILE_URL
        ? "sha256:profile-page-content"
        : "sha256:other-profile-page-content"
    };
  };

  const searchResponse = (
    connectionId: string
  ): SearchPublicSourcesResponse => ({
    providerConnectionId: connectionId,
    provider: "baidu-search",
    requestId: `request-${connectionId}`,
    results: scenario === "not_found"
      || scenario === "insufficient_evidence"
      || scenario === "ambiguous"
      || scenario === "access_restricted"
      || scenario === "redirect_not_allowed"
      ? []
      : [{
          providerRecordId: `record-${connectionId}`,
          sourceUrl: scenario === "conflicting"
            ? OTHER_PROFILE_URL
            : PROFILE_URL,
          sourcePlatform: "douyin",
          sourceType: "profile",
          title: "林老师的抖音主页",
          snippet: "厦门门店主理人",
          publishedAt: null,
          locale: "zh-CN",
          rawArtifactHash: `sha256:search-raw-${connectionId}`,
          accessStatus: "indexed_summary",
          subject: {
            kind: "individual",
            publicActorKey: "douyin:lin",
            publicDisplayName: "林老师",
            publicProfileUrl: scenario === "conflicting"
              ? OTHER_PROFILE_URL
              : PROFILE_URL,
            sourcePlatform: "douyin",
            demandCategory: "AI 获客",
            demandSummary: "比较供应商",
            locationHint: "厦门",
            buyingStage: "comparison",
            negativeSignals: []
          }
        }]
  });

  const service = new AcquisitionDouyinIdentityResolutionOperationService({
    repository,
    evidence: {
      async getEvidence(candidateScope, evidenceId) {
        const item = evidenceById.get(evidenceId);
        return item
          && item.ownerId === candidateScope.ownerId
          && item.teamId === candidateScope.teamId
          ? structuredClone(item)
          : null;
      },
      async appendEvidence(_candidateScope, input) {
        const item: DiscoveryEvidence = {
          ...input,
          id: `verified-evidence-${++generatedEvidence}`,
          ownerId: SCOPE.ownerId,
          teamId: SCOPE.teamId,
          fetchedAt: "2026-08-08T00:00:00.000Z",
          supersedesEvidenceId: input.supersedesEvidenceId ?? null
        };
        evidenceById.set(item.id, item);
        appendedEvidence.push(structuredClone(item));
        return structuredClone(item);
      }
    },
    candidates: {
      async getCandidate() {
        return {
          id: "candidate-1",
          version: candidateVersion
        };
      }
    },
    discovery: {
      async discover(input) {
        await options.beforeDiscover?.(input.sourceUrl);
        discoveryCalls.push(input.sourceUrl);
        return discoveryResult(input.sourceUrl);
      }
    },
    search: {
      async search(input) {
        searchCalls.push({
          providerConnectionId: input.providerConnectionId,
          query: input.query,
          sessionId: input.sessionId
        });
        if (scenario === "provider_unavailable") {
          throw new Error("provider temporarily unavailable");
        }
        if (input.providerConnectionId === "search-connection-failed") {
          throw new Error("one provider failed");
        }
        return searchResponse(input.providerConnectionId);
      }
    },
    identityResolution: {
      async resolveCandidateIdentity(
        _candidateScope,
        candidateId,
        input,
        idempotencyKey
      ) {
        identityCommits.push({
          candidateId,
          input: structuredClone(input),
          idempotencyKey
        });
        return {} as never;
      }
    },
    candidateIntelligence: {
      async createAfterIdentity(
        _candidateScope,
        candidateId,
        idempotencyKey,
        options = {}
      ) {
        intelligenceCreates.push({ candidateId, idempotencyKey, options });
        return {
          id: "candidate-intelligence-1",
          candidateId,
          status: "queued"
        } as never;
      },
      async execute(_candidateScope, operationId) {
        intelligenceExecutes.push(operationId);
        return {
          id: operationId,
          candidateId: "candidate-1",
          status: "succeeded"
        } as never;
      }
    },
    workerId: "identity-worker",
    leaseTokenFactory: () => "identity-lease",
    leaseDurationMs: options.leaseDurationMs ?? 60_000,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    heartbeatScheduler: options.heartbeatScheduler,
    idFactory: () => `identity-operation-${++generatedOperation}`,
    now: options.now ?? (() => "2026-08-08T00:00:00.000Z")
  });

  return {
    service,
    repository,
    appendedEvidence,
    discoveryCalls,
    searchCalls,
    identityCommits,
    intelligenceCreates,
    intelligenceExecutes,
    setCandidateVersion(value: number) {
      candidateVersion = value;
    }
  };
}

test("executes public-page and independent-search verification before one identity and intelligence chain", async () => {
  const state = executionFixture("verified");
  const created = await state.service.create(SCOPE, {
    candidateId: "candidate-1",
    expectedCandidateVersion: 3,
    sourceEvidenceIds: ["source-evidence"],
    providerConnectionIds: [
      "search-connection-failed",
      "search-connection-success"
    ],
    planSessionId: "acquisition-plan:run-123"
  }, "verified-operation-key");

  const completed = await state.service.execute(SCOPE, created.id);

  assert.equal(completed.status, "succeeded");
  assert.equal(completed.outcome, "verified_consensus");
  assert.equal(completed.canonicalProfileUrl, PROFILE_URL);
  assert.deepEqual(state.discoveryCalls, [SOURCE_URL, PROFILE_URL]);
  assert.equal(state.searchCalls.length, 2);
  assert.match(state.searchCalls[0]!.query, /7536012345678901234/u);
  assert.match(state.searchCalls[0]!.query, /林老师/u);
  assert.equal(state.appendedEvidence.length, 2);
  assert.deepEqual(state.appendedEvidence[0]?.provenance, {
    kind: "controlled_public_page",
    sourceUrl: PROFILE_URL,
    discoveredFromEvidenceId: "source-evidence",
    redirectChain: [PROFILE_URL],
    extractorVersion: "douyin-public-profile-v1"
  });
  assert.deepEqual(state.appendedEvidence[1]?.provenance, {
    kind: "search_result",
    provider: "baidu-search",
    providerConnectionId: "search-connection-success",
    requestId: "request-search-connection-success",
    providerRecordId: "record-search-connection-success",
    queryText: state.searchCalls[1]!.query,
    sourceUrl: PROFILE_URL,
    resultRank: 1,
    sourceType: "profile"
  });
  assert.equal(state.identityCommits.length, 1);
  assert.equal(state.identityCommits[0]?.input.expectedCandidateVersion, 3);
  assert.deepEqual(state.identityCommits[0]?.input.evidenceIds, [
    "verified-evidence-1",
    "verified-evidence-2"
  ]);
  assert.equal(
    state.identityCommits[0]?.idempotencyKey.startsWith(
      "douyin-identity:commit:sha256:"
    ),
    true
  );
  assert.equal(state.intelligenceCreates.length, 1);
  assert.equal(
    state.intelligenceCreates[0]?.idempotencyKey.startsWith(
      "douyin-identity:intelligence:sha256:"
    ),
    true
  );
  assert.deepEqual(state.intelligenceCreates[0]?.options, {
    trustedSessionId: "acquisition-plan:run-123"
  });
  assert.deepEqual(state.intelligenceExecutes, ["candidate-intelligence-1"]);

  const replay = await state.service.execute(SCOPE, created.id);
  assert.deepEqual(replay, completed);
  assert.equal(state.identityCommits.length, 1);
  assert.equal(state.intelligenceCreates.length, 1);
  assert.equal(state.intelligenceExecutes.length, 1);
});

test("lease recovery resumes persisted intelligence dispatch without repeating identity confirmation", async () => {
  const state = executionFixture("verified");
  const created = await state.service.create(SCOPE, {
    candidateId: "candidate-1",
    expectedCandidateVersion: 3,
    sourceEvidenceIds: ["source-evidence"],
    providerConnectionIds: ["search-connection-success"],
    planSessionId: "acquisition-plan:run-recovery"
  }, "recover-intelligence-dispatch");
  const oldClaim = await state.repository.claimOperation(SCOPE, created.id, {
    leaseOwner: "crashed-worker",
    leaseToken: "crashed-lease",
    claimedAt: "2026-08-07T23:58:00.000Z",
    leaseExpiresAt: "2026-08-07T23:59:00.000Z"
  });
  await state.repository.saveOperation({
    ...oldClaim.operation!,
    currentStage: "intelligence_dispatch",
    outcome: "verified_consensus",
    canonicalProfileUrl: PROFILE_URL,
    profileCandidates: [{
      publicProfileUrl: PROFILE_URL,
      evidenceIds: ["verified-evidence-public", "verified-evidence-search"]
    }],
    intelligenceOperationId: "candidate-intelligence-1"
  }, "crashed-lease");
  state.setCandidateVersion(4);

  const completed = await state.service.execute(SCOPE, created.id);

  assert.equal(completed.status, "succeeded");
  assert.equal(completed.outcome, "verified_consensus");
  assert.deepEqual(state.discoveryCalls, []);
  assert.deepEqual(state.searchCalls, []);
  assert.deepEqual(state.identityCommits, []);
  assert.deepEqual(state.intelligenceCreates, []);
  assert.deepEqual(state.intelligenceExecutes, ["candidate-intelligence-1"]);
});

test("renews the identity lease while public verification is still running", async () => {
  let now = "2026-08-08T00:00:00.000Z";
  let releaseDiscovery!: () => void;
  let discoveryStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    discoveryStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  const heartbeatCallbacks: Array<() => void> = [];
  const clearedHandles: unknown[] = [];
  const state = executionFixture("verified", {
    now: () => now,
    leaseDurationMs: 10_000,
    heartbeatIntervalMs: 1_000,
    heartbeatScheduler: {
      setInterval(callback) {
        heartbeatCallbacks.push(callback);
        return callback;
      },
      clearInterval(handle) {
        clearedHandles.push(handle);
      }
    },
    async beforeDiscover(sourceUrl) {
      if (sourceUrl !== SOURCE_URL) return;
      discoveryStarted();
      await blocked;
    }
  });
  const created = await state.service.create(SCOPE, {
    candidateId: "candidate-1",
    expectedCandidateVersion: 3,
    sourceEvidenceIds: ["source-evidence"],
    providerConnectionIds: ["search-connection-success"],
    planSessionId: "acquisition-plan:run-heartbeat"
  }, "heartbeat-operation");

  const execution = state.service.execute(SCOPE, created.id);
  await started;
  assert.equal(heartbeatCallbacks.length, 1);
  now = "2026-08-08T00:00:05.000Z";
  heartbeatCallbacks[0]!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    (await state.repository.getOperation(SCOPE, created.id))?.leaseExpiresAt,
    "2026-08-08T00:00:15.000Z"
  );
  releaseDiscovery();

  assert.equal((await execution).status, "succeeded");
  assert.deepEqual(clearedHandles, [heartbeatCallbacks[0]]);
});

test("aborts before evidence mutation when the identity lease is lost", async () => {
  let now = "2026-08-08T00:00:00.000Z";
  let releaseDiscovery!: () => void;
  let discoveryStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    discoveryStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  const heartbeatCallbacks: Array<() => void> = [];
  const state = executionFixture("verified", {
    now: () => now,
    leaseDurationMs: 10_000,
    heartbeatIntervalMs: 1_000,
    heartbeatScheduler: {
      setInterval(callback) {
        heartbeatCallbacks.push(callback);
        return callback;
      },
      clearInterval() {}
    },
    async beforeDiscover(sourceUrl) {
      if (sourceUrl !== SOURCE_URL) return;
      discoveryStarted();
      await blocked;
    }
  });
  const created = await state.service.create(SCOPE, {
    candidateId: "candidate-1",
    expectedCandidateVersion: 3,
    sourceEvidenceIds: ["source-evidence"],
    providerConnectionIds: ["search-connection-success"],
    planSessionId: "acquisition-plan:run-lease-loss"
  }, "lease-loss-operation");
  const execution = state.service.execute(SCOPE, created.id);
  await started;
  now = "2026-08-08T00:00:11.000Z";
  const replacement = await state.repository.claimOperation(
    SCOPE,
    created.id,
    {
      leaseOwner: "replacement-worker",
      leaseToken: "replacement-lease",
      claimedAt: now,
      leaseExpiresAt: "2026-08-08T00:00:21.000Z"
    }
  );
  assert.equal(replacement.claimed, true);
  heartbeatCallbacks[0]!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseDiscovery();

  await assert.rejects(
    execution,
    (error: unknown) => error instanceof AcquisitionDouyinIdentityResolutionOperationError
      && error.code === "OPERATION_ALREADY_RUNNING"
  );
  assert.deepEqual(state.appendedEvidence, []);
  assert.deepEqual(state.identityCommits, []);
  assert.deepEqual(state.intelligenceCreates, []);
});

test("persisted invalid plan sessions fail before evidence or identity side effects", async () => {
  const state = executionFixture("verified");
  const created = await state.service.create(SCOPE, {
    candidateId: "candidate-1",
    expectedCandidateVersion: 3,
    sourceEvidenceIds: ["source-evidence"],
    providerConnectionIds: ["search-connection-success"],
    planSessionId: null
  }, "persisted-invalid-session");
  const oldClaim = await state.repository.claimOperation(SCOPE, created.id, {
    leaseOwner: "corrupting-worker",
    leaseToken: "corrupting-lease",
    claimedAt: "2026-08-07T23:58:00.000Z",
    leaseExpiresAt: "2026-08-07T23:59:00.000Z"
  });
  await state.repository.saveOperation({
    ...oldClaim.operation!,
    planSessionId: "model-session:not-a-frozen-plan"
  }, "corrupting-lease");

  await assert.rejects(
    state.service.execute(SCOPE, created.id),
    (error: unknown) => error instanceof AcquisitionDouyinIdentityResolutionOperationError
      && error.code === "INVALID_REQUEST"
  );
  assert.deepEqual(state.discoveryCalls, []);
  assert.deepEqual(state.searchCalls, []);
  assert.deepEqual(state.appendedEvidence, []);
  assert.deepEqual(state.identityCommits, []);
  assert.deepEqual(state.intelligenceCreates, []);
});

for (const expected of [
  { scenario: "not_found", status: "requires_review" },
  { scenario: "insufficient_evidence", status: "requires_review" },
  { scenario: "ambiguous", status: "requires_review" },
  { scenario: "conflicting", status: "requires_review" },
  { scenario: "access_restricted", status: "requires_review" },
  { scenario: "redirect_not_allowed", status: "requires_review" },
  { scenario: "stale_candidate", status: "requires_review" },
  { scenario: "provider_unavailable", status: "failed" }
] as const) {
  test(`${expected.scenario} is terminal without identity or intelligence side effects`, async () => {
    const state = executionFixture(expected.scenario);
    const created = await state.service.create(SCOPE, {
      candidateId: "candidate-1",
      expectedCandidateVersion: 3,
      sourceEvidenceIds: ["source-evidence"],
      providerConnectionIds: ["search-connection-success"],
      planSessionId: null
    }, `terminal-${expected.scenario}`);

    const completed = await state.service.execute(SCOPE, created.id);

    assert.equal(completed.status, expected.status);
    assert.equal(completed.outcome, expected.scenario);
    assert.equal(
      completed.retryable,
      expected.scenario === "provider_unavailable"
    );
    assert.equal(state.identityCommits.length, 0);
    assert.equal(state.intelligenceCreates.length, 0);
    assert.equal(state.intelligenceExecutes.length, 0);
  });
}
