import { strict as assert } from "node:assert";
import { snapshotDisabledStates } from "./runtime";

const initiallyEnabled = { disabled: false };
const initiallyDisabled = { disabled: true };
const restoreDisabledStates = snapshotDisabledStates([
  initiallyEnabled,
  initiallyDisabled,
  null
]);

initiallyEnabled.disabled = true;
initiallyDisabled.disabled = false;

restoreDisabledStates();

assert.equal(
  initiallyEnabled.disabled,
  false,
  "leaving real acquisition mode must restore an initially enabled action"
);
assert.equal(
  initiallyDisabled.disabled,
  true,
  "leaving real acquisition mode must preserve an initially disabled action"
);

console.log("acquisition runtime self-test passed");
