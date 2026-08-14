import { createHash } from "node:crypto";
import {
  AcquisitionCandidateProcessingPipeline
} from "./acquisition-candidate-processing-pipeline.js";
import type {
  AcquisitionAgentToolExecutor
} from "./acquisition-pi-tools.js";
import type {
  AcquisitionShardProcessingInput,
  AcquisitionShardProcessingResult,
  AcquisitionShardProcessorPort
} from "./acquisition-plan-execution-worker.js";
import type {
  AcquisitionDouyinCommentEnrichmentPort,
  AcquisitionDouyinCommentEnrichmentResult
} from "./acquisition-douyin-comment-enrichment.js";
import type {
  AcquisitionPlanRunRepository
} from "./acquisition-plan-run-repository.js";
import {
  resolveDouyinVideoId
} from "./douyin-public-comment-provider.js";

export interface AcquisitionSearchShardProcessorOptions {
  executor: AcquisitionAgentToolExecutor;
  candidatePipeline?: Pick<
    AcquisitionCandidateProcessingPipeline,
    "process"
  >;
  commentEnrichment?: AcquisitionDouyinCommentEnrichmentPort;
  planRunRepository?: Pick<AcquisitionPlanRunRepository, "getPlanVersion">;
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

function emptyCommentEnrichment(): AcquisitionDouyinCommentEnrichmentResult {
  return {
    status: "skipped",
    videoCount: 0,
    pagesFetched: 0,
    commentsSampled: 0,
    eventCount: 0,
    evidenceCount: 0,
    candidateIds: [],
    unresolvedActorCount: 0,
    strongSignalCount: 0,
    invalidCommentCount: 0,
    errors: [],
    usage: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    }
  };
}

function douyinEvidenceSourceUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const provenance = (item as Record<string, unknown>).provenance;
    if (!provenance
      || typeof provenance !== "object"
      || Array.isArray(provenance)) continue;
    const sourceUrl = (provenance as Record<string, unknown>).sourceUrl;
    if (typeof sourceUrl !== "string"
      || !resolveDouyinVideoId(sourceUrl)
      || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    urls.push(sourceUrl);
  }
  return urls;
}

