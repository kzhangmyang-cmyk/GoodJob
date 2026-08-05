import assert from "node:assert/strict";
import test from "node:test";

import {
  AdvisorConflictError,
  AdvisorPreconditionRequiredError,
  type AiGrowthApi,
  type ContentFetchOperationDto,
  type CopilotTaskDto,
  type EvidenceDto
} from "./api.js";
import {
  createBattleCardDrawer,
  renderBattleCardDrawer
} from "./components/battle-card-drawer.js";
import type {
  BattleCardDto,
  CandidateDto,
  FinancialValueDto,
  QualificationDto
} from "./types.js";

const timestamp = "2026-07-26T09:00:00.000Z";

function candidate(
  status: CandidateDto["status"] = "pending_review",
  overrides: Partial<CandidateDto> = {}
): CandidateDto {
  return {
    id: "candidate-1",
    subjectKind: "organization",
    name: "远岚智能装备",
    domain: "https://yuanlan.example.com",
    region: "上海",
    creditCode: null,
    status,
    latestDecisionVersion: "decision-v2",
    approvedDecisionVersion: status === "approved" ? "decision-v2" : null,
    evidenceIds: ["evidence-1", "evidence-2"],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  } as CandidateDto;
}

const qualification: QualificationDto = {
  id: "qualification-1",
  candidateId: "candidate-1",
  decisionVersion: "decision-v2",
  decisionEngine: "model",
  grade: "A",
  score: 88,
  recommendedAction: "priority_review",
  evidence: [{ evidenceId: "evidence-1", excerpt: "公开招聘数字化岗位" }],
  positiveSignals: [{ name: "数字化招聘", score: 30 }],
  negativeSignals: [],
  reasons: ["近期公开采购信号与目标画像匹配"],
  confidence: 0.86,
  ruleVersion: "qualification.v1",
  promptVersion: "prompt.v1",
  modelProvider: "glm",
  model: "glm-4",
  hardGateFailures: [],
  createdAt: timestamp
};

const financialValue: FinancialValueDto = {
  id: "financial-1",
  candidateId: "candidate-1",
  qualificationDecisionId: "qualification-1",
  version: "financial-v1",
  grade: "A",
  score: 82,
  currency: "CNY",
  expectedRevenueMinor: 1_280_000,
  expectedGrossProfitMinor: 520_000,
  expectedContributionMinor: 360_000,
  factors: {
    profitability: 0.8,
    cashFlow: 0.72,
    creditQuality: 0.76,
    repeatPotential: 0.7,
    referralPotential: 0.6,
    closeProbability: 0.58
  },
  createdAt: timestamp
};

const evidence: EvidenceDto[] = [{
  id: "evidence-1",
  targetType: "organization",
  sourcePlatform: "百度公开搜索",
  sourceTitle: "远岚智能装备招聘数字化负责人",
  sourceSnippet: "负责企业数字化采购与系统升级",
  publishedAt: timestamp,
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "raw-1",
  contentHash: "content-1",
  provenance: { sourceUrl: "https://example.com/evidence-1" },
  accessStatus: "public_content"
}, {
  id: "evidence-2",
  targetType: "organization",
  sourcePlatform: "企业官网",
  sourceTitle: "年度数字化升级计划",
  sourceSnippet: "公开披露将升级供应链系统",
  publishedAt: timestamp,
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "raw-2",
  contentHash: "content-2",
  provenance: {},
  accessStatus: "indexed_summary"
}];

const battleCard: BattleCardDto = {
  id: "battle-card-1",
  candidateId: "candidate-1",
  qualificationDecisionId: "qualification-1",
  partyType: "organization",
  sections: [{
    label: "公开采购信号",
    kind: "fact",
    content: "官网公开披露数字化升级计划。",
    evidenceIds: ["evidence-2"]
  }, {
    label: "采购偏好",
    kind: "inference",
    content: "可能更关注交付稳定性。",
    confidence: 0.68,
    evidenceIds: ["evidence-1"]
  }, {
    label: "预算",
    kind: "unknown",
    content: "尚无公开预算信息。",
    evidenceIds: []
  }],
  evidenceIds: ["evidence-1", "evidence-2"],
  confidence: 0.78,
  modelProvider: "glm",
  model: "glm-4",
  promptVersion: "battle-card.v1",
  createdAt: timestamp
};

const battleCardV2: BattleCardDto = {
  id: "battle-card-v2",
  candidateId: "candidate-1",
  qualificationDecisionId: "qualification-1",
  partyType: "organization",
  schemaVersion: "battle-card.v2",
  intelligence: {
    accountOverview: [{
      kind: "fact",
      text: "远岚智能装备公开经营主体可核验。",
      evidenceIds: ["evidence-1"],
      confidence: 1
    }],
    needAssessment: [{
      kind: "fact",
      text: "官网公开披露数字化升级计划。",
      evidenceIds: ["evidence-2"],
      confidence: 1
    }],
    supplierHypotheses: [{
      kind: "unknown",
      text: "现有供应商尚无充分公开证据。",
      evidenceIds: [],
      confidence: null
    }],
    buyingCommittee: [{
      role: "业务负责人",
      priority: 1,
      influence: "decision_maker",
      concerns: ["投入产出", "交付稳定性"],
      claim: {
        kind: "inference",
        text: "业务负责人可能参与采购决策。",
        evidenceIds: ["evidence-1"],
        confidence: 0.72
      }
    }],
    procurementPreferences: [{
      kind: "inference",
      text: "可能更看重稳定交付与量化结果。",
      evidenceIds: ["evidence-1", "evidence-2"],
      confidence: 0.68
    }],
    connectionStrategies: [{
      channel: "email",
      targetRole: "业务负责人",
      rationale: {
        kind: "fact",
        text: "公开招聘页面提供业务联系入口。",
        evidenceIds: ["evidence-1"],
        confidence: 1
      },
      openingDraft: "建议人工审核后，以公开升级计划为背景提供诊断。"
    }],
    roleSpecificOpeners: [{
      role: "业务负责人",
      channel: "email",
      text: "看到贵司公开的升级计划，我们整理了一页诊断供参考。"
    }],
    doNotActions: ["不要声称已经确认现有供应商"],
    financialSummary: {
      decisionId: "financial-1",
      decisionVersion: "financial-v1",
      grade: "A",
      score: 82,
      currency: "CNY",
      expectedRevenueMinor: 1_280_000,
      expectedGrossProfitMinor: 520_000,
      expectedContributionMinor: 360_000,
      factors: financialValue.factors
    }
  },
  evidenceIds: ["evidence-1", "evidence-2"],
  confidence: 0.78,
  modelProvider: "glm",
  model: "glm-4",
  promptVersion: "battle-card.v2",
  createdAt: timestamp
};

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function succeededTask(
  id: string,
  toolName: string
): CopilotTaskDto {
  return {
    id,
    sessionId: "session-1",
    kind: "message",
    status: "succeeded",
    responseMode: "assistant",
    result: { toolNames: [toolName] },
    errorCode: null,
    createdAt: timestamp,
    completedAt: timestamp
  };
}

function pendingTask(
  id: string,
  status: "queued" | "running"
): CopilotTaskDto {
  return {
    id,
    sessionId: "session-1",
    kind: "message",
    status,
    responseMode: "assistant",
    result: null,
    errorCode: null,
    createdAt: timestamp,
    completedAt: null
  };
}

