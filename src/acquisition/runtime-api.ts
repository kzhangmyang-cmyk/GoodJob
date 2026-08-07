import type {
  AcquisitionTaskOverview,
  AcquisitionTaskSummary
} from "./runtime-model";

export interface AcquisitionTaskDetail {
  task: AcquisitionTaskSummary;
  plan: Record<string, unknown>;
  latestRun: (AcquisitionTaskSummary["latestRun"] & {
    etag?: string;
  }) | null;
  shards: Array<Record<string, unknown>>;
  presentation: {
    candidateEvents: Array<Record<string, unknown>>;
    providers: Array<Record<string, unknown>>;
    hasMore?: boolean;
    nextAfter?: string | null;
    summary?: Record<string, unknown> | null;
  } | null;
}

export interface AcquisitionRuntimeApi {
  getOverview(): Promise<AcquisitionTaskOverview>;
  getTask(planId: string): Promise<AcquisitionTaskDetail>;
}

interface ErrorBody {
  message?: unknown;
  error?: {
    message?: unknown;
  };
}

function errorMessage(body: ErrorBody, status: number): string {
  const nested = body.error?.message;
  if (typeof nested === "string" && nested.trim()) return nested;
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  return `请求失败（HTTP ${status}）`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createAcquisitionApi(
  fetchImpl: typeof fetch = fetch
): AcquisitionRuntimeApi {
  async function request<T>(path: string): Promise<T> {
    const response = await fetchImpl(path, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        accept: "application/json"
      }
    });
    const body = await response.json().catch(() => ({})) as T & ErrorBody;
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return body;
  }

  return {
    getOverview() {
      return request<AcquisitionTaskOverview>(
        "/api/v1/acquisition/overview?platform=douyin"
      );
    },
    getTask(planId: string) {
      return request<AcquisitionTaskDetail>(
        `/api/v1/acquisition/tasks/${segment(planId)}`
      );
    }
  };
}
