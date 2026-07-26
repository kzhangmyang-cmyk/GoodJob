import type {
  AcquisitionPlanCreateDto,
  BattleCardDto,
  CandidateDto,
  FinancialValueDto,
  QualificationDto,
  RunDto,
  RunPresentationDto
} from "./types.js";

export interface AdvisorRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface PageDto<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ProviderConnectionDto {
  id: string;
  ownerId?: string;
  teamId?: string | null;
  providerId: string;
  kind: "search" | "content_fetch" | "import";
  status: "active" | "inactive" | "disabled";
  credentialVersion: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CopilotSessionDto {
  id: string;
  ownerId?: string;
  teamId?: string;
  status?: "active" | "completed" | "failed";
  modelSnapshot?: Record<string, unknown>;
  createdAt?: string;
}

export interface CopilotTaskDto {
  id: string;
  sessionId?: string;
  kind?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  responseMode?: "assistant" | "plan_draft";
  result: {
    planDraft?: AcquisitionPlanCreateDto;
    toolNames?: string[];
    [key: string]: unknown;
  } | null;
  errorCode?: string | null;
  createdAt?: string;
  completedAt?: string | null;
}

export interface PlanDtoWithEtag extends AcquisitionPlanCreateDto {
  id: string;
  etag: string;
  status: "draft" | "approved" | "archived";
  version: number;
}

export type RunDtoWithEtag = RunDto;

export interface EvidenceDto {
  id: string;
  targetType: "organization" | "individual_signal";
  sourcePlatform: string;
  sourceTitle: string;
  sourceSnippet: string;
  publishedAt: string | null;
  fetchedAt: string;
  locale: string;
  rawArtifactHash: string;
  contentHash: string;
  provenance: Record<string, unknown>;
  accessStatus:
    | "indexed_summary"
    | "public_content"
    | "user_supplied"
    | "access_restricted";
}

export interface CandidateReviewDto {
  action:
    | "approved"
    | "rejected"
    | "do_not_contact"
    | "needs_research"
    | "reopen";
  decisionVersion: string;
  reason: string | null;
}

export interface CandidateReviewResultDto {
  candidate: CandidateDto;
  review: Record<string, unknown>;
  research: Record<string, unknown> | null;
}

export interface CandidateConversionDto {
  id: string;
  candidateId: string;
  decisionVersion: string;
  partyRef: Record<string, unknown>;
  leadId: string;
  reviewerId: string;
  evidenceSnapshotHash: string;
  createdAt: string;
}

export interface TodoCreateDto {
  title: string;
  type: "customer" | "knowledge" | "exam" | "ocr" | "other";
  priority: "high" | "medium" | "normal";
  dueAt: string;
  related: string;
}

export interface TodoDto extends TodoCreateDto {
  id: string;
  ownerId: string;
  teamId: string;
  done: boolean;
  status?: "pending" | "in_progress";
}

interface HttpErrorShape {
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
}

function statusFromError(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as HttpErrorShape;
  for (const status of [
    candidate.status,
    candidate.statusCode,
    candidate.response?.status
  ]) {
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return null;
}

export class AdvisorConflictError extends Error {
  readonly code = "advisor_concurrent_update";
  readonly status: 409 | 412;
  readonly cause: unknown;

  constructor(status: 409 | 412, cause: unknown) {
    super("计划已被其他成员更新，请重新读取并确认后再提交。");
    this.name = "AdvisorConflictError";
    this.status = status;
    this.cause = cause;
  }
}

function requireIdempotencyKey(key: string) {
  const normalized = key.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new Error("Idempotency-Key 必须为 8 到 200 个字符");
  }
  return normalized;
}

function newIdempotencyKey() {
  return requireIdempotencyKey(globalThis.crypto.randomUUID());
}

function segment(value: string) {
  return encodeURIComponent(value);
}

function jsonInit(
  method: "POST" | "PATCH",
  body: unknown,
  headers: Record<string, string> = {}
): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

async function mapConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const status = statusFromError(error);
    if (status === 409 || status === 412) {
      throw new AdvisorConflictError(status, error);
    }
    throw error;
  }
}

