import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildGrowthContractRelease } from "../scripts/build-growth-contract-release.mjs";

test("growth release derives the version directory and never overwrites different bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "growth-contract-release-"));
  try {
    const input = new URL("../openapi/growth-advisor-quote-roi.v1.yaml", import.meta.url);
    const firstRoot = path.join(root, "first");
    const secondRoot = path.join(root, "second");
    const firstManifest = await buildGrowthContractRelease({ input, releasesRoot: firstRoot });
    const secondManifest = await buildGrowthContractRelease({ input, releasesRoot: secondRoot });
    const first = path.join(firstRoot, firstManifest.contractVersion);
    const second = path.join(secondRoot, secondManifest.contractVersion);
    const bytes = await readFile(path.join(first, "openapi.json"));
    const expectedHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.equal(firstManifest.contractVersion, "1.0.0");
    assert.equal(firstManifest.contractHash, expectedHash);
    assert.deepEqual(firstManifest, secondManifest);
    assert.deepEqual(bytes, await readFile(path.join(second, "openapi.json")));

    await buildGrowthContractRelease({ input, releasesRoot: firstRoot, check: true });
    const committedManifestBytes = await readFile(path.join(first, "manifest.json"));
    await writeFile(
      path.join(first, "manifest.json"),
      `${JSON.stringify({ ...firstManifest, contractHash: `sha256:${"9".repeat(64)}` }, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(
      buildGrowthContractRelease({ input, releasesRoot: firstRoot }),
      /immutable growth contract release collision for 1\.0\.0/u
    );
    await writeFile(path.join(first, "manifest.json"), committedManifestBytes);
    await writeFile(path.join(first, "openapi.json"), "{}\n", "utf8");
    await assert.rejects(
      buildGrowthContractRelease({ input, releasesRoot: firstRoot }),
      /immutable growth contract release collision for 1\.0\.0/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
