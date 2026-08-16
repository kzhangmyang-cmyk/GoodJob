import type { FinancialCouncilCreateInput } from "./growth-contract-types.js";
import type { CommandContext } from "./growth-command-context.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import { requireGrowthCapabilities } from "./growth-capabilities.js";
import { growthHttpIdempotencyKeyHash } from
  "./growth-http-idempotency-repository.js";
import {
  financialCouncilCanonicalHash,
  financialCouncilError,
  immutableFinancialCouncilInput,
  immutableFinancialCouncilValue,
  type FinancialCouncilRun,
  type FinancialCouncilRunEvent,
  type FinancialSnapshotRecord
} from "./financial-council-domain.js";
import type { FinancialCouncilRepository } from
  "./financial-council-repository.js";
import type {
  FinancialSnapshot,
  FinancialSnapshotBuilder
} from "./financial-council-snapshot.js";

export interface FinancialCouncilWakeSink {
  wake(run: FinancialCouncilRun): Promise<void>;
}

export interface FinancialCouncilServiceDependencies {
  readonly repository: FinancialCouncilRepository;
  readonly snapshotBuilder: Pick<FinancialSnapshotBuilder, "freeze">;
  readonly advisoryWake?: FinancialCouncilWakeSink;
  readonly onAdvisoryWakeError?: (
    error: unknown,
    run: FinancialCouncilRun
  ) => void;
  readonly now?: () => string;
}

function authorize(context: ActiveWorkspaceContext): void {
  if (!context || !context.workspaceId?.trim()
    || context.workspaceId === "all" || !context.actorId?.trim()) {
    throw financialCouncilError("financial_council_context_invalid");
  }
  requireGrowthCapabilities(context, ["finance.council.run"]);
}

function instant(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw financialCouncilError("financial_council_timestamp_invalid");
  }
  return value;
}

function requestHash(value: string): `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw financialCouncilError("financial_council_context_invalid");
  }
  return value as `sha256:${string}`;
}

export class FinancialCouncilService {
  private readonly now: () => string;

  constructor(private readonly dependencies: FinancialCouncilServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async createRun(
    command: CommandContext,
    rawInput: FinancialCouncilCreateInput
  ) {
    authorize(command?.workspace);
    if (command.actorId !== command.workspace.actorId
      || command.expectedRevision !== null) {
      throw financialCouncilError("financial_council_context_invalid");
    }
    const input = immutableFinancialCouncilInput(rawInput);
    const idempotencyKeyHash = growthHttpIdempotencyKeyHash(
      command.idempotencyKey
    );
    const runId = `financial-council:create:${idempotencyKeyHash}`;
    const creationKeyHash = financialCouncilCanonicalHash(runId);
    const canonicalRequestHash = requestHash(command.requestHash);
    const replay = await this.dependencies.repository
      .findFrozenRunByCreationKey(
        command.workspace, creationKeyHash, canonicalRequestHash
      );
    if (replay) return { value: replay, replayed: true };
    const createdAt = instant(this.now());
    const snapshot = await this.dependencies.snapshotBuilder.freeze(
      command, runId, input
    );
    const aggregate = immutableFinancialCouncilValue({
      runId,
      workspaceId: command.workspace.workspaceId,
      creationKeyHash,
      requestHash: canonicalRequestHash,
      currency: input.currency,
      status: "created" as const,
      revision: 1,
      dataAsOf: snapshot.dataAsOf,
      businessReport: input.businessReport,
      policyVersionId: input.policyVersionId,
      snapshotId: null,
      snapshotHash: null,
      consensusReport: null,
      portfolios: Object.freeze([]),
      latestPortfolioRevision: null,
      approval: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 86_400_000).toISOString()
    } satisfies FinancialCouncilRun);
    const record = immutableFinancialCouncilValue({
      snapshotId: snapshot.snapshotId,
      runId,
      workspaceId: command.workspace.workspaceId,
      snapshotHash: snapshot.snapshotHash,
      snapshot: snapshot as unknown as Readonly<Record<string, unknown>>,
      createdAt
    } satisfies FinancialSnapshotRecord);
    const result = await this.dependencies.repository.createAndFreezeRun(
      command,
      { aggregate, snapshot: record, occurredAt: createdAt }
    );
    if (!result.replayed && this.dependencies.advisoryWake) {
      await this.dependencies.advisoryWake.wake(result.value).catch((error) => {
        this.dependencies.onAdvisoryWakeError?.(error, result.value);
      });
    }
    return result;
  }

  async getRun(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<FinancialCouncilRun> {
    authorize(context);
    if (typeof runId !== "string" || !runId.trim() || runId.length > 255) {
      throw financialCouncilError("financial_council_input_invalid");
    }
    const run = await this.dependencies.repository.findRun(context, runId);
    if (!run) throw financialCouncilError("financial_council_run_not_found");
    return run;
  }

  async listEvents(
    context: ActiveWorkspaceContext,
    runId: string
  ): Promise<readonly FinancialCouncilRunEvent[]> {
    await this.getRun(context, runId);
    return this.dependencies.repository.listEvents(context, runId);
  }
}

export type { FinancialSnapshot };
