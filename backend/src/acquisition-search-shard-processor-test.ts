import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AcquisitionSearchShardProcessor,
  AcquisitionSearchShardProcessorError
} from "./acquisition-search-shard-processor.js";
import type {
  AcquisitionOperationShard,
  AcquisitionRun
} from "./acquisition-plan-run-repository.js";
import type {
  AcquisitionShardProcessingInput
} from "./acquisition-plan-execution-worker.js";
import type {
  AcquisitionAgentToolExecutor,
  AcquisitionToolExecutionInput
} from "./acquisition-pi-tools.js";
import {
  AcquisitionToolExecutorError
} from "./acquisition-tool-executor.js";

function run(): AcquisitionRun {
  return {
    id: "run-search",
    ownerId: "owner-search",
    teamId: "team-search",
    planId: "plan-search",
    planVersionId: "plan-version-search",
    planVersion: 1,
    planSnapshotHash: "sha256:plan",
    parentRunId: null,
    status: "running",
    terminationIntent: null,
    revision: 2,
    etag: "\"run-search:2\"",
    budgetSnapshotId: "budget-search",
    budgetSnapshot: {
      billingCurrency: "CNY",
      maxRequests: 2,
      maxResults: 10,
      maxAmountMinor: 100,
      maxDurationSeconds: 60
    },
    budgetSnapshotHash: "sha256:budget",
    billingCurrency: "CNY",
    modelSnapshotRef: {
      jobSnapshotId: "model-snapshot",
      connectionId: "model-connection",
      credentialVersion: 1,
      provider: "test-model",
      model: "test-model-v1",
      capabilitySnapshotHash: "sha256:capability",
      promptVersion: "prompt.v1",
      schemaVersion: "acquisition-plan.v1",
      promptHash: "sha256:prompt",
      schemaHash: "sha256:schema"
    },
    consumedBudget: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    },
    evidenceCount: 0,
    reason: null,
    createdBy: "planner",
    createdAt: "2026-07-24T08:00:00.000Z",
    updatedBy: "acquisition-worker",
    updatedAt: "2026-07-24T08:00:01.000Z",
    completedAt: null
  };
}

function shard(
  overrides: Partial<AcquisitionOperationShard> = {}
): AcquisitionOperationShard {
  return {
    id: "shard-search",
    runId: "run-search",
    ownerId: "owner-search",
    teamId: "team-search",
    operationId: "organization-search",
    parentShardId: null,
    subjectChannel: "organization",
    kind: "search",
    connection: {
      connectionId: "official-search-connection",
      providerId: "official-search",
      kind: "search",
      status: "active",
      credentialVersion: 3
    },
    query: "厦门 企业 公开采购需求",
    sourceRef: "厦门 企业 公开采购需求",
    status: "running",
    budgetSnapshotId: "budget-search",
    allocatedBudget: {
      requests: 2,
      results: 10,
      amountMinor: 100,
      durationSeconds: 60
    },
    consumedBudget: {
      requests: 0,
      results: 0,
      amountMinor: 0,
      durationSeconds: 0
    },
    modelSnapshotRef: run().modelSnapshotRef,
    evidenceCount: 0,
    revision: 2,
    createdAt: "2026-07-24T08:00:00.000Z",
    updatedAt: "2026-07-24T08:00:01.000Z",
    completedAt: null,
    ...overrides
  };
}

function processingInput(
  overrides: Partial<AcquisitionShardProcessingInput> = {}
): AcquisitionShardProcessingInput {
  return {
    scope: {
      ownerId: "owner-search",
      teamId: "team-search",
      actorId: "acquisition-worker"
    },
    run: run(),
    shard: shard(),
    dispatchKey: "search-dispatch-key",
    signal: new AbortController().signal,
    ...overrides
  };
}

const noOpCandidatePipeline = {
  async process() {
    return {
      processedCandidateIds: [],
      battleCardCandidateIds: [],
      failures: []
    };
  }
};

