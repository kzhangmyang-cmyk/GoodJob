import assert from "node:assert/strict";
import type {
  AcquisitionCandidate,
  DiscoveryEvidence,
  FinancialValueDecision,
  QualificationDecision
} from "./acquisition-domain.js";
import {
  AcquisitionDomainService
} from "./acquisition-domain-service.js";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  AcquisitionCrmLeadConversionPort
} from "./acquisition-lead-conversion-port.js";
import {
  AcquisitionPrivateDomainHandoffService,
  type AcquisitionPrivateDomainHandoffStore
} from "./acquisition-private-domain-handoff.js";

const scope = {
  ownerId: "owner-a",
  teamId: "team-a",
  actorId: "owner-a"
};
const now = () => "2026-08-07T08:00:00.000Z";

function candidate(
  overrides: Partial<AcquisitionCandidate> = {}
): AcquisitionCandidate {
  return {
    id: "candidate-a",
    ownerId: scope.ownerId,
    teamId: scope.teamId,
    partyType: "organization",
    partyRef: {
      partyType: "organization",
      organizationId: "organization-a",
      tenantProspectId: "tenant-prospect-a"
    },
    profile: {
      kind: "organization",
      name: "厦门真实采购有限公司",
      domain: "buyer.example",
      region: "厦门",
      creditCode: null
    },
    evidenceIds: ["evidence-a"],
    status: "approved",
    latestDecisionId: "qualification-a",
    latestDecisionVersion: "qualification-v2",
    approvedDecisionVersion: "qualification-v2",
    hardGateFailures: [],
    leadId: null,
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T01:00:00.000Z",
    version: 3,
    ...overrides
  };
}

const evidence: DiscoveryEvidence = {
  id: "evidence-a",
  ownerId: scope.ownerId,
  teamId: scope.teamId,
  targetType: "organization",
  sourcePlatform: "public_web",
  sourceTitle: "公开采购需求",
  sourceSnippet: "寻找长期供应商",
  publishedAt: "2026-08-06T00:00:00.000Z",
  locale: "zh-CN",
  rawArtifactHash: `sha256:${"a".repeat(64)}`,
  contentHash: `sha256:${"b".repeat(64)}`,
  provenance: {
    kind: "search_result",
    provider: "public_web",
    queryText: "采购需求",
    sourceUrl: "https://buyer.example/tender/1",
    resultRank: 1
  },
  accessStatus: "public_content",
  supersedesEvidenceId: null,
  fetchedAt: "2026-08-07T00:00:00.000Z"
};

const qualification: QualificationDecision = {
  id: "qualification-a",
  ownerId: scope.ownerId,
  teamId: scope.teamId,
  candidateId: "candidate-a",
  decisionVersion: "qualification-v2",
  decisionEngine: "model",
  grade: "S",
  score: 94,
  recommendedAction: "priority_review",
  evidence: [{ evidenceId: evidence.id, excerpt: "寻找长期供应商" }],
  positiveSignals: [{ name: "purchase_intent", score: 98 }],
  negativeSignals: [],
  reasons: ["公开需求明确"],
  confidence: 0.94,
  ruleVersion: "qualification-rules-v2",
  promptVersion: "qualification-prompt-v2",
  modelProvider: "server-provider",
  model: "server-model",
  hardGateFailures: [],
  snapshotHash: `sha256:${"c".repeat(64)}`,
  createdAt: "2026-08-07T00:30:00.000Z"
};

const financial: FinancialValueDecision = {
  id: "financial-a",
  ownerId: scope.ownerId,
  teamId: scope.teamId,
  candidateId: "candidate-a",
  qualificationDecisionId: qualification.id,
  version: "financial-v1",
  grade: "A",
  score: 90,
  currency: "CNY",
  expectedRevenueMinor: 1_288_000,
  expectedGrossProfitMinor: 708_400,
  expectedContributionMinor: 520_000,
  factors: {
    profitability: 90,
    cashFlow: 88,
    creditQuality: 92,
    repeatPotential: 85,
    referralPotential: 80,
    closeProbability: 86
  },
  inputSnapshotHash: `sha256:${"d".repeat(64)}`,
  createdAt: "2026-08-07T00:40:00.000Z"
};

