import { strict as assert } from "node:assert";
import { acquisitionDetailRequestForAction } from "./detail-center-entry";

assert.deepEqual(
  acquisitionDetailRequestForAction("real", "replicaEditTask", "plan-real-1"),
  { mode: "plan", planId: "plan-real-1" },
  "the real plan action must open the selected task's plan details"
);

assert.deepEqual(
  acquisitionDetailRequestForAction("real", "replicaCompleteTask", "plan-real-1"),
  { mode: "candidates", planId: "plan-real-1" },
  "the real candidate action must open the selected task's AI review"
);

assert.equal(
  acquisitionDetailRequestForAction("demo", "replicaCompleteTask", "plan-demo"),
  null,
  "demo actions must keep their existing simulated behavior"
);

assert.equal(
  acquisitionDetailRequestForAction("real", "replicaEditTask", "  "),
  null,
  "a real detail action without a selected plan must not open an empty dialog"
);