test("maps a search shard to search_public_sources and extracts accepted evidence plus usage", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(input);
      return {
        status: "succeeded",
        providers: [{
          providerConnectionId: "official-search-connection",
          provider: "official-search",
          requestId: "provider-request-1",
          status: "succeeded"
        }],
        providerFailures: [],
        ingestFailures: [],
        evidence: [{ id: "evidence-1" }, { id: "evidence-2" }],
        candidates: [{ id: "candidate-1" }, { id: "candidate-2" }],
        rawResultCount: 2,
        acceptedResultCount: 2,
        duplicateResultCount: 0,
        failedResultCount: 0,
        candidateIds: ["candidate-1", "candidate-2"],
        outreachExecuted: false
      };
    }
  };
  const times = [1_000, 2_501];
  const processor = new AcquisitionSearchShardProcessor({
    executor,
    candidatePipeline: noOpCandidatePipeline,
    nowMs: () => times.shift() ?? 2_501
  });
  const input = processingInput();

  const result = await processor.process(input);

  assert.deepEqual(result, {
    status: "succeeded",
    evidenceCount: 2,
    presentation: {
      rawResultCount: 2,
      acceptedResultCount: 2,
      duplicateResultCount: 0,
      failedResultCount: 0,
      providers: [{
        providerConnectionId: "official-search-connection",
        provider: "official-search",
        status: "succeeded"
      }],
      providerFailures: [],
      candidateIds: ["candidate-1", "candidate-2"],
      processedCandidateIds: [],
      battleCardCandidateIds: [],
      candidateFailures: []
    },
    usage: {
      requests: 1,
      results: 2,
      amountMinor: 0,
      durationSeconds: 2
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.toolName, "search_public_sources");
  assert.deepEqual(calls[0]?.identity, {
    ownerId: "owner-search",
    teamId: "team-search",
    actorId: "acquisition-worker",
    sessionId: "acquisition-plan:run-search"
  });
  assert.deepEqual(calls[0]?.payload, {
    query: "厦门 企业 公开采购需求",
    providerConnectionIds: ["official-search-connection"],
    subjectKinds: ["organization"],
    maxResults: 10
  });
  assert.equal(calls[0]?.signal, input.signal);
  assert.match(calls[0]?.toolCallId ?? "", /^acquisition-search:/);
  assert.match(calls[0]?.idempotencyKey ?? "", /^acquisition-search:/);
});

test("rejects missing or malformed authoritative search presentation fields", async () => {
  const invalidSnapshots = [
    { rawResultCount: undefined },
    { duplicateResultCount: -1 },
    { failedResultCount: "0" },
    { candidateIds: ["candidate-1", "candidate-1"] }
  ];
  for (const snapshot of invalidSnapshots) {
    const executor: AcquisitionAgentToolExecutor = {
      async execute() {
        return {
          status: "succeeded",
          providers: [{
            providerConnectionId: "official-search-connection",
            provider: "official-search",
            status: "succeeded"
          }],
          providerFailures: [],
          rawResultCount: 1,
          acceptedResultCount: 1,
          duplicateResultCount: 0,
          failedResultCount: 0,
          candidateIds: ["candidate-1"],
          outreachExecuted: false,
          ...snapshot
        };
      }
    };
    const processor = new AcquisitionSearchShardProcessor({ executor });
    await assert.rejects(
      processor.process(processingInput()),
      (error: unknown) =>
        error instanceof AcquisitionSearchShardProcessorError
        && error.code === "INVALID_SEARCH_RESULT"
    );
  }
});

test("preserves an authoritative provider retryAfterAt in presentation", async () => {
  const executor: AcquisitionAgentToolExecutor = {
    async execute() {
      return {
        status: "partial",
        providers: [],
        providerFailures: [{
          providerConnectionId: "official-search-connection",
          provider: "official-search",
          errorCode: "SEARCH_PROVIDER_FAILED",
          retryAfterAt: "2026-07-24T10:00:00.000Z"
        }],
        rawResultCount: 0,
        acceptedResultCount: 0,
        duplicateResultCount: 0,
        failedResultCount: 0,
        candidateIds: [],
        outreachExecuted: false
      };
    }
  };
  const processor = new AcquisitionSearchShardProcessor({ executor });

  const result = await processor.process(processingInput());

  assert.equal(result.status, "failed");
  assert.deepEqual(result.presentation?.providerFailures, [{
    providerConnectionId: "official-search-connection",
    provider: "official-search",
    errorCode: "SEARCH_PROVIDER_FAILED",
    retryAfterAt: "2026-07-24T10:00:00.000Z"
  }]);
});

