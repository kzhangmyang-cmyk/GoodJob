import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AcquisitionCandidate
} from "./acquisition-domain.js";
import {
  AcquisitionCandidateIntelligenceOperationError,
  AcquisitionCandidateIntelligenceOperationService,
  InMemoryAcquisitionCandidateIntelligenceOperationRepository,
  type AcquisitionCandidateIntelligenceSessionFactory
} from "./acquisition-candidate-intelligence-operations.js";
import type {
  AcquisitionAgentToolExecutor,
  AcquisitionToolExecutionInput
} from "./acquisition-pi-tools.js";
import {
  AcquisitionToolExecutorError
} from "./acquisition-tool-executor.js";

const NOW = "2026-08-07T02:00:00.000Z";
const scope = {
  ownerId: "owner-intelligence",
  teamId: "team-intelligence",
  actorId: "actor-intelligence"
};

function candidate(
  id: string,
  options: { resolved?: boolean } = {}
): AcquisitionCandidate {
  const resolved = options.resolved ?? true;
  return {
    id,
    ownerId: scope.ownerId,
    teamId: scope.teamId,
    partyType: "individual",
    partyRef: {
      partyType: "individual",
      individualPartyId: resolved
        ? `individual-${id}`
        : `unresolved-individual-${id}`,
      demandSignalId: `signal-${id}`
    },
    profile: {
      kind: "individual",
      publicActorKey: resolved ? `douyin:${id}` : "",
      publicDisplayName: `候选 ${id}`,
      publicProfileUrl: resolved
        ? `https://www.douyin.com/user/${id}`
        : "",
      sourcePlatform: "douyin",
      demandCategory: "获客系统",
      demandSummary: "正在比较获客方案",
      locationHint: "厦门",
      buyingStage: "comparison",
      negativeSignals: []
    },
    evidenceIds: [`evidence-${id}`],
    status: "normalized",
    latestDecisionId: null,
    latestDecisionVersion: null,
    approvedDecisionVersion: null,
    hardGateFailures: [],
    leadId: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1
  };
}

function qualification(
  grade: "S" | "A" | "B" | "C" | "D",
  score: number,
  hardGateFailures: string[] = []
) {
  return {
    qualification: {
      grade,
      score,
      hardGateFailures
    },
    financialValue: {
      id: "financial-decision-1",
      currency: "CNY"
    },
    outreachExecuted: false
  };
}

function successfulExecutor(
  calls: AcquisitionToolExecutionInput[],
  grade: "S" | "A" | "B" | "C" | "D" = "A",
  score = 82
): AcquisitionAgentToolExecutor {
  return {
    async execute(input) {
      calls.push(structuredClone({
        ...input,
        signal: undefined
      }));
      if (input.toolName === "research_candidate") {
        return {
          summary: "公开主页显示候选正在比较获客系统。",
          findings: [{
            label: "采购信号",
            content: "候选近期公开表达了明确需求。",
            evidenceIds: ["evidence-candidate-a"],
            confidence: 0.9
          }],
          outreachExecuted: false
        };
      }
      if (input.toolName === "qualify_candidate") {
        return qualification(grade, score);
      }
      return {
        battleCard: {
          id: "battle-card-1",
          candidateId: String(input.payload.candidateId)
        },
        outreachExecuted: false
      };
    }
  };
}

