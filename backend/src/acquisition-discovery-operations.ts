import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import XLSX from "xlsx-js-style";
import type {
  DiscoveryEvidence,
  DiscoveryEvidenceInput
} from "./acquisition-domain.js";
import { canonicalJsonStringify } from "./canonical-json.js";
import { createProviderHttpClient } from "./provider-http-client.js";
import {
  isForbiddenNetworkHostname,
  normalizeNetworkHostname
} from "./provider-network-security.js";

export type AcquisitionDiscoverySubjectChannel =
  | "organization"
  | "individual";

export type AcquisitionContentFetchStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "access_restricted";

export type AcquisitionImportStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial_success"
  | "failed";

export interface AcquisitionDiscoveryScope {
  ownerId: string;
  teamId: string;
  actorId: string;
}

export interface AcquisitionContentFetchOperation {
  id: string;
  ownerId: string;
  teamId: string;
  actorId: string;
  sourceUrl: string;
  finalUrl: string | null;
  subjectChannel: AcquisitionDiscoverySubjectChannel;
  status: AcquisitionContentFetchStatus;
  accessStatus:
    | "public_content"
    | "access_restricted"
    | null;
  httpStatus: number | null;
  contentType: string | null;
  title: string | null;
  rawArtifactHash: string | null;
  contentHash: string | null;
  evidenceCount: number;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AcquisitionImportColumnMapping {
  sourceTitle: string;
  sourceSnippet: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  publishedAt?: string;
  locale?: string;
}

export interface AcquisitionImportRowError {
  sheetName: string;
  rowNumber: number;
  code: string;
  message: string;
}

export interface AcquisitionImportOperation {
  id: string;
  ownerId: string;
  teamId: string;
  actorId: string;
  fileName: string;
  mediaType:
    | "text/csv"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  subjectChannel: AcquisitionDiscoverySubjectChannel;
  artifactHash: string;
  status: AcquisitionImportStatus;
  rowCount: number;
  acceptedRowCount: number;
  errorRows: AcquisitionImportRowError[];
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AcquisitionContentFetchOperationRecord
extends AcquisitionContentFetchOperation {
  idempotencyKeyHash: string;
  requestHash: string;
}

export interface AcquisitionImportOperationRecord
extends AcquisitionImportOperation {
  idempotencyKeyHash: string;
  requestHash: string;
  artifactCiphertext: string;
  columnMapping: AcquisitionImportColumnMapping;
}

export type AcquisitionDiscoveryOperationErrorCode =
  | "INVALID_REQUEST"
  | "RESOURCE_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "UNSAFE_SOURCE_URL"
  | "CONTENT_FETCH_FAILED"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "IMPORT_ARTIFACT_INVALID"
  | "IMPORT_LIMIT_EXCEEDED"
  | "IMPORT_PROCESSING_FAILED"
  | "OPERATION_ALREADY_RUNNING"
  | "ABORTED";

export class AcquisitionDiscoveryOperationError extends Error {
  constructor(
    public readonly code: AcquisitionDiscoveryOperationErrorCode,
    message: string = code
  ) {
    super(message);
    this.name = "AcquisitionDiscoveryOperationError";
  }
}

export interface AcquisitionDiscoveryEvidencePort {
  appendEvidence(
    scope: AcquisitionDiscoveryScope,
    input: DiscoveryEvidenceInput,
    idempotencyKey: string
  ): Promise<DiscoveryEvidence>;
}

export interface ControlledContentFetchResult {
  finalUrl: string;
  status: "succeeded" | "access_restricted";
  accessStatus: "public_content" | "access_restricted";
  httpStatus: number;
  contentType: string;
  title: string;
  text: string;
  rawArtifactHash: string;
  contentHash: string;
}

export interface AcquisitionContentFetcherPort {
  fetch(
    sourceUrl: string,
    signal?: AbortSignal
  ): Promise<ControlledContentFetchResult>;
}

export interface AcquisitionDiscoveryOperationRepository {
  createContentFetchOperation(
    operation: AcquisitionContentFetchOperationRecord
  ): Promise<{
    operation: AcquisitionContentFetchOperationRecord;
    created: boolean;
  }>;
  getContentFetchOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string
  ): Promise<AcquisitionContentFetchOperationRecord | null>;
  listContentFetchOperations(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    limit: number
  ): Promise<AcquisitionContentFetchOperationRecord[]>;
  claimContentFetchOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string,
    startedAt: string
  ): Promise<{
    operation: AcquisitionContentFetchOperationRecord | null;
    claimed: boolean;
  }>;
  putContentFetchOperation(
    operation: AcquisitionContentFetchOperationRecord
  ): Promise<void>;
  createImportOperation(
    operation: AcquisitionImportOperationRecord
  ): Promise<{
    operation: AcquisitionImportOperationRecord;
    created: boolean;
  }>;
  getImportOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string
  ): Promise<AcquisitionImportOperationRecord | null>;
  listImportOperations(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    limit: number
  ): Promise<AcquisitionImportOperationRecord[]>;
  claimImportOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string,
    startedAt: string
  ): Promise<{
    operation: AcquisitionImportOperationRecord | null;
    claimed: boolean;
  }>;
  putImportOperation(
    operation: AcquisitionImportOperationRecord
  ): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hash(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableHash(value: unknown) {
  return hash(canonicalJsonStringify(value));
}

function keyHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmptyText(
  value: unknown,
  label: string,
  max: number
) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) {
    throw new AcquisitionDiscoveryOperationError(
      "INVALID_REQUEST",
      `${label}不能为空且不能超过 ${max} 个字符`
    );
  }
  return text;
}

