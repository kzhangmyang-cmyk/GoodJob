export const MODEL_PROVIDER_IDS = [
  "openai",
  "moonshot",
  "minimax",
  "zhipu",
  "deepseek",
  "qwen",
  "doubao",
  "hunyuan",
  "qianfan"
] as const;

export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

export type ModelCapabilityStatus =
  | "supported"
  | "unsupported"
  | "not_exposed";

export interface ModelCapabilityStatuses {
  structuredOutput: ModelCapabilityStatus;
  toolCalling: ModelCapabilityStatus;
  parallelToolCalling: ModelCapabilityStatus;
  streaming: ModelCapabilityStatus;
  modelListing: ModelCapabilityStatus;
}

export interface ModelCapabilitySnapshot {
  structuredOutput: boolean;
  toolCalling: boolean;
  parallelToolCalling: boolean;
  streaming: boolean;
  modelListing: boolean;
}

export interface ModelConnection {
  id: string;
  ownerId: string;
  teamId: string | null;
  provider: ModelProviderId;
  model: string;
  baseUrlFingerprint?: string;
  credentialVersion: number;
  capabilitySnapshot: ModelCapabilitySnapshot;
  status: "active" | "inactive" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface ModelCredentialVersion {
  connectionId: string;
  ownerId: string;
  teamId: string;
  version: number;
  credentialRef: string;
  apiKeyEncrypted: string;
  keyMask: string;
  createdBy: string;
  createdAt: string;
}

export interface ModelConnectionActivationEvent {
  id: string;
  ownerId: string;
  teamId: string;
  actorId: string;
  previousConnectionId: string | null;
  connectionId: string;
  reason: string;
  createdAt: string;
}

export interface AiJobModelSnapshot {
  connectionId: string;
  credentialVersion: number;
  provider: ModelProviderId;
  model: string;
  capabilitySnapshot: ModelCapabilitySnapshot;
  promptVersion: string;
  schemaVersion: string;
}

export interface StoredAiJobModelSnapshot extends AiJobModelSnapshot {
  jobId: string;
  ownerId: string;
  teamId: string;
  createdAt: string;
}

export interface ModelConnectionIdempotencyRecord {
  ownerId: string;
  teamId: string;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: string;
}

export interface ModelConnectionScope {
  ownerId: string;
  teamId: string;
}

export class ModelConnectionError extends Error {
  constructor(
    public readonly code:
      | "connection_not_found"
      | "connection_in_use"
      | "credential_not_found"
      | "idempotency_key_required"
      | "idempotency_key_invalid"
      | "idempotency_key_conflict",
    message: string,
    public readonly status: 400 | 404 | 409,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ModelConnectionError";
  }
}
