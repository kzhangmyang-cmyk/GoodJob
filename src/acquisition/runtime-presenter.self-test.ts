import { strict as assert } from "node:assert";
import { renderRealTaskRows } from "./runtime-presenter";

assert.match(renderRealTaskRows([]), /暂无真实抖音获客任务/);

const html = renderRealTaskRows([{
  id: "task-1",
  planId: "plan-1",
  name: "<img src=x onerror=alert(1)>",
  objective: "寻找公开需求",
  platformLabel: "抖音",
  status: "running",
  statusLabel: "正在运行",
  statusTone: "active",
  evidenceCount: 12,
  requests: 4,
  results: 18,
  durationSeconds: 31,
  updatedAt: "2026-08-07T05:00:00.000Z",
  tags: ["公开搜索"]
}]);

assert.match(html, /data-acquisition-plan-id="plan-1"/);
assert.match(html, /12 条公开证据/);
assert.match(html, /正在运行/);
assert.doesNotMatch(html, /<img/);
assert.match(html, /&lt;img/);

