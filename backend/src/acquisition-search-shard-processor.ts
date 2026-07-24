import { createHash } from "node:crypto";
import type {
  AcquisitionAgentToolExecutor
} from "./acquisition-pi-tools.js";
import type {
  AcquisitionShardProcessingInput,
  AcquisitionShardProcessingResult,
  AcquisitionShardProcessorPort
} from "./acquisition-plan-execution-worker.js";

export interface AcquisitionSearchShardProcessorOptions {
  executor: AcquisitionAgentToolExecutor;
  nowMs?: () => number;
}

export class AcquisitionSearchShardProcessorError extends Error {
  constructor(
    public readonly code:
      | "UNSUPPORTED_SHARD_OPERATION"
      | "INVALID_SEARCH_SHARD"
      | "INVALID_SEARCH_RESULT"
      | "OUTREACH_SAFETY_VIOLATION"
  ) {
    super(code);
    this.name = "AcquisitionSearchShardProcessorError";
  }
}

export class AcquisitionSearchShardProcessor
implements AcquisitionShardProcessorPort {
  private readonly executor: AcquisitionAgentToolExecutor;
  private readonly nowMs: () => number;

  constructor(options: AcquisitionSearchShardProcessorOptions) {
    this.executor = options.executor;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async process(
    input: AcquisitionShardProcessingInput
  ): Promise<AcquisitionShardProcessingResult> {
    if (input.shard.kind !== "search") {
      throw new AcquisitionSearchShardProcessorError(
        "UNSUPPORTED_SHARD_OPERATION"
      );
    }
    const sameScope = input.run.ownerId === input.scope.ownerId
      && input.run.teamId === input.scope.teamId
      && input.shard.ownerId === input.scope.ownerId
      && input.shard.teamId === input.scope.teamId;
    const remainingResults = input.shard.allocatedBudget.results
      - input.shard.consumedBudget.results;
    if (!sameScope
      || input.shard.runId !== input.run.id
      || input.shard.status !== "running"
      || input.shard.connection.kind !== "search"
      || input.shard.connection.status !== "active"
      || !input.shard.connection.connectionId.trim()
      || typeof input.shard.query !== "string"
      || input.shard.query.trim().length < 2
      || !Number.isSafeInteger(remainingResults)
      || remainingResults < 1
      || !input.dispatchKey.trim()) {
      throw new AcquisitionSearchShardProcessorError(
        "INVALID_SEARCH_SHARD"
      );
    }
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new DOMException("aborted", "AbortError");
    }
    const startedAt = this.nowMs();
    const maxResults = Math.min(
      100,
      remainingResults
    );
    const identityKey = createHash("sha256")
      .update(JSON.stringify({
        runId: input.run.id,
        planSnapshotHash: input.run.planSnapshotHash,
        shardId: input.shard.id,
        operationId: input.shard.operationId
      }))
      .digest("hex")
      .slice(0, 48);
    const result = await this.executor.execute({
      identity: {
        ...input.scope,
        sessionId: `acquisition-plan:${input.run.id}`
      },
      toolName: "search_public_sources",
      toolCallId: `acquisition-search:${identityKey}`,
      idempotencyKey: `acquisition-search:${identityKey}`,
      payload: {
        query: input.shard.query,
        providerConnectionIds: [input.shard.connection.connectionId],
        subjectKinds: [input.shard.subjectChannel],
        maxResults
      },
      signal: input.signal
    });
    const completedAt = this.nowMs();
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new AcquisitionSearchShardProcessorError(
        "INVALID_SEARCH_RESULT"
      );
    }
    const record = result as Record<string, unknown>;
    if (record.outreachExecuted !== false) {
      throw new AcquisitionSearchShardProcessorError(
        "OUTREACH_SAFETY_VIOLATION"
      );
    }
    const evidenceCount = record.acceptedResultCount;
    const providers = record.providers;
    const providerFailures = record.providerFailures;
    const attempts = [
      ...(Array.isArray(providers) ? providers : []),
      ...(Array.isArray(providerFailures) ? providerFailures : [])
    ];
    if (!Number.isSafeInteger(evidenceCount)
      || Number(evidenceCount) < 0
      || Number(evidenceCount) > maxResults
      || !["succeeded", "partial"].includes(String(record.status))
      || !Array.isArray(providers)
      || !Array.isArray(providerFailures)
      || attempts.length !== 1
      || attempts.some((attempt) =>
        !attempt
        || typeof attempt !== "object"
        || (attempt as Record<string, unknown>).providerConnectionId
          !== input.shard.connection.connectionId)
    ) {
      throw new AcquisitionSearchShardProcessorError(
        "INVALID_SEARCH_RESULT"
      );
    }
    const status = record.status === "partial"
      ? Number(evidenceCount) > 0
        ? "partial_success"
        : "failed"
      : Number(evidenceCount) > 0
        ? "succeeded"
        : "succeeded_empty";
    const measuredUsage = {
      requests: attempts.length,
      results: Number(evidenceCount),
      amountMinor: 0,
      durationSeconds: Math.max(
        0,
        Math.ceil((completedAt - startedAt) / 1_000)
      )
    };
    let usage = measuredUsage;
    if (record.usage !== undefined) {
      if (!record.usage
        || typeof record.usage !== "object"
        || Array.isArray(record.usage)) {
        throw new AcquisitionSearchShardProcessorError(
          "INVALID_SEARCH_RESULT"
        );
      }
      const supplied = record.usage as Record<string, unknown>;
      if (!Number.isSafeInteger(supplied.requests)
        || Number(supplied.requests) < attempts.length
        || !Number.isSafeInteger(supplied.results)
        || Number(supplied.results) !== Number(evidenceCount)
        || !Number.isSafeInteger(supplied.amountMinor)
        || Number(supplied.amountMinor) < 0
        || !Number.isSafeInteger(supplied.durationSeconds)
        || Number(supplied.durationSeconds) < 0) {
        throw new AcquisitionSearchShardProcessorError(
          "INVALID_SEARCH_RESULT"
        );
      }
      usage = {
        requests: Number(supplied.requests),
        results: Number(supplied.results),
        amountMinor: Number(supplied.amountMinor),
        durationSeconds: Number(supplied.durationSeconds)
      };
    }
    return {
      status,
      evidenceCount: Number(evidenceCount),
      usage
    };
  }
}
