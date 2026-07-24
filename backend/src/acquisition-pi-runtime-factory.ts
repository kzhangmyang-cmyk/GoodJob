import { createHash } from "node:crypto";
import {
  createAiHttpClient
} from "./ai-http-security.js";
import type {
  AcquisitionPiRuntimeFactory,
  AcquisitionPiRuntimeFactoryInput
} from "./acquisition-copilot-runner.js";
import {
  ActiveModelGatewayAcquisitionPiRuntime,
  type AcquisitionPiGatewayPort
} from "./acquisition-pi-gateway-runtime.js";
import {
  ACQUISITION_MODEL_CONTENT_BUNDLE,
  ACQUISITION_MODEL_CONTENT_HASHES,
  ACQUISITION_MODEL_PROMPT_VERSION,
  ACQUISITION_MODEL_SCHEMA_VERSION,
  DEFAULT_ACQUISITION_PI_SYSTEM_PROMPT
} from "./acquisition-model-content.js";
import {
  bindActiveModelSnapshot,
  bindModelConnectionSnapshot,
  createActiveModelGatewayForSnapshot,
  type ModelRuntimeStore
} from "./model-providers/runtime.js";
import {
  modelContentBundleHashes,
  type ModelContentBundle
} from "./model-providers/gateway.js";
import type {
  StoredAiJobModelSnapshot
} from "./model-providers/types.js";

export type AcquisitionModelSnapshotStore =
  Pick<ModelRuntimeStore, "aiJobModelSnapshots">
  & Partial<ModelRuntimeStore>;

export interface BindActiveAcquisitionModelSnapshotInput {
  jobId: string;
  ownerId: string;
  teamId: string;
  connectionId?: string;
}

/**
 * Server-side acquisition session/job binder. Callers supply only trusted
 * scope and the server-generated job id; model and content identities come
 * from the active official connection and this server bundle.
 */
export function bindActiveAcquisitionModelSnapshot(
  store: ModelRuntimeStore,
  input: BindActiveAcquisitionModelSnapshotInput
) {
  const content = {
    jobId: input.jobId,
    ownerId: input.ownerId,
    teamId: input.teamId,
    promptVersion: ACQUISITION_MODEL_PROMPT_VERSION,
    schemaVersion: ACQUISITION_MODEL_SCHEMA_VERSION,
    promptHash: ACQUISITION_MODEL_CONTENT_HASHES.promptHash,
    schemaHash: ACQUISITION_MODEL_CONTENT_HASHES.schemaHash
  };
  return input.connectionId
    ? bindModelConnectionSnapshot(store, {
        ...content,
        connectionId: input.connectionId
      })
    : bindActiveModelSnapshot(store, content);
}

export interface CreateAcquisitionPiRuntimeFactoryOptions {
  store: AcquisitionModelSnapshotStore;
  gatewayFactory?: (
    snapshot: StoredAiJobModelSnapshot,
    contentBundle: ModelContentBundle
  ) => AcquisitionPiGatewayPort;
  contentBundle?: ModelContentBundle;
  systemPrompt?: string;
}