function handoffStore(): AcquisitionPrivateDomainHandoffStore {
  return {
    leads: [],
    leadSourceEvents: [],
    leadActivities: [],
    customers: [],
    customerActivities: [],
    todos: [],
    acquisitionCustomerHandoffs: [],
    acquisitionCustomerHandoffOperations: [],
    async persist() {},
    async readBarrier() {}
  };
}

async function fixture(
  candidateOverrides: Partial<AcquisitionCandidate> = {},
  financialOverrides: Partial<FinancialValueDecision> = {}
) {
  const repository = new InMemoryAcquisitionDomainRepository();
  await repository.appendEvidence(evidence);
  await repository.insertCandidate(candidate(candidateOverrides));
  await repository.appendQualificationDecision(qualification);
  await repository.appendFinancialValue({ ...financial, ...financialOverrides });
  const store = handoffStore();
  const leadConversionPort = new AcquisitionCrmLeadConversionPort({
    repository,
    store,
    now
  });
  const domainService = new AcquisitionDomainService({
    repository,
    leadConversionPort,
    now,
    idFactory: (prefix) => `${prefix}-generated`
  });
  return {
    repository,
    store,
    domainService,
    service: new AcquisitionPrivateDomainHandoffService({
      repository,
      domainService,
      store,
      now
    })
  };
}

const first = await fixture();
const result = await first.service.create(scope, "candidate-a", {
  operationCode: "handoff_acquisition_candidate_v1",
  decisionVersion: "qualification-v2",
  mode: "create_new",
  existingCustomerId: "",
  followUp: {
    title: "首次跟进：确认需求和预算",
    dueAt: "2026-08-08T09:00:00.000Z",
    priority: "high"
  }
}, "handoff-key-a");

assert.equal(result.replayed, false);
assert.equal(result.intelligence.qualificationGrade, "S");
assert.equal(result.intelligence.qualificationScore, 94);
assert.equal(result.intelligence.expectedRevenueMinor, 1_288_000);
assert.equal(result.customer.grade, "A");
assert.equal(result.customer.amount, 12_880);
assert.equal(result.customer.nextReminder, "2026-08-08T09:00:00.000Z");
assert.equal(result.todo.leadId, result.lead.id);
assert.equal(result.todo.customerId, result.customer.id);
assert.equal(
  result.todo.triggerKey,
  "acquisition-first-follow-up:candidate-a"
);
assert.equal(result.todo.status, "pending");
assert.equal(first.store.leads.length, 1);
assert.equal(first.store.customers.length, 1);
assert.equal(first.store.customerActivities.length, 1);
assert.equal(first.store.todos.length, 1);
assert.equal(first.store.acquisitionCustomerHandoffs.length, 1);
const leadSourceSnapshot = JSON.parse(
  first.store.leadSourceEvents[0]?.rawPayload ?? "{}"
);
assert.deepEqual(leadSourceSnapshot.intelligence, {
  qualificationGrade: "S",
  qualificationScore: 94,
  financialGrade: "A",
  currency: "CNY",
  expectedRevenueMinor: 1_288_000,
  expectedGrossProfitMinor: 708_400,
  expectedContributionMinor: 520_000
});
assert.equal(
  leadSourceSnapshot.qualificationSnapshotHash,
  qualification.snapshotHash
);
assert.equal(
  leadSourceSnapshot.financialSnapshotHash,
  financial.inputSnapshotHash
);

