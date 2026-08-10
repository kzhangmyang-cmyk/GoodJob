import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router
} from "express";
import { z } from "zod";
import {
  CatalogServiceError,
  type CatalogItemInput,
  type CatalogItemPatch,
  type CatalogService
} from "./catalog-service.js";
import { GrowthAuthorizationError } from "./growth-capabilities.js";
import { GrowthHttpError, type CommandContext } from "./growth-command-context.js";
import {
  executeGrowthIdempotentCommand,
  type GrowthHttpIdempotencyRepository
} from "./growth-http-idempotency-repository.js";
import {
  parseIfMatchRevision,
  setRevisionEtag,
  type GrowthCommandContextFactory,
  type GrowthWorkspaceContextResolver
} from "./growth-http-preconditions.js";

const idSchema = z.string().trim().min(1).max(191);
const itemInputSchema = z.object({
  type: z.enum(["product", "service", "package"]),
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(4_000).nullable(),
  unit: z.string().min(1).max(50)
}).strict();
const itemPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4_000).nullable().optional(),
  unit: z.string().min(1).max(50).optional()
}).strict().refine((value) => Object.keys(value).length > 0);
const emptyBodySchema = z.object({}).strict();
const emptyQuerySchema = z.object({}).strict();
const listQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.preprocess(
    (value) => value === undefined ? 20 : Number(value),
    z.number().int().min(1).max(100)
  ),
  sort: z.enum(["code", "name", "updatedAt"]).optional().default("updatedAt")
}).strict();

export interface CatalogRouterOptions {
  catalogService: CatalogService;
  pricingPolicyService?: unknown;
  packageVersionService?: unknown;
  httpIdempotency: GrowthHttpIdempotencyRepository;
  workspaceContext: GrowthWorkspaceContextResolver;
  commandContextFactory: GrowthCommandContextFactory;
}

function reservation(req: Request, context: CommandContext, canonicalPath: string) {
  return {
    workspaceId: context.workspace.workspaceId,
    actorId: context.actorId,
    method: req.method.toUpperCase(),
    canonicalPath,
    key: context.idempotencyKey,
    requestHash: context.requestHash,
    attemptedAt: new Date().toISOString(),
    leaseOwner: randomUUID(),
    leaseDurationMs: 30_000
  };
}

function sendError(req: Request, res: Response, status: number, code: string) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({
    code,
    message: code,
    details: null,
    requestId: req.header("X-Request-Id")?.trim() || randomUUID(),
    retryable: code === "idempotency_in_progress"
  });
}

function handle(
  action: (req: Request, res: Response) => Promise<void> | void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(action(req, res)).catch(next);
  };
}

function respondItem(
  res: Response,
  item: Awaited<ReturnType<CatalogService["get"]>>,
  replayed = false,
  status = 200
) {
  setRevisionEtag(res, "catalog-item", item.id, item.revision);
  if (replayed) res.setHeader("Idempotency-Replayed", "true");
  res.status(status).json(item);
}

export function createCatalogRouter(options: CatalogRouterOptions): Router {
  const router = express.Router();

  router.get("/items", handle(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const context = options.workspaceContext(req);
    res.json(await options.catalogService.list(context, {
      cursor: query.cursor ?? null,
      limit: query.limit,
      sort: query.sort
    }));
  }));

  router.post("/items", handle(async (req, res) => {
    const payload = itemInputSchema.parse(req.body) as CatalogItemInput;
    const canonicalPath = "/api/v1/catalog/items";
    const context = options.commandContextFactory(req, {
      canonicalPath,
      pathParams: Object.freeze({}),
      payload,
      expectedRevision: null
    });
    const result = await executeGrowthIdempotentCommand({
      repository: options.httpIdempotency,
      reservation: reservation(req, context, canonicalPath)
    }, async (resourceId) => {
      if (!resourceId) throw new Error("catalog_idempotency_resource_missing");
      return options.catalogService.get(context.workspace, resourceId);
    }, async () => {
      const item = await options.catalogService.create(context, payload);
      return { resourceId: item.id, operationId: null };
    });
    respondItem(res, result.value, result.replayed, result.replayed ? 200 : 201);
  }));

  router.get("/items/:id", handle(async (req, res) => {
    emptyQuerySchema.parse(req.query);
    const id = idSchema.parse(req.params.id);
    const context = options.workspaceContext(req);
    respondItem(res, await options.catalogService.get(context, id));
  }));

  router.patch("/items/:id", handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const payload = itemPatchSchema.parse(req.body) as CatalogItemPatch;
    const canonicalPath = "/api/v1/catalog/items/:id";
    const expectedRevision = parseIfMatchRevision(
      req,
      `catalog-item:${id}`
    );
    const context = options.commandContextFactory(req, {
      canonicalPath,
      pathParams: Object.freeze({ id }),
      payload,
      expectedRevision
    });
    const result = await executeGrowthIdempotentCommand({
      repository: options.httpIdempotency,
      reservation: reservation(req, context, canonicalPath)
    }, async (resourceId) => {
      if (resourceId !== id) throw new GrowthHttpError(409, "idempotency_conflict");
      return options.catalogService.get(context.workspace, id);
    }, async () => {
      const item = await options.catalogService.update(context, id, payload);
      return { resourceId: item.id, operationId: null };
    });
    respondItem(res, result.value, result.replayed);
  }));

  router.post("/items/:id/retire", handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const payload = emptyBodySchema.parse(req.body);
    const canonicalPath = "/api/v1/catalog/items/:id/retire";
    const expectedRevision = parseIfMatchRevision(
      req,
      `catalog-item:${id}`
    );
    const context = options.commandContextFactory(req, {
      canonicalPath,
      pathParams: Object.freeze({ id }),
      payload,
      expectedRevision
    });
    const result = await executeGrowthIdempotentCommand({
      repository: options.httpIdempotency,
      reservation: reservation(req, context, canonicalPath)
    }, async (resourceId) => {
      if (resourceId !== id) throw new GrowthHttpError(409, "idempotency_conflict");
      return options.catalogService.get(context.workspace, id);
    }, async () => {
      const item = await options.catalogService.retire(context, id);
      return { resourceId: item.id, operationId: null };
    });
    respondItem(res, result.value, result.replayed);
  }));

  router.use((
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof z.ZodError) {
      sendError(req, res, 400, "invalid_request");
      return;
    }
    if (error instanceof GrowthAuthorizationError) {
      sendError(req, res, 403, error.code);
      return;
    }
    if (error instanceof GrowthHttpError || error instanceof CatalogServiceError) {
      sendError(req, res, error.status, error.code);
      return;
    }
    next(error);
  });
  return router;
}