function capabilityHash(snapshot: StoredAiJobModelSnapshot) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(snapshot.capabilitySnapshot))
    .digest("hex")}`;
}

function requireCompleteModelRuntimeStore(
  store: AcquisitionModelSnapshotStore
): ModelRuntimeStore {
  const arrays = [
    "aiModelConfigs",
    "modelCredentialVersions",
    "pendingAiJobModelSnapshots",
    "modelCallRecords",
    "pendingModelCallRecords"
  ] as const;
  for (const key of arrays) {
    if (!Array.isArray(store[key])) {
      throw new Error("MODEL_RUNTIME_STORE_INCOMPLETE");
    }
  }
  return store as ModelRuntimeStore;
}

function gatewayForContentBundle(
  store: AcquisitionModelSnapshotStore,
  snapshot: StoredAiJobModelSnapshot,
  contentBundle: ModelContentBundle
) {
  const completeStore = requireCompleteModelRuntimeStore(store);
  const client = createAiHttpClient(snapshot.baseUrl);
  return createActiveModelGatewayForSnapshot(completeStore, {
    storedSnapshot: snapshot,
    contentBundle,
    fetch: ((url: string | URL | Request, init?: RequestInit) =>
      client.fetch(String(url), init)) as typeof fetch
  });
}

export function createAcquisitionModelGatewayForSnapshot(
  store: AcquisitionModelSnapshotStore,
  snapshot: StoredAiJobModelSnapshot
) {
  if (snapshot.promptHash !== ACQUISITION_MODEL_CONTENT_HASHES.promptHash
    || snapshot.schemaHash !== ACQUISITION_MODEL_CONTENT_HASHES.schemaHash
    || snapshot.promptVersion !== ACQUISITION_MODEL_PROMPT_VERSION
    || snapshot.schemaVersion !== ACQUISITION_MODEL_SCHEMA_VERSION) {
    throw new Error("MODEL_CONTENT_HASH_MISMATCH");
  }
  return gatewayForContentBundle(
    store,
    snapshot,
    ACQUISITION_MODEL_CONTENT_BUNDLE
  );
}

function snapshotMatches(
  stored: StoredAiJobModelSnapshot,
  requested: Parameters<AcquisitionPiRuntimeFactory["create"]>[0]["snapshot"]
) {
  return stored.jobId === requested.jobId
    && stored.connectionId === requested.connectionId
    && stored.credentialVersion === requested.credentialVersion
    && stored.provider === requested.provider
    && stored.model === requested.model
    && stored.promptVersion === requested.promptVersion
    && stored.schemaVersion === requested.schemaVersion
    && stored.promptHash === requested.promptHash
    && stored.schemaHash === requested.schemaHash
    && capabilityHash(stored) === requested.capabilitySnapshotHash
    && stored.baseUrlFingerprint === requested.baseUrlFingerprint;
}

export function acquisitionPiModelSnapshotFromStored(
  stored: StoredAiJobModelSnapshot
) {
  return Object.freeze({
    jobId: stored.jobId,
    connectionId: stored.connectionId,
    credentialVersion: stored.credentialVersion,
    provider: stored.provider,
    model: stored.model,
    promptVersion: stored.promptVersion,
    schemaVersion: stored.schemaVersion,
    promptHash: stored.promptHash,
    schemaHash: stored.schemaHash,
    capabilitySnapshotHash: capabilityHash(stored),
    baseUrlFingerprint: stored.baseUrlFingerprint
  });
}

function resolveSnapshot(
  store: AcquisitionModelSnapshotStore,
  input: AcquisitionPiRuntimeFactoryInput,
  contentBundle: ModelContentBundle
) {
  const stored = store.aiJobModelSnapshots.find((snapshot) =>
    snapshot.jobId === input.snapshot.jobId
    && snapshot.ownerId === input.identity.ownerId
    && snapshot.teamId === input.identity.teamId
  );
  if (!stored) {
    throw new Error("MODEL_SNAPSHOT_UNAVAILABLE");
  }
  if (!snapshotMatches(stored, input.snapshot)) {
    throw new Error("MODEL_SNAPSHOT_MISMATCH");
  }
  const contentHashes = modelContentBundleHashes(contentBundle);
  if (stored.promptHash !== contentHashes.promptHash
    || stored.schemaHash !== contentHashes.schemaHash
    || stored.promptVersion !== ACQUISITION_MODEL_PROMPT_VERSION
    || stored.schemaVersion !== ACQUISITION_MODEL_SCHEMA_VERSION) {
    throw new Error("MODEL_CONTENT_HASH_MISMATCH");
  }
  if (!stored.capabilitySnapshot.toolCalling) {
    throw new Error("MODEL_TOOL_CALLING_UNAVAILABLE");
  }
  return structuredClone(stored);
}

export function resolveStoredAcquisitionModelSnapshot(
  store: AcquisitionModelSnapshotStore,
  input: AcquisitionPiRuntimeFactoryInput
) {
  return resolveSnapshot(
    store,
    input,
    ACQUISITION_MODEL_CONTENT_BUNDLE
  );
}

export function createAcquisitionPiRuntimeFactory(
  options: CreateAcquisitionPiRuntimeFactoryOptions
): AcquisitionPiRuntimeFactory {
  const contentBundle =
    options.contentBundle ?? ACQUISITION_MODEL_CONTENT_BUNDLE;
  const systemPrompt = options.systemPrompt?.trim()
    || DEFAULT_ACQUISITION_PI_SYSTEM_PROMPT;
  return {
    async create(input) {
      const immutableSnapshot = resolveSnapshot(
        options.store,
        input,
        contentBundle
      );
      const gateway = options.gatewayFactory
        ? options.gatewayFactory(immutableSnapshot, contentBundle)
        : gatewayForContentBundle(
            options.store,
            immutableSnapshot,
            contentBundle
          );
      return new ActiveModelGatewayAcquisitionPiRuntime({
        snapshot: structuredClone(input.snapshot),
        gateway,
        contentBundle,
        systemPrompt
      });
    }
  };
}
