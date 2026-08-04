import assert from "node:assert/strict";
import test from "node:test";
import { createAcquisitionOpenApiPaths } from "./acquisition-openapi.js";
import {
  loadPublishedAcquisitionPaths,
  operationSurface
} from "./acquisition-openapi-contract-test-helpers.js";

test("published acquisition operations can be normalized", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const operation = published["/api/v1/acquisition/plans/{id}"]?.get;

  assert.ok(operation);
  const surface = operationSurface(operation);
  assert.deepEqual(surface.security, [{ bearerAuth: [] }]);
  assert.ok(surface.responses["200"]);
});

test("published plan approval matches the production contract", async () => {
  const published = await loadPublishedAcquisitionPaths();
  const production = createAcquisitionOpenApiPaths();
  const path = "/api/v1/acquisition/plans/{id}/approval";
  assert.equal(published["/api/v1/acquisition/plans/{id}/approve"], undefined);
  assert.deepEqual(
    operationSurface(published[path]!.post!),
    operationSurface(production[path]!.post!)
  );
  assert.deepEqual(
    published[path]!.post!.requestBody.content["application/json"].schema.required,
    ["decision", "reason"]
  );
  assert.ok(published[path]!.post!.responses["200"].headers.ETag);
});
