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
  CommissionCatalogSnapshotValue,
  CommissionProductCatalogLink,
  PricingPolicyVersion
} from "./catalog-domain.js";
import { immutableClone } from "./catalog-domain.js";
import type {
  CatalogRepository,
  CommissionCatalogMigrationEntry
} from "./catalog-repository.js";

export type CommissionProductMigrationSource = Omit<
  CommissionProduct,
  "defaultPrice" | "costPrice" | "updatedAt"
> & {
  defaultPrice: unknown;
  costPrice: unknown;
  updatedAt: unknown;
};

export interface CommissionCatalogMigrationDependencies {
  repository: CatalogRepository;
  products: (
    workspaceId: string
  ) => Promise<readonly CommissionProductMigrationSource[]>;
  now?: () => string;
  idFactory?: (prefix: string) => string;
}

interface PlannedMigration {
  preview: CommissionCatalogMigrationPreview;
  inputSnapshotHash: `sha256:${string}`;
  entries: readonly CommissionCatalogMigrationEntry[];
}

interface PreparedProduct {
  product: CommissionProductMigrationSource;
  snapshot: CommissionCatalogSnapshotValue;
  snapshotBytes: string;
  snapshotHash: `sha256:${string}`;
}

function hashBytes(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizedSnapshot(
  value: unknown,
  ancestors = new Set<object>()
): CommissionCatalogSnapshotValue {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (typeof value === "number") {
    const representation = Number.isNaN(value)
      ? "NaN"
      : value === Number.POSITIVE_INFINITY
        ? "Infinity"
        : value === Number.NEGATIVE_INFINITY
          ? "-Infinity"
          : Object.is(value, -0) ? "-0" : String(value);
    return ["number", representation];
  }
  if (typeof value === "symbol" || typeof value === "function") {
    throw migrationError("unsupported_commission_product_snapshot_value");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw migrationError("unsupported_commission_product_snapshot_value");
  }
  if (value instanceof Date) {
    if (Object.keys(value).length > 0) {
      throw migrationError("unsupported_commission_product_snapshot_value");
    }
    const instant = Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    return ["date", instant];
  }
  if (ancestors.has(value)) {
    throw migrationError("circular_commission_product_snapshot");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: CommissionCatalogSnapshotValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        items.push(Object.hasOwn(value, index)
          ? normalizedSnapshot(value[index], ancestors)
          : ["hole"]);
      }
      return ["array", items];
    }
    if (value instanceof Map) {
      if (Object.keys(value).length > 0) {
        throw migrationError("unsupported_commission_product_snapshot_value");
      }
      const entries = [...value.entries()].map(([key, nested]) => [
        normalizedSnapshot(key, ancestors),
        normalizedSnapshot(nested, ancestors)
      ] as const);
      entries.sort((left, right) => compareCodePoint(
        JSON.stringify(left), JSON.stringify(right)
      ));
      return ["map", entries];
    }
    if (value instanceof Set) {
      if (Object.keys(value).length > 0) {
        throw migrationError("unsupported_commission_product_snapshot_value");
      }
      const items = [...value].map((nested) => normalizedSnapshot(nested, ancestors));
      items.sort((left, right) => compareCodePoint(
        JSON.stringify(left), JSON.stringify(right)
      ));
      return ["set", items];
    }
    if (value instanceof RegExp) {
      if (Object.keys(value).length > 0) {
        throw migrationError("unsupported_commission_product_snapshot_value");
      }
      return [
        "regexp",
        value.source,
        value.flags,
        normalizedSnapshot(value.lastIndex, ancestors)
      ];
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) {
      throw migrationError("unsupported_commission_product_snapshot_value");
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort(compareCodePoint)
      .map((key) => [key, normalizedSnapshot(record[key], ancestors)] as const);
    return ["object", entries];
  } finally {
    ancestors.delete(value);
  }
}

function prepareProduct(
  product: CommissionProductMigrationSource
): PreparedProduct {
  const snapshot = normalizedSnapshot(product);
  const snapshotBytes = JSON.stringify(snapshot);
  return Object.freeze({
    product,
    snapshot,
    snapshotBytes,
    snapshotHash: hashBytes(snapshotBytes)
  });
}