const request = {
  operationCode: "handoff_acquisition_candidate_v1" as const,
  decisionVersion: "qualification-v2",
  mode: "create_new" as const,
  existingCustomerId: "",
  followUp: {
    title: "首次跟进：确认需求和预算",
    dueAt: "2026-08-08T09:00:00.000Z",
    priority: "high" as const
  }
};
const replay = await first.service.create(
  scope,
  "candidate-a",
  request,
  "handoff-key-a"
);
assert.equal(replay.replayed, true);
assert.equal(replay.handoff.id, result.handoff.id);
assert.equal(replay.customer.id, result.customer.id);
assert.equal(replay.todo.id, result.todo.id);
assert.equal(first.store.customers.length, 1);
assert.equal(first.store.todos.length, 1);

await assert.rejects(
  () => first.service.create(scope, "candidate-a", {
    ...request,
    followUp: {
      ...request.followUp,
      dueAt: "2026-08-09T09:00:00.000Z"
    }
  }, "handoff-key-a"),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_HANDOFF_IDEMPOTENCY_CONFLICT"
);

const completedViaOtherKey = await first.service.create(
  scope,
  "candidate-a",
  request,
  "handoff-key-b"
);
assert.equal(completedViaOtherKey.handoff.id, result.handoff.id);
assert.equal(first.store.customers.length, 1);
assert.equal(first.store.todos.length, 1);

for (const [name, overrides, code] of ([
  ["not-approved", { status: "pending_review" },
    "ACQUISITION_HANDOFF_NOT_APPROVED"],
  ["stale", { approvedDecisionVersion: "qualification-v1" },
    "ACQUISITION_HANDOFF_STALE_DECISION"],
  ["hard-gate", { hardGateFailures: ["do_not_contact"] },
    "ACQUISITION_HANDOFF_HARD_GATE_BLOCKED"]
] satisfies Array<[string, Partial<AcquisitionCandidate>, string]>)) {
  const blocked = await fixture(overrides);
  await assert.rejects(
    () => blocked.service.create(
      scope,
      "candidate-a",
      request,
      `handoff-${name}-123`
    ),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === code
  );
  assert.equal(blocked.store.leads.length, 0);
  assert.equal(blocked.store.customers.length, 0);
  assert.equal(blocked.store.todos.length, 0);
}

const otherScope = {
  ownerId: "owner-b",
  teamId: "team-b",
  actorId: "owner-b"
};
await assert.rejects(
  () => first.service.create(
    otherScope,
    "candidate-a",
    request,
    "handoff-other-tenant"
  ),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_CANDIDATE_NOT_FOUND"
);
await assert.rejects(
  () => first.service.get(otherScope, "candidate-a"),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_HANDOFF_NOT_FOUND"
);

const linked = await fixture();
linked.store.customers.push({
  id: "customer-existing",
  company: "已有客户",
  country: "中国",
  contact: "王总",
  ownerId: scope.ownerId,
  teamId: scope.teamId,
  stage: "沟通中",
  amount: 99,
  health: 70,
  grade: "C",
  nextReminder: "",
  wecomBound: true,
  billingName: "",
  billingAddress: "",
  documentContact: "王总",
  defaultPortDischarge: "",
  defaultIncoterm: "",
  defaultPaymentTerm: ""
});
const linkResult = await linked.service.create(scope, "candidate-a", {
  ...request,
  mode: "link_existing",
  existingCustomerId: "customer-existing"
}, "handoff-link-existing");
assert.equal(linkResult.customer.id, "customer-existing");
assert.equal(linked.store.customers.length, 1);
assert.equal(linkResult.todo.customerId, "customer-existing");
assert.equal(linkResult.customer.amount, 99);
assert.equal(linkResult.customer.grade, "C");
assert.equal(linkResult.customer.stage, "沟通中");
assert.equal(linkResult.customer.health, 70);
assert.equal(
  linkResult.customer.nextReminder,
  request.followUp.dueAt
);

const forbiddenLink = await fixture();
forbiddenLink.store.customers.push({
  ...linked.store.customers[0]!,
  id: "customer-other-owner",
  ownerId: "owner-b"
});
await assert.rejects(
  () => forbiddenLink.service.create(scope, "candidate-a", {
    ...request,
    mode: "link_existing",
    existingCustomerId: "customer-other-owner"
  }, "handoff-forbidden-link"),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_HANDOFF_CUSTOMER_NOT_FOUND"
);
assert.equal(forbiddenLink.store.leads.length, 0);
assert.equal(forbiddenLink.store.todos.length, 0);

