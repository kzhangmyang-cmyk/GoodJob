import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFinancialCouncilTransition,
  financialCouncilAggregateHash,
  type FinancialCouncilRun
} from "./financial-council-domain.js";

export const T0 = "2026-08-16T08:00:00.000Z";
export const T1 = "2026-08-16T08:01:00.000Z";
export const T2 = "2026-08-16T08:02:00.000Z";

const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;

export function runFixture(
  overrides: Partial<FinancialCouncilRun> = {}
): FinancialCouncilRun {
  return Object.freeze({
    runId: "council-run-1",
    workspaceId: "ws-1",
    creationKeyHash: SHA_A,
    requestHash: SHA_B,
    currency: "CNY",
    status: "created",
    revision: 1,
    dataAsOf: "2026-08-15T00:00:00.000Z",
    businessReport: Object.freeze({
      currency: "CNY",
      companyName: "示例公司",
      period: "2026-07",
      balanceSheet: Object.freeze({
        period: "2026-07",
        cashMinor: 100_000,
        receivablesMinor: 20_000,
        inventoryMinor: 10_000,
        otherCurrentAssetsMinor: 5_000,
        nonCurrentAssetsMinor: 80_000,
        currentLiabilitiesMinor: 30_000,
        nonCurrentLiabilitiesMinor: 40_000,
        accountsPayableMinor: 12_000
      }),
      incomeStatement: Object.freeze({
        period: "2026-07",
        revenueMinor: 150_000,
        costOfGoodsSoldMinor: 70_000,
        operatingExpensesMinor: 30_000,
        interestExpenseMinor: 2_000,
        taxExpenseMinor: 5_000
      })
    }),
    policyVersionId: "policy-v1",
    snapshotId: null,
    snapshotHash: null,
    consensusReport: null,
    portfolios: Object.freeze([]),
    latestPortfolioRevision: null,
    approval: null,
    createdAt: T0,
    updatedAt: T0,
    expiresAt: "2026-08-17T08:00:00.000Z",
    ...overrides
  });
}

function hasCode(code: string) {
  return (error: unknown) => (error as { code?: unknown }).code === code;
}

test("run transitions are closed and revisioned", () => {
  const created = runFixture({ status: "created", revision: 1 });
  const frozen = applyFinancialCouncilTransition(created, {
    kind: "snapshot_frozen", occurredAt: T1, actorId: "system:council"
  });
  assert.equal(frozen.status, "snapshot_frozen");
  assert.equal(frozen.revision, 2);
  assert.equal(frozen.updatedAt, T1);
  assert.throws(() => applyFinancialCouncilTransition(frozen, {
    kind: "approved", occurredAt: T2, actorId: "actor-1"
  }), hasCode("financial_council_transition_invalid"));
});

test("the only progressive path reaches each approval state in order", () => {
  const kinds = [
    "snapshot_frozen", "analyzing", "auditing", "synthesizing",
    "optimizing", "awaiting_approval", "approved"
  ] as const;
  const result = kinds.reduce((run, kind, index) =>
    applyFinancialCouncilTransition(run, {
      kind,
      occurredAt: `2026-08-16T08:0${index + 1}:00.000Z`,
      actorId: "system:council"
    }), runFixture());
  assert.equal(result.status, "approved");
  assert.equal(result.revision, 8);
});

test("every nonterminal may fail or become not computable", () => {
  const statuses = [
    "created", "snapshot_frozen", "analyzing", "auditing", "synthesizing",
    "optimizing", "awaiting_approval"
  ] as const;
  for (const status of statuses) {
    for (const kind of ["failed", "not_computable"] as const) {
      const next = applyFinancialCouncilTransition(runFixture({ status }), {
        kind, occurredAt: T1, actorId: "system:council"
      });
      assert.equal(next.status, kind, `${status} -> ${kind}`);
    }
  }
});

test("terminal runs never reopen", () => {
  for (const status of [
    "approved", "rejected", "expired", "failed", "not_computable"
  ] as const) {
    assert.throws(() => applyFinancialCouncilTransition(
      runFixture({ status }),
      { kind: "analyzing", occurredAt: T1, actorId: "actor-1" }
    ), hasCode("financial_council_transition_invalid"), status);
  }
});

test("aggregate hashes cover canonical immutable run state", () => {
  const run = runFixture();
  assert.match(financialCouncilAggregateHash(run), /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(
    financialCouncilAggregateHash(run),
    financialCouncilAggregateHash(runFixture({ revision: 2 }))
  );
  assert.equal(Object.isFrozen(applyFinancialCouncilTransition(run, {
    kind: "failed", occurredAt: T1, actorId: "system:council"
  })), true);
});
