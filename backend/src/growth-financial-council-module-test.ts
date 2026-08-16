import assert from "node:assert/strict";
import test from "node:test";
import type express from "express";
import {
  FinancialCouncilWakeRelay,
  GROWTH_FINANCIAL_COUNCIL_SERVICES,
  createGrowthFinancialCouncilModule,
  type GrowthFinancialCouncilResources
} from "./growth-financial-council-module.js";
import { createGrowthPrivateServiceRegistry } from
  "./growth-commercial-private-services.js";
import { GROWTH_FOUNDATION_SERVICES } from "./growth-foundation-module.js";
import { GROWTH_ADVISOR_SERVICES } from "./growth-advisor-module.js";
import { GROWTH_FINANCE_SERVICES } from "./growth-finance-module.js";
import { repositoryRunFixture } from
  "./financial-council-repository-contract-test.js";
import { FinancialCouncilService } from "./financial-council-service.js";
import { InMemoryFinancialCouncilRepository } from
  "./financial-council-repository.js";
import { RepositoryVerifiedFinancialLedgerSealedReader } from
  "./financial-ledger-as-of-reader.js";

function frozenRun() {
  return Object.freeze({
    ...repositoryRunFixture(),
    status: "snapshot_frozen" as const,
    revision: 2,
    snapshotId: "snapshot-1",
    snapshotHash: `sha256:${"d".repeat(64)}` as const
  });
}

test("wake relay isolates delivery failure and retries the durable runnable fact", async () => {
  const run = frozenRun();
  let attempts = 0;
  const errors: unknown[] = [];
  const relay = new FinancialCouncilWakeRelay({
    repository: {
      async listRunnableRuns() { return [run]; }
    },
    sink: {
      async wake() {
        attempts += 1;
        if (attempts === 1) throw new Error("wake unavailable");
      }
    },
    onError(error) { errors.push(error); },
    intervalMs: 60_000,
    batchSize: 10
  });
  await relay.sweep();
  await relay.sweep();
  assert.equal(attempts, 2);
  assert.equal(errors.length, 1);
  await relay.close();
});

test("wake relay contains synchronous sink failures", async () => {
  const errors: unknown[] = [];
  const relay = new FinancialCouncilWakeRelay({
    repository: { async listRunnableRuns() { return [frozenRun()]; } },
    sink: { wake() { throw new Error("sync sink failed"); } } as never,
    onError(error) { errors.push(error); },
    intervalMs: 60_000,
    batchSize: 10
  });
  await assert.doesNotReject(relay.sweep());
  assert.equal(errors.length, 1);
  await relay.close();
});

test("wake relay assimilates and contains asynchronous observers", async () => {
  let assimilated = false;
  const relay = new FinancialCouncilWakeRelay({
    repository: { async listRunnableRuns() { throw new Error("read failed"); } },
    sink: { async wake() {} },
    onError: (() => ({
      then(_resolve: () => void, reject: (error: Error) => void) {
        assimilated = true;
        reject(new Error("observer failed"));
      }
    })) as never,
    intervalMs: 60_000,
    batchSize: 10
  });
  await relay.sweep();
  await Promise.resolve();
  assert.equal(assimilated, true);
  await relay.close();
});

test("wake relay contains observer failures without an unhandled rejection", async () => {
  const relay = new FinancialCouncilWakeRelay({
    repository: {
      async listRunnableRuns() { throw new Error("repository unavailable"); }
    },
    sink: { async wake() {} },
    onError() { throw new Error("observer failed"); },
    intervalMs: 60_000,
    batchSize: 10
  });
  await assert.doesNotReject(relay.sweep());
  await relay.close();
});

test("wake relay close clears scheduling and awaits the active delivery", async () => {
  const run = frozenRun();
  let deliveries = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  const relay = new FinancialCouncilWakeRelay({
    repository: { async listRunnableRuns() { return [run]; } },
    sink: {
      async wake() {
        deliveries += 1;
        began();
        await blocked;
      }
    },
    intervalMs: 5,
    batchSize: 10
  });
  relay.start();
  await started;
  let closed = false;
  const closing = relay.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  release();
  await closing;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(deliveries, 1);
});

test("wake relay advances a composite cursor so persistent first-page facts do not starve", async () => {
  const runs = [frozenRun(), Object.freeze({
    ...frozenRun(), workspaceId: "ws-2", runId: "council-run-2"
  })];
  const cursors: unknown[] = [];
  const delivered: string[] = [];
  const relay = new FinancialCouncilWakeRelay({
    repository: {
      async listRunnableRuns(input) {
        cursors.push(input.after);
        return input.after === null ? [runs[0]!] : [runs[1]!];
      }
    },
    sink: { async wake(run) { delivered.push(run.runId); } },
    intervalMs: 60_000,
    batchSize: 1
  });
  await relay.sweep();
  await relay.sweep();
  assert.deepEqual(delivered, ["council-run-1", "council-run-2"]);
  assert.deepEqual(cursors, [null, {
    workspaceId: "ws-1", runId: "council-run-1"
  }]);
  await relay.close();
});

