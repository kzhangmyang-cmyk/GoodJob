import { randomUUID } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response
} from "express";
import { z, ZodError } from "zod";
import {
  AcquisitionPlanRunError,
  type AcquisitionPlanRunService,
  type AcquisitionScope
} from "./acquisition-plan-run-service.js";

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const idSchema = requiredText(255);
const usageSchema = z.object({
  requests: z.number().int().nonnegative(),
  results: z.number().int().nonnegative(),
  amountMinor: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative()
}).strict();
const budgetSchema = z.object({
  billingCurrency: z.string().trim().length(3),
  maxRequests: z.number().int().nonnegative(),
  maxResults: z.number().int().nonnegative(),
  maxAmountMinor: z.number().int().nonnegative(),
  maxDurationSeconds: z.number().int().nonnegative()
}).strict();
const providerConnectionSchema = z.object({
  connectionId: idSchema,
  providerId: requiredText(100),
  kind: z.enum(["search", "content_fetch", "import"]),
  status: z.enum(["active", "inactive", "disabled"]),
  credentialVersion: z.number().int().positive()
}).strict();
const operationSchema = z.object({
  operationId: idSchema,
  subjectChannel: z.enum(["organization", "individual"]),
  kind: z.enum(["search", "content_fetch", "import_rows"]),
  connectionId: idSchema,
  query: z.string().trim().min(1).max(4_000).optional(),
  sourceRef: z.string().trim().min(1).max(4_000).optional(),
  allocatedBudget: usageSchema
}).strict();
const modelSnapshotSchema = z.object({
  jobSnapshotId: idSchema,
  connectionId: idSchema,
  credentialVersion: z.number().int().positive(),
  provider: requiredText(100),
  model: requiredText(200),
  capabilitySnapshotHash: requiredText(200),
  promptVersion: requiredText(100),
  schemaVersion: requiredText(100),
  promptHash: requiredText(200),
  schemaHash: requiredText(200)
}).strict();
const planPayloadSchema = z.object({
  name: requiredText(200),
  objective: requiredText(2_000),
  icp: z.object({
    industries: z.array(requiredText(120)).min(1).max(100),
    regions: z.array(requiredText(120)).min(1).max(100),
    organizationCriteria: z.array(requiredText(500)).min(1).max(100),
    individualCriteria: z.array(requiredText(500)).min(1).max(100),
    exclusionRules: z.array(requiredText(500)).max(200)
  }).strict(),
  subjectChannels: z.object({
    organization: z.boolean(),
    individual: z.boolean()
  }).strict(),
  providerConnections: z.array(providerConnectionSchema).min(1).max(100),
  operations: z.array(operationSchema).min(1).max(500),
  budgetSnapshot: budgetSchema,
  modelSnapshotRef: modelSnapshotSchema,
  stopConditions: z.object({
    stopWhenBudgetExhausted: z.boolean(),
    stopWhenNoMoreResults: z.boolean()
  }).strict()
}).strict();
const planPatchSchema = planPayloadSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少提供一个需要更新的计划字段"
);
const approvalSchema = z.object({
  decision: z.literal("approve"),
  reason: requiredText(2_000)
}).strict();
const runBodySchema = z.object({
  parentRunId: idSchema.optional(),
  reason: z.string().trim().max(2_000).optional()
}).strict();
const controlBodySchema = z.object({
  reason: requiredText(2_000)
}).strict();

export interface AcquisitionPlanRouterOptions {
  service: AcquisitionPlanRunService;
  requestIdFactory?: () => string;
}

class AcquisitionPlanHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AcquisitionPlanHttpError";
  }
}

function scopeFromRequest(req: Request): AcquisitionScope {
  const user = (req as Request & {
    user?: { id?: string; teamId?: string };
  }).user;
  if (!user?.id || !user.teamId) {
    throw new AcquisitionPlanHttpError(
      "unauthorized",
      "需要登录后访问",
      401
    );
  }
  return {
    ownerId: user.id,
    teamId: user.teamId,
    actorId: user.id
  };
}

function ifMatch(req: Request) {
  return req.header("If-Match")?.trim() ?? "";
}

function idempotencyKey(req: Request) {
  const key = req.header("Idempotency-Key")?.trim() ?? "";
  if (key.length < 8 || key.length > 200) {
    throw new AcquisitionPlanHttpError(
      "invalid_idempotency_key",
      "必须提供 8 到 200 个字符的 Idempotency-Key",
      400
    );
  }
  return key;
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

function sendError(error: unknown, res: Response) {
  const requestId = String(res.locals.acquisitionPlanRequestId ?? "");
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "invalid_request",
        message: "请求参数不符合计划接口约束",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message
        })),
        requestId
      }
    });
    return;
  }
  if (error instanceof AcquisitionPlanRunError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId
      }
    });
    return;
  }
  if (error instanceof AcquisitionPlanHttpError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: null,
        requestId
      }
    });
    return;
  }
  res.status(500).json({
    error: {
      code: "acquisition_plan_internal_error",
      message: "获客计划服务暂时不可用",
      details: null,
      requestId
    }
  });
}

