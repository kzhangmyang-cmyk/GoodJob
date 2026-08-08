import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Server } from "node:http";
import test from "node:test";
import express from "express";
import {
  createAcquisitionDouyinIdentityResolutionRouter,
  type AcquisitionDouyinIdentityResolutionRouterOperation,
  type AcquisitionDouyinIdentityResolutionRouterScope
} from "./acquisition-douyin-identity-resolution-router.js";

const scope: AcquisitionDouyinIdentityResolutionRouterScope = {
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "owner-a"
};

function operation(overrides: Partial<AcquisitionDouyinIdentityResolutionRouterOperation> = {}) {
  return {
    id: "douyin-operation-1",
    candidateId: "candidate-1",
    candidateVersion: 3,
    status: "succeeded" as const,
    currentStage: null,
    outcome: "verified_consensus" as const,
    retryable: false,
    canonicalProfileUrl: "https://www.douyin.com/user/verified",
    profileCandidates: [{
      publicProfileUrl: "https://www.douyin.com/user/verified",
      evidenceIds: ["evidence-1"]
    }],
    evidence: [{
      evidenceClass: "public" as const,
      accessStatus: "public_content" as const,
      sourceUrl: "https://www.douyin.com/video/1"
    }],
    intelligenceOperationId: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    completedAt: "2026-08-08T00:00:00.000Z",
    ...overrides
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    version: 3,
    partyType: "individual",
    partyRef: { partyType: "individual" },
    profile: { kind: "individual", sourcePlatform: "douyin" },
    identityResolution: null,
    evidenceIds: ["evidence-1"],
    ...overrides
  };
}

async function fixture(input: {
  user?: { id: string; teamId: string } | null;
  candidates?: Map<string, ReturnType<typeof candidate>>;
  latest?: AcquisitionDouyinIdentityResolutionRouterOperation | null;
} = {}) {
  const creations: Array<{ idempotencyKey: string; candidateVersion: number }> = [];
  const dispatched: string[] = [];
  const candidates = input.candidates ?? new Map([["candidate-1", candidate()]]);
  let latest = input.latest ?? operation();
  const idempotencyOperations = new Map<string, AcquisitionDouyinIdentityResolutionRouterOperation>();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (input.user !== null) {
      req.user = input.user ?? {
        id: scope.ownerId,
        teamId: scope.teamId,
        name: "Owner",
        email: "owner@example.test",
        role: "sales",
        avatar: "",
        authVersion: 1
      };
    }
    next();
  });
  app.use(createAcquisitionDouyinIdentityResolutionRouter({
    operations: {
      async findByIdempotency(_requestScope, idempotencyKey) {
        return idempotencyOperations.get(idempotencyKey) ?? null;
      },
      async findLatestForCandidate(requestScope, candidateId) {
        return requestScope.ownerId === scope.ownerId
          && requestScope.teamId === scope.teamId
          && candidateId === "candidate-1"
          ? latest
          : null;
      },
      async create(_requestScope, create, idempotencyKey) {
        creations.push({ idempotencyKey, candidateVersion: create.expectedCandidateVersion });
        const replayed = idempotencyKey === "replay-key";
        latest = operation({
          id: replayed ? "douyin-operation-replayed" : `douyin-operation-${creations.length}`,
          status: "queued",
          currentStage: null,
          outcome: null,
          retryable: false,
          canonicalProfileUrl: null,
          profileCandidates: [],
          evidence: [],
          completedAt: null
        });
        idempotencyOperations.set(idempotencyKey, latest);
        return { operation: latest, replayed };
      }
    },
    candidates: {
      async getCandidate(requestScope, candidateId) {
        return requestScope.ownerId === scope.ownerId
          && requestScope.teamId === scope.teamId
          ? candidates.get(candidateId) ?? null
          : null;
      }
    },
    searchConnections: {
      async list() {
        return [{
          connectionId: "search-connection-1",
          providerId: "baidu-search",
          kind: "search" as const,
          status: "active" as const,
          credentialVersion: 1
        }];
      }
    },
    async dispatchOperation(_scope, operationId) {
      dispatched.push(operationId);
    },
    requestIdFactory: () => "request-douyin-router"
  }));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    creations,
    dispatched,
    replay(key: string, item: AcquisitionDouyinIdentityResolutionRouterOperation) {
      idempotencyOperations.set(key, item);
    },
    async request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
      return { response, json: await response.json().catch(() => null) };
    },
    close: () => new Promise<void>((resolve, reject) => server.close(
      (error) => error ? reject(error) : resolve()
    ))
  };
}

test("latest Douyin identity operation projects only its safe public DTO", async () => {
  const subject = await fixture();
  try {
    const result = await subject.request(
      "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operation"
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.json.outcome, "verified_consensus");
    for (const privateField of [
      "ownerId", "teamId", "actorId", "searchConnections", "planSessionId",
      "sourceEvidenceFingerprint", "idempotencyKeyHash", "requestHash",
      "leaseOwner", "leaseToken", "leaseExpiresAt"
    ]) assert.equal(result.json[privateField], undefined, privateField);
  } finally {
    await subject.close();
  }
});

