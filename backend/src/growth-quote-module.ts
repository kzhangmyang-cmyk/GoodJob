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
import {
  QuoteVersionService,
  type CreateQuoteVersionInput,
  type QuotePreviewInput,
  type QuoteQualificationAuthority
} from "./quote-version-service.js";
import type { CommercialBindingAuthoritySource } from "./commercial-binding-snapshot.js";
import { CommercialBindingVerifier } from "./commercial-binding-snapshot.js";
import type { GrowthWorkspaceMemberAssignabilityReader } from "./growth-workspace-member-assignability.js";
import type { GrowthHttpIdempotencyRepository } from "./growth-http-idempotency-repository.js";
import type {
  GrowthTemporalBarrier,
  GrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";
import type { GrowthCatalogServices } from "./growth-catalog-module.js";
import type { GrowthFoundationServices } from "./growth-foundation-module.js";
import { parseIfMatchRevision, setRevisionEtag } from "./growth-http-preconditions.js";
import { GrowthHttpError } from "./growth-command-context.js";

export const GROWTH_PROBABILITY_ASSESSMENTS =
  defineGrowthPrivateServiceKey<ProbabilityAssessmentPersistence>(
    "growth-probability-assessments"
  );

export interface GrowthQuoteServices {
  readonly repository: QuoteRepository;
  readonly quoteCases: QuoteCaseService;
  readonly quoteVersions: QuoteVersionService;
}

export const GROWTH_QUOTE_SERVICES =
  defineGrowthPrivateServiceKey<GrowthQuoteServices>("growth-quote-services");

export interface GrowthQuoteTrustedAuthority {
  readonly assignments: GrowthWorkspaceMemberAssignabilityReader;
  readonly subjects: QuoteSubjectReader;
  readonly commercialBindings: CommercialBindingAuthoritySource;
  readonly qualificationAuthority?: QuoteQualificationAuthority;
}

export interface GrowthQuoteResourceFactoryInput {
  mode: "memory" | "mysql";
  pool?: mysql.Pool;
  temporalTransactions: GrowthTemporalTransactionRunner;
  temporalBarrier: GrowthTemporalBarrier;
  httpIdempotency: GrowthHttpIdempotencyRepository;
  foundation: GrowthFoundationServices;
  catalog: GrowthCatalogServices;
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

function routeId(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value
    || value === "" || value.length > 191) {
    throw new GrowthHttpError(400, "invalid_quote_resource_id");
  }
  return value;
}

function route(
  action: (
    req: express.Request,
    res: express.Response
  ) => Promise<void>
) {
  return (req: express.Request, res: express.Response,
    next: express.NextFunction) => {
    action(req, res).catch(next);
  };
}

function replayHeader(res: express.Response, replayed: boolean) {
  if (replayed) res.setHeader("Idempotency-Replayed", "true");
}

function mountQuoteVersionRoutes(
  router: express.Router,
  service: QuoteVersionService,
  foundation: GrowthFoundationServices
) {
  router.post("/api/v1/quotes/cases/:id/preview", route(async (req, res) => {
    const id = routeId(req.params.id);
    const expectedRevision = parseIfMatchRevision(req, `quote-case:${id}`);
    const payload = req.body as QuotePreviewInput;
    const command = foundation.commandContextFactory(req, {
      canonicalPath: "/api/v1/quotes/cases/:id/preview",
      pathParams: Object.freeze({ id }), payload, expectedRevision
    });
    const result = await service.preview(command, id, payload);
    replayHeader(res, result.replayed);
    res.status(200).json(result.value);
  }));
  router.get("/api/v1/quotes/cases/:id/versions", route(async (req, res) => {
    const id = routeId(req.params.id);
    const context = foundation.workspaceContext(req);
    const items = await service.listVersions(context, id);
    res.status(200).json({ items, nextCursor: null });
  }));
  router.post("/api/v1/quotes/cases/:id/versions", route(async (req, res) => {
    const id = routeId(req.params.id);
    const expectedRevision = parseIfMatchRevision(req, `quote-case:${id}`);
    const payload = req.body as CreateQuoteVersionInput;
    const command = foundation.commandContextFactory(req, {
      canonicalPath: "/api/v1/quotes/cases/:id/versions",
      pathParams: Object.freeze({ id }), payload, expectedRevision
    });
    const result = await service.createVersion(command, id, payload);
    replayHeader(res, result.replayed);
    setRevisionEtag(res, "quote-version", result.value.id,
      result.value.lifecycleRevision);
    res.status(201).json(result.value);
  }));
  router.get("/api/v1/quotes/versions/:id", route(async (req, res) => {
    const id = routeId(req.params.id);
    const version = await service.getVersion(foundation.workspaceContext(req), id);
    setRevisionEtag(res, "quote-version", version.id,
      version.lifecycleRevision);
    res.status(200).json(version);
  }));
  router.post("/api/v1/quotes/versions/:id/submit", route(async (req, res) => {
    const id = routeId(req.params.id);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)
      || Object.keys(req.body as object).length !== 0) {
      throw new GrowthHttpError(400, "invalid_quote_submit_input");
    }
    const expectedRevision = parseIfMatchRevision(req, `quote-version:${id}`);
    const payload = Object.freeze({});
    const command = foundation.commandContextFactory(req, {
      canonicalPath: "/api/v1/quotes/versions/:id/submit",
      pathParams: Object.freeze({ id }), payload, expectedRevision
    });
    const result = await service.submit(command, id);
    replayHeader(res, result.replayed);
    setRevisionEtag(res, "quote-version", result.value.submittedVersion.id,
      result.value.submittedVersion.lifecycleRevision);
    res.status(200).json(result.value);
  }));
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
  const bindingVerifier = trusted
    ? new CommercialBindingVerifier(trusted.commercialBindings)
    : null;
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
          bindingVerifier: bindingVerifier!,
          probabilityAssessments
        }),
        quoteVersions: new QuoteVersionService({
          repository,
          probabilityAssessments,
          bindingVerifier: bindingVerifier!,
          catalog: input.catalog,
          foundation: input.foundation,
          qualificationAuthority: trusted.qualificationAuthority
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
      const catalog = input.privateServices.require(GROWTH_CATALOG_SERVICES);
      const factoryInput: GrowthQuoteResourceFactoryInput = {
        mode: options.mode,
        ...(options.mode === "mysql" ? { pool: options.pool } : {}),
        temporalTransactions: foundation.temporalTransactions,
        temporalBarrier: foundation.temporalBarrier,
        httpIdempotency: foundation.httpIdempotency,
        foundation,
        catalog,
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
          mountQuoteVersionRoutes(input.router, resources.quote.quoteVersions,
            foundation);
        }
        return Object.freeze({ close });
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
    }
  });
}
