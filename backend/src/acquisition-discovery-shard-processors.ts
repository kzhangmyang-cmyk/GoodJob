import type {
  AcquisitionContentFetchOperation,
  AcquisitionDiscoveryOperationService,
  AcquisitionDiscoveryScope,
  AcquisitionImportOperation
} from "./acquisition-discovery-operations.js";
import type {
  AcquisitionShardProcessingInput,
  AcquisitionShardProcessingResult,
  AcquisitionShardProcessorPort
} from "./acquisition-plan-execution-worker.js";
import {
  ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS
} from "./acquisition-discovery-providers.js";

export type AcquisitionDiscoveryShardProcessorErrorCode =
  | "INVALID_CONTENT_FETCH_SHARD"
  | "INVALID_IMPORT_SHARD"
  | "INVALID_DISCOVERY_OPERATION_RESULT"
  | "ABORTED";

export class AcquisitionDiscoveryShardProcessorError extends Error {
  constructor(
    public readonly code: AcquisitionDiscoveryShardProcessorErrorCode
  ) {
    super(code);
    this.name = "AcquisitionDiscoveryShardProcessorError";
  }
}

export interface AcquisitionDiscoveryOperationExecutionPort {
  createContentFetchOperation(
    scope: AcquisitionDiscoveryScope,
    input: {
      sourceUrl: string;
      subjectChannel: "organization" | "individual";
    },
    idempotencyKey: string
  ): Promise<AcquisitionContentFetchOperation>;
  getContentFetchOperation(
    scope: AcquisitionDiscoveryScope,
    id: string
  ): Promise<AcquisitionContentFetchOperation>;
  executeContentFetchOperation(
    scope: AcquisitionDiscoveryScope,
    id: string,
    signal?: AbortSignal
  ): Promise<AcquisitionContentFetchOperation>;
  getImportOperation(
    scope: AcquisitionDiscoveryScope,
    id: string
  ): Promise<AcquisitionImportOperation>;
  executeImportOperation(
    scope: AcquisitionDiscoveryScope,
    id: string,
    signal?: AbortSignal,
    options?: { maxRows?: number }
  ): Promise<AcquisitionImportOperation>;
}

interface DiscoveryProcessorOptions {
  operations:
    | AcquisitionDiscoveryOperationExecutionPort
    | AcquisitionDiscoveryOperationService;
  nowMs?: () => number;
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new AcquisitionDiscoveryShardProcessorError("ABORTED");
  }
}

function sameScope(input: AcquisitionShardProcessingInput) {
  return input.run.ownerId === input.scope.ownerId
    && input.run.teamId === input.scope.teamId
    && input.shard.ownerId === input.scope.ownerId
    && input.shard.teamId === input.scope.teamId
    && input.shard.runId === input.run.id;
}

function measuredUsage(
  startedAt: number,
  completedAt: number,
  results: number
) {
  return {
    requests: 1,
    results,
    amountMinor: 0,
    durationSeconds: Math.max(
      0,
      Math.ceil((completedAt - startedAt) / 1_000)
    )
  };
}

function validOperationScope(
  operation: {
    ownerId: string;
    teamId: string;
    subjectChannel: "organization" | "individual";
  },
  input: AcquisitionShardProcessingInput
) {
  return operation.ownerId === input.scope.ownerId
    && operation.teamId === input.scope.teamId
    && operation.subjectChannel === input.shard.subjectChannel;
}

function existingOperationId(sourceRef: string, scheme: string) {
  const expression = new RegExp(
    `^${scheme}:\\/\\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,159})$`,
    "u"
  );
  return expression.exec(sourceRef)?.[1] ?? null;
}

