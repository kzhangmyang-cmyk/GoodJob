import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import {
  financialCouncilAggregateHash,
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
  const snapshot = Object.freeze({
    currency: run.currency,
    dataAsOf: run.dataAsOf,
    marker: "frozen-authority",
    runId: run.runId,
    snapshotId: "snapshot-1",
    workspaceId: run.workspaceId
  });
  const hash = `sha256:${createHash("sha256")
    .update(JSON.stringify(snapshot)).digest("hex")}` as const;
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
  const snapshot = Object.freeze({ ...base.snapshot, snapshotId });
  return Object.freeze({
    ...base,
    snapshotId,
    snapshotHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(snapshot)).digest("hex")}`,
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
