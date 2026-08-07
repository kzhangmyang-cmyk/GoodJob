import assert from "node:assert/strict";
import test from "node:test";
import type { OutcomeInput } from "./acquisition-domain.js";
import {
  AcquisitionCandidateRunAttributionResolver,
  AcquisitionCrmOutcomeReconciliationService,
  type AcquisitionCrmOutcomeReconciliationStore
} from "./acquisition-crm-outcome-reconciliation.js";
import type {
  AcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";

const attribution = {
  runId: "run-real",
  planId: "plan-real",
  planVersionId: "plan-version-real",
  planVersion: 2,
  planSnapshotHash: `sha256:${"a".repeat(64)}`,
  discoveredEventId: "run-event-discovered",
  discoveredAt: "2026-08-01T01:00:00.000Z",
  shardId: "shard-real",
  operationId: "operation-real",
  connectionId: "connection-real",
  providerId: "provider-real",
  evidenceIds: ["evidence-real"],
  providerIds: ["provider-real"],
  queryIds: ["operation:operation-real"],
  strategyVersion: "acquisition-plan-v2",
  qualificationDecisionId: "decision-real",
  decisionVersion: "decision-v2",
  decisionSnapshotHash: `sha256:${"b".repeat(64)}`
};

function store(): AcquisitionCrmOutcomeReconciliationStore {
  return {
    leads: [{
      id: "lead-real",
      ownerId: "owner-real",
      teamId: "team-real",
      convertedCustomerId: "customer-real",
      convertedDealId: "deal-real",
      externalId: "candidate-real"
    }],
    leadActivities: [{
      id: "activity-call",
      leadId: "lead-real",
      type: "call",
      content: "called buyer",
      operatorId: "owner-real",
      nextFollowAt: "",
      createdAt: "2026-08-02T01:00:00.000Z"
    }, {
      id: "activity-system",
      leadId: "lead-real",
      type: "system",
      content: "created by system",
      operatorId: "owner-real",
      nextFollowAt: "",
      createdAt: "2026-08-02T00:00:00.000Z"
    }],
    leadSourceEvents: [{
      id: "source-real",
      leadId: "lead-real",
      sourceType: "outbound",
      channel: "acquisition_private_domain_handoff_snapshot",
      campaign: "decision-v2",
      externalId: "candidate-real",
      sourceUrl: "https://example.test/evidence",
      occurredAt: "2026-08-01T02:00:00.000Z",
      receivedAt: "2026-08-01T02:00:00.000Z",
      rawPayload: JSON.stringify({
        candidateId: "candidate-real",
        acquisitionAttribution: attribution
      }),
      ownerId: "owner-real",
      teamId: "team-real"
    }],
    acquisitionCustomerHandoffs: [{
      candidateId: "candidate-real",
      leadId: "lead-real",
      customerId: "customer-real",
      ownerId: "owner-real",
      teamId: "team-real"
    }],
    deals: [{
      id: "deal-real",
      customerId: "customer-real",
      ownerId: "owner-real",
      teamId: "team-real",
      amount: 1288.5,
      currency: "USD"
    }],
    dealEvents: [{
      id: "event-quote",
      dealId: "deal-real",
      type: "quote",
      content: "quote sent",
      operatorId: "owner-real",
      createdAt: "2026-08-03T01:00:00.000Z"
    }, {
      id: "event-payment",
      dealId: "deal-real",
      type: "payment",
      content: "sales-entered payment",
      operatorId: "owner-real",
      createdAt: "2026-08-04T01:00:00.000Z"
    }, {
      id: "event-won",
      dealId: "deal-real",
      type: "won",
      content: "deal won",
      operatorId: "owner-real",
      createdAt: "2026-08-05T01:00:00.000Z"
    }],
    acquisitionOutcomeReconciliationDiagnostics: [],
    acquisitionOutcomeReconciliationCheckpoints: [],
    async persist() {},
    async readBarrier() {}
  };
}

function persistedPlanRuns(overrides: {
  providerId?: string;
  ownerId?: string;
  teamId?: string;
} = {}) {
  const ownerId = overrides.ownerId ?? "owner-real";
  const teamId = overrides.teamId ?? "team-real";
  const run = {
    id: "run-real",
    ownerId,
    teamId,
    planId: "plan-real",
    planVersionId: "plan-version-real",
    planVersion: 2,
    planSnapshotHash: `sha256:${"a".repeat(64)}`
  };
  return {
    async getRun(id: string) { return id === run.id ? run : null; },
    async listRunEvents() {
      return [{
        id: "run-event-discovered",
        runId: run.id,
        shardId: "shard-real",
        ownerId,
        teamId,
        type: "candidate.discovered",
        at: "2026-08-01T01:00:00.000Z",
        data: {
          candidateId: "candidate-real",
          operationId: "operation-real",
          connectionId: "connection-real"
        }
      }];
    },
    async listRunShards() {
      return [{
        id: "shard-real",
        runId: run.id,
        ownerId,
        teamId,
        operationId: "operation-real",
        connection: {
          connectionId: "connection-real",
          providerId: overrides.providerId ?? "provider-real"
        }
      }];
    }
  } as unknown as Pick<
    AcquisitionPlanRunRepository,
    "getRun" | "listRunEvents" | "listRunShards"
  >;
}

test("reconciles durable CRM activities and deal events without treating payment as verified cash", async () => {
  const recorded: OutcomeInput[] = [];
  const service = new AcquisitionCrmOutcomeReconciliationService({
    store: store(),
    planRuns: persistedPlanRuns(),
    outcomeRecorder: {
      async recordOutcome(_scope, input) {
        recorded.push(structuredClone(input));
        return { id: `outcome-${recorded.length}` };
      }
    },
    now: () => "2026-08-07T08:00:00.000Z"
  });

  const result = await service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  }, { limit: 500 });

  assert.deepEqual(recorded.map((item) => [
    item.eventType,
    item.idempotencyKey,
    item.amount
  ]), [
    ["contacted", "crm:lead-activity:activity-call", null],
    ["quoted", "crm:deal-event:event-quote", {
      amountMinor: 128_850,
      currency: "USD"
    }],
    ["won", "crm:deal-event:event-won", {
      amountMinor: 128_850,
      currency: "USD"
    }]
  ]);
  assert.equal(recorded.some((item) => item.eventType === "payment_received"), false);
  assert.deepEqual(result, {
    scanned: 5,
    reconciled: 3,
    skipped: 2,
    failed: 0,
    lastReconciledAt: "2026-08-07T08:00:00.000Z"
  });
});

