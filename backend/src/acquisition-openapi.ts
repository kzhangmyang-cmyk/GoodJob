type AcquisitionHttpMethod =
  | "get"
  | "post"
  | "patch"
  | "delete";

export type AcquisitionOpenApiPaths = Record<
  string,
  Partial<Record<AcquisitionHttpMethod, Record<string, unknown>>>
>;

const readSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];
const writeSecurity = [
  { bearerAuth: [] },
  { cookieAuth: [], csrfToken: [] }
];

const errorSchema = {
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
};

const resourceSchema = {
  type: "object",
  additionalProperties: true
};

const providerConnectionSchema = {
  type: "object",
  required: [
    "id",
    "ownerId",
    "teamId",
    "providerId",
    "kind",
    "status",
    "credentialVersion",
    "createdAt"
  ],
  properties: {
    id: { type: "string" },
    ownerId: { type: "string" },
    teamId: { type: "string", nullable: true },
    providerId: { type: "string" },
    kind: {
      type: "string",
      enum: ["search", "content_fetch", "import"]
    },
    status: {
      type: "string",
      enum: ["active", "inactive", "disabled", "error"]
    },
    credentialVersion: { type: "integer", minimum: 1 },
    createdAt: { type: "string", format: "date-time" }
  },
  additionalProperties: false
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

function idParameter() {
  return {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1, maxLength: 255 }
  };
}

function idempotencyParameter() {
  return {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    description: "租户作用域内的写入幂等键；原文不会持久化。",
    schema: {
      type: "string",
      minLength: 8,
      maxLength: 200
    }
  };
}

function jsonBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: {
      "application/json": { schema }
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

const providerConnectionWriteSchema = {
  type: "object",
  required: ["providerId", "apiKey"],
  properties: {
    providerId: { type: "string", maxLength: 100 },
    apiKey: {
      type: "string",
      minLength: 1,
      maxLength: 8192,
      writeOnly: true,
      description: "客户自己的官方 API Key，仅加密保存且永不回显。"
    },
    baseUrl: {
      type: "string",
      format: "uri",
      maxLength: 2048
    },
    status: {
      type: "string",
      enum: ["active", "disabled"]
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
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: providerConnectionSchema
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
      parameters: [idempotencyParameter()],
      requestBody: jsonBody(providerConnectionWriteSchema),
      responses: standardResponses(
        201,
        "连接已创建",
        providerConnectionSchema
      )
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
    ...providerConnectionWriteSchema,
    required: [],
    properties: {
      ...providerConnectionWriteSchema.properties,
      providerId: undefined
    }
  };
  delete (patchSchema.properties as Record<string, unknown>).providerId;
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
      responses: standardResponses(200, "健康检查结果")
    })
  );
}

function addDiscoveryOperationPaths(paths: AcquisitionOpenApiPaths) {
  const listSchema = {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: resourceSchema
      }
    },
    additionalProperties: false
  };
  add(
    paths,
    "/api/v1/acquisition/content-fetch-operations",
    "get",
    operation("get", "列出受控公开网页抓取任务", {
      responses: standardResponses(200, "任务列表", listSchema)
    })
  );
  add(
    paths,
    "/api/v1/acquisition/content-fetch-operations",
    "post",
    operation("post", "创建受控公开网页抓取任务", {
      parameters: [idempotencyParameter()],
      requestBody: jsonBody({
        type: "object",
        required: ["sourceUrl", "subjectChannel"],
        properties: {
          sourceUrl: {
            type: "string",
            format: "uri",
            maxLength: 4000
          },
          subjectChannel: {
            type: "string",
            enum: ["organization", "individual"]
          }
        },
        additionalProperties: false
      }),
      responses: standardResponses(202, "任务已排队")
    })
  );
  add(
    paths,
    "/api/v1/acquisition/content-fetch-operations/{id}",
    "get",
    operation("get", "读取网页抓取任务", {
      parameters: [idParameter()]
    })
  );
  const importParameters = [
    idempotencyParameter(),
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
      responses: standardResponses(200, "任务列表", listSchema)
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
        content: {
          "text/csv": { schema: binarySchema },
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
            schema: binarySchema
          },
          "application/octet-stream": { schema: binarySchema }
        }
      },
      responses: {
        ...standardResponses(202, "导入任务已排队"),
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
      parameters: [idParameter()]
    })
  );
}