function validatedScope(scope: AcquisitionDiscoveryScope) {
  return {
    ownerId: nonEmptyText(scope.ownerId, "ownerId", 100),
    teamId: nonEmptyText(scope.teamId, "teamId", 100),
    actorId: nonEmptyText(scope.actorId, "actorId", 100)
  };
}

function validatedListLimit(value: number | undefined) {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AcquisitionDiscoveryOperationError(
      "INVALID_REQUEST",
      "limit 必须为 1 到 100 之间的整数"
    );
  }
  return limit;
}

function publicFetch(
  operation: AcquisitionContentFetchOperationRecord
): AcquisitionContentFetchOperation {
  const {
    idempotencyKeyHash: _idempotencyKeyHash,
    requestHash: _requestHash,
    ...value
  } = operation;
  return clone(value);
}

function publicImport(
  operation: AcquisitionImportOperationRecord
): AcquisitionImportOperation {
  const {
    idempotencyKeyHash: _idempotencyKeyHash,
    requestHash: _requestHash,
    artifactCiphertext: _artifactCiphertext,
    columnMapping: _columnMapping,
    ...value
  } = operation;
  return clone(value);
}

function isTerminalFetch(status: AcquisitionContentFetchStatus) {
  return [
    "succeeded",
    "failed",
    "access_restricted"
  ].includes(status);
}

function isTerminalImport(status: AcquisitionImportStatus) {
  return [
    "succeeded",
    "partial_success",
    "failed"
  ].includes(status);
}

export class InMemoryAcquisitionDiscoveryOperationRepository
implements AcquisitionDiscoveryOperationRepository {
  private readonly fetchOperations =
    new Map<string, AcquisitionContentFetchOperationRecord>();
  private readonly fetchIdempotency = new Map<string, string>();
  private readonly importOperations =
    new Map<string, AcquisitionImportOperationRecord>();
  private readonly importIdempotency = new Map<string, string>();

  size(prefix: string) {
    if (prefix === "fetch") return this.fetchOperations.size;
    if (prefix === "import") return this.importOperations.size;
    return 0;
  }

  async createContentFetchOperation(
    operation: AcquisitionContentFetchOperationRecord
  ) {
    const key = [
      operation.ownerId,
      operation.teamId,
      operation.idempotencyKeyHash
    ].join("\u001f");
    const existingId = this.fetchIdempotency.get(key);
    if (existingId) {
      const existing = this.fetchOperations.get(existingId)!;
      if (existing.requestHash !== operation.requestHash) {
        throw new AcquisitionDiscoveryOperationError(
          "IDEMPOTENCY_CONFLICT"
        );
      }
      return { operation: clone(existing), created: false };
    }
    this.fetchOperations.set(operation.id, clone(operation));
    this.fetchIdempotency.set(key, operation.id);
    return { operation: clone(operation), created: true };
  }

  async getContentFetchOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string
  ) {
    const operation = this.fetchOperations.get(id);
    return operation
      && operation.ownerId === scope.ownerId
      && operation.teamId === scope.teamId
      ? clone(operation)
      : null;
  }

  async listContentFetchOperations(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    limit: number
  ) {
    return [...this.fetchOperations.values()]
      .filter((operation) =>
        operation.ownerId === scope.ownerId
        && operation.teamId === scope.teamId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
        || right.id.localeCompare(left.id))
      .slice(0, limit)
      .map(clone);
  }

  async claimContentFetchOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string,
    startedAt: string
  ) {
    const operation = await this.getContentFetchOperation(scope, id);
    if (!operation) return { operation: null, claimed: false };
    if (isTerminalFetch(operation.status)) {
      return { operation, claimed: false };
    }
    if (operation.status === "running") {
      return { operation, claimed: false };
    }
    operation.status = "running";
    operation.startedAt = startedAt;
    operation.errorCode = null;
    this.fetchOperations.set(id, clone(operation));
    return { operation: clone(operation), claimed: true };
  }

  async putContentFetchOperation(
    operation: AcquisitionContentFetchOperationRecord
  ) {
    const existing = this.fetchOperations.get(operation.id);
    if (!existing
      || existing.ownerId !== operation.ownerId
      || existing.teamId !== operation.teamId) {
      throw new AcquisitionDiscoveryOperationError("RESOURCE_NOT_FOUND");
    }
    this.fetchOperations.set(operation.id, clone(operation));
  }

  async createImportOperation(
    operation: AcquisitionImportOperationRecord
  ) {
    const key = [
      operation.ownerId,
      operation.teamId,
      operation.idempotencyKeyHash
    ].join("\u001f");
    const existingId = this.importIdempotency.get(key);
    if (existingId) {
      const existing = this.importOperations.get(existingId)!;
      if (existing.requestHash !== operation.requestHash) {
        throw new AcquisitionDiscoveryOperationError(
          "IDEMPOTENCY_CONFLICT"
        );
      }
      return { operation: clone(existing), created: false };
    }
    this.importOperations.set(operation.id, clone(operation));
    this.importIdempotency.set(key, operation.id);
    return { operation: clone(operation), created: true };
  }

  async getImportOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string
  ) {
    const operation = this.importOperations.get(id);
    return operation
      && operation.ownerId === scope.ownerId
      && operation.teamId === scope.teamId
      ? clone(operation)
      : null;
  }

  async listImportOperations(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    limit: number
  ) {
    return [...this.importOperations.values()]
      .filter((operation) =>
        operation.ownerId === scope.ownerId
        && operation.teamId === scope.teamId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
        || right.id.localeCompare(left.id))
      .slice(0, limit)
      .map(clone);
  }

  async claimImportOperation(
    scope: Pick<AcquisitionDiscoveryScope, "ownerId" | "teamId">,
    id: string,
    startedAt: string
  ) {
    const operation = await this.getImportOperation(scope, id);
    if (!operation) return { operation: null, claimed: false };
    if (isTerminalImport(operation.status)) {
      return { operation, claimed: false };
    }
    if (operation.status === "running") {
      return { operation, claimed: false };
    }
    operation.status = "running";
    operation.startedAt = startedAt;
    operation.errorCode = null;
    this.importOperations.set(id, clone(operation));
    return { operation: clone(operation), claimed: true };
  }

  async putImportOperation(operation: AcquisitionImportOperationRecord) {
    const existing = this.importOperations.get(operation.id);
    if (!existing
      || existing.ownerId !== operation.ownerId
      || existing.teamId !== operation.teamId) {
      throw new AcquisitionDiscoveryOperationError("RESOURCE_NOT_FOUND");
    }
    this.importOperations.set(operation.id, clone(operation));
  }
}

function validatePublicSourceUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AcquisitionDiscoveryOperationError("UNSAFE_SOURCE_URL");
  }
  const hostname = normalizeNetworkHostname(url.hostname);
  if (
    url.protocol !== "https:"
    || Boolean(url.username)
    || Boolean(url.password)
    || (url.port !== "" && url.port !== "443")
    || isForbiddenNetworkHostname(hostname)
  ) {
    throw new AcquisitionDiscoveryOperationError("UNSAFE_SOURCE_URL");
  }
  url.hash = "";
  return url;
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return value.replace(
    /&(?:#(\d+)|#x([a-f0-9]+)|([a-z]+));/giu,
    (entity, decimal: string, hexadecimal: string, name: string) => {
      if (decimal) {
        const codePoint = Number(decimal);
        return Number.isSafeInteger(codePoint)
          && codePoint >= 0
          && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      if (hexadecimal) {
        const codePoint = Number.parseInt(hexadecimal, 16);
        return Number.isSafeInteger(codePoint)
          && codePoint >= 0
          && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return named[String(name).toLowerCase()] ?? entity;
    }
  );
}

function normalizedWhitespace(value: string, max: number) {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function htmlTitle(value: string) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(value);
  if (!match) return "";
  return normalizedWhitespace(
    decodeHtmlEntities(match[1]!.replace(/<[^>]+>/gu, " ")),
    500
  );
}

function htmlText(value: string) {
  const withoutHiddenContent = value
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg|canvas)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<br\b[^>]*\/?>/giu, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  return normalizedWhitespace(
    decodeHtmlEntities(withoutHiddenContent),
    100_000
  );
}

export interface ControlledPublicContentFetcherOptions {
  maxResponseBytes?: number;
  timeoutMs?: number;
}

export class ControlledPublicContentFetcher
implements AcquisitionContentFetcherPort {
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;

  constructor(options: ControlledPublicContentFetcherOptions = {}) {
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    if (!Number.isSafeInteger(this.maxResponseBytes)
      || this.maxResponseBytes < 1_024
      || this.maxResponseBytes > 5 * 1024 * 1024
      || !Number.isSafeInteger(this.timeoutMs)
      || this.timeoutMs < 100
      || this.timeoutMs > 60_000) {
      throw new TypeError("Invalid controlled content fetch limits");
    }
  }

  async fetch(sourceUrl: string, signal?: AbortSignal) {
    const source = validatePublicSourceUrl(sourceUrl);
    const client = createProviderHttpClient({
      allowedHosts: [source.hostname],
      allowedPathPrefixes: ["/"],
      allowedMethods: ["GET"],
      maxResponseBytes: this.maxResponseBytes,
      timeoutMs: this.timeoutMs
    });
    let response: Response;
    try {
      response = await client.fetch(source.toString(), {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "user-agent": "GoodJob-Public-Content-Fetcher/1.0"
        },
        signal
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new AcquisitionDiscoveryOperationError("ABORTED");
      }
      const message = error instanceof Error
        ? error.message.toLocaleLowerCase()
        : "";
      if (message.includes("超过允许大小")) {
        throw new AcquisitionDiscoveryOperationError("RESPONSE_TOO_LARGE");
      }
      if (message.includes("安全检查")
        || message.includes("不在已批准")
        || message.includes("只允许")) {
        throw new AcquisitionDiscoveryOperationError("UNSAFE_SOURCE_URL");
      }
      throw new AcquisitionDiscoveryOperationError("CONTENT_FETCH_FAILED");
    }
    const raw = Buffer.from(await response.arrayBuffer());
    const rawArtifactHash = hash(raw);
    const finalUrl = response.url || source.toString();
    if ([401, 403, 407, 423, 429, 451].includes(response.status)) {
      return {
        finalUrl,
        status: "access_restricted" as const,
        accessStatus: "access_restricted" as const,
        httpStatus: response.status,
        contentType: response.headers.get("content-type") ?? "",
        title: "",
        text: "",
        rawArtifactHash,
        contentHash: stableHash({
          finalUrl,
          httpStatus: response.status,
          accessStatus: "access_restricted"
        })
      };
    }
    if (!response.ok) {
      throw new AcquisitionDiscoveryOperationError("CONTENT_FETCH_FAILED");
    }
    const contentType = (
      response.headers.get("content-type") ?? ""
    ).toLocaleLowerCase();
    const isHtml = contentType.includes("text/html")
      || contentType.includes("application/xhtml+xml");
    const isText = contentType.includes("text/plain");
    if (!isHtml && !isText) {
      throw new AcquisitionDiscoveryOperationError(
        "UNSUPPORTED_CONTENT_TYPE"
      );
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(raw);
    const title = isHtml ? htmlTitle(decoded) : "";
    const text = isHtml
      ? htmlText(decoded)
      : normalizedWhitespace(decoded, 100_000);
    if (!title && !text) {
      throw new AcquisitionDiscoveryOperationError("CONTENT_FETCH_FAILED");
    }
    return {
      finalUrl,
      status: "succeeded" as const,
      accessStatus: "public_content" as const,
      httpStatus: response.status,
      contentType,
      title,
      text,
      rawArtifactHash,
      contentHash: hash(text)
    };
  }
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5_000;
const MAX_IMPORT_COLUMNS = 100;
const MAX_IMPORT_SHEETS = 10;
const MAX_IMPORT_CELL_LENGTH = 20_000;

function boundedImportContent(result: Buffer) {
  if (result.length === 0 || result.length > MAX_IMPORT_BYTES) {
    throw new AcquisitionDiscoveryOperationError(
      result.length > MAX_IMPORT_BYTES
        ? "IMPORT_LIMIT_EXCEEDED"
        : "IMPORT_ARTIFACT_INVALID"
    );
  }
  return result;
}

function strictBase64(value: string) {
  const normalized = value.trim();
  if (!normalized
    || normalized.length % 4 !== 0
    || !/^[a-z0-9+/]+={0,2}$/iu.test(normalized)) {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID"
    );
  }
  return boundedImportContent(Buffer.from(normalized, "base64"));
}

function importContent(
  input: { content: Uint8Array; contentBase64?: never }
    | { content?: never; contentBase64: string }
) {
  if (input.content !== undefined) {
    if (!(input.content instanceof Uint8Array)
      || input.contentBase64 !== undefined) {
      throw new AcquisitionDiscoveryOperationError(
        "IMPORT_ARTIFACT_INVALID"
      );
    }
    return boundedImportContent(Buffer.from(input.content));
  }
  if (typeof input.contentBase64 !== "string") {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID"
    );
  }
  return strictBase64(input.contentBase64);
}

function normalizedMapping(
  mapping: AcquisitionImportColumnMapping
): AcquisitionImportColumnMapping {
  return {
    sourceTitle: nonEmptyText(
      mapping.sourceTitle,
      "sourceTitle 字段映射",
      200
    ),
    sourceSnippet: nonEmptyText(
      mapping.sourceSnippet,
      "sourceSnippet 字段映射",
      200
    ),
    ...(mapping.sourcePlatform
      ? {
          sourcePlatform: nonEmptyText(
            mapping.sourcePlatform,
            "sourcePlatform 字段映射",
            200
          )
        }
      : {}),
    ...(mapping.sourceUrl
      ? {
          sourceUrl: nonEmptyText(
            mapping.sourceUrl,
            "sourceUrl 字段映射",
            200
          )
        }
      : {}),
    ...(mapping.publishedAt
      ? {
          publishedAt: nonEmptyText(
            mapping.publishedAt,
            "publishedAt 字段映射",
            200
          )
        }
      : {}),
    ...(mapping.locale
      ? {
          locale: nonEmptyText(
            mapping.locale,
            "locale 字段映射",
            200
          )
        }
      : {})
  };
}

interface ParsedImportSheet {
  name: string;
  rows: string[][];
}

function parseCsv(content: Buffer): ParsedImportSheet[] {
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(content)
    .replace(/^\ufeff/u, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === "\"") {
      if (cell.length !== 0) {
        throw new AcquisitionDiscoveryOperationError(
          "IMPORT_ARTIFACT_INVALID"
        );
      }
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += character;
    }
    if (cell.length > MAX_IMPORT_CELL_LENGTH
      || row.length > MAX_IMPORT_COLUMNS) {
      throw new AcquisitionDiscoveryOperationError(
        "IMPORT_LIMIT_EXCEEDED"
      );
    }
  }
  if (quoted) {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID"
    );
  }
  row.push(cell);
  if (row.some((value) => value.length > 0) || rows.length === 0) {
    rows.push(row);
  }
  return [{ name: "CSV", rows }];
}

