import { Router, type Request, type Response } from "express";
import {
  normalizeBusinessReport,
  type BusinessReportInput
} from "./business-advisor/domain.js";
import {
  createBusinessAdvisorService
} from "./business-advisor/service.js";
import {
  parseStatements,
  type StatementRow,
  type StatementTable
} from "./business-advisor/statement-import.js";

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

function coerceTable(raw: unknown): StatementTable {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { rows?: unknown }).rows)) {
    throw Object.assign(new Error("statement_table_invalid"), {
      code: "statement_table_invalid"
    });
  }
  const rows: StatementRow[] = (raw as { rows: unknown[] }).rows.map((row) => {
    if (!Array.isArray(row)) {
      throw Object.assign(new Error("statement_table_invalid"), {
        code: "statement_table_invalid"
      });
    }
    return Object.freeze(row.map((cell) => {
      if (
        typeof cell === "string"
        || typeof cell === "number"
        || cell === null
      ) {
        return cell;
      }
      throw Object.assign(new Error("statement_table_invalid"), {
        code: "statement_table_invalid"
      });
    }));
  });
  return Object.freeze({ rows: Object.freeze(rows) });
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

  router.post("/statements/parse", route((req, res) => {
    const body = req.body as {
      balanceSheet?: unknown;
      incomeStatement?: unknown;
    };
    const parsed = parseStatements(
      coerceTable(body.balanceSheet),
      coerceTable(body.incomeStatement)
    );
    normalizeBusinessReport(parsed.input);
    res.json({
      companyName: parsed.companyName,
      period: parsed.period,
      warnings: parsed.warnings,
      input: parsed.input
    });
  }));

  router.post("/statements/diagnose", route((req, res) => {
    const body = req.body as {
      balanceSheet?: unknown;
      incomeStatement?: unknown;
    };
    const parsed = parseStatements(
      coerceTable(body.balanceSheet),
      coerceTable(body.incomeStatement)
    );
    normalizeBusinessReport(parsed.input);
    res.json({
      companyName: parsed.companyName,
      period: parsed.period,
      warnings: parsed.warnings,
      input: parsed.input,
      report: service.diagnose(parsed.input)
    });
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
