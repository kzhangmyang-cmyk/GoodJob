import { createHash, randomUUID } from "node:crypto";
import type { DiscoveryEvidence } from "./acquisition-domain.js";
import type {
  DouyinIdentityEvidence,
  DouyinIdentityResolutionOutcome
} from "./acquisition-douyin-identity-consensus.js";
import { canonicalJsonStringify } from "./canonical-json.js";

export type AcquisitionDouyinIdentityResolutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "requires_review"
  | "failed";

export type AcquisitionDouyinIdentityResolutionStage =
  | "public_page"
  | "independent_search"
  | "consensus_gate"
  | "identity_confirmation"
  | "intelligence_dispatch";

export interface AcquisitionDouyinIdentityResolutionScope {
  ownerId: string;
  teamId: string;
  actorId: string;
}

export interface AcquisitionDouyinIdentityResolutionOperation {
  id: string;
  ownerId: string;
  teamId: string;
  actorId: string;
  candidateId: string;
  candidateVersion: number;
  sourceEvidenceFingerprint: string;
  providerConnectionIds: string[];
  planSessionId: string | null;
  status: AcquisitionDouyinIdentityResolutionStatus;
  currentStage: AcquisitionDouyinIdentityResolutionStage | null;
  outcome: DouyinIdentityResolutionOutcome | null;
  retryable: boolean;
  canonicalProfileUrl: string | null;
  profileCandidates: Array<{
    publicProfileUrl: string;
    evidenceIds: string[];
  }>;
  evidence: DouyinIdentityEvidence[];
  intelligenceOperationId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AcquisitionDouyinIdentityResolutionOperationRecord
extends AcquisitionDouyinIdentityResolutionOperation {
  idempotencyKeyHash: string;
  requestHash: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
}

export interface AcquisitionDouyinIdentityResolutionClaim {
  leaseOwner: string;
  leaseToken: string;
  claimedAt: string;
  leaseExpiresAt: string;
}

export interface AcquisitionDouyinIdentityResolutionRecoveryQuery {
  now: string;
  limit: number;
}

export type AcquisitionDouyinIdentityResolutionOperationErrorCode =
  | "INVALID_REQUEST"
  | "RESOURCE_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "OPERATION_ALREADY_RUNNING";

export class AcquisitionDouyinIdentityResolutionOperationError extends Error {
  constructor(
    public readonly code: AcquisitionDouyinIdentityResolutionOperationErrorCode
  ) {
    super(code);
    this.name = "AcquisitionDouyinIdentityResolutionOperationError";
  }
}

type TenantScope = Pick<
  AcquisitionDouyinIdentityResolutionScope,
  "ownerId" | "teamId"
>;

export interface AcquisitionDouyinIdentityResolutionOperationRepository {
  findOperationByIdempotency(input: {
    ownerId: string;
    teamId: string;
    idempotencyKeyHash: string;
  }): Promise<AcquisitionDouyinIdentityResolutionOperationRecord | null>;
  createOperation(
    operation: AcquisitionDouyinIdentityResolutionOperationRecord
  ): Promise<{
    operation: AcquisitionDouyinIdentityResolutionOperationRecord;
    created: boolean;
  }>;
  getOperation(
    scope: TenantScope,
    id: string
  ): Promise<AcquisitionDouyinIdentityResolutionOperationRecord | null>;
  findLatestForCandidate(
    scope: TenantScope,
    candidateId: string
  ): Promise<AcquisitionDouyinIdentityResolutionOperationRecord | null>;
  listRecoverableOperations(
    input: AcquisitionDouyinIdentityResolutionRecoveryQuery
  ): Promise<AcquisitionDouyinIdentityResolutionOperationRecord[]>;
  claimOperation(
    scope: TenantScope,
    id: string,
    claim: AcquisitionDouyinIdentityResolutionClaim
  ): Promise<{
    operation: AcquisitionDouyinIdentityResolutionOperationRecord | null;
    claimed: boolean;
  }>;
  saveOperation(
    operation: AcquisitionDouyinIdentityResolutionOperationRecord,
    leaseToken: string
  ): Promise<void>;
  renewLease(
    scope: TenantScope,
    id: string,
    leaseToken: string,
    input: { renewedAt: string; leaseExpiresAt: string }
  ): Promise<boolean>;
}

export interface AcquisitionDouyinIdentityResolutionEvidencePort {
  getEvidence(
    scope: AcquisitionDouyinIdentityResolutionScope,
    evidenceId: string
  ): Promise<DiscoveryEvidence | null>;
}

export interface AcquisitionDouyinIdentityResolutionCreateInput {
  candidateId: string;
  expectedCandidateVersion: number;
  sourceEvidenceIds: string[];
  providerConnectionIds: string[];
  planSessionId?: string | null;
}

export interface AcquisitionDouyinIdentityResolutionOperationServiceOptions {
  repository: AcquisitionDouyinIdentityResolutionOperationRepository;
  evidence: AcquisitionDouyinIdentityResolutionEvidencePort;
  idFactory?: () => string;
  now?: () => string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown) {
  return `sha256:${hash(canonicalJsonStringify(value))}`;
}

function requiredText(value: unknown, max = 200) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) {
    throw new AcquisitionDouyinIdentityResolutionOperationError(
      "INVALID_REQUEST"
    );
  }
  return normalized;
}

