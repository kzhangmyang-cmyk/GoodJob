import assert from "node:assert/strict";
import test from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv } from "ajv";
import express from "express";
import {
  createAcquisitionOpenApiPaths
} from "./acquisition-openapi.js";
import {
  createOpenApiDocument
} from "./swagger.js";

const unsupportedOpenApi30SchemaKeywords = new Set([
  "$schema",
  "$id",
  "$defs",
  "const",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "dependentRequired",
  "dependentSchemas",
  "prefixItems",
  "minContains",
  "maxContains",
  "propertyNames"
]);

function unsupportedOpenApi30SchemaLocations(
  value: unknown,
  path = "$"
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      unsupportedOpenApi30SchemaLocations(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  const locations: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`;
    if (unsupportedOpenApi30SchemaKeywords.has(key)) {
      locations.push(itemPath);
    }
    if (key === "type" && (
      Array.isArray(item) || item === "null"
    )) {
      locations.push(itemPath);
    }
    if (key === "$ref" && typeof item === "string"
      && item.includes("/$defs/")) {
      locations.push(itemPath);
    }
    locations.push(...unsupportedOpenApi30SchemaLocations(item, itemPath));
  }
  return locations;
}

test("acquisition OpenAPI publishes the complete agent control surface", () => {
  const paths = createAcquisitionOpenApiPaths();
  const required = [
    "/api/v1/acquisition/providers",
    "/api/v1/acquisition/provider-connections",
    "/api/v1/acquisition/provider-connections/{id}",
    "/api/v1/acquisition/provider-connections/{id}/test",
    "/api/v1/acquisition/content-fetch-operations",
    "/api/v1/acquisition/content-fetch-operations/{id}",
    "/api/v1/acquisition/import-operations",
    "/api/v1/acquisition/import-operations/{id}",
    "/api/v1/acquisition/evidence/{id}",
    "/api/v1/acquisition/candidates",
    "/api/v1/acquisition/candidates/{id}",
    "/api/v1/acquisition/candidates/{id}/evidence",
    "/api/v1/acquisition/candidates/{id}/identity-confirmation",
    "/api/v1/acquisition/candidates/{id}/qualification",
    "/api/v1/acquisition/candidates/{id}/battle-card",
    "/api/v1/acquisition/candidates/{id}/reviews",
    "/api/v1/acquisition/candidates/{id}/review",
    "/api/v1/acquisition/candidates/{id}/convert",
    "/api/v1/acquisition/outcomes",
    "/api/v1/acquisition/audit-events",
    "/api/v1/acquisition/copilot/sessions",
    "/api/v1/acquisition/copilot/sessions/{id}",
    "/api/v1/acquisition/copilot/sessions/{id}/messages",
    "/api/v1/acquisition/copilot/tasks/{id}",
    "/api/v1/acquisition/plans",
    "/api/v1/acquisition/plans/{id}",
    "/api/v1/acquisition/plans/{id}/revisions",
    "/api/v1/acquisition/plans/{id}/approval",
    "/api/v1/acquisition/plans/{id}/runs",
    "/api/v1/acquisition/runs/{id}",
    "/api/v1/acquisition/runs/{id}/shards",
    "/api/v1/acquisition/runs/{id}/presentation",
    "/api/v1/acquisition/runs/{id}/pause",
    "/api/v1/acquisition/runs/{id}/resume",
    "/api/v1/acquisition/runs/{id}/cancel"
  ];
  for (const path of required) {
    assert.ok(paths[path], `missing acquisition OpenAPI path: ${path}`);
  }
});

test("every published acquisition operation has a unique stable camelCase id", () => {
  const paths = createAcquisitionOpenApiPaths();
  const ids: string[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["get", "post", "patch", "delete"] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      const id = operation.operationId;
      assert.equal(typeof id, "string", `${method.toUpperCase()} ${path}`);
      assert.match(
        id as string,
        /^[a-z][A-Za-z0-9]+$/u,
        `${method.toUpperCase()} ${path}`
      );
      ids.push(id as string);
    }
  }

  assert.equal(ids.length, 43);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    paths["/api/v1/acquisition/plans/{id}/approval"]?.post?.operationId,
    "approveAcquisitionPlan"
  );
});

test("run presentation publishes a strict read-only paginated DTO", () => {
  const paths = createAcquisitionOpenApiPaths();
  const path = paths[
    "/api/v1/acquisition/runs/{id}/presentation"
  ];
  const operation = path?.get as Record<string, any> | undefined;
  assert.ok(operation);
  assert.equal(path?.post, undefined);
  assert.deepEqual(
    operation.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["id", "after", "limit"]
  );
  assert.equal(operation.parameters[1].schema.maxLength, 8192);
  assert.equal(operation.parameters[2].schema.default, 50);
  assert.equal(operation.parameters[2].schema.maximum, 100);

  const schema =
    operation.responses["200"].content["application/json"].schema;
  assert.deepEqual(schema.required, [
    "run",
    "providers",
    "summary",
    "candidateEvents",
    "nextAfter",
    "hasMore"
  ]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    schema.properties.candidateEvents.items.required,
    [
      "eventId",
      "createdAt",
      "candidateId",
      "candidate",
      "qualification",
      "financialValue",
      "sourcePlatforms",
      "evidenceCount"
    ]
  );
  assert.equal(
    schema.properties.candidateEvents.items.properties.financialValue
      .nullable,
    true,
    "missing financial values must be represented as null"
  );
  assert.equal(
    schema.properties.candidateEvents.items.properties.qualification
      .additionalProperties,
    false
  );
  assert.ok(
    schema.properties.candidateEvents.items.properties.qualification
      .required.includes("hardGateFailures")
  );
  assert.equal(
    schema.properties.candidateEvents.items.properties.financialValue
      .additionalProperties,
    false
  );
  assert.ok(
    schema.properties.candidateEvents.items.properties.financialValue
      .required.includes("qualificationDecisionId")
  );
  assert.equal(
    schema.properties.summary.properties.expectedRevenueByCurrency.type,
    "array",
    "currencies must remain separate rows"
  );
});

test("production OpenAPI does not advertise direct domain writes", () => {
  const paths = createAcquisitionOpenApiPaths();
  const blockedWrites = [
    "/api/v1/acquisition/evidence",
    "/api/v1/acquisition/candidates",
    "/api/v1/acquisition/candidates/{id}/evidence",
    "/api/v1/acquisition/candidates/{id}/research",
    "/api/v1/acquisition/candidates/{id}/qualification",
    "/api/v1/acquisition/candidates/{id}/battle-card",
    "/api/v1/acquisition/outcomes"
  ];

  for (const path of blockedWrites) {
    assert.equal(
      paths[path]?.post,
      undefined,
      `production OpenAPI must not publish blocked POST ${path}`
    );
  }
  assert.ok(paths["/api/v1/acquisition/evidence/{id}"]?.get);
  assert.ok(paths["/api/v1/acquisition/candidates"]?.get);
  assert.ok(
    paths["/api/v1/acquisition/candidates/{id}/qualification"]?.get
  );
  assert.ok(paths["/api/v1/acquisition/outcomes"]?.get);
});

test("every published JSON write body is a closed object contract", () => {
  const paths = createAcquisitionOpenApiPaths();
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["post", "patch"] as const) {
      const operation = pathItem[method] as Record<string, any> | undefined;
      const schema = operation?.requestBody?.content?.[
        "application/json"
      ]?.schema as Record<string, any> | undefined;
      if (!schema) continue;

      const variants = schema.oneOf ?? [schema];
      for (const variant of variants) {
        assert.equal(
          variant.type,
          "object",
          `${method.toUpperCase()} ${path} must publish an object body`
        );
        assert.ok(
          variant.properties,
          `${method.toUpperCase()} ${path} must declare body properties`
        );
        assert.ok(
          variant.required === undefined
          || (
            Array.isArray(variant.required)
            && variant.required.length > 0
          ),
          `${method.toUpperCase()} ${path} must omit empty required arrays`
        );
        assert.equal(
          variant.additionalProperties,
          false,
          `${method.toUpperCase()} ${path} must reject unknown fields`
        );
      }
    }
  }
});

test("identity confirmation publishes a strict human-review contract", () => {
  const paths = createAcquisitionOpenApiPaths();
  const candidateDetail = paths[
    "/api/v1/acquisition/candidates/{id}"
  ]!.get as Record<string, any>;
  const operation = paths[
    "/api/v1/acquisition/candidates/{id}/identity-confirmation"
  ]!.post as Record<string, any>;
  const parameterNames = operation.parameters.map(
    (parameter: { name: string }) => parameter.name
  );
  assert.deepEqual(
    parameterNames,
    ["id", "Idempotency-Key", "If-Match"]
  );

  const schema = operation.requestBody.content["application/json"].schema;
  assert.equal(schema.oneOf.length, 2);
  assert.ok(schema.discriminator);
  assert.equal(
    JSON.stringify(schema).includes("partyRef"),
    false,
    "clients must not be able to forge a resolved party reference"
  );
  assert.equal(
    JSON.stringify(schema).includes("organizationId"),
    false,
    "clients must not be able to choose the canonical organization id"
  );
  assert.ok(
    schema.oneOf.every(
      (variant: Record<string, any>) =>
        variant.additionalProperties === false
        && variant.required.includes("evidenceIds")
        && variant.required.includes("rationale")
    )
  );
  const organization = schema.oneOf.find(
    (variant: Record<string, any>) =>
      variant.properties.subjectKind.enum[0] === "organization"
  );
  assert.ok(organization.required.includes("domain"));
  assert.ok(organization.required.includes("creditCode"));
  assert.equal(organization.properties.domain.minLength, undefined);
  assert.equal(organization.properties.creditCode.minLength, undefined);
  assert.equal(organization.properties.evidenceIds.uniqueItems, undefined);

  const idempotency = operation.parameters.find(
    (parameter: { name: string }) =>
      parameter.name === "Idempotency-Key"
  );
  assert.equal(idempotency.schema.minLength, 1);
  const ifMatch = operation.parameters.find(
    (parameter: { name: string }) => parameter.name === "If-Match"
  );
  assert.equal(ifMatch.schema.pattern, '^"candidate-v[1-9]\\d*"$');
  assert.equal(
    candidateDetail.responses["200"].headers.ETag.schema.pattern,
    '^"candidate-v[1-9]\\d*"$'
  );
  assert.equal(
    operation.responses["200"].headers.ETag.schema.pattern,
    '^"candidate-v[1-9]\\d*"$'
  );
  assert.ok(operation.responses["428"]);
  assert.equal(operation.responses["412"], undefined);
});

test("plan creation binds a server model snapshot behind an idempotent contract", () => {
  const paths = createAcquisitionOpenApiPaths();
  const create = paths[
    "/api/v1/acquisition/plans"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    create.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["Idempotency-Key"]
  );
  const schema = create.requestBody.content["application/json"].schema;
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.modelConnectionId);
  assert.deepEqual(schema.properties.targetPlatform.enum, ["douyin", "web"]);
  assert.equal(schema.required.includes("targetPlatform"), false);
  assert.equal(
    "modelSnapshotRef" in schema.properties,
    false,
    "clients must never provide a plan model snapshot"
  );
  assert.equal(
    schema.properties.icp.additionalProperties,
    false
  );
  assert.equal(
    schema.properties.operations.items.additionalProperties,
    false
  );
  assert.equal(create.parameters[0].schema.minLength, 8);
});

test("human review, conversion, and copilot writes mirror runtime schemas", () => {
  const paths = createAcquisitionOpenApiPaths();
  const review = paths[
    "/api/v1/acquisition/candidates/{id}/review"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    review.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["id", "Idempotency-Key"]
  );
  const reviewSchema =
    review.requestBody.content["application/json"].schema;
  assert.equal(reviewSchema.oneOf.length, 2);
  assert.ok(reviewSchema.oneOf.every(
    (variant: Record<string, any>) =>
      variant.required.join(",")
      === "action,decisionVersion,reason"
  ));
  const optionalReasonReview = reviewSchema.oneOf.find(
    (variant: Record<string, any>) =>
      variant.properties.action.enum.includes("approved")
  );
  assert.equal(
    optionalReasonReview.properties.reason.nullable,
    true
  );
  const requiredReasonReview = reviewSchema.oneOf.find(
    (variant: Record<string, any>) =>
      variant.properties.action.enum.includes("rejected")
  );
  assert.equal(requiredReasonReview.properties.reason.minLength, 1);
  assert.equal(
    requiredReasonReview.properties.reason.nullable,
    undefined
  );
  assert.equal(review.parameters[1].schema.minLength, 1);

  const convert = paths[
    "/api/v1/acquisition/candidates/{id}/convert"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    convert.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["id", "Idempotency-Key"]
  );
  assert.deepEqual(
    convert.requestBody.content["application/json"].schema.required,
    ["decisionVersion"]
  );

  const session = paths[
    "/api/v1/acquisition/copilot/sessions"
  ]!.post as Record<string, any>;
  const sessionSchema =
    session.requestBody.content["application/json"].schema;
  assert.equal(sessionSchema.required, undefined);
  assert.deepEqual(Object.keys(sessionSchema.properties), ["connectionId"]);
  assert.equal("modelSnapshot" in sessionSchema.properties, false);
  assert.equal(session.parameters[0].schema.minLength, 1);
  assert.ok(session.responses["202"]);
  assert.equal(session.responses["200"], undefined);

  const message = paths[
    "/api/v1/acquisition/copilot/sessions/{id}/messages"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    message.requestBody.content["application/json"].schema.required,
    ["message"]
  );
  assert.deepEqual(
    message.requestBody.content["application/json"].schema
      .properties.targetPlatform.enum,
    ["douyin", "web"]
  );
  assert.deepEqual(
    message.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["id", "Idempotency-Key"]
  );
  assert.ok(message.responses["202"]);
  assert.equal(message.responses["200"], undefined);
});

test("plan mutation and run contracts publish exact concurrency inputs", () => {
  const paths = createAcquisitionOpenApiPaths();
  const patch = paths[
    "/api/v1/acquisition/plans/{id}"
  ]!.patch as Record<string, any>;
  assert.deepEqual(
    patch.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["id", "If-Match"]
  );
  assert.equal(patch.parameters[1].schema.minLength, 1);
  assert.ok(patch.responses["412"]);
  assert.ok(patch.responses["428"]);
  const patchSchema =
    patch.requestBody.content["application/json"].schema;
  assert.equal(patchSchema.minProperties, 1);
  assert.ok(patchSchema.properties.modelSnapshotRef);

  const revision = paths[
    "/api/v1/acquisition/plans/{id}/revisions"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    revision.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["id", "If-Match"]
  );
  assert.equal(
    revision.requestBody.content["application/json"].schema.minProperties,
    1
  );
  assert.ok(revision.responses["201"]);
  assert.equal(revision.responses["200"], undefined);
  assert.ok(revision.responses["412"]);
  assert.ok(revision.responses["428"]);

  const approval = paths[
    "/api/v1/acquisition/plans/{id}/approval"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    approval.requestBody.content["application/json"].schema.required,
    ["decision", "reason"]
  );
  assert.ok(approval.responses["412"]);
  assert.ok(approval.responses["428"]);

  const run = paths[
    "/api/v1/acquisition/plans/{id}/runs"
  ]!.post as Record<string, any>;
  assert.equal(run.requestBody.required, false);
  assert.equal(
    run.requestBody.content["application/json"].schema.required,
    undefined
  );
  assert.deepEqual(
    run.parameters.map(
      (parameter: { name: string }) => parameter.name
    ),
    ["id", "Idempotency-Key"]
  );
  assert.equal(run.parameters[1].schema.minLength, 8);
  assert.ok(run.responses["202"]);
  assert.equal(run.responses["200"], undefined);

  const create = paths[
    "/api/v1/acquisition/plans"
  ]!.post as Record<string, any>;
  assert.ok(create.responses["201"]);
  assert.equal(create.responses["200"], undefined);

  for (const action of ["pause", "resume", "cancel"]) {
    const control = paths[
      `/api/v1/acquisition/runs/{id}/${action}`
    ]!.post as Record<string, any>;
    assert.deepEqual(
      control.requestBody.content["application/json"].schema.required,
      ["reason"]
    );
    assert.deepEqual(
      control.parameters.map(
        (parameter: { name: string }) => parameter.name
      ),
      ["id", "If-Match"]
    );
    assert.equal(control.parameters[1].schema.minLength, 1);
    assert.ok(control.responses["412"]);
    assert.ok(control.responses["428"]);
  }
});

test("list operations publish the query parameters accepted by runtime", () => {
  const paths = createAcquisitionOpenApiPaths();
  const names = (path: string) => (
    (paths[path]!.get as Record<string, any>).parameters ?? []
  ).map((parameter: { name: string }) => parameter.name).sort();

  assert.deepEqual(
    names("/api/v1/acquisition/candidates"),
    ["cursor", "limit", "status", "subjectKind"]
  );
  assert.deepEqual(
    names("/api/v1/acquisition/candidates/{id}/evidence"),
    ["cursor", "id", "limit"]
  );
  assert.deepEqual(
    names("/api/v1/acquisition/candidates/{id}/reviews"),
    ["cursor", "id", "limit"]
  );
  assert.deepEqual(
    names("/api/v1/acquisition/copilot/sessions/{id}/messages"),
    ["cursor", "id", "limit"]
  );
  assert.deepEqual(
    names("/api/v1/acquisition/outcomes"),
    ["candidateId", "cursor", "limit"]
  );
  assert.deepEqual(
    names("/api/v1/acquisition/audit-events"),
    ["candidateId", "cursor", "limit"]
  );

  const outcomes = paths[
    "/api/v1/acquisition/outcomes"
  ]!.get as Record<string, any>;
  const outcomeCandidate = outcomes.parameters.find(
    (parameter: { name: string }) => parameter.name === "candidateId"
  );
  assert.equal(outcomeCandidate.required, true);
  const audit = paths[
    "/api/v1/acquisition/audit-events"
  ]!.get as Record<string, any>;
  const auditCandidate = audit.parameters.find(
    (parameter: { name: string }) => parameter.name === "candidateId"
  );
  assert.equal(auditCandidate.required, false);
});

test("BYOK credentials are write-only and never appear in response schemas", () => {
  const paths = createAcquisitionOpenApiPaths();
  const create = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.post as Record<string, any>;
  const apiKey = create.requestBody.content["application/json"]
    .schema.properties.apiKey;
  assert.equal(apiKey.writeOnly, true);
  assert.equal(apiKey.type, "string");

  const serializedResponses = JSON.stringify({
    list: (paths[
      "/api/v1/acquisition/provider-connections"
    ]!.get as Record<string, any>).responses,
    patch: paths[
      "/api/v1/acquisition/provider-connections/{id}"
    ]!.patch
      ? (paths[
          "/api/v1/acquisition/provider-connections/{id}"
        ]!.patch as Record<string, any>).responses
      : null,
    test: paths[
      "/api/v1/acquisition/provider-connections/{id}/test"
    ]!.post
      ? (paths[
          "/api/v1/acquisition/provider-connections/{id}/test"
        ]!.post as Record<string, any>).responses
      : null
  });
  assert.doesNotMatch(serializedResponses, /apiKey/u);
  assert.doesNotMatch(serializedResponses, /configurationEncrypted/u);
  assert.doesNotMatch(serializedResponses, /credentialRef/u);
});

test("authorized imports use bounded raw media types rather than base64 JSON", () => {
  const paths = createAcquisitionOpenApiPaths();
  const operation = paths[
    "/api/v1/acquisition/import-operations"
  ]!.post as Record<string, any>;
  assert.deepEqual(
    Object.keys(operation.requestBody.content).sort(),
    [
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv"
    ]
  );
  assert.equal(
    operation.requestBody.content["text/csv"].schema.format,
    "binary"
  );
  assert.equal(operation.requestBody.required, true);
  assert.ok(
    operation.parameters.some(
      (parameter: { name?: string }) => parameter.name === "mapping"
    )
  );
  assert.equal(
    operation.parameters.some(
      (parameter: { name?: string }) =>
        parameter.name === "columnMapping"
    ),
    false
  );
});

test("provider connection response and deletion contracts match the runtime", () => {
  const paths = createAcquisitionOpenApiPaths();
  const providers = paths[
    "/api/v1/acquisition/providers"
  ]!.get as Record<string, any>;
  const providerItem = providers.responses["200"]
    .content["application/json"].schema.properties.items.items;
  assert.ok(providerItem.properties.officialDocsUrl);
  assert.ok(providerItem.properties.defaultBaseUrl);
  assert.ok(providerItem.properties.requiresKey);
  assert.ok(providerItem.properties.keyHint);

  const created = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.post as Record<string, any>;
  const createSchema = created.responses["201"]
    .content["application/json"].schema;
  assert.ok(createSchema.properties.id);
  assert.equal(createSchema.properties.item, undefined);
  assert.equal(
    created.requestBody.content["application/json"]
      .schema.properties.status.default,
    "active"
  );
  assert.ok(created.responses["200"]);
  assert.equal(
    created.responses["200"].headers[
      "Idempotency-Replayed"
    ].schema.enum[0],
    "true"
  );

  const connectionList = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.get as Record<string, any>;
  const connectionListSchema = connectionList.responses["200"]
    .content["application/json"].schema;
  assert.deepEqual(
    connectionListSchema.required,
    ["items", "nextCursor"]
  );
  assert.equal(
    connectionListSchema.properties.nextCursor.nullable,
    true
  );

  const deleted = paths[
    "/api/v1/acquisition/provider-connections/{id}"
  ]!.delete as Record<string, any>;
  assert.ok(deleted.responses["204"]);
  assert.equal(deleted.responses["200"], undefined);
});

test("provider and discovery inputs mirror runtime validation", () => {
  const paths = createAcquisitionOpenApiPaths();
  const provider = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.post as Record<string, any>;
  assert.equal(provider.parameters[0].schema.minLength, 1);
  const providerSchema =
    provider.requestBody.content["application/json"].schema;
  assert.equal(providerSchema.properties.providerId.maxLength, 64);
  assert.equal(
    providerSchema.properties.providerId.pattern,
    "^[a-z0-9_]+$"
  );
  assert.equal(providerSchema.properties.apiKey.maxLength, 4_000);
  assert.equal(providerSchema.properties.baseUrl.maxLength, 2_000);

  const patch = paths[
    "/api/v1/acquisition/provider-connections/{id}"
  ]!.patch as Record<string, any>;
  const patchSchema =
    patch.requestBody.content["application/json"].schema;
  assert.equal(patchSchema.oneOf.length, 2);
  assert.equal(
    patchSchema.oneOf.some(
      (variant: Record<string, any>) =>
        variant.required.includes("apiKey")
        && "baseUrl" in variant.properties
    ),
    true
  );
  for (const variant of patchSchema.oneOf) {
    if (variant.properties.status) {
      assert.equal(variant.properties.status.default, undefined);
    }
  }
  assert.equal(
    patchSchema.oneOf.some(
      (variant: Record<string, any>) =>
        variant.required.length === 1
        && variant.required[0] === "status"
        && Object.keys(variant.properties).length === 1
    ),
    true
  );

  const fetch = paths[
    "/api/v1/acquisition/content-fetch-operations"
  ]!.post as Record<string, any>;
  assert.equal(fetch.parameters[0].schema.minLength, 1);
  const sourceUrl = fetch.requestBody.content["application/json"]
    .schema.properties.sourceUrl;
  assert.equal(sourceUrl.maxLength, 4_096);
  assert.equal(sourceUrl.format, "uri");
  assert.equal(sourceUrl.pattern, "^[Hh][Tt][Tt][Pp][Ss]://");

  const importOperation = paths[
    "/api/v1/acquisition/import-operations"
  ]!.post as Record<string, any>;
  assert.equal(importOperation.parameters[0].schema.minLength, 1);
  for (const path of [
    "/api/v1/acquisition/content-fetch-operations",
    "/api/v1/acquisition/import-operations"
  ]) {
    const list = paths[path]!.get as Record<string, any>;
    assert.deepEqual(
      list.parameters.map(
        (parameter: { name: string }) => parameter.name
      ),
      ["limit"]
    );
  }
  for (const path of [
    "/api/v1/acquisition/content-fetch-operations/{id}",
    "/api/v1/acquisition/import-operations/{id}"
  ]) {
    const detail = paths[path]!.get as Record<string, any>;
    assert.equal(detail.parameters[0].schema.maxLength, 160);
  }
});

test("error responses describe both runtime envelopes used by acquisition routers", () => {
  const paths = createAcquisitionOpenApiPaths();
  const operation = paths[
    "/api/v1/acquisition/provider-connections"
  ]!.post as Record<string, any>;
  const schema = operation.responses["400"]
    .content["application/json"].schema;

  assert.equal(schema.oneOf.length, 2);
  assert.ok(
    schema.oneOf.some((variant: Record<string, any>) =>
      variant.required?.includes("code")
      && variant.required?.includes("retryable")
    )
  );
  assert.ok(
    schema.oneOf.some((variant: Record<string, any>) =>
      variant.required?.includes("error")
    )
  );
});

test("acquisition schemas are converted to valid OpenAPI 3.0 without weakening constraints", () => {
  const paths = createAcquisitionOpenApiPaths();
  assert.deepEqual(
    unsupportedOpenApi30SchemaLocations(paths),
    []
  );

  const evidenceSchema = (paths[
    "/api/v1/acquisition/evidence/{id}"
  ]!.get as Record<string, any>).responses["200"]
    .content["application/json"].schema;
  assert.equal(evidenceSchema.properties.publishedAt.type, "string");
  assert.equal(evidenceSchema.properties.publishedAt.nullable, true);
  assert.deepEqual(
    evidenceSchema.properties.provenance.oneOf[0]
      .properties.kind.enum,
    ["search_result"]
  );

  const battleCardSchema = (paths[
    "/api/v1/acquisition/candidates/{id}/battle-card"
  ]!.get as Record<string, any>).responses["200"]
    .content["application/json"].schema.oneOf[0];
  assert.deepEqual(
    battleCardSchema.properties.schemaVersion.enum,
    ["battle-card.v1"]
  );
  const sectionSchema = battleCardSchema.properties.sections.items;
  const validateSection = new Ajv({ strict: false }).compile(sectionSchema);
  assert.equal(validateSection({
    label: "公开事实",
    kind: "fact",
    content: "来自公开证据"
  }), true);
  assert.equal(validateSection({
    label: "推断",
    kind: "inference",
    content: "需要证据"
  }), false);
  assert.equal(validateSection({
    label: "推断",
    kind: "inference",
    content: "有证据支持",
    evidenceIds: ["evidence-1"],
    confidence: 0.8
  }), true);
});

test("the complete production document validates in its declared OpenAPI dialect", async () => {
  const document = createOpenApiDocument(express());
  assert.equal(document.openapi, "3.0.3");
  await assert.doesNotReject(() => SwaggerParser.validate(
    structuredClone(document) as never
  ));
});

test("the main Swagger document includes runtime-bridged acquisition routes", () => {
  const document = createOpenApiDocument(express()) as {
    paths: Record<string, Record<string, unknown>>;
    tags: Array<{ name: string }>;
  };
  assert.ok(document.paths["/api/v1/acquisition/providers"]);
  assert.ok(document.paths["/api/v1/acquisition/plans"]);
  assert.ok(
    document.tags.some((tag) => tag.name === "AI 获客智能体")
  );
});

test("the main Swagger document replaces generic acquisition routes", () => {
  const app = express();
  const handler = (_req: unknown, _res: unknown) => undefined;
  app.post("/api/v1/acquisition/evidence", handler);
  app.post("/api/v1/acquisition/candidates", handler);
  app.post(
    "/api/v1/acquisition/candidates/:id/qualification",
    handler
  );
  app.get(
    "/api/v1/acquisition/candidates/:id/qualification",
    handler
  );

  const document = createOpenApiDocument(app) as {
    paths: Record<string, Record<string, unknown>>;
  };
  assert.equal(
    document.paths["/api/v1/acquisition/evidence"],
    undefined
  );
  assert.equal(
    document.paths["/api/v1/acquisition/candidates"].post,
    undefined
  );
  assert.equal(
    document.paths[
      "/api/v1/acquisition/candidates/{id}/qualification"
    ].post,
    undefined
  );
  assert.ok(
    document.paths[
      "/api/v1/acquisition/candidates/{id}/qualification"
    ].get
  );
  assert.doesNotThrow(() =>
    JSON.parse(JSON.stringify(document))
  );
});
