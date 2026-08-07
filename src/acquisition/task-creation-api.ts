export interface AcquisitionSearchConnection {
  id: string;
  providerId: string;
  kind: "search" | "content_fetch" | "import";
  status: "active" | "inactive" | "disabled" | "error";
  lastHealthStatus: "passed" | "failed" | "untested";
  credentialVersion: number;
  [key: string]: unknown;
}

export interface ToolCallingModelConnection {
  id: string;
  provider: string;
  model: string;
  status: "active" | "inactive" | "disabled";
  credentialVersion: number;
  capabilitySnapshot: {
    toolCalling: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AcquisitionBudgetInput {
  billingCurrency: string;
  maxRequests: number;
  maxResults: number;
  maxAmountMinor: number;
  maxDurationSeconds: number;
}

type TagInput = string | readonly string[];

export interface DouyinPlanForm {
  name: string;
  objective: string;
  industries: TagInput;
  regions: TagInput;
  organizationCriteria: TagInput;
  individualCriteria: TagInput;
  exclusionRules?: TagInput;
  /** Optional view-only labels. They are deliberately not sent to the API. */
  tags?: TagInput;
  organizationQuery: string;
  individualQuery: string;
  providerConnection: AcquisitionSearchConnection;
  modelConnectionId: string;
  budget: AcquisitionBudgetInput;
}

export interface AcquisitionUsageInput {
  requests: number;
  results: number;
  amountMinor: number;
  durationSeconds: number;
}

export interface DouyinPlanInput {
  targetPlatform: "douyin";
  name: string;
  objective: string;
  icp: {
    industries: string[];
    regions: string[];
    organizationCriteria: string[];
    individualCriteria: string[];
    exclusionRules: string[];
  };
  subjectChannels: {
    organization: true;
    individual: true;
  };
  providerConnections: Array<{
    connectionId: string;
    providerId: string;
    kind: "search";
    status: "active";
    credentialVersion: number;
  }>;
  operations: Array<{
    operationId: string;
    subjectChannel: "organization" | "individual";
    kind: "search";
    connectionId: string;
    query: string;
    allocatedBudget: AcquisitionUsageInput;
  }>;
  budgetSnapshot: AcquisitionBudgetInput;
  modelConnectionId: string;
  stopConditions: {
    stopWhenBudgetExhausted: true;
    stopWhenNoMoreResults: true;
  };
}

export interface PlanApprovalInput {
  decision: "approve";
  reason: string;
}

export interface RunCreateInput {
  reason?: string;
  parentRunId?: string;
}

export interface ApiResource<T> {
  data: T;
  etag: string | null;
}

export interface AcquisitionTaskCreationApiOptions {
  cookieSource?: () => string;
  idempotencyKeyFactory?: () => string;
}

interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

interface ErrorEnvelope {
  message?: unknown;
  error?: { message?: unknown };
}

const DEFAULT_IGNORABLE_CODE_POINTS = /\p{Default_Ignorable_Code_Point}/gu;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const SITE_CLAUSES =
  /(?<![\p{L}\p{N}_])[-+]?\s*site\s*:\s*(?:"[^"]*"|'[^']*'|[^\s)\]}>'",;，。!?！？]+)/giu;
const SEMANTIC_CONTENT = /[\p{L}\p{N}]/u;

function trimText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}不能为空`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  }
  return normalized;
}

function normalizedTags(
  value: TagInput | undefined,
  label: string,
  required: boolean,
  maxLength: number
): string[] {
  const candidates = typeof value === "string"
    ? value.split(/[,，;；\n]+/u)
    : [...(value ?? [])];
  const result = [...new Set(candidates
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean))];
  if (required && result.length === 0) throw new Error(`${label}不能为空`);
  if (result.some((item) => item.length > maxLength)) {
    throw new Error(`${label}中的单项不能超过 ${maxLength} 个字符`);
  }
  return result;
}

function positiveBudget(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 2) {
    throw new Error(`${label}必须是至少为 2 的整数`);
  }
  return value;
}

function nonNegativeBudget(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}必须是非负整数`);
  }
  return value;
}

function splitBudget(total: number): [number, number] {
  return [Math.ceil(total / 2), Math.floor(total / 2)];
}

