import type express from "express";
import type mysql from "mysql2/promise";
import { createBusinessAdvisorService } from "./business-advisor/service.js";
import { FinancialCouncilAuthorityReader } from
  "./financial-council-authority-reader.js";
import type { FinancialCouncilRun } from "./financial-council-domain.js";
import { MysqlFinancialCouncilRepository,
  ensureFinancialCouncilMysqlSchema } from
  "./financial-council-mysql-repository.js";
import {
  InMemoryFinancialCouncilRepository,
  type FinancialCouncilRepository
} from "./financial-council-repository.js";
import { createFinancialCouncilRouter } from "./financial-council-router.js";
import {
  FinancialCouncilService,
  type FinancialCouncilWakeSink
} from "./financial-council-service.js";
import { FinancialSnapshotBuilder } from "./financial-council-snapshot.js";
import type { GrowthAdvisorSealedQueryService } from
  "./growth-advisor-query.js";
import { GROWTH_ADVISOR_SERVICES } from "./growth-advisor-module.js";
import type { GrowthCommercialModule } from
  "./growth-commercial-composition.js";
import type { GrowthCommercialToolPorts } from
  "./growth-commercial-application.js";
import {
  defineGrowthPrivateServiceKey,
  type GrowthPrivateServiceKey,
  type GrowthPrivateServiceRegistry
} from "./growth-commercial-private-services.js";
import {
  GROWTH_FINANCE_SERVICES,
  type GrowthFinanceServices
} from "./growth-finance-module.js";
import {
  GROWTH_FOUNDATION_SERVICES,
  type GrowthFoundationServices
} from "./growth-foundation-module.js";
import type { WorkspaceVerifiedFinancialLedgerSealedReader } from
  "./financial-ledger-as-of-reader.js";

export interface GrowthFinancialCouncilServices {
  readonly service: FinancialCouncilService;
}

export interface GrowthFinancialCouncilResources
extends GrowthFinancialCouncilServices {
  readonly relay: Pick<FinancialCouncilWakeRelay, "start" | "sweep" | "close">;
  closeFinancialCouncilResources(): Promise<void>;
}

export const GROWTH_FINANCIAL_COUNCIL_SERVICES:
GrowthPrivateServiceKey<GrowthFinancialCouncilServices> =
  defineGrowthPrivateServiceKey<GrowthFinancialCouncilServices>(
    "growth-financial-council-services"
  );

export interface FinancialCouncilWakeRelayDependencies {
  readonly repository: Pick<FinancialCouncilRepository, "listRunnableRuns">;
  readonly sink: FinancialCouncilWakeSink;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly onError?: (error: unknown, runId: string | null) => void;
}

export class FinancialCouncilWakeRelay {
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private cursor: { readonly workspaceId: string; readonly runId: string } | null
    = null;
  private closed = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(private readonly dependencies: FinancialCouncilWakeRelayDependencies) {
    this.intervalMs = dependencies.intervalMs ?? 5_000;
    this.batchSize = dependencies.batchSize ?? 25;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1
      || !Number.isSafeInteger(this.batchSize) || this.batchSize < 1
      || this.batchSize > 100) throw new Error("invalid_financial_council_relay");
  }

  start(): void {
    if (this.closed || this.timer) return;
    void this.sweep();
    this.timer = setInterval(() => { void this.sweep(); }, this.intervalMs);
    this.timer.unref?.();
  }

  sweep(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.runSweep().finally(() => { this.active = null; });
    return this.active;
  }

  private async runSweep(): Promise<void> {
    let runs: readonly FinancialCouncilRun[];
    try {
      runs = await this.dependencies.repository.listRunnableRuns({
        after: this.cursor,
        limit: this.batchSize
      });
    } catch (error) {
      this.report(error, null);
      return;
    }
    if (runs.length === 0) {
      this.cursor = null;
      return;
    }
    for (const run of runs) {
      if (this.closed) return;
      await this.dependencies.sink.wake(run).catch((error) => {
        this.report(error, run.runId);
      });
      this.cursor = Object.freeze({
        workspaceId: run.workspaceId,
        runId: run.runId
      });
    }
  }

  private report(error: unknown, runId: string | null): void {
    try {
      this.dependencies.onError?.(error, runId);
    } catch {
      // Error observation must never break the durable relay sweep.
    }
  }

  async close(): Promise<void> {
    if (this.closed) return this.active ?? Promise.resolve();
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.active;
  }
}

export interface GrowthFinancialCouncilModuleOptions {
  readonly mode?: "memory" | "mysql";
  readonly pool?: mysql.Pool;
  readonly wakeSink?: FinancialCouncilWakeSink;
  readonly relayIntervalMs?: number;
  readonly relayBatchSize?: number;
  readonly initializeSchema?: () => Promise<void>;
  readonly createResources?: (input: {
    foundation: GrowthFoundationServices;
    advisor: { readonly today: unknown };
    finance: GrowthFinanceServices;
  }) => Promise<GrowthFinancialCouncilResources>;
  readonly createRouter?: typeof createFinancialCouncilRouter;
}

function sealedAdvisor(value: unknown): GrowthAdvisorSealedQueryService {
  if (!value || typeof value !== "object"
    || typeof Reflect.get(value, "getToday") !== "function"
    || typeof Reflect.get(value, "getTodayAt") !== "function"
    || typeof Reflect.get(value, "sealTodayCutoff") !== "function") {
    throw new Error("INVALID_GROWTH_ADVISOR_SEALED_SERVICE");
  }
  return value as GrowthAdvisorSealedQueryService;
}