function failedTask(id: string): CopilotTaskDto {
  return {
    id,
    sessionId: "session-1",
    kind: "message",
    status: "failed",
    responseMode: "assistant",
    result: null,
    errorCode: "TOOL_EXECUTION_FAILED",
    createdAt: timestamp,
    completedAt: timestamp
  };
}

function apiStub(
  overrides: Partial<AiGrowthApi> = {}
): AiGrowthApi {
  const base = {
    createSession: async () => ({
      id: "operation-session-1",
      kind: "copilot_session_creation",
      status: "succeeded" as const,
      resourceId: "session-1",
      createdAt: timestamp,
      completedAt: timestamp
    }),
    getCandidate: async () => candidate(),
    getEvidence: async () => ({ items: evidence, nextCursor: null }),
    getQualification: async () => qualification,
    getFinancialValue: async () => financialValue,
    getBattleCard: async () => battleCard,
    requestAssistantAction: async () => succeededTask("task-1", "build_battle_card"),
    getCopilotTask: async () => succeededTask("task-1", "build_battle_card"),
    reviewCandidate: async () => ({
      candidate: candidate("approved"),
      review: {},
      research: null
    }),
    convertCandidate: async () => ({
      id: "conversion-1",
      candidateId: "candidate-1",
      decisionVersion: "decision-v2",
      partyRef: {},
      leadId: "lead-1",
      reviewerId: "reviewer-1",
      evidenceSnapshotHash: "snapshot-1",
      createdAt: timestamp
    })
  };
  return { ...base, ...overrides } as AiGrowthApi;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function unresolvedIndividualCandidate(
  id = "candidate-1",
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    subjectKind: "individual",
    publicActorKey: `unresolved:${id}`,
    publicDisplayName: id === "candidate-1" ? "厦门装修需求用户" : "候选乙",
    publicProfileUrl: "https://www.douyin.com/video/123456",
    sourcePlatform: "douyin",
    demandCategory: "获客系统",
    demandSummary: "正在寻找获客系统",
    locationHint: "厦门",
    buyingStage: "solution_research",
    negativeSignals: [],
    status: "unresolvable",
    version: 3,
    identityResolved: false,
    latestDecisionVersion: null,
    approvedDecisionVersion: null,
    evidenceIds: ["evidence-1"],
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  } as CandidateDto & { version: number; identityResolved: boolean };
}

function contentFetchOperation(
  status: ContentFetchOperationDto["status"],
  overrides: Partial<ContentFetchOperationDto> = {}
): ContentFetchOperationDto {
  return {
    id: "fetch-identity-1",
    ownerId: "owner-1",
    teamId: "team-1",
    actorId: "actor-1",
    sourceUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    finalUrl: status === "succeeded"
      ? "https://www.douyin.com/user/MS4wLjABAAAA"
      : null,
    subjectChannel: "individual",
    status,
    accessStatus: status === "succeeded" ? "public_content" : null,
    httpStatus: status === "succeeded" ? 200 : null,
    contentType: status === "succeeded" ? "text/html" : null,
    title: status === "succeeded" ? "厦门装修公开主页" : null,
    rawArtifactHash: status === "succeeded" ? "sha256:raw" : null,
    contentHash: status === "succeeded" ? "sha256:content" : null,
    evidenceCount: status === "succeeded" ? 1 : 0,
    evidenceIds: status === "succeeded" ? ["evidence-profile-1"] : [],
    errorCode: null,
    createdAt: timestamp,
    startedAt: status === "queued" ? null : timestamp,
    completedAt: status === "succeeded" ? timestamp : null,
    ...overrides
  };
}

const profileEvidence: EvidenceDto = {
  id: "evidence-profile-1",
  targetType: "individual_signal",
  sourcePlatform: "www.douyin.com",
  sourceTitle: "厦门装修公开主页",
  sourceSnippet: "公开主页简介与获客需求内容",
  publishedAt: null,
  fetchedAt: timestamp,
  locale: "zh-CN",
  rawArtifactHash: "sha256:raw",
  contentHash: "sha256:content",
  provenance: {
    kind: "user_submitted_url",
    sourceUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
  },
  accessStatus: "public_content"
};

test("open settles candidate, all evidence, qualification, finance, and card independently", async () => {
  const api = apiStub({
    getQualification: async () => {
      throw httpError(404, "qualification missing");
    }
  });
  const drawer = createBattleCardDrawer({
    api,
    onCandidateUpdated: () => undefined
  });

  await drawer.open("candidate-1");

  const state = drawer.getState();
  assert.equal(state.open, true);
  assert.equal(state.candidate.status, "ready");
  assert.equal(state.evidence.status, "ready");
  assert.equal(state.evidence.data?.length, 2);
  assert.equal(state.qualification.status, "missing");
  assert.equal(state.financialValue.status, "ready");
  assert.equal(state.battleCard.status, "ready");
  assert.match(drawer.render().html, /待资格评估/);
  assert.match(drawer.render().html, /运行资格评估/);
  assert.match(drawer.render().html, /官网公开披露数字化升级计划/);
});

test("open publishes each completed resource while slower reads remain loading", async () => {
  const card = deferred<BattleCardDto>();
  const drawer = createBattleCardDrawer({
    api: apiStub({ getBattleCard: async () => card.promise }),
    onCandidateUpdated: () => undefined
  });

  const opening = drawer.open("candidate-1");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(drawer.getState().candidate.status, "ready");
  assert.equal(drawer.getState().qualification.status, "ready");
  assert.equal(drawer.getState().battleCard.status, "loading");

  card.resolve(battleCard);
  await opening;
  assert.equal(drawer.getState().battleCard.status, "ready");
});

test("finance 404 is pending while non-404 errors remain visible", async () => {
  const pending = createBattleCardDrawer({
    api: apiStub({
      getFinancialValue: async () => {
        throw httpError(404, "missing");
      }
    }),
    onCandidateUpdated: () => undefined
  });
  await pending.open("candidate-1");
  assert.equal(pending.getState().financialValue.status, "missing");
  assert.match(pending.render().html, /财务价值[\s\S]*待评估/);

  const failed = createBattleCardDrawer({
    api: apiStub({
      getFinancialValue: async () => {
        throw httpError(503, "财务服务暂不可用");
      }
    }),
    onCandidateUpdated: () => undefined
  });
  await failed.open("candidate-1");
  assert.equal(failed.getState().financialValue.status, "error");
  assert.match(failed.render().html, /财务服务暂不可用/);
});

