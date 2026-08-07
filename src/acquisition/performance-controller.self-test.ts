import { strict as assert } from "node:assert";
import {
  isUnauthorizedPerformanceError,
  performanceFiltersFromDates,
  performanceStatusFor
} from "./performance-controller";

assert.deepEqual(
  performanceFiltersFromDates("2026-08-01", "2026-08-07", "douyin"),
  {
    platform: "douyin",
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-07T23:59:59.999Z"
  }
);
assert.equal(
  performanceFiltersFromDates("2026-01-01", "2026-08-07", "").from,
  "2026-05-10T00:00:00.000Z",
  "the controller must clamp user date ranges to the 90-day contract"
);
assert.equal(isUnauthorizedPerformanceError(new Error("HTTP 401 Unauthorized")), true);
assert.equal(isUnauthorizedPerformanceError(new Error("upstream unavailable")), false);
assert.equal(performanceStatusFor({ discovered: 0 }), "empty");
assert.equal(performanceStatusFor({ discovered: 1 }), "ready");
