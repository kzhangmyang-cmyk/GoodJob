import assert from "node:assert/strict";
import test from "node:test";

import { renderCandidateList } from "./components/candidate-list.js";
import { renderConnectionRequired } from "./components/connection-required.js";
import { renderExecutiveSummary } from "./components/executive-summary.js";
import { renderPlanApproval } from "./components/plan-approval.js";
import { renderRunConsole } from "./components/run-console.js";
import { renderAdvisorShell } from "./components/shell.js";
import { renderTaskInput } from "./components/task-input.js";
import { industryTemplates } from "./templates.js";
import type {
  AdvisorMode,
  AdvisorStatus,
  CandidateCardVm,
  CandidateStatus,
  ExecutiveSummaryVm
} from "./types.js";

const noop = () => undefined;

const summary: ExecutiveSummaryVm = {
  sourcesSearched: 3,
  pagesAnalyzed: 18,
  organizationsFound: 7,
  dedupedCandidates: 5,
  validOpportunities: 3,
  highIntent: 2,
  financialEvaluatedHighIntentCount: 1,
  financialPendingHighIntentCount: 1,
  expectedRevenueByCurrency: [{
    currency: "CNY",
    amountMinor: 128_000,
    formatted: "¥1,280.00"
  }, {
    currency: "USD",
    amountMinor: 50_000,
    formatted: "US$500.00"
  }]
};

function candidate(
  status: CandidateStatus,
  overrides: Partial<CandidateCardVm> = {}
): CandidateCardVm {
  return {
    id: `candidate-${status}`,
    subjectKind: "organization",
    displayName: `远岚装备 ${status}`,
    industry: "装备制造",
    region: "上海",
    domain: null,
    status,
    version: 1,
    identityResolved: true,
    updatedAt: "2026-07-26T09:00:00.000Z",
    qualification: {
      id: `qualification-${status}`,
      candidateId: `candidate-${status}`,
      decisionVersion: "decision-v1",
      decisionEngine: "rules",
      grade: "A",
      score: 88,
      recommendedAction: "priority_review",
      evidence: [{ evidenceId: "evidence-1", excerpt: "公开招聘跨境运营岗位" }],
      positiveSignals: [{ name: "出口增长", score: 28 }],
      negativeSignals: [],
      reasons: ["公开信号与目标画像匹配"],
      confidence: 0.86,
      ruleVersion: "rules-v1",
      promptVersion: null,
      modelProvider: null,
      model: null,
      hardGateFailures: [],
      createdAt: "2026-07-26T09:00:00.000Z"
    },
    financialValue: { status: "pending", label: "待评估", amounts: [] },
    sourcePlatforms: ["百度公开搜索", "企业官网"],
    evidenceCount: 3,
    isHighIntent: true,
    isValidOpportunity: true,
    ...overrides
  };
}

function planDraftForTest() {
  return {
    name: "制造业商机搜索",
    objective: "寻找近期有采购需求的制造企业",
    icp: {
      industries: ["制造业"],
      regions: ["上海"],
      organizationCriteria: ["50 人以上"],
      individualCriteria: [],
      exclusionRules: ["勿扰名单"]
    },
    subjectChannels: { organization: true, individual: false },
    providerConnections: [{
      connectionId: "connection-1",
      providerId: "百度公开搜索",
      kind: "search" as const,
      status: "active" as const,
      credentialVersion: 1
    }],
    operations: [{
      operationId: "operation-1",
      subjectChannel: "organization" as const,
      kind: "search" as const,
      connectionId: "connection-1",
      query: "上海 制造业 采购需求",
      allocatedBudget: {
        requests: 10,
        results: 30,
        amountMinor: 500,
        durationSeconds: 60
      }
    }],
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 10,
      maxResults: 30,
      maxAmountMinor: 500,
      maxDurationSeconds: 60
    },
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    }
  };
}

test("shell keeps the command-center headline, explicit mode, and every state label", () => {
  const labels: Record<AdvisorStatus, string> = {
    idle: "等待任务",
    planning: "正在生成方案",
    awaiting_approval: "等待人工批准",
    running: "正在执行",
    paused: "已暂停",
    partial_success: "部分完成",
    completed: "已完成",
    cancelled: "已取消",
    connection_required: "需要配置连接",
    empty: "未发现符合条件的客户",
    failed: "执行失败"
  };

  for (const [status, label] of Object.entries(labels)) {
    const rendered = renderAdvisorShell({
      mode: status === "idle" ? "demo" : "real",
      status: status as AdvisorStatus,
      stageHtml: "<p>当前工作区</p>"
    }, { onContinue: noop });
    assert.match(rendered.html, /AI 正在为你发现全网商机/);
    assert.match(rendered.html, new RegExp(label));
    assert.match(
      rendered.html,
      new RegExp(status === "idle" ? "演示模式 · 演示数据" : "真实模式")
    );
    assert.match(rendered.html, /role="status"/);
  }
});