const foreign = await fixture({}, {
  currency: "USD",
  expectedRevenueMinor: 5_500_000
});
const foreignResult = await foreign.service.create(
  scope,
  "candidate-a",
  request,
  "handoff-foreign-currency"
);
assert.equal(foreignResult.intelligence.currency, "USD");
assert.equal(foreignResult.intelligence.expectedRevenueMinor, 5_500_000);
assert.equal(foreignResult.customer.amount, 0);

const linkedForeign = await fixture({}, {
  currency: "USD",
  expectedRevenueMinor: 5_500_000
});
linkedForeign.store.customers.push({
  ...linked.store.customers[0]!,
  id: "customer-existing-foreign",
  amount: 99
});
const linkedForeignResult = await linkedForeign.service.create(
  scope,
  "candidate-a",
  {
    ...request,
    mode: "link_existing",
    existingCustomerId: "customer-existing-foreign"
  },
  "handoff-link-existing-foreign"
);
assert.equal(linkedForeignResult.customer.amount, 99);

const customerPartial = await fixture();
customerPartial.store.customers.push({
  ...result.customer,
  nextReminder: ""
});
const customerResumed = await customerPartial.service.create(
  scope,
  "candidate-a",
  request,
  "handoff-resume-customer"
);
assert.equal(customerResumed.customer.id, result.customer.id);
assert.equal(customerPartial.store.customers.length, 1);
assert.equal(customerPartial.store.customerActivities.length, 1);
assert.equal(customerPartial.store.todos.length, 1);
assert.equal(customerPartial.store.acquisitionCustomerHandoffs.length, 1);

const convertedCustomerPartial = await fixture({
  status: "converted_to_lead",
  leadId: "lead-existing-customer"
});
convertedCustomerPartial.store.leads.push({
  ...result.lead,
  id: "lead-existing-customer",
  convertedCustomerId: "customer-from-lead"
});
convertedCustomerPartial.store.customers.push({
  ...result.customer,
  id: "customer-from-lead",
  amount: 777,
  grade: "B",
  nextReminder: ""
});
const convertedCustomerResumed =
  await convertedCustomerPartial.service.create(
    scope,
    "candidate-a",
    request,
    "handoff-resume-converted-customer"
  );
assert.equal(
  convertedCustomerResumed.customer.id,
  "customer-from-lead"
);
assert.equal(convertedCustomerPartial.store.customers.length, 1);
assert.equal(convertedCustomerPartial.store.customerActivities.length, 1);
assert.equal(convertedCustomerPartial.store.todos.length, 1);
assert.equal(
  convertedCustomerPartial.store.leads[0]?.convertedCustomerId,
  "customer-from-lead"
);
const convertedLeadSnapshotEvent =
  convertedCustomerPartial.store.leadSourceEvents.find((item) =>
    item.leadId === "lead-existing-customer"
    && item.channel === "acquisition_private_domain_handoff_snapshot"
  );
assert.ok(convertedLeadSnapshotEvent);
const convertedLeadSnapshot = JSON.parse(
  convertedLeadSnapshotEvent.rawPayload
);
assert.deepEqual(convertedLeadSnapshot.intelligence, {
  qualificationGrade: "S",
  qualificationScore: 94,
  financialGrade: "A",
  currency: "CNY",
  expectedRevenueMinor: 1_288_000,
  expectedGrossProfitMinor: 708_400,
  expectedContributionMinor: 520_000
});
assert.equal(
  convertedLeadSnapshot.qualificationSnapshotHash,
  qualification.snapshotHash
);
assert.equal(
  convertedLeadSnapshot.financialSnapshotHash,
  financial.inputSnapshotHash
);

