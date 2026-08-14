import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AcquisitionDouyinCommentIngestionService,
  classifyDouyinCommentIntent
} from "./acquisition-douyin-comment-ingestion.js";
import {
  InMemoryAcquisitionDouyinCommentEventRepository,
  type AcquisitionDouyinCommentEventRepository
} from "./acquisition-douyin-comment-events.js";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import { AcquisitionDomainService } from "./acquisition-domain-service.js";
import {
  AcquisitionIndividualSignalIngestionService,
  type AcquisitionIndividualSignalIngestionPort
} from "./acquisition-individual-signal-ingestion.js";
import {
  InMemoryAcquisitionCandidateDirectory
} from "./acquisition-tool-support-repositories.js";
import type {
  DouyinPublicComment,
  DouyinPublicCommentSamplePage
} from "./douyin-public-comment-provider.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";
import {
  createGrowthAcquisitionWorkspaceResolver
} from "./growth-workspace-context.js";

const scopeA = { ownerId: "owner-a", teamId: "team-a", actorId: "worker-a" };
const scopeB = { ownerId: "owner-b", teamId: "team-a", actorId: "worker-b" };

function comment(
  commentId: string,
  text: string,
  actor: Partial<DouyinPublicComment["actor"]> = {}
): DouyinPublicComment {
  return {
    commentId,
    text,
    occurredAt: "2026-08-15T01:00:00.000Z",
    likeCount: 3,
    replyCount: 1,
    ipLabel: "上海",
    actor: {
      displayName: "公开用户",
      handle: null,
      secUid: null,
      ...actor
    }
  };
}

function page(
  comments: unknown[],
  overrides: Partial<DouyinPublicCommentSamplePage> = {}
): DouyinPublicCommentSamplePage {
  return {
    comments: comments as DouyinPublicComment[],
    nextCursor: null,
    hasMore: false,
    reportedCommentCount: comments.length,
    capturedAt: "2026-08-15T02:00:00.000Z",
    rawArtifactHash: `sha256:${"a".repeat(64)}`,
    providerId: "experimental_public_sample",
    providerVersion: "douyin-public-comment-provider-v1",
    coverage: "public_top_level_sample",
    metadata: {
      requestedCommentCount: 20,
      returnedCommentCount: comments.length,
      duplicateCommentCount: 0,
      partial: false,
      cursorProgressed: true
    },
    replyBodiesIncluded: false,
    ...overrides
  };
}

type FailureStage = "after_event" | "after_evidence" | "after_candidate";

