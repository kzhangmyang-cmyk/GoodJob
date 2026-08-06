import { readFileSync } from "node:fs";

type AcquisitionHttpMethod =
  | "get"
  | "post"
  | "patch"
  | "delete";

export type AcquisitionOpenApiPaths = Record<
  string,
  Partial<Record<AcquisitionHttpMethod, Record<string, unknown>>>
>;

const unsupportedJsonSchema202012Keywords = new Set([
  "$anchor",
  "$dynamicAnchor",
  "$dynamicRef",
  "$vocabulary",
  "contains",
  "contentEncoding",
  "contentMediaType",
  "dependentRequired",
  "dependentSchemas",
  "maxContains",
  "minContains",
  "prefixItems",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties"
]);

function openApi30NullOnlySchema() {
  return {
    type: "string",
    nullable: true,
    enum: [null]
  };
}

/**
 * Converts the JSON Schema 2020-12 subset used by acquisition contracts to
 * an equivalent OpenAPI 3.0 Schema Object. Unknown 2020-12-only keywords are
 * rejected so a future contract cannot silently lose validation semantics.
 */
export function convertJsonSchema202012ToOpenApi30(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    throw new TypeError("Expected a JSON Schema object, received an array");
  }

  for (const keyword of unsupportedJsonSchema202012Keywords) {
    if (Object.hasOwn(value, keyword)) {
      throw new TypeError(
        `Cannot safely represent JSON Schema keyword in OpenAPI 3.0: ${keyword}`
      );
    }
  }
  if (typeof value.$ref === "string" && value.$ref.includes("/$defs/")) {
    throw new TypeError(
      `JSON Schema $defs reference must be dereferenced before OpenAPI 3.0 conversion: ${value.$ref}`
    );
  }

  const converted: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if ([
      "$schema",
      "$id",
      "$defs",
      "if",
      "then",
      "else",
      "const",
      "type"
    ].includes(key)) {
      continue;
    }
    if (key === "properties" || key === "patternProperties") {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new TypeError(`JSON Schema ${key} must be an object`);
      }
      converted[key] = Object.fromEntries(
        Object.entries(item).map(([name, propertySchema]) => [
          name,
          convertJsonSchema202012ToOpenApi30(propertySchema)
        ])
      );
    } else if (["allOf", "anyOf", "oneOf"].includes(key)) {
      if (!Array.isArray(item)) {
        throw new TypeError(`JSON Schema ${key} must be an array`);
      }
      converted[key] = item.map(convertJsonSchema202012ToOpenApi30);
    } else if (key === "items") {
      if (Array.isArray(item)) {
        throw new TypeError(
          "JSON Schema tuple items cannot be represented safely in OpenAPI 3.0"
        );
      }
      converted[key] = convertJsonSchema202012ToOpenApi30(item);
    } else if (key === "additionalProperties" || key === "not") {
      converted[key] = typeof item === "boolean"
        ? item
        : convertJsonSchema202012ToOpenApi30(item);
    } else {
      converted[key] = structuredClone(item);
    }
  }

  if (Object.hasOwn(value, "type")) {
    const sourceTypes = Array.isArray(value.type)
      ? [...new Set(value.type)]
      : [value.type];
    if (!sourceTypes.every((type) => typeof type === "string")) {
      throw new TypeError("JSON Schema type must be a string or string array");
    }
    const allowsNull = sourceTypes.includes("null");
    const nonNullTypes = sourceTypes.filter((type) => type !== "null");
    if (nonNullTypes.length === 0) {
      Object.assign(converted, openApi30NullOnlySchema());
    } else if (nonNullTypes.length === 1) {
      converted.type = nonNullTypes[0];
      if (allowsNull) converted.nullable = true;
    } else {
      converted.oneOf = [
        ...(converted.oneOf ?? []),
        ...nonNullTypes.map((type, index) => ({
          type,
          ...(allowsNull && index === 0 ? { nullable: true } : {})
        }))
      ];
    }
  }

  if (Object.hasOwn(value, "const")) {
    const constant = structuredClone(value.const);
    if (Array.isArray(converted.enum)) {
      converted.enum = converted.enum.filter((item: unknown) =>
        Object.is(item, constant));
      if (converted.enum.length === 0) {
        converted.not = {};
      }
    } else {
      converted.enum = [constant];
    }
    if (constant === null && converted.type === undefined) {
      Object.assign(converted, openApi30NullOnlySchema(), {
        ...converted,
        enum: [null]
      });
    }
  }

  const hasIf = Object.hasOwn(value, "if");
  const hasThen = Object.hasOwn(value, "then");
  const hasElse = Object.hasOwn(value, "else");
  if ((hasThen || hasElse) && !hasIf) {
    throw new TypeError(
      "JSON Schema then/else requires if before OpenAPI 3.0 conversion"
    );
  }
  if (hasIf && (hasThen || hasElse)) {
    const condition = convertJsonSchema202012ToOpenApi30(value.if);
    const thenSchema = hasThen
      ? convertJsonSchema202012ToOpenApi30(value.then)
      : {};
    const elseSchema = hasElse
      ? convertJsonSchema202012ToOpenApi30(value.else)
      : {};
    const implication = hasElse
      ? {
          oneOf: [
            { allOf: [condition, thenSchema] },
            { allOf: [{ not: condition }, elseSchema] }
          ]
        }
      : {
          anyOf: [
            { not: condition },
            { allOf: [condition, thenSchema] }
          ]
        };
    converted.allOf = [
      ...(Array.isArray(converted.allOf) ? converted.allOf : []),
      implication
    ];
  }

  return converted;
}

function convertEmbeddedSchemasToOpenApi30(value: any): any {
  if (Array.isArray(value)) {
    return value.map(convertEmbeddedSchemasToOpenApi30);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === "schema"
      ? convertJsonSchema202012ToOpenApi30(item)
      : convertEmbeddedSchemasToOpenApi30(item)
  ]));
}

const readSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];
const writeSecurity = [
  { bearerAuth: [] },
  { cookieAuth: [], csrfToken: [] }
];

const errorSchema = {
  oneOf: [
    {
      type: "object",
      required: [
        "code",
        "message",
        "details",
        "requestId",
        "retryable"
      ],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { nullable: true },
        requestId: { type: "string" },
        retryable: { type: "boolean" }
      },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: { nullable: true },
            requestId: { type: "string" }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  ]
};

const resourceSchema = {
  type: "object",
  additionalProperties: true
};

function dereferenceContractSchema(
  value: any,
  root: Record<string, any>,
  baseUrl: URL
): any {
  if (Array.isArray(value)) {
    return value.map((item) =>
      dereferenceContractSchema(item, root, baseUrl));
  }
  if (!value || typeof value !== "object") return value;
  if (typeof value.$ref === "string") {
    const reference = value.$ref as string;
    if (reference.startsWith("#/")) {
      const target = reference.slice(2).split("/").reduce(
        (current: any, part) => current[
          part.replace(/~1/gu, "/").replace(/~0/gu, "~")
        ],
        root
      );
      return dereferenceContractSchema(target, root, baseUrl);
    }
    const targetUrl = new URL(reference, baseUrl);
    const targetRoot = JSON.parse(
      readFileSync(targetUrl, "utf8")
    ) as Record<string, any>;
    return dereferenceContractSchema(targetRoot, targetRoot, targetUrl);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    dereferenceContractSchema(item, root, baseUrl)
  ]));
}

function loadContractSchema(name: string): Record<string, any> {
  const filename = name === "battle-card.v2"
    ? "battle-card.v2.schema.json"
    : `${name}.v1.schema.json`;
  const schemaUrl = new URL(
    `../../contracts/json-schema/${filename}`,
    import.meta.url
  );
  const root = JSON.parse(
    readFileSync(schemaUrl, "utf8")
  ) as Record<string, any>;
  return dereferenceContractSchema(root, root, schemaUrl);
}