test("qualification requires an explicit Copilot tool task before refreshing qualification and finance", async () => {
  const messages: string[] = [];
  let qualificationReads = 0;
  let financeReads = 0;
  let taskReads = 0;
  const api = apiStub({
    getQualification: async () => {
      qualificationReads += 1;
      if (qualificationReads === 1) throw httpError(404, "missing");
      return qualification;
    },
    getFinancialValue: async () => {
      financeReads += 1;
      return financialValue;
    },
    requestAssistantAction: async (_sessionId, message) => {
      messages.push(message);
      return pendingTask("task-qualify", "queued");
    },
    getCopilotTask: async () => {
      taskReads += 1;
      return taskReads === 1
        ? pendingTask("task-qualify", "running")
        : succeededTask("task-qualify", "qualify_candidate");
    }
  });
  const drawer = createBattleCardDrawer({
    api,
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  const financeReadsBeforeAction = financeReads;

  await drawer.runQualification();

  assert.match(messages[0] ?? "", /qualify_candidate/);
  assert.match(messages[0] ?? "", /candidate-1/);
  assert.equal(drawer.getState().qualification.status, "ready");
  assert.equal(drawer.getState().action.status, "succeeded");
  assert.equal(qualificationReads, 2);
  assert.equal(financeReads, financeReadsBeforeAction + 1);
});

test("real Copilot task states are observable without a fabricated timer state", async () => {
  const observed: string[] = [];
  let taskReads = 0;
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getBattleCard: async () => {
        throw httpError(404, "missing");
      },
      requestAssistantAction: async () =>
        pendingTask("task-card", "queued"),
      getCopilotTask: async () => {
        taskReads += 1;
        return taskReads === 1
          ? pendingTask("task-card", "running")
          : succeededTask("task-card", "build_battle_card");
      }
    }),
    wait: async () => undefined,
    onStateChange: (state) => observed.push(state.action.status),
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  await drawer.generateBattleCard();

  assert.ok(observed.includes("queued"));
  assert.ok(observed.includes("running"));
  assert.ok(observed.includes("succeeded"));
});

test("battle card generation only refreshes after build_battle_card succeeds and never posts its domain endpoint", async () => {
  const messages: string[] = [];
  let cardReads = 0;
  const api = apiStub({
    getBattleCard: async () => {
      cardReads += 1;
      if (cardReads === 1) throw httpError(404, "missing");
      return battleCard;
    },
    requestAssistantAction: async (_sessionId, message) => {
      messages.push(message);
      return succeededTask("task-card", "build_battle_card");
    }
  });
  const drawer = createBattleCardDrawer({
    api,
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  await drawer.generateBattleCard();

  assert.match(messages[0] ?? "", /build_battle_card/);
  assert.match(messages[0] ?? "", /candidate-1/);
  assert.match(messages[0] ?? "", /"templateVersion":"battle-card\.v2"/);
  assert.equal(cardReads, 2);
  assert.equal(drawer.getState().battleCard.status, "ready");
});

test("a successful task with the wrong tool name is rejected without refreshing", async () => {
  let cardReads = 0;
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getBattleCard: async () => {
        cardReads += 1;
        throw httpError(404, "missing");
      },
      requestAssistantAction: async () =>
        succeededTask("task-wrong", "qualify_candidate")
    }),
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  await drawer.generateBattleCard();

  assert.equal(cardReads, 1);
  assert.equal(drawer.getState().action.status, "failed");
  assert.match(drawer.render().html, /未执行 build_battle_card/);
});

test("renderer separates facts, inferences with confidence, and unknowns with evidence links", () => {
  const drawer = createBattleCardDrawer({
    api: apiStub(),
    onCandidateUpdated: () => undefined
  });
  const state = drawer.getState();
  state.open = true;
  state.candidateId = "candidate-1";
  state.candidate = { status: "ready", data: candidate(), error: null };
  state.evidence = { status: "ready", data: evidence, error: null };
  state.qualification = { status: "ready", data: qualification, error: null };
  state.financialValue = {
    status: "ready",
    data: financialValue,
    error: null
  };
  state.battleCard = { status: "ready", data: battleCard, error: null };

  const html = renderBattleCardDrawer(state, drawer.render().callbacks).html;

  assert.match(html, /事实/);
  assert.match(html, /推测/);
  assert.match(html, /置信度 68%/);
  assert.match(html, /未知\/待核验/);
  assert.match(html, /data-evidence-id="evidence-1"/);
  assert.match(html, /href="https:\/\/example.com\/evidence-1"/);
  assert.doesNotMatch(html, /确认采购偏好/);
});

test("renderer embeds the Douyin identity workbench and locks downstream decisions until the subject is confirmed", () => {
  const drawer = createBattleCardDrawer({
    api: apiStub(),
    onCandidateUpdated: () => undefined
  });
  const state = drawer.getState();
  const discoveryEvidence: EvidenceDto = {
    ...profileEvidence,
    id: "evidence-1",
    sourceTitle: "抖音视频中的公开需求信号",
    sourceSnippet: "想了解一下获客系统",
    provenance: {
      kind: "search_result",
      provider: "baidu",
      queryText: "site:douyin.com 获客系统",
      sourceUrl: "https://www.douyin.com/video/123456",
      resultRank: 1,
      sourceType: "video"
    }
  };
  state.open = true;
  state.candidateId = "candidate-1";
  state.candidate = {
    status: "ready",
    data: unresolvedIndividualCandidate(),
    error: null
  };
  state.evidence = {
    status: "ready",
    data: [discoveryEvidence, profileEvidence],
    error: null
  };
  state.qualification = { status: "ready", data: qualification, error: null };
  state.financialValue = {
    status: "ready",
    data: financialValue,
    error: null
  };
  state.battleCard = { status: "ready", data: battleCardV2, error: null };
  state.identityVerification = {
    ...state.identityVerification,
    status: "ready_to_confirm",
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "公开主页昵称、地区与原始需求信号一致。",
    fetchedEvidenceIds: ["evidence-profile-1"],
    selectedEvidenceIds: ["evidence-profile-1"]
  };

  const html = renderBattleCardDrawer(state, drawer.render().callbacks).html;

  assert.match(html, /主体核验/);
  assert.match(html, /抖音视频页/);
  assert.match(html, /百度搜索/);
  assert.match(
    html,
    /data-action="confirm-candidate-identity"(?![^>]*disabled)/
  );
  assert.doesNotMatch(html, /data-action="run-qualification"/);
  assert.doesNotMatch(html, /data-action="generate-battle-card"/);
  assert.doesNotMatch(html, /data-v2-region="account-overview"/);
  assert.match(html, /主体确认后自动继续/);
});

test("renderer reveals qualification and the battle card after Douyin identity is resolved", () => {
  const drawer = createBattleCardDrawer({
    api: apiStub(),
    onCandidateUpdated: () => undefined
  });
  const state = drawer.getState();
  state.open = true;
  state.candidateId = "candidate-1";
  state.candidate = {
    status: "ready",
    data: unresolvedIndividualCandidate("candidate-1", {
      status: "pending_review",
      identityResolved: true,
      publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
    }),
    error: null
  };
  state.evidence = {
    status: "ready",
    data: [profileEvidence],
    error: null
  };
  state.qualification = { status: "ready", data: qualification, error: null };
  state.financialValue = {
    status: "ready",
    data: financialValue,
    error: null
  };
  state.battleCard = { status: "ready", data: battleCardV2, error: null };
  state.identityVerification = {
    ...state.identityVerification,
    status: "complete",
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    message: "作战资料已生成，等待人工审核"
  };

  const html = renderBattleCardDrawer(state, drawer.render().callbacks).html;

  assert.match(html, /主体已确认/);
  assert.match(html, /A 级 · 88 分/);
  assert.match(html, /data-v2-region="account-overview"/);
});

