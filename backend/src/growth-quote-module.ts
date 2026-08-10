import type express from "express";
import type mysql from "mysql2/promise";
import type { GrowthCommercialToolPorts } from "./growth-commercial-application.js";
import type { GrowthCommercialModule } from "./growth-commercial-composition.js";
import {
  defineGrowthPrivateServiceKey,
  type GrowthPrivateServiceRegistry
} from "./growth-commercial-private-services.js";
import { GROWTH_FOUNDATION_SERVICES } from "./growth-foundation-module.js";
import { GROWTH_CATALOG_SERVICES } from "./growth-catalog-module.js";
import {
  createProbabilityAssessmentRepository,
  type ProbabilityAssessmentPersistence
} from "./probability-assessment.js";
import { ensureProbabilityAssessmentMysqlSchema } from "./probability-assessment-mysql-repository.js";
import type {
  GrowthTemporalBarrier,
  GrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";

export const GROWTH_PROBABILITY_ASSESSMENTS =
  defineGrowthPrivateServiceKey<ProbabilityAssessmentPersistence>(
    "growth-probability-assessments"
  );

export interface GrowthQuoteResourceFactoryInput {
  mode: "memory" | "mysql";
  pool?: mysql.Pool;
  temporalTransactions: GrowthTemporalTransactionRunner;
  temporalBarrier: GrowthTemporalBarrier;
}

export interface GrowthQuoteResourceHandle {
  probabilityAssessments: ProbabilityAssessmentPersistence;
  close(): Promise<void>;
}

interface GrowthQuoteModuleHooks {
  resourceFactory?: (
    input: GrowthQuoteResourceFactoryInput
  ) => GrowthQuoteResourceHandle | Promise<GrowthQuoteResourceHandle>;
}

export type GrowthQuoteModuleOptions = GrowthQuoteModuleHooks & (
  | { mode: "memory" }
  | { mode: "mysql"; pool: mysql.Pool }
);

async function defaultResources(
  options: GrowthQuoteModuleOptions,
  input: GrowthQuoteResourceFactoryInput
): Promise<GrowthQuoteResourceHandle> {
  if (options.mode === "mysql") {
    await ensureProbabilityAssessmentMysqlSchema(options.pool);
  }
  return {
    probabilityAssessments: createProbabilityAssessmentRepository(
      options.mode === "mysql"
        ? { mode: "mysql", pool: options.pool,
            temporalBarrier: input.temporalBarrier }
        : { mode: "memory", transactions: input.temporalTransactions,
            temporalBarrier: input.temporalBarrier }
    ),
    async close() {}
  };
}

export function createGrowthQuoteModule(
  options: GrowthQuoteModuleOptions
): GrowthCommercialModule {
  let installed = false;
  return Object.freeze({
    name: "growth-quote",
    async install(input: {
      router: express.Router;
      toolPorts: GrowthCommercialToolPorts;
      privateServices: GrowthPrivateServiceRegistry;
    }) {
      if (installed) throw new Error("DUPLICATE_GROWTH_QUOTE_INSTALL");
      installed = true;
      const foundation = input.privateServices.require(
        GROWTH_FOUNDATION_SERVICES
      );
      input.privateServices.require(GROWTH_CATALOG_SERVICES);
      const factoryInput: GrowthQuoteResourceFactoryInput = {
        mode: options.mode,
        ...(options.mode === "mysql" ? { pool: options.pool } : {}),
        temporalTransactions: foundation.temporalTransactions,
        temporalBarrier: foundation.temporalBarrier
      };
      let resources: GrowthQuoteResourceHandle | null = null;
      let closePromise: Promise<void> | null = null;
      const close = () => {
        closePromise ??= resources?.close() ?? Promise.resolve();
        return closePromise;
      };
      try {
        resources = options.resourceFactory
          ? await options.resourceFactory(factoryInput)
          : await defaultResources(options, factoryInput);
        input.privateServices.provide(
          GROWTH_PROBABILITY_ASSESSMENTS,
          resources.probabilityAssessments
        );
        return Object.freeze({ close });
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
    }
  });
}
