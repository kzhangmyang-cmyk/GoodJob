import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  convertJsonSchema202012ToOpenApi30
} from "./acquisition-openapi.js";

export type GrowthOpenApiHttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete";

export type OpenApiPathItem = Partial<Record<
  GrowthOpenApiHttpMethod,
  Record<string, any>
>>;

export interface GrowthContractManifest {
  name: "growth-advisor-quote-roi";
  contractVersion: string;
  contractHash: `sha256:${string}`;
  openapiVersion: "3.1.0";
}

export interface GrowthContractRelease {
  manifest: Readonly<GrowthContractManifest>;
  document: Readonly<Record<string, any>>;
}

const releasesRoot = new URL(
  "../../contracts/releases/growth-advisor-quote-roi/",
  import.meta.url
);
const strictSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function compareSemver(left: string, right: string) {
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

function currentReleaseRoot(): URL {
  const versions = readdirSync(releasesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && strictSemver.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const order = compareSemver(left, right);
      if (order === 0 && left !== right) {
        throw new Error("AMBIGUOUS_GROWTH_CONTRACT_RELEASE");
      }
      return order;
    });
  const version = versions.at(-1);
  if (!version) throw new Error("GROWTH_CONTRACT_RELEASE_NOT_FOUND");
  return new URL(`${version}/`, releasesRoot);
}

function assertManifest(value: unknown): GrowthContractManifest {
  const manifest = value as Partial<GrowthContractManifest> | null;
  if (
    !manifest
    || manifest.name !== "growth-advisor-quote-roi"
    || typeof manifest.contractVersion !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(manifest.contractHash ?? "")
    || manifest.openapiVersion !== "3.1.0"
  ) {
    throw new Error("INVALID_GROWTH_CONTRACT_MANIFEST");
  }
  return manifest as GrowthContractManifest;
}

let cachedRelease: GrowthContractRelease | undefined;

export function loadGrowthContractRelease(): GrowthContractRelease {
  if (cachedRelease) return cachedRelease;
  const releaseRoot = currentReleaseRoot();
  const manifest = assertManifest(JSON.parse(readFileSync(
    new URL("manifest.json", releaseRoot),
    "utf8"
  )));
  const directoryVersion = releaseRoot.pathname.split("/").filter(Boolean).at(-1);
  if (manifest.contractVersion !== directoryVersion) {
    throw new Error("GROWTH_CONTRACT_RELEASE_DIRECTORY_MISMATCH");
  }
  const openApiBytes = readFileSync(new URL("openapi.json", releaseRoot));
  const actualHash = `sha256:${createHash("sha256")
    .update(openApiBytes)
    .digest("hex")}`;
  if (actualHash !== manifest.contractHash) {
    throw new Error("GROWTH_CONTRACT_RELEASE_HASH_MISMATCH");
  }
  const document = JSON.parse(openApiBytes.toString("utf8"));
  if (
    document.openapi !== manifest.openapiVersion
    || document.info?.version !== manifest.contractVersion
    || !document.paths
  ) {
    throw new Error("GROWTH_CONTRACT_RELEASE_IDENTITY_MISMATCH");
  }
  cachedRelease = Object.freeze({
    manifest: Object.freeze({ ...manifest }),
    document: Object.freeze(document)
  });
  return cachedRelease;
}

function prepareReleasedSchema(
  value: unknown,
  source: Record<string, any>
): any {
  if (Array.isArray(value)) {
    return value.map((item) => prepareReleasedSchema(item, source));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref === "string") {
    const match = /^#\/components\/schemas\/([^/]+)(\/.+)$/u.exec(
      record.$ref
    );
    if (!match) return { $ref: record.$ref };
    const target = resolveComponentAlias(source, record.$ref);
    if (target === undefined) {
      throw new Error(`MISSING_GROWTH_OPENAPI_REFERENCE:${record.$ref}`);
    }
    return prepareReleasedSchema(target, source);
  }
  const rewritten = Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "contains" && key !== "$defs")
    .map(([key, item]) => [
    key,
    prepareReleasedSchema(item, source)
  ]));
  if ("contains" in value) {
    const contains = prepareReleasedSchema(
      (value as Record<string, unknown>).contains
      , source
    );
    rewritten.allOf = [
      ...(Array.isArray(rewritten.allOf) ? rewritten.allOf : []),
      { not: { items: { not: contains } } }
    ];
  }
  return rewritten;
}

function convertReleasedSchema(
  value: unknown,
  source: Record<string, any>
): any {
  return convertJsonSchema202012ToOpenApi30(
    prepareReleasedSchema(value, source)
  );
}

function convertEmbeddedSchemas(
  value: unknown,
  source: Record<string, any>
): any {
  if (Array.isArray(value)) {
    return value.map((item) => convertEmbeddedSchemas(item, source));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === "schema"
      ? convertReleasedSchema(item, source)
      : convertEmbeddedSchemas(item, source)
  ]));
}

function decodePointerSegment(value: string) {
  return decodeURIComponent(value.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

function resolveComponentAlias(
  root: Record<string, any>,
  reference: string
): unknown {
  if (!reference.startsWith("#/")) return { $ref: reference };
  let current: any = root;
  for (const segment of reference.slice(2).split("/")) {
    while (current && typeof current.$ref === "string") {
      current = resolveComponentAlias(root, current.$ref);
    }
    current = current?.[decodePointerSegment(segment)];
  }
  return current;
}

export function createGrowthOpenApiPaths(): Record<string, OpenApiPathItem> {
  const source = loadGrowthContractRelease().document as Record<string, any>;
  return convertEmbeddedSchemas(structuredClone(source.paths), source);
}

export function createGrowthOpenApiComponents(): Record<string, any> {
  const source = loadGrowthContractRelease().document as Record<string, any>;
  const components = structuredClone(source.components ?? {});
  components.schemas = Object.fromEntries(Object.entries(
    components.schemas ?? {}
  ).map(([name, schema]) => [
    name,
    convertReleasedSchema(
      schema && typeof schema === "object" && "$ref" in schema
        ? resolveComponentAlias(source, String((schema as any).$ref))
        : schema,
      source
    )
  ]));
  for (const key of Object.keys(components)) {
    if (key !== "schemas") {
      components[key] = convertEmbeddedSchemas(components[key], source);
    }
  }
  return components;
}
