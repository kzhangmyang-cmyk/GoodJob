import type { PricingPolicyVersion } from "./catalog-domain.js";
import { capabilitiesForHumanRole, type GrowthCapability } from "./growth-capabilities.js";
import type { CommandContext } from "./growth-command-context.js";
import type { QuoteCalculationInput } from "./quote-domain.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import type { Role } from "./types.js";
import type { ProbabilityAssessmentV2 } from "./probability-assessment.js";
import type { AcquisitionCandidate } from "./acquisition-domain.js";
import type { AcquisitionCustomerHandoff, Customer, Deal, Lead, User } from "./types.js";
import type { CommercialBindingInput } from "./commercial-binding-snapshot.js";
import { CommercialBindingVerifier, createCommercialBindingSnapshot } from "./commercial-binding-snapshot.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";
import { InMemoryQuoteRepository, type QuoteCase, type QuoteVersion } from "./quote-repository.js";
import { InMemoryGrowthHttpIdempotencyRepository, type GrowthHttpIdempotencyRepository } from "./growth-http-idempotency-repository.js";
import { createGrowthWorkspaceMemberAssignabilityReader } from "./growth-workspace-member-assignability.js";
import { QuoteCaseService } from "./quote-case-service.js";

const FIXED_INSTANT = "2026-08-01T00:00:00.000Z";

export function probabilityRecordFixture(
  overrides: Partial<ProbabilityAssessmentV2> = {}
): ProbabilityAssessmentV2 {
  return {
    id: "probability-assessment-1",
    workspaceId: "team-a",
    candidateId: "candidate-1",
    dealId: null,
    closeProbabilityBps: 4_321,
    qualificationDecisionId: "qualification-1",
    qualificationDecisionVersion: "decision-v1",
    evidenceRefs: ["evidence-1"],
    ruleVersion: "qualification-rules.v2",
    modelSnapshotRef: null,
    inputSnapshotHash: `sha256:${"a".repeat(64)}`,
    assessedAt: FIXED_INSTANT,
    recordedAt: FIXED_INSTANT,
    temporalSequence: 1,
    precision: "bps",
    ...overrides
  };
}

export function quotePolicyFixture(
  overrides: Partial<PricingPolicyVersion> = {}
): PricingPolicyVersion {
  return {
    id: "pricing-policy-1",
    workspaceId: "team-a",
    catalogItemId: "catalog-item-1",
    version: 1,
    packageVersionId: null,
    currency: "CNY",
    listUnitPriceMinor: 10_000,
    unitStandardCostMinor: 6_000,
    defaultOrderDeliveryCostMinor: 1_000,
    defaultOrderSalesCostMinor: 500,
    defaultOrderServiceCostMinor: 200,
    absoluteFloorUnitPriceMinor: 7_000,
    standardDiscountLimitBps: 1_000,
    absoluteDiscountLimitBps: 3_000,
    targetGrossMarginBps: 3_000,
    absoluteMinimumGrossMarginBps: 1_000,
    standardPaymentTermDays: 30,
    absolutePaymentTermDays: 90,
    approvalThresholds: {
      discountCapability: "quote.exception.discount.approve",
      marginCapability: "quote.exception.margin.approve",
      paymentTermsCapability: "quote.exception.payment_terms.approve",
      giftCapability: "quote.exception.gift.approve",
      creditCapability: "quote.exception.credit.approve",
      manualCapability: "quote.exception.manual.approve",
      creditRiskThresholdBps: 5_000,
      manualEscalationEnabled: true
    },
    surchargePolicies: [],
    giftPolicies: [],
    validFrom: FIXED_INSTANT,
    validTo: null,
    status: "active",
    source: "native",
    capabilityRegistryVersion: "growth-capabilities.v1",
    revision: 1,
    createdBy: "admin-1",
    createdAt: FIXED_INSTANT,
    ...overrides
  };
}