const asyncOperationResponseSchema = loadContractSchema("async-operation");
const discoveryEvidenceResponseSchema = loadContractSchema(
  "discovery-evidence"
);
const organizationCandidateResponseSchema = loadContractSchema(
  "organization-candidate"
);
const individualCandidateResponseSchema = loadContractSchema(
  "individual-demand-signal"
);
const candidateResponseSchema = {
  oneOf: [
    organizationCandidateResponseSchema,
    individualCandidateResponseSchema
  ]
};
const qualificationDecisionResponseSchema = loadContractSchema(
  "qualification-decision"
);
const financialValueDecisionResponseSchema = loadContractSchema(
  "financial-value-decision"
);
const battleCardResponseSchema = {
  oneOf: [
    loadContractSchema("battle-card"),
    loadContractSchema("battle-card.v2")
  ]
};
const reviewEventResponseSchema = loadContractSchema("review-event");
const outcomeFeedbackResponseSchema = loadContractSchema("outcome-feedback");
const partyRefResponseSchema = loadContractSchema("party-ref");
const copilotSessionResponseSchema = loadContractSchema("copilot-session");
const copilotMessageResponseSchema = loadContractSchema("copilot-message");
const copilotTaskResponseSchema = loadContractSchema("copilot-task");

function typedPagedResponseSchema(itemSchema: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: itemSchema },
      nextCursor: { type: ["string", "null"] }
    }
  };
}

const candidatePagedResponseSchema = typedPagedResponseSchema(
  candidateResponseSchema
);
const evidencePagedResponseSchema = typedPagedResponseSchema(
  discoveryEvidenceResponseSchema
);
const reviewPagedResponseSchema = typedPagedResponseSchema(
  reviewEventResponseSchema
);
const outcomePagedResponseSchema = typedPagedResponseSchema(
  outcomeFeedbackResponseSchema
);
const copilotMessagePagedResponseSchema = typedPagedResponseSchema(
  copilotMessageResponseSchema
);

const identityResolutionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "basis",
    "resolverVersion",
    "evidenceIds",
    "resolvedAt",
    "resolvedBy"
  ],
  properties: {
    status: { const: "resolved" },
    basis: {
      enum: [
        "organization_domain",
        "organization_credit_code",
        "provider_public_actor"
      ]
    },
    resolverVersion: { type: "string", minLength: 1 },
    evidenceIds: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    resolvedAt: { type: "string", format: "date-time" },
    resolvedBy: { type: "string", minLength: 1 }
  }
};

const identityConfirmationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidate", "resolution"],
  properties: {
    candidate: candidateResponseSchema,
    resolution: identityResolutionResponseSchema
  }
};

const researchAttemptResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "candidateId",
    "requestReason",
    "budgetVersion",
    "status",
    "newEvidenceIds",
    "terminationReason",
    "createdAt",
    "startedAt",
    "completedAt"
  ],
  properties: {
    id: { type: "string" },
    candidateId: { type: "string" },
    requestReason: { type: "string" },
    budgetVersion: { type: "string" },
    status: {
      enum: [
        "pending",
        "running",
        "completed",
        "no_new_evidence",
        "access_restricted",
        "failed"
      ]
    },
    newEvidenceIds: {
      type: "array",
      items: { type: "string" }
    },
    terminationReason: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    startedAt: { type: ["string", "null"], format: "date-time" },
    completedAt: { type: ["string", "null"], format: "date-time" }
  }
};

const reviewResultResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidate", "review", "research"],
  properties: {
    candidate: candidateResponseSchema,
    review: reviewEventResponseSchema,
    research: {
      oneOf: [researchAttemptResponseSchema, { type: "null" }]
    }
  }
};

const leadConversionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "candidateId",
    "decisionVersion",
    "partyRef",
    "leadId",
    "reviewerId",
    "evidenceSnapshotHash",
    "createdAt"
  ],
  properties: {
    id: { type: "string" },
    candidateId: { type: "string" },
    decisionVersion: { type: "string" },
    partyRef: partyRefResponseSchema,
    leadId: { type: "string" },
    reviewerId: { type: "string" },
    evidenceSnapshotHash: { type: "string" },
    createdAt: { type: "string", format: "date-time" }
  }
};

const candidateStatuses = [
  "discovered",
  "unresolvable",
  "normalized",
  "qualified",
  "pending_review",
  "approved",
  "rejected",
  "do_not_contact",
  "needs_research",
  "converted_to_lead"
];

const auditEventResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "candidateId",
    "actorId",
    "eventType",
    "fromStatus",
    "toStatus",
    "resourceId",
    "createdAt"
  ],
  properties: {
    id: { type: "string" },
    candidateId: { type: ["string", "null"] },
    actorId: { type: "string" },
    eventType: { type: "string" },
    fromStatus: { enum: [...candidateStatuses, null] },
    toStatus: { enum: [...candidateStatuses, null] },
    resourceId: { type: "string" },
    createdAt: { type: "string", format: "date-time" }
  }
};
const auditPagedResponseSchema = typedPagedResponseSchema(
  auditEventResponseSchema
);

const acquisitionPlanResponseSchema = loadContractSchema(
  "acquisition-plan"
);

const acquisitionRunResponseSchema = loadContractSchema(
  "acquisition-run"
);

const pagedResultResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array", items: { type: "object" } },
    nextCursor: { type: ["string", "null"] }
  }
};

const providerConnectionSchema = loadContractSchema(
  "provider-connection"
);

const contentFetchOperationResponseSchema = loadContractSchema(
  "content-fetch-operation"
);

const importOperationResponseSchema = loadContractSchema(
  "import-operation"
);

const providerConnectionHealthSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ok",
    "message",
    "errorCode",
    "retryable",
    "retryAfterAt",
    "usage"
  ],
  properties: {
    ok: { type: "boolean" },
    message: { type: "string", minLength: 1, maxLength: 2_000 },
    errorCode: {
      type: ["string", "null"],
      maxLength: 120
    },
    retryable: { type: "boolean" },
    retryAfterAt: {
      type: ["string", "null"],
      format: "date-time"
    },
    usage: { type: "string", maxLength: 2_000 }
  }
};

const acquisitionProviderSchema = {
  type: "object",
  required: ["id", "kind", "displayName", "capabilities"],
  properties: {
    id: { type: "string" },
    kind: {
      type: "string",
      enum: ["search", "content_fetch", "import"]
    },
    displayName: { type: "string" },
    officialDocsUrl: {
      type: "string",
      format: "uri"
    },
    defaultBaseUrl: {
      type: "string",
      format: "uri"
    },
    requiresKey: { type: "boolean" },
    keyHint: { type: "string" },
    costNote: { type: "string" },
    capabilities: {
      type: "array",
      items: { type: "string" }
    }
  },
  additionalProperties: false
};

function response(
  description: string,
  schema: Record<string, unknown> = resourceSchema
) {
  return {
    description,
    content: {
      "application/json": { schema }
    }
  };
}

function standardResponses(
  successStatus: number = 200,
  successDescription: string = "操作成功",
  successSchema: Record<string, unknown> = resourceSchema
) {
  return {
    [String(successStatus)]: response(
      successDescription,
      successSchema
    ),
    "400": response("请求参数无效", errorSchema),
    "401": response("需要登录", errorSchema),
    "404": response("资源不存在或不在当前租户范围", errorSchema),
    "409": response("版本、状态或幂等键冲突", errorSchema),
    "500": response("服务端无法完成请求", errorSchema)
  };
}

