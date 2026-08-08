import { randomUUID } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response
} from "express";
import { z, ZodError } from "zod";
import type {
  AcquisitionDouyinIdentityResolutionCreateInput,
  AcquisitionDouyinIdentityResolutionOperation,
  AcquisitionDouyinIdentityResolutionScope
} from "./acquisition-douyin-identity-resolution-operations.js";
import {
  AcquisitionDouyinIdentityResolutionOperationError
} from "./acquisition-douyin-identity-resolution-operations.js";

const candidateIdSchema = z.string().trim().min(1).max(120);
const emptyBodySchema = z.object({}).strict();

export type AcquisitionDouyinIdentityResolutionRouterScope =
  AcquisitionDouyinIdentityResolutionScope;

export type AcquisitionDouyinIdentityResolutionRouterOperation =
  AcquisitionDouyinIdentityResolutionOperation;

export interface AcquisitionDouyinIdentityResolutionRouterCandidate {
  id: string;
  version: number;
  partyType: string;
  partyRef: { partyType: string };
  profile: { kind: string; sourcePlatform?: string };
  evidenceIds: string[];
  identityResolution?: { status?: string } | null;
}

export interface AcquisitionDouyinIdentityResolutionRouterOptions {
  operations: {
    findByIdempotency(
      scope: AcquisitionDouyinIdentityResolutionScope,
      idempotencyKey: string
    ): Promise<AcquisitionDouyinIdentityResolutionOperation | null>;
    findLatestForCandidate(
      scope: AcquisitionDouyinIdentityResolutionScope,
      candidateId: string
    ): Promise<AcquisitionDouyinIdentityResolutionOperation | null>;
    create(
      scope: AcquisitionDouyinIdentityResolutionScope,
      input: AcquisitionDouyinIdentityResolutionCreateInput,
      idempotencyKey: string
    ): Promise<{
      operation: AcquisitionDouyinIdentityResolutionOperation;
      replayed: boolean;
    }>;
  };
  candidates: {
    getCandidate(
      scope: AcquisitionDouyinIdentityResolutionScope,
      candidateId: string
    ): Promise<AcquisitionDouyinIdentityResolutionRouterCandidate | null>;
  };
  searchConnections: {
    list(
      scope: AcquisitionDouyinIdentityResolutionScope
    ): Promise<AcquisitionDouyinIdentityResolutionCreateInput["searchConnections"]>;
  };
  candidateIsResolved?: (
    candidate: AcquisitionDouyinIdentityResolutionRouterCandidate
  ) => boolean;
  dispatchOperation: (
    scope: AcquisitionDouyinIdentityResolutionScope,
    operationId: string
  ) => Promise<void>;
  requestIdFactory?: () => string;
}

class DouyinIdentityResolutionHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "DouyinIdentityResolutionHttpError";
  }
}

function scopeFromRequest(req: Request): AcquisitionDouyinIdentityResolutionScope {
  const user = req.user;
  if (!user?.id || !user.teamId) {
    throw new DouyinIdentityResolutionHttpError(
      "unauthorized",
      "需要登录后访问",
      401
    );
  }
  return { ownerId: user.id, teamId: user.teamId, actorId: user.id };
}

function idempotencyKey(req: Request) {
  const value = req.header("Idempotency-Key")?.trim() ?? "";
  if (!value || value.length > 200) {
    throw new DouyinIdentityResolutionHttpError(
      value ? "invalid_idempotency_key" : "idempotency_key_required",
      value
        ? "Idempotency-Key 不能超过 200 个字符"
        : "必须提供 Idempotency-Key 请求头",
      400
    );
  }
  return value;
}

function unresolvedDouyinCandidate(
  candidate: AcquisitionDouyinIdentityResolutionRouterCandidate,
  candidateIsResolved: (
    candidate: AcquisitionDouyinIdentityResolutionRouterCandidate
  ) => boolean
) {
  return candidate.partyType === "individual"
    && candidate.partyRef.partyType === "individual"
    && candidate.profile.kind === "individual"
    && candidate.profile.sourcePlatform?.toLocaleLowerCase("en-US") === "douyin"
    && !candidateIsResolved(candidate);
}

function publicOperation(operation: AcquisitionDouyinIdentityResolutionOperation) {
  return {
    id: operation.id,
    candidateId: operation.candidateId,
    candidateVersion: operation.candidateVersion,
    status: operation.status,
    currentStage: operation.currentStage,
    outcome: operation.outcome,
    retryable: operation.retryable,
    canonicalProfileUrl: operation.canonicalProfileUrl,
    profileCandidates: structuredClone(operation.profileCandidates),
    evidence: structuredClone(operation.evidence),
    intelligenceOperationId: operation.intelligenceOperationId,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    completedAt: operation.completedAt
  };
}

