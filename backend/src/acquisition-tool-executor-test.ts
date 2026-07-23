import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AcquisitionDomainError,
  AcquisitionDomainService,
  type LeadConversionPort
} from "./acquisition-domain-service.js";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import type {
  AcquisitionCandidate
} from "./acquisition-domain.js";
import type {
  AcquisitionAgentIdentity,
  AcquisitionAgentToolName
} from "./acquisition-pi-tools.js";
import {
  AcquisitionToolExecutorError,
  ProductionAcquisitionAgentToolExecutor,
  type AcquisitionCandidateDirectoryPort,
  type AcquisitionCandidateIndexEntry,
  type AcquisitionReviewTask,
  type AcquisitionReviewTaskPort,
  type SearchPublicSourceResult,
  type SearchPublicSourcesPort,
  type SearchPublicSourcesRequest,
  type SearchPublicSourcesResponse
} from "./acquisition-tool-executor.js";

const identity: AcquisitionAgentIdentity = {
  ownerId: "owner-1",
  teamId: "team-1",
  actorId: "actor-1",
  sessionId: "session-1"
};

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class TestCandidateDirectory implements AcquisitionCandidateDirectoryPort {
  private readonly byDedupeKey = new Map<string, AcquisitionCandidateIndexEntry>();
  private readonly byCandidateId = new Map<string, AcquisitionCandidateIndexEntry>();

  private scopeKey(scope: { ownerId: string; teamId: string }, value: string) {
    return `${scope.ownerId}\u0000${scope.teamId}\u0000${value}`;
  }

  async findByDedupeKey(
    scope: { ownerId: string; teamId: string },
    dedupeKey: string
  ) {
    return structuredClone(
      this.byDedupeKey.get(this.scopeKey(scope, dedupeKey)) ?? null
    );
  }

  async indexCandidate(entry: AcquisitionCandidateIndexEntry) {
    const copy = structuredClone(entry);
    this.byDedupeKey.set(
      this.scopeKey(entry, entry.dedupeKey),
      copy
    );
    this.byCandidateId.set(
      this.scopeKey(entry, entry.candidateId),
      copy
    );
  }

  async listCandidates(
    scope: { ownerId: string; teamId: string },
    input: {
      subjectKinds?: Array<"organization" | "individual">;
      limit: number;
    }
  ) {
    return [...this.byCandidateId.values()]
      .filter((entry) =>
        entry.ownerId === scope.ownerId
        && entry.teamId === scope.teamId
        && (!input.subjectKinds
          || input.subjectKinds.includes(entry.partyType))
      )
      .slice(0, input.limit)
      .map((entry) => structuredClone(entry));
  }
}

class TestReviewTaskPort implements AcquisitionReviewTaskPort {
  private readonly tasks = new Map<string, AcquisitionReviewTask>();
  private sequence = 0;

  private key(scope: { ownerId: string; teamId: string }, id: string) {
    return `${scope.ownerId}\u0000${scope.teamId}\u0000${id}`;
  }

  async create(input: Omit<AcquisitionReviewTask, "id" | "status" | "createdAt">) {
    const task: AcquisitionReviewTask = {
      ...structuredClone(input),
      id: `review-task-${++this.sequence}`,
      status: "pending",
      createdAt: "2026-07-24T02:00:00.000Z"
    };
    this.tasks.set(this.key(task, task.id), task);
    return structuredClone(task);
  }

  async get(
    scope: { ownerId: string; teamId: string },
    reviewTaskId: string
  ) {
    return structuredClone(
      this.tasks.get(this.key(scope, reviewTaskId)) ?? null
    );
  }

  approve(scope: { ownerId: string; teamId: string }, reviewTaskId: string) {
    const key = this.key(scope, reviewTaskId);
    const task = this.tasks.get(key);
    assert.ok(task);
    this.tasks.set(key, { ...task, status: "approved" });
  }
}

class TestSearchPort implements SearchPublicSourcesPort {
  readonly calls: SearchPublicSourcesRequest[] = [];