test("renderer keeps all battle-card v2 regions in a fixed order and marks inference with confidence", () => {
  const drawer = createBattleCardDrawer({
    api: apiStub(),
    onCandidateUpdated: () => undefined
  });
  const state = drawer.getState();
  state.open = true;
  state.candidateId = "candidate-1";
  state.candidate = { status: "ready", data: candidate(), error: null };
  state.evidence = { status: "ready", data: evidence, error: null };
  state.qualification = { status: "ready", data: qualification, error: null };
  state.financialValue = {
    status: "ready",
    data: financialValue,
    error: null
  };
  state.battleCard = { status: "ready", data: battleCardV2, error: null };

  const html = renderBattleCardDrawer(state, drawer.render().callbacks).html;
  const orderedRegions = [
    "客户概况",
    "需求证据",
    "供应商",
    "决策链",
    "采购偏好",
    "连接策略",
    "角色话术",
    "不建议动作",
    "财务摘要"
  ];
  let previous = -1;
  for (const region of orderedRegions) {
    const position = html.indexOf(`>${region}<`);
    assert.ok(position > previous, `${region} should follow the previous region`);
    previous = position;
  }
  assert.match(html, /推测 · 置信度 72%/);
  assert.match(html, /推测 · 置信度 68%/);
  assert.match(html, /预计收入[\s\S]*¥12,800\.00/);
  const roleOpeners = html.match(
    /data-v2-region="role-openers"[\s\S]*?<\/section>/
  )?.[0] ?? "";
  assert.match(roleOpeners, /看到贵司公开的升级计划/);
  assert.doesNotMatch(roleOpeners, /推测/);
});

test("openFixture is a read-only path that never calls network or mutation methods", async () => {
  const calls: string[] = [];
  const api = apiStub({
    getCandidate: async () => {
      calls.push("getCandidate");
      return candidate();
    },
    getEvidence: async () => {
      calls.push("getEvidence");
      return { items: evidence, nextCursor: null };
    },
    getQualification: async () => {
      calls.push("getQualification");
      return qualification;
    },
    getFinancialValue: async () => {
      calls.push("getFinancialValue");
      return financialValue;
    },
    getBattleCard: async () => {
      calls.push("getBattleCard");
      return battleCardV2;
    },
    requestAssistantAction: async () => {
      calls.push("requestAssistantAction");
      return succeededTask("task-1", "build_battle_card");
    },
    reviewCandidate: async () => {
      calls.push("reviewCandidate");
      return {
        candidate: candidate("approved"),
        review: {},
        research: null
      };
    },
    convertCandidate: async () => {
      calls.push("convertCandidate");
      return apiStub().convertCandidate(
        "candidate-1",
        { decisionVersion: "decision-v2" },
        "idempotency-key"
      );
    }
  });
  const drawer = createBattleCardDrawer({
    api,
    onCandidateUpdated: () => undefined
  });

  drawer.openFixture(
    candidate(),
    battleCardV2,
    evidence,
    qualification,
    financialValue
  );

  assert.equal(drawer.getState().open, true);
  assert.equal(drawer.getState().readOnly, true);
  assert.match(drawer.render().html, /演示数据 · 只读/);
  await assert.rejects(() => drawer.runQualification(), /只读/);
  await assert.rejects(() => drawer.generateBattleCard(), /只读/);
  await assert.rejects(() => drawer.review("approved"), /只读/);
  await assert.rejects(() => drawer.convert(), /只读/);
  await assert.rejects(() => drawer.createOutreachReviewTask(), /只读/);
  assert.deepEqual(calls, []);
});

test("review actions use the current decision version and only exact approval unlocks conversion and outreach review", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const updates: CandidateDto[] = [];
  let current = candidate("pending_review");
  const api = apiStub({
    getCandidate: async () => current,
    reviewCandidate: async (_candidateId, input, idempotencyKey) => {
      calls.push({ input, idempotencyKey });
      current = candidate("approved");
      return { candidate: current, review: {}, research: null };
    }
  });
  const drawer = createBattleCardDrawer({
    api,
    onCandidateUpdated: (value) => updates.push(value)
  });
  await drawer.open("candidate-1");
  assert.match(drawer.render().html, /候选资格人工复核/);
  assert.match(drawer.render().html, /批准/);
  assert.doesNotMatch(drawer.render().html, /创建外联动作审核任务/);

  await drawer.review("approved", "公开信号已核验");

  assert.deepEqual(calls[0]?.input, {
    action: "approved",
    decisionVersion: "decision-v2",
    reason: "公开信号已核验"
  });
  assert.equal(updates.at(-1)?.status, "approved");
  assert.match(drawer.render().html, /转为线索/);
  assert.match(drawer.render().html, /创建外联动作审核任务/);

  current = candidate("approved", {
    latestDecisionVersion: "decision-v3",
    approvedDecisionVersion: "decision-v2"
  });
  await drawer.open("candidate-1");
  assert.doesNotMatch(drawer.render().html, /创建外联动作审核任务/);
  await assert.rejects(
    () => drawer.convert(),
    /当前资格决定尚未获得有效批准/
  );
});

test("only rejected candidates expose backend-supported reopen", async () => {
  const rejected = createBattleCardDrawer({
    api: apiStub({ getCandidate: async () => candidate("rejected") }),
    onCandidateUpdated: () => undefined
  });
  await rejected.open("candidate-1");
  assert.match(rejected.render().html, /重新打开/);
  assert.match(rejected.render().html, /重新打开原因（必填）/);

  for (const status of ["do_not_contact", "needs_research"] as const) {
    const drawer = createBattleCardDrawer({
      api: apiStub({ getCandidate: async () => candidate(status) }),
      onCandidateUpdated: () => undefined
    });
    await drawer.open("candidate-1");
    assert.doesNotMatch(drawer.render().html, /重新打开/);
    await assert.rejects(
      () => drawer.review("reopen", "已有新增公开证据"),
      /当前候选状态不允许/
    );
  }
});

test("typed renderer review input carries reasons and blocks missing required reasons before API", async () => {
  const calls: Array<{ action: string; reason: string | null }> = [];
  let current = candidate("pending_review");
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => current,
      reviewCandidate: async (_candidateId, input) => {
        calls.push({ action: input.action, reason: input.reason });
        current = candidate(input.action === "approved"
          ? "approved"
          : input.action === "do_not_contact"
            ? "do_not_contact"
            : input.action === "reopen"
              ? "normalized"
              : input.action);
        return { candidate: current, review: {}, research: null };
      }
    }),
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  assert.match(drawer.render().html, /驳回、补充研究时必填/);

  for (const action of ["rejected", "needs_research"] as const) {
    await assert.rejects(
      () => drawer.review(action, "  "),
      /必须填写原因/
    );
  }
  assert.equal(calls.length, 0);

  await drawer.render().callbacks.onReview({
    action: "rejected",
    reason: "公开采购信号已经失效"
  });
  assert.deepEqual(calls[0], {
    action: "rejected",
    reason: "公开采购信号已经失效"
  });

  current = candidate("rejected");
  await drawer.open("candidate-1");
  await assert.rejects(
    () => drawer.review("reopen", null),
    /必须填写原因/
  );
  assert.equal(calls.length, 1);
  await drawer.render().callbacks.onReview({
    action: "reopen",
    reason: "发现新的官网采购公告"
  });
  assert.deepEqual(calls[1], {
    action: "reopen",
    reason: "发现新的官网采购公告"
  });
});

