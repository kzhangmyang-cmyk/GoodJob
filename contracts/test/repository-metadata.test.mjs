import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

test("root Node engine metadata stays synchronized", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
  );
  const packageLock = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8")
  );

  assert.equal(
    packageLock.packages[""].engines.node,
    packageJson.engines.node,
    "root Node engine must match package-lock metadata"
  );
});
