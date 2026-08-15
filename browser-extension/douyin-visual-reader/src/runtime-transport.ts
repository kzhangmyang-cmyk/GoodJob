import type { ExtensionEvent } from "./protocol";

type TerminalEvent = Extract<ExtensionEvent, { type: "terminal" }>;

export interface ReliableEventTransport {
  sendBatch(event: Extract<ExtensionEvent, { type: "observation_batch" }>): Promise<{ accepted: boolean }>;
  queueTerminal(event: TerminalEvent): void;
  whenIdle(): Promise<void>;
  close(): void;
}

export function createReliableEventTransport(dependencies: {
  send(event: ExtensionEvent): Promise<{ accepted: boolean }>;
  scheduleTimeout?: (callback: () => void, delay: number) => unknown;
  cancelTimeout?: (handle: unknown) => void;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
  maxTerminalAttempts?: number;
}): ReliableEventTransport {
  const scheduleTimeout = dependencies.scheduleTimeout
    ?? ((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay));
  const cancelTimeout = dependencies.cancelTimeout
    ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const retryDelayMs = Math.max(1, Math.min(1_000, dependencies.retryDelayMs ?? 100));
  const attemptTimeoutMs = Math.max(1, Math.min(5_000, dependencies.attemptTimeoutMs ?? 1_000));
  const maxAttempts = Math.max(1, Math.min(10, dependencies.maxTerminalAttempts ?? 5));
  let terminal: TerminalEvent | null = null;
  let attempts = 0;
  let timer: unknown = null;
  let attemptTimer: unknown = null;
  let closed = false;
  let idle: Promise<void> = Promise.resolve();
  let resolveIdle: (() => void) | null = null;

  function finish(): void {
    if (timer !== null) cancelTimeout(timer);
    if (attemptTimer !== null) cancelTimeout(attemptTimer);
    timer = null;
    attemptTimer = null;
    terminal = null;
    resolveIdle?.();
    resolveIdle = null;
  }

  function scheduleRetry(): void {
    if (closed || attempts >= maxAttempts) {
      finish();
      return;
    }
    timer = scheduleTimeout(() => {
      timer = null;
      void attempt();
    }, retryDelayMs);
  }

  async function attempt(): Promise<void> {
    const event = terminal;
    if (!event || closed) return finish();
    attempts += 1;
    try {
      const timeout = new Promise<{ accepted: false }>((resolve) => {
        attemptTimer = scheduleTimeout(() => {
          attemptTimer = null;
          resolve({ accepted: false });
        }, attemptTimeoutMs);
      });
      const response = await Promise.race([dependencies.send(event), timeout]);
      if (attemptTimer !== null) cancelTimeout(attemptTimer);
      attemptTimer = null;
      if (response.accepted) return finish();
    } catch {
      if (attemptTimer !== null) cancelTimeout(attemptTimer);
      attemptTimer = null;
      // Retry the exact same closed event; no payload is logged or persisted.
    }
    scheduleRetry();
  }

  return {
    async sendBatch(event) {
      try {
        const response = await dependencies.send(event);
        return { accepted: response.accepted === true };
      } catch {
        return { accepted: false };
      }
    },
    queueTerminal(event) {
      if (closed || terminal) return;
      terminal = structuredClone(event);
      attempts = 0;
      idle = new Promise<void>((resolve) => { resolveIdle = resolve; });
      void attempt();
    },
    whenIdle() { return idle; },
    close() {
      closed = true;
      finish();
    }
  };
}