function idParameter(maxLength = 255) {
  return {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1, maxLength }
  };
}

function idempotencyParameter(minLength: 1 | 8 = 8) {
  return {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    description: "租户作用域内的写入幂等键；原文不会持久化。",
    schema: {
      type: "string",
      minLength,
      maxLength: 200
    }
  };
}

function ifMatchParameter(
  schema: Record<string, unknown> = {
    type: "string",
    minLength: 1
  }
) {
  return {
    name: "If-Match",
    in: "header",
    required: true,
    schema
  };
}

function jsonBody(
  schema: Record<string, unknown>,
  required = true
) {
  return {
    required,
    content: {
      "application/json": { schema }
    }
  };
}

function paginationParameters() {
  return [
    {
      name: "cursor",
      in: "query",
      required: false,
      schema: {
        type: "string",
        minLength: 1,
        maxLength: 8_192
      }
    },
    {
      name: "limit",
      in: "query",
      required: false,
      schema: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 50
      }
    }
  ];
}

function boundedLimitParameter() {
  return {
    name: "limit",
    in: "query",
    required: false,
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 100
    }
  };
}

function operation(
  method: AcquisitionHttpMethod,
  summary: string,
  options: {
    parameters?: Array<Record<string, unknown>>;
    requestBody?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    description?: string;
  } = {}
) {
  return {
    tags: ["AI 获客智能体"],
    summary,
    ...(options.description
      ? { description: options.description }
      : {}),
    security: method === "get" ? readSecurity : writeSecurity,
    ...(options.parameters
      ? { parameters: options.parameters }
      : {}),
    ...(options.requestBody
      ? { requestBody: options.requestBody }
      : {}),
    responses: options.responses ?? standardResponses()
  };
}

function add(
  paths: AcquisitionOpenApiPaths,
  path: string,
  method: AcquisitionHttpMethod,
  value: Record<string, unknown>
) {
  paths[path] ||= {};
  paths[path]![method] = value;
}

const acquisitionOperationIds: Record<string, string> = {
  "get /api/v1/acquisition/providers": "listAcquisitionProviders",
  "get /api/v1/acquisition/provider-connections":
    "listAcquisitionProviderConnections",
  "post /api/v1/acquisition/provider-connections":
    "createAcquisitionProviderConnection",
  "get /api/v1/acquisition/provider-connections/{id}":
    "getAcquisitionProviderConnection",
  "patch /api/v1/acquisition/provider-connections/{id}":
    "updateAcquisitionProviderConnection",
  "delete /api/v1/acquisition/provider-connections/{id}":
    "deleteAcquisitionProviderConnection",
  "post /api/v1/acquisition/provider-connections/{id}/test":
    "testAcquisitionProviderConnection",
  "get /api/v1/acquisition/content-fetch-operations":
    "listAcquisitionContentFetchOperations",
  "post /api/v1/acquisition/content-fetch-operations":
    "createAcquisitionContentFetchOperation",
  "get /api/v1/acquisition/content-fetch-operations/{id}":
    "getAcquisitionContentFetchOperation",
  "get /api/v1/acquisition/import-operations":
    "listAcquisitionImportOperations",
  "post /api/v1/acquisition/import-operations":
    "createAcquisitionImportOperation",
  "get /api/v1/acquisition/import-operations/{id}":
    "getAcquisitionImportOperation",
  "get /api/v1/acquisition/evidence/{id}": "getAcquisitionEvidence",
  "get /api/v1/acquisition/candidates": "listAcquisitionCandidates",
  "get /api/v1/acquisition/candidates/{id}": "getAcquisitionCandidate",
  "get /api/v1/acquisition/candidates/{id}/evidence":
    "listAcquisitionCandidateEvidence",
  "post /api/v1/acquisition/candidates/{id}/identity-confirmation":
    "confirmAcquisitionCandidateIdentity",
  "get /api/v1/acquisition/candidates/{id}/qualification":
    "getAcquisitionCandidateQualification",
  "get /api/v1/acquisition/candidates/{id}/financial-value":
    "getAcquisitionCandidateFinancialValue",
  "get /api/v1/acquisition/candidates/{id}/battle-card":
    "getAcquisitionCandidateBattleCard",
  "get /api/v1/acquisition/candidates/{id}/reviews":
    "listAcquisitionCandidateReviews",
  "post /api/v1/acquisition/candidates/{id}/review":
    "reviewAcquisitionCandidate",
  "post /api/v1/acquisition/candidates/{id}/convert":
    "convertAcquisitionCandidate",
  "get /api/v1/acquisition/outcomes": "listAcquisitionOutcomes",
  "get /api/v1/acquisition/audit-events": "listAcquisitionAuditEvents",
  "post /api/v1/acquisition/copilot/sessions":
    "createAcquisitionCopilotSession",
  "get /api/v1/acquisition/copilot/sessions/{id}":
    "getAcquisitionCopilotSession",
  "get /api/v1/acquisition/copilot/sessions/{id}/messages":
    "listAcquisitionCopilotMessages",
  "post /api/v1/acquisition/copilot/sessions/{id}/messages":
    "sendAcquisitionCopilotMessage",
  "get /api/v1/acquisition/copilot/tasks/{id}":
    "getAcquisitionCopilotTask",
  "post /api/v1/acquisition/plans": "createAcquisitionPlan",
  "get /api/v1/acquisition/plans/{id}": "getAcquisitionPlan",
  "patch /api/v1/acquisition/plans/{id}": "updateAcquisitionPlan",
  "post /api/v1/acquisition/plans/{id}/revisions":
    "createAcquisitionPlanRevision",
  "post /api/v1/acquisition/plans/{id}/approval":
    "approveAcquisitionPlan",
  "post /api/v1/acquisition/plans/{id}/runs": "createAcquisitionRun",
  "get /api/v1/acquisition/runs/{id}": "getAcquisitionRun",
  "get /api/v1/acquisition/runs/{id}/shards":
    "listAcquisitionRunShards",
  "get /api/v1/acquisition/runs/{id}/presentation":
    "getAcquisitionRunPresentation",
  "post /api/v1/acquisition/runs/{id}/pause": "pauseAcquisitionRun",
  "post /api/v1/acquisition/runs/{id}/resume": "resumeAcquisitionRun",
  "post /api/v1/acquisition/runs/{id}/cancel": "cancelAcquisitionRun"
};

function addAcquisitionOperationIds(paths: AcquisitionOpenApiPaths) {
  const unused = new Set(Object.keys(acquisitionOperationIds));
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["get", "post", "patch", "delete"] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      const key = `${method} ${path}`;
      const operationId = acquisitionOperationIds[key];
      if (!operationId) {
        throw new Error(`Missing acquisition operationId: ${key}`);
      }
      operation.operationId = operationId;
      unused.delete(key);
    }
  }
  if (unused.size > 0) {
    throw new Error(
      `Unused acquisition operationId mappings: ${[...unused].join(", ")}`
    );
  }
}

const providerConnectionStatusSchema = {
  type: "string",
  enum: ["active", "disabled"]
};

const providerConnectionWriteSchema = {
  type: "object",
  required: ["providerId", "apiKey"],
  properties: {
    providerId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9_]+$"
    },
    apiKey: {
      type: "string",
      minLength: 1,
      maxLength: 4_000,
      writeOnly: true,
      description: "客户自己的官方 API Key，仅加密保存且永不回显。"
    },
    baseUrl: {
      type: "string",
      format: "uri",
      maxLength: 2_000
    },
    status: {
      ...providerConnectionStatusSchema,
      default: "active"
    }
  },
  additionalProperties: false
};