export class AcquisitionContentFetchShardProcessor
implements AcquisitionShardProcessorPort {
  private readonly operations: AcquisitionDiscoveryOperationExecutionPort;
  private readonly nowMs: () => number;

  constructor(options: DiscoveryProcessorOptions) {
    this.operations = options.operations;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async process(
    input: AcquisitionShardProcessingInput
  ): Promise<AcquisitionShardProcessingResult> {
    const remainingRequests =
      input.shard.allocatedBudget.requests
      - input.shard.consumedBudget.requests;
    const remainingResults =
      input.shard.allocatedBudget.results
      - input.shard.consumedBudget.results;
    if (
      input.shard.kind !== "content_fetch"
      || input.shard.connection.kind !== "content_fetch"
      || input.shard.connection.connectionId
        !== ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS
          .contentFetch.connectionId
      || input.shard.connection.providerId
        !== ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS
          .contentFetch.providerId
      || input.shard.connection.credentialVersion
        !== ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS
          .contentFetch.credentialVersion
      || input.shard.connection.status !== "active"
      || !input.shard.connection.connectionId.trim()
      || input.shard.status !== "running"
      || !input.shard.sourceRef.trim()
      || !input.dispatchKey.trim()
      || !sameScope(input)
      || remainingRequests < 1
      || remainingResults < 1
    ) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_CONTENT_FETCH_SHARD"
      );
    }
    assertNotAborted(input.signal);
    const startedAt = this.nowMs();
    const operationId = existingOperationId(
      input.shard.sourceRef,
      "fetch"
    );
    let operation = operationId
      ? await this.operations.getContentFetchOperation(
          input.scope,
          operationId
        )
      : await this.operations.createContentFetchOperation(
          input.scope,
          {
            sourceUrl: input.shard.sourceRef,
            subjectChannel: input.shard.subjectChannel
          },
          [
            "plan-fetch",
            input.run.id,
            input.shard.id,
            input.run.planSnapshotHash
          ].join(":")
        );
    if (!validOperationScope(operation, input)) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_DISCOVERY_OPERATION_RESULT"
      );
    }
    operation = await this.operations.executeContentFetchOperation(
      input.scope,
      operation.id,
      input.signal
    );
    assertNotAborted(input.signal);
    if (!validOperationScope(operation, input)
      || operation.evidenceCount < 0
      || operation.evidenceCount > 1
      || operation.evidenceCount > remainingResults) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_DISCOVERY_OPERATION_RESULT"
      );
    }
    const status = operation.status === "succeeded"
      ? operation.evidenceCount > 0
        ? "succeeded"
        : "succeeded_empty"
      : operation.status === "access_restricted"
        ? operation.evidenceCount > 0
          ? "partial_success"
          : "failed"
        : operation.status === "failed"
          ? "failed"
          : null;
    if (!status) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_DISCOVERY_OPERATION_RESULT"
      );
    }
    return {
      status,
      evidenceCount: operation.evidenceCount,
      usage: measuredUsage(
        startedAt,
        this.nowMs(),
        operation.evidenceCount
      )
    };
  }
}

export class AcquisitionImportRowsShardProcessor
implements AcquisitionShardProcessorPort {
  private readonly operations: AcquisitionDiscoveryOperationExecutionPort;
  private readonly nowMs: () => number;

  constructor(options: DiscoveryProcessorOptions) {
    this.operations = options.operations;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async process(
    input: AcquisitionShardProcessingInput
  ): Promise<AcquisitionShardProcessingResult> {
    const remainingRequests =
      input.shard.allocatedBudget.requests
      - input.shard.consumedBudget.requests;
    const remainingResults =
      input.shard.allocatedBudget.results
      - input.shard.consumedBudget.results;
    const operationId = existingOperationId(
      input.shard.sourceRef,
      "import"
    );
    if (
      input.shard.kind !== "import_rows"
      || input.shard.connection.kind !== "import"
      || input.shard.connection.connectionId
        !== ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS.import.connectionId
      || input.shard.connection.providerId
        !== ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS.import.providerId
      || input.shard.connection.credentialVersion
        !== ACQUISITION_SYSTEM_PROVIDER_CONNECTIONS
          .import.credentialVersion
      || input.shard.connection.status !== "active"
      || !input.shard.connection.connectionId.trim()
      || input.shard.status !== "running"
      || !operationId
      || !input.dispatchKey.trim()
      || !sameScope(input)
      || remainingRequests < 1
      || remainingResults < 1
    ) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_IMPORT_SHARD"
      );
    }
    assertNotAborted(input.signal);
    const startedAt = this.nowMs();
    let operation = await this.operations.getImportOperation(
      input.scope,
      operationId
    );
    if (!validOperationScope(operation, input)) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_DISCOVERY_OPERATION_RESULT"
      );
    }
    operation = await this.operations.executeImportOperation(
      input.scope,
      operation.id,
      input.signal,
      { maxRows: Math.min(remainingResults, 5_000) }
    );
    assertNotAborted(input.signal);
    if (!validOperationScope(operation, input)
      || !Number.isSafeInteger(operation.acceptedRowCount)
      || operation.acceptedRowCount < 0
      || operation.acceptedRowCount > remainingResults) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_DISCOVERY_OPERATION_RESULT"
      );
    }
    const status = operation.status === "succeeded"
      ? operation.acceptedRowCount > 0
        ? "succeeded"
        : "succeeded_empty"
      : operation.status === "partial_success"
        ? operation.acceptedRowCount > 0
          ? "partial_success"
          : "failed"
        : operation.status === "failed"
          ? "failed"
          : null;
    if (!status) {
      throw new AcquisitionDiscoveryShardProcessorError(
        "INVALID_DISCOVERY_OPERATION_RESULT"
      );
    }
    return {
      status,
      evidenceCount: operation.acceptedRowCount,
      usage: measuredUsage(
        startedAt,
        this.nowMs(),
        operation.acceptedRowCount
      )
    };
  }
}
