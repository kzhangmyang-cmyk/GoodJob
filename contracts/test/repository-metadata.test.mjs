import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

test("public Node selection surfaces stay pinned and synchronized", () => {
  const nvmNodeVersion = readFileSync(
    path.join(repositoryRoot, ".nvmrc"),
    "utf8"
  ).trim();
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
  );
  const packageLock = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8")
  );
  const workflow = YAML.parse(
    readFileSync(
      path.join(repositoryRoot, ".github/workflows/acquisition-contracts.yml"),
      "utf8"
    )
  );
  const setupNodeSteps = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.filter((step) => step.uses?.startsWith("actions/setup-node@"))
  );

  assert.equal(nvmNodeVersion, "22.22.3", ".nvmrc must pin Node exactly");
  assert.equal(
    packageJson.engines.node,
    ">=22.22.3 <23",
    "root package must constrain the pinned Node major"
  );

  assert.equal(
    packageLock.packages[""].engines.node,
    packageJson.engines.node,
    "root Node engine must match package-lock metadata"
  );
  assert.equal(setupNodeSteps.length, 1, "workflow must have one setup-node step");
  assert.equal(setupNodeSteps[0].uses, "actions/setup-node@v4");
  assert.equal(setupNodeSteps[0].with["node-version-file"], ".nvmrc");
});

test("the acquisition contract gate runs focused security and OpenAPI guards", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
  );
  const backendPackageJson = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "backend/package.json"),
      "utf8"
    )
  );
  const gate = packageJson.scripts["check:acquisition-contracts"];
  const openApiGuard =
    backendPackageJson.scripts["test:acquisition-openapi"];

  assert.match(gate, /npm run test:security --workspace backend/);
  assert.match(
    gate,
    /npm run test:acquisition-openapi --workspace backend/
  );
  assert.doesNotMatch(gate, /npm run test --workspace backend/);
  assert.match(openApiGuard, /src\/acquisition-openapi-test\.ts/);
  assert.match(
    openApiGuard,
    /src\/acquisition-openapi-response-conformance-test\.ts/
  );
});
