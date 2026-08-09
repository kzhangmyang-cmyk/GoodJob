import assert from "node:assert/strict";
import test from "node:test";
import {
  createGrowthOpenApiComponents,
  createGrowthOpenApiPaths,
  loadGrowthContractRelease
} from "./growth-openapi.js";

test("released Growth OpenAPI loader verifies and exposes the immutable release", () => {
  const release = loadGrowthContractRelease();
  assert.equal(release.manifest.name, "growth-advisor-quote-roi");
  assert.match(release.manifest.contractVersion, /^\d+\.\d+\.\d+$/u);
  assert.equal(release.document.info.version, release.manifest.contractVersion);
  assert.equal(release.document.openapi, release.manifest.openapiVersion);
  assert.match(release.manifest.contractHash, /^sha256:[0-9a-f]{64}$/u);
});

test("Growth production paths retain valid component references for the 3.0 document", () => {
  const paths = createGrowthOpenApiPaths();
  const components = createGrowthOpenApiComponents();
  assert.equal(paths["/api/v1/growth/bootstrap"]?.get?.operationId, "getGrowthBootstrap");
  assert.equal(paths["/api/v1/catalog/items"]?.post?.operationId, "createCatalogItem");
  assert.equal(paths["/api/v1/acquisition/advisor/today"]?.get?.operationId, "getAdvisorToday");
  assert.ok(Object.keys(components.schemas).length > 50);
  assert.match(JSON.stringify(paths), /#\/components\/schemas\/GrowthBootstrapResponse/u);
  assert.equal(JSON.stringify(components).includes('"const"'), false);
});
