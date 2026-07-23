import { createHash } from "node:crypto";
import {
  createAiHttpClient
} from "./ai-http-security.js";
import type {
  AcquisitionPiRuntimeFactory
} from "./acquisition-copilot-runner.js";
import {
  ActiveModelGatewayAcquisitionPiRuntime,
  type AcquisitionPiGatewayPort
} from "./acquisition-pi-gateway-runtime.js";
import {
  createActiveModelGatewayForSnapshot,
  type ModelRuntimeStore
} from "./model-providers/runtime.js";
import type {
  StoredAiJobModelSnapshot
} from "./model-providers/types.js";

type SnapshotStore = Pick<ModelRuntimeStore, "aiJobModelSnapshots">
  & Partial<ModelRuntimeStore>;

export interface CreateAcquisitionPiRuntimeFactoryOptions {
  store: SnapshotStore;
  gatewayFactory?: (
    snapshot: StoredAiJobModelSnapshot
  ) => AcquisitionPiGatewayPort;
}

function capabilityHash(snapshot: StoredAiJobModelSnapshot) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(snapshot.capabilitySnapshot))
    .digest("hex")}`;
}

function requireCompleteModelRuntimeStore(
  store: SnapshotStore
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

function defaultGatewayFactory(
  store: SnapshotStore,
  snapshot: StoredAiJobModelSnapshot
) {
  const completeStore = requireCompleteModelRuntimeStore(store);
  const client = createAiHttpClient(snapshot.baseUrl);
  return createActiveModelGatewayForSnapshot(completeStore, {
    storedSnapshot: snapshot,
    fetch: ((url: string | URL | Request, init?: RequestInit) =>
      client.fetch(String(url), init)) as typeof fetch
  });
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

export function createAcquisitionPiRuntimeFactory(
  options: CreateAcquisitionPiRuntimeFactoryOptions
): AcquisitionPiRuntimeFactory {
  return {
    async create(input) {
      const stored = options.store.aiJobModelSnapshots.find((snapshot) =>
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
      if (!stored.capabilitySnapshot.toolCalling) {
        throw new Error("MODEL_TOOL_CALLING_UNAVAILABLE");
      }
      const immutableSnapshot = structuredClone(stored);
      const gateway = options.gatewayFactory
        ? options.gatewayFactory(immutableSnapshot)
        : defaultGatewayFactory(options.store, immutableSnapshot);
      return new ActiveModelGatewayAcquisitionPiRuntime({
        snapshot: structuredClone(input.snapshot),
        gateway
      });
    }
  };
}