test("rejects non-search shards without calling any agent tool", async () => {
  let calls = 0;
  const executor: AcquisitionAgentToolExecutor = {
    async execute() {
      calls += 1;
      return {
        status: "succeeded",
        providers: [],
        providerFailures: [],
        acceptedResultCount: 0,
        outreachExecuted: false
      };
    }
  };
  const processor = new AcquisitionSearchShardProcessor({ executor });

  await assert.rejects(
    processor.process(processingInput({
      shard: shard({
        kind: "content_fetch",
        query: null,
        sourceRef: "https://example.test/public-content",
        connection: {
          connectionId: "fetch-connection",
          providerId: "official-fetch",
          kind: "content_fetch",
          status: "active",
          credentialVersion: 1
        }
      })
    })),
    (error: unknown) =>
      error instanceof AcquisitionSearchShardProcessorError
      && error.code === "UNSUPPORTED_SHARD_OPERATION"
  );
  assert.equal(calls, 0);
});

test("rejects any search result that does not explicitly prove outreach stayed disabled", async () => {
  const executor: AcquisitionAgentToolExecutor = {
    async execute() {
      return {
        status: "succeeded",
        providers: [{
          providerConnectionId: "official-search-connection"
        }],
        providerFailures: [],
        acceptedResultCount: 1,
        outreachExecuted: true
      };
    }
  };
  const processor = new AcquisitionSearchShardProcessor({ executor });

  await assert.rejects(
    processor.process(processingInput()),
    (error: unknown) =>
      error instanceof AcquisitionSearchShardProcessorError
      && error.code === "OUTREACH_SAFETY_VIOLATION"
  );
});

test("rejects malformed accepted-result counters instead of coercing usage", async () => {
  const executor: AcquisitionAgentToolExecutor = {
    async execute() {
      return {
        status: "succeeded",
        providers: [{
          providerConnectionId: "official-search-connection"
        }],
        providerFailures: [],
        acceptedResultCount: "2",
        outreachExecuted: false
      };
    }
  };
  const processor = new AcquisitionSearchShardProcessor({ executor });

  await assert.rejects(
    processor.process(processingInput()),
    (error: unknown) =>
      error instanceof AcquisitionSearchShardProcessorError
      && error.code === "INVALID_SEARCH_RESULT"
  );
});

test("preserves a partial search outcome when accepted evidence survives ingest failures", async () => {
  const executor: AcquisitionAgentToolExecutor = {
    async execute() {
      return {
        status: "partial",
        providers: [{
          providerConnectionId: "official-search-connection",
          provider: "official-search"
        }],
        providerFailures: [],
        ingestFailures: [{
          providerConnectionId: "official-search-connection",
          resultIndex: 1,
          errorCode: "EVIDENCE_INGEST_FAILED"
        }],
        evidence: [{ id: "evidence-1" }],
        candidates: [{ id: "candidate-1" }],
        rawResultCount: 2,
        acceptedResultCount: 1,
        duplicateResultCount: 0,
        failedResultCount: 1,
        candidateIds: ["candidate-1"],
        outreachExecuted: false
      };
    }
  };
  const processor = new AcquisitionSearchShardProcessor({
    executor,
    candidatePipeline: noOpCandidatePipeline,
    nowMs: () => 5_000
  });

  const result = await processor.process(processingInput());

  assert.deepEqual(result, {
    status: "partial_success",
    evidenceCount: 1,
    presentation: {
      rawResultCount: 2,
      acceptedResultCount: 1,
      duplicateResultCount: 0,
      failedResultCount: 1,
      providers: [{
        providerConnectionId: "official-search-connection",
        provider: "official-search",
        status: "succeeded"
      }],
      providerFailures: [],
      candidateIds: ["candidate-1"],
      processedCandidateIds: [],
      battleCardCandidateIds: [],
      candidateFailures: []
    },
    usage: {
      requests: 1,
      results: 1,
      amountMinor: 0,
      durationSeconds: 0
    }
  });
});