function safeQuery(prefix: "site:douyin.com " | "site:iesdouyin.com ", value: string) {
  const semantic = trimText(value, "搜索关键词", 4_000)
    .normalize("NFKC")
    .replace(DEFAULT_IGNORABLE_CODE_POINTS, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(SITE_CLAUSES, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!semantic || !SEMANTIC_CONTENT.test(semantic)) {
    throw new Error("搜索关键词不能为空");
  }
  const maxSemanticLength = 1_000 - prefix.length;
  let bounded = semantic.slice(0, maxSemanticLength);
  const finalCodeUnit = bounded.charCodeAt(bounded.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    bounded = bounded.slice(0, -1);
  }
  return `${prefix}${bounded.trimEnd()}`;
}

/**
 * Compiles the real-task dialog into the public plan-create contract.
 * Immutable model snapshots are intentionally impossible to supply here.
 */
export function buildDouyinPlanInput(form: DouyinPlanForm): DouyinPlanInput {
  const connection = form.providerConnection;
  if (!connection?.id?.trim() || !connection.providerId?.trim()) {
    throw new Error("请选择有效的搜索连接");
  }
  if (connection.kind !== "search") throw new Error("所选连接不是搜索连接");
  if (connection.status !== "active") {
    throw new Error("搜索连接必须处于启用状态");
  }
  if (connection.lastHealthStatus !== "passed") {
    throw new Error("搜索连接必须通过健康检查");
  }
  if (!Number.isSafeInteger(connection.credentialVersion)
    || connection.credentialVersion < 1) {
    throw new Error("搜索连接凭证版本无效");
  }

  const modelConnectionId = trimText(
    form.modelConnectionId,
    "AI 模型连接",
    255
  );
  const maxRequests = positiveBudget(form.budget.maxRequests, "最大请求");
  const maxResults = positiveBudget(form.budget.maxResults, "最大结果");
  const maxDurationSeconds = positiveBudget(
    form.budget.maxDurationSeconds,
    "最长运行"
  );
  const maxAmountMinor = nonNegativeBudget(
    form.budget.maxAmountMinor,
    "费用上限"
  );
  const billingCurrency = form.budget.billingCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(billingCurrency)) {
    throw new Error("计费币种必须是 3 位字母代码");
  }

  const [organizationRequests, individualRequests] = splitBudget(maxRequests);
  const [organizationResults, individualResults] = splitBudget(maxResults);
  const [organizationAmount, individualAmount] = splitBudget(maxAmountMinor);
  const [organizationDuration, individualDuration] =
    splitBudget(maxDurationSeconds);

  return {
    targetPlatform: "douyin",
    name: trimText(form.name, "任务名称", 200),
    objective: trimText(form.objective, "获客目标", 2_000),
    icp: {
      industries: normalizedTags(form.industries, "目标行业", true, 120),
      regions: normalizedTags(form.regions, "目标地区", true, 120),
      organizationCriteria: normalizedTags(
        form.organizationCriteria,
        "企业判断条件",
        true,
        500
      ),
      individualCriteria: normalizedTags(
        form.individualCriteria,
        "个人判断条件",
        true,
        500
      ),
      exclusionRules: normalizedTags(
        form.exclusionRules,
        "排除规则",
        false,
        500
      )
    },
    subjectChannels: { organization: true, individual: true },
    providerConnections: [{
      connectionId: connection.id.trim(),
      providerId: connection.providerId.trim(),
      kind: "search",
      status: "active",
      credentialVersion: connection.credentialVersion
    }],
    operations: [{
      operationId: "douyin-organization-search",
      subjectChannel: "organization",
      kind: "search",
      connectionId: connection.id.trim(),
      query: safeQuery("site:douyin.com ", form.organizationQuery),
      allocatedBudget: {
        requests: organizationRequests,
        results: organizationResults,
        amountMinor: organizationAmount,
        durationSeconds: organizationDuration
      }
    }, {
      operationId: "douyin-individual-search",
      subjectChannel: "individual",
      kind: "search",
      connectionId: connection.id.trim(),
      query: safeQuery("site:iesdouyin.com ", form.individualQuery),
      allocatedBudget: {
        requests: individualRequests,
        results: individualResults,
        amountMinor: individualAmount,
        durationSeconds: individualDuration
      }
    }],
    budgetSnapshot: {
      billingCurrency,
      maxRequests,
      maxResults,
      maxAmountMinor,
      maxDurationSeconds
    },
    modelConnectionId,
    stopConditions: {
      stopWhenBudgetExhausted: true,
      stopWhenNoMoreResults: true
    }
  };
}

function defaultCookieSource(): string {
  return typeof document === "undefined" ? "" : document.cookie;
}

