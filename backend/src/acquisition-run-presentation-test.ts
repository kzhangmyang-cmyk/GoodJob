import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import type {
  AcquisitionAuditEvent,
  AcquisitionCandidate,
  DiscoveryEvidence,
  FinancialValueDecision,
  QualificationDecision
} from "./acquisition-domain.js";
import {
  InMemoryAcquisitionPlanRunRepository,
  type AcquisitionOperationShard,
  type AcquisitionRun
} from "./acquisition-plan-run-repository.js";
import {
  AcquisitionRunPresentationService
} from "./acquisition-run-presentation.js";

const OWNER = "owner-a";
const TEAM = "team-a";
const ACTOR = "actor-a";
const scope = { ownerId: OWNER, teamId: TEAM, actorId: ACTOR };
const CURSOR_SECRET =
  "run-presentation-test-secret-at-least-32-bytes";

const modelSnapshotRef = {
  jobSnapshotId: "snapshot-1",
  connectionId: "model-connection-1",
  credentialVersion: 1,
  provider: "moonshot",
  model: "kimi-k3",
  capabilitySnapshotHash: "sha256:capabilities",
  promptVersion: "acquisition.v1",
  schemaVersion: "acquisition-plan.v1",
  promptHash: "sha256:prompt",
  schemaHash: "sha256:schema"
};

function run(id: string): AcquisitionRun {
  return {
    id,
    ownerId: OWNER,
    teamId: TEAM,
    planId: "plan-1",
    planVersionId: "plan-version-1",
    planVersion: 1,
    planSnapshotHash: "sha256:plan",
    parentRunId: null,
    status: "partial_success",
    terminationIntent: null,
    revision: 4,
    etag: `"${id}:4"`,
    budgetSnapshotId: "budget-1",
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 10,
      maxResults: 100,
      maxAmountMinor: 1_000,
      maxDurationSeconds: 600
    },
    budgetSnapshotHash: "sha256:budget",
    billingCurrency: "CNY",
    modelSnapshotRef,
    consumedBudget: {
      requests: 2,
      results: 7,
      amountMinor: 40,
      durationSeconds: 12
    },
    evidenceCount: 4,
    reason: null,
    createdBy: ACTOR,
    createdAt: "2026-07-26T09:00:00.000Z",
    updatedBy: ACTOR,
    updatedAt: "2026-07-26T09:00:10.000Z",
    completedAt: "2026-07-26T09:00:10.000Z"
  };
}

function shard(
  id: string,
  connectionId: string,
  providerId: string,
  status: AcquisitionOperationShard["status"],
  results: number
): AcquisitionOperationShard {
  return {
    id,
    runId: "run-1",
    ownerId: OWNER,
    teamId: TEAM,
    operationId: `operation-${id}`,
    parentShardId: null,
    subjectChannel: "organization",
    kind: "search",
    connection: {
      connectionId,
      providerId,
      kind: "search",
      status: "active",
      credentialVersion: 1
    },
    query: "公开采购信号",
    sourceRef: "",
    status,
    budgetSnapshotId: "budget-1",
    allocatedBudget: {
      requests: 5,
      results: 50,
      amountMinor: 500,
      durationSeconds: 300
    },
    consumedBudget: {
      requests: 1,
      results,
      amountMinor: 20,
      durationSeconds: 6
    },
    modelSnapshotRef,
    evidenceCount: status === "succeeded" ? 3 : 1,
    revision: 2,
    createdAt: "2026-07-26T09:00:00.000Z",
    updatedAt: "2026-07-26T09:00:09.000Z",
    completedAt: "2026-07-26T09:00:09.000Z"
  };
}