function fixture(options: {
  executor?: AcquisitionAgentToolExecutor;
  candidates?: AcquisitionCandidate[];
  now?: () => string;
  sessionFactory?: AcquisitionCandidateIntelligenceSessionFactory;
  repository?: InMemoryAcquisitionCandidateIntelligenceOperationRepository;
} = {}) {
  const calls: AcquisitionToolExecutionInput[] = [];
  const candidates = new Map(
    (options.candidates ?? [candidate("candidate-a")])
      .map((item) => [item.id, item])
  );
  const sessionCalls: Array<{
    candidateId: string;
    idempotencyKey: string;
  }> = [];
  const sessionFactory = options.sessionFactory ?? {
    async createSession(input) {
      sessionCalls.push({
        candidateId: input.candidateId,
        idempotencyKey: input.idempotencyKey
      });
      return { sessionId: `model-session:${input.candidateId}` };
    }
  };
  const repository = options.repository
    ?? new InMemoryAcquisitionCandidateIntelligenceOperationRepository();
  let id = 0;
  const service = new AcquisitionCandidateIntelligenceOperationService({
    repository,
    candidates: {
      async getCandidate(candidateScope, candidateId) {
        const value = candidates.get(candidateId);
        return value
          && value.ownerId === candidateScope.ownerId
          && value.teamId === candidateScope.teamId
          ? structuredClone(value)
          : null;
      }
    },
    sessionFactory,
    executor: options.executor ?? successfulExecutor(calls),
    idFactory: () => `candidate-intelligence-${++id}`,
    workerId: "candidate-intelligence-worker",
    leaseTokenFactory: () => `lease-${++id}`,
    leaseDurationMs: 60_000,
    now: options.now ?? (() => NOW)
  });
  return { calls, repository, service, sessionCalls };
}

test("creates one queued operation only after identity resolution and pins one model session", async () => {
  const state = fixture({
    candidates: [
      candidate("candidate-a"),
      candidate("candidate-unresolved", { resolved: false }),
      candidate("candidate-b")
    ]
  });

  await assert.rejects(
    state.service.createAfterIdentity(
      scope,
      "candidate-unresolved",
      "after-identity-unresolved"
    ),
    (error: unknown) =>
      error instanceof AcquisitionCandidateIntelligenceOperationError
      && error.code === "IDENTITY_NOT_RESOLVED"
  );

  const created = await state.service.createAfterIdentity(
    scope,
    "candidate-a",
    "after-identity-a"
  );
  const replay = await state.service.createAfterIdentity(
    scope,
    "candidate-a",
    "after-identity-a"
  );

  assert.deepEqual(replay, created);
  assert.equal(created.status, "queued");
  assert.equal(created.candidateId, "candidate-a");
  assert.equal(created.sessionId, "model-session:candidate-a");
  assert.deepEqual(created.completedStages, []);
  assert.deepEqual(created.skippedStages, []);
  assert.equal(created.currentStage, null);
  assert.equal(created.failure, null);
  assert.equal(state.sessionCalls.length, 1);

  await assert.rejects(
    state.service.createAfterIdentity(
      scope,
      "candidate-b",
      "after-identity-a"
    ),
    (error: unknown) =>
      error instanceof AcquisitionCandidateIntelligenceOperationError
      && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("persists research, qualification with finance, and a battle card in stage order", async () => {
  const state = fixture();
  const created = await state.service.createAfterIdentity(
    scope,
    "candidate-a",
    "after-identity-a"
  );

  const completed = await state.service.execute(scope, created.id);

  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.completedStages, [
    "research",
    "qualification",
    "battle_card"
  ]);
  assert.deepEqual(completed.skippedStages, []);
  assert.equal(completed.currentStage, null);
  assert.equal(completed.research?.summary,
    "公开主页显示候选正在比较获客系统。");
  assert.equal(completed.research?.findings[0]?.label, "采购信号");
  assert.deepEqual(completed.qualification, {
    grade: "A",
    score: 82,
    hardGateFailures: [],
    financialValueId: "financial-decision-1"
  });
  assert.equal(completed.battleCardId, "battle-card-1");
  assert.equal(completed.failure, null);
  assert.equal(completed.completedAt, NOW);
  assert.deepEqual(state.calls.map((call) => call.toolName), [
    "research_candidate",
    "qualify_candidate",
    "build_battle_card"
  ]);
  assert.equal(state.calls.every((call) =>
    call.identity.sessionId === created.sessionId
    && call.identity.actorId === scope.actorId
    && call.toolCallId === call.idempotencyKey
    && /^candidate-intelligence-stage:[a-f0-9]{48}$/u.test(
      call.idempotencyKey
    )), true);
  assert.equal(new Set(
    state.calls.map((call) => call.idempotencyKey)
  ).size, 3);

  assert.deepEqual(
    await state.service.get(scope, created.id),
    completed
  );
  assert.deepEqual(await state.service.execute(scope, created.id), completed);
  assert.equal(state.calls.length, 3);
});

test("finishes successfully and records a skipped card for an ineligible qualification", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  const state = fixture({
    executor: successfulExecutor(calls, "B", 62)
  });
  const created = await state.service.createAfterIdentity(
    scope,
    "candidate-a",
    "after-identity-low-score"
  );

  const completed = await state.service.execute(scope, created.id);

  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.completedStages, [
    "research",
    "qualification"
  ]);
  assert.deepEqual(completed.skippedStages, ["battle_card"]);
  assert.equal(completed.battleCardId, null);
  assert.deepEqual(calls.map((call) => call.toolName), [
    "research_candidate",
    "qualify_candidate"
  ]);
});

