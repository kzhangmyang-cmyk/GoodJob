import { Router, type Request, type Response } from "express";
import {
  normalizeBusinessReport,
  type BusinessReportInput
} from "./business-advisor/domain.js";
import {
  createBusinessAdvisorService
} from "./business-advisor/service.js";

function jsonError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({
    code,
    message,
    details: null,
    requestId: "business-advisor",
    retryable: false
  });
}

function route(
  action: (req: Request, res: Response) => void | Promise<void>
) {
  return (req: Request, res: Response, next: (error?: unknown) => void) => {
    Promise.resolve(action(req, res)).catch(next);
  };
}

export function createBusinessAdvisorRouter(): Router {
  const router = Router();
  const service = createBusinessAdvisorService();

  router.get("/agents", route((_req, res) => {
    res.json({
      items: service.agents.map((agent) => Object.freeze({
        id: agent.id,
        name: agent.name,
        title: agent.title,
        focus: Object.freeze([...agent.focus]),
        knowledgeBase: Object.freeze(
          agent.knowledgeBase.entries.map((entry) =>
            Object.freeze({
              category: entry.category,
              title: entry.title
            }))
        )
      }))
    });
  }));

  const parseInput = (req: Request): BusinessReportInput => {
    const input = req.body as BusinessReportInput;
    if (!input || typeof input !== "object") {
      throw Object.assign(new Error("business_input_invalid"), {
        code: "business_input_invalid"
      });
    }
    normalizeBusinessReport(input);
    return input;
  };

  router.post("/analyze", route((req, res) => {
    const input = parseInput(req);
    res.json({ input, result: service.analyze(input) });
  }));

  router.post("/diagnose", route((req, res) => {
    const input = parseInput(req);
    res.json({ input, report: service.diagnose(input) });
  }));

  router.use((
    error: unknown,
    _req: Request,
    res: Response,
    _next: (error?: unknown) => void
  ) => {
    const code = (error as { code?: string }).code
      ?? "business_advisor_error";
    const message = error instanceof Error ? error.message : String(error);
    jsonError(res, 422, code, message);
  });

  return router;
}
