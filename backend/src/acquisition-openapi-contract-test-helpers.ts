import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

type ContractHttpMethod = "get" | "post" | "patch" | "delete";
type ContractOperation = Record<string, any>;

export type ContractPathItem = Partial<
  Record<ContractHttpMethod, ContractOperation>
>;

const contractPath = fileURLToPath(new URL(
  "../../contracts/openapi/ai-acquisition.v1.yaml",
  import.meta.url
));
const httpMethods: ContractHttpMethod[] = [
  "get",
  "post",
  "patch",
  "delete"
];

function canonicalizeSchema(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalizeSchema);
  }
  if (!value || typeof value !== "object") return value;

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "nullable")
      .map(([key, item]) => [key, canonicalizeSchema(item)])
  ) as Record<string, any>;
  if (value.nullable !== true) return normalized;

  if (normalized.type !== undefined) {
    const types = Array.isArray(normalized.type)
      ? normalized.type
      : [normalized.type];
    normalized.type = [...new Set([...types, "null"])].sort();
  }
  if (Array.isArray(normalized.enum)
    && !normalized.enum.includes(null)) {
    normalized.enum = [...normalized.enum, null];
  }
  if (normalized.type === undefined && normalized.enum === undefined) {
    for (const keyword of ["oneOf", "anyOf"] as const) {
      if (Array.isArray(normalized[keyword])) {
        normalized[keyword] = [
          ...normalized[keyword],
          { type: "null" }
        ];
        break;
      }
    }
  }
  return normalized;
}

function mediaSurface(content: Record<string, any> = {}) {
  const mediaTypes = Object.keys(content).sort();
  return {
    mediaTypes,
    schemas: Object.fromEntries(mediaTypes.map((mediaType) => [
      mediaType,
      canonicalizeSchema(content[mediaType]?.schema ?? {})
    ]))
  };
}

function parametersSurface(parameters: any[] = []) {
  return parameters.map((parameter) => ({
    name: parameter.name,
    in: parameter.in,
    required: parameter.required ?? false,
    schema: canonicalizeSchema(parameter.schema ?? {})
  }));
}

function headersSurface(headers: Record<string, any> = {}) {
  return Object.fromEntries(Object.keys(headers).sort().map((name) => [
    name,
    {
      required: headers[name]?.required ?? false,
      schema: canonicalizeSchema(headers[name]?.schema ?? {})
    }
  ]));
}

export async function loadPublishedAcquisitionPaths(): Promise<
  Record<string, ContractPathItem>
> {
  const yamlOptions = {
    merge: true,
    maxAliasCount: 1_000
  } as const;
  const source = parse(await readFile(contractPath, "utf8"), yamlOptions);
  if (!source || typeof source !== "object" || !("paths" in source)) {
    throw new Error("Published acquisition OpenAPI document has no paths");
  }
  const document = await SwaggerParser.dereference(contractPath, {
    parse: {
      yaml: {
        order: 1,
        allowEmpty: false,
        canParse: [".yaml", ".yml"],
        parse(file: { data: Buffer | string }) {
          return parse(file.data.toString(), yamlOptions);
        }
      }
    }
  } as any) as any;
  const paths: Record<string, ContractPathItem> = {};

  for (const [path, pathItem] of Object.entries(
    document.paths ?? {}
  ) as Array<[string, Record<string, any>]>) {
    const normalizedPathItem: ContractPathItem = {};
    for (const method of httpMethods) {
      const operation = pathItem[method];
      if (!operation) continue;
      normalizedPathItem[method] = {
        ...operation,
        parameters: [
          ...(pathItem.parameters ?? []),
          ...(operation.parameters ?? [])
        ]
      };
    }
    paths[path] = normalizedPathItem;
  }
  return paths;
}

export function operationSurface(operation: ContractOperation) {
  const responses = Object.fromEntries(
    Object.keys(operation.responses ?? {}).sort().map((status) => {
      const response = operation.responses[status];
      return [status, {
        headers: headersSurface(response.headers),
        ...mediaSurface(response.content)
      }];
    })
  );
  return {
    security: canonicalizeSchema(operation.security ?? []),
    parameters: parametersSurface(operation.parameters),
    requestBody: operation.requestBody
      ? {
          required: operation.requestBody.required ?? false,
          ...mediaSurface(operation.requestBody.content)
        }
      : null,
    responses
  };
}