export function quoteInputFixture(
  overrides: Partial<QuoteCalculationInput> = {}
): QuoteCalculationInput {
  return {
    workspaceId: "team-a",
    catalogItemId: "catalog-item-1",
    pricingPolicyVersionId: "pricing-policy-1",
    quantityMicros: 1_000_000,
    offeredUnitPriceMinor: 9_000,
    orderDiscountMinor: 0,
    paymentTermDays: 30,
    giftItems: [],
    surchargeContext: { region: null, deliveryMethod: null },
    customerTargetPriceMinor: null,
    creditRiskBps: null,
    manualEscalation: false,
    ...overrides
  };
}

export function workspaceContextFixture(
  role: Role,
  capabilities: readonly GrowthCapability[] = capabilitiesForHumanRole(role),
  actorId = `${role}-actor-1`
): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId: "team-a",
    kind: "team",
    actorId,
    role,
    teamId: "team-a",
    capabilities: Object.freeze([...capabilities]),
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

export function commandContextFixture(
  overrides: Partial<CommandContext> = {}
): CommandContext {
  const workspace = overrides.workspace ?? workspaceContextFixture("sales");
  return Object.freeze({
    workspace,
    actorId: workspace.actorId,
    idempotencyKey: "quote-command-1",
    requestHash: `sha256:${"1".padStart(64, "0")}`,
    expectedRevision: null,
    ...overrides
  });
}

export function dealFixture(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1", customerId: "customer-1", title: "Trusted Deal",
    stage: "已联系", product: "Widget", quantity: 1, unitPrice: 100,
    amount: 100, currency: "CNY", amountType: "estimate",
    ownerId: "sales-a", teamId: "team-a", nextAction: "Follow up",
    nextActionAt: "2026-08-02", expectedCloseAt: "2026-09-01",
    stageChangedAt: FIXED_INSTANT,
    ...overrides
  };
}

function candidateFixture(
  overrides: Partial<AcquisitionCandidate> = {}
): AcquisitionCandidate {
  return {
    id: "candidate-1", ownerId: "sales-a", teamId: "team-a",
    partyType: "organization",
    partyRef: { partyType: "organization", organizationId: "org-1",
      tenantProspectId: "prospect-1" },
    profile: { kind: "organization", name: "Buyer", domain: "buyer.test",
      region: "CN", creditCode: null },
    evidenceIds: ["evidence-1"], status: "converted_to_lead",
    latestDecisionId: "qualification-1", latestDecisionVersion: "decision-v1",
    approvedDecisionVersion: "decision-v1", hardGateFailures: [],
    leadId: "lead-1", createdAt: FIXED_INSTANT, updatedAt: FIXED_INSTANT,
    version: 3,
    ...overrides
  };
}

function attributionFixture() {
  return {
    attributionVersion: "acquisition-run.v1" as const,
    runId: "run-1", planId: "plan-1", planVersionId: "plan-version-1",
    planVersion: 1, planSnapshotHash: `sha256:${"1".repeat(64)}`,
    discoveredEventId: "discovered-1", discoveredAt: FIXED_INSTANT,
    shardId: "shard-1", operationId: "operation-1",
    connectionId: "connection-1", providerId: "provider-1",
    evidenceIds: ["evidence-1"], providerIds: ["provider-1"],
    queryIds: ["query-1"], strategyVersion: "strategy-v1",
    qualificationDecisionId: "qualification-1",
    decisionVersion: "decision-v1",
    decisionSnapshotHash: `sha256:${"2".repeat(64)}`
  };
}

function handoffFixture(
  overrides: Partial<AcquisitionCustomerHandoff> = {}
): AcquisitionCustomerHandoff {
  return {
    id: "handoff-1", ownerId: "sales-a", teamId: "team-a",
    candidateId: "candidate-1", leadId: "lead-1",
    customerId: "customer-1", todoId: "todo-1", dealId: "deal-1",
    decisionVersion: "decision-v1", mode: "create_new",
    processingKeyHash: `sha256:${"3".repeat(64)}`,
    acceptedProcessingKeyHashes: [`sha256:${"3".repeat(64)}`],
    requestHash: `sha256:${"4".repeat(64)}`,
    intelligence: { qualificationGrade: "A", qualificationScore: 90,
      financialGrade: "A", currency: "CNY", expectedRevenueMinor: 10000,
      expectedGrossProfitMinor: 3000, expectedContributionMinor: 2000 },
    qualificationSnapshotHash: `sha256:${"5".repeat(64)}`,
    financialSnapshotHash: `sha256:${"6".repeat(64)}`,
    acquisitionAttribution: attributionFixture(), createdAt: FIXED_INSTANT,
    ...overrides
  };
}

