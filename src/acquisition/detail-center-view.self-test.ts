import { strict as assert } from "node:assert";
import type { AcquisitionTaskDetail } from "./runtime-api";
import {
  renderAcquisitionDetailCenter,
  type AcquisitionCandidateDetail,
  type AcquisitionDetailCenterState
} from "./detail-center-view";

const timestamp = "2026-08-07T05:00:00.000Z";

const detail: AcquisitionTaskDetail = {
  task: {
    id: "task-1",
    planId: "plan-1",
    name: "厦门装修商机",
    objective: "找到公开表达获客需求的装修企业",
    platform: "douyin",
    discoveryMethods: ["public_search"],
    planStatus: "approved",
    latestRun: {
      id: "run-1",
      status: "running",
      updatedAt: timestamp,
      completedAt: null,
      evidenceCount: 9,
      consumedBudget: {
        requests: 4,
        results: 12,
        amountMinor: 380,
        durationSeconds: 41
      }
    },
    updatedAt: timestamp
  },
  plan: {
    id: "plan-1",
    status: "approved",
    version: 3,
    approvedAt: timestamp,
    payload: {
      targetPlatform: "douyin",
      name: "厦门装修商机",
      objective: "识别近期公开表达获客困难的企业 <script>alert('plan')</script>",
      icp: {
        industries: ["装修", "企业服务"],
        regions: ["厦门"],
        organizationCriteria: ["正在招聘销售", "有公开获客痛点"],
        individualCriteria: ["企业负责人", "运营负责人"],
        exclusionRules: ["同行广告", "明确拒绝联系"]
      },
      subjectChannels: { organization: true, individual: true },
      providerConnections: [{
        connectionId: "search-main",
        providerId: "baidu_ai_search",
        kind: "search",
        status: "active",
        credentialVersion: 2
      }],
      operations: [{
        operationId: "douyin-organization-search",
        subjectChannel: "organization",
        kind: "search",
        connectionId: "search-main",
        query: "site:douyin.com 厦门 装修 获客难",
        allocatedBudget: {
          requests: 5,
          results: 50,
          amountMinor: 500,
          durationSeconds: 300
        }
      }, {
        operationId: "douyin-individual-search",
        subjectChannel: "individual",
        kind: "search",
        connectionId: "search-main",
        query: "site:iesdouyin.com 装修 老板 获客",
        allocatedBudget: {
          requests: 5,
          results: 50,
          amountMinor: 500,
          durationSeconds: 300
        }
      }],
      budgetSnapshot: {
        billingCurrency: "CNY",
        maxRequests: 10,
        maxResults: 100,
        maxAmountMinor: 1000,
        maxDurationSeconds: 600
      },
      modelSnapshotRef: {
        jobSnapshotId: "model-snapshot-1",
        connectionId: "model-main",
        credentialVersion: 4,
        provider: "zhipu",
        model: "glm-4.5",
        capabilitySnapshotHash: "sha256:capability",
        promptVersion: "qualification.zh-CN.v4",
        schemaVersion: "qualification-decision.v2",
        promptHash: "sha256:prompt",
        schemaHash: "sha256:schema"
      },
      stopConditions: {
        stopWhenBudgetExhausted: true,
        stopWhenNoMoreResults: true
      }
    }
  },
  latestRun: {
    id: "run-1",
    status: "running",
    updatedAt: timestamp,
    completedAt: null,
    evidenceCount: 9,
    consumedBudget: {
      requests: 4,
      results: 12,
      amountMinor: 380,
      durationSeconds: 41
    },
    etag: "\"run-1:2\""
  },
  shards: [{
    id: "shard-org",
    operationId: "douyin-organization-search",
    status: "succeeded",
    evidenceCount: 6
  }, {
    id: "shard-person",
    operationId: "douyin-individual-search",
    status: "running",
    evidenceCount: 3
  }],
  presentation: {
    providers: [{
      shardId: "shard-org",
      connectionId: "search-main",
      providerId: "baidu_ai_search",
      status: "succeeded",
      rawResultCount: 14,
      acceptedResultCount: 9,
      duplicateResultCount: 3,
      failedResultCount: 2,
      errorCode: null,
      retryAfterAt: null
    }],
    summary: {
      sourcesSearched: 2,
      pagesAnalyzed: 7,
      organizationsFound: 5,
      dedupedCandidates: 4,
      validOpportunities: 2,
      highIntent: 1,
      financialEvaluatedHighIntentCount: 1,
      financialPendingHighIntentCount: 0,
      expectedRevenueByCurrency: [{ currency: "CNY", amountMinor: 1_288_000 }]
    },
    candidateEvents: [{
      eventId: "event-org",
      createdAt: timestamp,
      candidateId: "candidate-org",
      candidate: {
        id: "candidate-org",
        subjectKind: "organization",
        displayName: "鹭岛装修 <img src=x onerror=alert(1)>",
        industry: "装修",
        region: "厦门",
        domain: "https://example.invalid",
        status: "pending_review",
        version: 2,
        identityResolved: true,
        updatedAt: timestamp
      },
      qualification: {
        id: "qualification-org",
        candidateId: "candidate-org",
        decisionVersion: "qualification-v2",
        decisionEngine: "model",
        grade: "S",
        score: 94,
        recommendedAction: "priority_review",
        evidence: [{
          evidenceId: "evidence-1",
          excerpt: "公开视频提到获客成本持续上升"
        }],
        positiveSignals: [{ name: "明确获客痛点", score: 25 }],
        negativeSignals: [{ name: "价格敏感", score: -4 }],
        reasons: ["证据 evidence-1 表明正在比较方案"],
        confidence: 0.91,
        ruleVersion: "rules-v3",
        promptVersion: "qualification.zh-CN.v4",
        modelProvider: "zhipu",
        model: "glm-4.5",
        hardGateFailures: [],
        createdAt: timestamp
      },
      financialValue: {
        id: "financial-org",
        candidateId: "candidate-org",
        qualificationDecisionId: "qualification-org",
        version: "financial-v1",
        grade: "A",
        score: 87,
        currency: "CNY",
        expectedRevenueMinor: 1_288_000,
        expectedGrossProfitMinor: 640_000,
        expectedContributionMinor: 420_000,
        factors: {
          profitability: 80,
          cashFlow: 70,
          creditQuality: 75,
          repeatPotential: 68,
          referralPotential: 62,
          closeProbability: 72
        },
        createdAt: timestamp
      },
      sourcePlatforms: ["douyin", "baidu_ai_search"],
      evidenceCount: 4
    }, {
      eventId: "event-person",
      createdAt: timestamp,
      candidateId: "candidate-person",
      candidate: {
        id: "candidate-person",
        subjectKind: "individual",
        displayName: "陈经理",
        industry: "装修",
        region: "厦门",
        domain: null,
        status: "qualified",
        version: 1,
        identityResolved: true,
        updatedAt: timestamp
      },
      qualification: {
        id: "qualification-person",
        candidateId: "candidate-person",
        decisionVersion: "qualification-v1",
        decisionEngine: "rules",
        grade: "B",
        score: 72,
        recommendedAction: "public_response",
        evidence: [],
        positiveSignals: [],
        negativeSignals: [],
        reasons: ["行业与地区匹配"],
        confidence: 0.73,
        ruleVersion: "rules-v3",
        promptVersion: null,
        modelProvider: null,
        model: null,
        hardGateFailures: ["identity_unresolved"],
        createdAt: timestamp
      },
      financialValue: null,
      sourcePlatforms: ["douyin"],
      evidenceCount: 1
    }],
    nextAfter: "cursor-next",
    hasMore: true
  }
};

