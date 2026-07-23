import { createHash, createHmac } from "node:crypto";
import { canonicalJsonStringify } from "../canonical-json.js";
import {
  ModelConnectionError
} from "./types.js";
import type {
  ModelConnectionIdempotencyRecord
} from "./types.js";

interface ModelConnectionIdempotencyStore {
  modelConnectionIdempotencyRecords: ModelConnectionIdempotencyRecord[];
  pendingModelConnectionIdempotencyRecords: ModelConnectionIdempotencyRecord[];
  persist(): Promise<void>;
}

interface ModelConnectionWriteRequest {
  ownerId: string;
  teamId: string;
  idempotencyKey: string;
  method: string;
  path: string;
  body: unknown;
}

interface ModelConnectionWriteResponse {
  status: number;
  body: unknown;
  rollback?(): void | Promise<void>;
}

const storeTails = new WeakMap<object, Promise<unknown>>();

function idempotencySecret() {
  const secret = process.env.MODEL_CONNECTION_IDEMPOTENCY_SECRET
    || process.env.JWT_SECRET
    || "goodjob-model-connection-idempotency-development";
  if (process.env.NODE_ENV === "production"
    && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "MODEL_CONNECTION_IDEMPOTENCY_SECRET 必须至少包含 32 个字符"
    );
  }
  return secret;
}

export function modelConnectionIdempotencyKeyHash(rawKey: string) {
  return createHmac("sha256", idempotencySecret())
    .update(rawKey.trim())
    .digest("hex");
}

export function modelConnectionRequestFingerprint(
  request: Pick<ModelConnectionWriteRequest, "method" | "path" | "body">
) {
  return createHash("sha256")
    .update(canonicalJsonStringify({
      method: request.method.toUpperCase(),
      path: request.path,
      body: request.body
    }))
    .digest("hex");
}

function runExclusive<T>(store: object, operation: () => Promise<T>) {
  const previous = storeTails.get(store) || Promise.resolve();
  const current = previous.then(operation, operation);
  storeTails.set(store, current.catch(() => undefined));
  return current;
}

export function requireModelConnectionIdempotencyKey(rawKey: string) {
  const normalized = rawKey.trim();
  if (!normalized) {
    throw new ModelConnectionError(
      "idempotency_key_required",
      "必须提供 Idempotency-Key 请求头",
      400
    );
  }
  if (normalized.length > 200) {
    throw new ModelConnectionError(
      "idempotency_key_invalid",
      "Idempotency-Key 最多允许 200 个字符",
      400
    );
  }
  return normalized;
}

export async function executeModelConnectionWriteIdempotently(
  store: ModelConnectionIdempotencyStore,
  request: ModelConnectionWriteRequest,
  operation: () => Promise<ModelConnectionWriteResponse>
) {
  const idempotencyKey = requireModelConnectionIdempotencyKey(
    request.idempotencyKey
  );
  const idempotencyKeyHash = modelConnectionIdempotencyKeyHash(
    idempotencyKey
  );
  const requestFingerprint = modelConnectionRequestFingerprint(request);
  return runExclusive(store, async () => {
    const existing = store.modelConnectionIdempotencyRecords.find(
      (item) => item.ownerId === request.ownerId
        && item.idempotencyKeyHash === idempotencyKeyHash
    );
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new ModelConnectionError(
          "idempotency_key_conflict",
          "该 Idempotency-Key 已用于不同的模型连接请求",
          409,
          `req_idem_${idempotencyKeyHash.slice(0, 24)}`
        );
      }
      return {
        status: existing.responseStatus,
        body: structuredClone(existing.responseBody),
        replayed: true
      };
    }

    const response = await operation();
    const record: ModelConnectionIdempotencyRecord = {
      ownerId: request.ownerId,
      teamId: request.teamId,
      idempotencyKeyHash,
      requestFingerprint,
      responseStatus: response.status,
      responseBody: structuredClone(response.body),
      createdAt: new Date().toISOString()
    };
    store.modelConnectionIdempotencyRecords.push(record);
    store.pendingModelConnectionIdempotencyRecords.push(record);
    try {
      await store.persist();
    } catch (error) {
      const historyIndex =
        store.modelConnectionIdempotencyRecords.lastIndexOf(record);
      if (historyIndex >= 0) {
        store.modelConnectionIdempotencyRecords.splice(historyIndex, 1);
      }
      const pendingIndex =
        store.pendingModelConnectionIdempotencyRecords.lastIndexOf(record);
      if (pendingIndex >= 0) {
        store.pendingModelConnectionIdempotencyRecords.splice(
          pendingIndex,
          1
        );
      }
      try {
        await response.rollback?.();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "模型连接写入及回滚均失败"
        );
      }
      throw error;
    }
    return {
      status: response.status,
      body: response.body,
      replayed: false
    };
  });
}