function scope(raw: AcquisitionDouyinIdentityResolutionScope) {
  return {
    ownerId: requiredText(raw.ownerId, 100),
    teamId: requiredText(raw.teamId, 100),
    actorId: requiredText(raw.actorId, 100)
  };
}

function validIso(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("ACQUISITION_DOUYIN_IDENTITY_RESOLUTION_INVALID_CLOCK");
  }
  return new Date(timestamp).toISOString();
}

function uniqueSortedIds(
  values: string[],
  options: { min: number; max: number }
) {
  if (!Array.isArray(values)
    || values.length < options.min
    || values.length > options.max) {
    throw new AcquisitionDouyinIdentityResolutionOperationError(
      "INVALID_REQUEST"
    );
  }
  const normalized = values.map((value) => requiredText(value, 255));
  if (new Set(normalized).size !== normalized.length) {
    throw new AcquisitionDouyinIdentityResolutionOperationError(
      "INVALID_REQUEST"
    );
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function publicOperation(
  operation: AcquisitionDouyinIdentityResolutionOperationRecord
): AcquisitionDouyinIdentityResolutionOperation {
  const {
    idempotencyKeyHash: _idempotencyKeyHash,
    requestHash: _requestHash,
    leaseOwner: _leaseOwner,
    leaseToken: _leaseToken,
    leaseExpiresAt: _leaseExpiresAt,
    ...value
  } = operation;
  return clone(value);
}

function idempotencyMapKey(input: {
  ownerId: string;
  teamId: string;
  idempotencyKeyHash: string;
}) {
  return [input.ownerId, input.teamId, input.idempotencyKeyHash].join("\u001f");
}

export class InMemoryAcquisitionDouyinIdentityResolutionOperationRepository
implements AcquisitionDouyinIdentityResolutionOperationRepository {
  private readonly operations = new Map<
    string,
    AcquisitionDouyinIdentityResolutionOperationRecord
  >();
  private readonly idempotency = new Map<string, string>();

  async findOperationByIdempotency(input: {
    ownerId: string;
    teamId: string;
    idempotencyKeyHash: string;
  }) {
    const id = this.idempotency.get(idempotencyMapKey(input));
    return id ? clone(this.operations.get(id)!) : null;
  }

  async createOperation(
    operation: AcquisitionDouyinIdentityResolutionOperationRecord
  ) {
    const key = idempotencyMapKey(operation);
    const existingId = this.idempotency.get(key);
    if (existingId) {
      const existing = this.operations.get(existingId)!;
      if (existing.requestHash !== operation.requestHash) {
        throw new AcquisitionDouyinIdentityResolutionOperationError(
          "IDEMPOTENCY_CONFLICT"
        );
      }
      return { operation: clone(existing), created: false };
    }
    this.operations.set(operation.id, clone(operation));
    this.idempotency.set(key, operation.id);
    return { operation: clone(operation), created: true };
  }

  async getOperation(rawScope: TenantScope, id: string) {
    const operation = this.operations.get(id);
    return operation
      && operation.ownerId === rawScope.ownerId
      && operation.teamId === rawScope.teamId
      ? clone(operation)
      : null;
  }

  async findLatestForCandidate(rawScope: TenantScope, candidateId: string) {
    const latest = [...this.operations.values()]
      .filter((operation) =>
        operation.ownerId === rawScope.ownerId
        && operation.teamId === rawScope.teamId
        && operation.candidateId === candidateId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
        || right.id.localeCompare(left.id))[0];
    return latest ? clone(latest) : null;
  }

  async listRecoverableOperations(
    input: AcquisitionDouyinIdentityResolutionRecoveryQuery
  ) {
    return [...this.operations.values()]
      .filter((operation) =>
        operation.status === "queued"
        || (operation.status === "running"
          && operation.leaseExpiresAt !== null
          && operation.leaseExpiresAt <= input.now))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id))
      .slice(0, input.limit)
      .map(clone);
  }

  async claimOperation(
    rawScope: TenantScope,
    id: string,
    claim: AcquisitionDouyinIdentityResolutionClaim
  ) {
    const operation = await this.getOperation(rawScope, id);
    if (!operation) return { operation: null, claimed: false };
    const claimable = operation.status === "queued"
      || (operation.status === "running"
        && operation.leaseExpiresAt !== null
        && operation.leaseExpiresAt <= claim.claimedAt);
    if (!claimable) return { operation, claimed: false };
    const claimed = clone({
      ...operation,
      status: "running" as const,
      updatedAt: claim.claimedAt,
      completedAt: null,
      leaseOwner: claim.leaseOwner,
      leaseToken: claim.leaseToken,
      leaseExpiresAt: claim.leaseExpiresAt
    });
    this.operations.set(id, clone(claimed));
    return { operation: claimed, claimed: true };
  }

  async saveOperation(
    operation: AcquisitionDouyinIdentityResolutionOperationRecord,
    leaseToken: string
  ) {
    const existing = this.operations.get(operation.id);
    if (!existing
      || existing.ownerId !== operation.ownerId
      || existing.teamId !== operation.teamId) {
      throw new AcquisitionDouyinIdentityResolutionOperationError(
        "RESOURCE_NOT_FOUND"
      );
    }
    if (existing.status !== "running" || existing.leaseToken !== leaseToken) {
      throw new AcquisitionDouyinIdentityResolutionOperationError(
        "OPERATION_ALREADY_RUNNING"
      );
    }
    const released = operation.status !== "running";
    this.operations.set(operation.id, clone({
      ...operation,
      leaseOwner: released ? null : existing.leaseOwner,
      leaseToken: released ? null : existing.leaseToken,
      leaseExpiresAt: released ? null : existing.leaseExpiresAt
    }));
  }

  async renewLease(
    rawScope: TenantScope,
    id: string,
    leaseToken: string,
    input: { renewedAt: string; leaseExpiresAt: string }
  ) {
    const operation = this.operations.get(id);
    if (!operation
      || operation.ownerId !== rawScope.ownerId
      || operation.teamId !== rawScope.teamId
      || operation.status !== "running"
      || operation.leaseToken !== leaseToken
      || operation.leaseExpiresAt === null
      || operation.leaseExpiresAt <= input.renewedAt) {
      return false;
    }
    operation.leaseExpiresAt = input.leaseExpiresAt;
    operation.updatedAt = input.renewedAt;
    this.operations.set(id, clone(operation));
    return true;
  }
}

