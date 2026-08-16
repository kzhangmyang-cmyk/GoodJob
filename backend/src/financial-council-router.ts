import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router
} from "express";
import { canonicalBusinessReportInput } from "./business-advisor/domain.js";
import type { FinancialCouncilService } from "./financial-council-service.js";
import type { FinancialCouncilCreateInput } from "./growth-contract-types.js";
import { GrowthHttpError } from "./growth-command-context.js";
import { GrowthAuthorizationError } from "./growth-capabilities.js";
import { isFinancialCouncilError } from "./financial-council-domain.js";
import type {
  GrowthCommandContextFactory,
  GrowthWorkspaceContextResolver
} from "./growth-http-preconditions.js";
import { setRevisionEtag } from "./growth-http-preconditions.js";
import {
  executeGrowthIdempotentCommand,
  growthHttpIdempotencyKeyHash,
  type GrowthHttpIdempotencyRepository
} from "./growth-http-idempotency-repository.js";

const CREATE_PATH = "/api/v1/finance/council-runs";

export interface FinancialCouncilRouterDependencies {
  readonly service: Pick<FinancialCouncilService,
    "createRun" | "getRun" | "listEvents">;
  readonly workspaceContext: GrowthWorkspaceContextResolver;
  readonly commandContextFactory: GrowthCommandContextFactory;
  readonly httpIdempotency: GrowthHttpIdempotencyRepository;
  readonly now?: () => string;
}

function route(action: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(action(req, res)).catch(next);
  };
}

function exactCreateInput(raw: unknown): FinancialCouncilCreateInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype) {
    throw new GrowthHttpError(422, "financial_council_input_invalid");
  }
  const record = raw as Record<string, unknown>;
  const expected = ["businessReport", "currency", "dataAsOf", "policyVersionId"];
  if (Object.keys(record).sort().join("\u0000")
    !== expected.sort().join("\u0000")) {
    throw new GrowthHttpError(422, "financial_council_input_invalid");
  }
  try {
    const businessReport = canonicalBusinessReportInput(
      record.businessReport as FinancialCouncilCreateInput["businessReport"]
    );
    if (typeof record.currency !== "string"
      || record.currency !== businessReport.currency
      || typeof record.dataAsOf !== "string"
      || new Date(record.dataAsOf).toISOString() !== record.dataAsOf
      || typeof record.policyVersionId !== "string"
      || !record.policyVersionId.trim()
      || [...record.policyVersionId].length > 255) throw new Error();
    return Object.freeze({
      currency: record.currency,
      dataAsOf: record.dataAsOf,
      businessReport,
      policyVersionId: record.policyVersionId
    });
  } catch {
    throw new GrowthHttpError(422, "financial_council_input_invalid");
  }
}

function runId(req: Request): string {
  const value = req.params.runId;
  if (typeof value !== "string" || !value.trim()
    || value.trim() !== value || value.length > 255) {
    throw new GrowthHttpError(422, "financial_council_input_invalid");
  }
  return value;
}

function projectRun(run: Awaited<ReturnType<FinancialCouncilService["getRun"]>>) {
  return Object.freeze({
    runId: run.runId,
    workspaceId: run.workspaceId,
    currency: run.currency,
    status: run.status,
    revision: run.revision,
    dataAsOf: run.dataAsOf,
    businessReport: run.businessReport,
    policyVersionId: run.policyVersionId,
    snapshotId: run.snapshotId,
    snapshotHash: run.snapshotHash,
    consensusReport: run.consensusReport,
    portfolios: run.portfolios,
    latestPortfolioRevision: run.latestPortfolioRevision,
    approval: run.approval,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    expiresAt: run.expiresAt
  });
}

function projectEvent(event: Awaited<ReturnType<
  FinancialCouncilService["listEvents"]
>>[number]) {
  return Object.freeze({
    eventId: event.eventId,
    runId: event.runId,
    revision: event.revision,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    reasonCode: event.reasonCode,
    occurredAt: event.occurredAt
  });
}

