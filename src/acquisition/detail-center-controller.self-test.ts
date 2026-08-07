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

class ManualPollScheduler {
  private nextId = 1;
  private readonly entries = new Map<number, {
    callback: () => void;
    delay: number;
  }>();

  schedule = (callback: () => void, delay: number): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.entries.set(id, { callback, delay });
    return id;
  };

  cancel = (handle: unknown): void => {
    if (typeof handle === "number") this.entries.delete(handle);
  };

  pendingCount(): number {
    return this.entries.size;
  }

  nextDelay(): number | null {
    return this.entries.values().next().value?.delay ?? null;
  }

  runNext(): void {
    const entry = this.entries.entries().next().value as
      | [number, { callback: () => void; delay: number }]
      | undefined;
    if (!entry) throw new Error("没有待执行的轮询任务");
    this.entries.delete(entry[0]);
    entry[1].callback();
  }
}

class MemorySessionStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
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
  const storage = new MemorySessionStorage();
  const handoffKeys: string[] = [];
  let handoffAttempts = 0;
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "approved",
          identityResolved: true,
          latestDecisionVersion: "qualification-v2",
          approvedDecisionVersion: "qualification-v2"
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return { grade: "S", score: 94, hardGateFailures: [] };
    },
    async getCandidateFinancialValue() {
      return { currency: "CNY", expectedRevenueMinor: 1_288_000 };
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
    async getCandidatePrivateDomainHandoff() {
      return null;
    },
    async handoffCandidate(_candidateId: string, _input: unknown, key: string) {
      handoffKeys.push(key);
      handoffAttempts += 1;
      if (handoffAttempts === 1) throw new Error("CRM 暂时不可用");
      return {
        replayed: false,
        handoff: {
          id: "ach-1",
          candidateId: "candidate-approved",
          leadId: "lead-1",
          customerId: "customer-1",
          todoId: "todo-1",
          decisionVersion: "qualification-v2",
          createdAt: "2026-08-07T08:00:00.000Z"
        },
        lead: { id: "lead-1" },
        customer: { id: "customer-1" },
        todo: { id: "todo-1", dueAt: "2026-08-08T09:00:00.000Z" },
        intelligence: {
          qualificationGrade: "S",
          qualificationScore: 94,
          financialGrade: "A",
          currency: "CNY",
          expectedRevenueMinor: 1_288_000,
          expectedGrossProfitMinor: 708_400,
          expectedContributionMinor: 520_000
        }
      };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    storage,
    keyFactory: () => "handoff-stable-key"
  });
  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-approved");
  controller.openPrivateDomainHandoff();
  const input = {
    mode: "create_new" as const,
    existingCustomerId: "",
    followUp: {
      title: "首次跟进：确认需求和预算",
      dueAt: "2026-08-08T09:00:00.000Z",
      priority: "high" as const
    }
  };
  await assert.rejects(
    () => controller.handoffCandidate(input),
    /CRM 暂时不可用/
  );
  assert.equal(controller.getState().handoffDialog?.open, true);
  assert.equal(controller.getState().handoffDialog?.followUp.dueAt, input.followUp.dueAt);
  assert.equal(storage.values.size, 1);
  await controller.handoffCandidate(input);
  assert.deepEqual(handoffKeys, ["handoff-stable-key", "handoff-stable-key"]);
  assert.equal(storage.values.size, 0);
  const completedHandoff = controller.getState().candidateDetail
    ?.privateDomainHandoff;
  assert.ok(completedHandoff && "handoff" in completedHandoff);
  assert.equal(completedHandoff.handoff.customerId, "customer-1");
  assert.equal(controller.getState().handoffDialog, null);
  controller.destroy();
}

{
  const restoredRequest = {
    operationCode: "handoff_acquisition_candidate_v1" as const,
    decisionVersion: "qualification-v2",
    mode: "link_existing" as const,
    existingCustomerId: "customer-original-target",
    followUp: {
      title: "原始刷新跟进",
      dueAt: "2026-08-09T10:30:00.000Z",
      priority: "medium" as const
    }
  };
  const submitted: Array<{ input: unknown; key: string }> = [];
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "approved",
          identityResolved: true,
          latestDecisionVersion: "qualification-v2",
          approvedDecisionVersion: "qualification-v2"
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return { grade: "S", score: 94, hardGateFailures: [] };
    },
    async getCandidateFinancialValue() {
      return { currency: "CNY", expectedRevenueMinor: 1_288_000 };
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
    async getCandidatePrivateDomainHandoff() {
      return {
        replayed: false,
        inProgress: {
          id: "ach-operation-refresh",
          candidateId: "candidate-refresh",
          decisionVersion: restoredRequest.decisionVersion,
          mode: restoredRequest.mode,
          existingCustomerId: restoredRequest.existingCustomerId,
          stage: "customer_ready",
          request: restoredRequest,
          createdAt: "2026-08-07T08:00:00.000Z"
        }
      };
    },
    async handoffCandidate(_candidateId: string, input: unknown, key: string) {
      submitted.push({ input, key });
      return {
        replayed: false,
        handoff: {
          id: "ach-refresh",
          candidateId: "candidate-refresh",
          leadId: "lead-refresh",
          customerId: "customer-original-target",
          todoId: "todo-refresh",
          decisionVersion: "qualification-v2",
          createdAt: "2026-08-07T08:01:00.000Z"
        },
        lead: { id: "lead-refresh" },
        customer: { id: "customer-original-target" },
        todo: {
          id: "todo-refresh",
          dueAt: restoredRequest.followUp.dueAt
        },
        intelligence: {
          qualificationGrade: "S",
          qualificationScore: 94,
          financialGrade: "A",
          currency: "CNY",
          expectedRevenueMinor: 1_288_000,
          expectedGrossProfitMinor: 708_400,
          expectedContributionMinor: 520_000
        }
      };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    storage: new MemorySessionStorage(),
    keyFactory: () => "handoff-refresh-key"
  });

  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-refresh");
  controller.openPrivateDomainHandoff();
  assert.deepEqual(controller.getState().handoffDialog, {
    open: true,
    busy: false,
    recovering: true,
    mode: "link_existing",
    existingCustomerId: "customer-original-target",
    followUp: restoredRequest.followUp
  });
  await controller.handoffCandidate({
    mode: "link_existing",
    existingCustomerId: "customer-original-target",
    followUp: restoredRequest.followUp
  });
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0]?.input, restoredRequest);
  assert.equal(submitted[0]?.key, "handoff-refresh-key");
  controller.destroy();
}