function moduleFixture() {
  const registry = createGrowthPrivateServiceRegistry();
  registry.provide(GROWTH_FOUNDATION_SERVICES, {
    workspaceContext: (() => { throw new Error("unused"); }) as never,
    commandContextFactory: (() => { throw new Error("unused"); }) as never,
    httpIdempotency: {} as never
  } as never);
  const events: string[] = [];
  const today = Object.freeze({
    async getToday() { throw new Error("unused"); },
    async getTodayAt() { throw new Error("unused"); },
    async sealTodayCutoff() { throw new Error("unused"); }
  });
  registry.provide(GROWTH_ADVISOR_SERVICES, Object.freeze({
    today, recommendations: {}, dispatcher: {}
  }) as never);
  const verifiedAsOf = new RepositoryVerifiedFinancialLedgerSealedReader(
    {} as never
  );
  registry.provide(GROWTH_FINANCE_SERVICES, Object.freeze({
    costLedger: {}, financialFacts: {}, imports: {}, verifiedAsOf,
    financialGaps: {}
  }) as never);
  const service = new FinancialCouncilService({
    repository: new InMemoryFinancialCouncilRepository(),
    snapshotBuilder: { async freeze() { throw new Error("not called"); } }
  });
  class RecordingRelay extends FinancialCouncilWakeRelay {
    override start() { events.push("relay:start"); super.start(); }
    override async close() { events.push("relay:close"); await super.close(); }
  }
  const relay = new RecordingRelay({
    repository: { async listRunnableRuns() { return []; } },
    sink: { async wake() {} }, intervalMs: 60_000, batchSize: 10
  });
  const resources: GrowthFinancialCouncilResources = Object.freeze({
    service,
    relay,
    async closeFinancialCouncilResources() { events.push("resources:close"); }
  });
  let mounts = 0;
  const router = ({
    use() { mounts += 1; events.push("route:mount"); }
  } as unknown as express.Router);
  const module = createGrowthFinancialCouncilModule({
    async initializeSchema() { events.push("schema"); },
    async createResources() { events.push("resources:create"); return resources; }
  });
  return { registry, events, resources, router, module, mounts: () => mounts };
}

test("module rejects untrusted service, relay, and close resources before mount", async () => {
  for (const kind of ["service", "relay", "close"] as const) {
    const fixture = moduleFixture();
    let starts = 0;
    const invalid = Object.freeze({
      ...fixture.resources,
      ...(kind === "service" ? { service: {} } : {}),
      ...(kind === "relay" ? { relay: {
        start() { starts += 1; }, async sweep() {}, async close() {}
      } } : {}),
      ...(kind === "close" ? { closeFinancialCouncilResources: "close" } : {})
    }) as never;
    const module = createGrowthFinancialCouncilModule({
      async initializeSchema() {},
      async createResources() { return invalid; }
    });
    await assert.rejects(module.install({
      router: fixture.router,
      toolPorts: {} as never,
      privateServices: fixture.registry
    }), /INVALID_GROWTH_FINANCIAL_COUNCIL_RESOURCES/u);
    assert.equal(fixture.mounts(), 0, kind);
    assert.equal(starts, 0, kind);
  }
});

test("trusted instance brands require complete constructor dependencies", () => {
  assert.throws(
    () => new FinancialCouncilService({} as never),
    /invalid_financial_council_service/u
  );
  assert.throws(
    () => new FinancialCouncilWakeRelay({} as never),
    /invalid_financial_council_relay/u
  );
});

test("module rejects unowned upstream lookalikes before resource creation", async () => {
  for (const kind of ["advisor", "finance"] as const) {
    const registry = createGrowthPrivateServiceRegistry();
    registry.provide(GROWTH_FOUNDATION_SERVICES, {
      workspaceContext() {}, commandContextFactory() {}, httpIdempotency: {}
    } as never);
    const today = {
      async getToday() {}, async getTodayAt() {}, async sealTodayCutoff() {}
    };
    registry.provide(GROWTH_ADVISOR_SERVICES, Object.freeze({
      today: kind === "advisor" ? today : Object.freeze(today),
      recommendations: {}, dispatcher: {}
    }) as never);
    registry.provide(GROWTH_FINANCE_SERVICES, Object.freeze({
      costLedger: {}, financialFacts: {}, imports: {}, financialGaps: {},
      verifiedAsOf: kind === "finance" ? {
        async listWorkspaceVerifiedFactsAt() { return []; }
      } : new RepositoryVerifiedFinancialLedgerSealedReader({} as never)
    }) as never);
    let created = 0;
    const module = createGrowthFinancialCouncilModule({
      async initializeSchema() {},
      async createResources() { created += 1; return moduleFixture().resources; }
    });
    await assert.rejects(module.install({
      router: { use() {} } as never,
      toolPorts: {} as never,
      privateServices: registry
    }), /INVALID_GROWTH_(ADVISOR|FINANCE)/u);
    assert.equal(created, 0, kind);
  }
});

test("financial council module initializes schema before routes and closes once", async () => {
  const fixture = moduleFixture();
  const handle = await fixture.module.install({
    router: fixture.router,
    toolPorts: {} as never,
    privateServices: fixture.registry
  });
  assert.deepEqual(fixture.events, [
    "schema", "resources:create", "route:mount", "relay:start"
  ]);
  assert.equal(fixture.mounts(), 1);
  assert.equal(
    fixture.registry.require(GROWTH_FINANCIAL_COUNCIL_SERVICES).service,
    fixture.resources.service
  );
  await handle.close();
  await handle.close();
  assert.deepEqual(fixture.events.slice(-2), ["relay:close", "resources:close"]);
});

test("module construction failure mounts no routes and closes created resources", async () => {
  const fixture = moduleFixture();
  const module = createGrowthFinancialCouncilModule({
    async initializeSchema() { fixture.events.push("schema"); },
    async createResources() {
      fixture.events.push("resources:create");
      return fixture.resources;
    },
    createRouter() { throw new Error("router failed"); }
  });
  await assert.rejects(module.install({
    router: fixture.router,
    toolPorts: {} as never,
    privateServices: fixture.registry
  }), /router failed/u);
  assert.equal(fixture.mounts(), 0);
  assert.deepEqual(fixture.events, [
    "schema", "resources:create", "relay:close", "resources:close"
  ]);
});