function addProviderPaths(paths: AcquisitionOpenApiPaths) {
  add(paths, "/api/v1/acquisition/providers", "get", operation(
    "get",
    "列出中国及国际官方搜索服务商和系统数据源",
    {
      responses: standardResponses(200, "数据源目录", {
        type: "object",
        required: ["items", "nextCursor"],
        properties: {
          items: {
            type: "array",
            items: acquisitionProviderSchema
          },
          nextCursor: {
            type: "string",
            nullable: true
          }
        },
        additionalProperties: false
      })
    }
  ));
  add(
    paths,
    "/api/v1/acquisition/provider-connections",
    "get",
    operation("get", "列出当前账号的 BYOK 搜索连接", {
      responses: standardResponses(200, "连接列表", {
        type: "object",
        required: ["items", "nextCursor"],
        properties: {
          items: {
            type: "array",
            items: providerConnectionSchema
          },
          nextCursor: {
            type: "string",
            nullable: true
          }
        },
        additionalProperties: false
      })
    })
  );
  add(
    paths,
    "/api/v1/acquisition/provider-connections",
    "post",
    operation("post", "创建官方搜索 API 直连", {
      parameters: [idempotencyParameter(1)],
      requestBody: jsonBody(providerConnectionWriteSchema),
      responses: {
        ...standardResponses(
          201,
          "连接已创建",
          providerConnectionSchema
        ),
        "200": {
          ...response(
            "幂等重放已有连接",
            providerConnectionSchema
          ),
          headers: {
            "Idempotency-Replayed": {
              description: "值为 true 表示返回的是同一幂等请求的结果。",
              schema: {
                type: "string",
                enum: ["true"]
              }
            }
          }
        }
      }
    })
  );
  add(
    paths,
    "/api/v1/acquisition/provider-connections/{id}",
    "get",
    operation("get", "读取安全投影后的搜索连接", {
      parameters: [idParameter()],
      responses: standardResponses(
        200,
        "连接详情",
        providerConnectionSchema
      )
    })
  );
  const patchSchema = {
    oneOf: [
      {
        type: "object",
        required: ["apiKey"],
        properties: {
          apiKey: providerConnectionWriteSchema.properties.apiKey,
          baseUrl: providerConnectionWriteSchema.properties.baseUrl,
          status: providerConnectionStatusSchema
        },
        additionalProperties: false
      },
      {
        type: "object",
        required: ["status"],
        properties: {
          status: providerConnectionStatusSchema
        },
        additionalProperties: false
      }
    ]
  };
  add(
    paths,
    "/api/v1/acquisition/provider-connections/{id}",
    "patch",
    operation("patch", "轮换密钥、官方端点或连接状态", {
      parameters: [idParameter()],
      requestBody: jsonBody(patchSchema),
      responses: standardResponses(
        200,
        "连接已更新",
        providerConnectionSchema
      )
    })
  );
  add(
    paths,
    "/api/v1/acquisition/provider-connections/{id}",
    "delete",
    operation("delete", "删除当前账号的搜索连接", {
      parameters: [idParameter()],
      responses: {
        "204": { description: "连接已删除" },
        "400": response("请求参数无效", errorSchema),
        "401": response("需要登录", errorSchema),
        "403": response("系统连接只读", errorSchema),
        "404": response("连接不存在", errorSchema),
        "500": response("服务端无法完成请求", errorSchema)
      }
    })
  );
  add(
    paths,
    "/api/v1/acquisition/provider-connections/{id}/test",
    "post",
    operation("post", "执行受控健康检查", {
      parameters: [idParameter()],
      responses: standardResponses(
        200,
        "健康检查结果",
        providerConnectionHealthSchema
      )
    })
  );
}

function addDiscoveryOperationPaths(paths: AcquisitionOpenApiPaths) {
  const contentFetchListSchema = {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: contentFetchOperationResponseSchema
      }
    },
    additionalProperties: false
  };
  const importOperationListSchema = {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: importOperationResponseSchema
      }
    },
    additionalProperties: false
  };
  add(
    paths,
    "/api/v1/acquisition/content-fetch-operations",
    "get",
    operation("get", "列出受控公开网页抓取任务", {
      parameters: [boundedLimitParameter()],
      responses: standardResponses(200, "任务列表", contentFetchListSchema)
    })
  );
  add(
    paths,
    "/api/v1/acquisition/content-fetch-operations",
    "post",
    operation("post", "创建受控公开网页抓取任务", {
      parameters: [idempotencyParameter(1)],
      requestBody: jsonBody({
        type: "object",
        required: ["sourceUrl", "subjectChannel"],
        properties: {
          sourceUrl: {
            type: "string",
            format: "uri",
            pattern: "^[Hh][Tt][Tt][Pp][Ss]://",
            minLength: 1,
            maxLength: 4_096,
            description: [
              "仅允许公开 HTTPS URL。",
              "运行时还会拒绝凭据、非默认端口、内网地址和敏感查询参数。"
            ].join(" ")
          },
          subjectChannel: {
            type: "string",
            enum: ["organization", "individual"]
          }
        },
        additionalProperties: false
      }),
      responses: standardResponses(
        202,
        "任务已排队",
        contentFetchOperationResponseSchema
      )
    })
  );
  add(
    paths,
    "/api/v1/acquisition/content-fetch-operations/{id}",
    "get",
    operation("get", "读取网页抓取任务", {
      parameters: [idParameter(160)],
      responses: standardResponses(
        200,
        "网页抓取任务",
        contentFetchOperationResponseSchema
      )
    })
  );
  const importParameters = [
    idempotencyParameter(1),
    {
      name: "fileName",
      in: "query",
      required: true,
      schema: { type: "string", minLength: 1, maxLength: 255 }
    },
    {
      name: "subjectChannel",
      in: "query",
      required: true,
      schema: {
        type: "string",
        enum: ["organization", "individual"]
      }
    },
    {
      name: "mapping",
      in: "query",
      required: true,
      description: "URL 编码后的列映射 JSON。",
      schema: { type: "string", minLength: 2, maxLength: 4096 }
    }
  ];
  const binarySchema = {
    type: "string",
    format: "binary",
    maxLength: 5 * 1024 * 1024
  };
  add(
    paths,
    "/api/v1/acquisition/import-operations",
    "get",
    operation("get", "列出客户授权文件导入任务", {
      parameters: [boundedLimitParameter()],
      responses: standardResponses(200, "任务列表", importOperationListSchema)
    })
  );
  add(
    paths,
    "/api/v1/acquisition/import-operations",
    "post",
    operation("post", "上传并创建 CSV/XLSX 导入任务", {
      parameters: importParameters,
      requestBody: {
        required: true,
        description: [
          "仅接受原始 CSV/XLSX 二进制内容；",
          "application/json 返回 415 unsupported_media_type。"
        ].join(""),
        content: {
          "text/csv": { schema: binarySchema },
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
            schema: binarySchema
          },
          "application/octet-stream": { schema: binarySchema }
        }
      },
      responses: {
        ...standardResponses(
          202,
          "导入任务已排队",
          importOperationResponseSchema
        ),
        "413": response("文件超过 5 MB 限制", errorSchema),
        "415": response("文件类型不受支持", errorSchema)
      }
    })
  );
  add(
    paths,
    "/api/v1/acquisition/import-operations/{id}",
    "get",
    operation("get", "读取文件导入任务", {
      parameters: [idParameter(160)],
      responses: standardResponses(
        200,
        "文件导入任务",
        importOperationResponseSchema
      )
    })
  );
}

