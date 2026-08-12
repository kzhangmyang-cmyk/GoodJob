import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyPinnedGrowthContractAt } from "./check-growth-contract.mjs";

test("pinned contract rejects a manifest whose hash is not the OpenAPI bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "growth-pin-"));
  try {
    const openapi = Buffer.from('{"openapi":"3.1.0"}\n');
    await writeFile(
      path.join(root, "growth-advisor-quote-roi.openapi.json"),
      openapi
    );
    await writeFile(
      path.join(root, "growth-advisor-quote-roi.manifest.json"),
      JSON.stringify({
        name: "growth-advisor-quote-roi",
        contractVersion: "1.0.0",
        contractHash: `sha256:${createHash("sha256")
          .update("different").digest("hex")}`,
        openapiVersion: "3.1.0"
      })
    );
    await assert.rejects(
      verifyPinnedGrowthContractAt(root),
      /Pinned growth contract hash mismatch/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("contract generator dependencies are exact and represented in pnpm lock", async () => {
  const packageJson = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url), "utf8"
  ));
  const lock = await readFile(
    new URL("../pnpm-lock.yaml", import.meta.url), "utf8"
  );
  assert.equal(packageJson.devDependencies["openapi-typescript"], "7.13.0");
  assert.equal(packageJson.devDependencies.yaml, "2.8.1");
  assert.match(lock, /openapi-typescript:\s*\n\s+specifier: 7\.13\.0/u);
  assert.match(lock, /yaml:\s*\n\s+specifier: 2\.8\.1/u);
});

test("pinned release verifies against its own manifest hash", async () => {
  const manifest = await verifyPinnedGrowthContractAt(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "contracts",
      "pinned"
    )
  );
  assert.equal(manifest.contractVersion, "1.0.3");
});