test("leaves the checkpoint before an Outcome failure so the durable CRM event can be retried", async () => {
  const reconciled: string[] = [];
  const service = new AcquisitionCrmOutcomeReconciliationService({
    store: store(),
    planRuns: persistedPlanRuns(),
    outcomeRecorder: {
      async recordOutcome(_scope, input) {
        if (input.idempotencyKey === "crm:lead-activity:activity-call") {
          throw new Error("temporary outcome store failure");
        }
        reconciled.push(input.idempotencyKey);
        return { id: input.idempotencyKey };
      }
    },
    now: () => "2026-08-07T08:00:00.000Z"
  });

  const result = await service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  });

  assert.equal(result.failed, 1);
  assert.deepEqual(reconciled, []);
});

test("does not starve a reconcilable CRM event behind an older fixed-size scan window", async () => {
  const fixture = store();
  fixture.dealEvents = [];
  fixture.leadActivities = [
    ...Array.from({ length: 500 }, (_, index) => ({
      id: `activity-system-${String(index).padStart(3, "0")}`,
      leadId: "lead-real",
      type: "system" as const,
      content: "system history",
      operatorId: "owner-real",
      nextFollowAt: "",
      createdAt: `2026-08-01T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`
    })),
    {
      id: "activity-call-newer",
      leadId: "lead-real",
      type: "call",
      content: "newer durable call",
      operatorId: "owner-real",
      nextFollowAt: "",
      createdAt: "2026-08-02T12:00:00.000Z"
    }
  ];
  const recorded: OutcomeInput[] = [];
  const service = new AcquisitionCrmOutcomeReconciliationService({
    store: fixture,
    planRuns: persistedPlanRuns(),
    outcomeRecorder: {
      async recordOutcome(_scope, input) {
        recorded.push(structuredClone(input));
        return { id: input.idempotencyKey };
      }
    }
  });

  await service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  }, { limit: 500 });
  await service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  }, { limit: 500 });

  assert.deepEqual(recorded.map((item) => item.idempotencyKey), [
    "crm:lead-activity:activity-call-newer"
  ]);
});

