import type {
  AdvisorState,
  AdvisorStatus,
  BattleCardDto,
  ExecutiveSummaryDto,
  RunPresentationDto
} from "../types.js";
import {
  demoFixture,
  type DemoDuplicateMerge,
  type DemoOwnerSummary
} from "./fixture.js";

export interface DemoRunner {
  start(): void;
  approve(): void;
  pause(): void;
  resume(): void;
  jumpToResult(): void;
  dispose(): void;
}

interface DemoEventBase {
  sequence: number;
  demo: true;
  demoLabel: "演示数据";
  status: AdvisorStatus;
  progress: number;
}

export type AdvisorDemoEvent =
  | (DemoEventBase & { type: "state"; state: AdvisorState })
  | (DemoEventBase & { type: "presentation"; presentation: RunPresentationDto })
  | (DemoEventBase & { type: "duplicate_merged"; duplicateMerge: DemoDuplicateMerge })
  | (DemoEventBase & { type: "battle_card"; battleCard: BattleCardDto })
  | (DemoEventBase & {
    type: "summary";
    summary: ExecutiveSummaryDto;
    ownerSummary: DemoOwnerSummary;
  });

type DemoEventPayload =
  | { type: "state"; state: AdvisorState }
  | { type: "presentation"; presentation: RunPresentationDto }
  | { type: "duplicate_merged"; duplicateMerge: DemoDuplicateMerge }
  | { type: "battle_card"; battleCard: BattleCardDto }
  | {
    type: "summary";
    summary: ExecutiveSummaryDto;
    ownerSummary: DemoOwnerSummary;
  };

export interface CreateDemoRunnerOptions {
  durationMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => number;
  cancel?: (id: number) => void;
  onEvent(event: AdvisorDemoEvent): void;
}

type Phase = "idle" | "planning" | "awaiting_approval" | "running" | "paused" | "completed";
type Milestone = "awaiting_approval" | "presentation" | "duplicate_merged" | "battle_card" | "summary" | "completed";

const DEFAULT_DURATION_MS = 72_000;
const MIN_DURATION_MS = 45_000;
const MAX_DURATION_MS = 90_000;
const WATERMARKS: Readonly<Record<Milestone, number>> = {
  awaiting_approval: 0.15,
  presentation: 0.35,
  duplicate_merged: 0.5,
  battle_card: 0.65,
  summary: 0.85,
  completed: 1
};
const RUNNING_MILESTONES: readonly Milestone[] = [
  "presentation",
  "duplicate_merged",
  "battle_card",
  "summary",
  "completed"
];

function demoState(status: AdvisorStatus): AdvisorState {
  return {
    mode: "demo",
    status,
    taskText: demoFixture.plan.objective,
    templateId: "export-manufacturing",
    targetPlatform: demoFixture.plan.targetPlatform ?? "web",
    planDraft: demoFixture.plan,
    runId: status === "running" || status === "paused" || status === "completed"
      ? demoFixture.runPresentation.run.id
      : null,
    cursor: status === "completed" ? demoFixture.runPresentation.nextAfter : null,
    candidatesById: new Map(),
    summary: null,
    error: null
  };
}

export function createDemoRunner(options: CreateDemoRunnerOptions): DemoRunner {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new RangeError("durationMs must be between 45000 and 90000 milliseconds");
  }

  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((callback: () => void, delayMs: number) =>
    globalThis.setTimeout(callback, delayMs) as unknown as number);
  const cancel = options.cancel ?? ((id: number) => globalThis.clearTimeout(id));
  let disposed = false;
  let phase: Phase = "idle";
  let resumePhase: "planning" | "running" | null = null;
  let elapsedMs = 0;
  let activeSince = 0;
  let scheduledId: number | null = null;
  let sequence = 0;
  const emitted = new Set<Milestone>();

  const progress = () => Math.round((elapsedMs / durationMs) * 100);
  const emit = (event: DemoEventPayload) => {
    if (disposed) return;
    options.onEvent({
      ...event,
      sequence: ++sequence,
      demo: true,
      demoLabel: "演示数据",
      status: event.type === "state" ? event.state.status : phase === "completed" ? "completed" : "running",
      progress: progress()
    } as AdvisorDemoEvent);
  };
  const emitState = (status: AdvisorStatus) => emit({
    type: "state",
    state: demoState(status)
  });
  const clearScheduled = () => {
    if (scheduledId !== null) {
      cancel(scheduledId);
      scheduledId = null;
    }
  };
  const syncElapsed = () => {
    if (phase === "planning" || phase === "running") {
      elapsedMs += now() - activeSince;
      activeSince = now();
    }
  };
  const mark = (milestone: Milestone) => {
    if (emitted.has(milestone) || disposed) return;
    emitted.add(milestone);
    elapsedMs = WATERMARKS[milestone] * durationMs;
    activeSince = now();
    if (milestone === "awaiting_approval") {
      phase = "awaiting_approval";
      emitState("awaiting_approval");
    } else if (milestone === "presentation") {
      emit({ type: "presentation", presentation: demoFixture.runPresentation });
    } else if (milestone === "duplicate_merged") {
      emit({ type: "duplicate_merged", duplicateMerge: demoFixture.duplicateMerge });
    } else if (milestone === "battle_card") {
      emit({ type: "battle_card", battleCard: demoFixture.battleCard });
    } else if (milestone === "summary") {
      emit({
        type: "summary",
        summary: demoFixture.runPresentation.summary,
        ownerSummary: demoFixture.ownerSummary
      });
    } else {
      phase = "completed";
      emitState("completed");
    }
  };
  const scheduleNext = () => {
    if (disposed || phase === "awaiting_approval" || phase === "paused" || phase === "completed") return;
    const next = phase === "planning"
      ? "awaiting_approval"
      : RUNNING_MILESTONES.find((milestone) => !emitted.has(milestone));
    if (!next) return;
    syncElapsed();
    const delayMs = Math.max(0, WATERMARKS[next] * durationMs - elapsedMs);
    scheduledId = schedule(() => {
      scheduledId = null;
      mark(next);
      scheduleNext();
    }, delayMs);
  };
  const emitCompleteSequence = () => {
    if (phase === "idle") {
      phase = "planning";
      activeSince = now();
      emitState("planning");
    }
    clearScheduled();
    mark("awaiting_approval");
    if (phase !== "running") {
      phase = "running";
      emitState("running");
    }
    for (const milestone of RUNNING_MILESTONES) mark(milestone);
  };

  return {
    start() {
      if (disposed || phase !== "idle") return;
      phase = "planning";
      activeSince = now();
      emitState("planning");
      scheduleNext();
    },
    approve() {
      if (disposed || phase !== "awaiting_approval") return;
      phase = "running";
      activeSince = now();
      emitState("running");
      scheduleNext();
    },
    pause() {
      if (disposed || (phase !== "planning" && phase !== "running")) return;
      syncElapsed();
      clearScheduled();
      resumePhase = phase;
      phase = "paused";
      emitState("paused");
    },
    resume() {
      if (disposed || phase !== "paused" || resumePhase === null) return;
      phase = resumePhase;
      resumePhase = null;
      activeSince = now();
      emitState(phase);
      scheduleNext();
    },
    jumpToResult() {
      if (disposed || phase === "completed") return;
      emitCompleteSequence();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearScheduled();
    }
  };
}
