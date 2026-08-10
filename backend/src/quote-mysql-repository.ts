import type mysql from "mysql2/promise";
import {
  MysqlGrowthTemporalTransaction,
  growthMysqlDate,
  growthMysqlInstant
} from "./growth-temporal-barrier-mysql-repository.js";
import {
  assertConcreteGrowthWorkspaceId,
  assertGrowthTemporalBarrier,
  type GrowthTemporalBarrier
} from "./growth-temporal-barrier.js";
import type {
  BindQuoteCaseDealCommand,
  CancelQuoteCaseCommand,
  CloseQuoteCaseCommand,
  CreateQuoteCaseCommand,
  QuoteCase,
  QuoteCaseCommandResult,
  QuoteCaseListQuery,
  QuoteRepository
} from "./quote-repository.js";
import type { CommercialBindingSnapshot } from "./commercial-binding-snapshot.js";
import type { OutcomeAttributionInput } from "./acquisition-domain.js";

type MysqlRow = Record<string, unknown>;

export const QUOTE_MYSQL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS quote_cases (
    workspace_id VARCHAR(191) NOT NULL,
    id VARCHAR(191) NOT NULL,
    candidate_id VARCHAR(191) NULL,
    customer_id VARCHAR(191) NULL,
    deal_id VARCHAR(191) NULL,
    assigned_to VARCHAR(191) NOT NULL,
    status ENUM('open','closed','cancelled') NOT NULL,
    current_draft_version_id VARCHAR(191) NULL,
    revision BIGINT UNSIGNED NOT NULL,
    binding_snapshot_id VARCHAR(191) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    open_deal_id VARCHAR(191) GENERATED ALWAYS AS (
      CASE WHEN status = 'open' THEN deal_id ELSE NULL END
    ) STORED,
    PRIMARY KEY (workspace_id,id),
    UNIQUE KEY uk_quote_open_deal (workspace_id,open_deal_id),
    KEY idx_quote_case_list (workspace_id,status,id),
    CONSTRAINT chk_quote_case_subject CHECK (
      candidate_id IS NOT NULL OR customer_id IS NOT NULL OR deal_id IS NOT NULL
    ),
    CONSTRAINT chk_quote_case_workspace CHECK (
      workspace_id <> 'all' AND CHAR_LENGTH(TRIM(workspace_id)) > 0
    )
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS commercial_binding_snapshots (
    workspace_id VARCHAR(191) NOT NULL,
    id VARCHAR(191) NOT NULL,
    quote_case_id VARCHAR(191) NOT NULL,
    candidate_id VARCHAR(191) NOT NULL,
    handoff_id VARCHAR(191) NOT NULL,
    lead_id VARCHAR(191) NULL,
    customer_id VARCHAR(191) NOT NULL,
    deal_id VARCHAR(191) NOT NULL,
    candidate_version BIGINT UNSIGNED NOT NULL,
    handoff_content_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    deal_content_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    binding_hash_schema_version VARCHAR(64) NOT NULL,
    attribution_snapshot_json JSON NOT NULL,
    binding_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    verified_at DATETIME(3) NOT NULL,
    recorded_at DATETIME(3) NOT NULL,
    temporal_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (workspace_id,id),
    UNIQUE KEY uk_quote_case_binding (workspace_id,quote_case_id),
    KEY idx_quote_binding_deal (workspace_id,deal_id),
    CONSTRAINT chk_quote_binding_attribution CHECK (
      JSON_VALID(attribution_snapshot_json)
    )
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_versions (
    workspace_id VARCHAR(191) NOT NULL,
    id VARCHAR(191) NOT NULL,
    quote_case_id VARCHAR(191) NOT NULL,
    version BIGINT UNSIGNED NOT NULL,
    version_kind ENUM('draft','formal') NOT NULL,
    source_draft_version_id VARCHAR(191) NULL,
    probability_assessment_json JSON NULL,
    frozen_version_json JSON NOT NULL,
    effective_at DATETIME(3) NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    recorded_at DATETIME(3) NOT NULL,
    temporal_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (workspace_id,id),
    UNIQUE KEY uk_quote_case_version (workspace_id,quote_case_id,version),
    UNIQUE KEY uk_quote_formal_source_draft (workspace_id,source_draft_version_id),
    CONSTRAINT chk_quote_version_authority CHECK ((version_kind = 'draft'
      AND source_draft_version_id IS NULL AND probability_assessment_json IS NULL)
      OR (version_kind = 'formal' AND source_draft_version_id IS NOT NULL
        AND probability_assessment_json IS NOT NULL)),
    CONSTRAINT chk_quote_version_json CHECK (JSON_VALID(frozen_version_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_version_line_snapshots (
    workspace_id VARCHAR(191) NOT NULL, quote_version_id VARCHAR(191) NOT NULL,
    line_number INT UNSIGNED NOT NULL, snapshot_json JSON NOT NULL,
    PRIMARY KEY (workspace_id,quote_version_id,line_number),
    CONSTRAINT chk_quote_line_snapshot_json CHECK (JSON_VALID(snapshot_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_version_gift_snapshots (
    workspace_id VARCHAR(191) NOT NULL, quote_version_id VARCHAR(191) NOT NULL,
    gift_number INT UNSIGNED NOT NULL, snapshot_json JSON NOT NULL,
    PRIMARY KEY (workspace_id,quote_version_id,gift_number),
    CONSTRAINT chk_quote_gift_snapshot_json CHECK (JSON_VALID(snapshot_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_version_package_snapshots (
    workspace_id VARCHAR(191) NOT NULL, quote_version_id VARCHAR(191) NOT NULL,
    package_version_id VARCHAR(191) NOT NULL, snapshot_json JSON NOT NULL,
    PRIMARY KEY (workspace_id,quote_version_id,package_version_id),
    CONSTRAINT chk_quote_package_snapshot_json CHECK (JSON_VALID(snapshot_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_lifecycle_events (
    workspace_id VARCHAR(191) NOT NULL, id VARCHAR(191) NOT NULL,
    quote_case_id VARCHAR(191) NOT NULL, quote_version_id VARCHAR(191) NULL,
    lifecycle_stream_id VARCHAR(191) GENERATED ALWAYS AS (
      COALESCE(quote_version_id,'__case__')
    ) STORED,
    lifecycle_revision BIGINT UNSIGNED NOT NULL,
    from_status VARCHAR(32) NULL, to_status VARCHAR(32) NOT NULL,
    event_type VARCHAR(64) NOT NULL, actor_id VARCHAR(191) NOT NULL,
    recorded_at DATETIME(3) NOT NULL, temporal_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (workspace_id,id),
    UNIQUE KEY uk_quote_lifecycle_revision
      (workspace_id,quote_case_id,lifecycle_stream_id,lifecycle_revision),
    KEY idx_quote_lifecycle_current
      (workspace_id,quote_case_id,quote_version_id,lifecycle_revision)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_approvals (
    workspace_id VARCHAR(191) NOT NULL, id VARCHAR(191) NOT NULL,
    quote_version_id VARCHAR(191) NOT NULL,
    status ENUM('pending','approved','rejected','cancelled') NOT NULL,
    approval_kind ENUM('confirmation','exception') NOT NULL,
    approval_json JSON NOT NULL,
    active_quote_version_id VARCHAR(191) GENERATED ALWAYS AS (
      CASE WHEN status = 'pending' THEN quote_version_id ELSE NULL END
    ) STORED,
    recorded_at DATETIME(3) NOT NULL, temporal_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (workspace_id,id),
    UNIQUE KEY uk_quote_active_approval (workspace_id,active_quote_version_id),
    CONSTRAINT chk_quote_approval_json CHECK (JSON_VALID(approval_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS deal_authoritative_quotes (
    workspace_id VARCHAR(191) NOT NULL, deal_id VARCHAR(191) NOT NULL,
    open_quote_case_id VARCHAR(191) NULL, quote_version_id VARCHAR(191) NULL,
    commercial_amount_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NULL,
    authority_revision BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id,deal_id),
    UNIQUE KEY uk_deal_open_quote_case (workspace_id,open_quote_case_id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS deal_authoritative_quote_events (
    workspace_id VARCHAR(191) NOT NULL, id VARCHAR(191) NOT NULL,
    deal_id VARCHAR(191) NOT NULL, authority_revision BIGINT UNSIGNED NOT NULL,
    quote_case_id VARCHAR(191) NOT NULL, quote_version_id VARCHAR(191) NULL,
    event_type VARCHAR(64) NOT NULL,
    recorded_at DATETIME(3) NOT NULL, temporal_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (workspace_id,id),
    UNIQUE KEY uk_deal_authority_revision
      (workspace_id,deal_id,authority_revision)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_publication_operations (
    workspace_id VARCHAR(191) NOT NULL, id VARCHAR(191) NOT NULL,
    quote_case_id VARCHAR(191) NOT NULL, quote_version_id VARCHAR(191) NOT NULL,
    deal_id VARCHAR(191) NOT NULL, stable_key_hash CHAR(71) NOT NULL,
    operation_json JSON NOT NULL,
    recorded_at DATETIME(3) NOT NULL, temporal_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (workspace_id,id),
    UNIQUE KEY uk_quote_publication_stable (workspace_id,stable_key_hash),
    CONSTRAINT chk_quote_publication_json CHECK (JSON_VALID(operation_json))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS quote_command_idempotency (
    workspace_id VARCHAR(191) NOT NULL, command_key VARCHAR(255) NOT NULL,
    request_hash CHAR(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    quote_case_id VARCHAR(191) NOT NULL, completed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id,command_key)
  ) ENGINE=InnoDB`
] as const;

export async function ensureQuoteMysqlSchema(pool: mysql.Pool): Promise<void> {
  for (const statement of QUOTE_MYSQL_SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
}

function quoteError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function bindingFromRow(row: MysqlRow): CommercialBindingSnapshot | null {
  if (row.binding_snapshot_id === null || row.binding_snapshot_id === undefined) {
    return null;
  }
  return Object.freeze({
    candidateId: String(row.binding_candidate_id),
    handoffId: String(row.handoff_id),
    leadId: row.binding_lead_id === null ? null : String(row.binding_lead_id),
    customerId: String(row.binding_customer_id),
    dealId: String(row.binding_deal_id),
    candidateVersion: Number(row.candidate_version),
    handoffContentHash: String(row.handoff_content_hash) as `sha256:${string}`,
    dealContentHash: String(row.deal_content_hash) as `sha256:${string}`,
    bindingHashSchemaVersion: String(row.binding_hash_schema_version) as "commercial-binding.v1",
    attributionSnapshot: json<OutcomeAttributionInput>(row.attribution_snapshot_json),
    bindingHash: String(row.binding_hash) as `sha256:${string}`,
    verifiedAt: growthMysqlInstant(row.verified_at)
  });
}

function parseCase(row: MysqlRow): QuoteCase {
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw quoteError("invalid_quote_case_revision");
  }
  return Object.freeze({
    id: String(row.id), workspaceId: String(row.workspace_id),
    candidateId: row.candidate_id === null ? null : String(row.candidate_id),
    customerId: row.customer_id === null ? null : String(row.customer_id),
    dealId: row.deal_id === null ? null : String(row.deal_id),
    assignedTo: String(row.assigned_to),
    status: String(row.status) as QuoteCase["status"],
    currentDraftVersionId: row.current_draft_version_id === null
      ? null : String(row.current_draft_version_id),
    revision, commercialBindingSnapshot: bindingFromRow(row),
    createdAt: growthMysqlInstant(row.created_at),
    updatedAt: growthMysqlInstant(row.updated_at)
  });
}

const CASE_SELECT = `SELECT qc.*, cbs.id AS binding_snapshot_id,
  cbs.candidate_id AS binding_candidate_id, cbs.handoff_id,
  cbs.lead_id AS binding_lead_id, cbs.customer_id AS binding_customer_id,
  cbs.deal_id AS binding_deal_id, cbs.candidate_version,
  cbs.handoff_content_hash, cbs.deal_content_hash,
  cbs.binding_hash_schema_version, cbs.attribution_snapshot_json,
  cbs.binding_hash, cbs.verified_at
  FROM quote_cases qc LEFT JOIN commercial_binding_snapshots cbs
    ON cbs.workspace_id = qc.workspace_id
    AND cbs.id = qc.binding_snapshot_id`;

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
}

function duplicate(error: unknown) {
  return (error as { code?: string }).code === "ER_DUP_ENTRY";
}

export class MysqlQuoteRepository implements QuoteRepository {
  private readonly temporalBarrier: GrowthTemporalBarrier;

  constructor(private readonly pool: mysql.Pool, temporalBarrier: GrowthTemporalBarrier) {
    this.temporalBarrier = assertGrowthTemporalBarrier(temporalBarrier);
  }

  private async transaction<T>(work: (
    connection: mysql.PoolConnection,
    temporal: MysqlGrowthTemporalTransaction
  ) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection,
        new MysqlGrowthTemporalTransaction(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async receipt(
    connection: mysql.PoolConnection,
    workspaceId: string,
    commandKey: string,
    requestHash: string
  ): Promise<string | null> {
    const [rows] = await connection.query(
      `SELECT request_hash,quote_case_id FROM quote_command_idempotency
       WHERE workspace_id = ? AND command_key = ? FOR UPDATE`,
      [workspaceId, commandKey]
    );
    const row = (rows as MysqlRow[])[0];
    if (!row) return null;
    if (String(row.request_hash) !== requestHash) {
      throw quoteError("quote_command_identity_conflict");
    }
    return String(row.quote_case_id);
  }

  private async load(
    connection: mysql.PoolConnection | mysql.Pool,
    workspaceId: string,
    id: string,
    forUpdate = false
  ) {
    const [rows] = await connection.query(
      `${CASE_SELECT} WHERE qc.workspace_id = ? AND qc.id = ?${forUpdate ? " FOR UPDATE" : ""}`,
      [workspaceId, id]
    );
    const row = (rows as MysqlRow[])[0];
    return row ? parseCase(row) : null;
  }

  private async complete(
    connection: mysql.PoolConnection,
    command: { workspaceId: string; commandKey: string; requestHash: string },
    quoteCaseId: string,
    completedAt: string
  ) {
    await connection.query(
      `INSERT INTO quote_command_idempotency
       (workspace_id,command_key,request_hash,quote_case_id,completed_at)
       VALUES (?,?,?,?,?)`,
      [command.workspaceId, command.commandKey, command.requestHash,
        quoteCaseId, growthMysqlDate(completedAt)]
    );
  }

  async listCases(workspaceId: string, query: QuoteCaseListQuery) {
    const workspace = assertConcreteGrowthWorkspaceId(workspaceId);
    const where = ["qc.workspace_id = ?"];
    const values: unknown[] = [workspace];
    if (query.status) { where.push("qc.status = ?"); values.push(query.status); }
    if (query.assignedTo) { where.push("qc.assigned_to = ?"); values.push(query.assignedTo); }
    if (query.dealId) { where.push("qc.deal_id = ?"); values.push(query.dealId); }
    if (query.cursor) { where.push("qc.id > ?"); values.push(query.cursor); }
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    values.push(limit + 1);
    const [rows] = await this.pool.query(
      `${CASE_SELECT} WHERE ${where.join(" AND ")}
       ORDER BY qc.id LIMIT ?`, values
    );
    const parsed = (rows as MysqlRow[]).map(parseCase);
    return Object.freeze({
      items: Object.freeze(parsed.slice(0, limit)),
      nextCursor: parsed.length > limit ? parsed[limit - 1]!.id : null
    });
  }

  findCase(workspaceId: string, id: string) {
    return this.load(this.pool, assertConcreteGrowthWorkspaceId(workspaceId), id);
  }

  async createCase(command: CreateQuoteCaseCommand) {
    const workspace = assertConcreteGrowthWorkspaceId(command.workspaceId);
    try {
      return await this.transaction(async (connection, temporal) => {
        const stamp = await this.temporalBarrier.allocateAppend(temporal, workspace);
        const replayId = await this.receipt(connection, workspace,
          command.commandKey, command.requestHash);
        if (replayId) return {
          quoteCase: (await this.load(connection, workspace, replayId))!,
          replayed: true
        };
        const value = command.quoteCase;
        if (value.workspaceId !== workspace || value.status !== "open"
          || value.revision !== 1
          || (!value.candidateId && !value.customerId && !value.dealId)) {
          throw quoteError("invalid_quote_case_create");
        }
        let bindingId: string | null = null;
        if (value.dealId) {
          if (!command.bindingSnapshot || !command.probabilityAssessment) {
            throw quoteError("commercial_binding_required");
          }
          await connection.query(
            `INSERT INTO deal_authoritative_quotes
             (workspace_id,deal_id,open_quote_case_id,quote_version_id,
              commercial_amount_hash,authority_revision,updated_at)
             VALUES (?,?,NULL,NULL,NULL,0,?)
             ON DUPLICATE KEY UPDATE deal_id = VALUES(deal_id)`,
            [workspace, value.dealId, growthMysqlDate(stamp.recordedAt)]
          );
          const [guardRows] = await connection.query(
            `SELECT open_quote_case_id FROM deal_authoritative_quotes
             WHERE workspace_id = ? AND deal_id = ? FOR UPDATE`,
            [workspace, value.dealId]
          );
          if ((guardRows as MysqlRow[])[0]?.open_quote_case_id) {
            throw quoteError("deal_open_quote_case_conflict");
          }
          bindingId = `binding-${value.id}`;
          const bindingStamp = await this.temporalBarrier.allocateAppend(
            temporal,
            workspace
          );
          await this.insertBinding(connection, workspace, value.id, bindingId,
            command.bindingSnapshot, bindingStamp);
          await connection.query(
            `UPDATE deal_authoritative_quotes SET open_quote_case_id = ?,
             authority_revision = authority_revision + 1,updated_at = ?
             WHERE workspace_id = ? AND deal_id = ?`,
            [value.id, growthMysqlDate(stamp.recordedAt), workspace, value.dealId]
          );
        }
        await connection.query(
          `INSERT INTO quote_cases
           (workspace_id,id,candidate_id,customer_id,deal_id,assigned_to,status,
            current_draft_version_id,revision,binding_snapshot_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?, 'open',NULL,1,?,?,?)`,
          [workspace, value.id, value.candidateId, value.customerId,
            value.dealId, value.assignedTo, bindingId,
            growthMysqlDate(stamp.recordedAt), growthMysqlDate(stamp.recordedAt)]
        );
        const lifecycleStamp = await this.temporalBarrier.allocateAppend(
          temporal,
          workspace
        );
        await this.insertLifecycle(connection, {
          workspaceId: workspace, quoteCaseId: value.id, quoteVersionId: null,
          revision: 1, fromStatus: null, toStatus: "open",
          eventType: "case_created", actorId: command.actorId
        }, lifecycleStamp);
        if (value.dealId) {
          const authorityStamp = await this.temporalBarrier.allocateAppend(
            temporal,
            workspace
          );
          await connection.query(
            `INSERT INTO deal_authoritative_quote_events
             (workspace_id,id,deal_id,authority_revision,quote_case_id,
              quote_version_id,event_type,recorded_at,temporal_sequence)
             VALUES (?,?,?,?,?,NULL,'case_bound',?,?)`,
            [workspace,
              `deal-authority-${workspace}-${authorityStamp.temporalSequence}`,
              value.dealId, 1, value.id, growthMysqlDate(authorityStamp.recordedAt),
              authorityStamp.temporalSequence]
          );
        }
        await this.complete(connection, command, value.id, stamp.recordedAt);
        return { quoteCase: (await this.load(connection, workspace, value.id))!,
          replayed: false };
      });
    } catch (error) {
      if (duplicate(error)) throw quoteError(valueConflictCode(command.quoteCase.dealId));
      throw error;
    }
  }

  private async insertBinding(
    connection: mysql.PoolConnection,
    workspaceId: string,
    quoteCaseId: string,
    id: string,
    snapshot: CommercialBindingSnapshot,
    stamp: { recordedAt: string; temporalSequence: number }
  ) {
    await connection.query(
      `INSERT INTO commercial_binding_snapshots
       (workspace_id,id,quote_case_id,candidate_id,handoff_id,lead_id,customer_id,
        deal_id,candidate_version,handoff_content_hash,deal_content_hash,
        binding_hash_schema_version,attribution_snapshot_json,binding_hash,
        verified_at,recorded_at,temporal_sequence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [workspaceId, id, quoteCaseId, snapshot.candidateId, snapshot.handoffId,
        snapshot.leadId, snapshot.customerId, snapshot.dealId,
        snapshot.candidateVersion, snapshot.handoffContentHash,
        snapshot.dealContentHash, snapshot.bindingHashSchemaVersion,
        JSON.stringify(snapshot.attributionSnapshot), snapshot.bindingHash,
        growthMysqlDate(snapshot.verifiedAt), growthMysqlDate(stamp.recordedAt),
        stamp.temporalSequence]
    );
  }

  private async insertLifecycle(
    connection: mysql.PoolConnection,
    event: { workspaceId: string; quoteCaseId: string; quoteVersionId: string | null;
      revision: number; fromStatus: string | null; toStatus: string;
      eventType: string; actorId: string },
    stamp: { recordedAt: string; temporalSequence: number }
  ) {
    await connection.query(
      `INSERT INTO quote_lifecycle_events
       (workspace_id,id,quote_case_id,quote_version_id,lifecycle_revision,
        from_status,to_status,event_type,actor_id,recorded_at,temporal_sequence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [event.workspaceId,
        `quote-lifecycle-${event.workspaceId}-${stamp.temporalSequence}`,
        event.quoteCaseId, event.quoteVersionId, event.revision,
        event.fromStatus, event.toStatus, event.eventType, event.actorId,
        growthMysqlDate(stamp.recordedAt), stamp.temporalSequence]
    );
  }

  async bindCaseDeal(command: BindQuoteCaseDealCommand) {
    const workspace = assertConcreteGrowthWorkspaceId(command.workspaceId);
    try {
      return await this.transaction(async (connection, temporal) => {
        const caseStamp = await this.temporalBarrier.allocateAppend(temporal, workspace);
        const replayId = await this.receipt(connection, workspace,
          command.commandKey, command.requestHash);
        if (replayId) return { quoteCase: (await this.load(connection, workspace, replayId))!, replayed: true };
        await connection.query(
          `INSERT INTO deal_authoritative_quotes
           (workspace_id,deal_id,open_quote_case_id,quote_version_id,
            commercial_amount_hash,authority_revision,updated_at)
           VALUES (?,?,NULL,NULL,NULL,0,?)
           ON DUPLICATE KEY UPDATE deal_id = VALUES(deal_id)`,
          [workspace, command.dealId, growthMysqlDate(caseStamp.recordedAt)]
        );
        const [guardRows] = await connection.query(
          `SELECT * FROM deal_authoritative_quotes
           WHERE workspace_id = ? AND deal_id = ? FOR UPDATE`,
          [workspace, command.dealId]
        );
        const guard = (guardRows as MysqlRow[])[0]!;
        if (guard.open_quote_case_id
          && String(guard.open_quote_case_id) !== command.quoteCaseId) {
          throw quoteError("deal_open_quote_case_conflict");
        }
        const current = await this.load(connection, workspace,
          command.quoteCaseId, true);
        if (!current) throw quoteError("quote_case_not_found");
        if (current.revision !== command.expectedRevision) {
          throw quoteError(command.expectedRevision === null
            ? "revision_required" : "quote_case_revision_conflict");
        }
        if (current.status !== "open") throw quoteError("quote_case_not_open");
        if (current.dealId) {
          if (current.dealId !== command.dealId) {
            throw quoteError("quote_case_rebind_forbidden");
          }
          await this.complete(connection, command, current.id, caseStamp.recordedAt);
          return { quoteCase: current, replayed: true };
        }
        if (command.bindingSnapshot.candidateId !== current.candidateId
          || command.probabilityAssessment.candidateId !== current.candidateId
          || command.probabilityAssessment.dealId !== command.dealId) {
          throw quoteError("commercial_binding_authority_mismatch");
        }
        const bindingId = `binding-${current.id}`;
        const bindingStamp = await this.temporalBarrier.allocateAppend(
          temporal,
          workspace
        );
        await this.insertBinding(connection, workspace, current.id, bindingId,
          command.bindingSnapshot, bindingStamp);
        const [result] = await connection.query(
          `UPDATE quote_cases SET customer_id = ?,deal_id = ?,binding_snapshot_id = ?,
           revision = revision + 1,updated_at = ?
           WHERE workspace_id = ? AND id = ? AND revision = ? AND deal_id IS NULL`,
          [command.bindingSnapshot.customerId, command.dealId, bindingId,
            growthMysqlDate(caseStamp.recordedAt), workspace, current.id,
            command.expectedRevision]
        );
        if (affectedRows(result) !== 1) throw quoteError("quote_case_revision_conflict");
        const nextAuthorityRevision = Number(guard.authority_revision) + 1;
        await connection.query(
          `UPDATE deal_authoritative_quotes SET open_quote_case_id = ?,
           authority_revision = ?,updated_at = ?
           WHERE workspace_id = ? AND deal_id = ?`,
          [current.id, nextAuthorityRevision, growthMysqlDate(caseStamp.recordedAt),
            workspace, command.dealId]
        );
        const lifecycleStamp = await this.temporalBarrier.allocateAppend(
          temporal,
          workspace
        );
        await this.insertLifecycle(connection, {
          workspaceId: workspace, quoteCaseId: current.id, quoteVersionId: null,
          revision: current.revision + 1, fromStatus: "open", toStatus: "open",
          eventType: "deal_bound", actorId: command.actorId
        }, lifecycleStamp);
        const authorityStamp = await this.temporalBarrier.allocateAppend(temporal, workspace);
        await connection.query(
          `INSERT INTO deal_authoritative_quote_events
           (workspace_id,id,deal_id,authority_revision,quote_case_id,
            quote_version_id,event_type,recorded_at,temporal_sequence)
           VALUES (?,?,?,?,?,NULL,'case_bound',?,?)`,
          [workspace, `deal-authority-${workspace}-${authorityStamp.temporalSequence}`,
            command.dealId, nextAuthorityRevision, current.id,
            growthMysqlDate(authorityStamp.recordedAt), authorityStamp.temporalSequence]
        );
        await this.complete(connection, command, current.id, authorityStamp.recordedAt);
        return { quoteCase: (await this.load(connection, workspace, current.id))!, replayed: false };
      });
    } catch (error) {
      if (duplicate(error)) throw quoteError("deal_open_quote_case_conflict");
      throw error;
    }
  }

  private async terminal(
    command: CloseQuoteCaseCommand | CancelQuoteCaseCommand,
    status: "closed" | "cancelled"
  ): Promise<QuoteCaseCommandResult> {
    const workspace = assertConcreteGrowthWorkspaceId(command.workspaceId);
    return this.transaction(async (connection, temporal) => {
      const stamp = await this.temporalBarrier.allocateAppend(temporal, workspace);
      const replayId = await this.receipt(connection, workspace,
        command.commandKey, command.requestHash);
      if (replayId) return { quoteCase: (await this.load(connection, workspace, replayId))!, replayed: true };
      const [identityRows] = await connection.query(
        `SELECT deal_id FROM quote_cases WHERE workspace_id = ? AND id = ?`,
        [workspace, command.quoteCaseId]
      );
      const dealId = (identityRows as MysqlRow[])[0]?.deal_id;
      if (dealId) {
        await connection.query(
          `SELECT deal_id FROM deal_authoritative_quotes
           WHERE workspace_id = ? AND deal_id = ? FOR UPDATE`,
          [workspace, dealId]
        );
      }
      const current = await this.load(connection, workspace, command.quoteCaseId, true);
      if (!current) throw quoteError("quote_case_not_found");
      if (current.revision !== command.expectedRevision) {
        throw quoteError(command.expectedRevision === null
          ? "revision_required" : "quote_case_revision_conflict");
      }
      if (current.status !== "open") throw quoteError("quote_case_not_open");
      const [activeRows] = await connection.query(
        `SELECT qv.id FROM quote_versions qv
         JOIN quote_lifecycle_events qle ON qle.workspace_id = qv.workspace_id
          AND qle.quote_version_id = qv.id
         WHERE qv.workspace_id = ? AND qv.quote_case_id = ?
          AND qv.version_kind = 'formal'
          AND qle.to_status IN ('submitted','approved')
         ORDER BY qle.lifecycle_revision DESC LIMIT 1 FOR UPDATE`,
        [workspace, current.id]
      );
      if ((activeRows as MysqlRow[]).length) {
        throw quoteError("quote_case_has_active_formal_version");
      }
      if (status === "cancelled") {
        const [draftRows] = await connection.query(
          `SELECT qv.id,COALESCE(MAX(qle.lifecycle_revision),0) AS revision
           FROM quote_versions qv LEFT JOIN quote_lifecycle_events qle
            ON qle.workspace_id = qv.workspace_id AND qle.quote_version_id = qv.id
           WHERE qv.workspace_id = ? AND qv.quote_case_id = ?
            AND qv.version_kind = 'draft'
           GROUP BY qv.id FOR UPDATE`,
          [workspace, current.id]
        );
        for (const row of draftRows as MysqlRow[]) {
          const versionStamp = await this.temporalBarrier.allocateAppend(temporal, workspace);
          await this.insertLifecycle(connection, {
            workspaceId: workspace, quoteCaseId: current.id,
            quoteVersionId: String(row.id), revision: Number(row.revision) + 1,
            fromStatus: "draft", toStatus: "expired",
            eventType: "version_expired", actorId: command.actorId
          }, versionStamp);
        }
      }
      const [result] = await connection.query(
        `UPDATE quote_cases SET status = ?,revision = revision + 1,updated_at = ?
         WHERE workspace_id = ? AND id = ? AND revision = ? AND status = 'open'`,
        [status, growthMysqlDate(stamp.recordedAt), workspace, current.id,
          command.expectedRevision]
      );
      if (affectedRows(result) !== 1) throw quoteError("quote_case_revision_conflict");
      const lifecycleStamp = await this.temporalBarrier.allocateAppend(
        temporal,
        workspace
      );
      await this.insertLifecycle(connection, {
        workspaceId: workspace, quoteCaseId: current.id, quoteVersionId: null,
        revision: current.revision + 1, fromStatus: "open", toStatus: status,
        eventType: status === "closed" ? "case_closed" : "case_cancelled",
        actorId: command.actorId
      }, lifecycleStamp);
      if (current.dealId) {
        await connection.query(
          `UPDATE deal_authoritative_quotes SET open_quote_case_id = NULL,
           authority_revision = authority_revision + 1,updated_at = ?
           WHERE workspace_id = ? AND deal_id = ? AND open_quote_case_id = ?`,
          [growthMysqlDate(stamp.recordedAt), workspace, current.dealId, current.id]
        );
      }
      await this.complete(connection, command, current.id, stamp.recordedAt);
      return { quoteCase: (await this.load(connection, workspace, current.id))!, replayed: false };
    });
  }

  closeCase(command: CloseQuoteCaseCommand) { return this.terminal(command, "closed"); }
  cancelCase(command: CancelQuoteCaseCommand) { return this.terminal(command, "cancelled"); }
}

function valueConflictCode(dealId: string | null) {
  return dealId ? "deal_open_quote_case_conflict" : "quote_case_identity_conflict";
}