{
  const pending = deferred<any>();
  const api = {
    async getTask() {
      return taskDetail;
    },
    async getCandidate(candidateId: string) {
      return {
        candidate: {
          id: candidateId,
          status: "approved",
          identityResolved: true,
          latestDecisionVersion: "qualification-v2",
          approvedDecisionVersion: "qualification-v2"
        },
        etag: null
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return { grade: "S", hardGateFailures: [] };
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
    async getCandidatePrivateDomainHandoff() {
      return null;
    },
    handoffCandidate() {
      return pending.promise;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    keyFactory: () => "handoff-race-key"
  });
  await controller.open("candidates", "plan-1");
  await controller.selectCandidate("candidate-old");
  controller.openPrivateDomainHandoff();
  const oldRequest = controller.handoffCandidate({
    mode: "create_new",
    existingCustomerId: "",
    followUp: {
      title: "首次跟进",
      dueAt: "2026-08-08T09:00:00.000Z",
      priority: "high"
    }
  });
  await controller.selectCandidate("candidate-new");
  pending.resolve({
    replayed: false,
    handoff: {
      id: "ach-old",
      candidateId: "candidate-old",
      leadId: "lead-old",
      customerId: "customer-old",
      todoId: "todo-old",
      decisionVersion: "qualification-v2",
      createdAt: "2026-08-07T08:00:00.000Z"
    },
    lead: { id: "lead-old" },
    customer: { id: "customer-old" },
    todo: { id: "todo-old" },
    intelligence: {
      qualificationGrade: "S",
      qualificationScore: 94,
      financialGrade: "A",
      currency: "CNY",
      expectedRevenueMinor: 0,
      expectedGrossProfitMinor: 0,
      expectedContributionMinor: 0
    }
  });
  await oldRequest;
  assert.equal(controller.getState().selectedCandidateId, "candidate-new");
  assert.equal(
    controller.getState().candidateDetail?.privateDomainHandoff,
    null
  );
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

// Catches an older in-flight poll rolling a run back after a later candidate
// refresh has already observed the terminal state.
{
  const scheduler = new ManualPollScheduler();
  const stalePoll = deferred<Record<string, unknown>>();
  let taskReads = 0;
  const candidateId = "candidate-freshness";
  const detailAt = (status: "running" | "succeeded", updatedAt: string) => ({
    ...taskDetail,
    latestRun: {
      id: "run-freshness",
      status,
      etag: status === "running" ? '"run-freshness:1"' : '"run-freshness:2"',
      updatedAt,
      completedAt: status === "succeeded" ? updatedAt : null,
      evidenceCount: status === "succeeded" ? 4 : 1,
      consumedBudget: {
        requests: status === "succeeded" ? 4 : 1,
        results: status === "succeeded" ? 3 : 1,
        amountMinor: 0,
        durationSeconds: status === "succeeded" ? 8 : 1
      }
    },
    presentation: {
      candidateEvents: [{
        eventId: "event-freshness",
        candidateId,
        candidate: { id: candidateId, displayName: "时序候选" }
      }],
      providers: [],
      summary: { validOpportunities: 1 },
      hasMore: false,
      nextAfter: null
    }
  });
  const api = {
    getTask() {
      taskReads += 1;
      if (taskReads === 2) return stalePoll.promise;
      return Promise.resolve(taskReads >= 3
        ? detailAt("succeeded", "2026-08-07T17:02:00.000Z")
        : detailAt("running", "2026-08-07T17:00:00.000Z"));
    },
    async getCandidate() {
      return {
        candidate: {
          id: candidateId,
          status: "pending_review",
          identityResolved: true,
          latestDecisionVersion: "decision-freshness"
        },
        etag: '"candidate-freshness:1"'
      };
    },
    async getCandidateEvidence() {
      return { items: [], nextCursor: null };
    },
    async getCandidateQualification() {
      return { decisionVersion: "decision-freshness", grade: "A" };
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
    async reviewCandidate() {
      return { candidate: { id: candidateId }, review: {}, research: null };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("candidates", "plan-1");
  scheduler.runNext();
  await controller.reviewCandidate("approved");
  assert.equal(controller.getState().detail?.latestRun?.status, "succeeded");

  stalePoll.resolve(detailAt("running", "2026-08-07T17:00:00.000Z"));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(controller.getState().detail?.latestRun?.status, "succeeded");
  assert.equal(controller.getState().detail?.latestRun?.evidenceCount, 4);
  assert.equal(scheduler.pendingCount(), 0);
  controller.destroy();
}

// Catches a closed dialog carrying a previous page-load spinner into the next
// plan after the stale response is intentionally ignored.
{
  const scheduler = new ManualPollScheduler();
  const oldPage = deferred<Record<string, unknown>>();
  const api = {
    async getTask(planId: string) {
      if (planId === "plan-new-after-page") {
        return {
          ...taskDetail,
          plan: { ...taskDetail.plan, id: planId },
          latestRun: null,
          presentation: null
        };
      }
      return {
        ...taskDetail,
        plan: { ...taskDetail.plan, id: planId },
        latestRun: {
          id: "run-close-page",
          status: "running" as const,
          etag: '"run-close-page:1"',
          updatedAt: "2026-08-07T16:00:00.000Z",
          completedAt: null,
          evidenceCount: 1,
          consumedBudget: {
            requests: 1,
            results: 1,
            amountMinor: 0,
            durationSeconds: 1
          }
        },
        presentation: {
          candidateEvents: [{
            eventId: "event-close-page",
            candidateId: "candidate-close-page",
            candidate: { id: "candidate-close-page", displayName: "旧计划候选" }
          }],
          providers: [],
          summary: { validOpportunities: 1 },
          hasMore: true,
          nextAfter: "cursor-close-page"
        }
      };
    },
    getRunPresentation() {
      return oldPage.promise;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-old-page");
  const oldPageRequest = controller.loadMoreCandidates();
  assert.equal(controller.getState().loadingMoreCandidates, true);
  controller.close();
  await controller.open("plan", "plan-new-after-page");
  assert.equal(controller.getState().loadingMoreCandidates, false);

  oldPage.resolve({
    run: {},
    providers: [],
    summary: {},
    candidateEvents: [],
    hasMore: false,
    nextAfter: null
  });
  await oldPageRequest;
  assert.equal(controller.getState().detail?.plan.id, "plan-new-after-page");
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

{
  const startKeys: string[] = [];
  const refreshes: Array<Record<string, unknown>> = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(
    "goodjob:acquisition-refresh-requested",
    (event) => refreshes.push(
      (event as CustomEvent<Record<string, unknown>>).detail
    )
  );
  let createAttempts = 0;
  let taskReads = 0;
  const completedRun = {
    id: "run-start-1",
    status: "succeeded" as const,
    etag: '"run-start-1:2"',
    updatedAt: "2026-08-07T12:00:00.000Z",
    completedAt: "2026-08-07T12:00:00.000Z",
    evidenceCount: 4,
    consumedBudget: {
      requests: 2,
      results: 4,
      amountMinor: 40,
      durationSeconds: 12
    }
  };
  const api = {
    async getTask() {
      taskReads += 1;
      return taskReads === 1
        ? taskDetail
        : { ...taskDetail, latestRun: completedRun };
    },
    async createRun(
      planId: string,
      input: { reason?: string },
      idempotencyKey: string
    ) {
      assert.equal(planId, "plan-1");
      assert.deepEqual(input, { reason: "开始公开检索" });
      startKeys.push(idempotencyKey);
      createAttempts += 1;
      if (createAttempts === 1) throw new Error("运行创建网络失败");
      return {
        run: {
          ...completedRun,
          status: "queued",
          completedAt: null
        },
        etag: '"run-start-1:1"'
      };
    }
  } as unknown as AcquisitionDetailApi;
  let keySerial = 0;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget,
    keyFactory: () => `run-start-key-${++keySerial}`
  });

  await controller.open("plan", "plan-1");
  await assert.rejects(
    () => controller.startRun("  开始公开检索  "),
    /运行创建网络失败/
  );
  assert.equal(controller.getState().runControlBusy, false);
  assert.equal(controller.getState().runControlReason, "开始公开检索");
  await controller.startRun();
  assert.equal(startKeys[0], startKeys[1]);
  assert.equal(controller.getState().detail?.latestRun?.status, "succeeded");
  assert.equal(controller.getState().runControlBusy, false);
  assert.equal(controller.getState().runControlReason, "");
  assert.deepEqual(refreshes.at(-1), {
    planId: "plan-1",
    action: "start",
    runId: "run-start-1"
  });

  await controller.startRun("  开始公开检索  ");
  assert.notEqual(startKeys[1], startKeys[2]);
  controller.destroy();
}

{
  let taskReads = 0;
  const createInputs: Array<Record<string, unknown>> = [];
  const budgetRun = {
    id: "run-budget-parent",
    status: "budget_exhausted" as const,
    planVersion: 1,
    etag: '"run-budget-parent:2"',
    updatedAt: "2026-08-07T12:00:00.000Z",
    completedAt: "2026-08-07T12:00:00.000Z",
    evidenceCount: 8,
    consumedBudget: {
      requests: 10,
      results: 8,
      amountMinor: 1_000,
      durationSeconds: 100
    }
  };
  const continuedRun = {
    ...budgetRun,
    id: "run-budget-child",
    status: "queued" as const,
    planVersion: 2,
    etag: '"run-budget-child:1"',
    completedAt: null,
    consumedBudget: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    }
  };
  const api = {
    async getTask() {
      taskReads += 1;
      return {
        ...taskDetail,
        plan: { ...taskDetail.plan, version: 2 },
        latestRun: taskReads === 1 ? budgetRun : continuedRun
      };
    },
    async createRun(
      planId: string,
      input: Record<string, unknown>,
      idempotencyKey: string
    ) {
      assert.equal(planId, "plan-1");
      assert.match(idempotencyKey, /budget-key/);
      createInputs.push(input);
      return {
        run: {
          ...continuedRun,
          ownerId: "user-1",
          teamId: "team-1",
          planId,
          planVersionId: "plan-version-2",
          planSnapshotHash: "sha256:plan-2",
          parentRunId: budgetRun.id,
          terminationIntent: null,
          revision: 1,
          budgetSnapshotId: "budget-2",
          budgetSnapshot: {
            billingCurrency: "CNY",
            maxRequests: 20,
            maxResults: 20,
            maxAmountMinor: 2_000,
            maxDurationSeconds: 200
          },
          budgetSnapshotHash: "sha256:budget-2",
          billingCurrency: "CNY",
          modelSnapshotRef: {
            jobSnapshotId: "snapshot-2",
            connectionId: "model-2",
            credentialVersion: 1,
            provider: "zhipu",
            model: "glm-5.2",
            capabilitySnapshotHash: "sha256:capability",
            promptVersion: "prompt-v1",
            schemaVersion: "schema-v1",
            promptHash: "sha256:prompt",
            schemaHash: "sha256:schema"
          },
          reason: "追加预算后继续",
          createdBy: "user-1",
          createdAt: "2026-08-07T12:01:00.000Z",
          updatedBy: "user-1"
        },
        etag: continuedRun.etag
      };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    keyFactory: () => "budget-key-0001"
  });

  await controller.open("plan", "plan-1");
  await controller.startRun(" 追加预算后继续 ");
  assert.deepEqual(createInputs, [{
    parentRunId: "run-budget-parent",
    reason: "追加预算后继续"
  }]);
  assert.equal(controller.getState().detail?.latestRun?.id, "run-budget-child");
  controller.destroy();
}

{
  let taskReads = 0;
  const oldRun = {
    id: "run-old",
    status: "succeeded" as const,
    etag: '"run-old:2"',
    updatedAt: "2026-08-07T12:00:00.000Z",
    completedAt: "2026-08-07T12:00:00.000Z",
    evidenceCount: 5,
    consumedBudget: {
      requests: 2,
      results: 5,
      amountMinor: 20,
      durationSeconds: 20
    }
  };
  const api = {
    async getTask() {
      taskReads += 1;
      if (taskReads > 1) throw new Error("详情刷新失败");
      return {
        ...taskDetail,
        latestRun: oldRun,
        shards: [{ id: "old-shard" }],
        presentation: {
          candidateEvents: [{ candidateId: "old-candidate" }],
          providers: [],
          hasMore: false,
          nextAfter: null
        }
      };
    },
    async createRun(planId: string) {
      return {
        run: {
          id: "run-new",
          ownerId: "user-1",
          teamId: "team-1",
          planId,
          planVersionId: "plan-version-1",
          planVersion: 1,
          planSnapshotHash: "sha256:plan",
          parentRunId: null,
          status: "queued" as const,
          terminationIntent: null,
          revision: 1,
          etag: '"run-new:1"',
          budgetSnapshotId: "budget-1",
          budgetSnapshot: {
            billingCurrency: "CNY",
            maxRequests: 10,
            maxResults: 10,
            maxAmountMinor: 1_000,
            maxDurationSeconds: 100
          },
          budgetSnapshotHash: "sha256:budget",
          billingCurrency: "CNY",
          modelSnapshotRef: {
            jobSnapshotId: "snapshot-1",
            connectionId: "model-1",
            credentialVersion: 1,
            provider: "zhipu",
            model: "glm-5.2",
            capabilitySnapshotHash: "sha256:capability",
            promptVersion: "prompt-v1",
            schemaVersion: "schema-v1",
            promptHash: "sha256:prompt",
            schemaHash: "sha256:schema"
          },
          consumedBudget: {
            requests: 0,
            results: 0,
            amountMinor: 0,
            durationSeconds: 0
          },
          evidenceCount: 0,
          reason: null,
          createdBy: "user-1",
          createdAt: "2026-08-07T12:01:00.000Z",
          updatedBy: "user-1",
          updatedAt: "2026-08-07T12:01:00.000Z",
          completedAt: null
        },
        etag: '"run-new:1"'
      };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("plan", "plan-1");
  await controller.startRun("新的独立运行");
  assert.equal(controller.getState().detail?.latestRun?.id, "run-new");
  assert.deepEqual(controller.getState().detail?.latestRun?.budgetSnapshot, {
    billingCurrency: "CNY",
    maxRequests: 10,
    maxResults: 10,
    maxAmountMinor: 1_000,
    maxDurationSeconds: 100
  });
  assert.deepEqual(controller.getState().detail?.shards, []);
  assert.equal(controller.getState().detail?.presentation, null);
  assert.match(controller.getState().error ?? "", /详情刷新失败/);
  controller.destroy();
}

{
  const oldRun = {
    id: "run-lag-old",
    status: "succeeded" as const,
    etag: '"run-lag-old:2"',
    planVersion: 1,
    updatedAt: "2026-08-07T12:00:00.000Z",
    completedAt: "2026-08-07T12:00:00.000Z",
    evidenceCount: 3,
    consumedBudget: {
      requests: 2,
      results: 3,
      amountMinor: 30,
      durationSeconds: 10
    }
  };
  const newRun = {
    id: "run-lag-new",
    status: "queued" as const,
    etag: '"run-lag-new:1"',
    planVersion: 1,
    revision: 1,
    updatedAt: "2026-08-07T12:01:00.000Z",
    completedAt: null,
    evidenceCount: 0,
    consumedBudget: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    },
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 10,
      maxResults: 20,
      maxAmountMinor: 1_000,
      maxDurationSeconds: 120
    },
    modelSnapshotRef: {
      provider: "zhipu",
      model: "glm-5.2"
    }
  };
  const laggedDetail = {
    ...taskDetail,
    latestRun: oldRun,
    shards: [{ id: "old-shard" }],
    presentation: {
      candidateEvents: [{ candidateId: "old-candidate" }],
      providers: [],
      hasMore: false,
      nextAfter: null
    }
  };
  const api = {
    async getTask() {
      return laggedDetail;
    },
    async createRun() {
      return { run: newRun, etag: newRun.etag };
    }
  } as unknown as AcquisitionDetailApi;
  const scheduler = new ManualPollScheduler();
  const controller = createAcquisitionDetailCenterController({
    api,
    pollIntervalMs: 25,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  await controller.startRun("新的独立运行");

  assert.equal(controller.getState().detail?.latestRun?.id, "run-lag-new");
  assert.deepEqual(controller.getState().detail?.shards, []);
  assert.equal(controller.getState().detail?.presentation, null);
  assert.match(controller.getState().error ?? "", /任务详情仍在同步/);
  assert.equal(scheduler.pendingCount(), 1);
  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(controller.getState().detail?.latestRun?.id, "run-lag-new");
  assert.deepEqual(controller.getState().detail?.shards, []);
  assert.equal(controller.getState().detail?.presentation, null);
  controller.destroy();
}

{
  const refreshes: Array<Record<string, unknown>> = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(
    "goodjob:acquisition-refresh-requested",
    (event) => refreshes.push(
      (event as CustomEvent<Record<string, unknown>>).detail
    )
  );
  let currentRun = {
    id: "run-control-1",
    status: "running" as "running" | "paused" | "queued" | "cancelled",
    etag: '"run-control-1:2"',
    updatedAt: "2026-08-07T12:00:00.000Z",
    completedAt: null,
    evidenceCount: 3,
    consumedBudget: {
      requests: 2,
      results: 3,
      amountMinor: 30,
      durationSeconds: 10
    }
  };
  const calls: Array<{
    runId: string;
    action: string;
    etag: string;
    reason: string;
  }> = [];
  let confirmCalls = 0;
  const api = {
    async getTask() {
      return { ...taskDetail, latestRun: { ...currentRun } };
    },
    async controlRun(
      runId: string,
      action: "pause" | "resume" | "cancel",
      etag: string,
      reason: string
    ) {
      calls.push({ runId, action, etag, reason });
      const nextStatus = action === "pause"
        ? "paused"
        : action === "resume"
          ? "queued"
          : "cancelled";
      currentRun = {
        ...currentRun,
        status: nextStatus,
        etag: `"run-control-1:${calls.length + 2}"`
      };
      return { run: currentRun, etag: currentRun.etag };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget,
    confirm: () => {
      confirmCalls += 1;
      return confirmCalls > 1;
    }
  });

  await controller.open("plan", "plan-1");
  await assert.rejects(() => controller.controlRun("pause", "  "), /理由/);
  assert.equal(calls.length, 0);
  await controller.controlRun("pause", " 人工检查 ");
  assert.deepEqual(calls[0], {
    runId: "run-control-1",
    action: "pause",
    etag: '"run-control-1:2"',
    reason: "人工检查"
  });
  assert.equal(controller.getState().detail?.latestRun?.status, "paused");

  await controller.controlRun("resume", " 检查完成 ");
  assert.deepEqual(calls[1], {
    runId: "run-control-1",
    action: "resume",
    etag: '"run-control-1:3"',
    reason: "检查完成"
  });
  assert.equal(controller.getState().detail?.latestRun?.status, "queued");

  await controller.controlRun("cancel", " 不再继续 ");
  assert.equal(calls.length, 2);
  await controller.controlRun("cancel", " 不再继续 ");
  assert.deepEqual(calls[2], {
    runId: "run-control-1",
    action: "cancel",
    etag: '"run-control-1:4"',
    reason: "不再继续"
  });
  assert.equal(controller.getState().detail?.latestRun?.status, "cancelled");
  assert.deepEqual(refreshes.map((item) => item.action), [
    "pause",
    "resume",
    "cancel"
  ]);
  controller.destroy();
}

{
  const invalidCalls: string[] = [];
  const api = {
    async getTask(planId: string) {
      if (planId === "budget-plan") {
        return {
          ...taskDetail,
          plan: { ...taskDetail.plan, id: planId },
          latestRun: {
            id: "run-budget",
            status: "budget_exhausted",
            etag: '"run-budget:2"',
            updatedAt: "2026-08-07T12:00:00.000Z",
            completedAt: "2026-08-07T12:00:00.000Z",
            evidenceCount: 0,
            consumedBudget: {
              requests: 4,
              results: 0,
              amountMinor: 400,
              durationSeconds: 60
            }
          }
        };
      }
      return {
        ...taskDetail,
        plan: { ...taskDetail.plan, id: planId },
        latestRun: {
          id: "run-no-etag",
          status: "running",
          updatedAt: "2026-08-07T12:00:00.000Z",
          completedAt: null,
          evidenceCount: 0,
          consumedBudget: {
            requests: 1,
            results: 0,
            amountMinor: 0,
            durationSeconds: 1
          }
        }
      };
    },
    async createRun() {
      invalidCalls.push("start");
      throw new Error("不应调用");
    },
    async controlRun() {
      invalidCalls.push("control");
      throw new Error("不应调用");
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api });

  await controller.open("plan", "no-etag-plan");
  await assert.rejects(
    () => controller.controlRun("pause", "人工检查"),
    /ETag|刷新/
  );
  await assert.rejects(
    () => controller.controlRun("resume", "人工检查"),
    /只有已暂停/
  );
  await controller.open("plan", "budget-plan");
  await assert.rejects(
    () => controller.startRun("追加预算"),
    /预算|审批/
  );
  assert.deepEqual(invalidCalls, []);
  controller.destroy();
}

{
  const control = deferred<Record<string, unknown>>();
  const refreshes: Array<Record<string, unknown>> = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(
    "goodjob:acquisition-refresh-requested",
    (event) => refreshes.push(
      (event as CustomEvent<Record<string, unknown>>).detail
    )
  );
  const api = {
    async getTask(planId: string) {
      return {
        ...taskDetail,
        task: { ...taskDetail.task, planId },
        plan: { ...taskDetail.plan, id: planId },
        latestRun: {
          id: `run-${planId}`,
          status: "running",
          etag: `"run-${planId}:1"`,
          updatedAt: "2026-08-07T12:00:00.000Z",
          completedAt: null,
          evidenceCount: 0,
          consumedBudget: {
            requests: 1,
            results: 0,
            amountMinor: 0,
            durationSeconds: 1
          }
        }
      };
    },
    controlRun() {
      return control.promise;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({ api, eventTarget });

  await controller.open("plan", "plan-old");
  const staleControl = controller.controlRun("pause", "人工检查");
  controller.close();
  await controller.open("plan", "plan-new");
  control.resolve({
    run: { id: "run-plan-old", status: "paused" },
    etag: '"run-plan-old:2"'
  });
  await staleControl;

  assert.equal(controller.getState().detail?.plan.id, "plan-new");
  assert.equal(controller.getState().detail?.latestRun?.id, "run-plan-new");
  assert.deepEqual(refreshes, []);
  controller.destroy();
}

{
  const scheduler = new ManualPollScheduler();
  const refreshes: Array<Record<string, unknown>> = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(
    "goodjob:acquisition-refresh-requested",
    (event) => refreshes.push(
      (event as CustomEvent<Record<string, unknown>>).detail
    )
  );
  let taskReads = 0;
  const run = (status: "running" | "paused", evidenceCount: number) => ({
    id: "run-poll-1",
    status,
    etag: `"run-poll-1:${taskReads}"`,
    updatedAt: `2026-08-07T12:0${taskReads}:00.000Z`,
    completedAt: null,
    evidenceCount,
    consumedBudget: {
      requests: evidenceCount,
      results: evidenceCount,
      amountMinor: evidenceCount * 10,
      durationSeconds: evidenceCount * 2
    }
  });
  const detailForRead = () => {
    const status = taskReads >= 3 ? "paused" as const : "running" as const;
    const candidateEvents = taskReads === 1
      ? [{
          eventId: "event-poll-1",
          candidateId: "candidate-poll-1",
          candidate: { id: "candidate-poll-1", displayName: "首屏候选" }
        }]
      : [{
          eventId: "event-poll-1",
          candidateId: "candidate-poll-1",
          candidate: { id: "candidate-poll-1", displayName: "首屏候选 · 已更新" }
        }, {
          eventId: "event-poll-3",
          candidateId: "candidate-poll-3",
          candidate: { id: "candidate-poll-3", displayName: "轮询新增候选" }
        }];
    return {
      ...taskDetail,
      latestRun: run(status, taskReads),
      presentation: {
        candidateEvents,
        providers: [{
          shardId: "shard-poll-1",
          connectionId: "search-poll-1",
          providerId: "baidu_ai_search",
          status
        }],
        summary: { validOpportunities: candidateEvents.length },
        hasMore: true,
        nextAfter: "cursor-poll-1"
      }
    };
  };
  const api = {
    async getTask() {
      taskReads += 1;
      return detailForRead();
    },
    async getRunPresentation(runId: string, query: { after?: string }) {
      assert.equal(runId, "run-poll-1");
      assert.equal(query.after, "cursor-poll-1");
      return {
        run: run("running", 1),
        providers: [],
        summary: { validOpportunities: 2 },
        candidateEvents: [{
          eventId: "event-poll-2",
          candidateId: "candidate-poll-2",
          candidate: { id: "candidate-poll-2", displayName: "翻页候选" }
        }],
        hasMore: false,
        nextAfter: null
      };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget,
    pollIntervalMs: 1_234,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  assert.equal(scheduler.pendingCount(), 1);
  assert.equal(scheduler.nextDelay(), 1_234);
  await controller.loadMoreCandidates();
  assert.deepEqual(
    controller.getState().detail?.presentation?.candidateEvents.map(
      (event) => event.candidateId
    ),
    ["candidate-poll-1", "candidate-poll-2"]
  );

  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(controller.getState().detail?.latestRun?.evidenceCount, 2);
  assert.deepEqual(
    controller.getState().detail?.presentation?.candidateEvents.map(
      (event) => event.candidateId
    ),
    ["candidate-poll-1", "candidate-poll-2", "candidate-poll-3"]
  );
  assert.equal(
    controller.getState().detail?.presentation?.candidateEvents[0]?.candidate
      && (controller.getState().detail?.presentation?.candidateEvents[0]?.candidate as
        Record<string, unknown>).displayName,
    "首屏候选 · 已更新"
  );
  assert.equal(controller.getState().detail?.presentation?.hasMore, false);
  assert.equal(scheduler.pendingCount(), 1);
  assert.equal(refreshes.length, 1);

  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(controller.getState().detail?.latestRun?.status, "paused");
  assert.equal(scheduler.pendingCount(), 0);
  assert.equal(refreshes.length, 2);
  controller.destroy();
}

{
  const scheduler = new ManualPollScheduler();
  let presentationReads = 0;
  const liveRun = {
    id: "run-tail-poll",
    status: "succeeded" as const,
    etag: '"run-tail-poll:1"',
    updatedAt: "2026-08-07T12:00:00.000Z",
    completedAt: null,
    evidenceCount: 2,
    consumedBudget: {
      requests: 1,
      results: 2,
      amountMinor: 20,
      durationSeconds: 3
    }
  };
  const api = {
    async getTask() {
      return {
        ...taskDetail,
        latestRun: liveRun,
        presentation: {
          candidateEvents: [{
            eventId: "event-tail-1",
            candidateId: "candidate-tail-1"
          }],
          providers: [],
          summary: { validOpportunities: 1 },
          hasMore: true,
          nextAfter: "cursor-tail-1"
        }
      };
    },
    async getRunPresentation(runId: string, query: { after?: string }) {
      presentationReads += 1;
      assert.equal(runId, "run-tail-poll");
      assert.equal(
        query.after,
        presentationReads === 1 ? "cursor-tail-1" : "cursor-tail-2"
      );
      return {
        run: liveRun,
        providers: [{
          shardId: "shard-tail-1",
          connectionId: "search-tail",
          providerId: "baidu_ai_search",
          status: "running"
        }],
        summary: { validOpportunities: presentationReads + 1 },
        candidateEvents: [{
          eventId: `event-tail-${presentationReads + 1}`,
          candidateId: `candidate-tail-${presentationReads + 1}`
        }],
        hasMore: presentationReads === 1,
        nextAfter: presentationReads === 1
          ? "cursor-tail-2"
          : "cursor-tail-3"
      };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  assert.equal(scheduler.pendingCount(), 1);
  scheduler.runNext();
  await controller.whenIdle();

  assert.equal(presentationReads, 2);
  assert.deepEqual(
    controller.getState().detail?.presentation?.candidateEvents.map(
      (event) => event.candidateId
    ),
    ["candidate-tail-1", "candidate-tail-2", "candidate-tail-3"]
  );
  assert.equal(
    controller.getState().detail?.presentation?.nextAfter,
    "cursor-tail-3"
  );
  assert.equal(
    controller.getState().detail?.presentation?.summary?.validOpportunities,
    3
  );
  assert.equal(controller.getState().detail?.presentation?.hasMore, false);
  assert.equal(scheduler.pendingCount(), 0);
  controller.destroy();
}

{
  const scheduler = new ManualPollScheduler();
  const oldPoll = deferred<typeof taskDetail>();
  let oldReads = 0;
  const api = {
    getTask(planId: string) {
      if (planId === "plan-old") {
        oldReads += 1;
        if (oldReads > 1) return oldPoll.promise;
        return Promise.resolve({
          ...taskDetail,
          plan: { ...taskDetail.plan, id: planId },
          latestRun: {
            id: "run-old-poll",
            status: "running" as const,
            etag: '"run-old-poll:1"',
            updatedAt: "2026-08-07T12:00:00.000Z",
            completedAt: null,
            evidenceCount: 1,
            consumedBudget: {
              requests: 1,
              results: 1,
              amountMinor: 10,
              durationSeconds: 1
            }
          }
        });
      }
      return Promise.resolve({
        ...taskDetail,
        plan: { ...taskDetail.plan, id: planId },
        latestRun: null
      });
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-old");
  scheduler.runNext();
  controller.close();
  await controller.open("plan", "plan-new");
  oldPoll.resolve({
    ...taskDetail,
    plan: { ...taskDetail.plan, id: "plan-old" }
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(controller.getState().detail?.plan.id, "plan-new");
  assert.equal(controller.getState().detail?.latestRun, null);
  assert.equal(scheduler.pendingCount(), 0);
  controller.destroy();
}

// Catches background polling moving a manually advanced candidate cursor back
// to the first page while more pages still remain.
{
  const scheduler = new ManualPollScheduler();
  let taskReads = 0;
  const activeDetail = (status: "running" | "paused") => ({
    ...taskDetail,
    latestRun: {
      id: "run-pagination-poll",
      status,
      etag: `"run-pagination-poll:${taskReads}"`,
      updatedAt: `2026-08-07T13:0${taskReads}:00.000Z`,
      completedAt: null,
      evidenceCount: taskReads,
      consumedBudget: {
        requests: taskReads,
        results: taskReads,
        amountMinor: 0,
        durationSeconds: taskReads
      }
    },
    presentation: {
      candidateEvents: [{
        eventId: "event-pagination-1",
        candidateId: "candidate-pagination-1",
        candidate: {
          id: "candidate-pagination-1",
          displayName: taskReads > 1 ? "第一页候选 · 已刷新" : "第一页候选"
        }
      }],
      providers: [],
      summary: { validOpportunities: 3 },
      hasMore: true,
      nextAfter: "cursor-first-page"
    }
  });
  const api = {
    async getTask() {
      taskReads += 1;
      return activeDetail(taskReads > 1 ? "paused" : "running");
    },
    async getRunPresentation() {
      return {
        run: activeDetail("running").latestRun,
        providers: [],
        summary: { validOpportunities: 3 },
        candidateEvents: [{
          eventId: "event-pagination-2",
          candidateId: "candidate-pagination-2",
          candidate: { id: "candidate-pagination-2", displayName: "第二页候选" }
        }],
        hasMore: true,
        nextAfter: "cursor-second-page"
      };
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  await controller.loadMoreCandidates();
  assert.equal(
    controller.getState().detail?.presentation?.nextAfter,
    "cursor-second-page"
  );

  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(
    controller.getState().detail?.presentation?.nextAfter,
    "cursor-second-page"
  );
  assert.equal(controller.getState().detail?.presentation?.hasMore, false);
  assert.match(controller.getState().error ?? "", /分页游标未前进/);
  assert.equal(scheduler.pendingCount(), 0);
  assert.deepEqual(
    controller.getState().detail?.presentation?.candidateEvents.map(
      (event) => event.candidateId
    ),
    ["candidate-pagination-1", "candidate-pagination-2"]
  );
  controller.destroy();
}

// Catches a transient API failure causing tight-loop polling or erasing the
// last trustworthy run state.
{
  const scheduler = new ManualPollScheduler();
  const refreshes: Event[] = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(
    "goodjob:acquisition-refresh-requested",
    (event) => refreshes.push(event)
  );
  let taskReads = 0;
  const runningDetail = {
    ...taskDetail,
    latestRun: {
      id: "run-retry-poll",
      status: "running" as const,
      etag: '"run-retry-poll:1"',
      updatedAt: "2026-08-07T14:00:00.000Z",
      completedAt: null,
      evidenceCount: 1,
      consumedBudget: {
        requests: 1,
        results: 1,
        amountMinor: 0,
        durationSeconds: 1
      }
    }
  };
  const api = {
    async getTask() {
      taskReads += 1;
      if (taskReads === 2) throw new Error("temporary upstream failure");
      if (taskReads === 3) {
        return {
          ...runningDetail,
          latestRun: {
            ...runningDetail.latestRun,
            status: "paused" as const,
            etag: '"run-retry-poll:2"',
            updatedAt: "2026-08-07T14:01:00.000Z"
          }
        };
      }
      return runningDetail;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    eventTarget,
    pollIntervalMs: 400,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(controller.getState().detail?.latestRun?.status, "running");
  assert.equal(controller.getState().error, null);
  assert.equal(refreshes.length, 0);
  assert.equal(scheduler.pendingCount(), 1);
  assert.equal(scheduler.nextDelay(), 800);

  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(controller.getState().detail?.latestRun?.status, "paused");
  assert.equal(scheduler.pendingCount(), 0);
  assert.equal(refreshes.length, 1);
  controller.destroy();
}

// Catches a presentation-tail failure being treated as a fully successful
// poll, which would otherwise hammer a terminal backlog at the base interval.
{
  const scheduler = new ManualPollScheduler();
  const runningDetail = {
    ...taskDetail,
    latestRun: {
      id: "run-tail-retry",
      status: "running" as const,
      etag: '"run-tail-retry:1"',
      updatedAt: "2026-08-07T14:30:00.000Z",
      completedAt: null,
      evidenceCount: 1,
      consumedBudget: {
        requests: 1,
        results: 1,
        amountMinor: 0,
        durationSeconds: 1
      }
    },
    presentation: {
      candidateEvents: [{
        eventId: "event-tail-retry",
        candidateId: "candidate-tail-retry"
      }],
      providers: [],
      summary: { validOpportunities: 1 },
      hasMore: true,
      nextAfter: "cursor-tail-retry"
    }
  };
  const api = {
    async getTask() {
      return runningDetail;
    },
    async getRunPresentation() {
      throw new Error("temporary presentation failure");
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    pollIntervalMs: 400,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  scheduler.runNext();
  await controller.whenIdle();

  assert.equal(controller.getState().detail?.presentation?.hasMore, true);
  assert.equal(controller.getState().error, null);
  assert.equal(scheduler.pendingCount(), 1);
  assert.equal(scheduler.nextDelay(), 800);
  controller.destroy();
}

// Catches a late manual page response rolling back a cursor already advanced
// by the automatic presentation tail.
{
  const scheduler = new ManualPollScheduler();
  const manualPage = deferred<Record<string, unknown>>();
  let presentationReads = 0;
  const run = {
    id: "run-page-race",
    status: "running" as const,
    etag: '"run-page-race:1"',
    updatedAt: "2026-08-07T14:40:00.000Z",
    completedAt: null,
    evidenceCount: 3,
    consumedBudget: {
      requests: 1,
      results: 3,
      amountMinor: 0,
      durationSeconds: 2
    }
  };
  const task = {
    ...taskDetail,
    latestRun: run,
    presentation: {
      candidateEvents: [{
        eventId: "event-page-race-1",
        candidateId: "candidate-page-race-1"
      }],
      providers: [],
      summary: { validOpportunities: 1 },
      hasMore: true,
      nextAfter: "cursor-page-race-1"
    }
  };
  const page = (number: 2 | 3) => ({
    run,
    providers: [],
    summary: { validOpportunities: number },
    candidateEvents: [{
      eventId: `event-page-race-${number}`,
      candidateId: `candidate-page-race-${number}`
    }],
    hasMore: number === 2,
    nextAfter: `cursor-page-race-${number}`
  });
  const api = {
    async getTask() {
      return task;
    },
    getRunPresentation(_runId: string, query: { after?: string }) {
      presentationReads += 1;
      if (presentationReads === 1) return manualPage.promise;
      if (presentationReads === 2) {
        assert.equal(query.after, "cursor-page-race-1");
        return Promise.resolve(page(2));
      }
      assert.equal(query.after, "cursor-page-race-2");
      return Promise.resolve(page(3));
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  const manualRequest = controller.loadMoreCandidates();
  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(
    controller.getState().detail?.presentation?.nextAfter,
    "cursor-page-race-3"
  );

  manualPage.resolve(page(2));
  await manualRequest;

  assert.equal(controller.getState().loadingMoreCandidates, false);
  assert.equal(
    controller.getState().detail?.presentation?.nextAfter,
    "cursor-page-race-3"
  );
  assert.deepEqual(
    controller.getState().detail?.presentation?.candidateEvents.map(
      (event) => event.candidateId
    ),
    [
      "candidate-page-race-1",
      "candidate-page-race-2",
      "candidate-page-race-3"
    ]
  );
  controller.destroy();
}

// Catches a page request from the previous run leaving the candidate pane
// permanently busy after polling discovers a newer run.
{
  const scheduler = new ManualPollScheduler();
  const oldPage = deferred<Record<string, unknown>>();
  let taskReads = 0;
  const runDetail = (runId: string, candidateId: string) => ({
    ...taskDetail,
    latestRun: {
      id: runId,
      status: "running" as const,
      etag: `"${runId}:1"`,
      updatedAt: `2026-08-07T15:0${taskReads}:00.000Z`,
      completedAt: null,
      evidenceCount: taskReads,
      consumedBudget: {
        requests: taskReads,
        results: taskReads,
        amountMinor: 0,
        durationSeconds: taskReads
      }
    },
    presentation: {
      candidateEvents: [{
        eventId: `event-${candidateId}`,
        candidateId,
        candidate: { id: candidateId, displayName: candidateId }
      }],
      providers: [],
      summary: { validOpportunities: 1 },
      hasMore: runId === "run-page-old",
      nextAfter: runId === "run-page-old" ? "cursor-page-old" : null
    }
  });
  const api = {
    async getTask() {
      taskReads += 1;
      return taskReads === 1
        ? runDetail("run-page-old", "candidate-page-old")
        : runDetail("run-page-new", "candidate-page-new");
    },
    getRunPresentation() {
      return oldPage.promise;
    }
  } as unknown as AcquisitionDetailApi;
  const controller = createAcquisitionDetailCenterController({
    api,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel
  });

  await controller.open("plan", "plan-1");
  const stalePageRequest = controller.loadMoreCandidates();
  assert.equal(controller.getState().loadingMoreCandidates, true);
  scheduler.runNext();
  await controller.whenIdle();
  assert.equal(controller.getState().detail?.latestRun?.id, "run-page-new");

  oldPage.resolve({
    run: runDetail("run-page-old", "candidate-page-old").latestRun,
    providers: [],
    summary: { validOpportunities: 2 },
    candidateEvents: [{
      eventId: "event-stale-page",
      candidateId: "candidate-stale-page",
      candidate: { id: "candidate-stale-page", displayName: "旧运行翻页结果" }
    }],
    hasMore: false,
    nextAfter: null
  });
  await stalePageRequest;

  assert.equal(controller.getState().loadingMoreCandidates, false);
  assert.deepEqual(
    controller.getState().detail?.presentation?.candidateEvents.map(
      (event) => event.candidateId
    ),
    ["candidate-page-new"]
  );
  controller.destroy();
}