function workspaceFacts(
  value: unknown
): WorkspaceVerifiedFinancialLedgerSealedReader {
  if (!value || typeof value !== "object"
    || typeof Reflect.get(value, "listWorkspaceVerifiedFactsAt") !== "function") {
    throw new Error("INVALID_GROWTH_FINANCE_WORKSPACE_READER");
  }
  return value as WorkspaceVerifiedFinancialLedgerSealedReader;
}

class IdempotentInProcessWakeSink implements FinancialCouncilWakeSink {
  private readonly pending = new Set<string>();
  async wake(run: FinancialCouncilRun): Promise<void> {
    this.pending.add(run.runId);
  }
}

export async function createGrowthFinancialCouncilResources(input: {
  mode: "memory" | "mysql";
  pool?: mysql.Pool;
  foundation: GrowthFoundationServices;
  advisor: { readonly today: unknown };
  finance: GrowthFinanceServices;
  wakeSink?: FinancialCouncilWakeSink;
  relayIntervalMs?: number;
  relayBatchSize?: number;
}): Promise<GrowthFinancialCouncilResources> {
  const advisor = sealedAdvisor(input.advisor.today);
  const facts = workspaceFacts(input.finance.verifiedAsOf);
  const repository = input.mode === "mysql"
    ? new MysqlFinancialCouncilRepository(input.pool!)
    : new InMemoryFinancialCouncilRepository();
  if (input.mode === "mysql" && !input.pool) {
    throw new Error("GROWTH_FINANCIAL_COUNCIL_POOL_REQUIRED");
  }
  const authority = new FinancialCouncilAuthorityReader({
    advisor,
    verifiedFacts: {
      async listVisibleAt(_context, value) {
        return facts.listWorkspaceVerifiedFactsAt(value.cutoff, {
          currency: value.currency,
          limit: value.limit
        });
      }
    }
  });
  const snapshotBuilder = new FinancialSnapshotBuilder({
    cutoffIssuer: advisor,
    authority,
    businessAdvisor: createBusinessAdvisorService()
  });
  const sink = input.wakeSink ?? new IdempotentInProcessWakeSink();
  const service = new FinancialCouncilService({
    repository, snapshotBuilder, advisoryWake: sink
  });
  const relay = new FinancialCouncilWakeRelay({
    repository,
    sink,
    intervalMs: input.relayIntervalMs,
    batchSize: input.relayBatchSize
  });
  return Object.freeze({
    service,
    relay,
    async closeFinancialCouncilResources() {}
  });
}

function missingPrivateService(): Error & { code: string } {
  return Object.assign(new Error("MISSING_GROWTH_PRIVATE_SERVICE"), {
    code: "MISSING_GROWTH_PRIVATE_SERVICE"
  });
}

export function createGrowthFinancialCouncilModule(
  options: GrowthFinancialCouncilModuleOptions
): GrowthCommercialModule {
  let installed = false;
  let closed = false;
  return Object.freeze({
    name: "growth-financial-council",
    async install(input: {
      router: express.Router;
      toolPorts: GrowthCommercialToolPorts;
      privateServices: GrowthPrivateServiceRegistry;
    }) {
      if (installed) {
        throw new Error("GROWTH_FINANCIAL_COUNCIL_MODULE_ALREADY_INSTALLED");
      }
      installed = true;
      let foundation: GrowthFoundationServices;
      let advisor: { readonly today: unknown };
      let finance: GrowthFinanceServices;
      try {
        foundation = input.privateServices.require(GROWTH_FOUNDATION_SERVICES);
        advisor = input.privateServices.require(GROWTH_ADVISOR_SERVICES);
        finance = input.privateServices.require(GROWTH_FINANCE_SERVICES);
      } catch {
        throw missingPrivateService();
      }
      let resources: GrowthFinancialCouncilResources | null = null;
      try {
        if (options.initializeSchema) await options.initializeSchema();
        else if (options.mode === "mysql") {
          if (!options.pool) throw new Error("GROWTH_FINANCIAL_COUNCIL_POOL_REQUIRED");
          await ensureFinancialCouncilMysqlSchema(options.pool);
        }
        resources = options.createResources
          ? await options.createResources({ foundation, advisor, finance })
          : await createGrowthFinancialCouncilResources({
              mode: options.mode ?? "memory",
              pool: options.pool,
              foundation,
              advisor,
              finance,
              wakeSink: options.wakeSink,
              relayIntervalMs: options.relayIntervalMs,
              relayBatchSize: options.relayBatchSize
            });
        const services = Object.freeze({ service: resources.service });
        input.privateServices.provide(
          GROWTH_FINANCIAL_COUNCIL_SERVICES, services
        );
        const routerFactory = options.createRouter
          ?? createFinancialCouncilRouter;
        input.router.use(
          "/api/v1/finance/council-runs",
          routerFactory({
            service: resources.service,
            workspaceContext: foundation.workspaceContext,
            commandContextFactory: foundation.commandContextFactory,
            httpIdempotency: foundation.httpIdempotency
          })
        );
        resources.relay.start();
        return {
          async close() {
            if (closed) return;
            closed = true;
            await resources!.relay.close();
            await resources!.closeFinancialCouncilResources();
          }
        };
      } catch (error) {
        if (resources) {
          await resources.relay.close().catch(() => undefined);
          await resources.closeFinancialCouncilResources()
            .catch(() => undefined);
        }
        throw error;
      }
    }
  });
}