function evidence(
  id: string,
  sourcePlatform: string
): DiscoveryEvidence {
  return {
    id,
    ownerId: OWNER,
    teamId: TEAM,
    targetType: "organization",
    sourcePlatform,
    sourceTitle: `${sourcePlatform} 公开来源`,
    sourceSnippet: "公开需求信号",
    publishedAt: null,
    fetchedAt: "2026-07-26T08:59:00.000Z",
    locale: "zh-CN",
    rawArtifactHash: `sha256:raw-${id}`,
    contentHash: `sha256:content-${id}`,
    provenance: {
      kind: "search_result",
      provider: sourcePlatform,
      queryText: "公开采购信号",
      sourceUrl: `https://example.test/${id}`,
      resultRank: 1
    },
    accessStatus: "indexed_summary",
    supersedesEvidenceId: null
  };
}

function candidate(
  id: string,
  grade: QualificationDecision["grade"],
  options: {
    individual?: boolean;
    status?: AcquisitionCandidate["status"];
    evidenceIds?: string[];
  } = {}
): AcquisitionCandidate {
  const individual = options.individual ?? false;
  return {
    id,
    ownerId: OWNER,
    teamId: TEAM,
    partyType: individual ? "individual" : "organization",
    partyRef: individual
      ? {
          partyType: "individual",
          individualPartyId: `individual-${id}`,
          demandSignalId: `signal-${id}`
        }
      : {
          partyType: "organization",
          organizationId: `organization-${id}`,
          tenantProspectId: `prospect-${id}`
        },
    profile: individual
      ? {
          kind: "individual",
          publicActorKey: `actor-${id}`,
          publicDisplayName: `个人 ${id}`,
          publicProfileUrl: `https://example.test/people/${id}`,
          sourcePlatform: "xiaohongshu",
          demandCategory: "获客",
          demandSummary: "公开表达获客需求",
          locationHint: "深圳",
          buyingStage: "solution_research",
          negativeSignals: []
        }
      : {
          kind: "organization",
          name: `企业 ${id}`,
          domain: `${id}.example.test`,
          region: "上海",
          creditCode: null
        },
    evidenceIds: options.evidenceIds ?? [`evidence-${id}`],
    status: options.status ?? "qualified",
    latestDecisionId: `qualification-${id}`,
    latestDecisionVersion: `qualification-${grade}`,
    approvedDecisionVersion: null,
    hardGateFailures: [],
    leadId: null,
    createdAt: "2026-07-26T08:58:00.000Z",
    updatedAt: "2026-07-26T09:00:00.000Z",
    version: 2
  };
}

function qualification(
  id: string,
  grade: QualificationDecision["grade"],
  hardGateFailures: QualificationDecision["hardGateFailures"] = []
): QualificationDecision {
  return {
    id: `qualification-${id}`,
    ownerId: OWNER,
    teamId: TEAM,
    candidateId: id,
    decisionVersion: `qualification-${grade}`,
    decisionEngine: "rules",
    grade,
    score: grade === "S" ? 95 : grade === "A" ? 85 : 75,
    recommendedAction: grade === "S" ? "priority_review" : "nurture",
    evidence: [],
    positiveSignals: [],
    negativeSignals: [],
    reasons: ["公开信号符合"],
    confidence: 0.9,
    ruleVersion: "rules-v1",
    promptVersion: null,
    modelProvider: null,
    model: null,
    hardGateFailures,
    snapshotHash: `sha256:qualification-${id}`,
    createdAt: "2026-07-26T08:59:30.000Z"
  };
}

function financial(
  id: string,
  qualificationDecisionId: string,
  currency: string,
  expectedRevenueMinor: number
): FinancialValueDecision {
  return {
    id: `financial-${id}-${currency}`,
    ownerId: OWNER,
    teamId: TEAM,
    candidateId: id,
    qualificationDecisionId,
    version: "financial-v1",
    grade: "A",
    score: 80,
    currency,
    expectedRevenueMinor,
    expectedGrossProfitMinor: Math.floor(expectedRevenueMinor / 2),
    expectedContributionMinor: Math.floor(expectedRevenueMinor / 4),
    factors: {
      profitability: 0.8,
      cashFlow: 0.7,
      creditQuality: 0.8,
      repeatPotential: 0.7,
      referralPotential: 0.6,
      closeProbability: 0.8
    },
    inputSnapshotHash: `sha256:financial-${id}-${currency}`,
    createdAt: "2026-07-26T08:59:40.000Z"
  };
}

