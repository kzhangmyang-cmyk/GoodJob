import { createHash, randomUUID } from "node:crypto";
import type { CommissionProduct } from "./types.js";
import { GROWTH_CAPABILITY_REGISTRY_VERSION } from "./growth-capabilities.js";
import { currencyExponent, safeMinor } from "./growth-money.js";
import type {
  ApprovalThresholds,
  CatalogItem,
  CommissionCatalogMigrationFailureCode,
  CommissionCatalogMigrationItemResult,
  CommissionCatalogMigrationPreview,
  CommissionCatalogMigrationRun,
  CommissionProductCatalogLink,
  PricingPolicyVersion
} from "./catalog-domain.js";
import { immutableClone } from "./catalog-domain.js";
import type {
  CatalogRepository,
  CommissionCatalogMigrationEntry
} from "./catalog-repository.js";

export interface CommissionCatalogMigrationDependencies {
  repository: CatalogRepository;
  products: (workspaceId: string) => Promise<readonly CommissionProduct[]>;
  now?: () => string;
  idFactory?: (prefix: string) => string;
}

interface PlannedMigration {
  preview: CommissionCatalogMigrationPreview;
  inputSnapshotHash: `sha256:${string}`;
  entries: readonly CommissionCatalogMigrationEntry[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function migrationError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function assertToken(value: string, field: string): string {
  const token = value.trim();
  if (!token || token === "all") throw migrationError(`invalid_${field}`);
  return token;
}

function decimalToMinor(
  value: number,
  exponent: number,
  valueCode: "default_price" | "cost_price"
): { minor: number } | { code: CommissionCatalogMigrationFailureCode } {
  if (!Number.isFinite(value) || value < 0 || (valueCode === "default_price" && value === 0)) {
    return { code: `invalid_${valueCode}` };
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(String(value));
  if (!match) return { code: `invalid_${valueCode}` };
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  const scientificExponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(scientificExponent)) return { code: "amount_out_of_range" };
  let coefficient = BigInt(`${whole}${fraction}`);
  const decimalShift = scientificExponent + exponent - fraction.length;
  if (decimalShift >= 0) {
    coefficient *= 10n ** BigInt(decimalShift);
  } else {
    const divisor = 10n ** BigInt(-decimalShift);
    if (coefficient % divisor !== 0n) {
      return { code: `invalid_${valueCode}_precision` };
    }
    coefficient /= divisor;
  }
  try {
    return { minor: safeMinor(coefficient, valueCode) };
  } catch {
    return { code: "amount_out_of_range" };
  }
}

const LEGACY_APPROVAL_THRESHOLDS: ApprovalThresholds = Object.freeze({
  discount: Object.freeze({
    standard: 0, absolute: 0,
    requiredCapability: "quote.exception.discount.approve" as const
  }),
  margin: Object.freeze({
    standard: 0, absolute: 0,
    requiredCapability: "quote.exception.margin.approve" as const
  }),
  paymentTerms: Object.freeze({
    standard: 0, absolute: 0,
    requiredCapability: "quote.exception.payment_terms.approve" as const
  }),
  gift: Object.freeze({
    standard: 0, absolute: 0,
    requiredCapability: "quote.exception.gift.approve" as const
  }),
  credit: Object.freeze({
    standard: 0, absolute: 0,
    requiredCapability: "quote.exception.credit.approve" as const
  }),
  manualEscalation: Object.freeze({
    enabled: false,
    requiredCapability: "quote.exception.manual.approve" as const
  })
});

function snapshotOf(product: CommissionProduct): Readonly<Record<string, unknown>> {
  return immutableClone({ ...product }) as Readonly<Record<string, unknown>>;
}

function resultForRepair(
  workspaceId: string,
  product: CommissionProduct,
  snapshot: Readonly<Record<string, unknown>>,
  code: CommissionCatalogMigrationFailureCode
): CommissionCatalogMigrationItemResult {
  return immutableClone({
    workspaceId,
    commissionProductId: product.id,
    status: "repair_required",
    code,
    snapshot,
    snapshotHash: hash(snapshot),
    catalogItemId: null,
    pricingPolicyVersionId: null
  }) as CommissionCatalogMigrationItemResult;
}

function reportHashFor(
  workspaceId: string,
  items: readonly CommissionCatalogMigrationItemResult[]
): `sha256:${string}` {
  return hash({
    schema: "commission-catalog-migration-report.v1",
    workspaceId,
    items: items.map((item) => ({
      commissionProductId: item.commissionProductId,
      status: item.status,
      code: item.code,
      snapshotHash: item.snapshotHash
    }))
  });
}

export class CommissionCatalogMigrationService {
  private readonly repository: CatalogRepository;
  private readonly products: CommissionCatalogMigrationDependencies["products"];
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(dependencies: CommissionCatalogMigrationDependencies) {
    this.repository = dependencies.repository;
    this.products = dependencies.products;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.idFactory = dependencies.idFactory ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  async preview(workspaceId: string): Promise<CommissionCatalogMigrationPreview> {
    return (await this.plan(assertToken(workspaceId, "workspace_id"))).preview;
  }

  async execute(
    workspaceId: string,
    actorId: string,
    idempotencyKey: string
  ): Promise<CommissionCatalogMigrationRun> {
    const workspace = assertToken(workspaceId, "workspace_id");
    const actor = assertToken(actorId, "actor_id");
    const key = assertToken(idempotencyKey, "idempotency_key");
    const products = await this.workspaceProducts(workspace);
    const inputSnapshotHash = hash({
      schema: "commission-catalog-migration-input.v1",
      workspaceId: workspace,
      products: products.map(snapshotOf)
    });
    const existing = await this.repository.findCommissionCatalogMigrationRun(
      workspace,
      key
    );
    if (existing) {
      if (existing.inputSnapshotHash !== inputSnapshotHash) {
        throw migrationError("commission_catalog_migration_conflict");
      }
      return immutableClone(existing) as CommissionCatalogMigrationRun;
    }
    const timestamp = this.now();
    if (!Number.isFinite(Date.parse(timestamp))) throw migrationError("invalid_migration_time");
    const planned = await this.plan(workspace, products, actor, timestamp);
    const run = immutableClone({
      id: this.idFactory("commission_catalog_migration_run"),
      workspaceId: workspace,
      actorId: actor,
      idempotencyKey: key,
      inputSnapshotHash: planned.inputSnapshotHash,
      startedAt: timestamp,
      completedAt: timestamp,
      status: "completed",
      scanned: planned.preview.scanned,
      migrated: planned.preview.migrated,
      repairRequired: planned.preview.repairRequired,
      reportHash: planned.preview.reportHash,
      items: planned.preview.items
    }) as CommissionCatalogMigrationRun;
    return this.repository.commitCommissionCatalogMigration({
      run,
      entries: planned.entries
    });
  }

  private async workspaceProducts(workspaceId: string): Promise<CommissionProduct[]> {
    const products = (await this.products(workspaceId))
      .filter((product) => product.teamId === workspaceId)
      .map((product) => ({ ...product }))
      .sort((left, right) => compareCodePoint(left.id, right.id));
    const ids = new Set<string>();
    for (const product of products) {
      if (!product.id || ids.has(product.id)) {
        throw migrationError("invalid_commission_product_identity");
      }
      ids.add(product.id);
    }
    return products;
  }

  private async plan(
    workspaceId: string,
    suppliedProducts?: readonly CommissionProduct[],
    createdBy?: string,
    operationTime?: string
  ): Promise<PlannedMigration> {
    const timestamp = operationTime ?? this.now();
    if (!Number.isFinite(Date.parse(timestamp))) throw migrationError("invalid_migration_time");
    const products = suppliedProducts
      ? suppliedProducts.map((product) => ({ ...product }))
      : await this.workspaceProducts(workspaceId);
    const inputSnapshotHash = hash({
      schema: "commission-catalog-migration-input.v1",
      workspaceId,
      products: products.map(snapshotOf)
    });
    const results: CommissionCatalogMigrationItemResult[] = [];
    const entries: CommissionCatalogMigrationEntry[] = [];
    for (const product of products) {
      const snapshot = snapshotOf(product);
      const snapshotHash = hash(snapshot);
      const exponent = currencyExponent(product.currency);
      if (exponent === null) {
        results.push(resultForRepair(workspaceId, product, snapshot, "invalid_currency"));
        continue;
      }
      const price = decimalToMinor(product.defaultPrice, exponent, "default_price");
      if ("code" in price) {
        results.push(resultForRepair(workspaceId, product, snapshot, price.code));
        continue;
      }
      const cost = decimalToMinor(product.costPrice, exponent, "cost_price");
      if ("code" in cost) {
        results.push(resultForRepair(workspaceId, product, snapshot, cost.code));
        continue;
      }
      const existingLink = await this.repository.findCommissionProductLink(
        workspaceId,
        product.id
      );
      const catalogItemId = existingLink?.catalogItemId
        ?? this.idFactory(`catalog_item_${product.id}`);
      const pricingPolicyVersionId = existingLink?.pricingPolicyVersionId
        ?? this.idFactory(`pricing_policy_${product.id}`);
      results.push(immutableClone({
        workspaceId,
        commissionProductId: product.id,
        status: "migrated",
        code: "migrated",
        snapshot,
        snapshotHash,
        catalogItemId,
        pricingPolicyVersionId
      }) as CommissionCatalogMigrationItemResult);
      if (existingLink) continue;

      const catalogItem: CatalogItem = {
        id: catalogItemId,
        workspaceId,
        type: product.category.includes("服务") ? "service" : "product",
        code: `legacy:${product.id}`,
        name: product.name,
        description: product.remark,
        unit: "unit",
        status: product.status === "active" ? "active" : "retired",
        revision: 1,
        createdBy: createdBy ?? product.ownerId,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const pricingPolicy: PricingPolicyVersion = {
        id: pricingPolicyVersionId,
        workspaceId,
        catalogItemId,
        version: 1,
        packageVersionId: null,
        currency: product.currency,
        listUnitPriceMinor: price.minor,
        unitStandardCostMinor: cost.minor,
        defaultOrderDeliveryCostMinor: 0,
        defaultOrderSalesCostMinor: 0,
        defaultOrderServiceCostMinor: 0,
        absoluteFloorUnitPriceMinor: cost.minor,
        standardDiscountLimitBps: 0,
        absoluteDiscountLimitBps: 0,
        targetGrossMarginBps: 0,
        absoluteMinimumGrossMarginBps: 0,
        standardPaymentTermDays: 0,
        absolutePaymentTermDays: 0,
        approvalThresholds: LEGACY_APPROVAL_THRESHOLDS,
        surchargePolicies: [],
        giftPolicies: [],
        validFrom: timestamp,
        validTo: null,
        status: "draft",
        source: "legacy_commission_product",
        capabilityRegistryVersion: GROWTH_CAPABILITY_REGISTRY_VERSION,
        revision: 1,
        createdBy: createdBy ?? product.ownerId,
        createdAt: timestamp
      };
      const link: CommissionProductCatalogLink = {
        workspaceId,
        commissionProductId: product.id,
        catalogItemId,
        pricingPolicyVersionId,
        migratedAt: timestamp
      };
      const entry = immutableClone({
        item: catalogItem,
        pricingPolicy,
        link
      }) as CommissionCatalogMigrationEntry;
      entries.push(entry);
    }
    const migrated = results.filter((item) => item.status === "migrated").length;
    const repairRequired = results.length - migrated;
    const preview = immutableClone({
      workspaceId,
      scanned: results.length,
      migrated,
      repairRequired,
      reportHash: reportHashFor(workspaceId, results),
      items: results
    }) as CommissionCatalogMigrationPreview;
    return { preview, inputSnapshotHash, entries: immutableClone(entries) as unknown as readonly CommissionCatalogMigrationEntry[] };
  }
}
