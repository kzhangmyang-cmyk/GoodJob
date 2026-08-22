import type {
  AdvisorMode,
  AdvisorRunVm,
  RunPresentationDto
} from "./types.js";
import { mergePresentation } from "./view-model.js";

export interface RunPresentationPollerOptions {
  getRunPresentation(
    runId: string,
    input: { after?: string; limit: number },
    signal: AbortSignal
  ): Promise<RunPresentationDto>;
  onUpdate(viewModel: AdvisorRunVm, presentation: RunPresentationDto): void;
  onState?(state: RunPresentationPollerState): void;
  intervalMs?: number;
  scheduler?: {
    setTimeout(callback: () => void, delay: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  visibilitySource?: {
    readonly hidden: boolean;
    addEventListener(
      type: "visibilitychange",
      listener: () => void
    ): void;
    removeEventListener(
      type: "visibilitychange",
      listener: () => void
    ): void;
  };
}

export type RunPresentationPollerState =
  | {
      type: "retrying";
      retryable: true;
      delayMs: number;
      error: unknown;
    }
  | {
      type: "error";
      retryable: false;
      error: unknown;
    };

export interface RunPresentationPoller {
  start(runId: string, mode: AdvisorMode): void;
  stop(): void;
  dispose(): void;
  cursor(): string | null;
}

const TERMINAL_RUN_STATUSES = new Set([
  "cancelled",
  "succeeded",
  "succeeded_empty",
  "partial_success",
  "failed",
  "budget_exhausted"
]);

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  for (const status of [
    candidate.status,
    candidate.statusCode,
    candidate.response?.status
  ]) {
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return null;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableError(error: unknown) {
  const status = errorStatus(error);
  if (status !== null) return status === 429 || status >= 500;
  return error instanceof TypeError;
}

export function createRunPresentationPoller(
  options: RunPresentationPollerOptions
): RunPresentationPoller {
  const intervalMs = options.intervalMs ?? 2_500;
  const scheduler = options.scheduler ?? {
    setTimeout: (callback: () => void, delay: number) =>
      globalThis.setTimeout(callback, delay),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  };
  const visibilitySource = options.visibilitySource
    ?? (typeof document === "undefined" ? undefined : document);
  let active = false;
  let disposed = false;
  let generation = 0;
  let runId: string | null = null;
  let after: string | null = null;
  let controller: AbortController | null = null;
  let timer: unknown | null = null;
  let viewModel: AdvisorRunVm | null = null;
  let retryAttempt = 0;

  const clearTimer = () => {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
  };

  const stop = () => {
    active = false;
    generation += 1;
    clearTimer();
    controller?.abort();
    controller = null;
  };

  const schedule = (delay: number, currentGeneration: number) => {
    clearTimer();
    if (visibilitySource?.hidden) return;
    timer = scheduler.setTimeout(() => {
      timer = null;
      void poll(currentGeneration);
    }, delay);
  };

  const poll = async (currentGeneration: number): Promise<void> => {
    if (
      !active
      || currentGeneration !== generation
      || runId === null
      || visibilitySource?.hidden
    ) return;
    const requestController = new AbortController();
    controller = requestController;
    const input = after === null
      ? { limit: 100 }
      : { after, limit: 100 };
    try {
      const presentation = await options.getRunPresentation(
        runId,
        input,
        requestController.signal
      );
      if (!active || currentGeneration !== generation) return;
      retryAttempt = 0;
      after = presentation.nextAfter;
      viewModel = mergePresentation(
        viewModel ?? {
          run: presentation.run,
          providers: [],
          summary: null,
          candidatesById: new Map(),
          nextAfter: "",
          hasMore: false
        },
        presentation
      );
      options.onUpdate(viewModel, presentation);
      if (
        TERMINAL_RUN_STATUSES.has(presentation.run.status)
        && !presentation.hasMore
      ) {
        active = false;
        return;
      }
      schedule(presentation.hasMore ? 0 : intervalMs, currentGeneration);
    } catch (error) {
      if (
        !active
        || currentGeneration !== generation
        || isAbortError(error)
      ) {
        return;
      }
      if (isRetryableError(error)) {
        const delayMs = Math.min(1_000 * (2 ** retryAttempt), 30_000);
        retryAttempt += 1;
        options.onState?.({
          type: "retrying",
          retryable: true,
          delayMs,
          error
        });
        schedule(delayMs, currentGeneration);
        return;
      }
      active = false;
      options.onState?.({
        type: "error",
        retryable: false,
        error
      });
    } finally {
      if (controller === requestController) controller = null;
    }
  };

  const onVisibilityChange = () => {
    if (!active) return;
    if (visibilitySource?.hidden) {
      generation += 1;
      clearTimer();
      controller?.abort();
      controller = null;
      return;
    }
    if (timer === null && controller === null) {
      void poll(generation);
    }
  };
  visibilitySource?.addEventListener("visibilitychange", onVisibilityChange);

  return {
    start(nextRunId, mode) {
      if (disposed) return;
      stop();
      runId = nextRunId;
      after = null;
      viewModel = null;
      retryAttempt = 0;
      if (mode !== "real") return;
      active = true;
      const currentGeneration = generation;
      void poll(currentGeneration);
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      visibilitySource?.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    },
    cursor: () => after
  };
}
