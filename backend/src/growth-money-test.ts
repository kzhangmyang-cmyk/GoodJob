import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ceilDiv,
  currencyExponent,
  multiplyQuantityMinor,
  roundHalfUpDiv,
  roundSignedHalfUpDiv,
  safeMinor,
  safeSignedInteger
} from "./growth-money.js";

test("fixed-point money and ISO exponents are deterministic", () => {
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("CNY"), 2);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(currencyExponent("RMB"), null);
  assert.equal(currencyExponent("cny"), null);
  assert.equal(multiplyQuantityMinor(333, 1_500_000, "half_up"), 500);
  assert.equal(multiplyQuantityMinor(1, 1, "ceil"), 1);
  assert.equal(roundHalfUpDiv(5n, 2n), 3n);
  assert.equal(roundSignedHalfUpDiv(1n, 2n), 1n);
  assert.equal(roundSignedHalfUpDiv(-1n, 2n), -1n);
  assert.equal(roundSignedHalfUpDiv(5n, 2n), 3n);
  assert.equal(roundSignedHalfUpDiv(-5n, 2n), -3n);
  assert.equal(roundSignedHalfUpDiv(-4n, 3n), -1n);
  assert.equal(safeSignedInteger(-30_000n, "roiBps"), -30_000);
  assert.equal(ceilDiv(1n, 1_000_000n), 1n);
  assert.throws(
    () => safeMinor(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "amount"),
    (error: unknown) => (error as { code?: string }).code
      === "amount_out_of_range"
  );
});

test("money helpers reject unsafe, negative, fractional, and invalid ratio inputs", () => {
  assert.throws(() => safeMinor(-1n, "amount"), { code: "amount_out_of_range" });
  assert.throws(
    () => safeSignedInteger(BigInt(Number.MIN_SAFE_INTEGER) - 1n, "ratio"),
    { code: "amount_out_of_range" }
  );
  assert.throws(() => roundHalfUpDiv(-1n, 2n), /invalid ratio/u);
  assert.throws(() => roundHalfUpDiv(1n, 0n), /invalid ratio/u);
  assert.throws(() => ceilDiv(-1n, 2n), /invalid ratio/u);
  assert.throws(() => roundSignedHalfUpDiv(1n, 0n), /invalid ratio/u);
  assert.throws(() => multiplyQuantityMinor(-1, 1, "half_up"), /invalid ratio/u);
  assert.throws(() => multiplyQuantityMinor(1.5, 1, "half_up"), /integer/u);
  assert.throws(() => multiplyQuantityMinor(1, 1.5, "half_up"), /integer/u);
});
