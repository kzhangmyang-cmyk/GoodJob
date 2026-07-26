import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePresentationEventDto,
  RunPresentationDto
} from "./types.js";
import {
  AdvisorConflictError,
  conversionTodoIdempotencyKey,
  createAiGrowthApi,
  type AdvisorRequest
} from "./api.js";
import { createRunPresentationPoller } from "./poll-run.js";

const presentation = (
  overrides: Partial<RunPresentationDto> = {}
): RunPresentationDto => ({
  run: {
    id: "run-1",
    status: "running",
    etag: "\"run-1:1\"",
    updatedAt: "2026-07-26T09:00:00.000Z",
    completedAt: null
  },
  providers: [],
  summary: {
    sourcesSearched: 0,
    pagesAnalyzed: 0,
    organizationsFound: 0,
    dedupedCandidates: 0,
    validOpportunities: 0,
    highIntent: 0,
    financialEvaluatedHighIntentCount: 0,
    financialPendingHighIntentCount: 0,
    expectedRevenueByCurrency: []
  },
  candidateEvents: [],
  nextAfter: "cursor-1",
  hasMore: false,
  ...overrides
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const candidateEvent = (
  displayName: string,
  eventId: string
): CandidatePresentationEventDto => ({
  eventId,
  createdAt: "2026-07-26T09:00:00.000Z",
  candidateId: "candidate-1",
  candidate: {
    id: "candidate-1",
    subjectKind: "organization",
    displayName,
    industry: "制造业",
    region: "上海",
    domain: null,
    status: "qualified",
    updatedAt: "2026-07-26T09:00:00.000Z"
  },
  qualification: null,
  financialValue: null,
  sourcePlatforms: ["tavily"],
  evidenceCount: 1
});

function fakeScheduler() {
  const pending = new Map<number, { delay: number; callback: () => void }>();
  let nextId = 1;
  return {
    scheduler: {
      setTimeout(callback: () => void, delay: number) {
        const id = nextId++;
        pending.set(id, { delay, callback });
        return id;
      },
      clearTimeout(handle: unknown) {
        assert.equal(typeof handle, "number");
        const id = handle as number;
        pending.delete(id);
      }
    },
    pending,
    run(id: number) {
      const task = pending.get(id);
      assert.ok(task);
      pending.delete(id);
      task.callback();
    }
  };
}

function fakeVisibility() {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    source: {
      get hidden() {
        return hidden;
      },
      addEventListener(_type: "visibilitychange", listener: () => void) {
        listeners.add(listener);
      },
      removeEventListener(_type: "visibilitychange", listener: () => void) {
        listeners.delete(listener);
      }
    },
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size
  };
}

test("the first presentation request starts at the run origin without after", async () => {
  const calls: Array<{ runId: string; after?: string; limit: number }> = [];
  const poller = createRunPresentationPoller({
    getRunPresentation: async (runId, input) => {
      calls.push({ runId, ...input });
      return presentation();
    },
    onUpdate: () => undefined
  });

  poller.start("run-1", "real");
  await flush();

  assert.deepEqual(calls, [{ runId: "run-1", limit: 100 }]);
  poller.dispose();
});

test("hasMore drains immediately with nextAfter and terminal only stops after the final page", async () => {
  const calls: Array<{ after?: string; limit: number }> = [];
  const responses = [
    presentation({
      run: { ...presentation().run, status: "succeeded" },
      nextAfter: "cursor-page-1",
      hasMore: true
    }),
    presentation({
      run: { ...presentation().run, status: "succeeded" },
      nextAfter: "cursor-page-2",
      hasMore: false
    })
  ];
  const poller = createRunPresentationPoller({
    getRunPresentation: async (_runId, input) => {
      calls.push(input);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    onUpdate: () => undefined
  });

  poller.start("run-1", "real");
  await new Promise<void>((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(calls, [
    { limit: 100 },
    { after: "cursor-page-1", limit: 100 }
  ]);
  assert.equal(poller.cursor(), "cursor-page-2");
  poller.dispose();
});

test("a caught-up running feed keeps its cursor and polls again after 2.5 seconds", async () => {
  const clock = fakeScheduler();
  const calls: Array<{ after?: string; limit: number }> = [];
  const poller = createRunPresentationPoller({
    getRunPresentation: async (_runId, input) => {
      calls.push(input);
      return presentation({
        nextAfter: calls.length === 1 ? "cursor-live-1" : "cursor-live-2"
      });
    },
    onUpdate: () => undefined,
    scheduler: clock.scheduler
  });

  poller.start("run-1", "real");
  await flush();

  assert.equal(clock.pending.size, 1);
  const [timerId, timer] = [...clock.pending.entries()][0]!;
  assert.equal(timer.delay, 2_500);
  assert.equal(poller.cursor(), "cursor-live-1");

  clock.run(timerId);
  await flush();
  assert.deepEqual(calls, [
    { limit: 100 },
    { after: "cursor-live-1", limit: 100 }
  ]);
  poller.dispose();
});

test("candidate presentation events are upserted through the shared ViewModel", async () => {
  const clock = fakeScheduler();
  const updates: Array<{ size: number; displayName?: string }> = [];
  const responses = [
    presentation({
      run: { ...presentation().run, status: "succeeded" },
      candidateEvents: [candidateEvent("上海智造", "event-1")],
      nextAfter: "cursor-1",
      hasMore: true
    }),
    presentation({
      run: { ...presentation().run, status: "succeeded" },
      candidateEvents: [candidateEvent("上海智造（更新）", "event-2")],
      nextAfter: "cursor-2",
      hasMore: false
    })
  ];
  const poller = createRunPresentationPoller({
    getRunPresentation: async () => responses.shift()!,
    onUpdate: (viewModel) => updates.push({
      size: viewModel.candidatesById.size,
      displayName: viewModel.candidatesById.get("candidate-1")?.displayName
    }),
    scheduler: clock.scheduler
  });

  poller.start("run-1", "real");
  await flush();
  const [timerId, timer] = [...clock.pending.entries()][0]!;
  assert.equal(timer.delay, 0);
  clock.run(timerId);
  await flush();

  assert.deepEqual(updates, [
    { size: 1, displayName: "上海智造" },
    { size: 1, displayName: "上海智造（更新）" }
  ]);
  poller.dispose();
});

test("hidden pauses polling and visible resumes from the same cursor", async () => {
  const clock = fakeScheduler();
  const visibility = fakeVisibility();
  const calls: Array<{ after?: string; limit: number }> = [];
  const poller = createRunPresentationPoller({
    getRunPresentation: async (_runId, input) => {
      calls.push(input);
      return presentation({ nextAfter: `cursor-${calls.length}` });
    },
    onUpdate: () => undefined,
    scheduler: clock.scheduler,
    visibilitySource: visibility.source
  });

  poller.start("run-1", "real");
  await flush();
  assert.equal(poller.cursor(), "cursor-1");

  visibility.setHidden(true);
  assert.equal(clock.pending.size, 0);
  visibility.setHidden(false);
  await flush();

  assert.deepEqual(calls, [
    { limit: 100 },
    { after: "cursor-1", limit: 100 }
  ]);
  poller.dispose();
  assert.equal(visibility.listenerCount(), 0);
});

test("switching run or mode aborts the old request and drops its late response", async () => {
  let resolveOld!: (value: RunPresentationDto) => void;
  const oldResponse = new Promise<RunPresentationDto>((resolve) => {
    resolveOld = resolve;
  });
  const signals: AbortSignal[] = [];
  const updates: string[] = [];
  const poller = createRunPresentationPoller({
    getRunPresentation: async (runId, _input, signal) => {
      signals.push(signal);
      if (runId === "run-old") return oldResponse;
      return presentation({
        run: {
          ...presentation().run,
          id: runId,
          status: "succeeded"
        },
        nextAfter: "cursor-new"
      });
    },
    onUpdate: (_viewModel, dto) => updates.push(dto.run.id)
  });

  poller.start("run-old", "real");
  await flush();
  poller.start("run-new", "real");
  await flush();

  assert.equal(signals[0]?.aborted, true);
  assert.deepEqual(updates, ["run-new"]);
  resolveOld(presentation({
    run: { ...presentation().run, id: "run-old", status: "succeeded" },
    nextAfter: "cursor-stale"
  }));
  await flush();
  assert.deepEqual(updates, ["run-new"]);
  assert.equal(poller.cursor(), "cursor-new");

  poller.start("run-new", "demo");
  assert.equal(poller.cursor(), null);
  poller.dispose();
});

test("only network, 429, and 5xx errors back off; cursor 4xx becomes a direct error", async () => {
  const retryableErrors: unknown[] = [
    new TypeError("network offline"),
    Object.assign(new Error("rate limited"), { status: 429 }),
    Object.assign(new Error("service unavailable"), { status: 503 })
  ];

  for (const failure of retryableErrors) {
    const clock = fakeScheduler();
    const states: Array<{ type: string; retryable?: boolean; delayMs?: number }> = [];
    const poller = createRunPresentationPoller({
      getRunPresentation: async () => {
        throw failure;
      },
      onUpdate: () => undefined,
      onState: (state) => states.push({
        type: state.type,
        retryable: state.retryable,
        ...("delayMs" in state ? { delayMs: state.delayMs } : {})
      }),
      scheduler: clock.scheduler
    });
    poller.start("run-1", "real");
    await flush();
    assert.equal(clock.pending.size, 1);
    assert.deepEqual(states, [{
      type: "retrying",
      retryable: true,
      delayMs: 1_000
    }]);
    poller.dispose();
  }

  const clock = fakeScheduler();
  const states: Array<{ type: string; retryable?: boolean; delayMs?: number }> = [];
  let presentationCalls = 0;
  const cursorError = Object.assign(new Error("invalid cursor"), {
    status: 400,
    code: "invalid_cursor"
  });
  const poller = createRunPresentationPoller({
    getRunPresentation: async () => {
      presentationCalls += 1;
      throw cursorError;
    },
    onUpdate: () => undefined,
    onState: (state) => states.push({
      type: state.type,
      retryable: state.retryable
    }),
    scheduler: clock.scheduler
  });
  poller.start("run-1", "real");
  await flush();

  assert.equal(presentationCalls, 1);
  assert.equal(clock.pending.size, 0);
  assert.deepEqual(states, [{ type: "error", retryable: false }]);
  poller.dispose();
});

test("API writes use the fixed paths, modes, bodies, idempotency keys, and ETags", async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const request = (async (path: string, init: RequestInit = {}) => {
    calls.push({ path, init });
    return { id: `result-${calls.length}`, etag: "\"etag:2\"" };
  }) as AdvisorRequest;
  const api = createAiGrowthApi(request);

  await api.createSession({ connectionId: null }, "session-key-123");
  await api.requestPlanDraft("session 1", "find buyers", "draft-key-123");
  await api.requestAssistantAction(
    "session 1",
    "qualify candidate-1",
    "assistant-key-123"
  );
  await api.updatePlan(
    "plan 1",
    "\"plan:1\"",
    { objective: "更新后的目标" }
  );
  await api.approvePlan(
    "plan 1",
    "\"plan:1\"",
    { decision: "approve", reason: "人工确认" }
  );
  await api.createRun("plan 1", { reason: "人工启动" }, "run-key-123");
  await api.pauseRun("run 1", "\"run:1\"", "人工暂停");

  const details = calls.map(({ path, init }) => ({
    path,
    method: init.method,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    idempotencyKey: new Headers(init.headers).get("Idempotency-Key"),
    ifMatch: new Headers(init.headers).get("If-Match")
  }));
  assert.deepEqual(details.slice(0, 3), [
    {
      path: "/api/v1/acquisition/copilot/sessions",
      method: "POST",
      body: { connectionId: null },
      idempotencyKey: "session-key-123",
      ifMatch: null
    },
    {
      path: "/api/v1/acquisition/copilot/sessions/session%201/messages",
      method: "POST",
      body: { message: "find buyers", responseMode: "plan_draft" },
      idempotencyKey: "draft-key-123",
      ifMatch: null
    },
    {
      path: "/api/v1/acquisition/copilot/sessions/session%201/messages",
      method: "POST",
      body: {
        message: "qualify candidate-1",
        responseMode: "assistant"
      },
      idempotencyKey: "assistant-key-123",
      ifMatch: null
    }
  ]);
  assert.deepEqual(details.slice(3).map((item) => ({
    ...item,
    idempotencyKey: item.idempotencyKey
      ? `${item.idempotencyKey.length} chars`
      : null
  })), [
    {
      path: "/api/v1/acquisition/plans/plan%201",
      method: "PATCH",
      body: { objective: "更新后的目标" },
      idempotencyKey: null,
      ifMatch: "\"plan:1\""
    },
    {
      path: "/api/v1/acquisition/plans/plan%201/approval",
      method: "POST",
      body: { decision: "approve", reason: "人工确认" },
      idempotencyKey: "36 chars",
      ifMatch: "\"plan:1\""
    },
    {
      path: "/api/v1/acquisition/plans/plan%201/runs",
      method: "POST",
      body: { reason: "人工启动" },
      idempotencyKey: "11 chars",
      ifMatch: null
    },
    {
      path: "/api/v1/acquisition/runs/run%201/pause",
      method: "POST",
      body: { reason: "人工暂停" },
      idempotencyKey: "36 chars",
      ifMatch: "\"run:1\""
    }
  ]);
});

test("presentation is signal-aware and evidence is not declared complete before all pages load", async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const request = (async (path: string, init: RequestInit = {}) => {
    calls.push({ path, init });
    if (path.includes("/presentation")) return presentation();
    if (path.includes("cursor=page-2")) {
      return { items: [{ id: "evidence-2" }], nextCursor: null };
    }
    return {
      items: [{ id: "evidence-1" }],
      nextCursor: "page-2"
    };
  }) as AdvisorRequest;
  const api = createAiGrowthApi(request);
  const controller = new AbortController();

  await api.getRunPresentation(
    "run 1",
    { limit: 100 },
    controller.signal
  );
  const evidence = await api.getEvidence("candidate 1");

  assert.equal(calls[0]?.path,
    "/api/v1/acquisition/runs/run%201/presentation?limit=100");
  assert.equal(calls[0]?.init.signal, controller.signal);
  assert.deepEqual(calls.slice(1).map(({ path }) => path), [
    "/api/v1/acquisition/candidates/candidate%201/evidence?limit=100",
    "/api/v1/acquisition/candidates/candidate%201/evidence?cursor=page-2&limit=100"
  ]);
  assert.deepEqual(evidence, {
    items: [{ id: "evidence-1" }, { id: "evidence-2" }],
    nextCursor: null
  });
});

test("409/412 are mapped to a refresh-required conflict and short write keys are rejected", async () => {
  for (const status of [409, 412] as const) {
    const request = (async () => {
      throw Object.assign(new Error("precondition failed"), { status });
    }) as AdvisorRequest;
    const api = createAiGrowthApi(request);

    await assert.rejects(
      api.approvePlan(
        "plan-1",
        "\"plan:1\"",
        { decision: "approve", reason: "确认" }
      ),
      (error) => {
        assert.ok(error instanceof AdvisorConflictError);
        assert.equal(error.status, status);
        assert.match(error.message, /计划已被其他成员更新/);
        return true;
      }
    );
  }

  const api = createAiGrowthApi((async () => ({})) as AdvisorRequest);
  await assert.rejects(
    api.createPlan({} as never, "short"),
    /Idempotency-Key.*8.*200/
  );
});

test("conversion todo retries derive the same bounded SHA-256 idempotency key", async () => {
  const first = await conversionTodoIdempotencyKey("conversion-42");
  const second = await conversionTodoIdempotencyKey("conversion-42");

  assert.equal(
    first,
    "ai-growth-todo:bf9b7a55fff83180f18d52c8709af4a760df500c043beabb"
  );
  assert.equal(second, first);
  assert.equal(first.length, 63);
});

test("createTodoForConversion retries only todo with the stable conversion key", async () => {
  const keys: Array<string | null> = [];
  const request = (async (_path: string, init: RequestInit = {}) => {
    keys.push(new Headers(init.headers).get("Idempotency-Key"));
    return {
      todo: {
        id: "todo-1",
        title: "跟进客户",
        type: "customer",
        priority: "high",
        dueAt: "",
        related: "lead-1",
        ownerId: "owner-1",
        teamId: "team-1",
        done: false
      }
    };
  }) as AdvisorRequest;
  const api = createAiGrowthApi(request);
  const todo = {
    title: "跟进客户",
    type: "customer" as const,
    priority: "high" as const,
    dueAt: "",
    related: "lead-1"
  };

  await api.createTodoForConversion("conversion-42", todo);
  await api.createTodoForConversion("conversion-42", todo);

  assert.deepEqual(keys, [
    "ai-growth-todo:bf9b7a55fff83180f18d52c8709af4a760df500c043beabb",
    "ai-growth-todo:bf9b7a55fff83180f18d52c8709af4a760df500c043beabb"
  ]);
});