test("uses explicit executor usage when the search result supplies a valid accounting envelope", async () => {
  const executor: AcquisitionAgentToolExecutor = {
    async execute() {
      return {
        status: "succeeded",
        providers: [{
          providerConnectionId: "official-search-connection",
          provider: "official-search"
        }],
        providerFailures: [],
        rawResultCount: 2,
        acceptedResultCount: 2,
        duplicateResultCount: 0,
        failedResultCount: 0,
        candidateIds: ["candidate-1", "candidate-2"],
        usage: {
          requests: 2,
          results: 2,
          amountMinor: 17,
          durationSeconds: 4
        },
        outreachExecuted: false
      };
    }
  };
  const processor = new AcquisitionSearchShardProcessor({
    executor,
    candidatePipeline: noOpCandidatePipeline,
    nowMs: () => 10_000
  });

  const result = await processor.process(processingInput());

  assert.deepEqual(result.usage, {
    requests: 2,
    results: 2,
    amountMinor: 17,
    durationSeconds: 4
  });
});

test("rejects corrupt search snapshots before invoking the executor", async () => {
  let calls = 0;
  const executor: AcquisitionAgentToolExecutor = {
    async execute() {
      calls += 1;
      return {};
    }
  };
  const processor = new AcquisitionSearchShardProcessor({ executor });

  await assert.rejects(
    processor.process(processingInput({
      shard: shard({ query: null })
    })),
    (error: unknown) =>
      error instanceof AcquisitionSearchShardProcessorError
      && error.code === "INVALID_SEARCH_SHARD"
  );
  assert.equal(calls, 0);
});

test("processes sorted search candidates and keeps evidence when one candidate stage fails", async () => {
  const calls: AcquisitionToolExecutionInput[] = [];
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      calls.push(input);
      if (input.toolName === "search_public_sources") {
        return {
          status: "succeeded",
          providers: [{
            providerConnectionId: "official-search-connection",
            provider: "official-search"
          }],
          providerFailures: [],
          rawResultCount: 2,
          acceptedResultCount: 2,
          duplicateResultCount: 0,
          failedResultCount: 0,
          candidateIds: ["candidate-a", "candidate-b"],
          outreachExecuted: false
        };
      }
      if (input.payload.candidateId === "candidate-a"
        && input.toolName === "research_candidate") {
        throw new AcquisitionToolExecutorError("RESOURCE_NOT_FOUND");
      }
      if (input.toolName === "qualify_candidate") {
        return {
          qualification: {
            grade: "B",
            score: 60,
            hardGateFailures: []
          },
          outreachExecuted: false
        };
      }
      return { outreachExecuted: false };
    }
  };
  const processor = new AcquisitionSearchShardProcessor({
    executor,
    nowMs: () => 5_000
  });

  const result = await processor.process(processingInput());

  assert.equal(result.status, "partial_success");
  assert.equal(result.evidenceCount, 2);
  assert.deepEqual(result.presentation?.candidateIds, [
    "candidate-a",
    "candidate-b"
  ]);
  assert.deepEqual(result.presentation?.processedCandidateIds, [
    "candidate-b"
  ]);
  assert.deepEqual(result.presentation?.battleCardCandidateIds, []);
  assert.deepEqual(result.presentation?.candidateFailures, [{
    candidateId: "candidate-a",
    stage: "research",
    errorCode: "RESOURCE_NOT_FOUND"
  }]);
  assert.deepEqual(calls.map((call) => call.toolName), [
    "search_public_sources",
    "research_candidate",
    "research_candidate",
    "qualify_candidate"
  ]);
});

test("returns partial success for a candidate failure even when search accepted no evidence", async () => {
  const executor: AcquisitionAgentToolExecutor = {
    async execute(input) {
      if (input.toolName === "search_public_sources") {
        return {
          status: "succeeded",
          providers: [{
            providerConnectionId: "official-search-connection",
            provider: "official-search"
          }],
          providerFailures: [],
          rawResultCount: 0,
          acceptedResultCount: 0,
          duplicateResultCount: 0,
          failedResultCount: 0,
          candidateIds: ["candidate-without-evidence"],
          outreachExecuted: false
        };
      }
      throw new AcquisitionToolExecutorError("EVIDENCE_REQUIRED");
    }
  };
  const processor = new AcquisitionSearchShardProcessor({
    executor,
    nowMs: () => 5_000
  });

  const result = await processor.process(processingInput());

  assert.equal(result.status, "partial_success");
  assert.equal(result.evidenceCount, 0);
  assert.deepEqual(result.presentation?.candidateFailures, [{
    candidateId: "candidate-without-evidence",
    stage: "research",
    errorCode: "EVIDENCE_REQUIRED"
  }]);
});
