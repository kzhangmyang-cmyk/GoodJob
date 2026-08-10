export type ApprovalCapability =
  | "quote.confirm"
  | "quote.exception.discount.approve"
  | "quote.exception.margin.approve"
  | "quote.exception.payment_terms.approve"
  | "quote.exception.gift.approve"
  | "quote.exception.credit.approve"
  | "quote.exception.manual.approve";

export interface ApprovalThresholds {
  discountCapability: ApprovalCapability;
  marginCapability: ApprovalCapability;
  paymentTermsCapability: ApprovalCapability;
  giftCapability: ApprovalCapability;
  creditCapability: ApprovalCapability;
  manualCapability: ApprovalCapability;
  creditRiskThresholdBps: number;
  manualEscalationEnabled: boolean;
}

export interface SurchargePolicy {
  kind: "region" | "delivery" | "payment_term";
  condition: string;
  fixedAmountMinor: number;
  unitAmountMinor: number;
}

export interface GiftPolicy {
  catalogItemId: string;
  unitStandardCostMinor: number;
  standardQuantityMicros: number;
  absoluteQuantityMicros: number;
  standardCostLimitMinor: number;
  absoluteCostLimitMinor: number;
}

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
  source: "native" | "legacy_commission_product";
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

export type CommissionCatalogSnapshotValue =
  | readonly ["null"]
  | readonly ["undefined"]
  | readonly ["boolean", boolean]
  | readonly ["number", string]
  | readonly ["string", string]
  | readonly ["bigint", string]
  | readonly ["date", string]
  | readonly ["hole"]
  | readonly ["array", readonly CommissionCatalogSnapshotValue[]]
  | readonly [
      "map",
      readonly (readonly [
        CommissionCatalogSnapshotValue,
        CommissionCatalogSnapshotValue
      ])[]
    ]
  | readonly ["set", readonly CommissionCatalogSnapshotValue[]]
  | readonly ["regexp", string, string, CommissionCatalogSnapshotValue]
  | readonly [
      "object",
      readonly (readonly [string, CommissionCatalogSnapshotValue])[]
    ];

export interface CommissionCatalogMigrationItemResult {
  workspaceId: string;
  commissionProductId: string;
  status: "migrated" | "repair_required";
  code: CommissionCatalogMigrationItemCode;
  snapshot: CommissionCatalogSnapshotValue;
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

const APPROVAL_CAPABILITIES = new Set<ApprovalCapability>([
  "quote.confirm",
  "quote.exception.discount.approve",
  "quote.exception.margin.approve",
  "quote.exception.payment_terms.approve",
  "quote.exception.gift.approve",
  "quote.exception.credit.approve",
  "quote.exception.manual.approve"
]);

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Runtime boundary for the released, closed PricingPolicy v1 rule objects. */
export function assertClosedPricingPolicyRules(
  value: Pick<PricingPolicyVersion,
    "approvalThresholds" | "surchargePolicies" | "giftPolicies">
): void {
  const approval = value.approvalThresholds;
  const capabilityFields = [
    "discountCapability", "marginCapability", "paymentTermsCapability",
    "giftCapability", "creditCapability", "manualCapability"
  ] as const;
  if (!hasExactKeys(approval, [
    ...capabilityFields, "creditRiskThresholdBps", "manualEscalationEnabled"
  ]) || capabilityFields.some((field) =>
    !APPROVAL_CAPABILITIES.has(approval[field] as ApprovalCapability))
    || !nonnegativeSafeInteger(approval.creditRiskThresholdBps)
    || approval.creditRiskThresholdBps > 10_000
    || typeof approval.manualEscalationEnabled !== "boolean") {
    throw Object.assign(new Error("invalid_approval_rule"), {
      code: "invalid_approval_rule"
    });
  }

  if (!Array.isArray(value.surchargePolicies)
    || value.surchargePolicies.some((policy) =>
      !hasExactKeys(policy, [
        "kind", "condition", "fixedAmountMinor", "unitAmountMinor"
      ])
      || !["region", "delivery", "payment_term"].includes(String(policy.kind))
      || typeof policy.condition !== "string" || policy.condition.trim() === ""
      || !nonnegativeSafeInteger(policy.fixedAmountMinor)
      || !nonnegativeSafeInteger(policy.unitAmountMinor))) {
    throw Object.assign(new Error("invalid_surcharge_policy"), {
      code: "invalid_surcharge_policy"
    });
  }

  if (!Array.isArray(value.giftPolicies)
    || value.giftPolicies.some((policy) =>
      !hasExactKeys(policy, [
        "catalogItemId", "unitStandardCostMinor", "standardQuantityMicros",
        "absoluteQuantityMicros", "standardCostLimitMinor", "absoluteCostLimitMinor"
      ])
      || typeof policy.catalogItemId !== "string" || policy.catalogItemId.trim() === ""
      || !nonnegativeSafeInteger(policy.unitStandardCostMinor)
      || !nonnegativeSafeInteger(policy.standardQuantityMicros)
      || !nonnegativeSafeInteger(policy.absoluteQuantityMicros)
      || !nonnegativeSafeInteger(policy.standardCostLimitMinor)
      || !nonnegativeSafeInteger(policy.absoluteCostLimitMinor))) {
    throw Object.assign(new Error("invalid_gift_policy"), {
      code: "invalid_gift_policy"
    });
  }
}
