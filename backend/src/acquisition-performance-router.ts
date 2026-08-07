import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type {
  AcquisitionPerformanceQueryService
} from "./acquisition-performance-query.js";

const MAX_WINDOW_DAYS = 90;
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === value;
  }, "must be a real calendar date in YYYY-MM-DD form");
const querySchema = z.object({
  platform: z.enum(["douyin", "web"]).optional(),
  from: dateOnlySchema,
  to: dateOnlySchema
}).strict().superRefine((value, context) => {
  const from = Date.parse(`${value.from}T00:00:00.000Z`);
  const to = Date.parse(`${value.to}T00:00:00.000Z`);
  if (from > to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from"],
      message: "from must not be after to"
    });
  }
  if ((to - from) / (24 * 60 * 60 * 1_000) >= MAX_WINDOW_DAYS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "performance window cannot exceed 90 days"
    });
  }
});

function shanghaiWindow(from: string, to: string) {
  const fromInstant = new Date(`${from}T00:00:00.000+08:00`).toISOString();
  const dayAfterTo = new Date(`${to}T00:00:00.000Z`);
  dayAfterTo.setUTCDate(dayAfterTo.getUTCDate() + 1);
  const dayAfterToText = dayAfterTo.toISOString().slice(0, 10);
  const exclusiveTo = new Date(
    `${dayAfterToText}T00:00:00.000+08:00`
  ).getTime();
  return {
    from: fromInstant,
    to: new Date(exclusiveTo - 1).toISOString()
  };
}

function scope(req: Request) {
  const user = (req as Request & {
    user?: { id?: string; teamId?: string };
  }).user;
  return user?.id && user.teamId
    ? { ownerId: user.id, teamId: user.teamId }
    : null;
}

export function createAcquisitionPerformanceRouter(options: {
  query: Pick<AcquisitionPerformanceQueryService, "get">;
  requestIdFactory?: () => string;
}) {
  const router = Router();
  const requestIdFactory = options.requestIdFactory
    ?? (() => `request_${randomUUID()}`);
  router.get("/api/v1/acquisition/performance", async (req, res) => {
    const requestId = requestIdFactory();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    const requestScope = scope(req);
    if (!requestScope) {
      res.status(401).json({
        error: {
          code: "unauthorized",
          message: "需要登录后访问",
          details: null,
          requestId
        }
      });
      return;
    }
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "invalid_request",
          message: "经营查询参数不符合接口契约",
          details: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message
            }))
          },
          requestId
        }
      });
      return;
    }
    try {
      const window = shanghaiWindow(parsed.data.from, parsed.data.to);
      const result = await options.query.get(requestScope, {
        platform: parsed.data.platform,
        ...window
      });
      res.json(result);
    } catch {
      res.status(500).json({
        error: {
          code: "performance_unavailable",
          message: "经营数据暂时不可用",
          details: null,
          requestId
        }
      });
    }
  });
  return router;
}