test("task input renders six templates, connections, recent work, and explicit modes", () => {
  const demo = renderTaskInput({
    mode: "demo",
    taskText: "寻找上海制造企业",
    targetPlatform: "douyin",
    templates: industryTemplates,
    selectedTemplateId: "enterprise-services",
    connections: [{
      providerId: "baidu",
      label: "百度公开搜索",
      status: "healthy",
      detail: "连接正常"
    }],
    recentTasks: [{
      id: "task-1",
      title: "上海制造企业",
      statusLabel: "等待人工批准",
      updatedAtLabel: "今天 09:30"
    }]
  }, {
    onModeChange: noop,
    onTargetPlatformChange: noop,
    onTaskTextChange: noop,
    onTemplateSelect: noop,
    onSubmit: noop,
    onContinueTask: noop
  });

  assert.match(demo.html, /演示模式 · 演示数据/);
  assert.match(demo.html, /真实模式/);
  assert.match(demo.html, /百度公开搜索/);
  assert.match(demo.html, /连接正常/);
  assert.match(demo.html, /继续任务/);
  for (const template of industryTemplates) {
    assert.match(demo.html, new RegExp(template.label));
  }
});

test("任务输入用原生按钮区分可选平台和待接入平台", () => {
  const rendered = renderTaskInput({
    mode: "real",
    taskText: "寻找有采购需求的公开线索",
    targetPlatform: "douyin",
    templates: industryTemplates,
    selectedTemplateId: "enterprise-services",
    connections: [],
    recentTasks: []
  } as never, {
    onModeChange: noop,
    onTargetPlatformChange: noop,
    onTaskTextChange: noop,
    onTemplateSelect: noop,
    onSubmit: noop,
    onContinueTask: noop
  } as never);

  assert.match(
    rendered.html,
    /data-platform="douyin"[^>]*aria-pressed="true"/
  );
  assert.match(
    rendered.html,
    /data-platform="web"[^>]*aria-pressed="false"/
  );
  for (const platform of ["快手", "微信公众号", "微博", "小红书"]) {
    assert.match(
      rendered.html,
      new RegExp(`<button[^>]*disabled[^>]*>[\\s\\S]*?${platform}[\\s\\S]*?待接入[\\s\\S]*?<\\/button>`)
    );
  }
  assert.doesNotMatch(rendered.html, /tabindex=/);
});

test("审批页分开目标内容平台与搜索服务商并说明公开索引边界", () => {
  const rendered = renderPlanApproval({
    mode: "real",
    approvalStatus: "awaiting_approval",
    targetPlatform: "douyin",
    plan: {
      ...planDraftForTest(),
      targetPlatform: "douyin"
    },
    targetProfile: "制造企业",
    companySize: "50 人以上",
    demandSignals: ["采购需求"],
    searchTopics: ["公开搜索"]
  } as never, { onApprove: noop, onEdit: noop, onCancel: noop });

  for (const text of [
    "目标内容平台",
    "抖音公开内容",
    "搜索服务商",
    "百度公开搜索",
    "公开索引页面",
    "不代表扫描抖音全站或全部评论"
  ]) {
    assert.match(rendered.html, new RegExp(text));
  }
});

