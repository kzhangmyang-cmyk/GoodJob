import { createHash } from "node:crypto";
import type {
  OutcomeAttributionInput,
  OutcomeEventType,
  OutcomeInput
} from "./acquisition-domain.js";
import type { AcquisitionActorScope } from "./acquisition-domain-service.js";
import type {
  AcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";
import type {
  AcquisitionOutcomeReconciliationDiagnostic,
  Deal,
  DealEvent,
  Lead,
  LeadActivity,
  LeadSourceEvent
} from "./types.js";

type ReconciliationLead = Pick<
  Lead,
  "id" | "ownerId" | "teamId" | "convertedCustomerId"
>;
type ReconciliationDeal = Pick<
  Deal,
  "id" | "customerId" | "ownerId" | "teamId" | "amount" | "currency"
>;

export interface AcquisitionCandidateRunAttributionInput {
  candidateId: string;
  evidenceIds: string[];
  qualificationDecisionId: string;
  decisionVersion: string;
  decisionSnapshotHash: string;
}

export class AcquisitionCandidateRunAttributionResolver {
  readonly #planRuns: Pick<
    AcquisitionPlanRunRepository,
    "listRuns" | "listRunEvents" | "listRunShards"
  >;

  constructor(options: {
    planRuns: Pick<
      AcquisitionPlanRunRepository,
      "listRuns" | "listRunEvents" | "listRunShards"
    >;
  }) {
    this.#planRuns = options.planRuns;
  }

  async resolve(
    scope: { ownerId: string; teamId: string },
    input: AcquisitionCandidateRunAttributionInput
  ): Promise<OutcomeAttributionInput | null> {
    const runs = (await this.#planRuns.listRuns(scope))
      .filter((run) =>
        run.ownerId === scope.ownerId && run.teamId === scope.teamId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
        || right.id.localeCompare(left.id));
    for (const run of runs) {
      const event = (await this.#planRuns.listRunEvents(run.id))
        .filter((item) =>
          item.runId === run.id
          && item.ownerId === scope.ownerId
          && item.teamId === scope.teamId
          && item.type === "candidate.discovered"
          && item.data.candidateId === input.candidateId
          && isText(item.data.operationId)
          && isText(item.data.connectionId)
          && isText(item.shardId))
        .sort((left, right) =>
          right.at.localeCompare(left.at) || right.id.localeCompare(left.id))[0];
      if (!event?.shardId) continue;
      const shard = (await this.#planRuns.listRunShards(run.id)).find((item) =>
        item.id === event.shardId
        && item.runId === run.id
        && item.ownerId === scope.ownerId
        && item.teamId === scope.teamId
        && item.operationId === event.data.operationId
        && item.connection.connectionId === event.data.connectionId);
      if (!shard) continue;
      return {
        runId: run.id,
        planId: run.planId,
        planVersionId: run.planVersionId,
        planVersion: run.planVersion,
        planSnapshotHash: run.planSnapshotHash,
        discoveredEventId: event.id,
        discoveredAt: event.at,
        shardId: shard.id,
        operationId: shard.operationId,
        connectionId: shard.connection.connectionId,
        providerId: shard.connection.providerId,
        evidenceIds: [...new Set(input.evidenceIds)],
        providerIds: [shard.connection.providerId],
        queryIds: [`operation:${shard.operationId}`],
        strategyVersion: `acquisition-plan-v${run.planVersion}`,
        qualificationDecisionId: input.qualificationDecisionId,
        decisionVersion: input.decisionVersion,
        decisionSnapshotHash: input.decisionSnapshotHash
      };
    }
    return null;
  }
}

export interface AcquisitionCrmOutcomeReconciliationStore {
  leads: ReconciliationLead[];
  leadActivities: LeadActivity[];
  leadSourceEvents: LeadSourceEvent[];
  acquisitionCustomerHandoffs: Array<{
    candidateId: string;
    leadId: string;
    customerId: string;
    ownerId: string;
    teamId: string;
  }>;
  deals: ReconciliationDeal[];
  dealEvents: DealEvent[];
  acquisitionOutcomeReconciliationDiagnostics:
    AcquisitionOutcomeReconciliationDiagnostic[];
  persist(): Promise<void>;
  readBarrier(): Promise<void>;
}

export interface AcquisitionOutcomeRecorder {
  recordOutcome(
    scope: AcquisitionActorScope,
    input: OutcomeInput
  ): Promise<unknown>;
}

export interface AcquisitionCrmOutcomeReconciliationResult {
  scanned: number;
  reconciled: number;
  skipped: number;
  failed: number;
  lastReconciledAt: string;
}

const CONTACT_ACTIVITY_TYPES = new Set<LeadActivity["type"]>([
  "call",
  "wechat",
  "whatsapp",
  "linkedin",
  "email",
  "meeting"
]);

const DEAL_OUTCOMES: Partial<Record<DealEvent["type"], OutcomeEventType>> = {
  quote: "quoted",
  won: "won",
  lost: "lost"
};

function diagnosticId(sourceKind: string, sourceId: string, code: string) {
  return `acq_reconcile_${createHash("sha256")
    .update([sourceKind, sourceId, code].join("\u001f"))
    .digest("hex")
    .slice(0, 40)}`;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validAttribution(value: unknown): value is OutcomeAttributionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const textFields = [
    "runId",
    "planId",
    "planVersionId",
    "planSnapshotHash",
    "discoveredEventId",
    "discoveredAt",
    "shardId",
    "operationId",
    "connectionId",
    "providerId",
    "strategyVersion",
    "qualificationDecisionId",
    "decisionVersion",
    "decisionSnapshotHash"
  ];
  return textFields.every((field) => isText(item[field]))
    && Number.isSafeInteger(item.planVersion)
    && Number(item.planVersion) > 0
    && ["evidenceIds", "providerIds", "queryIds"].every((field) =>
      Array.isArray(item[field])
      && (item[field] as unknown[]).every(isText));
}

function amountForDeal(deal: ReconciliationDeal) {
  if (!Number.isFinite(deal.amount) || deal.amount < 0) return null;
  const currency = deal.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const amountMinor = Math.round(deal.amount * 100);
  return Number.isSafeInteger(amountMinor)
    ? { amountMinor, currency }
    : null;
}

export class AcquisitionCrmOutcomeReconciliationService {
  readonly #store: AcquisitionCrmOutcomeReconciliationStore;
  readonly #outcomeRecorder: AcquisitionOutcomeRecorder;
  readonly #now: () => string;

  constructor(options: {
    store: AcquisitionCrmOutcomeReconciliationStore;
    outcomeRecorder: AcquisitionOutcomeRecorder;
    now?: () => string;
  }) {
    this.#store = options.store;
    this.#outcomeRecorder = options.outcomeRecorder;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async runOnce() {
    await this.#store.readBarrier();
    const sources = [
      ...this.#store.leadActivities.map((event) => ({
        sourceKind: "lead_activity" as const,
        event,
        occurredAt: event.createdAt
      })),
      ...this.#store.dealEvents.map((event) => ({
        sourceKind: "deal_event" as const,
        event,
        occurredAt: event.createdAt
      }))
    ].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
      || left.event.id.localeCompare(right.event.id));
    const result: AcquisitionCrmOutcomeReconciliationResult = {
      scanned: sources.length,
      reconciled: 0,
      skipped: 0,
      failed: 0,
      lastReconciledAt: new Date(this.#now()).toISOString()
    };
    for (const source of sources) {
      const mapped = source.sourceKind === "lead_activity"
        ? this.#leadActivityInput(source.event as LeadActivity)
        : this.#dealEventInput(source.event as DealEvent);
      if (!mapped) {
        result.skipped += 1;
        continue;
      }
      if ("diagnostic" in mapped && mapped.diagnostic) {
        await this.#recordDiagnostic(mapped.diagnostic, result.lastReconciledAt);
        result.skipped += 1;
        continue;
      }
      try {
        await this.#outcomeRecorder.recordOutcome(mapped.scope, mapped.input);
        result.reconciled += 1;
      } catch (error) {
        result.failed += 1;
        await this.#recordDiagnostic({
          ownerId: mapped.scope.ownerId,
          teamId: mapped.scope.teamId,
          sourceKind: source.sourceKind,
          sourceId: source.event.id,
          candidateId: mapped.input.candidateId,
          code: "outcome_write_failed",
          message: error instanceof Error ? error.message : "Outcome write failed",
          occurredAt: source.occurredAt
        }, result.lastReconciledAt);
      }
    }
    return result;
  }

  #leadActivityInput(activity: LeadActivity) {
    if (!CONTACT_ACTIVITY_TYPES.has(activity.type)) return null;
    const lead = this.#store.leads.find((item) => item.id === activity.leadId);
    if (!lead) return null;
    return this.#outcomeInput({
      sourceKind: "lead_activity",
      sourceId: activity.id,
      lead,
      customerId: lead.convertedCustomerId || null,
      eventType: "contacted",
      occurredAt: activity.createdAt,
      amount: null,
      reasonText: activity.content
    });
  }

  #dealEventInput(event: DealEvent) {
    const eventType = DEAL_OUTCOMES[event.type];
    if (!eventType) return null;
    const deal = this.#store.deals.find((item) => item.id === event.dealId);
    if (!deal) return null;
    const handoff = this.#store.acquisitionCustomerHandoffs.find((item) =>
      item.customerId === deal.customerId
      && item.ownerId === deal.ownerId
      && item.teamId === deal.teamId);
    if (!handoff) return null;
    const lead = this.#store.leads.find((item) =>
      item.id === handoff.leadId
      && item.ownerId === deal.ownerId
      && item.teamId === deal.teamId);
    if (!lead) return null;
    return this.#outcomeInput({
      sourceKind: "deal_event",
      sourceId: event.id,
      lead,
      customerId: deal.customerId,
      eventType,
      occurredAt: event.createdAt,
      amount: amountForDeal(deal),
      reasonText: event.content
    });
  }

  #outcomeInput(input: {
    sourceKind: "lead_activity" | "deal_event";
    sourceId: string;
    lead: ReconciliationLead;
    customerId: string | null;
    eventType: OutcomeEventType;
    occurredAt: string;
    amount: OutcomeInput["amount"];
    reasonText: string;
  }) {
    const source = this.#store.leadSourceEvents
      .filter((item) =>
        item.leadId === input.lead.id
        && item.channel === "acquisition_private_domain_handoff_snapshot")
      .sort((left, right) =>
        right.receivedAt.localeCompare(left.receivedAt)
        || right.id.localeCompare(left.id))[0];
    const baseDiagnostic = {
      ownerId: input.lead.ownerId,
      teamId: input.lead.teamId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      candidateId: source?.externalId ?? null,
      occurredAt: input.occurredAt
    };
    if (!source) {
      return { diagnostic: {
        ...baseDiagnostic,
        code: "attribution_missing" as const,
        message: "Acquisition handoff attribution is missing"
      } };
    }
    if (source.ownerId !== input.lead.ownerId
      || source.teamId !== input.lead.teamId) {
      return { diagnostic: {
        ...baseDiagnostic,
        code: "attribution_cross_tenant" as const,
        message: "Acquisition handoff attribution crosses tenant scope"
      } };
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(source.rawPayload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const candidateId = isText(payload.candidateId)
      ? payload.candidateId
      : source.externalId;
    if (!candidateId || !validAttribution(payload.acquisitionAttribution)) {
      return { diagnostic: {
        ...baseDiagnostic,
        candidateId: candidateId || null,
        code: payload.acquisitionAttribution === null
          ? "attribution_missing" as const
          : "attribution_invalid" as const,
        message: "Acquisition handoff attribution is absent or invalid"
      } };
    }
    const scope: AcquisitionActorScope = {
      ownerId: input.lead.ownerId,
      teamId: input.lead.teamId,
      actorId: "acquisition-crm-reconciliation"
    };
    const outcome: OutcomeInput = {
      leadId: input.lead.id,
      customerId: input.customerId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      amount: input.amount,
      reasonCode: `crm_${input.sourceKind}_${input.eventType}`,
      reasonText: input.reasonText || null,
      candidateId,
      idempotencyKey: `crm:${input.sourceKind.replace("_", "-")}:${input.sourceId}`,
      attribution: structuredClone(payload.acquisitionAttribution)
    };
    return { scope, input: outcome };
  }

  async #recordDiagnostic(
    input: Omit<AcquisitionOutcomeReconciliationDiagnostic, "id" | "createdAt">,
    createdAt: string
  ) {
    const id = diagnosticId(input.sourceKind, input.sourceId, input.code);
    if (this.#store.acquisitionOutcomeReconciliationDiagnostics.some(
      (item) => item.id === id
    )) return;
    this.#store.acquisitionOutcomeReconciliationDiagnostics.push({
      id,
      ...input,
      message: input.message.slice(0, 500),
      createdAt
    });
    try {
      await this.#store.persist();
    } catch {
      // The CRM source event is already durable. A later scan can retry both
      // the Outcome write and the diagnostic without rolling CRM back.
    }
  }
}