const identityConfirmationWriteSchema = {
  oneOf: [
    {
      type: "object",
      required: [
        "subjectKind",
        "domain",
        "creditCode",
        "evidenceIds",
        "rationale"
      ],
      properties: {
        subjectKind: {
          type: "string",
          enum: ["organization"]
        },
        domain: {
          type: "string",
          nullable: true,
          maxLength: 255
        },
        creditCode: {
          type: "string",
          nullable: true,
          maxLength: 50
        },
        evidenceIds: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 255 }
        },
        rationale: {
          type: "string",
          minLength: 1,
          maxLength: 2_000
        }
      },
      additionalProperties: false
    },
    {
      type: "object",
      required: [
        "subjectKind",
        "publicProfileUrl",
        "sourcePlatform",
        "evidenceIds",
        "rationale"
      ],
      properties: {
        subjectKind: {
          type: "string",
          enum: ["individual"]
        },
        publicProfileUrl: {
          type: "string",
          format: "uri",
          maxLength: 2_000
        },
        sourcePlatform: {
          type: "string",
          minLength: 1,
          maxLength: 100
        },
        evidenceIds: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 255 }
        },
        rationale: {
          type: "string",
          minLength: 1,
          maxLength: 2_000
        }
      },
      additionalProperties: false
    }
  ],
  discriminator: {
    propertyName: "subjectKind"
  }
};

