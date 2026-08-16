import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import {
  financialCouncilAggregateHash,
  financialCouncilCanonicalHash,
  type FinancialCouncilRun,
  type FinancialSnapshotRecord
} from "./financial-council-domain.js";
import type {
  FinancialCouncilRepository
} from "./financial-council-repository.js";

const T0 = "2026-08-16T08:00:00.000Z";
export const T1 = "2026-08-16T08:01:00.000Z";
const T2 = "2026-08-16T08:02:00.000Z";
const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;

export function repositoryRunFixture(
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

export function workspace(workspaceId = "ws-1"): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId,
    kind: "team",
    actorId: "manager-1",
    role: "manager",
    teamId: workspaceId,
    capabilities: Object.freeze([]),
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

export function command(
  key: string,
  workspaceId = "ws-1",
  expectedRevision: number | null = null,
  requestHash = `sha256:${"b".repeat(64)}`
): CommandContext {
  return Object.freeze({
    workspace: workspace(workspaceId),
    actorId: "manager-1",
    idempotencyKey: key,
    requestHash,
    expectedRevision
  });
}

export function snapshotFixture(
  run: FinancialCouncilRun,
  overrides: Partial<FinancialSnapshotRecord> = {}
): FinancialSnapshotRecord {
  const authorityProjection = Object.freeze({
    workspaceId: run.workspaceId,
    currency: run.currency,
    dataAsOf: run.dataAsOf,
    projectionLevel: "redacted" as const,
    priorityCustomers: Object.freeze([]),
    pendingQuoteApprovals: Object.freeze([]),
    verifiedFinancialFacts: Object.freeze([]),
    expectedRoi: Object.freeze([]),
    actualRoi: Object.freeze([]),
    dataGaps: Object.freeze([])
  });
  const authorityHash = financialCouncilCanonicalHash(authorityProjection);
  const preimage = Object.freeze({
    snapshotId: "snapshot-1",
    runId: run.runId,
    workspaceId: run.workspaceId,
    dataAsOf: run.dataAsOf,
    currency: run.currency,
    report: Object.freeze({
      currency: run.currency,
      companyName: run.businessReport.companyName,
      period: run.businessReport.period,
      totalAssetsMinor: 215_000,
      totalLiabilitiesMinor: 70_000,
      equityMinor: 145_000,
      grossProfitMinor: 80_000,
      netProfitMinor: 43_000,
      closingCashMinor: 100_000
    }),
    reportInputHash: `sha256:${"c".repeat(64)}`,
    authority: Object.freeze({
      ...authorityProjection,
      sourceSnapshotHash: authorityHash
    }),
    formulaInputs: Object.freeze({
      indicators: Object.freeze({
        grossMarginBps: 5_333, netMarginBps: 2_866, roeBps: 2_965,
        roaBps: 2_000, debtRatioBps: 3_255, currentRatioBps: 4_500,
        quickRatioBps: 4_166, receivableTurnover: 7,
        inventoryTurnover: 7, interestCoverage: 22, receivableDays: 49,
        cashCoverageMonths: 3, cashCollectionRatioBps: 10_000,
        cashProfitRatioBps: 10_000, revenueMinor: 150_000,
        netProfitMinor: 43_000
      }),
      products: Object.freeze([]), customers: Object.freeze([]),
      cashflow: Object.freeze({
        status: "not_computable", reason: "cash_flow_missing"
      }),
      cost: Object.freeze({
        status: "not_computable", reason: "cost_detail_missing"
      }),
      tax: Object.freeze({
        status: "not_computable", reason: "tax_risk_missing"
      })
    }),
    dataGaps: Object.freeze([]),
    sourceRefs: Object.freeze([Object.freeze({
      kind: "business_report" as const,
      sourceId: "business-report",
      version: 1,
      contentHash: `sha256:${"c".repeat(64)}` as const
    }), Object.freeze({
      kind: "crm" as const,
      sourceId: "growth-advisor-today",
      version: 1,
      contentHash: authorityHash
    })])
  });
  const hash = financialCouncilCanonicalHash(preimage);
  const snapshot = Object.freeze({ ...preimage, snapshotHash: hash });
  return Object.freeze({
    snapshotId: "snapshot-1",
    runId: run.runId,
    workspaceId: run.workspaceId,
    snapshotHash: hash,
    snapshot,
    createdAt: T1,
    ...overrides
  });
}

function snapshotWithId(
  run: FinancialCouncilRun,
  snapshotId: string
): FinancialSnapshotRecord {
  const base = snapshotFixture(run);
  const { snapshotHash: _snapshotHash, ...basePreimage } = base.snapshot;
  const preimage = Object.freeze({ ...basePreimage, snapshotId });
  const snapshotHash = financialCouncilCanonicalHash(preimage);
  const snapshot = Object.freeze({ ...preimage, snapshotHash });
  return Object.freeze({
    ...base,
    snapshotId,
    snapshotHash,
    snapshot
  });
}

function hasCode(code: string) {
  return (error: unknown) => (error as { code?: unknown }).code === code;
}

export function registerFinancialCouncilRepositoryContract(
  label: string,
  createRepository: () => Promise<FinancialCouncilRepository>
    | FinancialCouncilRepository
): void {
  test(`${label}: compound create freezes atomically and exact replay is inert`, async () => {
    const repository = await createRepository();
    const aggregate = repositoryRunFixture();
    const snapshot = snapshotFixture(aggregate);
    const first = await repository.createAndFreezeRun(command("create"), {
      aggregate,
      snapshot,
      occurredAt: T1
    });
    const replay = await repository.createAndFreezeRun(
      command("replay", "ws-1", null, aggregate.requestHash),
      {
        aggregate: repositoryRunFixture({ runId: "ignored-replay-run" }),
        snapshot: snapshotFixture(repositoryRunFixture({
          runId: "ignored-replay-run"
        })),
        occurredAt: T1
      }
    );
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.value, first.value);
    assert.deepEqual(
      [first.value.status, first.value.revision, first.value.snapshotId],
      ["snapshot_frozen", 2, snapshot.snapshotId]
    );
    assert.deepEqual(
      (await repository.listEvents(workspace(), aggregate.runId))
        .map((event) => [event.revision, event.toStatus]),
      [[1, "created"], [2, "snapshot_frozen"]]
    );
  });

  test(`${label}: compound create conflict and invalid snapshot leave zero visible writes`, async () => {
    const repository = await createRepository();
    const aggregate = repositoryRunFixture();
    const valid = snapshotFixture(aggregate);
    const tamperedSnapshot = {
      ...valid.snapshot,
      runId: "another-run"
    };
    await assert.rejects(repository.createAndFreezeRun(command("invalid"), {
      aggregate,
      snapshot: {
        ...valid,
        snapshot: tamperedSnapshot
      },
      occurredAt: T1
    }), hasCode("financial_council_input_invalid"));
    assert.equal(await repository.findRun(workspace(), aggregate.runId), null);
    assert.deepEqual(await repository.listEvents(workspace(), aggregate.runId), []);

    await repository.createAndFreezeRun(command("first"), {
      aggregate,
      snapshot: valid,
      occurredAt: T1
    });
    const changedHash = `sha256:${"c".repeat(64)}` as const;
    const changed = repositoryRunFixture({
      runId: "changed-run",
      requestHash: changedHash
    });
    await assert.rejects(repository.createAndFreezeRun(
      command("changed", "ws-1", null, changedHash),
      {
        aggregate: changed,
        snapshot: snapshotFixture(changed),
        occurredAt: T1
      }
    ), hasCode("financial_council_idempotency_conflict"));
    assert.equal(await repository.findRun(workspace(), changed.runId), null);
    assert.deepEqual(await repository.listEvents(workspace(), changed.runId), []);
  });

  test(`${label}: concurrent compound create has one writer and one exact replay`, async () => {
    const repository = await createRepository();
    const aggregate = repositoryRunFixture();
    const attempts = await Promise.all([
      repository.createAndFreezeRun(command("first"), {
        aggregate,
        snapshot: snapshotFixture(aggregate),
        occurredAt: T1
      }),
      repository.createAndFreezeRun(command("second"), {
        aggregate: repositoryRunFixture({ runId: "loser-run" }),
        snapshot: snapshotFixture(repositoryRunFixture({ runId: "loser-run" })),
        occurredAt: T1
      })
    ]);
    assert.deepEqual(attempts.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(new Set(attempts.map((result) => result.value.runId)).size, 1);
    assert.equal((await repository.listEvents(
      workspace(), aggregate.runId
    )).length, 2);
    assert.equal(await repository.findRun(workspace(), "loser-run"), null);
  });

  test(`${label}: runnable enumeration is bounded, deterministic and status closed`, async () => {
    const repository = await createRepository();
    for (const [index, runId] of ["run-b", "run-a", "run-c"].entries()) {
      const requestHash = `sha256:${String(index + 1).repeat(64)}` as const;
      const creationKeyHash = `sha256:${String(index + 4).repeat(64)}` as const;
      const aggregate = repositoryRunFixture({
        runId, requestHash, creationKeyHash,
        createdAt: `2026-08-16T08:00:0${index}.000Z`,
        updatedAt: `2026-08-16T08:00:0${index}.000Z`
      });
      await repository.createAndFreezeRun(
        command(`create-${runId}`, "ws-1", null, requestHash),
        {
          aggregate,
          snapshot: snapshotWithId(aggregate, `snapshot-${runId}`),
          occurredAt: T1
        }
      );
    }
    await repository.transitionRun(command("advance-b", "ws-1", 2), {
      runId: "run-b", kind: "analyzing", occurredAt: T2, reasonCode: null
    });
    const crossWorkspace = repositoryRunFixture({
      workspaceId: "ws-2",
      runId: "run-a",
      requestHash: `sha256:${"8".repeat(64)}`,
      creationKeyHash: `sha256:${"9".repeat(64)}`
    });
    await repository.createAndFreezeRun(
      command("create-cross", "ws-2", null, crossWorkspace.requestHash),
      {
        aggregate: crossWorkspace,
        snapshot: snapshotWithId(crossWorkspace, "snapshot-cross"),
        occurredAt: T1
      }
    );
    const first = await repository.listRunnableRuns({ after: null, limit: 2 });
    const second = await repository.listRunnableRuns({
      after: {
        workspaceId: first.at(-1)!.workspaceId,
        runId: first.at(-1)!.runId
      },
      limit: 2
    });
    assert.deepEqual(first.map((run) => [run.workspaceId, run.runId]), [
      ["ws-1", "run-a"], ["ws-1", "run-c"]
    ]);
    assert.deepEqual(second.map((run) => [run.workspaceId, run.runId]), [
      ["ws-2", "run-a"]
    ]);
    await assert.rejects(
      repository.listRunnableRuns({ after: null, limit: 0 }),
      hasCode("financial_council_input_invalid")
    );
  });

  test(`${label}: composite cursor uses UTF-8 byte order without skipping`, async () => {
    const repository = await createRepository();
    const identities = [
      ["a", "a"], ["B", "z"], ["B", "A"], ["é", "run"], ["中", "run"],
      ["\u{10000}", "run"], ["\uE000", "run"]
    ] as const;
    for (const [index, [workspaceId, runId]] of identities.entries()) {
      const aggregate = repositoryRunFixture({
        workspaceId,
        runId,
        creationKeyHash: `sha256:${index.toString(16).repeat(64)}`,
        requestHash: `sha256:${(index + 8).toString(16).repeat(64)}`
      });
      await repository.createAndFreezeRun(command(
        `code-unit-${index}`, workspaceId, null, aggregate.requestHash
      ), {
        aggregate,
        snapshot: snapshotWithId(aggregate, `snapshot-${index}`),
        occurredAt: T1
      });
    }
    const seen: Array<readonly [string, string]> = [];
    let after: { workspaceId: string; runId: string } | null = null;
    for (;;) {
      const page = await repository.listRunnableRuns({ after, limit: 1 });
      if (page.length === 0) break;
      const run = page[0]!;
      seen.push([run.workspaceId, run.runId]);
      after = { workspaceId: run.workspaceId, runId: run.runId };
    }
    assert.deepEqual(seen, [
      ["B", "A"], ["B", "z"], ["a", "a"], ["é", "run"], ["中", "run"],
      ["\uE000", "run"], ["\u{10000}", "run"]
    ]);
  });

  test(`${label}: re-signed open or nested-open snapshots are rejected`, async () => {
    const repository = await createRepository();
    for (const [index, mutate] of [
      (snapshot: Record<string, unknown>) => ({ ...snapshot, hidden: true }),
      (snapshot: Record<string, unknown>) => ({
        ...snapshot,
        authority: { ...(snapshot.authority as object), hidden: true }
      })
    ].entries()) {
      const aggregate = repositoryRunFixture({
        runId: `open-snapshot-${index}`,
        creationKeyHash: `sha256:${(index + 5).toString(16).repeat(64)}`,
        requestHash: `sha256:${(index + 7).toString(16).repeat(64)}`
      });
      const base = snapshotWithId(aggregate, `open-snapshot-id-${index}`);
      const { snapshotHash: _old, ...identity } = base.snapshot;
      const changed = mutate(identity);
      const snapshotHash = financialCouncilCanonicalHash(changed);
      await assert.rejects(repository.createAndFreezeRun(command(
        `open-${index}`, "ws-1", null, aggregate.requestHash
      ), {
        aggregate,
        snapshot: {
          ...base,
          snapshotHash,
          snapshot: { ...changed, snapshotHash }
        },
        occurredAt: T1
      }), hasCode("financial_council_input_invalid"));
    }
  });

  test(`${label}: duplicate create replays exactly and isolates workspaces`, async () => {
    const repository = await createRepository();
    const initial = repositoryRunFixture();
    const first = await repository.createRun(command("create-1"), initial);
    const replay = await repository.createRun(
      command("create-replay", "ws-1", null, initial.requestHash),
      repositoryRunFixture({ runId: "ignored-replay-id" })
    );
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.value, first.value);
    assert.equal(await repository.findRun(workspace("ws-2"), initial.runId), null);
    assert.deepEqual(
      await repository.listEvents(workspace("ws-2"), initial.runId), []
    );
  });

  test(`${label}: changed request under the creation key is a stable conflict`, async () => {
    const repository = await createRepository();
    const initial = repositoryRunFixture();
    await repository.createRun(command("create-1"), initial);
    await assert.rejects(repository.createRun(
      command("changed", "ws-1", null, `sha256:${"c".repeat(64)}`),
      repositoryRunFixture({ requestHash: `sha256:${"c".repeat(64)}` })
    ), hasCode("financial_council_idempotency_conflict"));
  });

  test(`${label}: a concurrent transition has one revision winner`, async () => {
    const repository = await createRepository();
    const created = (await repository.createRun(
      command("create-1"), repositoryRunFixture()
    )).value;
    const snapshot = snapshotFixture(created);
    const frozen = await repository.storeFrozenSnapshot(
      command("freeze", "ws-1", 1),
      { runId: created.runId, snapshot, occurredAt: T1 }
    );
    const attempts = await Promise.allSettled([
      repository.transitionRun(command("advance-a", "ws-1", 2), {
        runId: created.runId,
        kind: "analyzing",
        occurredAt: T2,
        reasonCode: null
      }),
      repository.transitionRun(command("advance-b", "ws-1", 2), {
        runId: created.runId,
        kind: "analyzing",
        occurredAt: T2,
        reasonCode: null
      })
    ]);
    assert.equal(frozen.value.revision, 2);
    assert.equal(attempts.filter((row) => row.status === "fulfilled").length, 1);
    const rejected = attempts.find((row) => row.status === "rejected");
    assert.equal(rejected?.status, "rejected");
    assert.equal(
      (rejected as PromiseRejectedResult).reason.code,
      "financial_council_revision_conflict"
    );
  });

  test(`${label}: event revisions are contiguous and hash canonical snapshots`, async () => {
    const repository = await createRepository();
    const created = (await repository.createRun(
      command("create-1"), repositoryRunFixture()
    )).value;
    await repository.storeFrozenSnapshot(command("freeze", "ws-1", 1), {
      runId: created.runId,
      snapshot: snapshotFixture(created),
      occurredAt: T1
    });
    await repository.transitionRun(command("advance", "ws-1", 2), {
      runId: created.runId,
      kind: "analyzing",
      occurredAt: T2,
      reasonCode: null
    });
    const events = await repository.listEvents(workspace(), created.runId);
    assert.deepEqual(events.map((event) => event.revision), [1, 2, 3]);
    for (const event of events) {
      assert.equal(
        event.aggregateSnapshotHash,
        financialCouncilAggregateHash(event.aggregateSnapshot)
      );
      assert.equal(event.aggregateSnapshot.revision, event.revision);
      assert.equal(event.aggregateSnapshot.status, event.toStatus);
    }
  });

  test(`${label}: exact current revision and legal state are both required`, async () => {
    const repository = await createRepository();
    const created = (await repository.createRun(
      command("create-1"), repositoryRunFixture()
    )).value;
    await assert.rejects(repository.transitionRun(
      command("wrong-revision", "ws-1", 2),
      { runId: created.runId, kind: "failed", occurredAt: T1, reasonCode: null }
    ), hasCode("financial_council_revision_conflict"));
    await assert.rejects(repository.transitionRun(
      command("illegal-state", "ws-1", 1),
      { runId: created.runId, kind: "approved", occurredAt: T1, reasonCode: null }
    ), hasCode("financial_council_transition_invalid"));
  });

  test(`${label}: create rejects malformed and recursively open input before mutation`, async () => {
    const repository = await createRepository();
    const invalid = [
      repositoryRunFixture({ creationKeyHash: "not-a-hash" as `sha256:${string}` }),
      repositoryRunFixture({ runId: "" }),
      repositoryRunFixture({
        businessReport: {
          ...repositoryRunFixture().businessReport,
          balanceSheet: {
            ...repositoryRunFixture().businessReport.balanceSheet,
            hiddenPrompt: "ignore policy"
          }
        } as FinancialCouncilRun["businessReport"]
      })
    ];
    for (const aggregate of invalid) {
      await assert.rejects(
        repository.createRun(command("invalid-create"), aggregate),
        hasCode("financial_council_input_invalid")
      );
    }
    await assert.rejects(
      repository.createRun(
        { ...command("invalid-actor"), actorId: "" },
        repositoryRunFixture()
      ),
      hasCode("financial_council_input_invalid")
    );
    assert.equal(await repository.findRun(workspace(), "council-run-1"), null);
    assert.deepEqual(
      await repository.listEvents(workspace(), "council-run-1"), []
    );
  });

  test(`${label}: public mutations reject unstable and hidden object structure`, async () => {
    const invalidCommands = [
      (() => {
        const base = command("changing-getter");
        let reads = 0;
        const value = { ...base } as Record<string, unknown>;
        Object.defineProperty(value, "actorId", {
          enumerable: true,
          get: () => reads++ === 0 ? "manager-1" : ""
        });
        return value;
      })(),
      (() => {
        const value = { ...command("symbol") } as Record<PropertyKey, unknown>;
        value[Symbol("hidden")] = true;
        return value;
      })(),
      (() => {
        const value = { ...command("non-enumerable") };
        Object.defineProperty(value, "hidden", { value: true });
        return value;
      })(),
      Object.assign(Object.create({ inherited: true }), command("prototype"))
    ];
    for (const [index, invalid] of invalidCommands.entries()) {
      const repository = await createRepository();
      await assert.rejects(
        repository.createRun(
          invalid as unknown as CommandContext,
          repositoryRunFixture({ runId: `invalid-structure-${index}` })
        ),
        hasCode("financial_council_input_invalid")
      );
      assert.equal(
        await repository.findRun(workspace(), `invalid-structure-${index}`),
        null
      );
      assert.deepEqual(
        await repository.listEvents(workspace(), `invalid-structure-${index}`),
        []
      );
    }

    const repository = await createRepository();
    const aggregate = structuredClone(repositoryRunFixture());
    Object.defineProperty(aggregate.businessReport.balanceSheet, "cashMinor", {
      enumerable: true,
      get: () => 100_000
    });
    await assert.rejects(
      repository.createRun(command("nested-accessor"), aggregate),
      hasCode("financial_council_input_invalid")
    );
    assert.equal(await repository.findRun(workspace(), aggregate.runId), null);

    const run = (await repository.createRun(
      command("valid-create"), repositoryRunFixture()
    )).value;
    const transitionCommand = { ...command("unstable-transition", "ws-1", 1) };
    Object.defineProperty(transitionCommand, "actorId", {
      enumerable: true,
      get: () => "manager-1"
    });
    await assert.rejects(repository.transitionRun(transitionCommand, {
      runId: run.runId,
      kind: "failed",
      occurredAt: T1,
      reasonCode: null
    }), hasCode("financial_council_input_invalid"));
    const snapshotInput = {
      runId: run.runId,
      snapshot: snapshotFixture(run),
      occurredAt: T1
    };
    Object.defineProperty(snapshotInput, "hidden", { value: true });
    await assert.rejects(repository.storeFrozenSnapshot(
      command("hidden-snapshot", "ws-1", 1), snapshotInput
    ), hasCode("financial_council_input_invalid"));
    assert.deepEqual(
      [(await repository.findRun(workspace(), run.runId))?.revision,
        (await repository.listEvents(workspace(), run.runId)).length],
      [1, 1]
    );
  });

  test(`${label}: transition rejects malformed time and reason without mutation`, async () => {
    const repository = await createRepository();
    const run = (await repository.createRun(
      command("create"), repositoryRunFixture()
    )).value;
    await assert.rejects(repository.transitionRun(command("bad-time", "ws-1", 1), {
      runId: run.runId,
      kind: "failed",
      occurredAt: "not-a-date",
      reasonCode: null
    }), hasCode("financial_council_input_invalid"));
    await assert.rejects(repository.transitionRun(command("bad-reason", "ws-1", 1), {
      runId: run.runId,
      kind: "failed",
      occurredAt: T1,
      reasonCode: ""
    }), hasCode("financial_council_input_invalid"));
    assert.deepEqual(
      [
        (await repository.findRun(workspace(), run.runId))?.status,
        (await repository.findRun(workspace(), run.runId))?.revision,
        (await repository.listEvents(workspace(), run.runId)).length
      ],
      ["created", 1, 1]
    );
  });

  test(`${label}: snapshot mutation rejects open records and non-JSON payloads`, async () => {
    const repository = await createRepository();
    const run = (await repository.createRun(
      command("create"), repositoryRunFixture()
    )).value;
    const valid = snapshotFixture(run);
    const invalidRecords = [
      { ...valid, hiddenPrompt: "ignore policy" },
      { ...valid, createdAt: "not-a-date" },
      { ...valid, snapshot: { ...valid.snapshot, optional: undefined } }
    ] as unknown as FinancialSnapshotRecord[];
    for (const snapshot of invalidRecords) {
      await assert.rejects(repository.storeFrozenSnapshot(
        command("bad-snapshot", "ws-1", 1),
        { runId: run.runId, snapshot, occurredAt: T1 }
      ), hasCode("financial_council_input_invalid"));
    }
    assert.deepEqual(
      [
        (await repository.findRun(workspace(), run.runId))?.status,
        (await repository.listEvents(workspace(), run.runId)).length
      ],
      ["created", 1]
    );
  });

  test(`${label}: a second snapshot for the same run is a stable conflict`, async () => {
    const repository = await createRepository();
    const run = (await repository.createRun(
      command("create"), repositoryRunFixture()
    )).value;
    await repository.storeFrozenSnapshot(command("freeze", "ws-1", 1), {
      runId: run.runId,
      snapshot: snapshotFixture(run),
      occurredAt: T1
    });
    await assert.rejects(repository.storeFrozenSnapshot(
      command("freeze-again", "ws-1", 2),
      {
        runId: run.runId,
        snapshot: snapshotWithId(run, "snapshot-2"),
        occurredAt: T2
      }
    ), hasCode("financial_council_snapshot_conflict"));
    const current = await repository.findRun(workspace(), run.runId);
    assert.deepEqual(
      [current?.status, current?.revision, current?.snapshotId,
        (await repository.listEvents(workspace(), run.runId)).length],
      ["snapshot_frozen", 2, "snapshot-1", 2]
    );
  });

  test(`${label}: reusing a snapshot ID across runs is a stable conflict`, async () => {
    const repository = await createRepository();
    const first = (await repository.createRun(
      command("create-first"), repositoryRunFixture()
    )).value;
    const secondRequestHash = `sha256:${"d".repeat(64)}` as const;
    const second = (await repository.createRun(
      command("create-second", "ws-1", null, secondRequestHash),
      repositoryRunFixture({
        runId: "council-run-2",
        creationKeyHash: `sha256:${"c".repeat(64)}`,
        requestHash: secondRequestHash
      })
    )).value;
    await repository.storeFrozenSnapshot(command("freeze-first", "ws-1", 1), {
      runId: first.runId,
      snapshot: snapshotFixture(first),
      occurredAt: T1
    });
    await assert.rejects(repository.storeFrozenSnapshot(
      command("freeze-second", "ws-1", 1),
      {
        runId: second.runId,
        snapshot: snapshotFixture(second),
        occurredAt: T2
      }
    ), hasCode("financial_council_snapshot_conflict"));
    const current = await repository.findRun(workspace(), second.runId);
    assert.deepEqual(
      [current?.status, current?.revision,
        (await repository.listEvents(workspace(), second.runId)).length],
      ["created", 1, 1]
    );
  });
}
