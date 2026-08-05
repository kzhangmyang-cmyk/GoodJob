import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const contractsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const script = path.join(
  contractsRoot,
  "scripts",
  "generate-frontend-contract-types.mjs"
);
const input = path.join(
  contractsRoot,
  "openapi",
  "ai-acquisition.v1.yaml"
);

function runGenerator(output, ...options) {
  return spawnSync(
    process.execPath,
    [script, ...options, "--input", input, "--output", output],
    { cwd: contractsRoot, encoding: "utf8" }
  );
}

test("generated frontend contract types detect absent and stale outputs without mutating checks", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "goodjob-generated-types-")
  );
  const output = path.join(temporaryDirectory, "ai-acquisition.ts");

  try {
    const absent = runGenerator(output, "--check");
    assert.notEqual(absent.status, 0, "an absent output must fail --check");
    await assert.rejects(stat(output), { code: "ENOENT" });

    const written = runGenerator(output);
    assert.equal(written.status, 0, written.stderr);
    const generated = await readFile(output, "utf8");
    assert.match(generated, /export interface paths/);
    assert.match(generated, /export interface components/);
    assert.match(generated, /export (?:interface|type) operations/);
    assert.match(generated, /approveAcquisitionPlan:/);

    const unchanged = runGenerator(output, "--check");
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(await readFile(output, "utf8"), generated);

    const corrupted = `${generated}\n// stale\n`;
    await writeFile(output, corrupted, "utf8");
    const stale = runGenerator(output, "--check");
    assert.notEqual(stale.status, 0, "a stale output must fail --check");
    assert.equal(
      await readFile(output, "utf8"),
      corrupted,
      "--check must not rewrite stale output"
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
