import assert from "node:assert/strict";
import test from "node:test";
import { FinancialCouncilService } from "./financial-council-service.js";
import {
  financialCouncilCanonicalHash,
  type FinancialCouncilRun
} from "./financial-council-domain.js";
import { InMemoryFinancialCouncilRepository } from
  "./financial-council-repository.js";
import {
  repositoryRunFixture,
  snapshotFixture,
  workspace
} from "./financial-council-repository-contract-test.js";
import type { CommandContext } from "./growth-command-context.js";
import type { FinancialCouncilCreateInput } from "./growth-contract-types.js";

const NOW = "2026-08-16T08:00:00.000Z";

function context(
  workspaceId = "ws-1",
  capabilities: readonly string[] = ["finance.council.run"]
) {
  return Object.freeze({
    ...workspace(workspaceId),
    role: "admin" as const,
    capabilities: Object.freeze([...capabilities])
  }) as CommandContext["workspace"];
}

function command(
  key = "create-key",
  requestHash = `sha256:${"b".repeat(64)}` as const,
  value = context()
): CommandContext {
  return Object.freeze({
    workspace: value,
    actorId: value.actorId,
    idempotencyKey: key,
    requestHash,
    expectedRevision: null
  });
}

function input(
  overrides: Partial<FinancialCouncilCreateInput> = {}
): FinancialCouncilCreateInput {
  const run = repositoryRunFixture();
  return {
    currency: run.currency,
    dataAsOf: run.dataAsOf,
    businessReport: run.businessReport,
    policyVersionId: run.policyVersionId,
    ...overrides
  };
}

function frozenSnapshot(runId: string, workspaceId = "ws-1") {
  return snapshotFixture(repositoryRunFixture({
    runId, workspaceId
  })).snapshot;
}

function harness(options: {
  freezeError?: Error;
  wake?: { wake(run: FinancialCouncilRun): Promise<void> };
  onWakeError?: (error: unknown, run: FinancialCouncilRun) => void | Promise<void>;
} = {}) {
  const repository = new InMemoryFinancialCouncilRepository();
  const wakes: FinancialCouncilRun[] = [];
  let freezeCalls = 0;
  let seenCommand: CommandContext | null = null;
  const service = new FinancialCouncilService({
    repository,
    snapshotBuilder: {
      async freeze(commandValue, runId) {
        freezeCalls += 1;
        seenCommand = commandValue;
        if (options.freezeError) throw options.freezeError;
        return frozenSnapshot(runId, commandValue.workspace.workspaceId) as never;
      }
    },
    advisoryWake: options.wake ?? {
      async wake(run) { wakes.push(run); }
    },
    onAdvisoryWakeError: options.onWakeError,
    now: () => NOW
  });
  return {
    repository, service, wakes,
    freezeCalls: () => freezeCalls,
    seenCommand: () => seenCommand
  };
}

test("committed create contains a synchronous advisory wake failure", async () => {
  const fixture = harness({
    wake: { wake() { throw new Error("sync wake failed"); } } as never
  });
  const result = await fixture.service.createRun(command(), input());
  assert.equal(result.value.status, "snapshot_frozen");
  assert.equal((await fixture.repository.listEvents(
    context(), result.value.runId
  )).length, 2);
});

test("committed create never waits for a non-settling advisory wake", async () => {
  let wakeCalled = false;
  const fixture = harness({
    wake: {
      wake() {
        wakeCalled = true;
        return new Promise<void>(() => undefined);
      }
    }
  });
  const result = await Promise.race([
    fixture.service.createRun(command(), input()).then((value) => ({
      kind: "created" as const, value
    })),
    new Promise<{ kind: "blocked" }>((resolve) => setImmediate(() => resolve({
      kind: "blocked"
    })))
  ]);
  assert.equal(result.kind, "created");
  assert.equal(wakeCalled, true);
  if (result.kind === "created") {
    assert.equal(result.value.value.status, "snapshot_frozen");
  }
});