export class AcquisitionSearchShardProcessor
implements AcquisitionShardProcessorPort {
  private readonly executor: AcquisitionAgentToolExecutor;
  private readonly candidatePipeline: Pick<
    AcquisitionCandidateProcessingPipeline,
    "process"
  >;
  private readonly commentEnrichment:
    AcquisitionDouyinCommentEnrichmentPort | null;
  private readonly planRunRepository:
    Pick<AcquisitionPlanRunRepository, "getPlanVersion"> | null;
  private readonly nowMs: () => number;

  constructor(options: AcquisitionSearchShardProcessorOptions) {
    this.executor = options.executor;
    this.candidatePipeline = options.candidatePipeline
      ?? new AcquisitionCandidateProcessingPipeline({
        executor: options.executor
      });
    this.commentEnrichment = options.commentEnrichment ?? null;
    this.planRunRepository = options.planRunRepository ?? null;
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
    const remainingRequests = input.shard.allocatedBudget.requests
      - input.shard.consumedBudget.requests;
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
      || !Number.isSafeInteger(remainingRequests)
      || remainingRequests < 1
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
    const rawResultCount = record.rawResultCount;
    const duplicateResultCount = record.duplicateResultCount;
    const failedResultCount = record.failedResultCount;
    const candidateIds = record.candidateIds;
    const providers = record.providers;
    const providerFailures = record.providerFailures;
    const attempts = [
      ...(Array.isArray(providers) ? providers : []),
      ...(Array.isArray(providerFailures) ? providerFailures : [])
    ];
    if (!Number.isSafeInteger(evidenceCount)
      || Number(evidenceCount) < 0
      || Number(evidenceCount) > maxResults
      || !Number.isSafeInteger(rawResultCount)
      || Number(rawResultCount) < Number(evidenceCount)
      || !Number.isSafeInteger(duplicateResultCount)
      || Number(duplicateResultCount) < 0
      || Number(duplicateResultCount) > Number(evidenceCount)
      || !Number.isSafeInteger(failedResultCount)
      || Number(failedResultCount) < 0
      || !Array.isArray(candidateIds)
      || candidateIds.some((candidateId) =>
        typeof candidateId !== "string" || candidateId.trim().length === 0
      )
      || new Set(candidateIds).size !== candidateIds.length
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
    const baseUsage = {
      requests: attempts.length,
      results: Number(evidenceCount),
      amountMinor: 0,
      durationSeconds: 0
    };
    let searchUsage = baseUsage;
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
      searchUsage = {
        requests: Number(supplied.requests),
        results: Number(supplied.results),
        amountMinor: Number(supplied.amountMinor),
        durationSeconds: Number(supplied.durationSeconds)
      };
    }
    if (searchUsage.requests > remainingRequests
      || searchUsage.results > remainingResults) {
      throw new AcquisitionSearchShardProcessorError(
        "INVALID_SEARCH_RESULT"
      );
    }
    let commentEnrichment = emptyCommentEnrichment();
    if (this.commentEnrichment && this.planRunRepository) {
      const version = await this.planRunRepository.getPlanVersion(
        input.run.planVersionId
      );
      const policy = version
        && version.ownerId === input.scope.ownerId
        && version.teamId === input.scope.teamId
        ? version.payload.douyinPublicCommentSample ?? null
        : null;
      if (policy?.enabled) {
        commentEnrichment = await this.commentEnrichment.enrich({
          scope: input.scope,
          runId: input.run.id,
          shardId: input.shard.id,
          discoveryOperationId: null,
          sourceUrls: douyinEvidenceSourceUrls(record.evidence),
          candidateIds: candidateIds.map(String),
          policy,
          remainingBudget: {
            requests: Math.max(
              0,
              input.shard.allocatedBudget.requests
                - input.shard.consumedBudget.requests
                - searchUsage.requests
            ),
            results: Math.max(
              0,
              remainingResults - searchUsage.results
            )
          },
          signal: input.signal
        });
      }
    }
    const mergedCandidateIds = [...new Set([
      ...candidateIds.map(String),
      ...commentEnrichment.candidateIds
    ])];
    const candidateProcessing = await this.candidatePipeline.process({
      scope: input.scope,
      run: input.run,
      shard: input.shard,
      candidateIds: mergedCandidateIds,
      signal: input.signal
    });
    const completedAt = this.nowMs();
    if (record.usage === undefined) {
      searchUsage = {
        ...searchUsage,
        durationSeconds: Math.max(
          0,
          Math.ceil((completedAt - startedAt) / 1_000)
        )
      };
    }
    const combinedEvidenceCount = Number(evidenceCount)
      + commentEnrichment.evidenceCount;
    const commentFailed = ["partial_success", "failed"].includes(
      commentEnrichment.status
    );
    const status = candidateProcessing.failures.length > 0
      ? "partial_success"
      : commentFailed || record.status === "partial"
        ? combinedEvidenceCount > 0 ? "partial_success" : "failed"
        : combinedEvidenceCount > 0 ? "succeeded" : "succeeded_empty";
    const usage = {
      requests: searchUsage.requests + commentEnrichment.usage.requests,
      results: searchUsage.results + commentEnrichment.usage.results,
      amountMinor:
        searchUsage.amountMinor + commentEnrichment.usage.amountMinor,
      durationSeconds:
        searchUsage.durationSeconds
          + commentEnrichment.usage.durationSeconds
    };
    return {
      status,
      evidenceCount: combinedEvidenceCount,
      presentation: {
        rawResultCount:
          Number(rawResultCount) + commentEnrichment.commentsSampled,
        acceptedResultCount: combinedEvidenceCount,
        duplicateResultCount: Number(duplicateResultCount),
        failedResultCount:
          Number(failedResultCount) + commentEnrichment.errors.length,
        providers: providers.map((provider) => ({
          providerConnectionId: String(
            (provider as Record<string, unknown>).providerConnectionId
          ),
          provider: String((provider as Record<string, unknown>).provider),
          status: "succeeded" as const
        })),
        providerFailures: providerFailures.map((failure) => ({
          providerConnectionId: String(
            (failure as Record<string, unknown>).providerConnectionId
          ),
          provider: String(
            (failure as Record<string, unknown>).provider ?? "unknown"
          ),
          errorCode: String((failure as Record<string, unknown>).errorCode),
          retryAfterAt: (failure as Record<string, unknown>).retryAfterAt === null
            ? null
            : String((failure as Record<string, unknown>).retryAfterAt)
        })),
        candidateIds: mergedCandidateIds,
        processedCandidateIds: candidateProcessing.processedCandidateIds,
        battleCardCandidateIds:
          candidateProcessing.battleCardCandidateIds,
        candidateFailures: candidateProcessing.failures
      },
      usage
    };
  }
}