test("approved and do-not-contact keep backend-compatible optional reason semantics", async () => {
  for (const action of ["approved", "do_not_contact"] as const) {
    const calls: Array<string | null> = [];
    const drawer = createBattleCardDrawer({
      api: apiStub({
        reviewCandidate: async (_candidateId, input) => {
          calls.push(input.reason);
          return {
            candidate: candidate(action),
            review: {},
            research: null
          };
        }
      }),
      onCandidateUpdated: () => undefined
    });
    await drawer.open("candidate-1");
    await drawer.review(action, null);
    assert.deepEqual(calls, [null]);
  }
});

test("outreach review task is Copilot-controlled and validates create_review_task", async () => {
  const messages: string[] = [];
  const api = apiStub({
    getCandidate: async () => candidate("approved"),
    requestAssistantAction: async (_sessionId, message) => {
      messages.push(message);
      return succeededTask("task-review", "create_review_task");
    }
  });
  const drawer = createBattleCardDrawer({
    api,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  await drawer.createOutreachReviewTask();

  assert.match(messages[0] ?? "", /create_review_task/);
  assert.match(messages[0] ?? "", /candidate-1/);
  assert.equal(drawer.getState().action.status, "succeeded");
  assert.match(drawer.render().html, /外联动作审核任务已创建/);
});

test("close resets the selected candidate and keeps a pure closed rendering", async () => {
  const drawer = createBattleCardDrawer({
    api: apiStub(),
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  drawer.close();

  assert.equal(drawer.getState().open, false);
  assert.equal(drawer.getState().candidateId, null);
  assert.equal(drawer.render().html, "");
});

test("switching candidates discards a stale qualification task completion", async () => {
  const pendingTask = deferred<CopilotTaskDto>();
  const qualificationReads: string[] = [];
  const qualificationB = {
    ...qualification,
    id: "qualification-b",
    candidateId: "candidate-2",
    decisionVersion: "decision-b"
  };
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async (candidateId) => candidate("pending_review", {
        id: candidateId,
        name: candidateId === "candidate-1" ? "候选甲" : "候选乙",
        latestDecisionVersion: candidateId === "candidate-1"
          ? "decision-v2"
          : "decision-b"
      }),
      getQualification: async (candidateId) => {
        qualificationReads.push(candidateId);
        if (candidateId === "candidate-1") {
          throw httpError(404, "missing");
        }
        return qualificationB;
      },
      requestAssistantAction: async () => pendingTask.promise
    }),
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  const running = drawer.runQualification();
  await Promise.resolve();
  await Promise.resolve();
  await drawer.open("candidate-2");

  pendingTask.resolve(succeededTask("task-a", "qualify_candidate"));
  await running;

  assert.equal(drawer.getState().candidateId, "candidate-2");
  assert.equal(drawer.getState().qualification.data?.candidateId, "candidate-2");
  assert.equal(drawer.getState().action.status, "idle");
  assert.deepEqual(qualificationReads, ["candidate-1", "candidate-2"]);
});

test("closing during battle-card generation ignores stale task and refresh results", async () => {
  const pendingTask = deferred<CopilotTaskDto>();
  let cardReads = 0;
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getBattleCard: async () => {
        cardReads += 1;
        throw httpError(404, "missing");
      },
      requestAssistantAction: async () => pendingTask.promise
    }),
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  const running = drawer.generateBattleCard();
  await Promise.resolve();
  await Promise.resolve();
  drawer.close();

  pendingTask.resolve(succeededTask("task-card", "build_battle_card"));
  await running;

  assert.equal(drawer.getState().open, false);
  assert.equal(drawer.getState().action.status, "idle");
  assert.equal(cardReads, 1);
});

test("switching during review and closing during conversion suppress stale refresh and callbacks", async () => {
  const pendingReview = deferred<Awaited<ReturnType<AiGrowthApi["reviewCandidate"]>>>();
  const pendingConversion =
    deferred<Awaited<ReturnType<AiGrowthApi["convertCandidate"]>>>();
  const updates: string[] = [];
  const candidateReads: string[] = [];
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async (candidateId) => {
        candidateReads.push(candidateId);
        return candidate(
          candidateId === "candidate-1" ? "pending_review" : "approved",
          {
            id: candidateId,
            name: candidateId,
            latestDecisionVersion: "decision-v2",
            approvedDecisionVersion: candidateId === "candidate-2"
              ? "decision-v2"
              : null
          }
        );
      },
      reviewCandidate: async () => pendingReview.promise,
      convertCandidate: async () => pendingConversion.promise
    }),
    onCandidateUpdated: (value) => updates.push(value.id)
  });

  await drawer.open("candidate-1");
  const review = drawer.review("approved", null);
  await Promise.resolve();
  await drawer.open("candidate-2");
  pendingReview.resolve({
    candidate: candidate("approved"),
    review: {},
    research: null
  });
  await review;
  assert.deepEqual(updates, []);
  assert.deepEqual(candidateReads, ["candidate-1", "candidate-2"]);

  const conversion = drawer.convert();
  await Promise.resolve();
  drawer.close();
  pendingConversion.resolve({
    id: "conversion-2",
    candidateId: "candidate-2",
    decisionVersion: "decision-v2",
    partyRef: {},
    leadId: "lead-2",
    reviewerId: "reviewer-1",
    evidenceSnapshotHash: "snapshot-2",
    createdAt: timestamp
  });
  await conversion;
  assert.deepEqual(updates, []);
  assert.deepEqual(candidateReads, ["candidate-1", "candidate-2"]);
  assert.equal(drawer.getState().open, false);
});

test("identity profile fetch coalesces duplicate submits and publishes only completed evidence", async () => {
  const created = deferred<ContentFetchOperationDto>();
  const observed: string[] = [];
  let creates = 0;
  let polls = 0;
  let evidenceReads = 0;
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => unresolvedIndividualCandidate(),
      createContentFetchOperation: async () => {
        creates += 1;
        return created.promise;
      },
      getContentFetchOperation: async () => {
        polls += 1;
        return polls === 1
          ? contentFetchOperation("running")
          : contentFetchOperation("succeeded");
      },
      getEvidenceById: async (id) => {
        evidenceReads += 1;
        return { ...profileEvidence, id };
      }
    }),
    wait: async () => undefined,
    onStateChange: (state) => {
      if (state.identityVerification) {
        observed.push(state.identityVerification.status);
      }
    },
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  const first = drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  const duplicate = drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  assert.equal(first, duplicate);
  assert.equal(drawer.getState().identityVerification.status, "fetching_profile");

  created.resolve(contentFetchOperation("queued"));
  await first;

  assert.equal(creates, 1);
  assert.equal(polls, 2);
  assert.equal(evidenceReads, 1);
  assert.ok(observed.includes("fetching_profile"));
  assert.equal(
    drawer.getState().identityVerification.status,
    "ready_to_confirm"
  );
  assert.equal(
    drawer.getState().identityVerification.fetch.status,
    "succeeded"
  );
  assert.deepEqual(
    drawer.getState().identityVerification.fetchedEvidenceIds,
    ["evidence-profile-1"]
  );
  assert.equal(
    drawer.getState().evidence.data?.at(-1)?.id,
    "evidence-profile-1"
  );
});

