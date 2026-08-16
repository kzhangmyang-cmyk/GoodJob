import {
  InMemoryFinancialCouncilRepository
} from "./financial-council-repository.js";
import {
  registerFinancialCouncilRepositoryContract
} from "./financial-council-repository-contract-test.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  command, repositoryRunFixture, snapshotFixture, T1, workspace
} from "./financial-council-repository-contract-test.js";
import { financialCouncilAggregateHash } from
  "./financial-council-domain.js";

registerFinancialCouncilRepositoryContract(
  "memory financial council repository",
  () => new InMemoryFinancialCouncilRepository()
);

test("memory replay and reads reject every re-signed history divergence", async () => {
  for (const kind of ["hash", "actor", "time", "aggregate"] as const) {
    const repository = new InMemoryFinancialCouncilRepository();
    const aggregate = repositoryRunFixture();
    await repository.createAndFreezeRun(command("create"), {
      aggregate, snapshot: snapshotFixture(aggregate), occurredAt: T1
    });
    const internal = repository as unknown as {
      state: { events: Map<string, Array<Record<string, unknown>>> }
    };
    const events = internal.state.events.get("ws-1\u0000council-run-1")!;
    const target = kind === "aggregate" ? events[1]! : events[0]!;
    const changed = kind === "hash"
      ? { ...target, aggregateSnapshotHash: `sha256:${"f".repeat(64)}` }
      : kind === "actor"
        ? { ...target, actorId: "attacker" }
        : kind === "time"
          ? { ...target, occurredAt: T1 }
          : (() => {
              const aggregateSnapshot = {
                ...(target.aggregateSnapshot as object), policyVersionId: "tampered"
              };
              return {
                ...target,
                aggregateSnapshot,
                aggregateSnapshotHash: financialCouncilAggregateHash(
                  aggregateSnapshot as never
                )
              };
            })();
    events[kind === "aggregate" ? 1 : 0] = changed;
    const calls = [
      () => repository.findFrozenRunByCreationKey(
        workspace(), aggregate.creationKeyHash, aggregate.requestHash
      ),
      () => repository.findRun(workspace(), aggregate.runId),
      () => repository.listEvents(workspace(), aggregate.runId),
      () => repository.listRunnableRuns({ after: null, limit: 10 })
    ];
    for (const call of calls) {
      await assert.rejects(call(), (error: unknown) =>
        (error as { code?: unknown }).code === "financial_council_integrity");
    }
  }
});

test("memory legacy create replay rejects a missing or corrupted first event", async () => {
  for (const corruption of ["missing", "hash"] as const) {
    const repository = new InMemoryFinancialCouncilRepository();
    const aggregate = repositoryRunFixture();
    await repository.createRun(command("create"), aggregate);
    const internal = repository as unknown as {
      state: { events: Map<string, Array<Record<string, unknown>>> }
    };
    const events = internal.state.events.get("ws-1\u0000council-run-1")!;
    if (corruption === "missing") events.splice(0, 1);
    else events[0] = {
      ...events[0], aggregateSnapshotHash: `sha256:${"f".repeat(64)}`
    };

    await assert.rejects(
      repository.createRun(command("replay"), aggregate),
      (error: unknown) =>
        (error as { code?: unknown }).code === "financial_council_integrity"
    );
  }
});