test("records a stable stage failure and retry resumes without rerunning completed stages", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  let qualificationAttempts = 0;
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(structuredClone({ ...input, signal: undefined }));
      if (input.toolName === "research_candidate") {
        return {
          summary: "研究已完成",
          findings: [],
          outreachExecuted: false
        };
      }
      if (input.toolName === "qualify_candidate") {
        qualificationAttempts += 1;
        if (qualificationAttempts === 1) {
          throw new AcquisitionToolExecutorError(
            "INVALID_JUDGMENT_RESULT"
          );
        }
        return qualification("A", 85);
      }
      return {
        battleCard: {
          id: "battle-card-recovered",
          candidateId: "candidate-a"
        }
      };
    }
  };
  const state = fixture({ executor });
  const created = await state.service.createAfterIdentity(
    scope,
    "candidate-a",
    "after-identity-retry"
  );

  const failed = await state.service.execute(scope, created.id);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.completedStages, ["research"]);
  assert.equal(failed.currentStage, "qualification");
  assert.deepEqual(failed.failure, {
    stage: "qualification",
    errorCode: "INVALID_JUDGMENT_RESULT"
  });
  assert.equal(failed.research?.summary, "研究已完成");

  const recovered = await state.service.execute(scope, created.id);
  assert.equal(recovered.status, "succeeded");
  assert.deepEqual(recovered.completedStages, [
    "research",
    "qualification",
    "battle_card"
  ]);
  assert.equal(recovered.failure, null);
  assert.deepEqual(calls.map((call) => call.toolName), [
    "research_candidate",
    "qualify_candidate",
    "qualify_candidate",
    "build_battle_card"
  ]);
  assert.equal(
    calls[1]?.idempotencyKey,
    calls[2]?.idempotencyKey
  );
  assert.equal(calls.every((call) =>
    call.identity.sessionId === created.sessionId
  ), true);
});

test("recovers an expired running lease and keeps tenant reads isolated", async () => {
  let now = NOW;
  const state = fixture({ now: () => now });
  const created = await state.service.createAfterIdentity(
    scope,
    "candidate-a",
    "after-identity-lease-recovery"
  );
  const claimed = await state.repository.claimOperation(
    scope,
    created.id,
    {
      leaseOwner: "crashed-worker",
      leaseToken: "crashed-lease",
      claimedAt: NOW,
      leaseExpiresAt: "2026-08-07T02:01:00.000Z"
    }
  );
  assert.equal(claimed.claimed, true);

  await assert.rejects(
    state.service.execute(scope, created.id),
    (error: unknown) =>
      error instanceof AcquisitionCandidateIntelligenceOperationError
      && error.code === "OPERATION_ALREADY_RUNNING"
  );

  now = "2026-08-07T02:02:00.000Z";
  const recovered = await state.service.execute(scope, created.id);
  assert.equal(recovered.status, "succeeded");

  await assert.rejects(
    state.service.get({
      ...scope,
      ownerId: "other-owner"
    }, created.id),
    (error: unknown) =>
      error instanceof AcquisitionCandidateIntelligenceOperationError
      && error.code === "RESOURCE_NOT_FOUND"
  );
});