const candidateDetail: AcquisitionCandidateDetail = {
  candidate: {
    id: "candidate-org",
    subjectKind: "organization",
    name: "鹭岛装修",
    status: "pending_review",
    version: 2,
    identityResolved: true
  },
  evidence: [{
    id: "evidence-1",
    sourceTitle: "公开短视频",
    sourcePlatform: "douyin",
    sourceSnippet: "公开提到获客成本上升 <script>alert('evidence')</script>",
    publishedAt: timestamp
  }],
  qualification: {
    id: "qualification-org",
    decisionEngine: "model",
    grade: "S",
    score: 94,
    reasons: ["证据充分 <script>alert('reason')</script>"],
    positiveSignals: [{ name: "明确获客痛点", score: 25 }],
    negativeSignals: [{ name: "价格敏感", score: -4 }],
    hardGateFailures: ["stale_evidence"],
    confidence: 0.91,
    modelProvider: "zhipu",
    model: "glm-4.5"
  },
  financialValue: {
    grade: "A",
    score: 87,
    currency: "CNY",
    expectedRevenueMinor: 1_288_000,
    expectedGrossProfitMinor: 640_000,
    expectedContributionMinor: 420_000,
    factors: {
      profitability: 80,
      cashFlow: 70,
      creditQuality: 75,
      repeatPotential: 68,
      referralPotential: 62,
      closeProbability: 72
    }
  },
  battleCard: {
    schemaVersion: "battle-card.v1",
    sections: [{
      label: "推荐切入点",
      kind: "inference",
      content: "先提供行业获客诊断，再讨论产品方案"
    }]
  },
  reviews: [{
    id: "review-1",
    action: "rejected",
    reason: "此前证据不足",
    reviewerId: "reviewer-1",
    createdAt: timestamp
  }],
  intelligenceOperation: null
};