test("identity profile fetch only exposes exact public Douyin profile evidence for confirmation", async () => {
  const invalidEvidence: EvidenceDto[] = [{
    ...profileEvidence,
    id: "wrong-platform",
    sourcePlatform: "weibo"
  }, {
    ...profileEvidence,
    id: "video-page",
    provenance: {
      kind: "search_result",
      provider: "baidu",
      queryText: "厦门装修",
      sourceUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
      resultRank: 1,
      sourceType: "video"
    }
  }, {
    ...profileEvidence,
    id: "restricted-profile",
    accessStatus: "access_restricted"
  }, {
    ...profileEvidence,
    id: "missing-fetch-time",
    fetchedAt: null
  } as unknown as EvidenceDto, {
    ...profileEvidence,
    id: "different-profile",
    provenance: {
      ...profileEvidence.provenance,
      sourceUrl: "https://www.douyin.com/user/DIFFERENT"
    }
  }];
  const byId = new Map(invalidEvidence.map((item) => [item.id, item]));
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => unresolvedIndividualCandidate(),
      createContentFetchOperation: async () => contentFetchOperation(
        "succeeded",
        { evidenceIds: invalidEvidence.map((item) => item.id) }
      ),
      getContentFetchOperation: async () => contentFetchOperation(
        "succeeded",
        { evidenceIds: invalidEvidence.map((item) => item.id) }
      ),
      getEvidenceById: async (id) => byId.get(id)!
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  await drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );

  assert.equal(
    drawer.getState().identityVerification.status,
    "fetched_no_eligible"
  );
  assert.deepEqual(
    drawer.getState().identityVerification.fetchedEvidenceIds,
    []
  );
  assert.match(
    drawer.getState().identityVerification.error ?? "",
    /没有返回可核验的公开证据/
  );
});

test("identity profile fetch uses the shared canonical URL when a trailing slash differs", async () => {
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => unresolvedIndividualCandidate(),
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  await drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA/"
  );

  assert.equal(
    drawer.getState().identityVerification.profileUrl,
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  assert.equal(
    drawer.getState().identityVerification.status,
    "ready_to_confirm"
  );
});