function trustedError(error: unknown): {
  readonly status: number;
  readonly code: string;
} {
  try {
    if (error instanceof GrowthHttpError) {
      return { status: error.status, code: error.code };
    }
    if (error instanceof GrowthAuthorizationError) {
      return { status: 403, code: error.code };
    }
    if (isFinancialCouncilError(error)) {
      const status = error.code === "financial_council_run_not_found" ? 404
        : error.code === "financial_council_idempotency_conflict"
          || error.code === "financial_council_run_conflict"
          || error.code === "financial_council_snapshot_conflict"
          || error.code === "financial_council_revision_conflict" ? 409
          : error.code === "financial_council_input_invalid"
            || error.code === "financial_council_transition_invalid"
            || error.code === "financial_council_timestamp_invalid"
            || error.code === "financial_council_context_invalid"
            || error.code === "financial_council_authority_workspace_mismatch"
            || error.code === "financial_council_authority_invalid"
            || error.code === "financial_council_authority_duplicate"
            || error.code === "financial_council_authority_query_truncated"
            || error.code === "invalid_as_of" ? 422 : 500;
      return { status, code: error.code };
    }
  } catch {
    // Unknown objects, including hostile proxies, are opaque internal errors.
  }
  return { status: 500, code: "financial_council_internal_error" };
}

function sendError(req: Request, res: Response, error: unknown): void {
  const { code, status } = trustedError(error);
  const requestId = res.getHeader("X-Request-Id") as string;
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.removeHeader("ETag");
  res.end(JSON.stringify({
    code,
    message: code,
    details: null,
    requestId,
    retryable: code === "idempotency_in_progress"
  }));
}

export function createFinancialCouncilRouter(
  dependencies: FinancialCouncilRouterDependencies
): Router {
  const router = express.Router();
  const now = dependencies.now ?? (() => new Date().toISOString());
  router.use((req, res, next) => {
    const requestId = req.header("X-Request-Id")?.trim() || randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/", route(async (req, res) => {
    const body = exactCreateInput(req.body);
    const command = dependencies.commandContextFactory(req, {
      canonicalPath: CREATE_PATH,
      pathParams: Object.freeze({}),
      payload: body,
      expectedRevision: null
    });
    let repositoryReplayed = false;
    const result = await executeGrowthIdempotentCommand({
      repository: dependencies.httpIdempotency,
      reservation: {
        workspaceId: command.workspace.workspaceId,
        actorId: command.actorId,
        method: "POST",
        canonicalPath: CREATE_PATH,
        key: `financial-council:http:${growthHttpIdempotencyKeyHash(
          command.idempotencyKey
        )}`,
        requestHash: command.requestHash,
        attemptedAt: now(),
        leaseOwner: `financial-council-http-${randomUUID()}`,
        leaseDurationMs: 30_000
      }
    }, async (resourceId) => {
      if (!resourceId) throw new GrowthHttpError(409, "idempotency_conflict");
      return projectRun(await dependencies.service.getRun(
        command.workspace, resourceId
      ));
    }, async () => {
      const created = await dependencies.service.createRun(command, body);
      repositoryReplayed = created.replayed;
      return { resourceId: created.value.runId, operationId: null };
    });
    if (result.replayed || repositoryReplayed) {
      res.setHeader("Idempotency-Replayed", "true");
    }
    setRevisionEtag(
      res, "financial-council-run", result.value.runId, result.value.revision
    );
    res.status(202).json(result.value);
  }));

  router.get("/:runId", route(async (req, res) => {
    const id = runId(req);
    const run = await dependencies.service.getRun(
      dependencies.workspaceContext(req), id
    );
    setRevisionEtag(res, "financial-council-run", run.runId, run.revision);
    res.status(200).json(projectRun(run));
  }));

  router.get("/:runId/events", route(async (req, res) => {
    if (Object.keys(req.query).length !== 0) {
      throw new GrowthHttpError(422, "financial_council_input_invalid");
    }
    const id = runId(req);
    const events = await dependencies.service.listEvents(
      dependencies.workspaceContext(req), id
    );
    res.status(200).json(Object.freeze({
      items: Object.freeze(events.map(projectEvent)),
      nextAfter: null,
      hasMore: false
    }));
  }));

  router.use((error: unknown, req: Request, res: Response,
    _next: NextFunction) => sendError(req, res, error));
  return router;
}