function leadFixture(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1", company: "Buyer", contact: "Alice", country: "CN",
    email: "alice@buyer.test", phone: "", wechat: "", source: "acquisition",
    intent: "high", stage: "converted", status: "converted",
    ownerId: "sales-a", teamId: "team-a", estimatedAmount: 100,
    nextFollowAt: "", lastActivityAt: FIXED_INSTANT, remark: "",
    convertedCustomerId: "customer-1", convertedDealId: "deal-1",
    sourceType: "outbound", sourceChannel: "acquisition", sourceCampaign: "",
    externalId: "candidate-1", sourceUrl: "https://buyer.test",
    createdAt: FIXED_INSTANT,
    ...overrides
  };
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "customer-1", company: "Buyer", country: "CN", contact: "Alice",
    ownerId: "sales-a", teamId: "team-a", stage: "询盘", amount: 100,
    health: 80, nextReminder: "", wecomBound: false, billingName: "Buyer",
    billingAddress: "", documentContact: "Alice", defaultPortDischarge: "",
    defaultIncoterm: "FOB", defaultPaymentTerm: "T/T",
    ...overrides
  };
}

export function bindingInputFixture(
  overrides: Partial<CommercialBindingInput> = {}
): CommercialBindingInput {
  return {
    candidate: candidateFixture(), handoff: handoffFixture(), lead: leadFixture(),
    customer: customerFixture(), deal: dealFixture(), verifiedAt: FIXED_INSTANT,
    ...overrides
  };
}

interface QuoteCaseFixtureOptions {
  cases?: readonly string[];
  versionStatuses?: readonly QuoteVersion["status"][];
  members?: ReadonlyArray<{
    actorId: string; workspaceId: string; role: User["role"];
    status: User["status"];
  }>;
  authorityRevision?: number;
  failAfterWork?: boolean;
}

