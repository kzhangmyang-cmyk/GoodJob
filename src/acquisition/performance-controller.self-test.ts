import { strict as assert } from "node:assert";
import {
  createPerformanceGenerationGuard,
  isUnauthorizedPerformanceError,
  performanceFiltersFromDates,
  performanceStatusFor
} from "./performance-controller";
import { AcquisitionPerformanceApiError } from "./performance-api";

assert.deepEqual(
  performanceFiltersFromDates("2026-08-01", "2026-08-07", "douyin"),
  {
    platform: "douyin",
    from: "2026-08-01",
    to: "2026-08-07"
  }
);
assert.equal(
  performanceFiltersFromDates("2026-01-01", "2026-08-07", "").from,
  "2026-05-10",
  "the controller must clamp user date ranges to the 90-day contract"
);
assert.equal(isUnauthorizedPerformanceError(
  new AcquisitionPerformanceApiError("session expired", 401)
), true);
assert.equal(isUnauthorizedPerformanceError(
  new AcquisitionPerformanceApiError("请先登录", 503)
), false);
assert.equal(isUnauthorizedPerformanceError(new Error("upstream unavailable")), false);
assert.equal(performanceStatusFor({ discovered: 0 }), "empty");
assert.equal(performanceStatusFor({ discovered: 1 }), "ready");

const guard = createPerformanceGenerationGuard();
const first = guard.begin({
  platform: "douyin",
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-07T23:59:59.999Z"
}, "real");
const second = guard.begin({
  platform: "web",
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-07T23:59:59.999Z"
}, "real");
assert.equal(first.signal.aborted, true);
assert.equal(guard.isCurrent(first), false);
assert.equal(guard.isCurrent(second), true);
guard.invalidate();
assert.equal(second.signal.aborted, true);
assert.equal(guard.isCurrent(second), false);