function parseXlsx(content: Buffer): ParsedImportSheet[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(content, {
      type: "buffer",
      cellDates: false,
      cellFormula: false,
      bookVBA: false,
      dense: false
    });
  } catch {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID"
    );
  }
  if (workbook.SheetNames.length < 1
    || workbook.SheetNames.length > MAX_IMPORT_SHEETS) {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_LIMIT_EXCEEDED"
    );
  }
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      throw new AcquisitionDiscoveryOperationError(
        "IMPORT_ARTIFACT_INVALID"
      );
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    }).map((row) => row.map((cell) => String(cell ?? "")));
    return { name, rows };
  });
}

function validateImportShape(sheets: ParsedImportSheet[]) {
  const dataRows = sheets.reduce(
    (total, sheet) => total + Math.max(0, sheet.rows.length - 1),
    0
  );
  if (dataRows > MAX_IMPORT_ROWS
    || sheets.some((sheet) => sheet.rows.some((row) =>
      row.length > MAX_IMPORT_COLUMNS
      || row.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)))) {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_LIMIT_EXCEEDED"
    );
  }
}

function artifactCipherKey(masterSecret: string) {
  if (Buffer.byteLength(masterSecret.trim(), "utf8") < 32) {
    throw new TypeError(
      "masterSecret must contain at least 32 non-whitespace bytes"
    );
  }
  return createHash("sha256")
    .update("goodjob-acquisition-import-artifact-v1\u0000")
    .update(masterSecret)
    .digest();
}