const reservedFailure = await fixture();
let rejectedCustomerWrite = false;
reservedFailure.store.persistMutation = async (mutation) => {
  const applied = mutation();
  if (!rejectedCustomerWrite
    && reservedFailure.store.customers.length > 0) {
    rejectedCustomerWrite = true;
    applied.rollback();
    throw new Error("customer stage failed");
  }
  return applied.value;
};
await assert.rejects(
  () => reservedFailure.service.create(
    scope,
    "candidate-a",
    request,
    "handoff-reserved-key"
  ),
  /customer stage failed/
);
assert.equal(reservedFailure.store.leads.length, 1);
assert.equal(reservedFailure.store.customers.length, 0);
assert.equal(
  reservedFailure.store.acquisitionCustomerHandoffOperations[0]?.stage,
  "lead_ready"
);
const refreshedReservedService = new AcquisitionPrivateDomainHandoffService({
  repository: reservedFailure.repository,
  domainService: reservedFailure.domainService,
  store: reservedFailure.store,
  now
});
const pendingHandoff = await refreshedReservedService.get(
  scope,
  "candidate-a"
) as unknown as {
  inProgress: {
    stage: string;
    request: typeof request;
  };
};
assert.equal(pendingHandoff.inProgress.stage, "lead_ready");
assert.deepEqual(pendingHandoff.inProgress.request, request);
await assert.rejects(
  () => reservedFailure.service.create(
    scope,
    "candidate-a",
    {
      ...request,
      followUp: {
        ...request.followUp,
        dueAt: "2026-08-09T09:00:00.000Z"
      }
    },
    "handoff-reserved-key"
  ),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_HANDOFF_IDEMPOTENCY_CONFLICT"
);
await assert.rejects(
  () => refreshedReservedService.create(
    scope,
    "candidate-a",
    {
      ...request,
      followUp: {
        ...request.followUp,
        title: "篡改后的首次跟进"
      }
    },
    "handoff-different-request-key"
  ),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_HANDOFF_IDEMPOTENCY_CONFLICT"
);
await assert.rejects(
  () => reservedFailure.service.create(
    scope,
    "candidate-a",
    {
      ...request,
      mode: "link_existing",
      existingCustomerId: "customer-changed-mode"
    },
    "handoff-reserved-key"
  ),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_HANDOFF_IDEMPOTENCY_CONFLICT"
);
await reservedFailure.repository.appendFinancialValue({
  ...financial,
  id: "financial-after-reservation",
  expectedRevenueMinor: 9_999_900,
  createdAt: "2026-08-07T07:59:00.000Z"
});
const immutableResume = await refreshedReservedService.create(
  scope,
  "candidate-a",
  pendingHandoff.inProgress.request,
  "handoff-refresh-recovery-key"
);
assert.equal(immutableResume.intelligence.expectedRevenueMinor, 1_288_000);
assert.equal(immutableResume.customer.amount, 12_880);
assert.equal(immutableResume.todo.title, request.followUp.title);
assert.equal(immutableResume.todo.dueAt, request.followUp.dueAt);
assert.equal(reservedFailure.store.leads.length, 1);
assert.equal(reservedFailure.store.customers.length, 1);
assert.equal(reservedFailure.store.todos.length, 1);
assert.equal(reservedFailure.store.acquisitionCustomerHandoffs.length, 1);