async function fixture() {
  const planRuns = new InMemoryAcquisitionPlanRunRepository();
  const domain = new InMemoryAcquisitionDomainRepository(planRuns);
  await planRuns.transaction((transaction) => {
    transaction.putRun(run("run-1"));
    transaction.putRun({ ...run("run-2"), status: "running" });
    transaction.putShard(shard(
      "shard-1",
      "connection-baidu",
      "baidu-ai-search",
      "succeeded",
      3
    ));
    transaction.putShard(shard(
      "shard-2",
      "connection-tavily",
      "tavily",
      "failed",
      4
    ));
    transaction.appendRunEvent({
      id: "event-shard-1-started",
      runId: "run-1",
      shardId: "shard-1",
      ownerId: OWNER,
      teamId: TEAM,
      type: "shard.started",
      actorId: ACTOR,
      revision: 2,
      at: "2026-07-26T09:00:01.000Z",
      data: {}
    });
    transaction.appendRunEvent({
      id: "event-shard-1-complete",
      runId: "run-1",
      shardId: "shard-1",
      ownerId: OWNER,
      teamId: TEAM,
      type: "shard.succeeded",
      actorId: ACTOR,
      revision: 3,
      at: "2026-07-26T09:00:05.000Z",
      data: {
        rawResultCount: 4,
        acceptedResultCount: 3,
        duplicateResultCount: 1,
        failedResultCount: 0
      }
    });
    transaction.appendRunEvent({
      id: "event-shard-2-started",
      runId: "run-1",
      shardId: "shard-2",
      ownerId: OWNER,
      teamId: TEAM,
      type: "shard.started",
      actorId: ACTOR,
      revision: 2,
      at: "2026-07-26T09:00:02.000Z",
      data: {}
    });
    transaction.appendRunEvent({
      id: "event-shard-2-complete",
      runId: "run-1",
      shardId: "shard-2",
      ownerId: OWNER,
      teamId: TEAM,
      type: "shard.failed",
      actorId: ACTOR,
      revision: 4,
      at: "2026-07-26T09:00:06.000Z",
      data: {
        rawResultCount: 2,
        acceptedResultCount: 1,
        duplicateResultCount: 0,
        failedResultCount: 1,
        errorCode: "PROVIDER_RATE_LIMITED",
        retryAfterAt: "2026-07-26T09:05:00.000Z"
      }
    });
    for (const [index, candidateId] of [
      "candidate-1",
      "candidate-2",
      "candidate-3",
      "candidate-4"
    ].entries()) {
      transaction.appendRunEvent({
        id: `event-candidate-${index + 1}`,
        runId: "run-1",
        shardId: index < 2 ? "shard-1" : "shard-2",
        ownerId: OWNER,
        teamId: TEAM,
        type: "candidate.discovered",
        actorId: ACTOR,
        revision: 4,
        at: `2026-07-26T09:00:0${index + 3}.000Z`,
        data: {
          candidateId,
          operationId: index < 2 ? "operation-shard-1" : "operation-shard-2",
          connectionId:
            index < 2 ? "connection-baidu" : "connection-tavily"
        }
      });
    }
    transaction.appendRunEvent({
      id: "event-not-authoritative",
      runId: "run-1",
      shardId: "shard-1",
      ownerId: OWNER,
      teamId: TEAM,
      type: "candidate.processed",
      actorId: ACTOR,
      revision: 4,
      at: "2026-07-26T09:00:07.500Z",
      data: { candidateId: "candidate-unrelated" }
    });
  });

  const candidates = [
    candidate("candidate-1", "S", {
      evidenceIds: ["evidence-candidate-1", "evidence-candidate-1-tavily"]
    }),
    candidate("candidate-2", "A"),
    candidate("candidate-3", "B", { individual: true }),
    candidate("candidate-4", "S", { status: "do_not_contact" }),
    candidate("candidate-unrelated", "S")
  ];
  for (const item of candidates) {
    await domain.insertCandidate(item);
    for (const evidenceId of item.evidenceIds) {
      await domain.appendEvidence(evidence(
        evidenceId,
        evidenceId.endsWith("tavily") ? "tavily" : "baidu"
      ));
    }
  }
  for (const [id, grade] of [
    ["candidate-1", "S"],
    ["candidate-2", "A"],
    ["candidate-3", "B"],
    ["candidate-4", "S"],
    ["candidate-unrelated", "S"]
  ] as const) {
    await domain.appendQualificationDecision(qualification(id, grade));
  }
  await domain.appendFinancialValue(financial(
    "candidate-1",
    "qualification-obsolete",
    "EUR",
    9_999
  ));
  await domain.appendFinancialValue(financial(
    "candidate-1",
    "qualification-candidate-1",
    "CNY",
    1_000
  ));
  await domain.appendFinancialValue(financial(
    "candidate-3",
    "qualification-candidate-3",
    "EUR",
    8_000
  ));
  await domain.appendFinancialValue(financial(
    "candidate-4",
    "qualification-candidate-4",
    "USD",
    700
  ));

  return {
    planRuns,
    domain,
    service: new AcquisitionRunPresentationService({
      planRunRepository: planRuns,
      domainRepository: domain,
      cursorSecret: CURSOR_SECRET
    })
  };
}