test("worker reconciliation is tenant-scoped and advances a durable paged checkpoint", async () => {
  const fixture = store() as AcquisitionCrmOutcomeReconciliationStore & {
    acquisitionOutcomeReconciliationCheckpoints: Array<{
      ownerId: string;
      teamId: string;
      cursorOccurredAt: string;
      cursorSourceKind: "lead_activity" | "deal_event";
      cursorSourceId: string;
      updatedAt: string;
    }>;
  };
  fixture.acquisitionOutcomeReconciliationCheckpoints = [];
  fixture.dealEvents = [];
  fixture.leads.push({
    id: "lead-other",
    ownerId: "owner-other",
    teamId: "team-other",
    convertedCustomerId: "",
    convertedDealId: "",
    externalId: "candidate-other"
  });
  fixture.leadActivities.push({
    id: "activity-other",
    leadId: "lead-other",
    type: "call",
    content: "other tenant call",
    operatorId: "owner-other",
    nextFollowAt: "",
    createdAt: "2026-08-01T23:00:00.000Z"
  });
  const recorded: OutcomeInput[] = [];
  const service = new AcquisitionCrmOutcomeReconciliationService({
    store: fixture,
    planRuns: persistedPlanRuns(),
    outcomeRecorder: {
      async recordOutcome(_scope, input) {
        recorded.push(structuredClone(input));
        return { id: input.idempotencyKey };
      }
    },
    now: () => "2026-08-07T08:00:00.000Z"
  });

  const first = await service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  }, { limit: 1 });
  const second = await service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  }, { limit: 1 });

  assert.equal(first.scanned, 1);
  assert.equal(second.scanned, 1);
  assert.deepEqual(recorded.map((item) => item.idempotencyKey), [
    "crm:lead-activity:activity-call"
  ]);
  assert.deepEqual(fixture.acquisitionOutcomeReconciliationCheckpoints, [{
    ownerId: "owner-real",
    teamId: "team-real",
    cursorOccurredAt: "2026-08-02T01:00:00.000Z",
    cursorSourceKind: "lead_activity",
    cursorSourceId: "activity-call",
    updatedAt: "2026-08-07T08:00:00.000Z"
  }]);
});

test("revalidates the complete persisted run attribution chain and candidate identity", async () => {
  const fixture = store();
  fixture.leadActivities = fixture.leadActivities.filter((item) =>
    item.id === "activity-call");
  fixture.dealEvents = [];
  const recorded: OutcomeInput[] = [];
  const service = new AcquisitionCrmOutcomeReconciliationService({
    store: fixture,
    planRuns: persistedPlanRuns({ providerId: "provider-forged" }),
    outcomeRecorder: {
      async recordOutcome(_scope, input) {
        recorded.push(input);
        return { id: "unexpected" };
      }
    }
  });

  await service.runTenant({ ownerId: "owner-real", teamId: "team-real" }, {
    limit: 1
  });

  assert.deepEqual(recorded, []);
  assert.equal(fixture.acquisitionOutcomeReconciliationDiagnostics[0]?.code,
    "attribution_invalid");
});

test("rejects an ambiguous deal-to-handoff binding instead of selecting array order", async () => {
  const fixture = store();
  fixture.leadActivities = [];
  fixture.dealEvents = [fixture.dealEvents[0]];
  fixture.leads.push({
    id: "lead-second",
    ownerId: "owner-real",
    teamId: "team-real",
    convertedCustomerId: "customer-real",
    convertedDealId: "deal-real",
    externalId: "candidate-second"
  });
  fixture.acquisitionCustomerHandoffs.push({
    candidateId: "candidate-second",
    leadId: "lead-second",
    customerId: "customer-real",
    ownerId: "owner-real",
    teamId: "team-real"
  });
  const service = new AcquisitionCrmOutcomeReconciliationService({
    store: fixture,
    planRuns: persistedPlanRuns(),
    outcomeRecorder: { async recordOutcome() { throw new Error("unexpected"); } }
  });

  const result = await service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  });

  assert.equal(result.reconciled, 0);
  assert.equal(fixture.acquisitionOutcomeReconciliationDiagnostics[0]?.code,
    "deal_binding_ambiguous");
});

