import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type {
  AcquisitionPerformanceQueryService
} from "./acquisition-performance-query.js";

const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
const querySchema = z.object({
  platform: z.enum(["douyin", "web"]).optional(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true })
}).strict().superRefine((value, context) => {
  const from = new Date(value.from).getTime();
  const to = new Date(value.to).getTime();
  if (from > to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from"],
      message: "from must not be after to"
    });
  }
  if (to - from > MAX_WINDOW_MS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "performance window cannot exceed 90 days"
    });
  }
});

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
      const result = await options.query.get(requestScope, {
        platform: parsed.data.platform,
        from: new Date(parsed.data.from).toISOString(),
        to: new Date(parsed.data.to).toISOString()
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