function sealArtifact(key: Buffer, value: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value),
    cipher.final()
  ]);
  return [
    "artifact-v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

function openArtifact(key: Buffer, value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "artifact-v1"
    || !ivValue
    || !tagValue
    || !ciphertextValue) {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID"
    );
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final()
    ]);
  } catch {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID"
    );
  }
}

function abortIfRequested(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AcquisitionDiscoveryOperationError("ABORTED");
  }
}

function operationErrorCode(error: unknown) {
  return error instanceof AcquisitionDiscoveryOperationError
    ? error.code
    : "IMPORT_PROCESSING_FAILED";
}

function contentFetchOperationErrorCode(error: unknown) {
  return error instanceof AcquisitionDiscoveryOperationError
    ? error.code
    : "CONTENT_FETCH_FAILED";
}

function rowValue(
  record: Map<string, string>,
  column: string | undefined
) {
  return column ? String(record.get(column) ?? "").trim() : "";
}

function validPublishedAt(value: string) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID",
      "发布时间格式无效"
    );
  }
  return new Date(timestamp).toISOString();
}

function validImportedSourceUrl(value: string) {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID",
      "来源链接格式无效"
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AcquisitionDiscoveryOperationError(
      "IMPORT_ARTIFACT_INVALID",
      "来源链接必须是 HTTP(S)"
    );
  }
  return url.toString();
}

export interface AcquisitionDiscoveryOperationServiceOptions {
  repository: AcquisitionDiscoveryOperationRepository;
  evidence: AcquisitionDiscoveryEvidencePort;
  fetcher?: AcquisitionContentFetcherPort;
  masterSecret: string;
  idFactory?: (prefix: string) => string;
  now?: () => string;
}

export type AcquisitionImportOperationInput = {
  fileName: string;
  mediaType: AcquisitionImportOperation["mediaType"];
  subjectChannel: AcquisitionDiscoverySubjectChannel;
  columnMapping: AcquisitionImportColumnMapping;
} & (
  | { content: Uint8Array; contentBase64?: never }
  | { content?: never; contentBase64: string }
);

export class AcquisitionDiscoveryOperationService {
  private readonly repository: AcquisitionDiscoveryOperationRepository;
  private readonly evidence: AcquisitionDiscoveryEvidencePort;
  private readonly fetcher: AcquisitionContentFetcherPort;
  private readonly artifactKey: Buffer;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => string;
  private readonly runningFetch = new Map<
    string,
    Promise<AcquisitionContentFetchOperation>
  >();
  private readonly runningImport = new Map<
    string,
    Promise<AcquisitionImportOperation>
  >();