function addCoreAgentPaths(paths: AcquisitionOpenApiPaths) {
  const definitions: Array<
    [
      string,
      AcquisitionHttpMethod,
      string
    ]
  > = [
    ["/api/v1/acquisition/evidence", "post", "记录公开证据"],
    ["/api/v1/acquisition/evidence/{id}", "get", "读取公开证据"],
    ["/api/v1/acquisition/candidates", "get", "列出候选客户"],
    ["/api/v1/acquisition/candidates", "post", "创建候选客户"],
    ["/api/v1/acquisition/candidates/{id}", "get", "读取候选客户"],
    ["/api/v1/acquisition/candidates/{id}/evidence", "get", "列出候选证据"],
    ["/api/v1/acquisition/candidates/{id}/evidence", "post", "关联候选证据"],
    ["/api/v1/acquisition/candidates/{id}/research", "post", "记录研究尝试"],
    ["/api/v1/acquisition/candidates/{id}/qualification", "get", "读取资格判断"],
    ["/api/v1/acquisition/candidates/{id}/qualification", "post", "生成资格和财务价值判断"],
    ["/api/v1/acquisition/candidates/{id}/battle-card", "get", "读取客户作战卡"],
    ["/api/v1/acquisition/candidates/{id}/battle-card", "post", "生成客户作战卡"],
    ["/api/v1/acquisition/candidates/{id}/reviews", "get", "读取人工审核历史"],
    ["/api/v1/acquisition/candidates/{id}/review", "post", "提交人工审核"],
    ["/api/v1/acquisition/candidates/{id}/convert", "post", "人工确认转换为 CRM 线索"],
    ["/api/v1/acquisition/outcomes", "get", "列出成交反馈"],
    ["/api/v1/acquisition/outcomes", "post", "记录可信业务结果"],
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
    ["/api/v1/acquisition/runs/{id}/pause", "post", "暂停运行"],
    ["/api/v1/acquisition/runs/{id}/resume", "post", "恢复运行"],
    ["/api/v1/acquisition/runs/{id}/cancel", "post", "取消运行"]
  ];
  for (const [path, method, summary] of definitions) {
    const hasId = path.includes("{id}");
    const idempotentCreate = method === "post" && (
      path === "/api/v1/acquisition/copilot/sessions"
      || path.endsWith("/messages")
      || path.endsWith("/runs")
    );
    const needsEtag = method !== "get" && (
      path.endsWith("/approval")
      || path.endsWith("/pause")
      || path.endsWith("/resume")
      || path.endsWith("/cancel")
      || (
        path === "/api/v1/acquisition/plans/{id}"
        && method === "patch"
      )
    );
    const parameters: Array<Record<string, unknown>> = [];
    if (hasId) parameters.push(idParameter());
    if (idempotentCreate) parameters.push(idempotencyParameter());
    if (needsEtag) {
      parameters.push({
        name: "If-Match",
        in: "header",
        required: true,
        schema: { type: "string" }
      });
    }
    add(paths, path, method, operation(method, summary, {
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(method === "get"
        ? {}
        : {
            requestBody: jsonBody({
              type: "object",
              additionalProperties: true
            })
          })
    }));
  }
}

export function createAcquisitionOpenApiPaths():
AcquisitionOpenApiPaths {
  const paths: AcquisitionOpenApiPaths = {};
  addProviderPaths(paths);
  addDiscoveryOperationPaths(paths);
  addCoreAgentPaths(paths);
  return paths;
}
