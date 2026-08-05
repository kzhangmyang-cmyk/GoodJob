import type {
  AcquisitionPlanCreateDto,
  BattleCardDto,
  CandidateDto,
  FinancialValueDto,
  QualificationDto,
  RunDto,
  RunPresentationDto
} from "./types.js";
import type {
  components,
  operations
} from "./generated/ai-acquisition.js";

export interface AdvisorRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface PageDto<T> {
  items: T[];
  nextCursor: string | null;
}

export type ProviderConnectionPageDto = operations[
  "listAcquisitionProviderConnections"
]["responses"][200]["content"]["application/json"];

export type ProviderConnectionDto =
  ProviderConnectionPageDto["items"][number];

export type CopilotSessionCreateOperationDto = operations[
  "createAcquisitionCopilotSession"
]["responses"][202]["content"]["application/json"];

export type CopilotSessionDto = operations[
  "getAcquisitionCopilotSession"
]["responses"][200]["content"]["application/json"];

type QueuedCopilotTaskDto = operations[
  "sendAcquisitionCopilotMessage"
]["responses"][202]["content"]["application/json"];

export type CopilotTaskDto = operations[
  "getAcquisitionCopilotTask"
]["responses"][200]["content"]["application/json"];

export type PlanDtoWithEtag = AcquisitionPlanCreateDto &
  Pick<
    components["schemas"]["AcquisitionPlan"],
    "id" | "status" | "version"
  > & {
    etag: string;
  };

export type RunDtoWithEtag = RunDto;

type GeneratedEvidenceDto = components["schemas"]["DiscoveryEvidence"];

export type EvidenceDto = Omit<GeneratedEvidenceDto, "provenance"> & {
  provenance: Record<string, unknown>;
};

type GeneratedCandidateReviewDto = operations[
  "reviewAcquisitionCandidate"
]["requestBody"]["content"]["application/json"];

export type CandidateReviewDto = {
  action: GeneratedCandidateReviewDto["action"];
  decisionVersion: GeneratedCandidateReviewDto["decisionVersion"];
  reason: string | null;
};

export interface CandidateReviewResultDto {
  candidate: CandidateDto;
  review: Record<string, unknown>;
  research: Record<string, unknown> | null;
}

export type CandidateConversionDto = Omit<
  components["schemas"]["LeadConversion"],
  "partyRef"
> & {
  partyRef: Record<string, unknown>;
};

type PlanApprovalDto = operations[
  "approveAcquisitionPlan"
]["requestBody"]["content"]["application/json"];
type CopilotSessionCreateDto = operations[
  "createAcquisitionCopilotSession"
]["requestBody"]["content"]["application/json"];
type CandidateConversionCreateDto = operations[
  "convertAcquisitionCandidate"
]["requestBody"]["content"]["application/json"];

export function copilotSessionResourceId(
  operation: CopilotSessionCreateOperationDto
): string {
  if (!operation.resourceId) {
    throw new Error("Copilot 会话创建未返回 resourceId");
  }
  return operation.resourceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBudgetUsage(value: unknown): boolean {
  return isRecord(value)
    && isNumber(value.requests)
    && isNumber(value.results)
    && isNumber(value.amountMinor)
    && isNumber(value.durationSeconds);
}

function isPlanDraft(value: unknown): value is AcquisitionPlanCreateDto {
  if (!isRecord(value)) return false;
  const icp = value.icp;
  const channels = value.subjectChannels;
  const budget = value.budgetSnapshot;
  const stop = value.stopConditions;
  return typeof value.name === "string"
    && typeof value.objective === "string"
    && isRecord(icp)
    && isStringArray(icp.industries)
    && isStringArray(icp.regions)
    && isStringArray(icp.organizationCriteria)
    && isStringArray(icp.individualCriteria)
    && isStringArray(icp.exclusionRules)
    && isRecord(channels)
    && typeof channels.organization === "boolean"
    && typeof channels.individual === "boolean"
    && Array.isArray(value.providerConnections)
    && value.providerConnections.every((connection) =>
      isRecord(connection)
      && typeof connection.connectionId === "string"
      && typeof connection.providerId === "string"
      && ["search", "content_fetch", "import"].includes(
        String(connection.kind)
      )
      && ["active", "inactive", "disabled"].includes(
        String(connection.status)
      )
      && isNumber(connection.credentialVersion))
    && Array.isArray(value.operations)
    && value.operations.every((operation) =>
      isRecord(operation)
      && typeof operation.operationId === "string"
      && ["organization", "individual"].includes(
        String(operation.subjectChannel)
      )
      && ["search", "content_fetch", "import_rows"].includes(
        String(operation.kind)
      )
      && typeof operation.connectionId === "string"
      && (operation.query === undefined
        || typeof operation.query === "string")
      && (operation.sourceRef === undefined
        || typeof operation.sourceRef === "string")
      && isBudgetUsage(operation.allocatedBudget))
    && isRecord(budget)
    && typeof budget.billingCurrency === "string"
    && isNumber(budget.maxRequests)
    && isNumber(budget.maxResults)
    && isNumber(budget.maxAmountMinor)
    && isNumber(budget.maxDurationSeconds)
    && (value.modelConnectionId === undefined
      || value.modelConnectionId === null
      || typeof value.modelConnectionId === "string")
    && isRecord(stop)
    && typeof stop.stopWhenBudgetExhausted === "boolean"
    && typeof stop.stopWhenNoMoreResults === "boolean";
}

export function copilotTaskPlanDraft(
  task: CopilotTaskDto
): AcquisitionPlanCreateDto | null {
  const value = task.result?.planDraft;
  return isPlanDraft(value) ? value : null;
}

export function copilotTaskIncludesToolName(
  task: CopilotTaskDto,
  toolName: string
): boolean {
  const toolNames = task.result?.toolNames;
  return isStringArray(toolNames) && toolNames.includes(toolName);
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

export function advisorHttpStatus(error: unknown): number | null {
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
    const status = advisorHttpStatus(error);
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
      input: CopilotSessionCreateDto,
      idempotencyKey: string
    ): Promise<CopilotSessionCreateOperationDto> {
      return post(
        "/api/v1/acquisition/copilot/sessions",
        input,
        idempotencyKey
      );
    },

    listProviderConnections(): Promise<ProviderConnectionPageDto> {
      return mapConflict(() =>
        request("/api/v1/acquisition/provider-connections")
      );
    },

    requestPlanDraft(
      sessionId: string,
      message: string,
      idempotencyKey: string
    ): Promise<QueuedCopilotTaskDto> {
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
    ): Promise<QueuedCopilotTaskDto> {
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
      input: PlanApprovalDto
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
      input: CandidateConversionCreateDto,
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