  constructor(options: AcquisitionDiscoveryOperationServiceOptions) {
    this.repository = options.repository;
    this.evidence = options.evidence;
    this.fetcher = options.fetcher ?? new ControlledPublicContentFetcher();
    this.artifactKey = artifactCipherKey(options.masterSecret);
    this.idFactory = options.idFactory
      ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createContentFetchOperation(
    rawScope: AcquisitionDiscoveryScope,
    input: {
      sourceUrl: string;
      subjectChannel: AcquisitionDiscoverySubjectChannel;
    },
    idempotencyKey: string
  ) {
    const scope = validatedScope(rawScope);
    const sourceUrl = validatePublicSourceUrl(input.sourceUrl).toString();
    if (!["organization", "individual"].includes(input.subjectChannel)) {
      throw new AcquisitionDiscoveryOperationError("INVALID_REQUEST");
    }
    const key = nonEmptyText(
      idempotencyKey,
      "Idempotency-Key",
      200
    );
    const requestHash = stableHash({
      sourceUrl,
      subjectChannel: input.subjectChannel
    });
    const operation: AcquisitionContentFetchOperationRecord = {
      id: this.idFactory("fetch"),
      ...scope,
      sourceUrl,
      finalUrl: null,
      subjectChannel: input.subjectChannel,
      status: "queued",
      accessStatus: null,
      httpStatus: null,
      contentType: null,
      title: null,
      rawArtifactHash: null,
      contentHash: null,
      evidenceCount: 0,
      errorCode: null,
      idempotencyKeyHash: keyHash(key),
      requestHash,
      createdAt: this.now(),
      startedAt: null,
      completedAt: null
    };
    const result =
      await this.repository.createContentFetchOperation(operation);
    return publicFetch(result.operation);
  }

  async getContentFetchOperation(
    rawScope: AcquisitionDiscoveryScope,
    id: string
  ) {
    const scope = validatedScope(rawScope);
    const operation =
      await this.repository.getContentFetchOperation(
        scope,
        nonEmptyText(id, "抓取操作 ID", 160)
      );
    if (!operation) {
      throw new AcquisitionDiscoveryOperationError("RESOURCE_NOT_FOUND");
    }
    return publicFetch(operation);
  }

  async listContentFetchOperations(
    rawScope: AcquisitionDiscoveryScope,
    options: { limit?: number } = {}
  ) {
    const scope = validatedScope(rawScope);
    const operations =
      await this.repository.listContentFetchOperations(
        scope,
        validatedListLimit(options.limit)
      );
    return operations.map(publicFetch);
  }

  executeContentFetchOperation(
    rawScope: AcquisitionDiscoveryScope,
    id: string,
    signal?: AbortSignal
  ) {
    const scope = validatedScope(rawScope);
    const operationId = nonEmptyText(id, "抓取操作 ID", 160);
    const key = [
      scope.ownerId,
      scope.teamId,
      operationId
    ].join("\u001f");
    const current = this.runningFetch.get(key);
    if (current) return current;
    const running = this.executeFetch(scope, operationId, signal);
    this.runningFetch.set(key, running);
    void running.then(
      () => this.runningFetch.delete(key),
      () => this.runningFetch.delete(key)
    );
    return running;
  }

  private async executeFetch(
    scope: AcquisitionDiscoveryScope,
    id: string,
    signal?: AbortSignal
  ) {
    abortIfRequested(signal);
    const claimed = await this.repository.claimContentFetchOperation(
      scope,
      id,
      this.now()
    );
    if (!claimed.operation) {
      throw new AcquisitionDiscoveryOperationError("RESOURCE_NOT_FOUND");
    }
    if (!claimed.claimed) {
      if (isTerminalFetch(claimed.operation.status)) {
        return publicFetch(claimed.operation);
      }
      throw new AcquisitionDiscoveryOperationError(
        "OPERATION_ALREADY_RUNNING"
      );
    }
    const operation = claimed.operation;
    try {
      const result = await this.fetcher.fetch(operation.sourceUrl, signal);
      abortIfRequested(signal);
      const restricted = result.status === "access_restricted";
      const evidence = await this.evidence.appendEvidence(
        scope,
        {
          targetType: operation.subjectChannel === "organization"
            ? "organization"
            : "individual_signal",
          sourcePlatform: new URL(result.finalUrl).hostname,
          sourceTitle: restricted
            ? "公开页面访问受限"
            : result.title || new URL(result.finalUrl).hostname,
          sourceSnippet: restricted
            ? "目标公开页面限制访问；系统未绕过登录、验证码或访问控制。"
            : normalizedWhitespace(result.text, 4_000),
          publishedAt: null,
          locale: "zh-CN",
          rawArtifactHash: result.rawArtifactHash,
          contentHash: result.contentHash,
          provenance: {
            kind: "user_submitted_url",
            sourceUrl: operation.sourceUrl,
            submittedBy: operation.actorId
          },
          accessStatus: result.accessStatus,
          supersedesEvidenceId: null
        },
        `fetch:${operation.id}:evidence:${result.contentHash}`
      );
      operation.finalUrl = result.finalUrl;
      operation.status = restricted ? "access_restricted" : "succeeded";
      operation.accessStatus = result.accessStatus;
      operation.httpStatus = result.httpStatus;
      operation.contentType = result.contentType;
      operation.title = result.title || null;
      operation.rawArtifactHash = result.rawArtifactHash;
      operation.contentHash = result.contentHash;
      operation.evidenceCount = evidence ? 1 : 0;
      operation.errorCode = null;
      operation.completedAt = this.now();
      await this.repository.putContentFetchOperation(operation);
      return publicFetch(operation);
    } catch (error) {
      operation.status = "failed";
      operation.errorCode = contentFetchOperationErrorCode(error);
      operation.completedAt = this.now();
      await this.repository.putContentFetchOperation(operation);
      throw error;
    }
  }

  async createImportOperation(
    rawScope: AcquisitionDiscoveryScope,
    input: AcquisitionImportOperationInput,
    idempotencyKey: string
  ) {
    const scope = validatedScope(rawScope);
    const fileName = nonEmptyText(input.fileName, "文件名", 255);
    if (![
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ].includes(input.mediaType)
      || !["organization", "individual"].includes(input.subjectChannel)) {
      throw new AcquisitionDiscoveryOperationError("INVALID_REQUEST");
    }
    const content = importContent(input);
    const artifactHash = hash(content);
    const columnMapping = normalizedMapping(input.columnMapping);
    const key = nonEmptyText(
      idempotencyKey,
      "Idempotency-Key",
      200
    );
    const requestHash = stableHash({
      fileName,
      mediaType: input.mediaType,
      subjectChannel: input.subjectChannel,
      artifactHash,
      columnMapping
    });
    const operation: AcquisitionImportOperationRecord = {
      id: this.idFactory("import"),
      ...scope,
      fileName,
      mediaType: input.mediaType,
      subjectChannel: input.subjectChannel,
      artifactHash,
      artifactCiphertext: sealArtifact(this.artifactKey, content),
      columnMapping,
      status: "queued",
      rowCount: 0,
      acceptedRowCount: 0,
      errorRows: [],
      errorCode: null,
      idempotencyKeyHash: keyHash(key),
      requestHash,
      createdAt: this.now(),
      startedAt: null,
      completedAt: null
    };
    const result = await this.repository.createImportOperation(operation);
    return publicImport(result.operation);
  }

  async getImportOperation(
    rawScope: AcquisitionDiscoveryScope,
    id: string
  ) {
    const scope = validatedScope(rawScope);
    const operation = await this.repository.getImportOperation(
      scope,
      nonEmptyText(id, "导入操作 ID", 160)
    );
    if (!operation) {
      throw new AcquisitionDiscoveryOperationError("RESOURCE_NOT_FOUND");
    }
    return publicImport(operation);
  }

  async listImportOperations(
    rawScope: AcquisitionDiscoveryScope,
    options: { limit?: number } = {}
  ) {
    const scope = validatedScope(rawScope);
    const operations = await this.repository.listImportOperations(
      scope,
      validatedListLimit(options.limit)
    );
    return operations.map(publicImport);
  }

  executeImportOperation(
    rawScope: AcquisitionDiscoveryScope,
    id: string,
    signal?: AbortSignal,
    options: { maxRows?: number } = {}
  ) {
    const scope = validatedScope(rawScope);
    const operationId = nonEmptyText(id, "导入操作 ID", 160);
    const key = [
      scope.ownerId,
      scope.teamId,
      operationId
    ].join("\u001f");
    const current = this.runningImport.get(key);
    if (current) return current;
    const maxRows = options.maxRows ?? MAX_IMPORT_ROWS;
    if (!Number.isSafeInteger(maxRows)
      || maxRows < 1
      || maxRows > MAX_IMPORT_ROWS) {
      throw new AcquisitionDiscoveryOperationError("INVALID_REQUEST");
    }
    const running = this.executeImport(
      scope,
      operationId,
      signal,
      maxRows
    );
    this.runningImport.set(key, running);
    void running.then(
      () => this.runningImport.delete(key),
      () => this.runningImport.delete(key)
    );
    return running;
  }

  private async executeImport(
    scope: AcquisitionDiscoveryScope,
    id: string,
    signal: AbortSignal | undefined,
    maxRows: number
  ) {
    abortIfRequested(signal);
    const claimed = await this.repository.claimImportOperation(
      scope,
      id,
      this.now()
    );
    if (!claimed.operation) {
      throw new AcquisitionDiscoveryOperationError("RESOURCE_NOT_FOUND");
    }
    if (!claimed.claimed) {
      if (isTerminalImport(claimed.operation.status)) {
        return publicImport(claimed.operation);
      }
      throw new AcquisitionDiscoveryOperationError(
        "OPERATION_ALREADY_RUNNING"
      );
    }
    const operation = claimed.operation;
    try {
      const content = openArtifact(
        this.artifactKey,
        operation.artifactCiphertext
      );
      if (hash(content) !== operation.artifactHash) {
        throw new AcquisitionDiscoveryOperationError(
          "IMPORT_ARTIFACT_INVALID"
        );
      }
      const sheets = operation.mediaType === "text/csv"
        ? parseCsv(content)
        : parseXlsx(content);
      validateImportShape(sheets);
      let rowCount = 0;
      let acceptedRowCount = 0;
      const errorRows: AcquisitionImportRowError[] = [];
      for (const sheet of sheets) {
        abortIfRequested(signal);
        const [headerRow = [], ...rows] = sheet.rows;
        const headers = headerRow.map((value) => value.trim());
        if (headers.length === 0
          || headers.some((header) => !header)
          || new Set(headers).size !== headers.length) {
          throw new AcquisitionDiscoveryOperationError(
            "IMPORT_ARTIFACT_INVALID",
            `工作表 ${sheet.name} 表头为空或重复`
          );
        }
        const requiredColumns = [
          operation.columnMapping.sourceTitle,
          operation.columnMapping.sourceSnippet
        ];
        if (requiredColumns.some((column) => !headers.includes(column))) {
          throw new AcquisitionDiscoveryOperationError(
            "IMPORT_ARTIFACT_INVALID",
            `工作表 ${sheet.name} 缺少必要映射列`
          );
        }
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          abortIfRequested(signal);
          const row = rows[rowIndex]!;
          if (row.every((value) => !String(value ?? "").trim())) continue;
          rowCount += 1;
          const rowNumber = rowIndex + 2;
          if (acceptedRowCount >= maxRows) {
            errorRows.push({
              sheetName: sheet.name,
              rowNumber,
              code: "IMPORT_BUDGET_LIMIT",
              message: "该行超出本次导入预算，未写入证据"
            });
            continue;
          }
          try {
            const record = new Map(
              headers.map((header, index) => [
                header,
                String(row[index] ?? "")
              ])
            );
            const title = rowValue(
              record,
              operation.columnMapping.sourceTitle
            );
            const snippet = rowValue(
              record,
              operation.columnMapping.sourceSnippet
            );
            if (!snippet || snippet.length > 4_000 || title.length > 500) {
              throw new AcquisitionDiscoveryOperationError(
                "IMPORT_ARTIFACT_INVALID",
                "标题或摘要为空/超长"
              );
            }
            const sourcePlatform = rowValue(
              record,
              operation.columnMapping.sourcePlatform
            ) || "customer_authorized_import";
            const importedSourceUrl = validImportedSourceUrl(rowValue(
              record,
              operation.columnMapping.sourceUrl
            ));
            const publishedAt = validPublishedAt(rowValue(
              record,
              operation.columnMapping.publishedAt
            ));
            const locale = rowValue(
              record,
              operation.columnMapping.locale
            ) || "zh-CN";
            const contentHash = stableHash({
              artifactHash: operation.artifactHash,
              sheetName: sheet.name,
              rowNumber,
              title,
              snippet,
              sourcePlatform,
              importedSourceUrl,
              publishedAt,
              locale
            });
            await this.evidence.appendEvidence(
              scope,
              {
                targetType:
                  operation.subjectChannel === "organization"
                    ? "organization"
                    : "individual_signal",
                sourcePlatform,
                sourceTitle: title,
                sourceSnippet: snippet,
                publishedAt,
                locale,
                rawArtifactHash: operation.artifactHash,
                contentHash,
                provenance: {
                  kind: "import_artifact_row",
                  importBatchId: operation.id,
                  artifactHash: operation.artifactHash,
                  sheetName: sheet.name,
                  rowNumber
                },
                accessStatus: "user_supplied",
                supersedesEvidenceId: null
              },
              `import:${operation.id}:${sheet.name}:${rowNumber}:${contentHash}`
            );
            acceptedRowCount += 1;
          } catch (error) {
            errorRows.push({
              sheetName: sheet.name,
              rowNumber,
              code: operationErrorCode(error),
              message: error instanceof Error
                ? error.message.slice(0, 500)
                : "导入行处理失败"
            });
          }
        }
      }
      operation.rowCount = rowCount;
      operation.acceptedRowCount = acceptedRowCount;
      operation.errorRows = errorRows.slice(0, MAX_IMPORT_ROWS);
      operation.status = acceptedRowCount === 0
        ? "failed"
        : errorRows.length > 0
          ? "partial_success"
          : "succeeded";
      operation.errorCode = acceptedRowCount === 0
        ? "IMPORT_PROCESSING_FAILED"
        : null;
      operation.completedAt = this.now();
      await this.repository.putImportOperation(operation);
      return publicImport(operation);
    } catch (error) {
      operation.status = "failed";
      operation.errorCode = operationErrorCode(error);
      operation.completedAt = this.now();
      await this.repository.putImportOperation(operation);
      throw error;
    }
  }
}
