import type mysql from "mysql2/promise";
import type {
  CatalogItem,
  CommissionCatalogMigrationItemResult,
  CommissionCatalogMigrationRun,
  CommissionProductCatalogLink,
  PackageComponent,
  PackageVersion,
  PricingPolicyVersion
} from "./catalog-domain.js";
import { immutableClone } from "./catalog-domain.js";
import type {
  CatalogRepository,
  CommissionCatalogMigrationCommit
} from "./catalog-repository.js";
import { assertCommissionCatalogMigrationCommitInvariant } from "./catalog-repository.js";

type QuerySource = Pick<mysql.Pool | mysql.PoolConnection, "query">;
type MysqlRow = Record<string, unknown>;

export const CATALOG_MYSQL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS catalog_items (
    workspace_id VARCHAR(191) NOT NULL,
    id VARCHAR(191) NOT NULL,
    item_type ENUM('product','service','package') NOT NULL,
    code VARCHAR(191) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    unit VARCHAR(100) NOT NULL,
    item_status ENUM('active','retired') NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id, id),
    UNIQUE KEY uk_catalog_items_code (workspace_id, code),
    CONSTRAINT chk_catalog_items_workspace CHECK (
      workspace_id <> 'all' AND CHAR_LENGTH(TRIM(workspace_id)) > 0
    )
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS package_versions (
    workspace_id VARCHAR(191) NOT NULL,
    id VARCHAR(191) NOT NULL,
    package_catalog_item_id VARCHAR(191) NOT NULL,
    version BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL,
    package_status ENUM('draft','active','retired') NOT NULL,
    valid_from DATETIME(3) NOT NULL,
    valid_to DATETIME(3) NULL,
    revision BIGINT UNSIGNED NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id, id),
    UNIQUE KEY uk_package_versions_version
      (workspace_id, package_catalog_item_id, version),
    KEY idx_package_versions_window
      (workspace_id, package_catalog_item_id, currency, package_status, valid_from, valid_to),
    CONSTRAINT fk_package_version_catalog
      FOREIGN KEY (workspace_id, package_catalog_item_id)
      REFERENCES catalog_items (workspace_id, id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS pricing_policy_versions (
    workspace_id VARCHAR(191) NOT NULL,
    id VARCHAR(191) NOT NULL,
    catalog_item_id VARCHAR(191) NOT NULL,
    version BIGINT UNSIGNED NOT NULL,
    package_version_id VARCHAR(191) NULL,
    currency CHAR(3) NOT NULL,
    list_unit_price_minor BIGINT UNSIGNED NOT NULL,
    unit_standard_cost_minor BIGINT UNSIGNED NOT NULL,
    default_order_delivery_cost_minor BIGINT UNSIGNED NOT NULL,
    default_order_sales_cost_minor BIGINT UNSIGNED NOT NULL,
    default_order_service_cost_minor BIGINT UNSIGNED NOT NULL,
    absolute_floor_unit_price_minor BIGINT UNSIGNED NOT NULL,
    standard_discount_limit_bps INT UNSIGNED NOT NULL,
    absolute_discount_limit_bps INT UNSIGNED NOT NULL,
    target_gross_margin_bps INT UNSIGNED NOT NULL,
    absolute_minimum_gross_margin_bps INT UNSIGNED NOT NULL,
    standard_payment_term_days INT UNSIGNED NOT NULL,
    absolute_payment_term_days INT UNSIGNED NOT NULL,
    approval_thresholds_json JSON NOT NULL,
    surcharge_policies_json JSON NOT NULL,
    gift_policies_json JSON NOT NULL,
    valid_from DATETIME(3) NOT NULL,
    valid_to DATETIME(3) NULL,
    policy_status ENUM('draft','active','retired') NOT NULL,
    source ENUM('manual','legacy_commission_product') NOT NULL,
    capability_registry_version VARCHAR(100) NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id, id),
    UNIQUE KEY uk_pricing_policy_versions_version
      (workspace_id, catalog_item_id, version),
    KEY idx_pricing_policy_versions_window
      (workspace_id, catalog_item_id, currency, policy_status, valid_from, valid_to),
    CONSTRAINT fk_pricing_policy_catalog
      FOREIGN KEY (workspace_id, catalog_item_id)
      REFERENCES catalog_items (workspace_id, id),
    CONSTRAINT fk_pricing_policy_package
      FOREIGN KEY (workspace_id, package_version_id)
      REFERENCES package_versions (workspace_id, id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS package_components (
    workspace_id VARCHAR(191) NOT NULL,
    package_version_id VARCHAR(191) NOT NULL,
    component_catalog_item_id VARCHAR(191) NOT NULL,
    component_pricing_policy_version_id VARCHAR(191) NOT NULL,
    quantity_micros BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (
      workspace_id, package_version_id, component_catalog_item_id,
      component_pricing_policy_version_id
    ),
    KEY idx_package_components_target
      (workspace_id, component_catalog_item_id),
    CONSTRAINT fk_package_component_version
      FOREIGN KEY (workspace_id, package_version_id)
      REFERENCES package_versions (workspace_id, id),
    CONSTRAINT fk_package_component_catalog
      FOREIGN KEY (workspace_id, component_catalog_item_id)
      REFERENCES catalog_items (workspace_id, id),
    CONSTRAINT fk_package_component_policy
      FOREIGN KEY (workspace_id, component_pricing_policy_version_id)
      REFERENCES pricing_policy_versions (workspace_id, id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS commission_product_catalog_links (
    workspace_id VARCHAR(191) NOT NULL,
    commission_product_id VARCHAR(191) NOT NULL,
    catalog_item_id VARCHAR(191) NOT NULL,
    pricing_policy_version_id VARCHAR(191) NOT NULL,
    migrated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (workspace_id, commission_product_id),
    UNIQUE KEY uk_commission_product_catalog_item (workspace_id, catalog_item_id),
    UNIQUE KEY uk_commission_product_policy (workspace_id, pricing_policy_version_id),
    CONSTRAINT fk_commission_product_catalog
      FOREIGN KEY (workspace_id, catalog_item_id)
      REFERENCES catalog_items (workspace_id, id),
    CONSTRAINT fk_commission_product_policy
      FOREIGN KEY (workspace_id, pricing_policy_version_id)
      REFERENCES pricing_policy_versions (workspace_id, id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS commission_catalog_migration_runs (
    workspace_id VARCHAR(191) NOT NULL,
    id VARCHAR(191) NOT NULL,
    actor_id VARCHAR(191) NOT NULL,
    idempotency_key VARCHAR(191) NOT NULL,
    input_snapshot_hash CHAR(71) NOT NULL,
    started_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NOT NULL,
    run_status ENUM('completed') NOT NULL,
    scanned BIGINT UNSIGNED NOT NULL,
    migrated BIGINT UNSIGNED NOT NULL,
    repair_required BIGINT UNSIGNED NOT NULL,
    report_hash CHAR(71) NOT NULL,
    PRIMARY KEY (workspace_id, id),
    UNIQUE KEY uk_commission_catalog_migration_idempotency
      (workspace_id, idempotency_key),
    CONSTRAINT chk_commission_catalog_migration_workspace CHECK (
      workspace_id <> 'all' AND CHAR_LENGTH(TRIM(workspace_id)) > 0
    )
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS commission_catalog_migration_items (
    workspace_id VARCHAR(191) NOT NULL,
    migration_run_id VARCHAR(191) NOT NULL,
    commission_product_id VARCHAR(191) NOT NULL,
    item_status ENUM('migrated','repair_required') NOT NULL,
    result_code VARCHAR(100) NOT NULL,
    snapshot_json LONGTEXT NOT NULL,
    snapshot_hash CHAR(71) NOT NULL,
    catalog_item_id VARCHAR(191) NULL,
    pricing_policy_version_id VARCHAR(191) NULL,
    PRIMARY KEY (workspace_id, migration_run_id, commission_product_id),
    CONSTRAINT fk_commission_catalog_migration_run
      FOREIGN KEY (workspace_id, migration_run_id)
      REFERENCES commission_catalog_migration_runs (workspace_id, id),
    CONSTRAINT fk_commission_catalog_migration_item_catalog
      FOREIGN KEY (workspace_id, catalog_item_id)
      REFERENCES catalog_items (workspace_id, id),
    CONSTRAINT fk_commission_catalog_migration_item_policy
      FOREIGN KEY (workspace_id, pricing_policy_version_id)
      REFERENCES pricing_policy_versions (workspace_id, id),
    CONSTRAINT chk_commission_catalog_migration_snapshot_json CHECK (
      JSON_VALID(snapshot_json)
    )
  ) ENGINE=InnoDB`
] as const;

export async function ensureCatalogMysqlSchema(pool: mysql.Pool): Promise<void> {
  for (const statement of CATALOG_MYSQL_SCHEMA_STATEMENTS) await pool.query(statement);
}

function mysqlDate(instant: string): string {
  return instant.slice(0, 23).replace("T", " ");
}

function instant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(text)) {
    return new Date(`${text.replace(" ", "T")}Z`).toISOString();
  }
  return new Date(text).toISOString();
}

function json<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function safeNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`invalid_${field}`);
  return number;
}

function parseCatalogItem(row: MysqlRow): CatalogItem {
  return immutableClone({
    id: String(row.id), workspaceId: String(row.workspace_id),
    type: row.item_type, code: String(row.code), name: String(row.name),
    description: String(row.description), unit: String(row.unit),
    status: row.item_status, revision: safeNumber(row.revision, "revision"),
    createdBy: String(row.created_by), createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at)
  }) as CatalogItem;
}

function parsePricingPolicy(row: MysqlRow): PricingPolicyVersion {
  return immutableClone({
    id: String(row.id), workspaceId: String(row.workspace_id),
    catalogItemId: String(row.catalog_item_id),
    version: safeNumber(row.version, "version"),
    packageVersionId: row.package_version_id === null
      ? null : String(row.package_version_id),
    currency: String(row.currency),
    listUnitPriceMinor: safeNumber(row.list_unit_price_minor, "list_unit_price_minor"),
    unitStandardCostMinor: safeNumber(row.unit_standard_cost_minor, "unit_standard_cost_minor"),
    defaultOrderDeliveryCostMinor: safeNumber(row.default_order_delivery_cost_minor, "default_order_delivery_cost_minor"),
    defaultOrderSalesCostMinor: safeNumber(row.default_order_sales_cost_minor, "default_order_sales_cost_minor"),
    defaultOrderServiceCostMinor: safeNumber(row.default_order_service_cost_minor, "default_order_service_cost_minor"),
    absoluteFloorUnitPriceMinor: safeNumber(row.absolute_floor_unit_price_minor, "absolute_floor_unit_price_minor"),
    standardDiscountLimitBps: safeNumber(row.standard_discount_limit_bps, "standard_discount_limit_bps"),
    absoluteDiscountLimitBps: safeNumber(row.absolute_discount_limit_bps, "absolute_discount_limit_bps"),
    targetGrossMarginBps: safeNumber(row.target_gross_margin_bps, "target_gross_margin_bps"),
    absoluteMinimumGrossMarginBps: safeNumber(row.absolute_minimum_gross_margin_bps, "absolute_minimum_gross_margin_bps"),
    standardPaymentTermDays: safeNumber(row.standard_payment_term_days, "standard_payment_term_days"),
    absolutePaymentTermDays: safeNumber(row.absolute_payment_term_days, "absolute_payment_term_days"),
    approvalThresholds: json(row.approval_thresholds_json),
    surchargePolicies: json(row.surcharge_policies_json),
    giftPolicies: json(row.gift_policies_json), validFrom: instant(row.valid_from),
    validTo: row.valid_to === null ? null : instant(row.valid_to),
    status: row.policy_status ?? row.status, source: row.source,
    capabilityRegistryVersion: String(row.capability_registry_version),
    revision: safeNumber(row.revision, "revision"),
    createdBy: String(row.created_by), createdAt: instant(row.created_at)
  }) as PricingPolicyVersion;
}

function parsePackageVersion(row: MysqlRow): PackageVersion {
  return immutableClone({
    id: String(row.id), workspaceId: String(row.workspace_id),
    packageCatalogItemId: String(row.package_catalog_item_id),
    version: safeNumber(row.version, "version"), currency: String(row.currency),
    status: row.package_status, validFrom: instant(row.valid_from),
    validTo: row.valid_to === null ? null : instant(row.valid_to),
    revision: safeNumber(row.revision, "revision"),
    createdBy: String(row.created_by), createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at)
  }) as PackageVersion;
}

function parseLink(row: MysqlRow): CommissionProductCatalogLink {
  return immutableClone({
    workspaceId: String(row.workspace_id),
    commissionProductId: String(row.commission_product_id),
    catalogItemId: String(row.catalog_item_id),
    pricingPolicyVersionId: String(row.pricing_policy_version_id),
    migratedAt: instant(row.migrated_at)
  }) as CommissionProductCatalogLink;
}

async function first<T>(
  source: QuerySource,
  sql: string,
  values: unknown[],
  parse: (row: MysqlRow) => T
): Promise<T | null> {
  const [rows] = await source.query(sql, values);
  const row = (rows as MysqlRow[])[0];
  return row ? parse(row) : null;
}

async function insertCatalogItem(source: QuerySource, item: CatalogItem): Promise<void> {
  await source.query(
    `INSERT INTO catalog_items (
      workspace_id,id,item_type,code,name,description,unit,item_status,revision,
      created_by,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [item.workspaceId, item.id, item.type, item.code, item.name, item.description,
      item.unit, item.status, item.revision, item.createdBy,
      mysqlDate(item.createdAt), mysqlDate(item.updatedAt)]
  );
}

async function insertPricingPolicy(
  source: QuerySource,
  policy: PricingPolicyVersion
): Promise<void> {
  await source.query(
    `INSERT INTO pricing_policy_versions (
      workspace_id,id,catalog_item_id,version,package_version_id,currency,
      list_unit_price_minor,unit_standard_cost_minor,
      default_order_delivery_cost_minor,default_order_sales_cost_minor,
      default_order_service_cost_minor,absolute_floor_unit_price_minor,
      standard_discount_limit_bps,absolute_discount_limit_bps,
      target_gross_margin_bps,absolute_minimum_gross_margin_bps,
      standard_payment_term_days,absolute_payment_term_days,
      approval_thresholds_json,surcharge_policies_json,gift_policies_json,
      valid_from,valid_to,policy_status,source,capability_registry_version,
      revision,created_by,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [policy.workspaceId, policy.id, policy.catalogItemId, policy.version,
      policy.packageVersionId, policy.currency, policy.listUnitPriceMinor,
      policy.unitStandardCostMinor, policy.defaultOrderDeliveryCostMinor,
      policy.defaultOrderSalesCostMinor, policy.defaultOrderServiceCostMinor,
      policy.absoluteFloorUnitPriceMinor, policy.standardDiscountLimitBps,
      policy.absoluteDiscountLimitBps, policy.targetGrossMarginBps,
      policy.absoluteMinimumGrossMarginBps, policy.standardPaymentTermDays,
      policy.absolutePaymentTermDays, JSON.stringify(policy.approvalThresholds),
      JSON.stringify(policy.surchargePolicies), JSON.stringify(policy.giftPolicies),
      mysqlDate(policy.validFrom), policy.validTo ? mysqlDate(policy.validTo) : null,
      policy.status, policy.source, policy.capabilityRegistryVersion,
      policy.revision, policy.createdBy, mysqlDate(policy.createdAt)]
  );
}

function parseMigrationItem(row: MysqlRow): CommissionCatalogMigrationItemResult {
  return immutableClone({
    workspaceId: String(row.workspace_id),
    commissionProductId: String(row.commission_product_id),
    status: row.item_status,
    code: row.result_code,
    snapshot: json(row.snapshot_json),
    snapshotHash: String(row.snapshot_hash),
    catalogItemId: row.catalog_item_id === null ? null : String(row.catalog_item_id),
    pricingPolicyVersionId: row.pricing_policy_version_id === null
      ? null : String(row.pricing_policy_version_id)
  }) as CommissionCatalogMigrationItemResult;
}

async function findRun(
  source: QuerySource,
  workspaceId: string,
  idempotencyKey: string,
  forUpdate = false
): Promise<CommissionCatalogMigrationRun | null> {
  const [rows] = await source.query(
    `SELECT * FROM commission_catalog_migration_runs
     WHERE workspace_id = ? AND idempotency_key = ?${forUpdate ? " FOR UPDATE" : ""}`,
    [workspaceId, idempotencyKey]
  );
  const row = (rows as MysqlRow[])[0];
  if (!row) return null;
  const [itemRows] = await source.query(
    `SELECT * FROM commission_catalog_migration_items
     WHERE workspace_id = ? AND migration_run_id = ?
     ORDER BY commission_product_id`,
    [workspaceId, String(row.id)]
  );
  return immutableClone({
    id: String(row.id), workspaceId: String(row.workspace_id),
    actorId: String(row.actor_id), idempotencyKey: String(row.idempotency_key),
    inputSnapshotHash: String(row.input_snapshot_hash),
    startedAt: instant(row.started_at), completedAt: instant(row.completed_at),
    status: row.run_status, scanned: safeNumber(row.scanned, "scanned"),
    migrated: safeNumber(row.migrated, "migrated"),
    repairRequired: safeNumber(row.repair_required, "repair_required"),
    reportHash: String(row.report_hash),
    items: (itemRows as MysqlRow[]).map(parseMigrationItem)
  }) as CommissionCatalogMigrationRun;
}

function migrationConflict(): Error & { code: string } {
  return Object.assign(new Error("commission_catalog_migration_conflict"), {
    code: "commission_catalog_migration_conflict"
  });
}

export class MysqlCatalogRepository implements CatalogRepository {
  constructor(private readonly pool: mysql.Pool) {}

  async appendCatalogItem(item: CatalogItem): Promise<CatalogItem> {
    await insertCatalogItem(this.pool, item);
    return immutableClone(item) as CatalogItem;
  }

  findCatalogItem(workspaceId: string, id: string): Promise<CatalogItem | null> {
    return first(this.pool,
      "SELECT * FROM catalog_items WHERE workspace_id = ? AND id = ?",
      [workspaceId, id], parseCatalogItem);
  }

  async appendPricingPolicyVersion(
    policy: PricingPolicyVersion
  ): Promise<PricingPolicyVersion> {
    await insertPricingPolicy(this.pool, policy);
    return immutableClone(policy) as PricingPolicyVersion;
  }

  findPricingPolicyVersion(
    workspaceId: string,
    pricingPolicyVersionId: string
  ): Promise<PricingPolicyVersion | null> {
    return first(this.pool,
      "SELECT * FROM pricing_policy_versions WHERE workspace_id = ? AND id = ?",
      [workspaceId, pricingPolicyVersionId], parsePricingPolicy);
  }

  async appendPackageVersion(version: PackageVersion): Promise<PackageVersion> {
    await this.pool.query(
      `INSERT INTO package_versions (
        workspace_id,id,package_catalog_item_id,version,currency,package_status,
        valid_from,valid_to,revision,created_by,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [version.workspaceId, version.id, version.packageCatalogItemId,
        version.version, version.currency, version.status,
        mysqlDate(version.validFrom), version.validTo ? mysqlDate(version.validTo) : null,
        version.revision, version.createdBy, mysqlDate(version.createdAt),
        mysqlDate(version.updatedAt)]
    );
    return immutableClone(version) as PackageVersion;
  }

  findPackageVersion(workspaceId: string, id: string): Promise<PackageVersion | null> {
    return first(this.pool,
      "SELECT * FROM package_versions WHERE workspace_id = ? AND id = ?",
      [workspaceId, id], parsePackageVersion);
  }

  async replaceDraftPackageComponents(
    workspaceId: string,
    packageVersionId: string,
    components: readonly PackageComponent[]
  ): Promise<readonly PackageComponent[]> {
    if (components.some((component) => component.workspaceId !== workspaceId
      || component.packageVersionId !== packageVersionId)) {
      throw Object.assign(new Error("invalid_package_component_scope"), {
        code: "invalid_package_component_scope"
      });
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT package_status FROM package_versions
         WHERE workspace_id = ? AND id = ? FOR UPDATE`,
        [workspaceId, packageVersionId]
      );
      const version = (rows as MysqlRow[])[0];
      if (!version) throw new Error("package_version_not_found");
      if (version.package_status !== "draft") throw new Error("package_version_immutable");
      await connection.query(
        "DELETE FROM package_components WHERE workspace_id = ? AND package_version_id = ?",
        [workspaceId, packageVersionId]
      );
      for (const component of components) {
        await connection.query(
          `INSERT INTO package_components (
            workspace_id,package_version_id,component_catalog_item_id,
            component_pricing_policy_version_id,quantity_micros
          ) VALUES (?,?,?,?,?)`,
          [workspaceId, packageVersionId, component.componentCatalogItemId,
            component.componentPricingPolicyVersionId, component.quantityMicros]
        );
      }
      await connection.commit();
      return immutableClone(components) as readonly PackageComponent[];
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  findCommissionProductLink(
    workspaceId: string,
    commissionProductId: string
  ): Promise<CommissionProductCatalogLink | null> {
    return first(this.pool,
      `SELECT * FROM commission_product_catalog_links
       WHERE workspace_id = ? AND commission_product_id = ?`,
      [workspaceId, commissionProductId], parseLink);
  }

  findCommissionCatalogMigrationRun(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<CommissionCatalogMigrationRun | null> {
    return findRun(this.pool, workspaceId, idempotencyKey);
  }

  async commitCommissionCatalogMigration(
    commit: CommissionCatalogMigrationCommit
  ): Promise<CommissionCatalogMigrationRun> {
    assertCommissionCatalogMigrationCommitInvariant(commit);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const existing = await findRun(
        connection,
        commit.run.workspaceId,
        commit.run.idempotencyKey,
        true
      );
      if (existing) {
        if (existing.inputSnapshotHash !== commit.run.inputSnapshotHash) {
          throw migrationConflict();
        }
        await connection.commit();
        return existing;
      }
      await connection.query(
        `INSERT INTO commission_catalog_migration_runs (
          workspace_id,id,actor_id,idempotency_key,input_snapshot_hash,
          started_at,completed_at,run_status,scanned,migrated,repair_required,
          report_hash
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [commit.run.workspaceId, commit.run.id, commit.run.actorId,
          commit.run.idempotencyKey, commit.run.inputSnapshotHash,
          mysqlDate(commit.run.startedAt), mysqlDate(commit.run.completedAt),
          commit.run.status, commit.run.scanned, commit.run.migrated,
          commit.run.repairRequired, commit.run.reportHash]
      );
      for (const entry of commit.entries) {
        await insertCatalogItem(connection, entry.item);
        await insertPricingPolicy(connection, entry.pricingPolicy);
        await connection.query(
          `INSERT INTO commission_product_catalog_links (
            workspace_id,commission_product_id,catalog_item_id,
            pricing_policy_version_id,migrated_at
          ) VALUES (?,?,?,?,?)`,
          [entry.link.workspaceId, entry.link.commissionProductId,
            entry.link.catalogItemId, entry.link.pricingPolicyVersionId,
            mysqlDate(entry.link.migratedAt)]
        );
      }
      for (const item of commit.run.items) {
        await connection.query(
          `INSERT INTO commission_catalog_migration_items (
            workspace_id,migration_run_id,commission_product_id,item_status,
            result_code,snapshot_json,snapshot_hash,catalog_item_id,
            pricing_policy_version_id
          ) VALUES (?,?,?,?,?,?,?,?,?)`,
          [item.workspaceId, commit.run.id, item.commissionProductId,
            item.status, item.code, JSON.stringify(item.snapshot), item.snapshotHash,
            item.catalogItemId, item.pricingPolicyVersionId]
        );
      }
      await connection.commit();
      return immutableClone(commit.run) as CommissionCatalogMigrationRun;
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        const existing = await findRun(
          connection,
          commit.run.workspaceId,
          commit.run.idempotencyKey
        );
        if (existing) {
          if (existing.inputSnapshotHash !== commit.run.inputSnapshotHash) {
            throw migrationConflict();
          }
          return existing;
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