function inputSnapshotHash(
  workspaceId: string,
  products: readonly PreparedProduct[]
): `sha256:${string}` {
  return hashBytes(JSON.stringify([
    "commission-catalog-migration-input.v1",
    workspaceId,
    products.map((product) => product.snapshot)
  ]));
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
  value: unknown,
  exponent: number,
  valueCode: "default_price" | "cost_price"
): { minor: number } | { code: CommissionCatalogMigrationFailureCode } {
  if (typeof value !== "number" && typeof value !== "string") {
    return { code: `invalid_${valueCode}` };
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { code: `invalid_${valueCode}` };
  }
  const source = typeof value === "number" ? String(value) : value;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(source);
  if (!match) return { code: `invalid_${valueCode}` };
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  const scientificExponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(scientificExponent)
    || Math.abs(scientificExponent) > 1_000) {
    return { code: "amount_out_of_range" };
  }
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
    const minor = safeMinor(coefficient, valueCode);
    if (valueCode === "default_price" && minor === 0) {
      return { code: "invalid_default_price" };
    }
    return { minor };
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

function resultForRepair(
  workspaceId: string,
  product: CommissionProductMigrationSource,
  snapshot: CommissionCatalogSnapshotValue,
  snapshotHash: `sha256:${string}`,
  code: CommissionCatalogMigrationFailureCode
): CommissionCatalogMigrationItemResult {
  return immutableClone({
    workspaceId,
    commissionProductId: product.id,
    status: "repair_required",
    code,
    snapshot,
    snapshotHash,
    catalogItemId: null,
    pricingPolicyVersionId: null
  }) as CommissionCatalogMigrationItemResult;
}

function reportHashFor(
  workspaceId: string,
  items: readonly CommissionCatalogMigrationItemResult[]
): `sha256:${string}` {
  return hashBytes(JSON.stringify([
    "commission-catalog-migration-report.v1",
    workspaceId,
    items.map((item) => [
      item.commissionProductId,
      item.status,
      item.code,
      item.snapshotHash
    ])
  ]));
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
    const currentInputSnapshotHash = inputSnapshotHash(workspace, products);
    const existing = await this.repository.findCommissionCatalogMigrationRun(
      workspace,
      key
    );
    if (existing) {
      if (existing.inputSnapshotHash !== currentInputSnapshotHash) {
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

  private async workspaceProducts(workspaceId: string): Promise<PreparedProduct[]> {
    const products = (await this.products(workspaceId))
      .filter((product) => product.teamId === workspaceId)
      .sort((left, right) => compareCodePoint(left.id, right.id));
    const ids = new Set<string>();
    for (const product of products) {
      if (!product.id || ids.has(product.id)) {
        throw migrationError("invalid_commission_product_identity");
      }
      ids.add(product.id);
    }
    return products.map(prepareProduct);
  }

  private async plan(
    workspaceId: string,
    suppliedProducts?: readonly PreparedProduct[],
    createdBy?: string,
    operationTime?: string
  ): Promise<PlannedMigration> {
    const timestamp = operationTime ?? this.now();
    if (!Number.isFinite(Date.parse(timestamp))) throw migrationError("invalid_migration_time");
    const products = suppliedProducts
      ? [...suppliedProducts]
      : await this.workspaceProducts(workspaceId);
    const currentInputSnapshotHash = inputSnapshotHash(workspaceId, products);
    const results: CommissionCatalogMigrationItemResult[] = [];
    const entries: CommissionCatalogMigrationEntry[] = [];
    for (const prepared of products) {
      const { product, snapshot, snapshotHash } = prepared;
      const exponent = currencyExponent(product.currency);
      if (exponent === null) {
        results.push(resultForRepair(
          workspaceId, product, snapshot, snapshotHash, "invalid_currency"
        ));
        continue;
      }
      const price = decimalToMinor(product.defaultPrice, exponent, "default_price");
      if ("code" in price) {
        results.push(resultForRepair(
          workspaceId, product, snapshot, snapshotHash, price.code
        ));
        continue;
      }
      const cost = decimalToMinor(product.costPrice, exponent, "cost_price");
      if ("code" in cost) {
        results.push(resultForRepair(
          workspaceId, product, snapshot, snapshotHash, cost.code
        ));
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
    return {
      preview,
      inputSnapshotHash: currentInputSnapshotHash,
      entries: immutableClone(entries) as unknown as readonly CommissionCatalogMigrationEntry[]
    };
  }
}