test("approval renders the complete search plan and budget before execution", () => {
  const rendered = renderPlanApproval({
    mode: "real",
    approvalStatus: "awaiting_approval",
    targetPlatform: "douyin",
    plan: {
      name: "长三角制造企业增长机会",
      objective: "寻找近期有数字化采购需求的制造企业",
      icp: {
        industries: ["装备制造"],
        regions: ["上海", "苏州"],
        organizationCriteria: ["50 人以上"],
        individualCriteria: [],
        exclusionRules: ["勿扰名单", "无公开来源"]
      },
      subjectChannels: { organization: true, individual: false },
      providerConnections: [{
        connectionId: "connection-1",
        providerId: "百度公开搜索",
        kind: "search",
        status: "active",
        credentialVersion: 1
      }],
      operations: [{
        operationId: "operation-1",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "connection-1",
        query: "上海 制造企业 数字化采购",
        allocatedBudget: {
          requests: 20,
          results: 50,
          amountMinor: 1200,
          durationSeconds: 60
        }
      }],
      budgetSnapshot: {
        billingCurrency: "CNY",
        maxRequests: 20,
        maxResults: 50,
        maxAmountMinor: 1200,
        maxDurationSeconds: 60
      },
      stopConditions: {
        stopWhenBudgetExhausted: true,
        stopWhenNoMoreResults: true
      }
    },
    targetProfile: "有数字化采购需求的制造企业",
    companySize: "50 人以上",
    demandSignals: ["数字化采购", "系统升级"],
    searchTopics: ["公开招聘", "官网动态"]
  }, { onApprove: noop, onEdit: noop, onCancel: noop });

  for (const visible of [
    "等待人工批准",
    "真实模式",
    "装备制造",
    "上海",
    "苏州",
    "50 人以上",
    "数字化采购",
    "系统升级",
    "勿扰名单",
    "公开招聘",
    "官网动态",
    "百度公开搜索",
    "20 次请求",
    "50 条结果",
    "¥12.00",
    "60 秒"
  ]) {
    assert.match(rendered.html, new RegExp(visible));
  }
});

test("approval submission disables every plan action while the run starts", () => {
  const rendered = renderPlanApproval({
    mode: "real",
    approvalStatus: "submitting",
    targetPlatform: "web",
    plan: planDraftForTest(),
    targetProfile: "制造企业",
    companySize: "50 人以上",
    demandSignals: ["采购需求"],
    searchTopics: ["公开搜索"]
  }, { onApprove: noop, onEdit: noop, onCancel: noop });

  assert.match(rendered.html, /正在启动搜索/);
  assert.equal(
    [...rendered.html.matchAll(/<button[^>]*disabled/g)].length,
    3
  );
});

test("connection-required shows only configuration and demo choices, never fake progress", () => {
  const rendered = renderConnectionRequired({
    missingKinds: ["search"],
    message: "真实搜索来源尚未连接"
  }, {
    onConfigure: noop,
    onUseDemo: noop
  });

  assert.match(rendered.html, /配置搜索来源/);
  assert.match(rendered.html, /使用演示模式/);
  assert.doesNotMatch(rendered.html, /正在搜索|搜索进度|progress/);
});

test("candidate cards expose finance pending and actionable review states", () => {
  const statuses: CandidateStatus[] = [
    "pending_review",
    "approved",
    "rejected",
    "do_not_contact",
    "needs_research"
  ];
  const onPreviewReview = (_candidateId: string) => undefined;
  const rendered = renderCandidateList({
    mode: "real",
    candidates: statuses.map((status) => candidate(status))
  }, {
    onOpenBattleCard: noop,
    onPreviewReview,
    onApprove: noop,
    onReject: noop,
    onDoNotContact: noop,
    onRequestResearch: noop,
    onReopen: noop,
    onConvert: noop
  });
  assert.equal(rendered.callbacks.onPreviewReview, onPreviewReview);

  for (const visible of [
    "待人工审核",
    "已批准",
    "已拒绝",
    "勿扰",
    "需补充研究",
    "待评估",
    "先完成人工审核",
    "转为线索",
    "重新打开",
    "补充研究",
    "需求信号",
    "2 个来源",
    "3 条证据",
    "置信度 86%"
  ]) {
    assert.match(rendered.html, new RegExp(visible));
  }

  const approvedCard = rendered.html.match(
    /data-candidate-id="candidate-approved"[\s\S]*?<\/article>/
  )?.[0];
  assert.ok(approvedCard);
  assert.match(approvedCard, /data-action="convert"/);

  const pendingCard = rendered.html.match(
    /data-candidate-id="candidate-pending_review"[\s\S]*?<\/article>/
  )?.[0];
  assert.ok(pendingCard);
  assert.doesNotMatch(pendingCard, /data-action="convert"/);

  const rejectedCard = rendered.html.match(
    /data-candidate-id="candidate-rejected"[\s\S]*?<\/article>/
  )?.[0];
  const researchCard = rendered.html.match(
    /data-candidate-id="candidate-needs_research"[\s\S]*?<\/article>/
  )?.[0];
  const doNotContactCard = rendered.html.match(
    /data-candidate-id="candidate-do_not_contact"[\s\S]*?<\/article>/
  )?.[0];
  assert.ok(rejectedCard);
  assert.ok(researchCard);
  assert.ok(doNotContactCard);
  assert.match(rejectedCard, /data-action="reopen"/);
  assert.doesNotMatch(researchCard, /data-action="reopen"/);
  assert.doesNotMatch(doNotContactCard, /data-action="reopen"/);
});

