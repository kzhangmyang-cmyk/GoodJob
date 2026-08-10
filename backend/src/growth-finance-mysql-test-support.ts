import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import mysql from "mysql2/promise";
import { AcquisitionCostLedgerService, type CreatePendingCostInput } from "./acquisition-cost-ledger.js";
import { MysqlVerifiedFinancialLedgerSealedReader } from "./financial-ledger-as-of-mysql-reader.js";
import { ensureFinancialLedgerMysqlSchema, MysqlFinancialLedgerRepository } from "./financial-ledger-mysql-repository.js";
import type { CommandContext } from "./growth-command-context.js";
import type { GrowthFoundationServices } from "./growth-foundation-module.js";
import { ensureGrowthHttpIdempotencyMysqlSchema, MysqlGrowthHttpIdempotencyRepository } from "./growth-http-idempotency-mysql-repository.js";
import { canonicalGrowthRequestHash } from "./growth-http-idempotency-repository.js";
import { commandContextFromRequest } from "./growth-http-preconditions.js";
import { MysqlGrowthTemporalBarrier, growthMysqlDate, growthMysqlInstant } from "./growth-temporal-barrier-mysql-repository.js";
import type { GrowthSealedReadCutoff } from "./growth-temporal-barrier.js";
import { createGrowthAcquisitionWorkspaceResolver, type ActiveWorkspaceContext } from "./growth-workspace-context.js";
import { ensureGrowthWorkspaceSettingsMysqlSchema, MysqlGrowthWorkspaceSettingsRepository } from "./growth-workspace-settings-mysql-repository.js";

function connectionOptions(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    timezone: "Z" as const,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  };
}

export function requireGrowthFinanceMysqlTestAdminUrl(): URL {
  const configured = process.env.MYSQL_TEST_ADMIN_URL?.trim();
  if (!configured) throw new Error("MYSQL_TEST_ADMIN_URL_REQUIRED:growth-finance");
  const url = new URL(configured);
  if (url.protocol !== "mysql:") {
    throw new Error("MYSQL_TEST_ADMIN_URL_REQUIRED:growth-finance:mysql-protocol");
  }
  return url;
}

function workspaceContext(workspaceId: string, actorId = "finance-a"): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId,
    kind: "team" as const,
    actorId,
    role: "admin" as const,
    teamId: workspaceId,
    capabilities: Object.freeze([
      "ledger.pending.create" as const,
      "ledger.verify" as const,
      "roi.close" as const,
      "growth.performance.workspace.read" as const,
      "pricing.sensitive.read" as const
    ]),
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

function command(workspaceId: string, key: string, expectedRevision: number | null = null): CommandContext {
  return Object.freeze({
    workspace: workspaceContext(workspaceId),
    actorId: "finance-a",
    idempotencyKey: key,
    expectedRevision,
    requestHash: canonicalGrowthRequestHash({ workspaceId, key, expectedRevision })
  });
}

export interface HistoricalLedgerSeed {
  entryId: string;
  businessOccurredAt: string;
  recordedAt: string;
  amountMinor: number;
  factType: "contract_won" | "payment_received" | "revenue_recognized" | "cogs_recognized" | "refund" | "bad_debt_written_off";
  candidateId: string | null;
  customerId: string | null;
  dealId: string | null;
  quoteVersionId: string | null;
  commercialBindingHash: string;
  evidenceHash: string;
  verificationRecordedAt: string;
  reversalRecordedAt?: string | null;
}

export interface GrowthFinanceMysqlTestDatabase {
  databaseName: string;
  pool: mysql.Pool;
  connectionA: mysql.PoolConnection;
  connectionB: mysql.PoolConnection;
  idempotency: MysqlGrowthHttpIdempotencyRepository;
  foundation: GrowthFoundationServices;
  verifiedSealedReader: MysqlVerifiedFinancialLedgerSealedReader;
  workspaceContext: typeof workspaceContext;
  command: typeof command;
  newCostInput(overrides?: Partial<CreatePendingCostInput>): CreatePendingCostInput;
  costLedgerOnConnection(name: "a" | "b"): AcquisitionCostLedgerService;
  setSessionTimestamp3(name: "a" | "b", value: string): Promise<void>;
  currentTimestamp3OnConnection(name: "a" | "b"): Promise<string>;
  sealReadCutoffOnConnection(name: "a", workspace: ActiveWorkspaceContext,
    effectiveCutoff: string): Promise<GrowthSealedReadCutoff>;
  businessLockTrace(key: string): readonly string[];
  reReadOldCutoffAfterLaterAppend(cutoff: GrowthSealedReadCutoff,
    entryId: string): Promise<readonly unknown[]>;
  seedHistoricalLedger(input: HistoricalLedgerSeed): Promise<void>;
}