test("rolls back a failed diagnostic write so the same source remains retryable", async () => {
  const fixture = store();
  fixture.leadSourceEvents = [];
  fixture.dealEvents = [];
  fixture.leadActivities = fixture.leadActivities.filter((item) =>
    item.id === "activity-call");
  let failPersist = true;
  fixture.persist = async () => {
    if (failPersist) throw new Error("diagnostic store unavailable");
  };
  const service = new AcquisitionCrmOutcomeReconciliationService({
    store: fixture,
    planRuns: persistedPlanRuns(),
    outcomeRecorder: { async recordOutcome() { throw new Error("unexpected"); } }
  });

  await assert.rejects(service.runTenant({
    ownerId: "owner-real",
    teamId: "team-real"
  }), /diagnostic store unavailable/);
  assert.deepEqual(fixture.acquisitionOutcomeReconciliationDiagnostics, []);
  assert.deepEqual(fixture.acquisitionOutcomeReconciliationCheckpoints, []);

  failPersist = false;
  await service.runTenant({ ownerId: "owner-real", teamId: "team-real" });
  assert.equal(fixture.acquisitionOutcomeReconciliationDiagnostics.length, 1);
});

test("resolves attribution only from a persisted candidate.discovered event in a real acquisition run", async () => {
  const run = {
    id: "run-real",
    ownerId: "owner-real",
    teamId: "team-real",
    planId: "plan-real",
    planVersionId: "plan-version-real",
    planVersion: 2,
    planSnapshotHash: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T02:00:00.000Z"
  };
  const planRuns = {
    async listRuns() { return [run]; },
    async listRunEvents(runId: string) {
      assert.equal(runId, run.id);
      return [{
        id: "run-event-discovered",
        runId: run.id,
        shardId: "shard-real",
        ownerId: run.ownerId,
        teamId: run.teamId,
        type: "candidate.discovered",
        actorId: "worker",
        revision: 4,
        at: "2026-08-01T01:00:00.000Z",
        data: {
          candidateId: "candidate-real",
          operationId: "operation-real",
          connectionId: "connection-real"
        }
      }];
    },
    async listRunShards() {
      return [{
        id: "shard-real",
        runId: run.id,
        ownerId: run.ownerId,
        teamId: run.teamId,
        operationId: "operation-real",
        connection: {
          connectionId: "connection-real",
          providerId: "provider-real"
        }
      }];
    }
  } as unknown as Pick<
    AcquisitionPlanRunRepository,
    "listRuns" | "listRunEvents" | "listRunShards"
  >;
  const resolver = new AcquisitionCandidateRunAttributionResolver({
    planRuns
  });

  const result = await resolver.resolve({
    ownerId: "owner-real",
    teamId: "team-real"
  }, {
    candidateId: "candidate-real",
    evidenceIds: ["evidence-real"],
    qualificationDecisionId: "decision-real",
    decisionVersion: "decision-v2",
    decisionSnapshotHash: `sha256:${"b".repeat(64)}`
  });

  assert.deepEqual(result, attribution);
});

test("does not substitute a Copilot session for a missing acquisition run", async () => {
  const resolver = new AcquisitionCandidateRunAttributionResolver({
    planRuns: {
      async listRuns() { return []; },
      async listRunEvents() { return []; },
      async listRunShards() { return []; }
    } as unknown as Pick<
      AcquisitionPlanRunRepository,
      "listRuns" | "listRunEvents" | "listRunShards"
    >
  });

  assert.equal(await resolver.resolve({
    ownerId: "owner-real",
    teamId: "team-real"
  }, {
    candidateId: "candidate-real",
    evidenceIds: ["evidence-real"],
    qualificationDecisionId: "decision-real",
    decisionVersion: "decision-v2",
    decisionSnapshotHash: `sha256:${"b".repeat(64)}`
  }), null);
});