export async function conversionTodoIdempotencyKey(
  conversionId: string
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(conversionId)
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `ai-growth-todo:${hex.slice(0, 48)}`;
}

export function createAiGrowthApi(request: AdvisorRequest) {
  const post = <T>(
    path: string,
    body: unknown,
    idempotencyKey: string,
    headers: Record<string, string> = {}
  ) => mapConflict(() => request<T>(
    path,
    jsonInit("POST", body, {
      "Idempotency-Key": requireIdempotencyKey(idempotencyKey),
      ...headers
    })
  ));

  const controlRun = (
    action: "pause" | "resume" | "cancel",
    runId: string,
    etag: string,
    reason: string
  ) => post<RunDto>(
    `/api/v1/acquisition/runs/${segment(runId)}/${action}`,
    { reason },
    newIdempotencyKey(),
    { "If-Match": etag }
  );

  const createTodo = async (
    input: TodoCreateDto,
    idempotencyKey: string
  ): Promise<TodoDto> => {
    const result = await post<TodoDto | { todo: TodoDto }>(
      "/api/todos",
      input,
      idempotencyKey
    );
    return "todo" in result ? result.todo : result;
  };

  return {
    createSession(
      input: { connectionId?: string | null },
      idempotencyKey: string
    ): Promise<CopilotSessionDto> {
      return post(
        "/api/v1/acquisition/copilot/sessions",
        input,
        idempotencyKey
      );
    },

    listProviderConnections(): Promise<PageDto<ProviderConnectionDto>> {
      return mapConflict(() =>
        request("/api/v1/acquisition/provider-connections")
      );
    },

    requestPlanDraft(
      sessionId: string,
      message: string,
      idempotencyKey: string
    ): Promise<CopilotTaskDto> {
      return post(
        `/api/v1/acquisition/copilot/sessions/${segment(sessionId)}/messages`,
        { message, responseMode: "plan_draft" },
        idempotencyKey
      );
    },

    requestAssistantAction(
      sessionId: string,
      message: string,
      idempotencyKey: string
    ): Promise<CopilotTaskDto> {
      return post(
        `/api/v1/acquisition/copilot/sessions/${segment(sessionId)}/messages`,
        { message, responseMode: "assistant" },
        idempotencyKey
      );
    },

    getCopilotTask(taskId: string): Promise<CopilotTaskDto> {
      return mapConflict(() =>
        request(`/api/v1/acquisition/copilot/tasks/${segment(taskId)}`)
      );
    },

    createPlan(
      input: AcquisitionPlanCreateDto,
      idempotencyKey: string
    ): Promise<PlanDtoWithEtag> {
      return post("/api/v1/acquisition/plans", input, idempotencyKey);
    },

    getPlan(planId: string): Promise<PlanDtoWithEtag> {
      return mapConflict(() =>
        request(`/api/v1/acquisition/plans/${segment(planId)}`)
      );
    },

    updatePlan(
      planId: string,
      etag: string,
      input: Partial<AcquisitionPlanCreateDto>
    ): Promise<PlanDtoWithEtag> {
      return mapConflict(() => request(
        `/api/v1/acquisition/plans/${segment(planId)}`,
        jsonInit("PATCH", input, { "If-Match": etag })
      ));
    },

    approvePlan(
      planId: string,
      etag: string,
      input: { decision: "approve"; reason: string }
    ): Promise<PlanDtoWithEtag> {
      return post(
        `/api/v1/acquisition/plans/${segment(planId)}/approval`,
        input,
        newIdempotencyKey(),
        { "If-Match": etag }
      );
    },

    createRun(
      planId: string,
      input: { reason: string },
      idempotencyKey: string
    ): Promise<RunDto> {
      return post(
        `/api/v1/acquisition/plans/${segment(planId)}/runs`,
        input,
        idempotencyKey
      );
    },

    getRun(runId: string): Promise<RunDtoWithEtag> {
      return mapConflict(() =>
        request(`/api/v1/acquisition/runs/${segment(runId)}`)
      );
    },

    getRunPresentation(
      runId: string,
      input: { after?: string; limit: number },
      signal: AbortSignal
    ): Promise<RunPresentationDto> {
      const query = new URLSearchParams();
      if (input.after !== undefined) query.set("after", input.after);
      query.set("limit", String(input.limit));
      return mapConflict(() => request(
        `/api/v1/acquisition/runs/${segment(runId)}/presentation?${query}`,
        { signal }
      ));
    },

    pauseRun(runId: string, etag: string, reason: string): Promise<RunDto> {
      return controlRun("pause", runId, etag, reason);
    },

    resumeRun(runId: string, etag: string, reason: string): Promise<RunDto> {
      return controlRun("resume", runId, etag, reason);
    },

    cancelRun(runId: string, etag: string, reason: string): Promise<RunDto> {
      return controlRun("cancel", runId, etag, reason);
    },

    getCandidate(candidateId: string): Promise<CandidateDto> {
      return mapConflict(() =>
        request(`/api/v1/acquisition/candidates/${segment(candidateId)}`)
      );
    },

    async getEvidence(
      candidateId: string,
      cursor?: string
    ): Promise<PageDto<EvidenceDto>> {
      const items: EvidenceDto[] = [];
      const seenCursors = new Set<string>();
      let nextCursor: string | null = cursor ?? null;
      do {
        if (nextCursor !== null) {
          if (seenCursors.has(nextCursor)) {
            throw new Error("证据分页游标重复，无法确认已读取完整证据");
          }
          seenCursors.add(nextCursor);
        }
        const query = new URLSearchParams();
        if (nextCursor !== null) query.set("cursor", nextCursor);
        query.set("limit", "100");
        const page = await mapConflict(() => request<PageDto<EvidenceDto>>(
          `/api/v1/acquisition/candidates/${segment(candidateId)}/evidence?${query}`
        ));
        items.push(...page.items);
        nextCursor = page.nextCursor;
      } while (nextCursor !== null);
      return { items, nextCursor: null };
    },

    getQualification(candidateId: string): Promise<QualificationDto> {
      return mapConflict(() => request(
        `/api/v1/acquisition/candidates/${segment(candidateId)}/qualification`
      ));
    },

    getFinancialValue(candidateId: string): Promise<FinancialValueDto> {
      return mapConflict(() => request(
        `/api/v1/acquisition/candidates/${segment(candidateId)}/financial-value`
      ));
    },

    getBattleCard(candidateId: string): Promise<BattleCardDto> {
      return mapConflict(() => request(
        `/api/v1/acquisition/candidates/${segment(candidateId)}/battle-card`
      ));
    },

    reviewCandidate(
      candidateId: string,
      input: CandidateReviewDto,
      idempotencyKey: string
    ): Promise<CandidateReviewResultDto> {
      return post(
        `/api/v1/acquisition/candidates/${segment(candidateId)}/review`,
        input,
        idempotencyKey
      );
    },

    convertCandidate(
      candidateId: string,
      input: { decisionVersion: string },
      idempotencyKey: string
    ): Promise<CandidateConversionDto> {
      return post(
        `/api/v1/acquisition/candidates/${segment(candidateId)}/convert`,
        input,
        idempotencyKey
      );
    },

    createTodo,

    async createTodoForConversion(
      conversionId: string,
      input: TodoCreateDto
    ): Promise<TodoDto> {
      return createTodo(
        input,
        await conversionTodoIdempotencyKey(conversionId)
      );
    }
  };
}

export type AiGrowthApi = ReturnType<typeof createAiGrowthApi>;
