import type {
  ModelConnectionActivationEvent,
  ModelConnectionIdempotencyRecord,
  ModelCredentialVersion,
  StoredAiJobModelSnapshot
} from "./types.js";

export interface PendingModelAppendBatches {
  pendingModelCredentialVersions: ModelCredentialVersion[];
  pendingModelConnectionActivationEvents:
    ModelConnectionActivationEvent[];
  pendingAiJobModelSnapshots: StoredAiJobModelSnapshot[];
  pendingModelConnectionIdempotencyRecords:
    ModelConnectionIdempotencyRecord[];
}

function removePersisted<T>(
  live: T[],
  persisted: T[],
  key: (item: T) => string
) {
  const persistedKeys = new Set(persisted.map(key));
  live.splice(
    0,
    live.length,
    ...live.filter((item) => !persistedKeys.has(key(item)))
  );
}

export function clearPersistedModelAppendBatches(
  live: PendingModelAppendBatches,
  persisted: PendingModelAppendBatches
) {
  removePersisted(
    live.pendingModelCredentialVersions,
    persisted.pendingModelCredentialVersions,
    (item) => `${item.connectionId}:${item.version}`
  );
  removePersisted(
    live.pendingModelConnectionActivationEvents,
    persisted.pendingModelConnectionActivationEvents,
    (item) => item.id
  );
  removePersisted(
    live.pendingAiJobModelSnapshots,
    persisted.pendingAiJobModelSnapshots,
    (item) => item.jobId
  );
  removePersisted(
    live.pendingModelConnectionIdempotencyRecords,
    persisted.pendingModelConnectionIdempotencyRecords,
    (item) => `${item.ownerId}:${item.idempotencyKeyHash}`
  );
}

export async function persistThenClearModelAppendBatches(
  live: PendingModelAppendBatches,
  persisted: PendingModelAppendBatches,
  persist: () => Promise<void>
) {
  await persist();
  clearPersistedModelAppendBatches(live, persisted);
}
