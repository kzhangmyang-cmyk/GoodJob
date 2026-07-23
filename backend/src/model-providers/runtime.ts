import { createHash, randomUUID } from "node:crypto";
import { decryptAiModelApiKey } from "../credential-security.js";
import type { AiModelConfig } from "../types.js";
import {
  AppendOnlyModelCallLedger
} from "./call-ledger.js";
import type {
  AppendOnlyModelCallLedgerOptions,
  ModelCallLedger,
  ModelCallRecord,
  NewModelCallRecord
} from "./call-ledger.js";
import {
  ActiveModelGateway
} from "./gateway.js";
import { createAiJobModelSnapshot } from "./job-snapshot.js";
import { modelConnectionFromAiConfig } from "./connection-service.js";
import type {
  ModelCredentialVersion,
  StoredAiJobModelSnapshot
} from "./types.js";
import {
  MODEL_PROVIDER_IDS
} from "./types.js";

export interface ModelRuntimeStore {
  aiModelConfigs: AiModelConfig[];
  modelCredentialVersions: ModelCredentialVersion[];
  aiJobModelSnapshots: StoredAiJobModelSnapshot[];
  pendingAiJobModelSnapshots: StoredAiJobModelSnapshot[];
  modelCallRecords: ModelCallRecord[];
  pendingModelCallRecords: ModelCallRecord[];
}

export interface BindActiveModelSnapshotInput {
  jobId: string;
  ownerId: string;
  teamId: string;
  promptVersion: string;
  schemaVersion: string;
}

export interface BindModelConnectionSnapshotInput
  extends BindActiveModelSnapshotInput {
  connectionId: string;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function bindActiveModelSnapshot(
  store: ModelRuntimeStore,
  input: BindActiveModelSnapshotInput
) {
  const existing = store.aiJobModelSnapshots.find(
    (item) => item.jobId === input.jobId
      && item.ownerId === input.ownerId
      && item.teamId === input.teamId
  );
  if (existing) return existing;
  const active = store.aiModelConfigs.find(
    (item) => item.ownerId === input.ownerId
      && item.teamId === input.teamId
      && item.enabled
      && MODEL_PROVIDER_IDS.includes(
        item.provider as (typeof MODEL_PROVIDER_IDS)[number]
      )
  );
  if (!active) {
    throw new Error("No active official model connection for AI job");
  }
  return bindModelConnectionSnapshot(store, {
    ...input,
    connectionId: active.id
  });
}

export function bindModelConnectionSnapshot(
  store: ModelRuntimeStore,
  input: BindModelConnectionSnapshotInput
) {
  const existing = store.aiJobModelSnapshots.find(
    (item) => item.jobId === input.jobId
      && item.ownerId === input.ownerId
      && item.teamId === input.teamId
  );
  if (existing) return existing;
  const config = store.aiModelConfigs.find(
    (item) => item.id === input.connectionId
      && item.ownerId === input.ownerId
      && item.teamId === input.teamId
  );
  if (!config) {
    throw new Error("Official model connection for AI job is unavailable");
  }
  const connection = modelConnectionFromAiConfig(config);
  const snapshot: StoredAiJobModelSnapshot = Object.freeze({
    ...createAiJobModelSnapshot(
      connection,
      config.credentialVersion || connection.credentialVersion,
      {
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion
      }
    ),
    jobId: input.jobId,
    ownerId: input.ownerId,
    teamId: input.teamId,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    baseUrlFingerprint:
      connection.baseUrlFingerprint || sha256(config.baseUrl),
    createdAt: new Date().toISOString()
  });
  store.aiJobModelSnapshots.push(snapshot);
  store.pendingAiJobModelSnapshots.push(snapshot);
  return snapshot;
}

export async function resolveSnapshottedModelCredential(
  store: Pick<
    ModelRuntimeStore,
    "aiModelConfigs" | "modelCredentialVersions"
  >,
  connectionId: string,
  credentialVersion: number
) {
  const config = store.aiModelConfigs.find(
    (item) => item.id === connectionId
  );
  const credential = store.modelCredentialVersions.find(
    (item) => item.connectionId === connectionId
      && item.version === credentialVersion
  );
  if (!config || !credential) {
    throw new Error("Snapshotted credential version is unavailable");
  }
  return decryptAiModelApiKey({
    id: config.id,
    provider: config.provider,
    ownerId: credential.ownerId,
    teamId: credential.teamId
  }, credential.apiKeyEncrypted);
}

export function createStoreModelCallLedger(
  store: Pick<
    ModelRuntimeStore,
    "modelCallRecords" | "pendingModelCallRecords"
  >,
  options: AppendOnlyModelCallLedgerOptions = {}
): ModelCallLedger {
  const allocator = new AppendOnlyModelCallLedger(options);
  return {
    append(record: NewModelCallRecord) {
      const stored = allocator.append(record);
      store.modelCallRecords.push(stored);
      store.pendingModelCallRecords.push(stored);
      return stored;
    },
    get records() {
      return Object.freeze([...store.modelCallRecords]);
    }
  };
}

export interface CreateActiveModelGatewayForSnapshotOptions {
  storedSnapshot: StoredAiJobModelSnapshot;
  fetch: typeof fetch;
  attemptIdFactory?: () => string;
  requestIdFactory?: () => string;
  now?: () => number;
  requestTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
}

export function createActiveModelGatewayForSnapshot(
  store: ModelRuntimeStore,
  options: CreateActiveModelGatewayForSnapshotOptions
) {
  const config = store.aiModelConfigs.find(
    (item) => item.id === options.storedSnapshot.connectionId
      && item.ownerId === options.storedSnapshot.ownerId
      && item.teamId === options.storedSnapshot.teamId
  );
  if (!config) {
    throw new Error("Snapshotted model connection is unavailable");
  }
  if (!options.storedSnapshot.baseUrl
    || !options.storedSnapshot.baseUrlFingerprint) {
    throw new Error("Snapshotted model endpoint is unavailable");
  }
  const capabilitySnapshotHash = sha256(
    JSON.stringify(options.storedSnapshot.capabilitySnapshot)
  );
  return new ActiveModelGateway({
    snapshot: options.storedSnapshot,
    identity: {
      ownerId: options.storedSnapshot.ownerId,
      teamId: options.storedSnapshot.teamId,
      jobId: options.storedSnapshot.jobId
    },
    capabilitySnapshotHash,
    baseUrl: options.storedSnapshot.baseUrl,
    baseUrlFingerprint: options.storedSnapshot.baseUrlFingerprint,
    credentialResolver: (connectionId, credentialVersion) =>
      resolveSnapshottedModelCredential(
        store,
        connectionId,
        credentialVersion
      ),
    fetch: options.fetch,
    ledger: createStoreModelCallLedger(store),
    attemptIdFactory:
      options.attemptIdFactory
      ?? (() => `model_attempt_${randomUUID()}`),
    requestIdFactory:
      options.requestIdFactory
      ?? (() => `model_request_${randomUUID()}`),
    now: options.now,
    requestTimeoutMs: options.requestTimeoutMs,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs
  });
}
