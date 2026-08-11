import type {
  AuthoritativeDealDecisionRef
} from "./authoritative-quote-reader.js";
import type {
  AcquisitionCostEntry,
  FinancialFactType
} from "./financial-ledger-domain.js";
import {
  DefaultGrowthTemporalBarrier,
  InMemoryGrowthTemporalTransactionRunner,
  type GrowthTemporalBarrier,
  type GrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";

export type FinanceImportKind = "acquisition_cost" | "financial_fact";

export type FinanceImportRowErrorCode =
  | "spreadsheet_formula_forbidden"
  | "verified_import_forbidden"
  | "required_field_missing"
  | "money_invalid"
  | "currency_invalid"
  | "business_time_invalid"
  | "commercial_binding_invalid"
  | "row_identity_conflict"
  | "financial_fact_conflict"
  | "financial_fact_amount_invalid"
  | "amount_out_of_range";

export type FinanceImportPublicNormalizedRow =
  | {
      kind: "acquisition_cost";
      category: AcquisitionCostEntry["category"];
      amountMinor: number;
      currency: string;
      businessOccurredAt: string;
      externalId: string | null;
      evidenceHash: string;
    }
  | {
      kind: "financial_fact";
      candidateId: string | null;
      customerId: string | null;
      dealId: string | null;
      currency: string;
      businessOccurredAt: string;
      externalId: string | null;
      evidenceHash: string;
      derivedFacts: Array<{
        factType: FinancialFactType;
        amountMinor: number;
        provenance?: "derived_from_import";
      }>;
    };

export type FinanceImportStoredNormalizedRow =
  | Extract<FinanceImportPublicNormalizedRow, { kind: "acquisition_cost" }>
  | (Extract<
        FinanceImportPublicNormalizedRow,
        { kind: "financial_fact" }
      > & {
        readonly authoritativeDecision: AuthoritativeDealDecisionRef | null;
      });

export interface FinanceImportPreviewRow {
  rowNumber: number;
  sheetName: string;
  status: "valid" | "invalid";
  sourceIdentityRoot: string;
  normalized: FinanceImportPublicNormalizedRow | null;
  errors: FinanceImportRowErrorCode[];
}

export interface FinanceImportStoredRow {
  readonly id: string;
  readonly previewId: string;
  readonly rowNumber: number;
  readonly sheetName: string;
  readonly status: "valid" | "invalid";
  readonly sourceIdentityRoot: string;
  readonly normalized: FinanceImportStoredNormalizedRow | null;
  readonly errors: readonly FinanceImportRowErrorCode[];
  readonly recordedAt: string;
  readonly temporalSequence: number;
}

export interface FinanceImportPreviewRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdBy: string;
  readonly previewRequestHash: string;
  readonly fileHash: string;
  readonly templateVersion: string;
  readonly kind: FinanceImportKind;
  readonly resolvedTimeZone: string;
  readonly workspaceSettingsRevision: string;
  readonly workspaceSettingsRecordedAt: string;
  readonly workspaceSettingsEventSequence: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly authorityEffectiveAsOf: string;
  readonly authorityTemporalSequence: number;
  readonly createdAt: string;
  readonly temporalSequence: number;
}

export interface FinanceImportPreviewRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdBy: string;
  readonly previewRequestHash: string;
  readonly fileHash: string;
  readonly templateVersion: string;
  readonly kind: FinanceImportKind;
  readonly resolvedTimeZone: string;
  readonly workspaceSettingsRevision: string;
  readonly workspaceSettingsRecordedAt: string;
  readonly workspaceSettingsEventSequence: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly authorityEffectiveAsOf: string;
  readonly authorityTemporalSequence: number;
}

export interface FinanceImportStoredRowInput {
  readonly id: string;
  readonly previewId: string;
  readonly rowNumber: number;
  readonly sheetName: string;
  readonly status: "valid" | "invalid";
  readonly sourceIdentityRoot: string;
  readonly normalized: FinanceImportStoredNormalizedRow | null;
  readonly errors: readonly FinanceImportRowErrorCode[];
}

export interface FinanceImportOperation {
  readonly id: string;
  readonly previewId: string;
  readonly workspaceId: string;
  readonly requestingActorId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly previewRequestHash: string;
  readonly fileHash: string;
  readonly templateVersion: string;
  status: "queued" | "running" | "succeeded" | "partial_success" | "failed";
  validRows: number;
  invalidRows: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  fencingToken: number;
  resultCreatedIds: string[];
  lastErrorCode: string | null;
  createdAt: string;
  createdTemporalSequence: number;
  updatedAt: string;
  temporalSequence: number;
}

export interface FinanceImportOperationInput {
  readonly id: string;
  readonly previewId: string;
  readonly workspaceId: string;
  readonly requestingActorId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly previewRequestHash: string;
  readonly fileHash: string;
  readonly templateVersion: string;
  readonly status: FinanceImportOperation["status"];
  readonly validRows: number;
  readonly invalidRows: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly fencingToken: number;
  readonly resultCreatedIds: readonly string[];
  readonly lastErrorCode: string | null;
}

