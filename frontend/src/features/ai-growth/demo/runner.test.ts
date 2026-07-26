import assert from "node:assert/strict";
import test from "node:test";

import { demoFixture } from "./fixture.js";
import type { AdvisorDemoEvent } from "./runner.js";
import { createDemoRunner } from "./runner.js";

class FakeClock {
  #now = 0;
  #nextId = 1;
  #tasks = new Map<number, { at: number; callback: () => void }>();

  now = () => this.#now;

  schedule = (callback: () => void, delayMs: number) => {
    const id = this.#nextId++;
    this.#tasks.set(id, { at: this.#now + delayMs, callback });
    return id;
  };

  cancel = (id: number) => {
    this.#tasks.delete(id);
  };

  advance(ms: number) {
    const target = this.#now + ms;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort(([, left], [, right]) => left.at - right.at)[0];
      if (!next) break;
      const [id, task] = next;
      this.#tasks.delete(id);
      this.#now = task.at;
      task.callback();
    }
    this.#now = target;
  }
}

function demo(clock = new FakeClock(), durationMs?: number) {
  const events: AdvisorDemoEvent[] = [];
  const runner = createDemoRunner({
    durationMs,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    onEvent: (event) => events.push(event)
  });
  return { clock, events, runner };
}

function stateStatuses(events: AdvisorDemoEvent[]) {
  return events
    .filter((event) => event.type === "state")
    .map((event) => event.status);
}

test("uses the 72-second default and accepts only a 45–90 second duration", () => {
  const defaultDemo = demo();
  defaultDemo.runner.start();
  defaultDemo.clock.advance(10_799);
  assert.deepEqual(stateStatuses(defaultDemo.events), ["planning"]);
  defaultDemo.clock.advance(1);
  assert.deepEqual(stateStatuses(defaultDemo.events), [
    "planning",
    "awaiting_approval"
  ]);

  assert.doesNotThrow(() => demo(new FakeClock(), 45_000));
  assert.doesNotThrow(() => demo(new FakeClock(), 90_000));
  assert.throws(() => demo(new FakeClock(), 44_999), RangeError);
  assert.throws(() => demo(new FakeClock(), 90_001), RangeError);
});

test("does not enter running until the operator approves the plan", () => {
  const { clock, events, runner } = demo(new FakeClock(), 45_000);
  runner.start();
  clock.advance(6_750);
  clock.advance(120_000);
  assert.deepEqual(stateStatuses(events), ["planning", "awaiting_approval"]);

  runner.approve();
  assert.deepEqual(stateStatuses(events), [
    "planning",
    "awaiting_approval",
    "running"
  ]);
});

test("pauses the deterministic timeline and resumes from its saved progress", () => {
  const { clock, events, runner } = demo(new FakeClock(), 45_000);
  runner.start();
  clock.advance(6_750);
  runner.approve();
  clock.advance(2_250);
  runner.pause();
  const pausedCount = events.length;
  clock.advance(120_000);
  assert.equal(events.length, pausedCount);

  runner.resume();
  clock.advance(6_750);
  assert.ok(events.some((event) => event.type === "presentation"));
  clock.advance(29_250);
  assert.deepEqual(stateStatuses(events), [
    "planning",
    "awaiting_approval",
    "running",
    "paused",
    "running",
    "completed"
  ]);
});

test("jumpToResult emits the full ordered demo sequence and completed result", () => {
  const { events, runner } = demo();
  runner.start();
  runner.jumpToResult();

  assert.deepEqual(stateStatuses(events), [
    "planning",
    "awaiting_approval",
    "running",
    "completed"
  ]);
  assert.deepEqual(
    events.map((event) => event.sequence),
    [...events.keys()].map((index) => index + 1)
  );
  assert.ok(events.every((event) => event.demo === true));
  assert.ok(events.every((event) => event.demoLabel === "演示数据"));
  assert.ok(events.some((event) => event.type === "duplicate_merged"));
  assert.ok(events.some((event) => event.type === "battle_card"));
  assert.ok(events.some((event) => event.type === "summary"));
});

test("dispose cancels scheduled work and exposes no network request dependency", () => {
  const { clock, events, runner } = demo();
  assert.equal("request" in runner, false);
  assert.equal("api" in runner, false);
  runner.start();
  runner.dispose();
  const eventCount = events.length;
  clock.advance(120_000);
  runner.approve();
  runner.jumpToResult();
  assert.equal(events.length, eventCount);
});

test("supplies labelled production-shaped demo records for the shared UI", () => {
  assert.equal(demoFixture.demo, true);
  assert.equal(demoFixture.demoLabel, "演示数据");
  assert.equal(demoFixture.runPresentation.providers.length, 6);
  assert.equal(demoFixture.runPresentation.candidateEvents.length, 6);
  assert.deepEqual(
    demoFixture.runPresentation.candidateEvents.map(
      (event) => event.qualification?.grade
    ),
    ["S", "A", "B", "C", "A", "B"]
  );
  assert.equal(
    demoFixture.runPresentation.candidateEvents.filter(
      (event) => event.financialValue === null
    ).length >= 2,
    true
  );
  assert.deepEqual(
    demoFixture.battleCard.sections.map((section) => section.kind),
    ["fact", "inference", "unknown"]
  );
  assert.equal(demoFixture.duplicateMerge.demo, true);
  assert.equal(demoFixture.ownerSummary.demoLabel, "演示数据");
});
