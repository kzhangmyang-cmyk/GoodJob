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
  InMemoryAcquisitionDouyinCommentEventRepository,
  type DouyinCommentFetchAttemptTerminalStatus
} from "./acquisition-douyin-comment-events.js";
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
    identityResolved?: boolean;
    status?: AcquisitionCandidate["status"];
    evidenceIds?: string[];
  } = {}
): AcquisitionCandidate {
  const individual = options.individual ?? false;
  const identityResolved = options.identityResolved ?? true;
  return {
    id,
    ownerId: OWNER,
    teamId: TEAM,
    partyType: individual ? "individual" : "organization",
    partyRef: individual
      ? {
          partyType: "individual",
          individualPartyId: identityResolved
            ? `individual-${id}`
            : `unresolved-individual-${id}`,
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
          publicProfileUrl: identityResolved
            ? `https://example.test/people/${id}`
            : `https://www.douyin.com/video/${id}`,
          sourcePlatform: identityResolved ? "xiaohongshu" : "douyin",
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
  const commentEvents = new InMemoryAcquisitionDouyinCommentEventRepository();
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
    candidate("candidate-3", "B", {
      individual: true,
      identityResolved: false
    }),
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
    await domain.appendQualificationDecision(qualification(
      id,
      grade,
      id === "candidate-2" ? ["explicit_rejection"] : []
    ));
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
    commentEvents,
    service: new AcquisitionRunPresentationService({
      planRunRepository: planRuns,
      domainRepository: domain,
      commentEventRepository: commentEvents,
      cursorSecret: CURSOR_SECRET
    })
  };
}

async function appendCommentSignal(
  repository: InMemoryAcquisitionDouyinCommentEventRepository,
  options: {
    index: number;
    candidateId: string | null;
    evidenceId: string;
    text: string;
    actorSecUid?: string | null;
    ownerId?: string;
    teamId?: string;
  }
) {
  const ownerId = options.ownerId ?? OWNER;
  const teamId = options.teamId ?? TEAM;
  const suffix = String(options.index).padStart(2, "0");
  const minute = String(Math.floor(options.index / 60)).padStart(2, "0");
  const second = String(options.index % 60).padStart(2, "0");
  await repository.appendObservation({
    scope: { ownerId, teamId, actorId: ACTOR },
    observationId: `comment-observation-${suffix}`,
    event: {
      eventId: `comment-event-${suffix}`,
      platform: "douyin",
      eventType: "comment",
      platformEventId: `comment-${suffix}`,
      videoId: "7312345678901234567",
      parentCommentId: null,
      text: options.text,
      textHash: `sha256:${String(options.index).padStart(64, "0")}`,
      occurredAt: `2026-07-26T09:${minute}:${second}.000Z`,
      capturedAt: `2026-07-26T09:${minute}:${second}.500Z`,
      likeCount: options.index + 10,
      replyCount: options.index,
      ipLabel: "广东",
      actor: {
        displayName: `公开用户 ${suffix}`,
        handle: `public-${suffix}`,
        secUid: options.actorSecUid === undefined
          ? `sec-${suffix}`
          : options.actorSecUid
      },
      sourceUrl:
        "https://www.douyin.com/video/7312345678901234567",
      coverage: "public_top_level_sample",
      accessStatus: "public_content",
      providerVersion: "douyin-public-comment-provider-v1",
      rawArtifactHash: `sha256:${"a".repeat(62)}${suffix}`
    },
    ingestionSaga: {
      sagaId: `comment-saga-${suffix}`,
      actorId: ACTOR,
      runId: "run-1",
      shardId: "shard-1",
      discoveryOperationId: "operation-shard-1"
    }
  });
  await repository.commitIngestionSaga(
    { ownerId, teamId, actorId: ACTOR },
    `comment-saga-${suffix}`,
    {
      candidateId: options.candidateId,
      evidenceId: options.evidenceId
    }
  );
}

async function appendFetchAttempt(
  repository: InMemoryAcquisitionDouyinCommentEventRepository,
  options: {
    id: string;
    status?: DouyinCommentFetchAttemptTerminalStatus;
    errorCode?: string | null;
    startedAt?: string;
    completedAt?: string;
    eventCount?: number;
    evidenceCount?: number;
    unresolvedActorCount?: number;
    strongSignalCount?: number;
    returnedCount?: number;
    videoId?: string | null;
  }
) {
  const startedAt = options.startedAt ?? "2026-07-26T09:00:10.000Z";
  await repository.startFetchAttempt({
    scope,
    attemptId: options.id,
    runId: "run-1",
    shardId: "shard-1",
    discoveryOperationId: "operation-shard-1",
    sourceUrl: "https://www.douyin.com/video/7312345678901234567",
    videoId: options.videoId === undefined
      ? "7312345678901234567"
      : options.videoId,
    requestedCount: 30,
    startedAt
  });
  if (!options.status) return;
  const returnedCount = options.returnedCount ?? options.eventCount ?? 0;
  await repository.finishFetchAttempt(scope, options.id, {
    status: options.status,
    errorCode: options.errorCode ?? null,
    returnedCount,
    reportedCommentCount: returnedCount,
    pagesFetched: returnedCount > 0 ? 1 : 0,
    completedAt: options.completedAt ?? "2026-07-26T09:00:15.000Z",
    terminalProjection: {
      transportRequestCount: 1,
      durationSeconds: 5,
      eventCount: options.eventCount ?? 0,
      evidenceCount: options.evidenceCount ?? 0,
      candidateIds: [],
      unresolvedActorCount: options.unresolvedActorCount ?? 0,
      strongSignalCount: options.strongSignalCount ?? 0,
      invalidCommentCount: 0
    }
  });
}

test("presentation derives the fixed automation timeline and comment signals from durable facts", async () => {
  const { service, commentEvents } = await fixture();
  await appendCommentSignal(commentEvents, {
    index: 1,
    candidateId: "candidate-2",
    evidenceId: "comment-evidence-1",
    text: "采购100套，预算五万元，希望本月交付"
  });
  await appendCommentSignal(commentEvents, {
    index: 2,
    candidateId: "candidate-3",
    evidenceId: "comment-evidence-2",
    text: "正在找供应商，采购200套，预算十万元"
  });
  await appendCommentSignal(commentEvents, {
    index: 3,
    candidateId: "candidate-cross-tenant",
    evidenceId: "comment-evidence-cross-tenant",
    text: "采购300套，预算十五万元",
    ownerId: "owner-b",
    teamId: "team-b"
  });
  await appendFetchAttempt(commentEvents, {
    id: "comment-attempt-partial",
    status: "partial_success",
    errorCode: "rate_limited",
    eventCount: 2,
    evidenceCount: 2,
    unresolvedActorCount: 1,
    strongSignalCount: 2,
    returnedCount: 2
  });

  const first = await service.get(scope, "run-1", { limit: 1 });
  assert.deepEqual(
    first.automationSteps.map((step) => step.id),
    [
      "discover_video_urls",
      "resolve_video_ids",
      "fetch_public_comment_samples",
      "normalize_platform_events",
      "aggregate_actor_signals",
      "qualify_candidates",
      "refresh_run_presentation"
    ]
  );
  assert.deepEqual(
    first.automationSteps.map(({ id, status, errorCode }) => ({
      id,
      status,
      errorCode
    })),
    [
      {
        id: "discover_video_urls",
        status: "partial_success",
        errorCode: "rate_limited"
      },
      {
        id: "resolve_video_ids",
        status: "succeeded",
        errorCode: null
      },
      {
        id: "fetch_public_comment_samples",
        status: "partial_success",
        errorCode: "rate_limited"
      },
      {
        id: "normalize_platform_events",
        status: "succeeded",
        errorCode: null
      },
      {
        id: "aggregate_actor_signals",
        status: "succeeded",
        errorCode: null
      },
      {
        id: "qualify_candidates",
        status: "succeeded",
        errorCode: null
      },
      {
        id: "refresh_run_presentation",
        status: "succeeded",
        errorCode: null
      }
    ]
  );
  const fetchStep = first.automationSteps[2];
  assert.equal(fetchStep?.startedAt, "2026-07-26T09:00:10.000Z");
  assert.equal(fetchStep?.completedAt, "2026-07-26T09:00:15.000Z");
  assert.equal(fetchStep?.durationMs, 5_000);
  assert.equal(fetchStep?.processedCount, 2);
  assert.ok(fetchStep?.message);

  assert.deepEqual({
    discoveredVideos: first.summary.discoveredVideos,
    commentsSampled: first.summary.commentsSampled,
    validDemandSignals: first.summary.validDemandSignals,
    unresolvedActors: first.summary.unresolvedActors,
    highPotentialSignals: first.summary.highPotentialSignals
  }, {
    discoveredVideos: 1,
    commentsSampled: 2,
    validDemandSignals: 2,
    unresolvedActors: 1,
    highPotentialSignals: 2
  });
  assert.equal(first.commentSignals.length, 2);
  assert.equal(first.commentSignals[0]?.eventId, "comment-event-02");
  assert.deepEqual(first.commentSignals.map((signal) => ({
    candidateId: signal.candidateId,
    intentBand: signal.intentBand,
    identityStatus: signal.identityStatus,
    evidenceId: signal.evidenceId
  })), [
    {
      candidateId: "candidate-3",
      intentBand: "strong_signal",
      identityStatus: "needs_research",
      evidenceId: "comment-evidence-2"
    },
    {
      candidateId: "candidate-2",
      intentBand: "strong_signal",
      identityStatus: "resolved",
      evidenceId: "comment-evidence-1"
    }
  ]);
  assert.equal("avatar" in first.commentSignals[0]!, false);

  const replayWithDifferentCandidateCursor = await service.get(
    scope,
    "run-1",
    { after: first.nextAfter, limit: 1 }
  );
  assert.deepEqual(
    replayWithDifferentCandidateCursor.commentSignals,
    first.commentSignals,
    "comment signals must be independent from the candidate cursor"
  );
});

test("presentation maps running, restricted, no-comment and legacy runs without invented progress", async (t) => {
  await t.test("running fetch remains running with no fabricated completion", async () => {
    const { service, commentEvents } = await fixture();
    await appendFetchAttempt(commentEvents, {
      id: "comment-attempt-running"
    });
    const value = await service.get(scope, "run-1", { limit: 1 });
    assert.deepEqual(value.automationSteps[2], {
      id: "fetch_public_comment_samples",
      status: "running",
      startedAt: "2026-07-26T09:00:10.000Z",
      completedAt: null,
      durationMs: null,
      processedCount: 0,
      errorCode: null,
      message: "正在读取公开视频的公开顶层评论样本"
    });
  });

  await t.test("all restricted fetches fail with the persisted stable code", async () => {
    const { service, commentEvents } = await fixture();
    await appendFetchAttempt(commentEvents, {
      id: "comment-attempt-restricted",
      status: "failed",
      errorCode: "access_restricted"
    });
    const value = await service.get(scope, "run-1", { limit: 1 });
    assert.equal(value.automationSteps[2]?.status, "failed");
    assert.equal(value.automationSteps[2]?.errorCode, "access_restricted");
  });

  await t.test("no public comments is an explanatory successful empty result", async () => {
    const { service, commentEvents } = await fixture();
    await appendFetchAttempt(commentEvents, {
      id: "comment-attempt-empty",
      status: "no_public_comments",
      errorCode: "no_public_comments"
    });
    const value = await service.get(scope, "run-1", { limit: 1 });
    assert.equal(value.automationSteps[2]?.status, "succeeded");
    assert.equal(value.automationSteps[2]?.errorCode, "no_public_comments");
    assert.equal(value.summary.commentsSampled, 0);
  });

  await t.test("a successful video plus an empty video remains succeeded", async () => {
    const { service, commentEvents } = await fixture();
    await appendFetchAttempt(commentEvents, {
      id: "comment-attempt-success",
      status: "succeeded",
      eventCount: 1,
      evidenceCount: 1,
      returnedCount: 1
    });
    await appendFetchAttempt(commentEvents, {
      id: "comment-attempt-other-empty",
      status: "no_public_comments",
      errorCode: "no_public_comments",
      startedAt: "2026-07-26T09:00:16.000Z",
      completedAt: "2026-07-26T09:00:20.000Z",
      videoId: "7312345678901234568"
    });
    const value = await service.get(scope, "run-1", { limit: 1 });
    assert.equal(value.automationSteps[2]?.status, "succeeded");
    assert.equal(value.automationSteps[2]?.errorCode, null);
  });

  for (const code of [
    "public_sample_unavailable",
    "source_payload_invalid",
    "video_id_unresolved"
  ]) {
    await t.test(`maps persisted ${code}`, async () => {
      const { service, commentEvents } = await fixture();
      await appendFetchAttempt(commentEvents, {
        id: `comment-attempt-${code}`,
        status: "failed",
        errorCode: code,
        videoId: code === "video_id_unresolved" ? null : undefined
      });
      const value = await service.get(scope, "run-1", { limit: 1 });
      assert.equal(value.automationSteps[2]?.status, "failed");
      assert.equal(value.automationSteps[2]?.errorCode, code);
      if (code === "video_id_unresolved") {
        assert.equal(value.automationSteps[1]?.status, "failed");
        assert.equal(value.automationSteps[1]?.errorCode, code);
      }
    });
  }

  await t.test("a legacy run with no comment facts skips comment-only steps", async () => {
    const { service } = await fixture();
    const value = await service.get(scope, "run-2", { limit: 1 });
    assert.deepEqual(
      value.automationSteps.slice(1, 6).map((step) => step.status),
      ["skipped", "skipped", "skipped", "skipped", "skipped"]
    );
    assert.deepEqual(value.commentSignals, []);
    assert.deepEqual({
      discoveredVideos: value.summary.discoveredVideos,
      commentsSampled: value.summary.commentsSampled,
      validDemandSignals: value.summary.validDemandSignals,
      unresolvedActors: value.summary.unresolvedActors,
      highPotentialSignals: value.summary.highPotentialSignals
    }, {
      discoveredVideos: 0,
      commentsSampled: 0,
      validDemandSignals: 0,
      unresolvedActors: 0,
      highPotentialSignals: 0
    });
  });
});

test("persisted events remain visible while qualification is unfinished", async () => {
  const { service, domain, commentEvents } = await fixture();
  const pending = {
    ...candidate("candidate-pending", "A", {
      individual: true,
      identityResolved: false
    }),
    latestDecisionId: null,
    latestDecisionVersion: null,
    status: "pending_review" as const
  };
  await domain.insertCandidate(pending);
  await appendCommentSignal(commentEvents, {
    index: 8,
    candidateId: pending.id,
    evidenceId: "comment-evidence-pending",
    text: "寻找供应商，采购500套，预算二十万元"
  });
  await appendFetchAttempt(commentEvents, {
    id: "comment-attempt-awaiting-qualification",
    status: "succeeded",
    eventCount: 1,
    evidenceCount: 1,
    unresolvedActorCount: 1,
    strongSignalCount: 1,
    returnedCount: 1
  });

  const value = await service.get(scope, "run-1", { limit: 1 });
  assert.equal(value.commentSignals[0]?.candidateId, pending.id);
  assert.equal(value.commentSignals[0]?.identityStatus, "needs_research");
  assert.equal(value.automationSteps[3]?.status, "succeeded");
  assert.equal(value.automationSteps[4]?.status, "succeeded");
  assert.equal(value.automationSteps[5]?.status, "partial_success");
  assert.equal(value.automationSteps[5]?.errorCode, "model_output_invalid");
});

test("comment signal projection is capped at 50 without truncating durable totals", async () => {
  const { service, commentEvents } = await fixture();
  for (let index = 10; index < 61; index += 1) {
    await appendCommentSignal(commentEvents, {
      index,
      candidateId: "candidate-3",
      evidenceId: `comment-evidence-${index}`,
      text: `寻找供应商采购${index}套，预算${index}万元`
    });
  }

  const value = await service.get(scope, "run-1", { limit: 1 });
  assert.equal(value.commentSignals.length, 50);
  assert.equal(value.summary.validDemandSignals, 51);
  assert.equal(value.commentSignals[0]?.eventId, "comment-event-60");
  assert.equal(value.commentSignals.at(-1)?.eventId, "comment-event-11");
});

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
    validOpportunities: 2,
    highIntent: 1,
    financialEvaluatedHighIntentCount: 1,
    financialPendingHighIntentCount: 0,
    expectedRevenueByCurrency: [
      { currency: "CNY", amountMinor: 1_000 }
    ],
    discoveredVideos: 0,
    commentsSampled: 0,
    validDemandSignals: 0,
    unresolvedActors: 0,
    highPotentialSignals: 0
  });

  const allEvents = [...first.candidateEvents, ...second.candidateEvents];
  const candidateOne = allEvents.find(
    (event) => event.candidateId === "candidate-1"
  );
  const candidateTwo = allEvents.find(
    (event) => event.candidateId === "candidate-2"
  );
  const candidateThree = allEvents.find(
    (event) => event.candidateId === "candidate-3"
  );
  assert.equal(candidateOne?.candidate.version, 2);
  assert.equal(candidateOne?.candidate.identityResolved, true);
  assert.equal(candidateThree?.candidate.status, "qualified");
  assert.equal(candidateThree?.candidate.identityResolved, false);
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
    commentEventRepository: base.commentEvents,
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