function operationErrorResponse(
  error: AcquisitionDouyinIdentityResolutionOperationError
) {
  switch (error.code) {
    case "INVALID_REQUEST": return { status: 400, message: "请求参数无效" };
    case "RESOURCE_NOT_FOUND": return { status: 404, message: "抖音主体核验任务不存在" };
    case "IDEMPOTENCY_CONFLICT": return { status: 409, message: "Idempotency-Key 已用于不同请求" };
    case "OPERATION_ALREADY_RUNNING": return { status: 409, message: "抖音主体核验任务正在运行" };
  }
}

function sendError(error: unknown, res: Response) {
  let code = "internal_error";
  let message = "抖音主体核验服务暂时不可用";
  let status = 500;
  let details: unknown = null;
  if (error instanceof ZodError) {
    code = "invalid_request";
    message = "请求参数不符合抖音主体核验接口约束";
    status = 400;
    details = { issues: error.issues.map((issue) => ({
      code: issue.code, path: issue.path.join("."), message: issue.message
    })) };
  } else if (error instanceof DouyinIdentityResolutionHttpError) {
    ({ code, message, status } = error);
  } else if (error instanceof AcquisitionDouyinIdentityResolutionOperationError) {
    const mapped = operationErrorResponse(error);
    code = error.code.toLocaleLowerCase("en-US");
    message = mapped.message;
    status = mapped.status;
  }
  res.status(status).json({
    code,
    message,
    details,
    requestId: String(res.locals.douyinIdentityResolutionRequestId ?? ""),
    retryable: status >= 500
  });
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

export function createAcquisitionDouyinIdentityResolutionRouter(
  options: AcquisitionDouyinIdentityResolutionRouterOptions
) {
  const router = Router();
  const createRequestId = options.requestIdFactory
    ?? (() => `request_${randomUUID()}`);
  const candidateIsResolved = options.candidateIsResolved
    ?? ((candidate) => candidate.identityResolution?.status === "resolved");

  router.use("/api/v1/acquisition", (_req, res, next) => {
    const requestId = createRequestId();
    res.locals.douyinIdentityResolutionRequestId = requestId;
    res.setHeader("X-Request-Id", requestId);
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

  router.get(
    "/api/v1/acquisition/candidates/:candidateId/douyin-identity-resolution-operation",
    asyncRoute(async (req, res) => {
      const operation = await options.operations.findLatestForCandidate(
        scopeFromRequest(req),
        candidateIdSchema.parse(req.params.candidateId)
      );
      if (!operation) {
        throw new AcquisitionDouyinIdentityResolutionOperationError(
          "RESOURCE_NOT_FOUND"
        );
      }
      res.json(publicOperation(operation));
    })
  );

  router.post(
    "/api/v1/acquisition/candidates/:candidateId/douyin-identity-resolution-operations",
    asyncRoute(async (req, res) => {
      emptyBodySchema.parse(req.body ?? {});
      const requestScope = scopeFromRequest(req);
      const candidateId = candidateIdSchema.parse(req.params.candidateId);
      const key = idempotencyKey(req);
      const candidate = await options.candidates.getCandidate(
        requestScope,
        candidateId
      );
      if (!candidate) {
        throw new AcquisitionDouyinIdentityResolutionOperationError(
          "RESOURCE_NOT_FOUND"
        );
      }
      if (!unresolvedDouyinCandidate(candidate, candidateIsResolved)) {
        throw new DouyinIdentityResolutionHttpError(
          "identity_resolution_not_allowed",
          "仅允许未解析的抖音个人候选主体核验",
          422
        );
      }
      if (candidate.evidenceIds.length === 0) {
        throw new DouyinIdentityResolutionHttpError(
          "source_evidence_required",
          "候选缺少可用于主体核验的来源证据",
          422
        );
      }
      const replay = await options.operations.findByIdempotency(
        requestScope,
        key
      );
      if (replay) {
        if (replay.candidateId !== candidate.id) {
          throw new AcquisitionDouyinIdentityResolutionOperationError(
            "IDEMPOTENCY_CONFLICT"
          );
        }
        res.setHeader("Idempotency-Replayed", "true");
        res.status(202).json(publicOperation(replay));
        return;
      }
      const latest = await options.operations.findLatestForCandidate(
        requestScope,
        candidateId
      );
      if (latest && !(latest.status === "failed"
        && latest.retryable
        && latest.outcome === "provider_unavailable")) {
        throw new DouyinIdentityResolutionHttpError(
          "retry_not_allowed",
          "当前抖音主体核验状态不允许重试",
          409
        );
      }
      const created = await options.operations.create(requestScope, {
        candidateId: candidate.id,
        expectedCandidateVersion: candidate.version,
        sourceEvidenceIds: [...candidate.evidenceIds],
        searchConnections: await options.searchConnections.list(requestScope),
        planSessionId: null
      }, key);
      if (created.replayed) {
        res.setHeader("Idempotency-Replayed", "true");
      } else {
        await options.dispatchOperation(requestScope, created.operation.id);
      }
      res.status(202).json(publicOperation(created.operation));
    })
  );

  router.use("/api/v1/acquisition", (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => sendError(error, res));
  return router;
}