test("presentation pages authoritative candidate upserts and computes current metrics", async () => {
  const { service } = await fixture();

  const first = await service.get(scope, "run-1", { limit: 2 });
  assert.equal(first.candidateEvents.length, 2);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextAfter);

  const replay = await service.get(scope, "run-1", {
    after: first.nextAfter,
    limit: 2
  });
  const sameCursorReplay = await service.get(scope, "run-1", {
    after: first.nextAfter,
    limit: 2
  });
  assert.deepEqual(
    sameCursorReplay.candidateEvents.map((event) => event.eventId),
    replay.candidateEvents.map((event) => event.eventId),
    "replaying the same signed cursor must remain an idempotent merge"
  );

  const second = await service.get(scope, "run-1", {
    after: first.nextAfter,
    limit: 2
  });
  assert.equal(second.candidateEvents.length, 2);
  assert.equal(second.hasMore, false);
  assert.equal(
    second.candidateEvents.some(
      (event) => event.candidateId === "candidate-unrelated"
    ),
    false,
    "non-discovery run events must not authorize a candidate"
  );

  assert.deepEqual(first.providers, [
    {
      shardId: "shard-1",
      connectionId: "connection-baidu",
      providerId: "baidu-ai-search",
      status: "succeeded",
      rawResultCount: 4,
      acceptedResultCount: 3,
      duplicateResultCount: 1,
      failedResultCount: 0,
      errorCode: null,
      retryAfterAt: null
    },
    {
      shardId: "shard-2",
      connectionId: "connection-tavily",
      providerId: "tavily",
      status: "failed",
      rawResultCount: 2,
      acceptedResultCount: 1,
      duplicateResultCount: 0,
      failedResultCount: 1,
      errorCode: "PROVIDER_RATE_LIMITED",
      retryAfterAt: "2026-07-26T09:05:00.000Z"
    }
  ]);
  assert.deepEqual(first.summary, {
    sourcesSearched: 2,
    pagesAnalyzed: 7,
    organizationsFound: 3,
    dedupedCandidates: 4,
    validOpportunities: 3,
    highIntent: 3,
    financialEvaluatedHighIntentCount: 2,
    financialPendingHighIntentCount: 1,
    expectedRevenueByCurrency: [
      { currency: "CNY", amountMinor: 1_000 },
      { currency: "USD", amountMinor: 700 }
    ]
  });

  const allEvents = [...first.candidateEvents, ...second.candidateEvents];
  const candidateOne = allEvents.find(
    (event) => event.candidateId === "candidate-1"
  );
  const candidateTwo = allEvents.find(
    (event) => event.candidateId === "candidate-2"
  );
  assert.deepEqual(candidateOne?.sourcePlatforms, ["baidu", "tavily"]);
  assert.equal(candidateOne?.financialValue?.currency, "CNY");
  assert.equal(candidateTwo?.financialValue, null);
});