export class AcquisitionDouyinIdentityResolutionOperationService {
  private readonly repository:
    AcquisitionDouyinIdentityResolutionOperationRepository;
  private readonly evidence: AcquisitionDouyinIdentityResolutionEvidencePort;
  private readonly idFactory: () => string;
  private readonly now: () => string;

  constructor(options: AcquisitionDouyinIdentityResolutionOperationServiceOptions) {
    this.repository = options.repository;
    this.evidence = options.evidence;
    this.idFactory = options.idFactory
      ?? (() => `douyin-identity-resolution-${randomUUID()}`);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async create(
    rawScope: AcquisitionDouyinIdentityResolutionScope,
    rawInput: AcquisitionDouyinIdentityResolutionCreateInput,
    idempotencyKeyInput: string
  ) {
    const validatedScope = scope(rawScope);
    const candidateId = requiredText(rawInput.candidateId, 120);
    if (!Number.isSafeInteger(rawInput.expectedCandidateVersion)
      || rawInput.expectedCandidateVersion < 1) {
      throw new AcquisitionDouyinIdentityResolutionOperationError(
        "INVALID_REQUEST"
      );
    }
    const sourceEvidenceIds = uniqueSortedIds(rawInput.sourceEvidenceIds, {
      min: 1,
      max: 500
    });
    const providerConnectionIds = uniqueSortedIds(
      rawInput.providerConnectionIds,
      { min: 0, max: 100 }
    );
    const planSessionId = rawInput.planSessionId === null
      || rawInput.planSessionId === undefined
      ? null
      : requiredText(rawInput.planSessionId, 255);
    const idempotencyKeyHash = hash(requiredText(idempotencyKeyInput, 200));
    const sourceEvidence = await Promise.all(sourceEvidenceIds.map(async (id) => {
      const item = await this.evidence.getEvidence(validatedScope, id);
      if (!item) {
        throw new AcquisitionDouyinIdentityResolutionOperationError(
          "RESOURCE_NOT_FOUND"
        );
      }
      return {
        contentHash: requiredText(item.contentHash, 200),
        rawArtifactHash: requiredText(item.rawArtifactHash, 200)
      };
    }));
    const sortedSourceHashes = sourceEvidence.sort((left, right) =>
      left.contentHash.localeCompare(right.contentHash)
      || left.rawArtifactHash.localeCompare(right.rawArtifactHash));
    const sourceEvidenceFingerprint = stableHash(sortedSourceHashes);
    const requestHash = stableHash({
      candidateId,
      candidateVersion: rawInput.expectedCandidateVersion,
      sourceEvidence: sortedSourceHashes,
      providerConnectionIds,
      planSessionId
    });
    const existing = await this.repository.findOperationByIdempotency({
      ownerId: validatedScope.ownerId,
      teamId: validatedScope.teamId,
      idempotencyKeyHash
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AcquisitionDouyinIdentityResolutionOperationError(
          "IDEMPOTENCY_CONFLICT"
        );
      }
      return publicOperation(existing);
    }
    const now = validIso(this.now());
    const operation: AcquisitionDouyinIdentityResolutionOperationRecord = {
      id: requiredText(this.idFactory(), 160),
      ...validatedScope,
      candidateId,
      candidateVersion: rawInput.expectedCandidateVersion,
      sourceEvidenceFingerprint,
      providerConnectionIds,
      planSessionId,
      status: "queued",
      currentStage: null,
      outcome: null,
      retryable: false,
      canonicalProfileUrl: null,
      profileCandidates: [],
      evidence: [],
      intelligenceOperationId: null,
      idempotencyKeyHash,
      requestHash,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };
    const result = await this.repository.createOperation(operation);
    return publicOperation(result.operation);
  }

  async get(rawScope: AcquisitionDouyinIdentityResolutionScope, idInput: string) {
    const validatedScope = scope(rawScope);
    const operation = await this.repository.getOperation(
      validatedScope,
      requiredText(idInput, 160)
    );
    return operation ? publicOperation(operation) : null;
  }

  async findLatestForCandidate(
    rawScope: AcquisitionDouyinIdentityResolutionScope,
    candidateIdInput: string
  ) {
    const validatedScope = scope(rawScope);
    const operation = await this.repository.findLatestForCandidate(
      validatedScope,
      requiredText(candidateIdInput, 120)
    );
    return operation ? publicOperation(operation) : null;
  }

  async listRecoverableOperations(options: { limit: number }) {
    if (!Number.isSafeInteger(options.limit)
      || options.limit < 1
      || options.limit > 100) {
      throw new AcquisitionDouyinIdentityResolutionOperationError(
        "INVALID_REQUEST"
      );
    }
    const operations = await this.repository.listRecoverableOperations({
      now: validIso(this.now()),
      limit: options.limit
    });
    return operations.map(publicOperation);
  }
}