export function quoteCaseFixture(options: QuoteCaseFixtureOptions = {}) {
  const baseTransactions = new InMemoryGrowthTemporalTransactionRunner(FIXED_INSTANT);
  const transactions = options.failAfterWork ? {
    async run<T>(work: Parameters<typeof baseTransactions.run<T>>[0]) {
      await baseTransactions.run(work);
      throw Object.assign(new Error("quote_commit_failed"), {
        code: "quote_commit_failed"
      });
    }
  } : baseTransactions;
  const temporalBarrier = new DefaultGrowthTemporalBarrier(transactions);
  const cases: QuoteCase[] = (options.cases ?? []).map((id) => ({
    id, workspaceId: "team-a", candidateId: "candidate-1", customerId: null,
    dealId: null, assignedTo: "sales-a", status: "open",
    currentDraftVersionId: null, revision: 1,
    commercialBindingSnapshot: null, createdAt: FIXED_INSTANT,
    updatedAt: FIXED_INSTANT
  }));
  const versions: QuoteVersion[] = (options.versionStatuses ?? []).map((status, index) => {
    const formal = status !== "draft";
    return {
      id: `version-${index + 1}`, workspaceId: "team-a", quoteCaseId: "case-a",
      version: index + 1, lifecycleRevision: 1,
      versionKind: formal ? "formal" : "draft",
      sourceDraftVersionId: formal ? `source-draft-${index + 1}` : null,
      probabilityAssessmentSnapshot: formal ? probabilityRecordFixture({ dealId: "deal-1" }) : null,
      status, createdBy: "sales-a", createdAt: FIXED_INSTANT,
      effectiveAt: FIXED_INSTANT, recordedAt: FIXED_INSTANT,
      temporalSequence: index + 1
    };
  });
  const repository = new InMemoryQuoteRepository(transactions, temporalBarrier, {
    cases, versions
  });
  const source = bindingInputFixture();
  const sourceState = {
    acquisitionCustomerHandoffs: [source.handoff],
    leads: [source.lead as Lead], customers: [source.customer as Customer],
    deals: [source.deal],
    async findCandidate(workspaceId: string, candidateId: string) {
      return workspaceId === source.candidate.teamId
        && candidateId === source.candidate.id ? source.candidate : null;
    },
    async findCurrentDealAuthority(workspaceId: string, dealId: string) {
      if (!options.authorityRevision || dealId !== "deal-1") return null;
      const snapshot = createCommercialBindingSnapshot(source);
      return { workspaceId, dealId, customerId: "customer-1",
        dealContentHash: snapshot.dealContentHash,
        authorityRevision: options.authorityRevision };
    }
  };
  const bindingVerifier = new CommercialBindingVerifier(sourceState,
    () => FIXED_INSTANT);
  const defaultMembers = [
    { actorId: "sales-a", workspaceId: "team-a", role: "sales" as const,
      status: "active" as const },
    { actorId: "sales-b", workspaceId: "team-a", role: "sales" as const,
      status: "active" as const }
  ];
  const members = options.members ?? defaultMembers;
  const assignments = createGrowthWorkspaceMemberAssignabilityReader({
    members: () => members.map((member) => ({
      id: member.actorId, teamId: member.workspaceId,
      role: member.role, status: member.status
    }))
  });
  const baseIdempotency = new InMemoryGrowthHttpIdempotencyRepository();
  let completed = 0;
  const httpIdempotency: GrowthHttpIdempotencyRepository = {
    reserve: (input) => baseIdempotency.reserve(input),
    async complete(...args) { await baseIdempotency.complete(...args); completed += 1; },
    release: (...args) => baseIdempotency.release(...args)
  };
  let assessment = probabilityRecordFixture();
  const probabilityAssessments = {
    async append(record: ProbabilityAssessmentV2) { assessment = record; return record; },
    async findCurrent(workspaceId: string, candidateId: string) {
      return assessment.workspaceId === workspaceId
        && assessment.candidateId === candidateId ? assessment : null;
    },
    async bindDeal(workspaceId: string, id: string, dealId: string) {
      if (assessment.workspaceId !== workspaceId || assessment.id !== id) {
        throw Object.assign(new Error("probability_assessment_not_found"),
          { code: "probability_assessment_not_found" });
      }
      if (assessment.dealId && assessment.dealId !== dealId) {
        throw Object.assign(new Error("probability_assessment_deal_already_bound"),
          { code: "probability_assessment_deal_already_bound" });
      }
      assessment = Object.freeze({ ...assessment, dealId });
      return assessment;
    }
  };
  let nextId = 0;
  const service = new QuoteCaseService({
    repository, httpIdempotency, assignments,
    subjects: {
      async resolve(context, requested) {
        if (context.workspaceId !== "team-a"
          || requested.candidateId === "candidate-cross") return null;
        if (requested.dealId && requested.dealId !== "deal-1") return null;
        if (requested.customerId && requested.customerId !== "customer-1") return null;
        if (requested.candidateId && requested.candidateId !== "candidate-1") return null;
        return {
          candidateId: requested.candidateId ?? (requested.dealId ? "candidate-1" : null),
          customerId: requested.customerId ?? (requested.dealId ? "customer-1" : null),
          dealId: requested.dealId ?? null
        };
      }
    },
    bindingVerifier, probabilityAssessments,
    now: () => FIXED_INSTANT,
    idFactory: () => `case-created-${++nextId}`,
    leaseOwner: "quote-fixture", leaseDurationMs: 30_000
  });
  return {
    repository, service, bindingVerifier,
    completedIdempotencyCount: () => completed,
    command(overrides: Partial<CommandContext> & { role?: Role } = {}) {
      const role = overrides.role ?? "sales";
      const actorId = overrides.actorId ?? (role === "sales" ? "sales-a" : `${role}-a`);
      const workspace = workspaceContextFixture(role, undefined, actorId);
      return commandContextFixture({
        workspace, actorId, idempotencyKey: "quote-fixture-command",
        ...overrides
      } as Partial<CommandContext>);
    }
  };
}
