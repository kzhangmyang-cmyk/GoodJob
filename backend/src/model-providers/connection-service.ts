import { createHash, randomUUID } from "node:crypto";
import {
  createCredentialRef,
  encryptAiModelApiKey
} from "../credential-security.js";
import {
  MODEL_PROVIDER_IDS,
  ModelConnectionError
} from "./types.js";
import type { AiModelConfig } from "../types.js";
import type {
  ModelConnection,
  ModelConnectionActivationEvent,
  ModelConnectionScope,
  ModelCredentialVersion,
  StoredAiJobModelSnapshot
} from "./types.js";

export const requiredNodeVersion = ">=22.19.0";

export function createAiModelConfigId() {
  return `ai_${randomUUID()}`;
}

export const EMPTY_MODEL_CAPABILITY_SNAPSHOT = Object.freeze({
  structuredOutput: false,
  toolCalling: false,
  parallelToolCalling: false,
  streaming: false,
  modelListing: false
});

export function modelConnectionFromAiConfig(
  config: AiModelConfig
): ModelConnection {
  if (!MODEL_PROVIDER_IDS.includes(
    config.provider as (typeof MODEL_PROVIDER_IDS)[number]
  )) {
    throw new ModelConnectionError(
      "connection_not_found",
      "该旧版模型配置不属于受支持的官方 Provider",
      404
    );
  }
  return {
    id: config.id,
    ownerId: config.ownerId,
    teamId: config.teamId,
    provider: config.provider as ModelConnection["provider"],
    model: config.model,
    baseUrlFingerprint: `sha256:${createHash("sha256")
      .update(config.baseUrl)
      .digest("hex")}`,
    credentialVersion: config.credentialVersion || 1,
    capabilitySnapshot: {
      ...EMPTY_MODEL_CAPABILITY_SNAPSHOT,
      ...(config.capabilitySnapshot || {})
    },
    status: config.enabled ? "active" : "inactive",
    createdAt: config.createdAt || config.updatedAt,
    updatedAt: config.updatedAt
  };
}

interface LegacyActiveConnection {
  id: string;
  ownerId: string;
  enabled: boolean;
  updatedAt: string;
}

export function selectLegacyActiveConnectionIds(
  connections: LegacyActiveConnection[]
) {
  const selected = new Map<string, string>();
  const enabled = connections
    .filter((item) => item.enabled)
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return left.updatedAt < right.updatedAt ? 1 : -1;
      }
      if (left.id === right.id) return 0;
      return left.id < right.id ? -1 : 1;
    });
  for (const item of enabled) {
    if (!selected.has(item.ownerId)) selected.set(item.ownerId, item.id);
  }
  return selected;
}

export interface ModelConnectionActivationStore {
  connections: ModelConnection[];
  activationEvents: ModelConnectionActivationEvent[];
  persist(): Promise<void>;
  activateModelConnectionTransaction?(
    scope: ModelConnectionScope,
    connectionId: string,
    actorId: string,
    reason: string
  ): Promise<ModelConnection>;
}

export async function activateModelConnection(
  store: ModelConnectionActivationStore,
  scope: ModelConnectionScope,
  connectionId: string,
  actorId: string,
  reason: string
) {
  if (store.activateModelConnectionTransaction) {
    return store.activateModelConnectionTransaction(
      scope,
      connectionId,
      actorId,
      reason
    );
  }
  const target = store.connections.find(
    (item) => item.id === connectionId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
  );
  if (!target) {
    throw new ModelConnectionError(
      "connection_not_found",
      "模型连接不存在或不属于当前用户",
      404
    );
  }
  const previous = store.connections.find(
    (item) => item.ownerId === scope.ownerId
      && item.status === "active"
  );
  const before = store.connections.map((item) => ({
    item,
    status: item.status,
    updatedAt: item.updatedAt
  }));
  const now = new Date().toISOString();
  for (const item of store.connections) {
    if (item.ownerId !== scope.ownerId) continue;
    item.status = item.id === target.id ? "active" : "inactive";
    item.updatedAt = now;
  }
  const event: ModelConnectionActivationEvent = {
    id: `mca_${randomUUID()}`,
    ownerId: scope.ownerId,
    teamId: scope.teamId,
    actorId,
    previousConnectionId: previous?.id || null,
    connectionId: target.id,
    reason,
    createdAt: now
  };
  store.activationEvents.push(event);
  try {
    await store.persist();
  } catch (error) {
    for (const state of before) {
      state.item.status = state.status;
      state.item.updatedAt = state.updatedAt;
    }
    store.activationEvents.pop();
    throw error;
  }
  return target;
}

export function createModelCredentialVersion(
  credentials: ModelCredentialVersion[],
  connection: ModelConnection,
  apiKey: string,
  actorId: string,
  now = new Date().toISOString()
) {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new ModelConnectionError(
      "credential_not_found",
      "API Key 不能为空",
      404
    );
  }
  const existingVersions = credentials
    .filter((item) => item.connectionId === connection.id)
    .map((item) => item.version);
  const version = existingVersions.length
    ? Math.max(...existingVersions) + 1
    : 1;
  const teamId = connection.teamId || "";
  const credential: ModelCredentialVersion = {
    connectionId: connection.id,
    ownerId: connection.ownerId,
    teamId,
    version,
    credentialRef: createCredentialRef(),
    apiKeyEncrypted: encryptAiModelApiKey({
      id: connection.id,
      provider: connection.provider,
      ownerId: connection.ownerId,
      teamId
    }, normalizedKey),
    keyMask: normalizedKey.slice(-4),
    createdBy: actorId,
    createdAt: now
  };
  credentials.push(credential);
  connection.credentialVersion = version;
  connection.updatedAt = now;
  return credential;
}

export function toPublicModelConnection(
  connection: ModelConnection,
  credential?: ModelCredentialVersion
) {
  return {
    ...connection,
    hasKey: Boolean(credential),
    apiKey: credential ? `****${credential.keyMask}` : ""
  };
}

interface ModelConnectionDeletionStore {
  connections: ModelConnection[];
  jobSnapshots: StoredAiJobModelSnapshot[];
  persist(): Promise<void>;
  deleteModelConnectionTransaction?(
    scope: ModelConnectionScope,
    connectionId: string
  ): Promise<ModelConnection>;
}

export async function deleteModelConnection(
  store: ModelConnectionDeletionStore,
  scope: ModelConnectionScope,
  connectionId: string
) {
  if (store.deleteModelConnectionTransaction) {
    return store.deleteModelConnectionTransaction(scope, connectionId);
  }
  const index = store.connections.findIndex(
    (item) => item.id === connectionId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
  );
  if (index < 0) {
    throw new ModelConnectionError(
      "connection_not_found",
      "模型连接不存在或不属于当前用户",
      404
    );
  }
  if (store.connections[index].status === "active"
    || store.jobSnapshots.some(
    (item) => item.connectionId === connectionId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
  )) {
    throw new ModelConnectionError(
      "connection_in_use",
      "模型连接当前仍在启用或被任务快照引用，只能先停用",
      409
    );
  }
  const [removed] = store.connections.splice(index, 1);
  try {
    await store.persist();
  } catch (error) {
    store.connections.splice(index, 0, removed);
    throw error;
  }
  return removed;
}