const acquisitionUsageWriteSchema = {
  type: "object",
  required: ["requests", "results", "amountMinor", "durationSeconds"],
  properties: {
    requests: { type: "integer", minimum: 0 },
    results: { type: "integer", minimum: 0 },
    amountMinor: { type: "integer", minimum: 0 },
    durationSeconds: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
};

const planCreateWriteSchema = {
  type: "object",
  required: [
    "name",
    "objective",
    "icp",
    "subjectChannels",
    "providerConnections",
    "operations",
    "budgetSnapshot",
    "stopConditions"
  ],
  properties: {
    targetPlatform: {
      type: "string",
      enum: ["douyin", "web"]
    },
    name: { type: "string", minLength: 1, maxLength: 200 },
    objective: { type: "string", minLength: 1, maxLength: 2_000 },
    icp: {
      type: "object",
      required: [
        "industries",
        "regions",
        "organizationCriteria",
        "individualCriteria",
        "exclusionRules"
      ],
      properties: {
        industries: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 120 }
        },
        regions: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 120 }
        },
        organizationCriteria: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 500 }
        },
        individualCriteria: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 500 }
        },
        exclusionRules: {
          type: "array",
          maxItems: 200,
          items: { type: "string", minLength: 1, maxLength: 500 }
        }
      },
      additionalProperties: false
    },
    subjectChannels: {
      type: "object",
      required: ["organization", "individual"],
      properties: {
        organization: { type: "boolean" },
        individual: { type: "boolean" }
      },
      additionalProperties: false
    },
    providerConnections: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        required: [
          "connectionId",
          "providerId",
          "kind",
          "status",
          "credentialVersion"
        ],
        properties: {
          connectionId: { type: "string", minLength: 1, maxLength: 255 },
          providerId: { type: "string", minLength: 1, maxLength: 100 },
          kind: {
            type: "string",
            enum: ["search", "content_fetch", "import"]
          },
          status: {
            type: "string",
            enum: ["active", "inactive", "disabled"]
          },
          credentialVersion: { type: "integer", minimum: 1 }
        },
        additionalProperties: false
      }
    },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      items: {
        type: "object",
        required: [
          "operationId",
          "subjectChannel",
          "kind",
          "connectionId",
          "allocatedBudget"
        ],
        properties: {
          operationId: { type: "string", minLength: 1, maxLength: 255 },
          subjectChannel: {
            type: "string",
            enum: ["organization", "individual"]
          },
          kind: {
            type: "string",
            enum: ["search", "content_fetch", "import_rows"]
          },
          connectionId: { type: "string", minLength: 1, maxLength: 255 },
          query: { type: "string", minLength: 1, maxLength: 4_000 },
          sourceRef: { type: "string", minLength: 1, maxLength: 4_000 },
          allocatedBudget: acquisitionUsageWriteSchema
        },
        additionalProperties: false
      }
    },
    budgetSnapshot: {
      type: "object",
      required: [
        "billingCurrency",
        "maxRequests",
        "maxResults",
        "maxAmountMinor",
        "maxDurationSeconds"
      ],
      properties: {
        billingCurrency: {
          type: "string",
          minLength: 3,
          maxLength: 3
        },
        maxRequests: { type: "integer", minimum: 0 },
        maxResults: { type: "integer", minimum: 0 },
        maxAmountMinor: { type: "integer", minimum: 0 },
        maxDurationSeconds: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    modelConnectionId: {
      type: "string",
      nullable: true,
      minLength: 1,
      maxLength: 255,
      description: "可选 BYOK 模型连接；服务端据此绑定不可伪造的模型快照。"
    },
    stopConditions: {
      type: "object",
      required: [
        "stopWhenBudgetExhausted",
        "stopWhenNoMoreResults"
      ],
      properties: {
        stopWhenBudgetExhausted: { type: "boolean" },
        stopWhenNoMoreResults: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

const reviewWriteSchema = {
  oneOf: [
    {
      type: "object",
      required: ["action", "decisionVersion", "reason"],
      properties: {
        action: {
          type: "string",
          enum: ["approved", "do_not_contact"]
        },
        decisionVersion: {
          type: "string",
          minLength: 1,
          maxLength: 100
        },
        reason: {
          type: "string",
          nullable: true,
          maxLength: 2_000
        }
      },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["action", "decisionVersion", "reason"],
      properties: {
        action: {
          type: "string",
          enum: ["rejected", "needs_research", "reopen"]
        },
        decisionVersion: {
          type: "string",
          minLength: 1,
          maxLength: 100
        },
        reason: {
          type: "string",
          minLength: 1,
          maxLength: 2_000
        }
      },
      additionalProperties: false
    }
  ]
};

const convertWriteSchema = {
  type: "object",
  required: ["decisionVersion"],
  properties: {
    decisionVersion: {
      type: "string",
      minLength: 1,
      maxLength: 100
    }
  },
  additionalProperties: false
};

const copilotSessionWriteSchema = {
  type: "object",
  properties: {
    connectionId: {
      type: "string",
      nullable: true,
      minLength: 1,
      maxLength: 255
    }
  },
  additionalProperties: false
};

const copilotMessageWriteSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: {
      type: "string",
      minLength: 1,
      maxLength: 20_000
    },
    responseMode: {
      type: "string",
      enum: ["assistant", "plan_draft"],
      default: "assistant"
    },
    targetPlatform: {
      type: "string",
      enum: ["douyin", "web"],
      default: "web"
    }
  },
  additionalProperties: false
};

const planModelSnapshotWriteSchema = {
  type: "object",
  required: [
    "jobSnapshotId",
    "connectionId",
    "credentialVersion",
    "provider",
    "model",
    "capabilitySnapshotHash",
    "promptVersion",
    "schemaVersion",
    "promptHash",
    "schemaHash"
  ],
  properties: {
    jobSnapshotId: { type: "string", minLength: 1, maxLength: 255 },
    connectionId: { type: "string", minLength: 1, maxLength: 255 },
    credentialVersion: { type: "integer", minimum: 1 },
    provider: { type: "string", minLength: 1, maxLength: 100 },
    model: { type: "string", minLength: 1, maxLength: 200 },
    capabilitySnapshotHash: {
      type: "string",
      minLength: 1,
      maxLength: 200
    },
    promptVersion: { type: "string", minLength: 1, maxLength: 100 },
    schemaVersion: { type: "string", minLength: 1, maxLength: 100 },
    promptHash: { type: "string", minLength: 1, maxLength: 200 },
    schemaHash: { type: "string", minLength: 1, maxLength: 200 }
  },
  additionalProperties: false
};

const planMutationWriteSchema = {
  type: "object",
  minProperties: 1,
  properties: {
    targetPlatform: planCreateWriteSchema.properties.targetPlatform,
    name: planCreateWriteSchema.properties.name,
    objective: planCreateWriteSchema.properties.objective,
    icp: planCreateWriteSchema.properties.icp,
    subjectChannels: planCreateWriteSchema.properties.subjectChannels,
    providerConnections:
      planCreateWriteSchema.properties.providerConnections,
    operations: planCreateWriteSchema.properties.operations,
    budgetSnapshot: planCreateWriteSchema.properties.budgetSnapshot,
    modelSnapshotRef: planModelSnapshotWriteSchema,
    stopConditions: planCreateWriteSchema.properties.stopConditions
  },
  additionalProperties: false
};

const planApprovalWriteSchema = {
  type: "object",
  required: ["decision", "reason"],
  properties: {
    decision: {
      type: "string",
      enum: ["approve"]
    },
    reason: {
      type: "string",
      minLength: 1,
      maxLength: 2_000
    }
  },
  additionalProperties: false
};

const planRunWriteSchema = {
  type: "object",
  properties: {
    parentRunId: {
      type: "string",
      minLength: 1,
      maxLength: 255
    },
    reason: {
      type: "string",
      maxLength: 2_000
    }
  },
  additionalProperties: false
};

const planControlWriteSchema = {
  type: "object",
  required: ["reason"],
  properties: {
    reason: {
      type: "string",
      minLength: 1,
      maxLength: 2_000
    }
  },
  additionalProperties: false
};

const runPresentationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://goodjob.example/contracts/json-schema/acquisition-run-presentation.v1.schema.json",
  title: "AcquisitionRunPresentation",
  type: "object",
  required: [
    "run",
    "providers",
    "summary",
    "candidateEvents",
    "nextAfter",
    "hasMore"
  ],
  properties: {
    run: {
      type: "object",
      required: ["id", "status", "etag", "updatedAt", "completedAt"],
      properties: {
        id: { type: "string" },
        status: {
          type: "string",
          enum: [
            "queued",
            "running",
            "pause_requested",
            "paused",
            "cancel_requested",
            "cancelled",
            "succeeded",
            "succeeded_empty",
            "partial_success",
            "failed",
            "budget_exhausted"
          ]
        },
        etag: { type: "string" },
        updatedAt: { type: "string", format: "date-time" },
        completedAt: {
          type: "string",
          format: "date-time",
          nullable: true
        }
      },
      additionalProperties: false
    },
    providers: {
      type: "array",
      items: {
        type: "object",
        required: [
          "shardId",
          "connectionId",
          "providerId",
          "status",
          "rawResultCount",
          "acceptedResultCount",
          "duplicateResultCount",
          "failedResultCount",
          "errorCode",
          "retryAfterAt"
        ],
        properties: {
          shardId: { type: "string" },
          connectionId: { type: "string" },
          providerId: { type: "string" },
          status: { type: "string" },
          rawResultCount: { type: "integer", minimum: 0 },
          acceptedResultCount: { type: "integer", minimum: 0 },
          duplicateResultCount: { type: "integer", minimum: 0 },
          failedResultCount: { type: "integer", minimum: 0 },
          errorCode: { type: "string", nullable: true },
          retryAfterAt: {
            type: "string",
            format: "date-time",
            nullable: true
          }
        },
        additionalProperties: false
      }
    },
    summary: {
      type: "object",
      required: [
        "sourcesSearched",
        "pagesAnalyzed",
        "organizationsFound",
        "dedupedCandidates",
        "validOpportunities",
        "highIntent",
        "financialEvaluatedHighIntentCount",
        "financialPendingHighIntentCount",
        "expectedRevenueByCurrency"
      ],
      properties: {
        sourcesSearched: { type: "integer", minimum: 0 },
        pagesAnalyzed: {
          type: "integer",
          minimum: 0,
          description: "所有运行分片持久化的执行结果页数。"
        },
        organizationsFound: { type: "integer", minimum: 0 },
        dedupedCandidates: { type: "integer", minimum: 0 },
        validOpportunities: { type: "integer", minimum: 0 },
        highIntent: { type: "integer", minimum: 0 },
        financialEvaluatedHighIntentCount: {
          type: "integer",
          minimum: 0
        },
        financialPendingHighIntentCount: {
          type: "integer",
          minimum: 0
        },
        expectedRevenueByCurrency: {
          type: "array",
          description: "仅合计高意向且绑定当前资格决定的财务值；币种不换算。",
          items: {
            type: "object",
            required: ["currency", "amountMinor"],
            properties: {
              currency: { type: "string" },
              amountMinor: { type: "integer" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    candidateEvents: {
      type: "array",
      items: {
        type: "object",
        required: [
          "eventId",
          "createdAt",
          "candidateId",
          "candidate",
          "qualification",
          "financialValue",
          "sourcePlatforms",
          "evidenceCount"
        ],
        properties: {
          eventId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          candidateId: { type: "string" },
          candidate: {
            type: "object",
            required: [
              "id",
              "subjectKind",
              "displayName",
              "industry",
              "region",
              "domain",
              "status",
              "version",
              "identityResolved",
              "updatedAt"
            ],
            properties: {
              id: { type: "string" },
              subjectKind: {
                type: "string",
                enum: ["organization", "individual"]
              },
              displayName: { type: "string" },
              industry: { type: "string", nullable: true },
              region: { type: "string", nullable: true },
              domain: { type: "string", nullable: true },
              status: { type: "string" },
              version: { type: "integer", minimum: 1 },
              identityResolved: { type: "boolean" },
              updatedAt: { type: "string", format: "date-time" }
            },
            additionalProperties: false
          },
          qualification: {
            type: "object",
            nullable: true,
            required: [
              "id",
              "candidateId",
              "decisionVersion",
              "decisionEngine",
              "grade",
              "score",
              "recommendedAction",
              "evidence",
              "positiveSignals",
              "negativeSignals",
              "reasons",
              "confidence",
              "ruleVersion",
              "promptVersion",
              "modelProvider",
              "model",
              "hardGateFailures",
              "createdAt"
            ],
            properties: {
              id: { type: "string" },
              candidateId: { type: "string" },
              decisionVersion: { type: "string" },
              decisionEngine: {
                type: "string",
                enum: ["model", "rules"]
              },
              grade: {
                type: "string",
                enum: ["S", "A", "B", "C", "D"]
              },
              score: { type: "number" },
              recommendedAction: {
                type: "string",
                enum: [
                  "priority_review",
                  "public_response",
                  "nurture",
                  "observe",
                  "do_not_contact"
                ]
              },
              evidence: {
                type: "array",
                items: {
                  type: "object",
                  required: ["evidenceId", "excerpt"],
                  properties: {
                    evidenceId: { type: "string" },
                    excerpt: { type: "string" }
                  },
                  additionalProperties: false
                }
              },
              positiveSignals: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "score"],
                  properties: {
                    name: { type: "string" },
                    score: { type: "number" }
                  },
                  additionalProperties: false
                }
              },
              negativeSignals: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "score"],
                  properties: {
                    name: { type: "string" },
                    score: { type: "number" }
                  },
                  additionalProperties: false
                }
              },
              reasons: {
                type: "array",
                items: { type: "string" }
              },
              confidence: { type: "number" },
              ruleVersion: { type: "string" },
              promptVersion: { type: "string", nullable: true },
              modelProvider: { type: "string", nullable: true },
              model: { type: "string", nullable: true },
              hardGateFailures: {
                type: "array",
                items: {
                  type: "string",
                  enum: [
                    "missing_original_source",
                    "identity_unresolved",
                    "do_not_contact",
                    "explicit_rejection",
                    "non_public_or_sensitive_data",
                    "stale_evidence",
                    "schema_invalid"
                  ]
                }
              },
              createdAt: { type: "string", format: "date-time" }
            },
            additionalProperties: false
          },
          financialValue: {
            type: "object",
            nullable: true,
            required: [
              "id",
              "candidateId",
              "qualificationDecisionId",
              "version",
              "grade",
              "score",
              "currency",
              "expectedRevenueMinor",
              "expectedGrossProfitMinor",
              "expectedContributionMinor",
              "factors",
              "createdAt"
            ],
            properties: {
              id: { type: "string" },
              candidateId: { type: "string" },
              qualificationDecisionId: { type: "string" },
              version: { type: "string" },
              grade: {
                type: "string",
                enum: ["S", "A", "B", "C", "D"]
              },
              score: { type: "number" },
              currency: { type: "string" },
              expectedRevenueMinor: { type: "integer" },
              expectedGrossProfitMinor: { type: "integer" },
              expectedContributionMinor: { type: "integer" },
              factors: {
                type: "object",
                required: [
                  "profitability",
                  "cashFlow",
                  "creditQuality",
                  "repeatPotential",
                  "referralPotential",
                  "closeProbability"
                ],
                properties: {
                  profitability: { type: "number" },
                  cashFlow: { type: "number" },
                  creditQuality: { type: "number" },
                  repeatPotential: { type: "number" },
                  referralPotential: { type: "number" },
                  closeProbability: { type: "number" }
                },
                additionalProperties: false
              },
              createdAt: { type: "string", format: "date-time" }
            },
            additionalProperties: false
          },
          sourcePlatforms: {
            type: "array",
            items: { type: "string" }
          },
          evidenceCount: { type: "integer", minimum: 0 }
        },
        additionalProperties: false
      }
    },
    nextAfter: { type: "string" },
    hasMore: { type: "boolean" }
  },
  additionalProperties: false
};

function addCoreAgentPaths(paths: AcquisitionOpenApiPaths) {
  const definitions: Array<
    [
      string,
      AcquisitionHttpMethod,
      string
    ]
  > = [
    ["/api/v1/acquisition/evidence/{id}", "get", "读取公开证据"],
    ["/api/v1/acquisition/candidates", "get", "列出候选客户"],
    ["/api/v1/acquisition/candidates/{id}", "get", "读取候选客户"],
    ["/api/v1/acquisition/candidates/{id}/evidence", "get", "列出候选证据"],
    ["/api/v1/acquisition/candidates/{id}/identity-confirmation", "post", "人工确认公开主体身份"],
    ["/api/v1/acquisition/candidates/{id}/qualification", "get", "读取资格判断"],
    ["/api/v1/acquisition/candidates/{id}/financial-value", "get", "读取财务价值判断"],
    ["/api/v1/acquisition/candidates/{id}/battle-card", "get", "读取客户作战卡"],
    ["/api/v1/acquisition/candidates/{id}/reviews", "get", "读取人工审核历史"],
    ["/api/v1/acquisition/candidates/{id}/review", "post", "提交人工审核"],
    ["/api/v1/acquisition/candidates/{id}/convert", "post", "人工确认转换为 CRM 线索"],
    ["/api/v1/acquisition/outcomes", "get", "列出成交反馈"],
    ["/api/v1/acquisition/audit-events", "get", "读取获客审计事件"],
    ["/api/v1/acquisition/copilot/sessions", "post", "创建绑定模型快照的 Pi 会话"],
    ["/api/v1/acquisition/copilot/sessions/{id}", "get", "读取 Pi 会话"],
    ["/api/v1/acquisition/copilot/sessions/{id}/messages", "get", "读取 Pi 会话消息"],
    ["/api/v1/acquisition/copilot/sessions/{id}/messages", "post", "向 AI 增长参谋提交任务"],
    ["/api/v1/acquisition/copilot/tasks/{id}", "get", "读取 AI 任务状态"],
    ["/api/v1/acquisition/plans", "post", "创建可审计获客计划"],
    ["/api/v1/acquisition/plans/{id}", "get", "读取获客计划"],
    ["/api/v1/acquisition/plans/{id}", "patch", "更新草稿计划"],
    ["/api/v1/acquisition/plans/{id}/revisions", "post", "创建计划修订"],
    ["/api/v1/acquisition/plans/{id}/approval", "post", "人工批准获客计划"],
    ["/api/v1/acquisition/plans/{id}/runs", "post", "运行已批准计划"],
    ["/api/v1/acquisition/runs/{id}", "get", "读取运行状态"],
    ["/api/v1/acquisition/runs/{id}/shards", "get", "读取运行分片"],
    ["/api/v1/acquisition/runs/{id}/presentation", "get", "读取运行权威展示事件"],
    ["/api/v1/acquisition/runs/{id}/pause", "post", "暂停运行"],
    ["/api/v1/acquisition/runs/{id}/resume", "post", "恢复运行"],
    ["/api/v1/acquisition/runs/{id}/cancel", "post", "取消运行"]
  ];

  const writeBodies: Record<string, {
    schema: Record<string, unknown>;
    required?: boolean;
    successStatus?: number;
    successDescription?: string;
  }> = {
    "post /api/v1/acquisition/candidates/{id}/identity-confirmation": {
      schema: identityConfirmationWriteSchema
    },
    "post /api/v1/acquisition/candidates/{id}/review": {
      schema: reviewWriteSchema
    },
    "post /api/v1/acquisition/candidates/{id}/convert": {
      schema: convertWriteSchema
    },
    "post /api/v1/acquisition/copilot/sessions": {
      schema: copilotSessionWriteSchema,
      successStatus: 202,
      successDescription: "Pi 会话创建任务已接受"
    },
    "post /api/v1/acquisition/copilot/sessions/{id}/messages": {
      schema: copilotMessageWriteSchema,
      successStatus: 202,
      successDescription: "Pi 消息任务已接受"
    },
    "post /api/v1/acquisition/plans": {
      schema: planCreateWriteSchema,
      successStatus: 201,
      successDescription: "获客计划已创建"
    },
    "patch /api/v1/acquisition/plans/{id}": {
      schema: planMutationWriteSchema
    },
    "post /api/v1/acquisition/plans/{id}/revisions": {
      schema: planMutationWriteSchema,
      successStatus: 201,
      successDescription: "计划修订已创建"
    },
    "post /api/v1/acquisition/plans/{id}/approval": {
      schema: planApprovalWriteSchema
    },
    "post /api/v1/acquisition/plans/{id}/runs": {
      schema: planRunWriteSchema,
      required: false,
      successStatus: 202,
      successDescription: "计划运行已接受"
    },
    "post /api/v1/acquisition/runs/{id}/pause": {
      schema: planControlWriteSchema
    },
    "post /api/v1/acquisition/runs/{id}/resume": {
      schema: planControlWriteSchema
    },
    "post /api/v1/acquisition/runs/{id}/cancel": {
      schema: planControlWriteSchema
    }
  };
  const v1IdempotentWrites = new Set([
    "/api/v1/acquisition/candidates/{id}/identity-confirmation",
    "/api/v1/acquisition/candidates/{id}/review",
    "/api/v1/acquisition/candidates/{id}/convert",
    "/api/v1/acquisition/copilot/sessions",
    "/api/v1/acquisition/copilot/sessions/{id}/messages"
  ]);
  const planIdempotentWrites = new Set([
    "/api/v1/acquisition/plans",
    "/api/v1/acquisition/plans/{id}/runs"
  ]);
  const etagWrites = new Set([
    "/api/v1/acquisition/candidates/{id}/identity-confirmation",
    "/api/v1/acquisition/plans/{id}",
    "/api/v1/acquisition/plans/{id}/revisions",
    "/api/v1/acquisition/plans/{id}/approval",
    "/api/v1/acquisition/runs/{id}/pause",
    "/api/v1/acquisition/runs/{id}/resume",
    "/api/v1/acquisition/runs/{id}/cancel"
  ]);
  const etagResponses = new Set([
    "/api/v1/acquisition/candidates/{id}",
    "/api/v1/acquisition/candidates/{id}/identity-confirmation",
    "/api/v1/acquisition/plans",
    "/api/v1/acquisition/plans/{id}",
    "/api/v1/acquisition/plans/{id}/revisions",
    "/api/v1/acquisition/plans/{id}/approval",
    "/api/v1/acquisition/plans/{id}/runs",
    "/api/v1/acquisition/runs/{id}",
    "/api/v1/acquisition/runs/{id}/pause",
    "/api/v1/acquisition/runs/{id}/resume",
    "/api/v1/acquisition/runs/{id}/cancel"
  ]);
  const planResponsePaths = new Set([
    "/api/v1/acquisition/plans",
    "/api/v1/acquisition/plans/{id}",
    "/api/v1/acquisition/plans/{id}/revisions",
    "/api/v1/acquisition/plans/{id}/approval"
  ]);
  const runResponsePaths = new Set([
    "/api/v1/acquisition/plans/{id}/runs",
    "/api/v1/acquisition/runs/{id}",
    "/api/v1/acquisition/runs/{id}/pause",
    "/api/v1/acquisition/runs/{id}/resume",
    "/api/v1/acquisition/runs/{id}/cancel"
  ]);
  const coreResponseSchemas: Record<string, Record<string, unknown>> = {
    "get /api/v1/acquisition/evidence/{id}":
      discoveryEvidenceResponseSchema,
    "get /api/v1/acquisition/candidates": candidatePagedResponseSchema,
    "get /api/v1/acquisition/candidates/{id}": candidateResponseSchema,
    "get /api/v1/acquisition/candidates/{id}/evidence":
      evidencePagedResponseSchema,
    "post /api/v1/acquisition/candidates/{id}/identity-confirmation":
      identityConfirmationResponseSchema,
    "get /api/v1/acquisition/candidates/{id}/qualification":
      qualificationDecisionResponseSchema,
    "get /api/v1/acquisition/candidates/{id}/financial-value":
      financialValueDecisionResponseSchema,
    "get /api/v1/acquisition/candidates/{id}/battle-card":
      battleCardResponseSchema,
    "get /api/v1/acquisition/candidates/{id}/reviews":
      reviewPagedResponseSchema,
    "post /api/v1/acquisition/candidates/{id}/review":
      reviewResultResponseSchema,
    "post /api/v1/acquisition/candidates/{id}/convert":
      leadConversionResponseSchema,
    "get /api/v1/acquisition/outcomes": outcomePagedResponseSchema,
    "get /api/v1/acquisition/audit-events": auditPagedResponseSchema,
    "post /api/v1/acquisition/copilot/sessions":
      asyncOperationResponseSchema,
    "get /api/v1/acquisition/copilot/sessions/{id}":
      copilotSessionResponseSchema,
    "get /api/v1/acquisition/copilot/sessions/{id}/messages":
      copilotMessagePagedResponseSchema,
    "post /api/v1/acquisition/copilot/sessions/{id}/messages":
      copilotTaskResponseSchema,
    "get /api/v1/acquisition/copilot/tasks/{id}":
      copilotTaskResponseSchema
  };

  for (const [path, method, summary] of definitions) {
    const hasId = path.includes("{id}");
    const parameters: Array<Record<string, unknown>> = [];
    if (hasId) parameters.push(idParameter());
    if (method === "get") {
      if ([
        "/api/v1/acquisition/candidates",
        "/api/v1/acquisition/candidates/{id}/evidence",
        "/api/v1/acquisition/candidates/{id}/reviews",
        "/api/v1/acquisition/outcomes",
        "/api/v1/acquisition/audit-events",
        "/api/v1/acquisition/copilot/sessions/{id}/messages"
      ].includes(path)) {
        parameters.push(...paginationParameters());
      }
      if (path === "/api/v1/acquisition/candidates") {
        parameters.push(
          {
            name: "subjectKind",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["organization", "individual"]
            }
          },
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: [
                ...candidateStatuses
              ]
            }
          }
        );
      }
      if (path === "/api/v1/acquisition/outcomes") {
        parameters.push({
          name: "candidateId",
          in: "query",
          required: true,
          schema: {
            type: "string",
            minLength: 1,
            maxLength: 255
          }
        });
      }
      if (path === "/api/v1/acquisition/audit-events") {
        parameters.push({
          name: "candidateId",
          in: "query",
          required: false,
          schema: {
            type: "string",
            minLength: 1,
            maxLength: 255
          }
        });
      }
      if (path === "/api/v1/acquisition/runs/{id}/presentation") {
        parameters.push(
          {
            name: "after",
            in: "query",
            required: false,
            schema: {
              type: "string",
              minLength: 1,
              maxLength: 8192
            }
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50
            }
          }
        );
      }
    } else {
      if (v1IdempotentWrites.has(path)) {
        parameters.push(idempotencyParameter(1));
      } else if (planIdempotentWrites.has(path)) {
        parameters.push(idempotencyParameter(8));
      }
      if (etagWrites.has(path)) {
        parameters.push(
          path.endsWith("/identity-confirmation")
            ? ifMatchParameter({
                type: "string",
                pattern: '^"candidate-v[1-9]\\d*"$'
              })
            : ifMatchParameter()
        );
      }
    }
    const body = method === "get"
      ? null
      : writeBodies[`${method} ${path}`];
    if (method !== "get" && !body) {
      throw new Error(`Missing OpenAPI write body for ${method} ${path}`);
    }
    const successStatus = body?.successStatus ?? 200;
    const successSchema = coreResponseSchemas[`${method} ${path}`]
      ?? (planResponsePaths.has(path)
        ? acquisitionPlanResponseSchema
        : runResponsePaths.has(path)
          ? acquisitionRunResponseSchema
          : path === "/api/v1/acquisition/runs/{id}/shards"
            ? pagedResultResponseSchema
            : path === "/api/v1/acquisition/runs/{id}/presentation"
              ? runPresentationSchema
              : resourceSchema);
    const responses = standardResponses(
      successStatus,
      body?.successDescription ?? "操作成功",
      successSchema
    );
    if (etagResponses.has(path)) {
      (responses[String(successStatus)] as Record<string, unknown>).headers = {
        ETag: {
          required: true,
          schema: path.startsWith("/api/v1/acquisition/candidates/")
            ? {
                type: "string",
                pattern: '^"candidate-v[1-9]\\d*"$'
              }
            : { type: "string", minLength: 1 }
        }
      };
    }
    if (method !== "get" && etagWrites.has(path)) {
      if (
        path
        !== "/api/v1/acquisition/candidates/{id}/identity-confirmation"
      ) {
        responses["412"] = response("资源版本不匹配", errorSchema);
      }
      responses["428"] = response("缺少 If-Match 版本条件", errorSchema);
    }
    add(
      paths,
      path,
      method,
      operation(method, summary, {
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(body
          ? {
              requestBody: jsonBody(
                body.schema,
                body.required ?? true
              )
            }
          : {}),
        responses
      })
    );
  }
}

export function createAcquisitionOpenApiPaths():
AcquisitionOpenApiPaths {
  const paths: AcquisitionOpenApiPaths = {};
  addProviderPaths(paths);
  addDiscoveryOperationPaths(paths);
  addCoreAgentPaths(paths);
  addAcquisitionOperationIds(paths);
  return convertEmbeddedSchemasToOpenApi30(paths);
}