function csrfFromCookie(cookie: string): string {
  const encoded = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("gj_csrf="))
    ?.slice("gj_csrf=".length);
  if (!encoded) throw new Error("登录会话缺少 CSRF 令牌，请重新登录");
  try {
    const decoded = decodeURIComponent(encoded);
    if (!decoded) throw new Error("empty");
    return decoded;
  } catch {
    throw new Error("CSRF 令牌格式无效，请重新登录");
  }
}

function errorMessage(body: ErrorEnvelope, status: number): string {
  const nested = body.error?.message;
  if (typeof nested === "string" && nested.trim()) return nested;
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  return `请求失败（HTTP ${status}）`;
}

function validIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200) {
    throw new Error("Idempotency-Key 必须为 8 到 200 个字符");
  }
  return key;
}

function pathSegment(value: string, label: string): string {
  return encodeURIComponent(trimText(value, label, 255));
}

function withoutModelSnapshot(input: DouyinPlanInput): DouyinPlanInput {
  const { modelSnapshotRef: _ignored, ...publicInput } = input as DouyinPlanInput & {
    modelSnapshotRef?: unknown;
  };
  return publicInput;
}

export function createAcquisitionTaskCreationApi(
  fetchImpl: typeof fetch = fetch,
  options: AcquisitionTaskCreationApiOptions = {}
) {
  const cookieSource = options.cookieSource ?? defaultCookieSource;
  const idempotencyKeyFactory = options.idempotencyKeyFactory
    ?? (() => globalThis.crypto.randomUUID());

  async function request<T>(path: string, init: RequestInit): Promise<{
    data: T;
    response: Response;
  }> {
    const response = await fetchImpl(path, {
      credentials: "same-origin",
      ...init
    });
    const body = await response.json().catch(() => ({})) as T & ErrorEnvelope;
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return { data: body, response };
  }

  async function get<T>(path: string): Promise<T> {
    const result = await request<T>(path, {
      method: "GET",
      headers: { accept: "application/json" }
    });
    return result.data;
  }

  async function post<T>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ) {
    return request<T>(path, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfFromCookie(cookieSource()),
        ...headers
      },
      body: JSON.stringify(body)
    });
  }

  return {
    async listActiveSearchConnections(): Promise<AcquisitionSearchConnection[]> {
      const page = await get<Page<AcquisitionSearchConnection>>(
        "/api/v1/acquisition/provider-connections"
      );
      return (Array.isArray(page.items) ? page.items : []).filter((connection) =>
        connection.kind === "search"
        && connection.status === "active"
        && connection.lastHealthStatus === "passed"
      );
    },

    async listToolCallingModelConnections(): Promise<ToolCallingModelConnection[]> {
      const page = await get<Page<ToolCallingModelConnection>>(
        "/api/v1/ai/connections"
      );
      return (Array.isArray(page.items) ? page.items : []).filter((connection) =>
        connection.status === "active"
        && connection.capabilitySnapshot?.toolCalling === true
      );
    },

    async createPlan(
      input: DouyinPlanInput,
      idempotencyKey?: string
    ): Promise<ApiResource<Record<string, unknown>>> {
      const result = await post<Record<string, unknown>>(
        "/api/v1/acquisition/plans",
        withoutModelSnapshot(input),
        {
          "Idempotency-Key": validIdempotencyKey(
            idempotencyKey ?? idempotencyKeyFactory()
          )
        }
      );
      return { data: result.data, etag: result.response.headers.get("etag") };
    },

    async approvePlan(
      planId: string,
      etag: string,
      input: PlanApprovalInput
    ): Promise<ApiResource<Record<string, unknown>>> {
      const ifMatch = trimText(etag, "计划 ETag", 255);
      const approval: PlanApprovalInput = {
        decision: "approve",
        reason: trimText(input.reason, "批准理由", 2_000)
      };
      const result = await post<Record<string, unknown>>(
        `/api/v1/acquisition/plans/${pathSegment(planId, "计划 ID")}/approval`,
        approval,
        { "If-Match": ifMatch }
      );
      return { data: result.data, etag: result.response.headers.get("etag") };
    },

    async createRun(
      planId: string,
      input: RunCreateInput = {},
      idempotencyKey?: string
    ): Promise<Record<string, unknown>> {
      const result = await post<Record<string, unknown>>(
        `/api/v1/acquisition/plans/${pathSegment(planId, "计划 ID")}/runs`,
        input,
        {
          "Idempotency-Key": validIdempotencyKey(
            idempotencyKey ?? idempotencyKeyFactory()
          )
        }
      );
      return result.data;
    }
  };
}
