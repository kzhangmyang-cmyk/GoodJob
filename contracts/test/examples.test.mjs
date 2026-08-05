import test from "node:test";
import assert from "node:assert/strict";
import { loadContractHarness } from "./helpers.mjs";

test("personal evidence cannot omit provenance or masquerade as a company", async () => {
  const { validateCase } = await loadContractHarness();
  assert.equal(validateCase("discovery-evidence", {
    id: "ev_invalid", targetType: "individual_signal"
  }).valid, false);
  assert.equal(validateCase("individual-demand-signal", {
    id: "person_invalid", company: "个人用户"
  }).valid, false);
});

test("identity workbench contracts accept versioned identity state and exact evidence ids", async () => {
  const { validateCase } = await loadContractHarness();
  assert.equal(validateCase("individual-demand-signal", {
    id: "candidate-individual-1",
    publicActorKey: "unresolved-public-signal:video",
    publicDisplayName: "待核验抖音主体",
    publicProfileUrl: "https://www.douyin.com/video/1234567890",
    sourcePlatform: "douyin",
    evidenceIds: ["evidence-video-1"],
    demandCategory: "获客系统",
    demandSummary: "公开视频摘要包含需求信号",
    locationHint: "厦门",
    buyingStage: "solution_research",
    negativeSignals: [],
    subjectKind: "individual",
    status: "normalized",
    latestDecisionVersion: null,
    approvedDecisionVersion: null,
    version: 7,
    identityResolved: false,
    updatedAt: "2026-08-06T00:00:00.000Z",
    firstSeenAt: "2026-08-06T00:00:00.000Z",
    lastSeenAt: "2026-08-06T00:00:00.000Z"
  }).valid, true);
  assert.equal(validateCase("discovery-evidence", {
    id: "evidence-video-1",
    targetType: "individual_signal",
    sourcePlatform: "douyin",
    sourceTitle: "公开视频",
    sourceSnippet: "评论摘要",
    publishedAt: null,
    fetchedAt: "2026-08-06T00:00:00.000Z",
    locale: "zh-CN",
    rawArtifactHash: `sha256:${"a".repeat(64)}`,
    contentHash: `sha256:${"b".repeat(64)}`,
    provenance: {
      kind: "search_result",
      provider: "baidu_ai_search",
      queryText: "site:douyin.com 获客",
      sourceUrl: "https://www.douyin.com/video/1234567890",
      resultRank: 1,
      sourceType: "video"
    },
    accessStatus: "indexed_summary"
  }).valid, true);
  assert.equal(validateCase("content-fetch-operation", {
    id: "fetch-1",
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "user-a",
    sourceUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    finalUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    subjectChannel: "individual",
    status: "succeeded",
    accessStatus: "public_content",
    httpStatus: 200,
    contentType: "text/html; charset=utf-8",
    title: "公开主页",
    rawArtifactHash: `sha256:${"c".repeat(64)}`,
    contentHash: `sha256:${"d".repeat(64)}`,
    evidenceCount: 1,
    evidenceIds: ["evidence-profile-1"],
    errorCode: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    startedAt: "2026-08-06T00:00:01.000Z",
    completedAt: "2026-08-06T00:00:02.000Z"
  }).valid, true);
});