test("presentation uses bounded event pages and batch candidate snapshots", async () => {
  const base = await fixture();
  const domainCalls = {
    auditPages: [] as Array<{ limit: number }>,
    snapshotBatches: [] as string[][],
    summaryRuns: [] as string[]
  };
  const runCalls: Array<{ limit: number }> = [];
  const executionRuns: string[] = [];
  const domain = new Proxy(base.domain, {
    get(target, property, receiver) {
      if (property === "listAuditEvents") {
        return async () => {
          throw new Error("UNBOUNDED_TENANT_AUDIT_READ");
        };
      }
      if (property === "findCandidate"
        || property === "findQualificationDecision"
        || property === "listFinancialValues"
        || property === "findEvidence") {
        return async () => {
          throw new Error("PER_CANDIDATE_PRESENTATION_READ");
        };
      }
      if (property === "listPresentationAuditEvents") {
        return async (readScope: typeof scope, query: { limit: number }) => {
          domainCalls.auditPages.push({ limit: query.limit });
          return (target as any).listPresentationAuditEvents(
            readScope,
            query
          );
        };
      }
      if (property === "getPresentationCandidateSnapshots") {
        return async (readScope: typeof scope, candidateIds: string[]) => {
          domainCalls.snapshotBatches.push([...candidateIds]);
          return (target as any).getPresentationCandidateSnapshots(
            readScope,
            candidateIds
          );
        };
      }
      if (property === "getPresentationCandidateSummary") {
        return async (readScope: typeof scope, runId: string) => {
          domainCalls.summaryRuns.push(runId);
          return (target as any).getPresentationCandidateSummary(
            readScope,
            runId
          );
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
  const planRuns = new Proxy(base.planRuns, {
    get(target, property, receiver) {
      if (property === "listRunEvents") {
        return async () => {
          throw new Error("UNBOUNDED_RUN_EVENT_READ");
        };
      }
      if (property === "listRunCandidateLinks") {
        return async () => {
          throw new Error("UNBOUNDED_RUN_CANDIDATE_LINK_READ");
        };
      }
      if (property === "listRunCandidateEventsPage") {
        return async (runId: string, query: { limit: number }) => {
          runCalls.push({ limit: query.limit });
          return (target as any).listRunCandidateEventsPage(runId, query);
        };
      }
      if (property === "getRunPresentationExecution") {
        return async (runId: string) => {
          executionRuns.push(runId);
          return (target as any).getRunPresentationExecution(runId);
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
  const service = new AcquisitionRunPresentationService({
    planRunRepository: planRuns,
    domainRepository: domain,
    cursorSecret: CURSOR_SECRET
  });

  await service.get(scope, "run-1", { limit: 1 });

  assert.deepEqual(runCalls, [{ limit: 2 }]);
  assert.deepEqual(executionRuns, ["run-1"]);
  assert.deepEqual(domainCalls.auditPages, [{ limit: 2 }]);
  assert.equal(domainCalls.snapshotBatches.length, 1);
  assert.deepEqual(domainCalls.snapshotBatches[0], ["candidate-1"]);
  assert.deepEqual(domainCalls.summaryRuns, ["run-1"]);
});

test("presentation skips missing candidates and advances its signed cursor", async () => {
  const { planRuns, service } = await fixture();
  await planRuns.transaction((transaction) => {
    transaction.appendRunEvent({
      id: "event-candidate-missing",
      runId: "run-1",
      shardId: "shard-1",
      ownerId: OWNER,
      teamId: TEAM,
      type: "candidate.discovered",
      actorId: ACTOR,
      revision: 4,
      at: "2026-07-26T09:00:02.500Z",
      data: {
        candidateId: "candidate-missing",
        operationId: "operation-shard-1",
        connectionId: "connection-baidu"
      }
    });
  });

  const first = await service.get(scope, "run-1", { limit: 1 });
  assert.deepEqual(first.candidateEvents, []);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextAfter);

  const second = await service.get(scope, "run-1", {
    after: first.nextAfter,
    limit: 1
  });
  assert.equal(second.candidateEvents[0]?.candidateId, "candidate-1");
});

test("presentation cursor rejects tampering and every identity boundary", async () => {
  const { service } = await fixture();
  const first = await service.get(scope, "run-1", { limit: 1 });
  const invalidCases = [
    {
      scope,
      runId: "run-1",
      after: `${first.nextAfter.slice(0, -1)}x`
    },
    {
      scope: { ...scope, ownerId: "owner-b" },
      runId: "run-1",
      after: first.nextAfter
    },
    {
      scope: { ...scope, teamId: "team-b" },
      runId: "run-1",
      after: first.nextAfter
    },
    {
      scope: { ...scope, actorId: "actor-b" },
      runId: "run-1",
      after: first.nextAfter
    },
    {
      scope,
      runId: "run-2",
      after: first.nextAfter
    }
  ];

  for (const invalid of invalidCases) {
    await assert.rejects(
      () => service.get(invalid.scope, invalid.runId, {
        after: invalid.after,
        limit: 1
      }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && "code" in error
          && error.code === "INVALID_PRESENTATION_CURSOR"
        )
    );
  }
});

test("a later domain audit emits an upsert only for run-associated candidates", async () => {
  const { service, domain } = await fixture();
  const first = await service.get(scope, "run-1", { limit: 100 });
  assert.equal(first.hasMore, false);

  const updated = {
    ...(await domain.findCandidate(scope, "candidate-1"))!,
    profile: {
      kind: "organization" as const,
      name: "企业 candidate-1（更新）",
      domain: "candidate-1.example.test",
      region: "北京",
      creditCode: null
    },
    updatedAt: "2026-07-26T09:01:00.000Z",
    version: 3
  };
  await domain.saveCandidate(updated);
  const audit: AcquisitionAuditEvent = {
    id: "domain-audit-candidate-1-update",
    ownerId: OWNER,
    teamId: TEAM,
    candidateId: "candidate-1",
    actorId: ACTOR,
    eventType: "candidate_profile_updated",
    fromStatus: "qualified",
    toStatus: "qualified",
    resourceId: "candidate-1",
    idempotencyKey: "candidate-profile-update-1",
    payloadHash: "sha256:candidate-profile-update",
    createdAt: "2026-07-26T09:01:00.000Z"
  };
  await domain.appendAuditEvent(audit);
  await domain.appendAuditEvent({
    ...audit,
    id: "domain-audit-unrelated-update",
    candidateId: "candidate-unrelated",
    resourceId: "candidate-unrelated",
    createdAt: "2026-07-26T09:01:01.000Z"
  });

  const next = await service.get(scope, "run-1", {
    after: first.nextAfter,
    limit: 100
  });
  assert.equal(next.hasMore, false);
  assert.deepEqual(
    next.candidateEvents.map((event) => ({
      eventId: event.eventId,
      candidateId: event.candidateId,
      displayName: event.candidate.displayName
    })),
    [{
      eventId: "domain-audit-candidate-1-update",
      candidateId: "candidate-1",
      displayName: "企业 candidate-1（更新）"
    }]
  );
});
