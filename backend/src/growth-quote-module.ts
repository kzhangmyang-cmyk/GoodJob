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
import {
  InMemoryQuoteRepository,
  type QuoteRepository
} from "./quote-repository.js";
import {
  MysqlQuoteRepository,
  ensureQuoteMysqlSchema
} from "./quote-mysql-repository.js";
import {
  QuoteCaseService,
  type QuoteSubjectReader
} from "./quote-case-service.js";
import type { CommercialBindingAuthoritySource } from "./commercial-binding-snapshot.js";
import { CommercialBindingVerifier } from "./commercial-binding-snapshot.js";
import type { GrowthWorkspaceMemberAssignabilityReader } from "./growth-workspace-member-assignability.js";
import type { GrowthHttpIdempotencyRepository } from "./growth-http-idempotency-repository.js";
import type {
  GrowthTemporalBarrier,
  GrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";

export const GROWTH_PROBABILITY_ASSESSMENTS =
  defineGrowthPrivateServiceKey<ProbabilityAssessmentPersistence>(
    "growth-probability-assessments"
  );

export interface GrowthQuoteServices {
  readonly repository: QuoteRepository;
  readonly quoteCases: QuoteCaseService;
}

export const GROWTH_QUOTE_SERVICES =
  defineGrowthPrivateServiceKey<GrowthQuoteServices>("growth-quote-services");

export interface GrowthQuoteTrustedAuthority {
  readonly assignments: GrowthWorkspaceMemberAssignabilityReader;
  readonly subjects: QuoteSubjectReader;
  readonly commercialBindings: CommercialBindingAuthoritySource;
}

export interface GrowthQuoteResourceFactoryInput {
  mode: "memory" | "mysql";
  pool?: mysql.Pool;
  temporalTransactions: GrowthTemporalTransactionRunner;
  temporalBarrier: GrowthTemporalBarrier;
  httpIdempotency: GrowthHttpIdempotencyRepository;
  trustedAuthority?: GrowthQuoteTrustedAuthority;
}

export interface GrowthQuoteResourceHandle {
  probabilityAssessments: ProbabilityAssessmentPersistence;
  quote?: GrowthQuoteServices;
  close(): Promise<void>;
}

interface GrowthQuoteModuleHooks {
  resourceFactory?: (
    input: GrowthQuoteResourceFactoryInput
  ) => GrowthQuoteResourceHandle | Promise<GrowthQuoteResourceHandle>;
}

export type GrowthQuoteModuleOptions = GrowthQuoteModuleHooks & {
  trustedAuthority?: GrowthQuoteTrustedAuthority;
} & (
  | { mode: "memory" }
  | { mode: "mysql"; pool: mysql.Pool }
);

async function defaultResources(
  options: GrowthQuoteModuleOptions,
  input: GrowthQuoteResourceFactoryInput
): Promise<GrowthQuoteResourceHandle> {
  if (options.mode === "mysql") {
    await ensureProbabilityAssessmentMysqlSchema(options.pool);
    await ensureQuoteMysqlSchema(options.pool);
  }
  const probabilityAssessments = createProbabilityAssessmentRepository(
    options.mode === "mysql"
      ? { mode: "mysql", pool: options.pool,
          temporalBarrier: input.temporalBarrier }
      : { mode: "memory", transactions: input.temporalTransactions,
          temporalBarrier: input.temporalBarrier }
  );
  const repository: QuoteRepository = options.mode === "mysql"
    ? new MysqlQuoteRepository(options.pool, input.temporalBarrier)
    : new InMemoryQuoteRepository(input.temporalTransactions,
        input.temporalBarrier);
  const trusted = input.trustedAuthority;
  return {
    probabilityAssessments,
    ...(trusted ? {
      quote: Object.freeze({
        repository,
        quoteCases: new QuoteCaseService({
          repository,
          httpIdempotency: input.httpIdempotency,
          assignments: trusted.assignments,
          subjects: trusted.subjects,
          bindingVerifier: new CommercialBindingVerifier(
            trusted.commercialBindings
          ),
          probabilityAssessments
        })
      })
    } : {}),
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
        temporalBarrier: foundation.temporalBarrier,
        httpIdempotency: foundation.httpIdempotency,
        trustedAuthority: options.trustedAuthority
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
        if (resources.quote) {
          input.privateServices.provide(GROWTH_QUOTE_SERVICES, resources.quote);
        }
        return Object.freeze({ close });
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
    }
  });
}