test("content fetch operations keep status, evidence count, and evidence ids consistent", async () => {
  const { validateCase } = await loadContractHarness();
  const operation = {
    id: "fetch-invariant-1",
    ownerId: "owner-a",
    teamId: "team-a",
    actorId: "user-a",
    sourceUrl: "https://example.test/public-source",
    finalUrl: null,
    subjectChannel: "organization",
    status: "queued",
    accessStatus: null,
    httpStatus: null,
    contentType: null,
    title: null,
    rawArtifactHash: null,
    contentHash: null,
    evidenceCount: 0,
    evidenceIds: [],
    errorCode: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    startedAt: null,
    completedAt: null
  };

  for (const status of ["queued", "running", "failed"]) {
    assert.equal(validateCase("content-fetch-operation", {
      ...operation,
      status
    }).valid, true, `${status} with no evidence must be valid`);
  }
  for (const status of ["succeeded", "access_restricted"]) {
    assert.equal(validateCase("content-fetch-operation", {
      ...operation,
      status,
      evidenceCount: 1,
      evidenceIds: ["evidence-current-operation"]
    }).valid, true, `${status} with one evidence id must be valid`);
  }

  const invalid = [
    { status: "succeeded", evidenceCount: 1, evidenceIds: [] },
    {
      status: "access_restricted",
      evidenceCount: 0,
      evidenceIds: ["evidence-current-operation"]
    },
    {
      status: "failed",
      evidenceCount: 1,
      evidenceIds: ["evidence-current-operation"]
    },
    {
      status: "succeeded",
      evidenceCount: 2,
      evidenceIds: ["evidence-duplicate", "evidence-duplicate"]
    }
  ];
  for (const values of invalid) {
    assert.equal(validateCase("content-fetch-operation", {
      ...operation,
      ...values
    }).valid, false, JSON.stringify(values));
  }
});

test("outcome feedback rejects untyped live parties and legacy individual parties", async () => {
  const { validateCase } = await loadContractHarness();
  const live = {
    id: "outcome_live_invalid", ownerId: "owner", teamId: "team", leadId: null, customerId: null,
    eventType: "validated", occurredAt: "2026-07-23T00:00:00.000Z", amount: null,
    reasonCode: null, reasonText: null, idempotencyKey: "key", createdBy: "user",
    createdAt: "2026-07-23T00:00:00.000Z", recordKind: "live", partyRef: { arbitrary: true },
    candidateId: "candidate", attribution: {
      runId: "run", evidenceIds: [], providerIds: [], queryIds: [], strategyVersion: "v1",
      qualificationDecisionId: "decision", decisionVersion: "v1", decisionSnapshotHash: "hash",
      decisionEngine: "rules", ruleVersion: "v1", modelProvider: null, model: null, promptVersion: null
    }
  };
  const legacy = {
    ...live, id: "outcome_legacy_invalid", recordKind: "legacy_migrated", legacySourceId: "legacy-1",
    partyRef: { partyType: "individual", individualPartyId: "party", demandSignalId: "signal" },
    candidateId: null, attribution: {
      ...live.attribution, runId: null, strategyVersion: null, qualificationDecisionId: null,
      decisionVersion: null, decisionSnapshotHash: null, decisionEngine: null, ruleVersion: null
    }, migrationWarnings: []
  };
  assert.equal(validateCase("outcome-feedback", live).valid, false);
  assert.equal(validateCase("outcome-feedback", legacy).valid, false);
});

test("rules decisions cannot claim model metadata and inference cards require support", async () => {
  const { validateCase } = await loadContractHarness();
  const decision = {
    decisionEngine: "rules", grade: "B", score: 60, recommendedAction: "nurture",
    evidence: [{ evidenceId: "ev_1" }], positiveSignals: [], negativeSignals: [], reasons: ["rule"],
    confidence: 0.7, ruleVersion: "rules-v1", promptVersion: "prompt-v1", modelProvider: "openai", model: "gpt"
  };
  const card = {
    id: "card_1", candidateId: "candidate_1", partyType: "organization",
    sections: [{ label: "Pain point", kind: "inference", content: "Likely needs a CRM." }],
    evidenceIds: ["ev_1"], confidence: 0.8, modelProvider: "openai", model: "gpt", promptVersion: "v1",
    createdAt: "2026-07-23T00:00:00.000Z"
  };
  assert.equal(validateCase("qualification-decision", decision).valid, false);
  assert.equal(validateCase("battle-card", card).valid, false);
});

test("contract examples validate as complete organization and individual flows", async () => {
  const { loadExamples, validateCase } = await loadContractHarness();
  const examples = await loadExamples();
  for (const record of examples.organization.records) {
    assert.equal(validateCase(record.schema, record.value).valid, true, record.schema);
  }
  for (const record of examples.individual.records) {
    assert.equal(validateCase(record.schema, record.value).valid, true, record.schema);
  }
  assert.equal(examples.organization.records.length > 0, true);
  assert.equal(examples.individual.records.length > 0, true);
  assert.equal(examples.search.queryText.length > 0, true);
});