function createHarness(options: { failOnceAt?: FailureStage } = {}) {
  let sequence = 0;
  const domainRepository = new InMemoryAcquisitionDomainRepository();
  const domain = new AcquisitionDomainService({
    repository: domainRepository,
    leadConversionPort: {
      async createLead() {
        throw new Error("not used");
      }
    },
    growthAcquisitionWorkspace: createGrowthAcquisitionWorkspaceResolver({
      async resolve(input) {
        return {
          workspaceId: input.teamId,
          kind: "team" as const,
          bindingRevision: `binding:${input.ownerId}:${input.teamId}`
        };
      }
    }),
    growthTemporalBarrier: new DefaultGrowthTemporalBarrier(
      new InMemoryGrowthTemporalTransactionRunner()
    ),
    idFactory: (prefix) => `${prefix}-${++sequence}`,
    now: () => "2026-08-15T02:01:00.000Z"
  });
  const eventRepository =
    new InMemoryAcquisitionDouyinCommentEventRepository();
  const candidateDirectory = new InMemoryAcquisitionCandidateDirectory({
    now: () => "2026-08-15T02:01:00.000Z"
  });
  const individualSignalIngestion =
    new AcquisitionIndividualSignalIngestionService({
      domain,
      candidateDirectory
    });
  const mutationCounts = {
    eventAppends: 0,
    evidenceAppends: 0,
    signalIngestions: 0,
    links: 0
  };
  let failureConsumed = false;
  const shouldFail = (stage: FailureStage) => {
    if (failureConsumed || options.failOnceAt !== stage) return false;
    failureConsumed = true;
    return true;
  };
  const eventPort = new Proxy(eventRepository, {
    get(target, property, receiver) {
      if (property === "appendObservation") {
        return async (...args: Parameters<typeof target.appendObservation>) => {
          mutationCounts.eventAppends += 1;
          return target.appendObservation(...args);
        };
      }
      if (property === "linkEvent") {
        return async (...args: Parameters<typeof target.linkEvent>) => {
          mutationCounts.links += 1;
          if (shouldFail("after_candidate")) throw new Error("FAIL_AFTER_CANDIDATE");
          return target.linkEvent(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as AcquisitionDouyinCommentEventRepository;
  const domainPort = new Proxy(domain, {
    get(target, property, receiver) {
      if (property === "appendEvidence") {
        return async (...args: Parameters<typeof target.appendEvidence>) => {
          mutationCounts.evidenceAppends += 1;
          if (shouldFail("after_event")) throw new Error("FAIL_AFTER_EVENT");
          return target.appendEvidence(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as AcquisitionDomainService;
  const individualSignalPort: AcquisitionIndividualSignalIngestionPort = {
    async ingest(signalInput) {
      mutationCounts.signalIngestions += 1;
      if (shouldFail("after_evidence")) throw new Error("FAIL_AFTER_EVIDENCE");
      return individualSignalIngestion.ingest(signalInput);
    }
  };
  const service = new AcquisitionDouyinCommentIngestionService({
    events: eventPort,
    domain: domainPort,
    individualSignals: individualSignalPort
  });
  return {
    service,
    domain,
    domainRepository,
    eventRepository,
    mutationCounts
  };
}

function input(
  samplePage: DouyinPublicCommentSamplePage,
  overrides: Record<string, unknown> = {}
) {
  return {
    scope: scopeA,
    runId: "run-1",
    shardId: "shard-1",
    discoveryOperationId: "operation-1",
    sourceUrl: "https://www.douyin.com/video/7536012345678909876",
    videoId: "7536012345678909876",
    page: samplePage,
    ...overrides
  } as Parameters<AcquisitionDouyinCommentIngestionService["ingestSample"]>[0];
}

test("classifier golden rules are deterministic, bounded, and negative-first", () => {
  const golden = [
    ["想咨询一下你们的解决方案", "potential_signal", "solution_research"],
    ["预算 10 万，需要采购 200 套，请报价", "strong_signal", "purchase_ready"],
    ["正在找供应商，这周就要采购", "strong_signal", "purchase_ready"],
    ["想加盟合作，可以先试用吗", "strong_signal", "comparison"],
    ["项目下周急着上线，交付周期多久", "strong_signal", "purchase_ready"],
    ["获客成本太高，正在找解决方案", "potential_signal", "solution_research"],
    ["不需要，请勿联系，多少钱", "negative", "awareness"],
    ["😀！！！", "noise", "awareness"],
    ["点赞关注抽奖送好礼", "noise", "awareness"],
    ["好好好好好好好好", "noise", "awareness"],
    ["多少钱", "potential_signal", "comparison"]
  ] as const;

  for (const [text, band, buyingStage] of golden) {
    const first = classifyDouyinCommentIntent(text);
    const replay = classifyDouyinCommentIntent(text);
    assert.deepEqual(first, replay, text);
    assert.equal(first.band, band, text);
    assert.equal(first.buyingStage, buyingStage, text);
    assert.equal(Number.isFinite(first.confidence), true, text);
    assert.equal(first.confidence >= 0 && first.confidence <= 1, true, text);
    assert.equal(first.positiveSignals.length <= 12, true, text);
    assert.equal(first.negativeSignals.length <= 12, true, text);
    assert.equal(first.reasons.length <= 12, true, text);
    assert.equal(new Set(first.reasons).size, first.reasons.length, text);
  }
});

test("secUid aggregation crosses videos, separates actors, and stays tenant isolated", async () => {
  const harness = createHarness();
  const first = await harness.service.ingestSample(input(page([
    comment("cid-1", "预算 10 万，采购 20 套，请报价", {
      secUid: "MS4wLjABAAAA_actor-1"
    })
  ])));
  const replayActor = await harness.service.ingestSample(input(page([
    comment("cid-2", "项目下周上线，交付多久", {
      secUid: "MS4wLjABAAAA_actor-1"
    })
  ], { rawArtifactHash: `sha256:${"b".repeat(64)}` }), {
    runId: "run-2",
    sourceUrl: "https://www.douyin.com/video/7536012345678909999",
    videoId: "7536012345678909999"
  }));
  const different = await harness.service.ingestSample(input(page([
    comment("cid-3", "想咨询解决方案", {
      secUid: "MS4wLjABAAAA_actor-2"
    })
  ], { rawArtifactHash: `sha256:${"c".repeat(64)}` })));
  const otherTenant = await harness.service.ingestSample(input(page([
    comment("cid-4", "想咨询解决方案", {
      secUid: "MS4wLjABAAAA_actor-1"
    })
  ], { rawArtifactHash: `sha256:${"d".repeat(64)}` }), {
    scope: scopeB,
    runId: "run-b"
  }));

  assert.deepEqual(replayActor.candidateIds, first.candidateIds);
  assert.notDeepEqual(different.candidateIds, first.candidateIds);
  assert.notDeepEqual(otherTenant.candidateIds, first.candidateIds);
  assert.equal(first.unresolvedActorCount, 1);
  assert.equal(replayActor.unresolvedActorCount, 1);
});

test("same secUid merges later strong and rejection signals without downgrading stage", async () => {
  const harness = createHarness();
  const potential = await harness.service.ingestSample(input(page([
    comment("cid-merge-1", "想咨询一下解决方案", {
      secUid: "MS4wLjABAAAA_merge-actor"
    })
  ])));
  const strong = await harness.service.ingestSample(input(page([
    comment("cid-merge-2", "预算 10 万，采购 20 套，请报价", {
      secUid: "MS4wLjABAAAA_merge-actor"
    })
  ], { rawArtifactHash: `sha256:${"b".repeat(64)}` }), {
    sourceUrl: "https://www.douyin.com/video/7536012345678909999",
    videoId: "7536012345678909999"
  }));
  const negativePage = page([
    comment("cid-merge-3", "不需要，请勿联系", {
      secUid: "MS4wLjABAAAA_merge-actor"
    })
  ], { rawArtifactHash: `sha256:${"c".repeat(64)}` });
  const negative = await harness.service.ingestSample(input(negativePage));
  const beforeReplay = await harness.domain.getCandidate(
    scopeA,
    potential.candidateIds[0]!
  );
  const replay = await harness.service.ingestSample(input(negativePage));
  const afterReplay = await harness.domain.getCandidate(
    scopeA,
    potential.candidateIds[0]!
  );

  assert.deepEqual(strong.candidateIds, potential.candidateIds);
  assert.deepEqual(negative.candidateIds, potential.candidateIds);
  assert.deepEqual(replay.candidateIds, potential.candidateIds);
  assert.equal(beforeReplay.profile.kind, "individual");
  assert.equal(afterReplay.profile.kind, "individual");
  if (beforeReplay.profile.kind !== "individual"
    || afterReplay.profile.kind !== "individual") return;
  assert.equal(beforeReplay.profile.buyingStage, "purchase_ready");
  assert.deepEqual(beforeReplay.profile.negativeSignals, [
    "explicit_rejection", "no_contact"
  ]);
  assert.match(beforeReplay.profile.demandSummary, /想咨询一下解决方案/u);
  assert.match(beforeReplay.profile.demandSummary, /预算 10 万/u);
  assert.match(beforeReplay.profile.demandSummary, /请勿联系/u);
  assert.equal(beforeReplay.evidenceIds.length, 3);
  assert.equal(afterReplay.version, beforeReplay.version);
  assert.deepEqual(afterReplay, beforeReplay);
});

test("handle is temporary, never aliases secUid, and identity-less cid replay is safe", async () => {
  const harness = createHarness();
  const handle = await harness.service.ingestSample(input(page([
    comment("cid-handle-1", "想咨询解决方案", { handle: "Public_User" })
  ])));
  const handleAgain = await harness.service.ingestSample(input(page([
    comment("cid-handle-2", "多少钱", { handle: "public_user" })
  ], { rawArtifactHash: `sha256:${"b".repeat(64)}` }), {
    sourceUrl: "https://www.douyin.com/video/7536012345678909999",
    videoId: "7536012345678909999"
  }));
  const secUid = await harness.service.ingestSample(input(page([
    comment("cid-sec", "多少钱", { secUid: "public_user" })
  ], { rawArtifactHash: `sha256:${"c".repeat(64)}` })));
  const noIdentity = page([
    comment("cid-none-1", "想咨询"),
    comment("cid-none-2", "想咨询")
  ], { rawArtifactHash: `sha256:${"d".repeat(64)}` });
  const noIdentityResult = await harness.service.ingestSample(input(noIdentity));
  const exactReplay = await harness.service.ingestSample(input(page(
    noIdentity.comments,
    {
      capturedAt: "2026-08-15T03:00:00.000Z",
      rawArtifactHash: `sha256:${"e".repeat(64)}`
    }
  )));

  assert.deepEqual(handleAgain.candidateIds, handle.candidateIds);
  assert.notDeepEqual(secUid.candidateIds, handle.candidateIds);
  assert.equal(noIdentityResult.candidateIds.length, 2);
  assert.deepEqual(exactReplay.candidateIds, noIdentityResult.candidateIds);
  assert.equal((await harness.eventRepository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  )).filter((item) => item.event.platformEventId.startsWith("cid-none-")).length, 2);
});

test("noise remains evidence, negative remains suppressive, and malformed neighbors are skipped", async () => {
  const harness = createHarness();
  const result = await harness.service.ingestSample(input(page([
    comment("cid-noise", "😀！！！"),
    comment("cid-negative", "不需要，请勿联系"),
    { ...comment("cid-empty", ""), text: "   " },
    null,
    {
      ...comment("cid-malformed-actor", "想咨询"),
      actor: { displayName: "用户", handle: null, secUid: 123 }
    },
    comment("cid-strong", "预算 10 万，采购 20 套，请报价")
  ])));

  assert.deepEqual(result, {
    eventCount: 3,
    evidenceCount: 3,
    candidateIds: result.candidateIds,
    unresolvedActorCount: 2,
    strongSignalCount: 1,
    invalidCommentCount: 3
  });
  assert.equal(result.candidateIds.length, 2);
  const signals = await harness.eventRepository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  );
  assert.equal(signals.length, 3);
  assert.equal(signals.find((item) => item.event.platformEventId === "cid-noise")
    ?.link.candidateId, null);
  const negativeId = signals.find((item) =>
    item.event.platformEventId === "cid-negative")?.link.candidateId;
  assert.ok(negativeId);
  const negative = await harness.domain.getCandidate(scopeA, negativeId);
  assert.deepEqual(
    negative.profile.kind === "individual"
      ? negative.profile.negativeSignals
      : [],
    ["explicit_rejection", "no_contact"]
  );
});

test("event, observation, evidence, and link preserve exact public provenance", async () => {
  const harness = createHarness();
  const sample = page([
    comment("cid-provenance", "  预算 10 万，采购 20 套\n请报价  ", {
      displayName: "采购用户",
      handle: "buyer_01",
      secUid: "MS4wLjABAAAA_buyer-1"
    })
  ]);
  const result = await harness.service.ingestSample(input(sample));
  const [signal] = await harness.eventRepository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  );

  assert.ok(signal);
  assert.equal(signal.event.platformEventId, "cid-provenance");
  assert.equal(signal.event.text, "预算 10 万，采购 20 套\n请报价");
  assert.equal(signal.event.actor.secUid, "MS4wLjABAAAA_buyer-1");
  assert.equal(signal.latestObservation.observationId, signal.link.observationId);
  assert.equal(signal.link.candidateId, result.candidateIds[0]);
  assert.ok(signal.link.evidenceId);
  const evidence = await harness.domain.getEvidence(scopeA, signal.link.evidenceId);
  assert.deepEqual(evidence.provenance, {
    kind: "platform_public_event",
    sourceUrl: "https://www.douyin.com/video/7536012345678909876",
    platformEventId: "cid-provenance",
    providerVersion: "douyin-public-comment-provider-v1",
    coverage: "public_top_level_sample"
  });
  assert.equal(evidence.accessStatus, "public_content");
  assert.equal(evidence.contentHash, signal.event.textHash);
  assert.notEqual(evidence.rawArtifactHash, sample.rawArtifactHash);
  assert.match(evidence.rawArtifactHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(signal.latestObservation.rawArtifactHash, sample.rawArtifactHash);
  assert.equal(evidence.sourceSnippet, "预算 10 万,采购 20 套 请报价");
});

test("changed comment content forms one replay-safe version with the immutable actor", async () => {
  const harness = createHarness();
  const actorA = {
    displayName: "原始用户",
    handle: "original_user",
    secUid: "MS4wLjABAAAA_original-actor"
  };
  const original = await harness.service.ingestSample(input(page([
    comment("cid-versioned", "想咨询解决方案", actorA)
  ])));
  const firstProjection = (await harness.eventRepository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  ))[0]!;
  const changed = await harness.service.ingestSample(input(page([
    comment("cid-versioned", "预算 10 万，采购 20 套，请报价", {
      displayName: "来源后来返回的其他昵称",
      handle: "other_user",
      secUid: "MS4wLjABAAAA_other-actor"
    })
  ], {
    capturedAt: "2026-08-15T03:00:00.000Z",
    rawArtifactHash: `sha256:${"b".repeat(64)}`
  })));
  const changedProjection = (await harness.eventRepository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  ))[0]!;
  const replay = await harness.service.ingestSample(input(page([
    comment("cid-versioned", "预算 10 万,采购 20 套,请报价", {
      displayName: "第三次返回的昵称",
      handle: "third_user",
      secUid: "MS4wLjABAAAA_third-actor"
    })
  ], {
    capturedAt: "2026-08-15T04:00:00.000Z",
    rawArtifactHash: `sha256:${"c".repeat(64)}`
  })));
  const replayProjection = (await harness.eventRepository.listRunCommentSignals(
    scopeA,
    "run-1",
    { limit: 50 }
  ))[0]!;

  assert.deepEqual(changed.candidateIds, original.candidateIds);
  assert.deepEqual(replay.candidateIds, original.candidateIds);
  assert.equal(replayProjection.event.text, "想咨询解决方案");
  assert.deepEqual(replayProjection.event.actor, actorA);
  assert.notEqual(firstProjection.link.evidenceId, changedProjection.link.evidenceId);
  assert.equal(replayProjection.link.evidenceId, changedProjection.link.evidenceId);
  assert.equal(
    replayProjection.latestObservation.rawArtifactHash,
    `sha256:${"c".repeat(64)}`
  );
  assert.equal(
    replayProjection.latestObservation.observedTextHash,
    changedProjection.latestObservation.observedTextHash
  );
  const changedEvidence = await harness.domain.getEvidence(
    scopeA,
    changedProjection.link.evidenceId!
  );
  assert.equal(changedEvidence.sourceSnippet, "预算 10 万,采购 20 套,请报价");
  assert.notEqual(changedEvidence.rawArtifactHash, `sha256:${"b".repeat(64)}`);
  assert.notEqual(changedEvidence.rawArtifactHash, `sha256:${"c".repeat(64)}`);
  const candidate = await harness.domain.getCandidate(
    scopeA,
    original.candidateIds[0]!
  );
  assert.equal(candidate.profile.kind, "individual");
  if (candidate.profile.kind === "individual") {
    assert.equal(candidate.profile.publicActorKey,
      "douyin:sec_uid:MS4wLjABAAAA_original-actor");
  }
  assert.equal(candidate.evidenceIds.length, 2);
});

test("ingestion resumes idempotently after each cross-repository failure boundary", async () => {
  for (const failOnceAt of [
    "after_event", "after_evidence", "after_candidate"
  ] as const) {
    const harness = createHarness({ failOnceAt });
    const sampleInput = input(page([
      comment(`cid-saga-${failOnceAt}`, "预算 10 万，采购 20 套，请报价", {
        secUid: `MS4wLjABAAAA_${failOnceAt}`
      })
    ]));

    await assert.rejects(
      harness.service.ingestSample(sampleInput),
      new RegExp(`FAIL_${failOnceAt.toLocaleUpperCase("en-US")}`)
    );
    const completed = await harness.service.ingestSample(sampleInput);
    const signals = await harness.eventRepository.listRunCommentSignals(
      scopeA,
      "run-1",
      { limit: 50 }
    );
    const candidates = await harness.domainRepository.listCandidates(
      scopeA,
      { limit: 100 }
    );

    assert.equal(completed.eventCount, 1, failOnceAt);
    assert.equal(completed.evidenceCount, 1, failOnceAt);
    assert.equal(completed.candidateIds.length, 1, failOnceAt);
    assert.equal(signals.length, 1, failOnceAt);
    assert.equal(candidates.items.length, 1, failOnceAt);
    assert.deepEqual(candidates.items[0]?.evidenceIds, [
      signals[0]?.link.evidenceId
    ], failOnceAt);
    assert.deepEqual(await harness.eventRepository.getRunCommentSummary(
      scopeA,
      "run-1"
    ), {
      linkedEventCount: 1,
      observationCount: 1,
      fetchAttemptCount: 0,
      returnedCommentCount: 0
    }, failOnceAt);
  }
});

test("invalid sample literals and overlong context fail before mutation", async () => {
  const invalidInputs = [
    input(page([comment("cid-invalid-version", "想咨询")], {
      providerVersion: "another-version" as never
    })),
    input(page([comment("cid-invalid-replies", "想咨询")], {
      replyBodiesIncluded: true as never
    })),
    input(page([comment("cid-invalid-provider", "想咨询")], {
      providerId: "another-provider" as never
    })),
    input(page([comment("cid-invalid-coverage", "想咨询")], {
      coverage: "all_comments" as never
    })),
    input(page([comment("cid-invalid-context", "想咨询")]), {
      runId: "r".repeat(256)
    }),
    input(page([comment("cid-invalid-video", "想咨询")]), {
      videoId: "not-a-video"
    })
  ];

  for (const invalidInput of invalidInputs) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.ingestSample(invalidInput),
      /ACQUISITION_DOUYIN_COMMENT_INVALID_SAMPLE/u
    );
    assert.deepEqual(harness.mutationCounts, {
      eventAppends: 0,
      evidenceAppends: 0,
      signalIngestions: 0,
      links: 0
    });
    assert.equal((await harness.domainRepository.listCandidates(
      scopeA,
      { limit: 100 }
    )).items.length, 0);
  }
});
