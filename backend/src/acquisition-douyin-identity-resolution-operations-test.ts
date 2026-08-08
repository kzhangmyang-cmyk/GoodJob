import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveryEvidence } from "./acquisition-domain.js";
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
