import type { StableErrorCode, VisualReaderLimits } from "./protocol";

export interface DomOnlyObservation {
  clientObservationKey: string;
  redactedCrop: null;
}

export interface BoundedReader {
  start(): Promise<void>;
  acknowledge(batchId: string): Promise<void>;
  userTakeover(): void;
  stop(): void;
  usage(): { observationCount: number; scrollCount: number; ocrCallCount: 0 };
}

export class BoundedReaderError extends Error {
  constructor(readonly code: StableErrorCode) {
    super(code);
    this.name = "BoundedReaderError";
  }
}

export function createBoundedReader(dependencies: {
  sessionId: string;
  limits: VisualReaderLimits;
  artifactUploadEnabled: boolean;
  now?: () => number;
  extract(): Promise<DomOnlyObservation[]>;
  programmaticScroll(index: number): Promise<void>;
  sendBatch(batch: { batchId: string; observations: DomOnlyObservation[] }): Promise<void>;
  sendTerminal(terminal: {
    status: "completed" | "partial_success" | "aborted";
    errorCodes: StableErrorCode[];
  }): Promise<void>;
}): BoundedReader {
  const seen = new Set<string>();
  const now = dependencies.now ?? (() => Date.now());
  const startedAt = now();
  let stopped = false;
  let takeover = false;
  let requestedAbort = false;
  let running = false;
  let batchSequence = 0;
  let pendingBatchId: string | null = null;
  let resolveAck: (() => void) | null = null;
  const usage = { observationCount: 0, scrollCount: 0, ocrCallCount: 0 as const };

  async function send(observations: DomOnlyObservation[]): Promise<void> {
    for (let offset = 0; offset < observations.length && !stopped; offset += 20) {
      const batch = observations.slice(offset, offset + 20).map((item) => ({ ...item, redactedCrop: null }));
      batchSequence += 1;
      const batchId = `batch-${batchSequence}`;
      pendingBatchId = batchId;
      const acknowledged = new Promise<void>((resolve) => { resolveAck = resolve; });
      await dependencies.sendBatch({ batchId, observations: batch });
      if (stopped) break;
      await acknowledged;
      pendingBatchId = null;
      resolveAck = null;
    }
  }

  return {
    async start() {
      if (running) return;
      running = true;
      let noProgressCycles = 0;
      try {
        try {
          while (!stopped) {
            if (now() - startedAt > dependencies.limits.maxDurationMs) {
              throw new BoundedReaderError("visual_reader_budget_exhausted");
            }
            const extracted = await dependencies.extract();
            if (now() - startedAt > dependencies.limits.maxDurationMs) {
              throw new BoundedReaderError("visual_reader_budget_exhausted");
            }
          const fresh: DomOnlyObservation[] = [];
          for (const item of extracted) {
            if (fresh.length + usage.observationCount >= dependencies.limits.maxCommentsPerVideo) break;
            if (typeof item.clientObservationKey !== "string" || seen.has(item.clientObservationKey)) continue;
            seen.add(item.clientObservationKey);
            fresh.push({ ...item, redactedCrop: null });
          }
          if (fresh.length > 0) {
            noProgressCycles = 0;
            usage.observationCount += fresh.length;
            await send(fresh);
          } else {
            noProgressCycles += 1;
          }
            if (stopped || usage.observationCount >= dependencies.limits.maxCommentsPerVideo
              || noProgressCycles >= 2 || usage.scrollCount >= dependencies.limits.maxScrolls) break;
            usage.scrollCount += 1;
            await dependencies.programmaticScroll(usage.scrollCount);
          }
        } catch (error) {
          if (!(error instanceof BoundedReaderError)) throw error;
          await dependencies.sendTerminal({ status: "partial_success", errorCodes: [error.code] });
          return;
        }
        await dependencies.sendTerminal(takeover
          ? { status: "aborted", errorCodes: ["visual_reader_user_takeover"] }
          : requestedAbort
            ? { status: "aborted", errorCodes: [] }
            : { status: "completed", errorCodes: [] });
      } finally {
        running = false;
        pendingBatchId = null;
        resolveAck = null;
      }
    },
    async acknowledge(batchId) {
      if (batchId === pendingBatchId) resolveAck?.();
    },
    userTakeover() {
      takeover = true;
      stopped = true;
      resolveAck?.();
    },
    stop() {
      requestedAbort = true;
      stopped = true;
      resolveAck?.();
    },
    usage() {
      return { ...usage };
    }
  };
}