const linkedTodoFailure = await fixture();
linkedTodoFailure.store.customers.push({
  ...result.customer,
  id: "customer-refresh-target",
  amount: 432,
  grade: "C",
  nextReminder: ""
});
const linkedRefreshRequest = {
  ...request,
  mode: "link_existing" as const,
  existingCustomerId: "customer-refresh-target",
  followUp: {
    title: "首次跟进：核对原始目标",
    dueAt: "2026-08-11T03:30:00.000Z",
    priority: "medium" as const
  }
};
let rejectedTodoStage = false;
linkedTodoFailure.store.persistMutation = async (mutation) => {
  const applied = mutation();
  if (!rejectedTodoStage && linkedTodoFailure.store.todos.length > 0) {
    rejectedTodoStage = true;
    applied.rollback();
    throw new Error("todo stage failed");
  }
  return applied.value;
};
await assert.rejects(
  () => linkedTodoFailure.service.create(
    scope,
    "candidate-a",
    linkedRefreshRequest,
    "handoff-linked-original-key"
  ),
  /todo stage failed/
);
const refreshedLinkedService = new AcquisitionPrivateDomainHandoffService({
  repository: linkedTodoFailure.repository,
  domainService: linkedTodoFailure.domainService,
  store: linkedTodoFailure.store,
  now
});
const linkedPending = await refreshedLinkedService.get(scope, "candidate-a");
assert.ok("inProgress" in linkedPending);
assert.deepEqual(linkedPending.inProgress.request, linkedRefreshRequest);
await assert.rejects(
  () => refreshedLinkedService.create(
    scope,
    "candidate-a",
    {
      ...linkedRefreshRequest,
      existingCustomerId: "customer-silent-retarget"
    },
    "handoff-linked-new-key"
  ),
  (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "ACQUISITION_HANDOFF_IDEMPOTENCY_CONFLICT"
);
const linkedRecovered = await refreshedLinkedService.create(
  scope,
  "candidate-a",
  linkedPending.inProgress.request,
  "handoff-linked-refresh-key"
);
assert.equal(linkedRecovered.customer.id, "customer-refresh-target");
assert.equal(linkedRecovered.customer.amount, 432);
assert.equal(linkedRecovered.customer.grade, "C");
assert.equal(linkedRecovered.todo.title, linkedRefreshRequest.followUp.title);
assert.equal(linkedRecovered.todo.dueAt, linkedRefreshRequest.followUp.dueAt);
assert.equal(linkedTodoFailure.store.customers.length, 1);
assert.equal(linkedTodoFailure.store.customerActivities.length, 1);
assert.equal(linkedTodoFailure.store.todos.length, 1);
assert.equal(linkedTodoFailure.store.acquisitionCustomerHandoffs.length, 1);

const recovering = await fixture();
let rejectedCompletedWrite = false;
recovering.store.persistMutation = async (mutation) => {
  const applied = mutation();
  if (!rejectedCompletedWrite
    && recovering.store.acquisitionCustomerHandoffs.length > 0) {
    rejectedCompletedWrite = true;
    applied.rollback();
    throw new Error("customer commit failed");
  }
  return applied.value;
};
await assert.rejects(
  () => recovering.service.create(
    scope,
    "candidate-a",
    request,
    "handoff-recovery-key"
  ),
  /customer commit failed/
);
assert.equal(recovering.store.leads.length, 1);
assert.equal(recovering.store.customers.length, 1);
assert.equal(recovering.store.customerActivities.length, 1);
assert.equal(recovering.store.todos.length, 1);
assert.equal(recovering.store.acquisitionCustomerHandoffs.length, 0);
assert.equal(
  recovering.store.acquisitionCustomerHandoffOperations[0]?.stage,
  "todo_ready"
);
const recovered = await recovering.service.create(
  scope,
  "candidate-a",
  request,
  "handoff-recovery-key"
);
assert.equal(recovered.lead.id, recovering.store.leads[0]?.id);
assert.equal(recovering.store.leads.length, 1);
assert.equal(recovering.store.customers.length, 1);
assert.equal(recovering.store.todos.length, 1);

const refreshedService = new AcquisitionPrivateDomainHandoffService({
  repository: recovering.repository,
  domainService: recovering.domainService,
  store: recovering.store,
  now
});
const refreshed = await refreshedService.get(scope, "candidate-a");
assert.ok("handoff" in refreshed);
assert.equal(refreshed.handoff.id, recovered.handoff.id);
assert.equal(refreshed.lead.id, recovered.lead.id);
assert.equal(refreshed.customer.id, recovered.customer.id);
assert.equal(refreshed.todo.id, recovered.todo.id);

console.log("acquisition private-domain handoff tests passed");