function state(
  overrides: Partial<AcquisitionDetailCenterState> = {}
): AcquisitionDetailCenterState {
  return {
    mode: "plan",
    status: "ready",
    detail,
    selectedCandidateId: null,
    candidateDetail: null,
    message: null,
    error: null,
    ...overrides
  };
}

{
  const html = renderAcquisitionDetailCenter(state({ mode: "plan" }));

  assert.match(html, /计划详情/);
  assert.match(html, /识别近期公开表达获客困难的企业/);
  assert.match(html, /装修/);
  assert.match(html, /厦门/);
  assert.match(html, /企业负责人/);
  assert.match(html, /同行广告/);
  assert.match(html, /site:douyin\.com 厦门 装修 获客难/);
  assert.match(html, /10 次请求/);
  assert.match(html, /100 条结果/);
  assert.match(html, /智谱 AI/);
  assert.match(html, /glm-4\.5/);
  assert.match(html, /百度 AI 搜索/);
  assert.match(html, /运行中/);
  assert.match(html, /douyin-organization-search/);
  assert.match(html, /已完成/);
  assert.match(html, /data-acquisition-detail-action="switch-mode"/);
  assert.match(html, /id="acquisition-detail-tab-plan"/);
  assert.match(html, /aria-controls="acquisition-detail-panel-plan"/);
  assert.match(html, /id="acquisition-detail-panel-plan"/);
  assert.match(html, /aria-labelledby="acquisition-detail-tab-plan"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    mode: "candidates",
    selectedCandidateId: "candidate-org",
    candidateDetail
  }));

  assert.match(html, /候选研判/);
  assert.match(html, /已分析页面[^<]*7/);
  assert.match(html, /有效商机[^<]*2/);
  assert.match(html, /高意向[^<]*1/);
  assert.match(html, /鹭岛装修/);
  assert.match(html, /企业主体/);
  assert.match(html, /意向等级 S/);
  assert.match(html, /94 分/);
  assert.match(html, /AI 模型研判/);
  assert.match(html, /4 条证据/);
  assert.match(html, /财务等级 A/);
  assert.match(html, /陈经理/);
  assert.match(html, /个人主体/);
  assert.match(html, /规则引擎研判/);
  assert.match(html, /资格理由/);
  assert.match(html, /明确获客痛点/);
  assert.match(html, /价格敏感/);
  assert.match(html, /证据时效已过/);
  assert.match(html, /预计收入/);
  assert.match(html, /¥12,880\.00/);
  assert.match(html, /<dt>盈利能力<\/dt><dd>80%<\/dd>/);
  assert.match(html, /<dt>现金流<\/dt><dd>70%<\/dd>/);
  assert.match(html, /<dt>信用质量<\/dt><dd>75%<\/dd>/);
  assert.match(html, /<dt>成交概率<\/dt><dd>72%<\/dd>/);
  assert.doesNotMatch(html, /8000%|7000%|7500%|7200%/);
  assert.match(html, /id="acquisition-detail-tab-candidates"/);
  assert.match(html, /aria-controls="acquisition-detail-panel-candidates"/);
  assert.match(html, /id="acquisition-detail-panel-candidates"/);
  assert.match(html, /aria-labelledby="acquisition-detail-tab-candidates"/);
  assert.match(html, /公开证据链/);
  assert.match(html, /公开短视频/);
  assert.match(html, /公开提到获客成本上升/);
  assert.match(html, /客户作战建议/);
  assert.match(html, /先提供行业获客诊断/);
  assert.match(html, /人工审核/);
  assert.match(html, /data-review-action="approved"/);
  assert.match(html, /data-review-action="rejected"/);
  assert.match(html, /data-review-action="needs_research"/);
  assert.match(html, /data-review-action="do_not_contact"/);
  assert.match(html, /审核历史/);
  assert.match(html, /此前证据不足/);
  assert.match(html, /data-review-action="approved"[^>]*disabled/);
  assert.doesNotMatch(html, /data-acquisition-detail-action="start-intelligence"/);
  assert.match(html, /data-acquisition-detail-action="select-candidate"/);
  assert.match(html, /data-acquisition-detail-action="load-more-candidates"/);
  assert.match(html, /加载更多候选/);
  assert.match(html, /data-candidate-id="candidate-org"/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    mode: "candidates",
    selectedCandidateId: "candidate-org",
    candidateDetail: {
      ...candidateDetail,
      candidate: {
        ...candidateDetail.candidate,
        status: "normalized",
        identityResolved: true,
        latestDecisionVersion: null
      },
      qualification: null,
      financialValue: null,
      battleCard: null,
      reviews: []
    }
  }));
  assert.match(html, /尚未完成 AI 资格研判/);
  assert.match(html, /data-acquisition-detail-action="start-intelligence"/);
  assert.doesNotMatch(html, /data-review-action="approved"/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    mode: "candidates",
    selectedCandidateId: "candidate-org",
    candidateDetail: {
      ...candidateDetail,
      candidate: {
        ...candidateDetail.candidate,
        status: "rejected",
        latestDecisionVersion: "qualification-v2"
      },
      qualification: {
        ...candidateDetail.qualification,
        hardGateFailures: []
      }
    }
  }));
  assert.match(html, /data-review-action="reopen"/);
  assert.match(html, /重新进入研判/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    status: "loading",
    detail: null,
    message: "正在读取真实任务详情"
  }));
  assert.match(html, /正在读取真实任务详情/);
  assert.match(html, /aria-busy="true"/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    status: "error",
    detail: null,
    error: "加载失败 <script>alert('error')</script>"
  }));
  assert.match(html, /任务详情加载失败/);
  assert.match(html, /data-acquisition-detail-action="retry"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    mode: "candidates",
    selectedCandidateId: "candidate-org",
    candidateDetail,
    message: "部分资料暂不可用，已保留成功加载的数据",
    error: "财务价值加载失败 <script>alert('partial')</script>"
  }));
  assert.match(html, /部分资料暂不可用/);
  assert.match(html, /财务价值加载失败/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    mode: "candidates",
    detail: { ...detail, latestRun: null, presentation: null }
  }));
  assert.match(html, /任务尚未运行/);
  assert.match(html, /启动真实运行后/);
}

{
  const html = renderAcquisitionDetailCenter(state({
    mode: "candidates",
    detail: {
      ...detail,
      presentation: detail.presentation && {
        ...detail.presentation,
        candidateEvents: []
      }
    }
  }));
  assert.match(html, /运行中，尚未形成候选/);
  assert.match(html, /已发现 9 条公开证据/);
}

console.log("Acquisition detail center view self-test passed");