function setEtag(res: Response, resource: { etag: string }) {
  res.setHeader("ETag", resource.etag);
}

export function createAcquisitionPlanRouter(
  options: AcquisitionPlanRouterOptions
) {
  const router = Router();
  const requestId = options.requestIdFactory
    ?? (() => `request_${randomUUID()}`);

  router.use("/api/v1/acquisition", (_req, res, next) => {
    const id = requestId();
    res.locals.acquisitionPlanRequestId = id;
    res.setHeader("X-Request-Id", id);
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.use("/api/v1/acquisition", (req, res, next) => {
    try {
      scopeFromRequest(req);
      next();
    } catch (error) {
      sendError(error, res);
    }
  });

  router.post(
    "/api/v1/acquisition/plans",
    asyncRoute(async (req, res) => {
      const plan = await options.service.createPlan(
        scopeFromRequest(req),
        planPayloadSchema.parse(req.body)
      );
      setEtag(res, plan);
      res.status(201).json(plan);
    })
  );

  router.get(
    "/api/v1/acquisition/plans/:id",
    asyncRoute(async (req, res) => {
      const plan = await options.service.getPlan(
        scopeFromRequest(req),
        idSchema.parse(req.params.id)
      );
      setEtag(res, plan);
      res.json(plan);
    })
  );

  router.patch(
    "/api/v1/acquisition/plans/:id",
    asyncRoute(async (req, res) => {
      const plan = await options.service.updatePlan(
        scopeFromRequest(req),
        idSchema.parse(req.params.id),
        ifMatch(req),
        planPatchSchema.parse(req.body)
      );
      setEtag(res, plan);
      res.json(plan);
    })
  );

  router.post(
    "/api/v1/acquisition/plans/:id/revisions",
    asyncRoute(async (req, res) => {
      const plan = await options.service.createPlanRevision(
        scopeFromRequest(req),
        idSchema.parse(req.params.id),
        ifMatch(req),
        planPatchSchema.parse(req.body)
      );
      setEtag(res, plan);
      res.status(201).json(plan);
    })
  );

  router.post(
    "/api/v1/acquisition/plans/:id/approval",
    asyncRoute(async (req, res) => {
      const plan = await options.service.approvePlan(
        scopeFromRequest(req),
        idSchema.parse(req.params.id),
        ifMatch(req),
        approvalSchema.parse(req.body)
      );
      setEtag(res, plan);
      res.json(plan);
    })
  );

  router.post(
    "/api/v1/acquisition/plans/:id/runs",
    asyncRoute(async (req, res) => {
      const body = runBodySchema.parse(req.body ?? {});
      const run = await options.service.createRun(
        scopeFromRequest(req),
        idSchema.parse(req.params.id),
        {
          idempotencyKey: idempotencyKey(req),
          parentRunId: body.parentRunId,
          reason: body.reason
        }
      );
      setEtag(res, run);
      res.status(202).json(run);
    })
  );

  router.get(
    "/api/v1/acquisition/runs/:id",
    asyncRoute(async (req, res) => {
      const run = await options.service.getRun(
        scopeFromRequest(req),
        idSchema.parse(req.params.id)
      );
      setEtag(res, run);
      res.json(run);
    })
  );

  router.get(
    "/api/v1/acquisition/runs/:id/shards",
    asyncRoute(async (req, res) => {
      const items = await options.service.listRunShards(
        scopeFromRequest(req),
        idSchema.parse(req.params.id)
      );
      res.json({ items, nextCursor: null });
    })
  );

  for (const action of ["pause", "resume", "cancel"] as const) {
    router.post(
      `/api/v1/acquisition/runs/:id/${action}`,
      asyncRoute(async (req, res) => {
        const scope = scopeFromRequest(req);
        const id = idSchema.parse(req.params.id);
        const body = controlBodySchema.parse(req.body);
        const run = action === "pause"
          ? await options.service.pauseRun(
              scope,
              id,
              ifMatch(req),
              body
            )
          : action === "resume"
            ? await options.service.resumeRun(
                scope,
                id,
                ifMatch(req),
                body
              )
            : await options.service.cancelRun(
                scope,
                id,
                ifMatch(req),
                body
              );
        setEtag(res, run);
        res.json(run);
      })
    );
  }

  router.use(
    "/api/v1/acquisition",
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      sendError(error, res);
    }
  );

  return router;
}