test("identity verification keeps controlled profile, rationale, and evidence selection drafts", async () => {
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => unresolvedIndividualCandidate(),
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  drawer.setIdentityDraft({
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "等待抓取后人工核验"
  });
  await drawer.fetchIdentityProfile(
    drawer.getState().identityVerification.profileUrl
  );
  await assert.rejects(
    drawer.confirmCandidateIdentity({
      profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
      rationale: "  ",
      evidenceIds: ["evidence-profile-1"]
    }),
    /请填写人工核验说明/
  );
  assert.equal(
    drawer.getState().identityVerification.status,
    "validation_error"
  );
  drawer.setIdentityDraft({ rationale: "已核验公开主页" });
  drawer.toggleIdentityEvidence("evidence-profile-1", true);

  assert.equal(
    drawer.getState().identityVerification.profileUrl,
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  assert.equal(
    drawer.getState().identityVerification.rationale,
    "已核验公开主页"
  );
  assert.deepEqual(
    drawer.getState().identityVerification.selectedEvidenceIds,
    ["evidence-profile-1"]
  );
  assert.equal(
    drawer.getState().identityVerification.status,
    "ready_to_confirm"
  );

  drawer.toggleIdentityEvidence("evidence-profile-1", false);
  assert.deepEqual(
    drawer.getState().identityVerification.selectedEvidenceIds,
    []
  );
});

test("opening an already resolved individual synchronizes identity verification state", async () => {
  const resolved = unresolvedIndividualCandidate("candidate-1", {
    status: "normalized",
    identityResolved: true,
    publicActorKey: "public:douyin:sha256:actor",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
  });
  const drawer = createBattleCardDrawer({
    api: apiStub({ getCandidate: async () => resolved }),
    onCandidateUpdated: () => undefined
  });

  await drawer.open("candidate-1");

  assert.equal(drawer.getState().identityVerification.status, "confirmed");
  assert.equal(
    drawer.getState().identityVerification.profileUrl,
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  assert.equal(
    drawer.getState().identityVerification.message,
    "主体已确认"
  );
});

test("identity confirmation surfaces 409 and 412 conflicts without replaying the write", async () => {
  for (const status of [409, 412] as const) {
    let confirmations = 0;
    let candidateReads = 0;
    const drawer = createBattleCardDrawer({
      api: apiStub({
        getCandidate: async () => {
          candidateReads += 1;
          return unresolvedIndividualCandidate();
        },
        createContentFetchOperation: async () =>
          contentFetchOperation("succeeded"),
        getContentFetchOperation: async () =>
          contentFetchOperation("succeeded"),
        getEvidenceById: async () => profileEvidence,
        confirmCandidateIdentity: async () => {
          confirmations += 1;
          throw new AdvisorConflictError(
            status,
            Object.assign(new Error(`HTTP ${status}`), { status })
          );
        }
      }),
      wait: async () => undefined,
      onCandidateUpdated: () => undefined
    });
    await drawer.open("candidate-1");
    await drawer.fetchIdentityProfile(
      "https://www.douyin.com/user/MS4wLjABAAAA"
    );

    await assert.rejects(
      drawer.confirmCandidateIdentity({
        profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
        rationale: "已人工核验公开主页与原始需求信号一致。",
        evidenceIds: ["evidence-profile-1"]
      }),
      (error: unknown) =>
        error instanceof AdvisorConflictError && error.status === status
    );

    assert.equal(confirmations, 1);
    assert.equal(candidateReads, 2);
    assert.equal(drawer.getState().identityVerification.status, "conflict");
    assert.equal(
      drawer.getState().identityVerification.confirmation.status,
      "conflict"
    );
    assert.match(
      drawer.getState().identityVerification.error ?? "",
      /候选已被其他成员更新/
    );
  }
});

test("identity confirmation treats a conflict refresh with resolved identity as idempotent success", async () => {
  let candidateReads = 0;
  let confirmations = 0;
  const messages: string[] = [];
  const resolved = unresolvedIndividualCandidate("candidate-1", {
    status: "normalized",
    version: 4,
    identityResolved: true,
    publicActorKey: "public:douyin:sha256:actor",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
  });
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => {
        candidateReads += 1;
        return candidateReads === 1
          ? unresolvedIndividualCandidate()
          : resolved;
      },
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence,
      confirmCandidateIdentity: async () => {
        confirmations += 1;
        throw new AdvisorConflictError(
          412,
          Object.assign(new Error("HTTP 412"), { status: 412 })
        );
      },
      requestAssistantAction: async (_sessionId, message) => {
        messages.push(message);
        const toolName = message.includes("research_candidate")
          ? "research_candidate"
          : message.includes("qualify_candidate")
            ? "qualify_candidate"
            : "build_battle_card";
        return succeededTask(`task-${messages.length}`, toolName);
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  await drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );

  await drawer.confirmCandidateIdentity({
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "已人工核验公开主页与原始需求信号一致。",
    evidenceIds: ["evidence-profile-1"]
  });

  assert.equal(confirmations, 1);
  assert.equal(candidateReads, 5);
  assert.equal(messages.length, 3);
  assert.equal(drawer.getState().identityVerification.status, "complete");
  assert.equal(
    drawer.getState().identityVerification.confirmation.status,
    "succeeded"
  );
});

test("identity confirmation reports a missing candidate version separately from a conflict", async () => {
  let confirmations = 0;
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => unresolvedIndividualCandidate(),
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence,
      confirmCandidateIdentity: async () => {
        confirmations += 1;
        throw new AdvisorPreconditionRequiredError(
          Object.assign(new Error("HTTP 428"), { status: 428 })
        );
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  await drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );

  await assert.rejects(
    drawer.confirmCandidateIdentity({
      profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
      rationale: "已人工核验公开主页与原始需求信号一致。",
      evidenceIds: ["evidence-profile-1"]
    }),
    AdvisorPreconditionRequiredError
  );

  assert.equal(confirmations, 1);
  assert.equal(
    drawer.getState().identityVerification.status,
    "validation_error"
  );
  assert.equal(
    drawer.getState().identityVerification.confirmation.status,
    "failed"
  );
  assert.match(
    drawer.getState().identityVerification.error ?? "",
    /候选版本信息缺失/
  );
});

test("identity confirmation coalesces duplicates then runs research, qualification, and battle card in order", async () => {
  const confirmation = deferred<Awaited<
    ReturnType<AiGrowthApi["confirmCandidateIdentity"]>
  >>();
  const messages: string[] = [];
  const updates: CandidateDto[] = [];
  let candidateReads = 0;
  let qualificationReads = 0;
  let financeReads = 0;
  let cardReads = 0;
  let confirmations = 0;
  let forbiddenWrites = 0;
  const resolved = unresolvedIndividualCandidate("candidate-1", {
    status: "normalized",
    version: 4,
    identityResolved: true,
    publicActorKey: "public:douyin:sha256:actor",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
  });
  const reviewed = unresolvedIndividualCandidate("candidate-1", {
    status: "pending_review",
    version: 5,
    identityResolved: true,
    publicActorKey: "public:douyin:sha256:actor",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    latestDecisionVersion: "decision-v2"
  });
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => {
        candidateReads += 1;
        return candidateReads === 1
          ? unresolvedIndividualCandidate()
          : reviewed;
      },
      getEvidence: async () => ({
        items: candidateReads === 0 ? evidence : [...evidence, profileEvidence],
        nextCursor: null
      }),
      getQualification: async () => {
        qualificationReads += 1;
        if (qualificationReads === 1) throw httpError(404, "missing");
        return qualification;
      },
      getFinancialValue: async () => {
        financeReads += 1;
        if (financeReads === 1) throw httpError(404, "missing");
        return financialValue;
      },
      getBattleCard: async () => {
        cardReads += 1;
        if (cardReads === 1) throw httpError(404, "missing");
        return battleCardV2;
      },
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence,
      confirmCandidateIdentity: async () => {
        confirmations += 1;
        return confirmation.promise;
      },
      requestAssistantAction: async (_sessionId, message) => {
        messages.push(message);
        const toolName = message.includes("research_candidate")
          ? "research_candidate"
          : message.includes("qualify_candidate")
            ? "qualify_candidate"
            : "build_battle_card";
        return succeededTask(`task-${messages.length}`, toolName);
      },
      reviewCandidate: async () => {
        forbiddenWrites += 1;
        throw new Error("review must not run");
      },
      convertCandidate: async () => {
        forbiddenWrites += 1;
        throw new Error("conversion must not run");
      },
      createTodo: async () => {
        forbiddenWrites += 1;
        throw new Error("CRM todo must not run");
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: (value) => updates.push(value)
  });
  await drawer.open("candidate-1");
  await drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  const input = {
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "已人工核验公开主页与原始需求信号一致。",
    evidenceIds: ["evidence-profile-1"]
  };

  const first = drawer.confirmCandidateIdentity(input);
  const duplicate = drawer.confirmCandidateIdentity(input);
  assert.equal(first, duplicate);
  confirmation.resolve({
    candidate: resolved,
    resolution: {
      status: "resolved",
      basis: "provider_public_actor",
      resolverVersion: "identity-resolver.v1",
      evidenceIds: ["evidence-profile-1"],
      resolvedAt: timestamp,
      resolvedBy: "actor-1"
    }
  });
  await first;

  assert.equal(confirmations, 1);
  assert.equal(messages.length, 3);
  assert.match(messages[0] ?? "", /research_candidate/);
  assert.match(messages[0] ?? "", /"depth":"standard"/);
  assert.match(messages[1] ?? "", /qualify_candidate/);
  assert.match(messages[2] ?? "", /build_battle_card/);
  assert.equal(forbiddenWrites, 0);
  assert.doesNotMatch(messages.join("\n"), /create_review_task|outreach|convert/);
  assert.equal(drawer.getState().identityVerification.status, "complete");
  assert.equal(
    drawer.getState().identityVerification.confirmation.status,
    "succeeded"
  );
  assert.equal(
    drawer.getState().identityVerification.continuation.status,
    "succeeded"
  );
  assert.deepEqual(
    drawer.getState().identityVerification.continuation.data?.completedTools,
    ["research_candidate", "qualify_candidate", "build_battle_card"]
  );
  assert.equal(drawer.getState().candidate.data?.status, "pending_review");
  assert.equal(drawer.getState().qualification.status, "ready");
  assert.equal(drawer.getState().financialValue.status, "ready");
  assert.equal(drawer.getState().battleCard.status, "ready");
  assert.equal(updates[0]?.status, "normalized");
  assert.equal(updates.at(-1)?.status, "pending_review");
});

test("identity continuation stops successfully after an ineligible qualification", async () => {
  const messages: string[] = [];
  let cardReads = 0;
  let candidateReads = 0;
  const resolved = unresolvedIndividualCandidate("candidate-1", {
    status: "normalized",
    version: 4,
    identityResolved: true,
    publicActorKey: "public:douyin:sha256:actor",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
  });
  const ineligibleQualification: QualificationDto = {
    ...qualification,
    grade: "C",
    score: 58,
    hardGateFailures: []
  };
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => {
        candidateReads += 1;
        return candidateReads === 1
          ? unresolvedIndividualCandidate()
          : resolved;
      },
      getQualification: async () => {
        if (candidateReads === 1) throw httpError(404, "missing");
        return ineligibleQualification;
      },
      getBattleCard: async () => {
        cardReads += 1;
        throw httpError(404, "missing");
      },
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence,
      confirmCandidateIdentity: async () => ({
        candidate: resolved,
        resolution: {
          status: "resolved",
          basis: "provider_public_actor",
          resolverVersion: "identity-resolver.v1",
          evidenceIds: ["evidence-profile-1"],
          resolvedAt: timestamp,
          resolvedBy: "actor-1"
        }
      }),
      requestAssistantAction: async (_sessionId, message) => {
        messages.push(message);
        return message.includes("research_candidate")
          ? succeededTask("task-research", "research_candidate")
          : succeededTask("task-qualification", "qualify_candidate");
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  await drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );

  await drawer.confirmCandidateIdentity({
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "已人工核验公开主页与原始需求信号一致。",
    evidenceIds: ["evidence-profile-1"]
  });

  assert.equal(messages.length, 2);
  assert.doesNotMatch(messages.join("\n"), /build_battle_card/);
  assert.equal(cardReads, 1);
  assert.equal(drawer.getState().identityVerification.status, "complete");
  assert.equal(
    drawer.getState().identityVerification.continuation.status,
    "succeeded"
  );
  assert.deepEqual(
    drawer.getState().identityVerification.continuation.data?.completedTools,
    ["research_candidate", "qualify_candidate"]
  );
  assert.match(
    drawer.getState().identityVerification.message ?? "",
    /不满足作战卡生成条件/
  );
});

test("identity continuation does not build a card when qualification hard gates fail", async () => {
  const messages: string[] = [];
  let qualificationReads = 0;
  const resolved = unresolvedIndividualCandidate("candidate-1", {
    status: "normalized",
    version: 4,
    identityResolved: true,
    publicActorKey: "public:douyin:sha256:actor",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
  });
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => resolved,
      getQualification: async () => {
        qualificationReads += 1;
        if (qualificationReads === 1) throw httpError(404, "missing");
        return {
          ...qualification,
          grade: "A",
          score: 88,
          hardGateFailures: ["identity_unresolved"]
        };
      },
      getBattleCard: async () => {
        throw httpError(404, "missing");
      },
      requestAssistantAction: async (_sessionId, message) => {
        messages.push(message);
        return message.includes("research_candidate")
          ? succeededTask("task-research", "research_candidate")
          : succeededTask("task-qualification", "qualify_candidate");
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");

  await drawer.retryIdentityContinuation();

  assert.equal(messages.length, 2);
  assert.doesNotMatch(messages.join("\n"), /build_battle_card/);
  assert.equal(drawer.getState().identityVerification.status, "complete");
  assert.deepEqual(
    drawer.getState().identityVerification.continuation.data?.completedTools,
    ["research_candidate", "qualify_candidate"]
  );
});

test("failed identity continuation keeps confirmation and retries from the first incomplete tool", async () => {
  const retryQualification = deferred<CopilotTaskDto>();
  const messages: string[] = [];
  let confirmations = 0;
  let candidateReads = 0;
  let qualificationReads = 0;
  let financeReads = 0;
  let cardReads = 0;
  const resolved = unresolvedIndividualCandidate("candidate-1", {
    status: "normalized",
    version: 4,
    identityResolved: true,
    publicActorKey: "public:douyin:sha256:actor",
    publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
  });
  const drawer = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => {
        candidateReads += 1;
        return candidateReads === 1
          ? unresolvedIndividualCandidate()
          : resolved;
      },
      getQualification: async () => {
        qualificationReads += 1;
        if (qualificationReads === 1) throw httpError(404, "missing");
        return qualification;
      },
      getFinancialValue: async () => {
        financeReads += 1;
        if (financeReads === 1) throw httpError(404, "missing");
        return financialValue;
      },
      getBattleCard: async () => {
        cardReads += 1;
        if (cardReads === 1) throw httpError(404, "missing");
        return battleCardV2;
      },
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence,
      confirmCandidateIdentity: async () => {
        confirmations += 1;
        return {
          candidate: resolved,
          resolution: {
            status: "resolved",
            basis: "provider_public_actor",
            resolverVersion: "identity-resolver.v1",
            evidenceIds: ["evidence-profile-1"],
            resolvedAt: timestamp,
            resolvedBy: "actor-1"
          }
        };
      },
      requestAssistantAction: async (_sessionId, message) => {
        messages.push(message);
        if (messages.length === 1) {
          return succeededTask("task-research", "research_candidate");
        }
        if (messages.length === 2) {
          return failedTask("task-qualification-failed");
        }
        if (messages.length === 3) return retryQualification.promise;
        return succeededTask("task-card", "build_battle_card");
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await drawer.open("candidate-1");
  await drawer.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  await drawer.confirmCandidateIdentity({
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "已人工核验公开主页与原始需求信号一致。",
    evidenceIds: ["evidence-profile-1"]
  });

  assert.equal(confirmations, 1);
  assert.equal(
    drawer.getState().identityVerification.status,
    "continuation_partial"
  );
  assert.equal(
    drawer.getState().identityVerification.confirmation.status,
    "succeeded"
  );
  assert.deepEqual(
    drawer.getState().identityVerification.continuation.data?.completedTools,
    ["research_candidate"]
  );

  const retry = drawer.retryIdentityContinuation();
  const duplicateRetry = drawer.retryIdentityContinuation();
  assert.equal(retry, duplicateRetry);
  retryQualification.resolve(
    succeededTask("task-qualification-retry", "qualify_candidate")
  );
  await retry;

  assert.equal(confirmations, 1);
  assert.equal(
    messages.filter((message) => message.includes("research_candidate")).length,
    1
  );
  assert.equal(
    messages.filter((message) => message.includes("qualify_candidate")).length,
    2
  );
  assert.equal(
    messages.filter((message) => message.includes("build_battle_card")).length,
    1
  );
  assert.equal(drawer.getState().identityVerification.status, "complete");
});

test("candidate switches and drawer close ignore stale identity completions", async () => {
  const pendingFetch = deferred<ContentFetchOperationDto>();
  let fetchPolls = 0;
  const switched = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async (candidateId) =>
        unresolvedIndividualCandidate(candidateId),
      createContentFetchOperation: async () => pendingFetch.promise,
      getContentFetchOperation: async () => {
        fetchPolls += 1;
        return contentFetchOperation("succeeded");
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: () => undefined
  });
  await switched.open("candidate-1");
  const staleFetch = switched.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  await Promise.resolve();
  await switched.open("candidate-2");
  pendingFetch.resolve(contentFetchOperation("queued"));
  await staleFetch;

  assert.equal(fetchPolls, 0);
  assert.equal(switched.getState().candidateId, "candidate-2");
  assert.equal(
    switched.getState().identityVerification.status,
    "needs_profile"
  );

  const pendingConfirmation = deferred<Awaited<
    ReturnType<AiGrowthApi["confirmCandidateIdentity"]>
  >>();
  const updates: CandidateDto[] = [];
  let assistantActions = 0;
  const closed = createBattleCardDrawer({
    api: apiStub({
      getCandidate: async () => unresolvedIndividualCandidate(),
      createContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getContentFetchOperation: async () =>
        contentFetchOperation("succeeded"),
      getEvidenceById: async () => profileEvidence,
      confirmCandidateIdentity: async () => pendingConfirmation.promise,
      requestAssistantAction: async () => {
        assistantActions += 1;
        return succeededTask("forbidden-task", "research_candidate");
      }
    }),
    wait: async () => undefined,
    onCandidateUpdated: (value) => updates.push(value)
  });
  await closed.open("candidate-1");
  await closed.fetchIdentityProfile(
    "https://www.douyin.com/user/MS4wLjABAAAA"
  );
  const staleConfirmation = closed.confirmCandidateIdentity({
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "已人工核验公开主页与原始需求信号一致。",
    evidenceIds: ["evidence-profile-1"]
  });
  closed.close();
  pendingConfirmation.resolve({
    candidate: unresolvedIndividualCandidate("candidate-1", {
      status: "normalized",
      version: 4,
      identityResolved: true,
      publicProfileUrl: "https://www.douyin.com/user/MS4wLjABAAAA"
    }),
    resolution: {
      status: "resolved",
      basis: "provider_public_actor",
      resolverVersion: "identity-resolver.v1",
      evidenceIds: ["evidence-profile-1"],
      resolvedAt: timestamp,
      resolvedBy: "actor-1"
    }
  });
  await staleConfirmation;

  assert.equal(closed.getState().open, false);
  assert.equal(assistantActions, 0);
  assert.deepEqual(updates, []);
});
