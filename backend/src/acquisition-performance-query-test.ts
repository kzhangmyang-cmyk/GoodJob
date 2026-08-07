import assert from "node:assert/strict";
import test from "node:test";
import {
  AcquisitionPerformanceQueryService
} from "./acquisition-performance-query.js";

const scope = { ownerId: "owner-a", teamId: "team-a" };

function fixture() {
  const runs = [{
    id: "run-a",
    ownerId: scope.ownerId,
    teamId: scope.teamId,
    planVersionId: "version-a",
    billingCurrency: "CNY",
    consumedBudget: {
      requests: 2,
      results: 3,
      amountMinor: 300,
      durationSeconds: 10
    },
    createdAt: "2026-08-01T00:00:00.000Z"
  }];
  const candidateIds = ["candidate-a", "candidate-b", "candidate-c"];
  const candidates = [
    {
      candidate: {
        id: "candidate-a",
        ownerId: scope.ownerId,
        teamId: scope.teamId,
        status: "converted_to_lead",
        approvedDecisionVersion: "decision-v1"
      },
      qualification: { grade: "A" },
      financial: { currency: "USD", expectedRevenueMinor: 12_000 },
      sourcePlatforms: ["douyin"]
    },
    {
      candidate: {
        id: "candidate-b",
        ownerId: scope.ownerId,
        teamId: scope.teamId,
        status: "approved",
        approvedDecisionVersion: "decision-v1"
      },
      qualification: { grade: "C" },
      financial: { currency: "CNY", expectedRevenueMinor: 50_000 },
      sourcePlatforms: ["douyin"]
    },
    {
      candidate: {
        id: "candidate-c",
        ownerId: scope.ownerId,
        teamId: scope.teamId,
        status: "discovered",
        approvedDecisionVersion: null
      },
      qualification: null,
      financial: null,
      sourcePlatforms: ["douyin"]
    }
  ];
  const outcomes = new Map<string, Array<Record<string, unknown>>>([
    ["candidate-a", [{
      id: "outcome-contacted",
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      candidateId: "candidate-a",
      eventType: "contacted",
      occurredAt: "2026-08-02T00:00:00.000Z",
      amount: null
    }, {
      id: "outcome-quoted",
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      candidateId: "candidate-a",
      eventType: "quoted",
      occurredAt: "2026-08-03T00:00:00.000Z",
      amount: { amountMinor: 10_000, currency: "USD" }
    }, {
      id: "outcome-won",
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      candidateId: "candidate-a",
      eventType: "won",
      occurredAt: "2026-08-04T00:00:00.000Z",
      amount: { amountMinor: 9_000, currency: "USD" }
    }]],
    ["candidate-b", [{
      id: "outcome-lost",
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      candidateId: "candidate-b",
      eventType: "lost",
      occurredAt: "2026-08-05T00:00:00.000Z",
      amount: null
    }]]
  ]);
  return new AcquisitionPerformanceQueryService({
    planRuns: {
      async listRuns() { return runs; },
      async getPlanVersion() {
        return { payload: { targetPlatform: "douyin" } };
      },
      async listRunEvents() {
        return candidateIds.map((candidateId, index) => ({
          id: `event-${index}`,
          runId: "run-a",
          ownerId: scope.ownerId,
          teamId: scope.teamId,
          type: "candidate.discovered",
          at: `2026-08-0${index + 1}T01:00:00.000Z`,
          data: { candidateId }
        }));
      }
    } as never,
    domain: {
      async getPresentationCandidateSnapshots(
        _scope: unknown,
        ids: string[]
      ) {
        assert.deepEqual(ids.sort(), candidateIds);
        return candidates;
      },
      async listOutcomes(_scope: unknown, candidateId: string) {
        return outcomes.get(candidateId) ?? [];
      }
    } as never,
    diagnostics: [],
    reconcile: {
      async runOnce() {
        return { lastReconciledAt: "2026-08-07T08:00:00.000Z" };
      }
    }
  });
}

test("aggregates candidate-deduplicated funnel, currency-separated values and conservative ROI", async () => {
  const result = await fixture().get(scope, {
    platform: "douyin",
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-07T23:59:59.999Z"
  });

  assert.deepEqual(result.counts, {
    discovered: 3,
    highIntent: 1,
    approved: 2,
    converted: 1,
    contacted: 1,
    quoted: 1,
    won: 1,
    lost: 1
  });
  assert.deepEqual(result.rates, {
    highIntentRate: 1 / 3,
    approvalRate: 2 / 3,
    crmConversionRate: 1 / 2,
    contactRate: 1,
    quoteRate: 1,
    winRate: 1
  });
  assert.deepEqual(result.valuesByCurrency, [{
    currency: "CNY",
    estimatedPipelineMinor: 50_000,
    quotedMinor: 0,
    wonContractMinor: 0
  }, {
    currency: "USD",
    estimatedPipelineMinor: 12_000,
    quotedMinor: 10_000,
    wonContractMinor: 9_000
  }]);
  assert.deepEqual(result.cost, {
    status: "available",
    executionCostMinor: 300,
    currency: "CNY",
    coverage: "recorded_api_execution_only"
  });
  assert.deepEqual(result.roi, {
    status: "not_computable",
    reason: "channel_cost_or_verified_margin_unavailable"
  });
  assert.equal(result.dataQuality.missingFinancial, 1);
  assert.equal(result.dataQuality.lastReconciledAt, "2026-08-07T08:00:00.000Z");
  assert.ok(result.briefingFacts.metricIds.includes("funnel.discovered"));
  assert.ok(result.briefingFacts.headlines.every((item) => item.metricId));
  assert.equal(JSON.stringify(result).includes("payment"), false);
});

test("returns null for every zero-denominator rate", async () => {
  const service = new AcquisitionPerformanceQueryService({
    planRuns: {
      async listRuns() { return []; },
      async getPlanVersion() { return null; },
      async listRunEvents() { return []; }
    } as never,
    domain: {
      async getPresentationCandidateSnapshots() { return []; },
      async listOutcomes() { return []; }
    } as never,
    diagnostics: [],
    reconcile: { async runOnce() { return { lastReconciledAt: null }; } }
  });
  const result = await service.get(scope, {
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-02T00:00:00.000Z"
  });
  assert.deepEqual(result.rates, {
    highIntentRate: null,
    approvalRate: null,
    crmConversionRate: null,
    contactRate: null,
    quoteRate: null,
    winRate: null
  });
});
