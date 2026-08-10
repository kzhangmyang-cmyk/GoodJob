import type express from "express";
import mysql from "mysql2/promise";
import type { GrowthCommercialToolPorts } from "./growth-commercial-application.js";
import type {
  GrowthPrivateServiceRegistry
} from "./growth-commercial-private-services.js";
import {
  type GrowthTemporalBarrier
} from "./growth-temporal-barrier.js";
import {
  createGrowthAcquisitionWorkspaceResolver,
  createGrowthWorkspaceMiddleware,
  type GrowthAcquisitionWorkspaceResolver,
  type GrowthWorkspaceDirectory
} from "./growth-workspace-context.js";
import { GROWTH_FOUNDATION_SERVICES, createGrowthFoundationModule } from "./growth-foundation-module.js";
import type { CrmStore } from "./store.js";

export interface GrowthCommercialModule {
  readonly name: string;
  install(input: {
    router: express.Router;
    toolPorts: GrowthCommercialToolPorts;
    privateServices: GrowthPrivateServiceRegistry;
  }): Promise<{ close(): Promise<void> }>;
}

export interface GrowthCommercialComposition<TIntegrations extends object> {
  modules: readonly GrowthCommercialModule[];
  projectIntegrations(
    privateServices: GrowthPrivateServiceRegistry
  ): TIntegrations;
}

export interface GrowthCommercialCompositionDependencies {
  acquisitionWorkspace: GrowthAcquisitionWorkspaceResolver;
  temporalBarrier?: GrowthTemporalBarrier;
  /** Foundation resource owners installed before future business modules. */
  modules?: readonly GrowthCommercialModule[];
}

export function createGrowthMysqlPool(
  databaseUrl: string,
  createPool: typeof mysql.createPool = mysql.createPool
): mysql.Pool {
  return createPool({
    uri: databaseUrl,
    connectionLimit: 4,
    namedPlaceholders: true,
    timezone: "Z",
    dateStrings: true
  });
}

export interface GrowthAcquisitionIntegrations {
  acquisitionWorkspace: GrowthAcquisitionWorkspaceResolver;
  temporalBarrier: GrowthTemporalBarrier;
  /** Foundation 0.3/Quote Task 6 replaces this absent, fail-closed seam. */
  quoteProjectedDocumentAuthority?: never;
}

export function createGrowthCommercialComposition(
  dependencies: GrowthCommercialCompositionDependencies
): GrowthCommercialComposition<GrowthAcquisitionIntegrations> {
  if (!dependencies?.acquisitionWorkspace) {
    throw new Error("MISSING_GROWTH_ACQUISITION_WORKSPACE");
  }
  if (!dependencies.temporalBarrier && !(dependencies.modules?.length)) {
    throw new Error("MISSING_GROWTH_TEMPORAL_BARRIER");
  }
  const foundation = Object.freeze({ ...dependencies });
  return Object.freeze({
    modules: Object.freeze([
      ...(dependencies.modules ?? [])
    ]) as readonly GrowthCommercialModule[],
    projectIntegrations(privateServices: GrowthPrivateServiceRegistry) {
      const services = privateServices.get(GROWTH_FOUNDATION_SERVICES);
      const acquisitionWorkspace = services?.acquisitionWorkspace
        ?? foundation.acquisitionWorkspace;
      const temporalBarrier = services?.temporalBarrier
        ?? foundation.temporalBarrier;
      if (!temporalBarrier) throw new Error("MISSING_GROWTH_FOUNDATION_SERVICES");
      return Object.freeze({
        acquisitionWorkspace,
        temporalBarrier
      });
    }
  });
}

export function createGrowthCommercialCompositionForStore(options: {
  store: Pick<CrmStore, "mode" | "users">;
  databaseUrl?: string;
  createMysqlPool?: typeof mysql.createPool;
}): {
  composition: GrowthCommercialComposition<GrowthAcquisitionIntegrations>;
  workspaceMiddleware: express.RequestHandler;
} {
  const workspaceDirectory: GrowthWorkspaceDirectory = {
    async canAccess(user, workspaceId) {
      return user.role === "super_admin" && options.store.users.some(
        (candidate) => candidate.status === "active"
          && candidate.teamId === workspaceId
      );
    }
  };
  const acquisitionWorkspace = createGrowthAcquisitionWorkspaceResolver({
    async resolve(scope) {
      const user = options.store.users.find((candidate) =>
        candidate.status === "active"
        && candidate.id === scope.ownerId
        && candidate.teamId === scope.teamId
      );
      if (!user || scope.teamId === "all") return null;
      return {
        workspaceId: scope.teamId,
        kind: "team" as const,
        bindingRevision: `crm-user-auth:${user.authVersion ?? 1}`
      };
    }
  });
  const modules: GrowthCommercialModule[] = [];
  if (options.store.mode === "mysql") {
    const databaseUrl = options.databaseUrl?.trim();
    if (!databaseUrl) throw new Error("GROWTH_DATABASE_URL_REQUIRED");
    const pool = createGrowthMysqlPool(databaseUrl, options.createMysqlPool);
    modules.push(createGrowthFoundationModule({
      mode: "mysql", pool, acquisitionWorkspace, closePool: () => pool.end()
    }));
  } else {
    modules.push(createGrowthFoundationModule({ mode: "memory", acquisitionWorkspace }));
  }
  return Object.freeze({
    composition: createGrowthCommercialComposition({
      acquisitionWorkspace,
      modules
    }),
    workspaceMiddleware: createGrowthWorkspaceMiddleware(workspaceDirectory)
  });
}