  async search(
    input: SearchPublicSourcesRequest
  ): Promise<SearchPublicSourcesResponse> {
    this.calls.push(structuredClone({
      ...input,
      signal: undefined
    }));
    if (input.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    if (input.providerConnectionId === "search-broken") {
      throw new Error("SECRET_API_KEY=must-not-leak");
    }
    const results: SearchPublicSourceResult[] = [
      {
        sourceUrl: "https://example.cn/company/growth",
        title: "厦门增长科技正在寻找获客系统",
        snippet: "公开采购需求：需要全网商机识别、客户评分和渠道 ROI。",
        publishedAt: "2026-07-23T03:00:00.000Z",
        locale: "zh-CN",
        rawArtifactHash: sha256("company-growth"),
        accessStatus: "indexed_summary",
        subject: {
          kind: "organization",
          name: "厦门增长科技有限公司",
          domain: "growth.example.cn",
          region: "福建厦门",
          creditCode: null,
          organizationId: "org-growth"
        }
      },
      {
        sourceUrl: "https://example.cn/profile/store-owner",
        title: "厦门门店主理人公开咨询获客方案",
        snippet: "正在比较获客系统，希望近期上线，关注投入产出。",
        publishedAt: "2026-07-23T04:00:00.000Z",
        locale: "zh-CN",
        rawArtifactHash: sha256("individual-store-owner"),
        accessStatus: "public_content",
        subject: {
          kind: "individual",
          publicActorKey: "public:store-owner",
          publicDisplayName: "厦门门店主理人",
          publicProfileUrl: "https://example.cn/profile/store-owner",
          sourcePlatform: "baidu",
          demandCategory: "获客系统",
          demandSummary: "正在比较获客系统，希望近期上线",
          locationHint: "厦门",
          buyingStage: "comparison",
          negativeSignals: [],
          individualPartyId: "individual-store-owner"
        }
      }
    ];
    return {
      providerConnectionId: input.providerConnectionId,
      provider: "baidu_ai_search",
      requestId: `request-${input.providerConnectionId}`,
      results: results.filter((result) =>
        input.subjectKinds.includes(result.subject.kind)
      )
    };
  }
}

function createHarness() {
  let id = 0;
  let tick = 0;
  const repository = new InMemoryAcquisitionDomainRepository();
  const converted: string[] = [];
  const leadConversionPort: LeadConversionPort = {
    async createLead(request) {
      converted.push(request.candidateId);
      return {
        leadId: `lead-${converted.length}`,
        partyRef: request.partyRef
      };
    }
  };
  const domain = new AcquisitionDomainService({
    repository,
    leadConversionPort,
    idFactory: (prefix) => `${prefix}-${++id}`,
    now: () =>
      new Date(Date.UTC(2026, 6, 24, 1, 0, tick++)).toISOString()
  });
  const search = new TestSearchPort();
  const directory = new TestCandidateDirectory();
  const reviews = new TestReviewTaskPort();
  const executor = new ProductionAcquisitionAgentToolExecutor({
    domain,
    search,
    candidateDirectory: directory,
    reviewTasks: reviews
  });
  return {
    repository,
    domain,
    search,
    directory,
    reviews,
    executor,
    converted
  };
}

async function execute(
  executor: ProductionAcquisitionAgentToolExecutor,
  toolName: AcquisitionAgentToolName,
  payload: Record<string, unknown>,
  idempotencyKey = `${toolName}:1`,
  overriddenIdentity = identity,
  signal?: AbortSignal
) {
  return executor.execute({
    identity: overriddenIdentity,
    toolName,
    toolCallId: `call:${toolName}`,
    idempotencyKey,
    payload,
    signal
  }) as Promise<Record<string, any>>;
}

async function discover(
  executor: ProductionAcquisitionAgentToolExecutor,
  providerConnectionIds = ["search-ok", "search-broken"],
  idempotencyKey = "search:1"
) {
  return execute(executor, "search_public_sources", {
    query: "厦门 获客系统 采购",
    providerConnectionIds,
    subjectKinds: ["organization", "individual"],
    maxResults: 10
  }, idempotencyKey);
}

test("searches authorized providers, survives a partial failure, and idempotently creates both candidate kinds", async () => {
  const { executor, search, domain } = createHarness();

  const first = await discover(executor);
  assert.equal(first.status, "partial");
  assert.equal(first.outreachExecuted, false);
  assert.equal(first.providerFailures.length, 1);
  assert.deepEqual(first.providerFailures[0], {
    providerConnectionId: "search-broken",
    errorCode: "SEARCH_PROVIDER_FAILED"
  });
  assert.equal(JSON.stringify(first).includes("must-not-leak"), false);
  assert.equal(first.candidates.length, 2);
  assert.deepEqual(
    new Set(first.candidates.map((item: any) => item.partyType)),
    new Set(["organization", "individual"])
  );
  assert.equal(first.evidence.length, 2);
  assert.equal(search.calls.length, 2);

  const replay = await discover(executor);
  assert.deepEqual(
    replay.candidates.map((item: any) => item.id),
    first.candidates.map((item: any) => item.id)
  );
  assert.deepEqual(
    replay.evidence.map((item: any) => item.id),
    first.evidence.map((item: any) => item.id)
  );
  const organization = await domain.getCandidate(
    {
      ownerId: identity.ownerId,
      teamId: identity.teamId,
      actorId: identity.actorId
    },
    first.candidates[0].id
  );
  assert.equal(organization.evidenceIds.length, 1);
});

test("maps all ten controlled tools to domain decisions, conservative drafts, review, and outcome feedback", async () => {
  const {
    executor,
    domain,
    reviews
  } = createHarness();
  const discovery = await discover(executor, ["search-ok"]);
  const organization = discovery.candidates.find(
    (item: any) => item.partyType === "organization"
  );
  assert.ok(organization);

  const evidence = await execute(executor, "get_candidate_evidence", {
    candidateId: organization.id
  });
  assert.equal(evidence.candidate.id, organization.id);
  assert.equal(evidence.evidence.length, 1);

  const research = await execute(executor, "research_candidate", {
    candidateId: organization.id,
    depth: "standard",
    researchQuestions: ["是否有公开采购信号？"]
  });
  assert.equal(research.mode, "conservative_rules");
  assert.equal(research.newEvidenceCount, 0);
  assert.equal(research.outreachExecuted, false);

  const qualification = await execute(executor, "qualify_candidate", {
    candidateId: organization.id,
    policyVersion: "qualification-rules.v1"
  });
  assert.equal(qualification.qualification.decisionEngine, "rules");
  assert.equal(qualification.candidate.status, "pending_review");
  assert.equal(qualification.outreachExecuted, false);

  const financial = await execute(executor, "estimate_financial_value", {
    candidateId: organization.id,
    currency: "CNY",
    policyVersion: "financial-rules.v1"
  });
  assert.equal(financial.persisted, true);
  assert.equal(financial.financialValue.currency, "CNY");

  const battleCard = await execute(executor, "build_battle_card", {
    candidateId: organization.id,
    templateVersion: "battle-card.v1"
  });
  assert.equal(battleCard.battleCard.candidateId, organization.id);
  assert.equal(battleCard.battleCard.modelProvider, "rules");

  const strategy = await execute(executor, "draft_connection_strategy", {
    candidateId: organization.id,
    targetRole: "老板",
    channels: ["public_reply", "enterprise_wechat", "email"]
  });
  assert.equal(strategy.requiresHumanReview, true);
  assert.equal(strategy.outreachExecuted, false);
  assert.deepEqual(
    strategy.drafts.map((item: any) => item.channel),
    ["public_reply", "enterprise_wechat", "email"]
  );

  const priority = await execute(executor, "list_priority_candidates", {
    subjectKinds: ["organization"],
    minimumGrade: "D",
    limit: 20
  });
  assert.equal(priority.candidates.length, 1);
  assert.equal(priority.candidates[0].candidate.id, organization.id);

  const review = await execute(executor, "create_review_task", {
    candidateId: organization.id,
    proposedAction: "convert",
    rationale: "资格与财务价值均已完成，提交人工复核。"
  });
  assert.equal(review.reviewTask.status, "pending");
  assert.equal(review.outreachExecuted, false);

  const scope = {
    ownerId: identity.ownerId,
    teamId: identity.teamId,
    actorId: identity.actorId
  };
  const decisionVersion = qualification.qualification.decisionVersion;
  await domain.reviewCandidate(scope, organization.id, {
    action: "approved",
    decisionVersion,
    reason: null,
    idempotencyKey: "human-review:approve"
  });
  await domain.convertCandidate(scope, organization.id, {
    decisionVersion,
    idempotencyKey: "human-convert:1"
  });
  reviews.approve(scope, review.reviewTask.id);

  const outcome = await execute(executor, "record_outcome", {
    candidateId: organization.id,
    reviewTaskId: review.reviewTask.id,
    outcome: "won",
    occurredAt: "2026-07-24T06:00:00.000Z",
    amount: 29800,
    currency: "CNY",
    notes: "客户已签约"
  });
  assert.equal(outcome.outcome.eventType, "won");
  assert.deepEqual(outcome.outcome.amount, {
    amountMinor: 2_980_000,
    currency: "CNY"
  });
  assert.equal(outcome.outreachExecuted, false);
});

test("enforces tenant isolation even when a candidate id is known", async () => {
  const { executor } = createHarness();
  const discovery = await discover(executor, ["search-ok"]);
  const candidateId = discovery.candidates[0].id;

  await assert.rejects(
    execute(executor, "get_candidate_evidence", {
      candidateId
    }, "intruder:get", {
      ownerId: "owner-2",
      teamId: "team-2",
      actorId: "actor-2",
      sessionId: "session-2"
    }),
    (error: unknown) =>
      error instanceof AcquisitionToolExecutorError
      && error.code === "RESOURCE_NOT_FOUND"
      && !error.message.includes(candidateId)
  );
});

test("returns stable non-secret errors for invalid payload, unknown tool, all-provider failure, and abort", async () => {
  const { executor } = createHarness();

  await assert.rejects(
    execute(executor, "search_public_sources", {
      query: "",
      providerConnectionIds: [],
      subjectKinds: [],
      maxResults: 0
    }),
    (error: unknown) =>
      error instanceof AcquisitionToolExecutorError
      && error.code === "INVALID_PAYLOAD"
      && error.message === "INVALID_PAYLOAD"
  );

  await assert.rejects(
    executor.execute({
      identity,
      toolName: "send_private_message" as AcquisitionAgentToolName,
      toolCallId: "call:unknown",
      idempotencyKey: "unknown:1",
      payload: {}
    }),
    (error: unknown) =>
      error instanceof AcquisitionToolExecutorError
      && error.code === "UNKNOWN_TOOL"
  );

  await assert.rejects(
    discover(executor, ["search-broken"], "search:all-failed"),
    (error: unknown) =>
      error instanceof AcquisitionToolExecutorError
      && error.code === "SEARCH_ALL_PROVIDERS_FAILED"
      && !error.message.includes("SECRET_API_KEY")
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    execute(executor, "search_public_sources", {
      query: "厦门 获客系统",
      providerConnectionIds: ["search-ok"],
      subjectKinds: ["organization"],
      maxResults: 10
    }, "search:aborted", identity, controller.signal),
    (error: unknown) =>
      error instanceof AcquisitionToolExecutorError
      && error.code === "ABORTED"
  );
});

test("rejects outcome recording unless the exact tenant review task was human-approved", async () => {
  const { executor } = createHarness();
  const discovery = await discover(executor, ["search-ok"]);
  const candidate = discovery.candidates[0];

  await assert.rejects(
    execute(executor, "record_outcome", {
      candidateId: candidate.id,
      reviewTaskId: "review-task-from-another-tenant",
      outcome: "contacted",
      occurredAt: "2026-07-24T06:00:00.000Z"
    }),
    (error: unknown) =>
      error instanceof AcquisitionToolExecutorError
      && error.code === "REVIEW_TASK_NOT_APPROVED"
  );
});

test("domain errors remain typed underneath the executor harness", () => {
  assert.equal(
    new AcquisitionDomainError("resource_not_found", "secret id", 404).code,
    "resource_not_found"
  );
});