test("unresolved candidate exposes identity verification as the primary action", () => {
  const rendered = renderCandidateList({
    mode: "real",
    candidates: [candidate("normalized", {
      id: "candidate-douyin-unresolved",
      subjectKind: "individual",
      identityResolved: false,
      displayName: "抖音公开需求信号",
      sourcePlatforms: ["douyin"],
      qualification: null,
      isHighIntent: false,
      isValidOpportunity: false
    })]
  }, {
    onOpenBattleCard: noop,
    onPreviewReview: noop,
    onApprove: noop,
    onReject: noop,
    onDoNotContact: noop,
    onRequestResearch: noop,
    onReopen: noop,
    onConvert: noop
  });

  assert.match(rendered.html, /主体待核实/);
  assert.match(rendered.html, /data-action="verify-identity"/);
  assert.match(rendered.html, />核验主体</);
  assert.doesNotMatch(rendered.html, /data-action="approve"/);
  assert.doesNotMatch(rendered.html, /data-action="convert"/);
});

test("partial runs distinguish successful, partially successful, and failed sources in text", () => {
  const rendered = renderRunConsole({
    mode: "real",
    status: "partial_success",
    timeline: [{
      id: "step-1",
      label: "读取公开搜索结果",
      state: "completed",
      detail: "已完成"
    }],
    queryStream: ["上海 制造企业 数字化采购"],
    providers: [{
      providerId: "百度公开搜索",
      status: "succeeded",
      acceptedResultCount: 6,
      failedResultCount: 0,
      errorCode: null
    }, {
      providerId: "企业官网公开页",
      status: "partial_success",
      acceptedResultCount: 2,
      failedResultCount: 1,
      errorCode: "RATE_LIMIT"
    }, {
      providerId: "行业目录",
      status: "failed",
      acceptedResultCount: 0,
      failedResultCount: 1,
      errorCode: "PROVIDER_UNAVAILABLE"
    }],
    candidates: [candidate("approved")]
  }, {
    onPause: noop,
    onResume: noop,
    onCancel: noop,
    candidateCallbacks: {
      onOpenBattleCard: noop,
      onPreviewReview: noop,
      onApprove: noop,
      onReject: noop,
      onDoNotContact: noop,
      onRequestResearch: noop,
      onReopen: noop,
      onConvert: noop
    }
  });

  assert.match(rendered.html, /部分完成/);
  assert.match(rendered.html, /成功来源/);
  assert.match(rendered.html, /百度公开搜索/);
  assert.match(rendered.html, /部分成功来源/);
  assert.match(rendered.html, /data-provider-state="partial"/);
  assert.match(rendered.html, /企业官网公开页/);
  assert.match(rendered.html, /失败或受限来源/);
  assert.match(rendered.html, /行业目录/);
  assert.match(rendered.html, /RATE_LIMIT/);
  assert.match(rendered.html, /PROVIDER_UNAVAILABLE/);
});

test("executive summary keeps currencies separate and gates conversion by mode and approval", () => {
  const cases: Array<{
    mode: AdvisorMode;
    topCandidate: CandidateCardVm;
    expected: RegExp;
    forbidden: RegExp;
  }> = [{
    mode: "demo",
    topCandidate: candidate("approved"),
    expected: /预览转为线索并创建跟进任务/,
    forbidden: /data-action="convert"/
  }, {
    mode: "real",
    topCandidate: candidate("pending_review"),
    expected: /先完成人工审核/,
    forbidden: /data-action="convert"/
  }, {
    mode: "real",
    topCandidate: candidate("approved"),
    expected: /data-action="convert"/,
    forbidden: /预览转为线索并创建跟进任务/
  }];

  for (const value of cases) {
    const rendered = renderExecutiveSummary({
      mode: value.mode,
      summary,
      topCandidate: value.topCandidate
    }, {
      onViewPriority: noop,
      onBuildBattleCard: noop,
      onPreviewConversion: noop,
      onConvert: noop
    });
    assert.match(rendered.html, /¥1,280.00/);
    assert.match(rendered.html, /US\$500.00/);
    assert.match(rendered.html, /金额按币种分别展示，不做汇率换算/);
    assert.match(rendered.html, value.expected);
    assert.doesNotMatch(rendered.html, value.forbidden);
  }
});
