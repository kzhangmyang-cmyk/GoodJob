import assert from "node:assert/strict";
import test from "node:test";

import type { AiGrowthApi, CopilotTaskDto, EvidenceDto } from "./api.js";
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