test("advisory wake assimilates and contains an asynchronous observer", async () => {
  let assimilated = false;
  const observer = {
    then(_resolve: () => void, reject: (error: Error) => void) {
      assimilated = true;
      reject(new Error("observer failed"));
    }
  };
  const fixture = harness({
    wake: { async wake() { throw new Error("wake failed"); } },
    onWakeError: (() => observer) as never
  });
  await fixture.service.createRun(command(), input());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(assimilated, true);
});

test("create freezes atomically, exact replay is stable, and replay does not wake", async () => {
  const fixture = harness();
  const first = await fixture.service.createRun(command(), input());
  const replay = await fixture.service.createRun(command(), input());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.value, first.value);
  assert.equal(first.value.status, "snapshot_frozen");
  assert.equal(first.value.revision, 2);
  assert.match(first.value.runId,
    /^financial-council:create:sha256:[0-9a-f]{64}$/u);
  assert.equal(fixture.wakes.length, 1);
  assert.equal(fixture.freezeCalls(), 1);
  assert.deepEqual(
    (await fixture.repository.listEvents(context(), first.value.runId))
      .map((event) => event.revision),
    [1, 2]
  );
});

test("same creation key with a changed canonical request conflicts without wake", async () => {
  const fixture = harness();
  await fixture.service.createRun(command(), input());
  await assert.rejects(fixture.service.createRun(
    command("create-key", `sha256:${"c".repeat(64)}`),
    input({ policyVersionId: "policy-v2" })
  ), (error: unknown) => (error as { code?: unknown }).code
    === "financial_council_idempotency_conflict");
  assert.equal(fixture.wakes.length, 1);
  assert.equal(fixture.freezeCalls(), 1);
});

test("authorization and actor binding fail before snapshot or persistence", async () => {
  for (const invalid of [
    command("forbidden", undefined, context("ws-1", [])),
    { ...command(), actorId: "forged-actor" }
  ]) {
    const fixture = harness();
    await assert.rejects(
      fixture.service.createRun(invalid, input()),
      (error: unknown) => ["capability_forbidden", "financial_council_context_invalid"]
        .includes(String((error as { code?: unknown }).code))
    );
    assert.equal(fixture.freezeCalls(), 0);
    assert.deepEqual(await fixture.repository.listRunnableRuns({
      after: null, limit: 10
    }), []);
  }
});

test("snapshot failure leaves no visible run, snapshot, event, or wake", async () => {
  const fixture = harness({ freezeError: new Error("snapshot failed") });
  await assert.rejects(fixture.service.createRun(command(), input()),
    /snapshot failed/u);
  assert.equal(fixture.wakes.length, 0);
  assert.deepEqual(await fixture.repository.listRunnableRuns({
    after: null, limit: 10
  }), []);
});

test("authenticated capabilities reach the sensitive snapshot projection unchanged", async () => {
  const fixture = harness();
  const sensitive = context("ws-1", [
    "finance.council.run", "pricing.sensitive.read"
  ]);
  await fixture.service.createRun(command("sensitive", undefined, sensitive), input());
  assert.equal(fixture.seenCommand()?.workspace, sensitive);
});

test("run reads are tenant scoped and missing runs use one non-leaking code", async () => {
  const fixture = harness();
  const created = await fixture.service.createRun(command(), input());
  assert.equal((await fixture.service.getRun(
    context(), created.value.runId
  )).runId, created.value.runId);
  for (const requested of [context("ws-2"), context()]) {
    const runId = requested.workspaceId === "ws-2"
      ? created.value.runId : "missing-run";
    await assert.rejects(fixture.service.getRun(requested, runId),
      (error: unknown) => (error as { code?: unknown }).code
        === "financial_council_run_not_found");
  }
});

test("public service rejects the migration-only created state", async () => {
  const fixture = harness();
  const internal = repositoryRunFixture();
  await fixture.repository.createRun(command("migration-create"), internal);
  await assert.rejects(
    fixture.service.getRun(context(), internal.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_integrity"
  );
  await assert.rejects(
    fixture.service.listEvents(context(), internal.runId),
    (error: unknown) => (error as { code?: unknown }).code
      === "financial_council_integrity"
  );
});