export async function withGrowthFinanceMysqlTestDatabase<T>(
  testBody: (fixture: GrowthFinanceMysqlTestDatabase) => Promise<T>
): Promise<T> {
  const adminUrl = requireGrowthFinanceMysqlTestAdminUrl();
  const databaseName = `goodjob_growth_finance_${process.pid}_${randomUUID()
    .replaceAll("-", "").slice(0, 12)}`;
  const admin = await mysql.createConnection(connectionOptions(adminUrl));
  let pool: mysql.Pool | undefined;
  let connectionA: mysql.PoolConnection | undefined;
  let connectionB: mysql.PoolConnection | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE \`${databaseName}\`
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    pool = mysql.createPool({
      ...connectionOptions(adminUrl), database: databaseName, connectionLimit: 4
    });
    await ensureGrowthHttpIdempotencyMysqlSchema(pool);
    await ensureFinancialLedgerMysqlSchema(pool);
    await ensureGrowthWorkspaceSettingsMysqlSchema(pool);
    // Schema installation is an upgrade path and must remain retry-safe.
    await ensureFinancialLedgerMysqlSchema(pool);
    connectionA = await pool.getConnection();
    connectionB = await pool.getConnection();
    assert.notEqual(connectionA.threadId, connectionB.threadId,
      "growth Finance gate requires two physical connections");

    const repositoryA = new MysqlFinancialLedgerRepository(connectionA);
    const repositoryB = new MysqlFinancialLedgerRepository(connectionB);
    const temporalBarrier = new MysqlGrowthTemporalBarrier(repositoryA);
    const idempotency = new MysqlGrowthHttpIdempotencyRepository(pool);
    const acquisitionWorkspace = createGrowthAcquisitionWorkspaceResolver({
      async resolve(scope) {
        return { workspaceId: scope.teamId, kind: "team" as const,
          bindingRevision: "finance-mysql-test.v1" };
      }
    });
    const foundation: GrowthFoundationServices = Object.freeze({
      httpIdempotency: idempotency,
      workspaceSettings: new MysqlGrowthWorkspaceSettingsRepository(pool, temporalBarrier),
      workspaceContext: (request: Request) => {
        if (!request.activeWorkspace) throw new Error("workspace_required");
        return request.activeWorkspace;
      },
      acquisitionWorkspace,
      temporalTransactions: repositoryA,
      temporalBarrier,
      commandContextFactory: commandContextFromRequest
    });
    const repositories = { a: repositoryA, b: repositoryB } as const;
    const connections = { a: connectionA, b: connectionB } as const;
    const services = {
      a: new AcquisitionCostLedgerService({ repository: repositoryA, foundation }),
      b: new AcquisitionCostLedgerService({ repository: repositoryB, foundation })
    } as const;
    const verifiedSealedReader = new MysqlVerifiedFinancialLedgerSealedReader(connectionA);
    const fixture: GrowthFinanceMysqlTestDatabase = {
      databaseName,
      pool,
      connectionA,
      connectionB,
      idempotency,
      foundation,
      verifiedSealedReader,
      workspaceContext,
      command,
      newCostInput: (overrides = {}) => ({
        platform: "douyin", planId: null, runId: null, providerId: null,
        category: "media", amountMinor: 10_000, currency: "CNY",
        businessOccurredAt: "2026-08-09T08:00:00.000Z",
        provenance: "portal_export", sourceRef: "portal://new-cost",
        evidenceHash: "sha256:new-cost", externalId: "new-cost",
        sourceIdentityRoot: "external:portal:new-cost",
        estimateReconciliationId: null, ...overrides
      }),
      costLedgerOnConnection: (name) => services[name],
      setSessionTimestamp3: async (name, value) => {
        const seconds = Math.floor(Date.parse(value) / 1000);
        if (!Number.isSafeInteger(seconds)) throw new Error("invalid_test_timestamp");
        await connections[name].query("SET timestamp = ?", [seconds]);
      },
      currentTimestamp3OnConnection: async (name) => {
        const [rows] = await connections[name].query(
          "SELECT CURRENT_TIMESTAMP(3) AS current_timestamp_3"
        );
        const row = (rows as Array<Record<string, unknown>>)[0];
        if (!row) throw new Error("growth_database_clock_missing");
        return growthMysqlInstant(row.current_timestamp_3);
      },
      sealReadCutoffOnConnection: async (_name, workspace, effectiveCutoff) =>
        foundation.temporalBarrier.sealReadCutoff(workspace, effectiveCutoff),
      businessLockTrace: (_key) => repositories.b.lockTraces.find((trace) =>
        trace.some((lock) => lock.startsWith("source:"))) ?? [],
      reReadOldCutoffAfterLaterAppend: (cutoff, entryId) =>
        verifiedSealedReader.listVerifiedCostsAt(cutoff, {
          currency: "CNY", entryIds: [entryId]
        }),
      seedHistoricalLedger: async (input) => {
        if (!Number.isSafeInteger(input.amountMinor)) throw new Error("invalid_ledger_amount_minor");
        const binding = JSON.stringify({
          candidateId: input.candidateId, handoffId: "handoff-1", leadId: "lead-1",
          customerId: input.customerId, dealId: input.dealId, candidateVersion: 1,
          handoffContentHash: "sha256:handoff", dealContentHash: "sha256:deal",
          bindingHashSchemaVersion: "commercial-binding.v1",
          attributionSnapshot: {
            attributionVersion: "acquisition-run.v1", runId: "run-1", planId: "plan-1",
            planVersionId: "plan-version-1", planVersion: 1,
            planSnapshotHash: "sha256:plan", discoveredEventId: "discovered-1",
            discoveredAt: "2026-08-01T00:00:00.000Z", shardId: "shard-1",
            operationId: "operation-1", connectionId: "connection-1",
            providerId: "provider-1", evidenceIds: ["evidence-1"],
            providerIds: ["provider-1"], queryIds: ["query-1"],
            strategyVersion: "strategy-1", qualificationDecisionId: "qualification-1",
            decisionVersion: "decision-1", decisionSnapshotHash: "sha256:decision"
          },
          bindingHash: input.commercialBindingHash,
          verifiedAt: "2026-08-01T00:00:00.000Z"
        });
        await pool!.query(
          `INSERT INTO financial_facts (
            id, workspace_id, candidate_id, customer_id, deal_id, quote_version_id,
            fact_type, amount_minor, currency, business_occurred_at, recorded_at,
            temporal_sequence, provenance, source_ref, evidence_hash, external_id,
            source_identity_root, source_version, attribution_snapshot_json,
            commercial_binding_snapshot_json, commercial_amount_hash,
            deal_authority_revision, corrects_fact_id, correction_group_id, created_by
          ) VALUES (${Array(25).fill("?").join(", ")})`,
          [input.entryId, "workspace-a", input.candidateId, input.customerId,
            input.dealId, input.quoteVersionId, input.factType, input.amountMinor,
            "CNY", growthMysqlDate(input.businessOccurredAt),
            growthMysqlDate(input.recordedAt), 1, "invoice_confirmed", "seed://fact",
            input.evidenceHash, input.entryId, `external:seed:${input.entryId}`, 1,
            null, binding, "sha256:commercial", 1, null, null, "finance-a"]
        );
        await pool!.query(
          `INSERT INTO ledger_verification_events (
            id, workspace_id, ledger_type, ledger_entry_id, event_type,
            reverses_event_id, event_sequence, revision, correction_group_id,
            reason, decided_by, recorded_at, temporal_sequence
          ) VALUES (?, 'workspace-a', 'financial', ?, 'verified', NULL, 1, 2,
            NULL, 'checked', 'finance-a', ?, 2)`,
          [`verify-${input.entryId}`, input.entryId,
            growthMysqlDate(input.verificationRecordedAt)]
        );
        let sequence = 2;
        let lastRecordedAt = input.verificationRecordedAt;
        if (input.reversalRecordedAt) {
          await pool!.query(
            `INSERT INTO ledger_verification_events (
              id, workspace_id, ledger_type, ledger_entry_id, event_type,
              reverses_event_id, event_sequence, revision, correction_group_id,
              reason, decided_by, recorded_at, temporal_sequence
            ) VALUES (?, 'workspace-a', 'financial', ?, 'reversed', ?, 2, 3,
              NULL, 'reversed', 'finance-a', ?, 3)`,
            [`reverse-${input.entryId}`, input.entryId, `verify-${input.entryId}`,
              growthMysqlDate(input.reversalRecordedAt)]
          );
          sequence = 3;
          lastRecordedAt = input.reversalRecordedAt;
        }
        await pool!.query(
          `INSERT INTO growth_workspace_temporal_barriers (
            workspace_id, last_recorded_at, temporal_sequence
          ) VALUES ('workspace-a', ?, ?)
          ON DUPLICATE KEY UPDATE last_recorded_at = VALUES(last_recorded_at),
            temporal_sequence = VALUES(temporal_sequence)`,
          [growthMysqlDate(lastRecordedAt), sequence]
        );
      }
    };
    return await testBody(fixture);
  } finally {
    connectionB?.release();
    connectionA?.release();
    if (pool) await pool.end();
    if (created) await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin.end();
  }
}
