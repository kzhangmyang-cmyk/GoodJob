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

test("jumpToResult does not repeat running after an approved plan is already running", () => {
  const { clock, events, runner } = demo(new FakeClock(), 45_000);
  runner.start();
  clock.advance(6_750);
  runner.approve();
  runner.jumpToResult();

  const statuses = stateStatuses(events);
  assert.equal(statuses.filter((status) => status === "running").length, 1);
  assert.equal(statuses.at(-1), "completed");
  assert.deepEqual(statuses, [
    "planning",
    "awaiting_approval",
    "running",
    "completed"
  ]);
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
  assert.equal(demoFixture.battleCard.schemaVersion, "battle-card.v2");
  assert.equal(
    demoFixture.battleCard.schemaVersion === "battle-card.v2"
      ? demoFixture.battleCard.intelligence.accountOverview.length
      : 0,
    1
  );
  assert.equal(demoFixture.duplicateMerge.demo, true);
  assert.equal(demoFixture.ownerSummary.demoLabel, "演示数据");
});

test("demo plan uses six canonical provider ids and realistic China search queries", () => {
  assert.equal(demoFixture.plan.targetPlatform, "web");
  assert.deepEqual(
    demoFixture.plan.providerConnections.map((item) => item.providerId),
    [
      "baidu_ai_search",
      "tencent_web_search",
      "tavily",
      "serper",
      "brave",
      "serpapi"
    ]
  );
  assert.deepEqual(
    demoFixture.plan.operations.map((item) => item.query),
    [
      "上海 装备制造 海外市场 招聘 外贸销售",
      "苏州 工业零部件 扩产 新项目",
      "宁波 制造企业 寻找供应商 合作",
      "长三角 制造业 CRM 招标 采购",
      "site:gov.cn 制造企业 扩产 项目 公示",
      "site:company-domain.example 英文站 海外业务"
    ]
  );
  assert.deepEqual(
    demoFixture.runPresentation.providers.map((item) => item.providerId),
    [
      "baidu_ai_search",
      "tencent_web_search",
      "tavily",
      "serper",
      "brave",
      "serpapi"
    ]
  );
});

test("six demo candidates carry differentiated evidence and confidence", () => {
  const events = demoFixture.runPresentation.candidateEvents;
  const expectedSignals = [
    "招聘外贸销售",
    "英文站上线",
    "扩产公告",
    "CRM 招标",
    "海外展会",
    "供应商服务投诉"
  ];

  assert.deepEqual(
    events.map((event) => event.qualification?.evidence[0]?.excerpt),
    expectedSignals.map((signal) => `演示数据：${signal}`)
  );
  assert.ok(new Set(
    events.map((event) => event.qualification?.confidence)
  ).size > 1);
  for (const event of events) {
    const qualification = event.qualification;
    assert.ok(qualification);
    assert.equal(
      qualification.reasons.every((reason) =>
        reason.includes(qualification.evidence[0]!.evidenceId)
      ),
      true
    );
  }
});