test("latest Douyin identity operation is tenant-scoped and returns 404 when absent", async () => {
  const subject = await fixture({ user: { id: "owner-b", teamId: "team-b" } });
  try {
    const result = await subject.request(
      "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operation"
    );
    assert.equal(result.response.status, 404);
  } finally {
    await subject.close();
  }
});

test("Douyin identity operation routes require authentication", async () => {
  const subject = await fixture({ user: null });
  try {
    const result = await subject.request(
      "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operation"
    );
    assert.equal(result.response.status, 401);
  } finally {
    await subject.close();
  }
});

test("retry re-reads trusted candidate inputs, dispatches, and marks idempotent replays", async () => {
  const subject = await fixture({ latest: operation({
    status: "failed", outcome: "provider_unavailable", retryable: true
  }) });
  try {
    const first = await subject.request(
      "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operations",
      { method: "POST", headers: { "Idempotency-Key": "retry-operation-1" }, body: "{}" }
    );
    assert.equal(first.response.status, 202);
    assert.equal(subject.creations[0]?.candidateVersion, 3);
    assert.deepEqual(subject.dispatched, ["douyin-operation-1"]);
    const replay = await subject.request(
      "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operations",
      { method: "POST", headers: { "Idempotency-Key": "retry-operation-1" }, body: "{}" }
    );
    assert.equal(replay.response.status, 202);
    assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
    assert.deepEqual(subject.dispatched, ["douyin-operation-1"]);

  } finally {
    await subject.close();
  }
});

test("retry returns the replay marker for an idempotent retry request", async () => {
  const subject = await fixture({ latest: operation({
    status: "failed", outcome: "provider_unavailable", retryable: true
  }) });
  try {
    const replay = await subject.request(
      "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operations",
      { method: "POST", headers: { "Idempotency-Key": "replay-key" }, body: "{}" }
    );
    assert.equal(replay.response.status, 202);
    assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
    assert.deepEqual(subject.dispatched, []);
  } finally {
    await subject.close();
  }
});

test("retry rejects malformed input and unsafe candidates before creating work", async () => {
  const cases = [
    { body: JSON.stringify({ canonicalProfileUrl: "https://attacker.test" }), latest: operation({ status: "failed", outcome: "provider_unavailable", retryable: true }), expected: 400 },
    { body: "{}", latest: operation({ status: "failed", outcome: "provider_unavailable", retryable: true }), candidate: candidate({ identityResolution: { status: "resolved" } }), expected: 422 },
    { body: "{}", latest: operation({ status: "failed", outcome: "provider_unavailable", retryable: true }), candidate: candidate({ profile: { kind: "individual", sourcePlatform: "xiaohongshu" } }), expected: 422 },
    { body: "{}", latest: operation({ status: "succeeded", outcome: "verified_consensus", retryable: false }), expected: 409 },
    { body: "{}", latest: operation({ status: "failed", outcome: "ambiguous", retryable: false }), expected: 409 }
  ];
  for (const item of cases) {
    const subject = await fixture({
      latest: item.latest,
      candidates: new Map([["candidate-1", item.candidate ?? candidate()]])
    });
    try {
      const result = await subject.request(
        "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operations",
        { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: item.body }
      );
      assert.equal(result.response.status, item.expected);
      assert.equal(subject.creations.length, 0);
    } finally {
      await subject.close();
    }
  }
});

test("retry requires a unique idempotency key and an existing candidate", async () => {
  const subject = await fixture({
    latest: operation({ status: "failed", outcome: "provider_unavailable", retryable: true }),
    candidates: new Map()
  });
  try {
    const missing = await subject.request(
      "/api/v1/acquisition/candidates/candidate-1/douyin-identity-resolution-operations",
      { method: "POST", body: "{}" }
    );
    assert.equal(missing.response.status, 400);
    const absent = await subject.request(
      "/api/v1/acquisition/candidates/missing/douyin-identity-resolution-operations",
      { method: "POST", headers: { "Idempotency-Key": "key-missing-candidate" }, body: "{}" }
    );
    assert.equal(absent.response.status, 404);
  } finally {
    await subject.close();
  }
});

test("an idempotency replay cannot be replayed through a different candidate", async () => {
  const subject = await fixture({
    latest: null,
    candidates: new Map([
      ["candidate-1", candidate()],
      ["candidate-2", candidate({ id: "candidate-2" })]
    ])
  });
  subject.replay("candidate-bound-key", operation());
  try {
    const result = await subject.request(
      "/api/v1/acquisition/candidates/candidate-2/douyin-identity-resolution-operations",
      { method: "POST", headers: { "Idempotency-Key": "candidate-bound-key" }, body: "{}" }
    );
    assert.equal(result.response.status, 409);
  } finally {
    await subject.close();
  }
});
