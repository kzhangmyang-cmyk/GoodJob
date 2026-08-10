import type { GrowthCapability } from "./growth-capabilities.js";

export interface ApprovalThreshold {
  standard: number;
  absolute: number;
  requiredCapability: GrowthCapability;
}

export interface ApprovalThresholds {
  discount: ApprovalThreshold;
  margin: ApprovalThreshold;
  paymentTerms: ApprovalThreshold;
  gift: ApprovalThreshold;
  credit: ApprovalThreshold;
  manualEscalation: Readonly<{
    enabled: boolean;
    requiredCapability: GrowthCapability;
  }>;
}

export interface SurchargePredicate {
  region?: string;
  deliveryMethod?: string;
  paymentTermDays?: Readonly<{ minimum: number | null; maximum: number | null }>;
}

export type SurchargePolicy =
  | { kind: "fixed_order"; amountMinor: number; when: SurchargePredicate }
  | { kind: "per_unit"; unitAmountMinor: number; when: SurchargePredicate };

export type GiftPolicy =
  | {
      kind: "quantity_limit";
      standardQuantityMicros: number;
      absoluteQuantityMicros: number;
      requiredCapability: GrowthCapability;
    }
  | {
      kind: "cost_limit";
      standardCostMinor: number;
      absoluteCostMinor: number;
      requiredCapability: GrowthCapability;
    };

export interface CatalogItem {
  id: string;
  workspaceId: string;
  type: "product" | "service" | "package";
  code: string;
  name: string;
  description: string;
  unit: string;
  status: "active" | "retired";
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PricingPolicyVersion {
  id: string;
  workspaceId: string;
  catalogItemId: string;
  version: number;
  packageVersionId: string | null;
  currency: string;
  listUnitPriceMinor: number;
  unitStandardCostMinor: number;
  defaultOrderDeliveryCostMinor: number;
  defaultOrderSalesCostMinor: number;
  defaultOrderServiceCostMinor: number;
  absoluteFloorUnitPriceMinor: number;
  standardDiscountLimitBps: number;
  absoluteDiscountLimitBps: number;
  targetGrossMarginBps: number;
  absoluteMinimumGrossMarginBps: number;
  standardPaymentTermDays: number;
  absolutePaymentTermDays: number;
  approvalThresholds: ApprovalThresholds;
  surchargePolicies: readonly SurchargePolicy[];
  giftPolicies: readonly GiftPolicy[];
  validFrom: string;
  validTo: string | null;
  status: "draft" | "active" | "retired";
  source: "manual" | "legacy_commission_product";
  capabilityRegistryVersion: string;
  revision: number;
  createdBy: string;
  createdAt: string;
}

export interface PackageVersion {
  id: string;
  workspaceId: string;
  packageCatalogItemId: string;
  version: number;
  currency: string;
  status: "draft" | "active" | "retired";
  validFrom: string;
  validTo: string | null;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PackageComponent {
  workspaceId: string;
  packageVersionId: string;
  componentCatalogItemId: string;
  componentPricingPolicyVersionId: string;
  quantityMicros: number;
}

export interface CommissionProductCatalogLink {
  workspaceId: string;
  commissionProductId: string;
  catalogItemId: string;
  pricingPolicyVersionId: string;
  migratedAt: string;
}

export type CommissionCatalogMigrationFailureCode =
  | "invalid_currency"
  | "invalid_default_price"
  | "invalid_cost_price"
  | "invalid_default_price_precision"
  | "invalid_cost_price_precision"
  | "amount_out_of_range";

export type CommissionCatalogMigrationItemCode =
  | "migrated"
  | CommissionCatalogMigrationFailureCode;

export interface CommissionCatalogMigrationItemResult {
  workspaceId: string;
  commissionProductId: string;
  status: "migrated" | "repair_required";
  code: CommissionCatalogMigrationItemCode;
  snapshot: Readonly<Record<string, unknown>>;
  snapshotHash: `sha256:${string}`;
  catalogItemId: string | null;
  pricingPolicyVersionId: string | null;
}

export interface CommissionCatalogMigrationRun {
  id: string;
  workspaceId: string;
  actorId: string;
  idempotencyKey: string;
  inputSnapshotHash: `sha256:${string}`;
  startedAt: string;
  completedAt: string;
  status: "completed";
  scanned: number;
  migrated: number;
  repairRequired: number;
  reportHash: `sha256:${string}`;
  items: readonly CommissionCatalogMigrationItemResult[];
}

export interface CommissionCatalogMigrationPreview {
  workspaceId: string;
  scanned: number;
  migrated: number;
  repairRequired: number;
  reportHash: `sha256:${string}`;
  items: readonly CommissionCatalogMigrationItemResult[];
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export function immutableClone<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}
