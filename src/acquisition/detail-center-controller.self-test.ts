import { strict as assert } from "node:assert";
import type { AcquisitionDetailApi } from "./detail-center-api";
import { createAcquisitionDetailCenterController } from "./detail-center-controller";

function detailEvent<T>(name: string, detail: T): Event {
  return new CustomEvent<T>(name, { detail });
}

type FakeListener = EventListenerOrEventListenerObject;

class FakeDialogRoot {
  hidden = true;
  open = false;
  ownerDocument: { activeElement: { focus(): void } | null };
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  private readonly listeners = new Map<string, Set<FakeListener>>();

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name))
  };

  constructor(activeElement: { focus(): void } | null) {
    this.ownerDocument = { activeElement };
  }

  addEventListener(type: string, listener: FakeListener) {
    const entries = this.listeners.get(type) ?? new Set<FakeListener>();
    entries.add(listener);
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: FakeListener) {
    this.listeners.get(type)?.delete(listener);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  contains() {
    return true;
  }

  querySelector() {
    return null;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.emit("close", { target: this });
  }

  emitClick(target: Record<string, unknown>) {
    this.emit("click", {
      target,
      preventDefault() {}
    });
  }

  nativeClose() {
    this.open = false;
    this.emit("close", { target: this });
  }

  private emit(type: string, event: Record<string, unknown>) {
    this.listeners.get(type)?.forEach((listener) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }
}

function fakeAction(dataset: Record<string, string>) {
  const action = {
    dataset,
    closest(selector: string) {
      return selector === "[data-acquisition-detail-action]" ? action : null;
    }
  };
  return action;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const taskDetail = {
  task: {
    planId: "plan-1",
    name: "抖音线索研判",
    platform: "douyin"
  },
  plan: { id: "plan-1", status: "approved" },
  latestRun: null,
  shards: [],
  presentation: null
};

{
  const oldTask = deferred<typeof taskDetail>();
  const newTask = deferred<typeof taskDetail>();
  const api = {
    getTask(planId: string) {
      return planId === "plan-old" ? oldTask.promise : newTask.promise;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  const oldRequest = controller.open("plan", "plan-old");
  const newRequest = controller.open("plan", "plan-new");
  newTask.resolve({
    ...taskDetail,
    plan: { ...taskDetail.plan, id: "plan-new" }
  });
  await newRequest;
  oldTask.resolve({
    ...taskDetail,
    plan: { ...taskDetail.plan, id: "plan-old" }
  });
  await oldRequest;

  assert.equal(controller.getState().detail?.plan.id, "plan-new");
  controller.destroy();
}

{
  const oldCandidate = deferred<Record<string, unknown>>();
  const newCandidate = deferred<Record<string, unknown>>();
  const api = {
    async getTask() {
      return taskDetail;
    },
    getCandidate(candidateId: string) {
      return candidateId === "candidate-old"
        ? oldCandidate.promise
        : newCandidate.promise;
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return null;
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews() {
      return { items: [], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      return null;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("candidates", "plan-1");
  const oldRequest = controller.selectCandidate("candidate-old");
  const newRequest = controller.selectCandidate("candidate-new");
  newCandidate.resolve({
    candidate: { id: "candidate-new", identityResolved: true },
    etag: null
  });
  await newRequest;
  oldCandidate.resolve({
    candidate: { id: "candidate-old", identityResolved: true },
    etag: null
  });
  await oldRequest;

  assert.equal(controller.getState().selectedCandidateId, "candidate-new");
  assert.equal(controller.getState().candidateDetail?.candidate?.id, "candidate-new");
  controller.destroy();
}

{
  const candidateLoads: string[] = [];
  const api = {
    async getTask() {
      return {
        ...taskDetail,
        presentation: {
          candidateEvents: [{
            eventId: "event-auto-1",
            candidateId: "candidate-auto-1",
            candidate: { id: "candidate-auto-1", displayName: "自动选中候选" },
            qualification: { grade: "A", reasons: ["明确需求"] }
          }],
          providers: [],
          summary: null,
          hasMore: false,
          nextAfter: null
        }
      };
    },
    async getCandidate(candidateId: string) {
      candidateLoads.push(candidateId);
      return {
        candidate: {
          id: candidateId,
          status: "pending_review",
          identityResolved: true,
          latestDecisionVersion: "decision-auto-1"
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return { grade: "A", reasons: ["明确需求"] };
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews() {
      return { items: [], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      return null;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("plan", "plan-1");
  controller.switchMode("candidates");
  await controller.whenIdle();

  assert.deepEqual(candidateLoads, ["candidate-auto-1"]);
  assert.equal(controller.getState().selectedCandidateId, "candidate-auto-1");
  assert.equal(controller.getState().candidateDetail?.candidate?.id, "candidate-auto-1");
  controller.destroy();
}

{
  let focusReturns = 0;
  const opener = { focus: () => { focusReturns += 1; } };
  const root = new FakeDialogRoot(opener);
  const body = { innerHTML: "" };
  const api = {
    async getTask() {
      return taskDetail;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    root: root as unknown as HTMLElement,
    body: body as unknown as HTMLElement
  });

  await controller.open("plan", "plan-1");
  assert.equal(root.open, true);
  assert.equal(root.hidden, false);
  assert.equal(root.attributes.get("aria-hidden"), "false");

  root.emitClick(fakeAction({
    acquisitionDetailAction: "switch-mode",
    mode: "candidates"
  }));
  assert.equal(controller.getState().mode, "candidates");

  root.emitClick(fakeAction({ acquisitionDetailAction: "close" }));
  assert.equal(root.open, false);
  assert.equal(root.hidden, true);
  assert.equal(focusReturns, 1);

  await controller.open("plan", "plan-1");
  root.nativeClose();
  assert.equal(root.hidden, true);
  assert.equal(focusReturns, 2, "native Escape close must return focus");

  controller.destroy();
}

{
  const eventTarget = new EventTarget();
  const requestedPlanIds: string[] = [];
  const api = {
    async getTask(planId: string) {
      requestedPlanIds.push(planId);
      return taskDetail;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget
  });

  eventTarget.dispatchEvent(detailEvent(
    "goodjob:acquisition-detail-open-requested",
    { mode: "plan", planId: "plan-1" }
  ));
  await controller.whenIdle();

  assert.deepEqual(requestedPlanIds, ["plan-1"]);
  assert.equal(controller.getState().mode, "plan");
  assert.equal(controller.getState().status, "ready");
  assert.equal(controller.getState().detail?.plan.id, "plan-1");

  controller.destroy();
}

{
  const eventTarget = new EventTarget();
  const changed: Array<Record<string, unknown>> = [];
  eventTarget.addEventListener("goodjob:acquisition-candidate-changed", (event) => {
    changed.push((event as CustomEvent<Record<string, unknown>>).detail);
  });
  const reviewKeys: string[] = [];
  let reviewAttempts = 0;
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "pending_review",
          identityResolved: true,
          latestDecisionVersion: "decision-v1"
        },
        etag: '"candidate-v1"'
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return { decisionVersion: "decision-v1", grade: "A" };
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews() {
      return { items: [], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      return null;
    },
    async reviewCandidate(
      candidateId: string,
      input: { action: string; decisionVersion: string; reason: string | null },
      idempotencyKey: string
    ) {
      assert.equal(candidateId, "candidate-review");
      assert.deepEqual(input, {
        action: "rejected",
        decisionVersion: "decision-v1",
        reason: "需要补充预算证据"
      });
      reviewKeys.push(idempotencyKey);
      reviewAttempts += 1;
      if (reviewAttempts === 1) throw new Error("审核网络失败");
      return { candidate: { id: candidateId }, review: { action: input.action }, research: null };
    }
  } as unknown as AcquisitionDetailApi;
  let keySerial = 0;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget,
    keyFactory: () => `review-key-${++keySerial}`
  });

  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-review");
  await assert.rejects(
    () => controller.reviewCandidate("rejected", "  "),
    /原因/
  );
  assert.equal(reviewAttempts, 0);
  assert.match(controller.getState().error ?? "", /原因/);

  await assert.rejects(
    () => controller.reviewCandidate("rejected", "需要补充预算证据"),
    /审核网络失败/
  );
  await controller.reviewCandidate("rejected", "需要补充预算证据");
  assert.equal(reviewKeys[0], reviewKeys[1]);
  assert.deepEqual(changed.at(-1), {
    planId: "plan-1",
    candidateId: "candidate-review",
    action: "rejected"
  });

  await controller.reviewCandidate("rejected", "需要补充预算证据");
  assert.notEqual(reviewKeys[1], reviewKeys[2]);

  controller.destroy();
}

{
  const started: string[] = [];
  const api = {
    async getTask() {
      return {
        ...taskDetail,
        presentation: {
          candidateEvents: [],
          providers: [],
          summary: null,
          hasMore: false,
          nextAfter: null
        }
      };
    },
    async getCandidate(candidateId: string) {
      started.push("candidate");
      return {
        candidate: {
          id: candidateId,
          status: "pending_review",
          identityResolved: true,
          latestDecisionVersion: "decision-v1"
        },
        etag: '"candidate-v1"'
      };
    },
    async getCandidateEvidence() {
      started.push("evidence");
      return { items: [{ id: "evidence-1" }], nextCursor: null };
    },
    async getCandidateQualification() {
      started.push("qualification");
      return { decisionVersion: "decision-v1", grade: "A" };
    },
    async getCandidateFinancialValue() {
      started.push("financial");
      return { expectedAmountMinor: 100_000, currency: "CNY" };
    },
    async getCandidateBattleCard() {
      started.push("battle-card");
      return { schemaVersion: "battle-card.v2" };
    },
    async getCandidateReviews() {
      started.push("reviews");
      return { items: [{ id: "review-1", action: "approved" }], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      started.push("intelligence-operation");
      return { id: "operation-1", status: "succeeded" };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-1");

  assert.deepEqual(started.sort(), [
    "battle-card",
    "candidate",
    "evidence",
    "financial",
    "intelligence-operation",
    "qualification",
    "reviews"
  ]);
  assert.equal(controller.getState().selectedCandidateId, "candidate-1");
  assert.equal(controller.getState().candidateDetail?.candidate?.id, "candidate-1");
  assert.equal(controller.getState().candidateDetail?.evidence.length, 1);
  assert.equal(controller.getState().candidateDetail?.reviews.length, 1);

  controller.destroy();
}

{
  const operationKeys: string[] = [];
  let operationAttempts = 0;
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "normalized",
          identityResolved: true,
          latestDecisionVersion: null
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return null;
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews() {
      return { items: [], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      return null;
    },
    async startIntelligenceOperation(candidateId: string, idempotencyKey: string) {
      assert.equal(candidateId, "candidate-ai");
      operationKeys.push(idempotencyKey);
      operationAttempts += 1;
      if (operationAttempts === 1) throw new Error("AI 任务创建失败");
      return { id: `operation-${operationAttempts}`, status: "queued" };
    }
  } as unknown as AcquisitionDetailApi;
  let keySerial = 0;
  const controller = createAcquisitionDetailCenterController({
    api,
    keyFactory: () => `operation-key-${++keySerial}`
  });

  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-ai");
  await assert.rejects(
    () => controller.startIntelligence(),
    /AI 任务创建失败/
  );
  await controller.startIntelligence();
  assert.equal(operationKeys[0], operationKeys[1]);
  await controller.startIntelligence();
  assert.notEqual(operationKeys[1], operationKeys[2]);

  controller.destroy();
}

{
  const presentationCalls: Array<{ runId: string; after?: string; limit?: number }> = [];
  const firstCandidateEvent = {
    eventId: "event-more-1",
    candidateId: "candidate-more-1",
    candidate: { id: "candidate-more-1", displayName: "首批候选" },
    qualification: null,
    financialValue: null,
    evidenceCount: 1
  };
  const api = {
    async getTask() {
      return {
        ...taskDetail,
        latestRun: {
          id: "run-more-1",
          status: "succeeded",
          updatedAt: "2026-08-07T10:00:00.000Z",
          completedAt: "2026-08-07T10:00:00.000Z",
          evidenceCount: 2,
          consumedBudget: {
            requests: 2,
            results: 2,
            amountMinor: 20,
            durationSeconds: 2
          }
        },
        presentation: {
          candidateEvents: [firstCandidateEvent],
          providers: [{ shardId: "shard-more-1" }],
          summary: { validOpportunities: 2 },
          hasMore: true,
          nextAfter: "candidate-cursor-1"
        }
      };
    },
    async getRunPresentation(
      runId: string,
      query?: { after?: string; limit?: number }
    ) {
      presentationCalls.push({ runId, ...query });
      return {
        run: {
          id: runId,
          status: "succeeded",
          etag: "run-more-etag",
          updatedAt: "2026-08-07T10:00:00.000Z",
          completedAt: "2026-08-07T10:00:00.000Z"
        },
        providers: [{
          shardId: "shard-more-2",
          connectionId: "connection-more-1",
          providerId: "baidu_ai_search",
          status: "succeeded",
          rawResultCount: 1,
          acceptedResultCount: 1,
          duplicateResultCount: 0,
          failedResultCount: 0,
          errorCode: null,
          retryAfterAt: null
        }],
        summary: {
          sourcesSearched: 1,
          pagesAnalyzed: 2,
          organizationsFound: 2,
          dedupedCandidates: 2,
          validOpportunities: 2,
          highIntent: 1,
          financialEvaluatedHighIntentCount: 0,
          financialPendingHighIntentCount: 1,
          expectedRevenueByCurrency: []
        },
        candidateEvents: [{
          ...firstCandidateEvent,
          eventId: "event-more-1-refreshed"
        }, {
          eventId: "event-more-2",
          candidateId: "candidate-more-2",
          candidate: { id: "candidate-more-2", displayName: "更多候选" },
          qualification: null,
          financialValue: null,
          evidenceCount: 1
        }],
        nextAfter: "",
        hasMore: false
      };
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "normalized",
          identityResolved: true,
          latestDecisionVersion: null
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return null;
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews() {
      return { items: [], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      return null;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("candidates", "plan-more-1");
  await controller.loadMoreCandidates();

  assert.deepEqual(presentationCalls, [{
    runId: "run-more-1",
    after: "candidate-cursor-1",
    limit: 100
  }]);
  assert.deepEqual(
    controller.getState().detail?.presentation?.candidateEvents.map(
      (event) => event.candidateId
    ),
    ["candidate-more-1", "candidate-more-2"]
  );
  assert.equal(controller.getState().detail?.presentation?.hasMore, false);
  controller.destroy();
}

{
  const evidenceCursors: Array<string | null> = [];
  const reviewCursors: Array<string | null> = [];
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "pending_review",
          identityResolved: true,
          latestDecisionVersion: "decision-page-1"
        },
        etag: null
      };
    },
    async getCandidateEvidence(
      _candidateId: string,
      query?: { cursor?: string; limit?: number }
    ) {
      evidenceCursors.push(query?.cursor ?? null);
      if (!query?.cursor) {
        return {
          items: [{ id: "evidence-page-1" }],
          nextCursor: "evidence-cursor-1"
        };
      }
      assert.equal(query.cursor, "evidence-cursor-1");
      return {
        items: [{ id: "evidence-page-2" }],
        nextCursor: "evidence-cursor-1"
      };
    },
    async getCandidateQualification() {
      return { decisionVersion: "decision-page-1", grade: "A" };
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews(
      _candidateId: string,
      query?: { cursor?: string; limit?: number }
    ) {
      reviewCursors.push(query?.cursor ?? null);
      if (!query?.cursor) {
        return {
          items: [{ id: "review-page-1", action: "approved" }],
          nextCursor: "review-cursor-1"
        };
      }
      assert.equal(query.cursor, "review-cursor-1");
      return {
        items: [{ id: "review-page-2", action: "rejected" }],
        nextCursor: null
      };
    },
    async getLatestIntelligenceOperation() {
      return null;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-pages");

  assert.deepEqual(evidenceCursors, [null, "evidence-cursor-1"]);
  assert.deepEqual(reviewCursors, [null, "review-cursor-1"]);
  assert.deepEqual(
    controller.getState().candidateDetail?.evidence.map((item) => item.id),
    ["evidence-page-1", "evidence-page-2"]
  );
  assert.deepEqual(
    controller.getState().candidateDetail?.reviews.map((item) => item.id),
    ["review-page-1", "review-page-2"]
  );
  controller.destroy();
}

{
  let evidencePage = 0;
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "pending_review",
          identityResolved: true,
          latestDecisionVersion: "decision-partial-1"
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      evidencePage += 1;
      if (evidencePage === 1) {
        return {
          items: [{ id: "evidence-preserved" }],
          nextCursor: "evidence-next"
        };
      }
      throw new Error("证据第二页暂不可用");
    },
    async getCandidateQualification() {
      return {
        decisionVersion: "decision-partial-1",
        grade: "A",
        reasons: ["资格研判已完成"]
      };
    },
    async getCandidateFinancialValue() {
      throw new Error("财务价值暂不可用");
    },
    async getCandidateBattleCard() {
      return { schemaVersion: "battle-card.v2", id: "battle-preserved" };
    },
    async getCandidateReviews() {
      throw new Error("审核记录暂不可用");
    },
    async getLatestIntelligenceOperation() {
      return { id: "operation-preserved", status: "succeeded" };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-partial");

  const loaded = controller.getState().candidateDetail;
  assert.equal(loaded?.candidate?.id, "candidate-partial");
  assert.deepEqual(loaded?.evidence.map((item) => item.id), [
    "evidence-preserved"
  ]);
  assert.equal(loaded?.qualification?.grade, "A");
  assert.equal(loaded?.financialValue, null);
  assert.equal(loaded?.battleCard?.id, "battle-preserved");
  assert.deepEqual(loaded?.reviews, []);
  assert.equal(loaded?.intelligenceOperation?.id, "operation-preserved");
  assert.match(controller.getState().error ?? "", /证据/);
  assert.match(controller.getState().error ?? "", /财务价值/);
  assert.match(controller.getState().error ?? "", /审核记录/);
  controller.destroy();
}

{
  const review = deferred<Record<string, unknown>>();
  const changed: Array<Record<string, unknown>> = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(
    "goodjob:acquisition-candidate-changed",
    (event) => changed.push(
      (event as CustomEvent<Record<string, unknown>>).detail
    )
  );
  const taskReads: string[] = [];
  const api = {
    async getTask(planId: string) {
      taskReads.push(planId);
      return {
        ...taskDetail,
        task: { ...taskDetail.task, planId },
        plan: { ...taskDetail.plan, id: planId }
      };
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "pending_review",
          identityResolved: true,
          latestDecisionVersion: `decision-${candidateId}`
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification(candidateId: string) {
      return { decisionVersion: `decision-${candidateId}`, grade: "A" };
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews() {
      return { items: [], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      return null;
    },
    reviewCandidate() {
      return review.promise;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget
  });

  await controller.open("candidates", "plan-old");
  await controller.selectCandidate("candidate-old");
  const staleMutation = controller.reviewCandidate("approved");
  controller.close();
  await controller.open("candidates", "plan-new");
  await controller.selectCandidate("candidate-new");
  review.resolve({ candidate: { id: "candidate-old" } });
  await staleMutation;

  assert.equal(controller.getState().detail?.plan.id, "plan-new");
  assert.equal(controller.getState().selectedCandidateId, "candidate-new");
  assert.equal(
    controller.getState().candidateDetail?.candidate?.id,
    "candidate-new"
  );
  assert.deepEqual(changed, []);
  assert.deepEqual(taskReads, ["plan-old", "plan-new"]);
  controller.destroy();
}

{
  const intelligence = deferred<Record<string, unknown>>();
  const changed: Array<Record<string, unknown>> = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(
    "goodjob:acquisition-candidate-changed",
    (event) => changed.push(
      (event as CustomEvent<Record<string, unknown>>).detail
    )
  );
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "normalized",
          identityResolved: true,
          latestDecisionVersion: null
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return null;
    },
    async getCandidateFinancialValue() {
      return null;
    },
    async getCandidateBattleCard() {
      return null;
    },
    async getCandidateReviews() {
      return { items: [], nextCursor: null };
    },
    async getLatestIntelligenceOperation() {
      return null;
    },
    startIntelligenceOperation() {
      return intelligence.promise;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget
  });

  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-intelligence-old");
  const staleMutation = controller.startIntelligence();
  await controller.selectCandidate("candidate-intelligence-new");
  intelligence.resolve({ id: "operation-old", status: "queued" });
  await staleMutation;

  assert.equal(
    controller.getState().candidateDetail?.candidate?.id,
    "candidate-intelligence-new"
  );
  assert.equal(controller.getState().message, null);
  assert.deepEqual(changed, []);
  controller.destroy();
}