export interface FinanceImportRepository {
  getPreview(
    previewId: string
  ): Promise<FinanceImportPreviewRecord | null>;
  appendPreview(
    record: FinanceImportPreviewRecordInput,
    rows: readonly FinanceImportStoredRowInput[]
  ): Promise<FinanceImportPreviewRecord>;
  getStoredRow(
    previewId: string,
    rowNumber: number
  ): Promise<FinanceImportStoredRow | null>;
  listStoredRows(previewId: string): Promise<FinanceImportStoredRow[]>;
  getOperation(operationId: string): Promise<FinanceImportOperation | null>;
  appendOperation(
    input: FinanceImportOperationInput
  ): Promise<FinanceImportOperation>;
}

function immutablePreviewRecord(
  record: FinanceImportPreviewRecord
): FinanceImportPreviewRecord {
  return Object.freeze({ ...record });
}

function immutableStoredRow(
  row: FinanceImportStoredRow
): FinanceImportStoredRow {
  return Object.freeze({
    ...row,
    errors: Object.freeze([...row.errors]),
    normalized: row.normalized === null
      ? null
      : Object.freeze(row.normalized)
  });
}

function immutableOperation(
  operation: FinanceImportOperation
): FinanceImportOperation {
  return Object.freeze({
    ...operation,
    resultCreatedIds: [...operation.resultCreatedIds]
  });
}

export class InMemoryFinanceImportRepository
implements FinanceImportRepository {
  private readonly transactions: GrowthTemporalTransactionRunner;
  private readonly barrier: GrowthTemporalBarrier;
  private readonly previews = new Map<string, FinanceImportPreviewRecord>();
  private readonly rows = new Map<string, FinanceImportStoredRow>();
  private readonly operations = new Map<string, FinanceImportOperation>();

  constructor(
    temporalTransactions?: GrowthTemporalTransactionRunner,
    temporalBarrier?: GrowthTemporalBarrier
  ) {
    this.transactions = temporalTransactions
      ?? new InMemoryGrowthTemporalTransactionRunner();
    this.barrier = temporalBarrier
      ?? new DefaultGrowthTemporalBarrier(this.transactions);
  }

  async getPreview(previewId: string): Promise<FinanceImportPreviewRecord | null> {
    return this.previews.get(previewId) ?? null;
  }

  async appendPreview(
    record: FinanceImportPreviewRecordInput,
    rows: readonly FinanceImportStoredRowInput[]
  ): Promise<FinanceImportPreviewRecord> {
    const stored = await this.transactions.run(async (tx) => {
      const previewStamp = await this.barrier.allocateAppend(
        tx, record.workspaceId
      );
      if (this.previews.has(record.id)) {
        throw new Error("finance_import_preview_exists");
      }
      const preview = immutablePreviewRecord({
        ...record,
        createdAt: previewStamp.recordedAt,
        temporalSequence: previewStamp.temporalSequence
      });
      const storedRows: FinanceImportStoredRow[] = [];
      for (const row of rows) {
        const stamp = await this.barrier.allocateAppend(
          tx, record.workspaceId
        );
        storedRows.push(immutableStoredRow({
          ...row,
          recordedAt: stamp.recordedAt,
          temporalSequence: stamp.temporalSequence
        }));
      }
      return { preview, storedRows };
    });
    this.previews.set(stored.preview.id, stored.preview);
    for (const row of stored.storedRows) {
      this.rows.set(`${row.previewId}\u0000${row.rowNumber}`, row);
    }
    return stored.preview;
  }

  async getStoredRow(
    previewId: string,
    rowNumber: number
  ): Promise<FinanceImportStoredRow | null> {
    return this.rows.get(`${previewId}\u0000${rowNumber}`) ?? null;
  }

  async listStoredRows(previewId: string): Promise<FinanceImportStoredRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.previewId === previewId)
      .sort((left, right) => left.rowNumber - right.rowNumber);
  }

  async getOperation(
    operationId: string
  ): Promise<FinanceImportOperation | null> {
    return this.operations.get(operationId) ?? null;
  }

  async appendOperation(
    input: FinanceImportOperationInput
  ): Promise<FinanceImportOperation> {
    const stamp = await this.transactions.run(async (tx) => {
      const allocated = await this.barrier.allocateAppend(
        tx, input.workspaceId
      );
      if (this.operations.has(input.id)) {
        throw new Error("finance_import_operation_exists");
      }
      return allocated;
    });
    const operation = immutableOperation({
      ...input,
      resultCreatedIds: [...input.resultCreatedIds],
      createdAt: stamp.recordedAt,
      createdTemporalSequence: stamp.temporalSequence,
      updatedAt: stamp.recordedAt,
      temporalSequence: stamp.temporalSequence
    });
    this.operations.set(operation.id, operation);
    return operation;
  }

  countPreviews(): number {
    return this.previews.size;
  }

  countStoredRows(): number {
    return this.rows.size;
  }

  countOperations(): number {
    return this.operations.size;
  }

  countOperationsFor(previewId: string): number {
    return [...this.operations.values()]
      .filter((operation) => operation.previewId === previewId).length;
  }

  seedPreview(
    record: FinanceImportPreviewRecordInput,
    rows: readonly FinanceImportStoredRowInput[]
  ): FinanceImportPreviewRecord {
    const preview = immutablePreviewRecord({
      ...record,
      createdAt: record.authorityEffectiveAsOf,
      temporalSequence: record.authorityTemporalSequence
    });
    this.previews.set(preview.id, preview);
    for (const row of rows) {
      this.rows.set(`${row.previewId}\u0000${row.rowNumber}`, immutableStoredRow({
        ...row,
        recordedAt: record.authorityEffectiveAsOf,
        temporalSequence: record.authorityTemporalSequence
      }));
    }
    return preview;
  }
}
