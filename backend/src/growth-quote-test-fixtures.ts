import type { PricingPolicyVersion } from "./catalog-domain.js";
import { capabilitiesForHumanRole, type GrowthCapability } from "./growth-capabilities.js";
import type { CommandContext } from "./growth-command-context.js";
import type { QuoteCalculationInput } from "./quote-domain.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import type { Role } from "./types.js";

const FIXED_INSTANT = "2026-08-01T00:00:00.000Z";

export function quotePolicyFixture(
  overrides: Partial<PricingPolicyVersion> = {}
): PricingPolicyVersion {
  return {
    id: "pricing-policy-1",
    workspaceId: "team-a",
    catalogItemId: "catalog-item-1",
    version: 1,
    packageVersionId: null,
    currency: "CNY",
    listUnitPriceMinor: 10_000,
    unitStandardCostMinor: 6_000,
    defaultOrderDeliveryCostMinor: 1_000,
    defaultOrderSalesCostMinor: 500,
    defaultOrderServiceCostMinor: 200,
    absoluteFloorUnitPriceMinor: 7_000,
    standardDiscountLimitBps: 1_000,
    absoluteDiscountLimitBps: 3_000,
    targetGrossMarginBps: 3_000,
    absoluteMinimumGrossMarginBps: 1_000,
    standardPaymentTermDays: 30,
    absolutePaymentTermDays: 90,
    approvalThresholds: {
      discountCapability: "quote.exception.discount.approve",
      marginCapability: "quote.exception.margin.approve",
      paymentTermsCapability: "quote.exception.payment_terms.approve",
      giftCapability: "quote.exception.gift.approve",
      creditCapability: "quote.exception.credit.approve",
      manualCapability: "quote.exception.manual.approve",
      creditRiskThresholdBps: 5_000,
      manualEscalationEnabled: true
    },
    surchargePolicies: [],
    giftPolicies: [],
    validFrom: FIXED_INSTANT,
    validTo: null,
    status: "active",
    source: "native",
    capabilityRegistryVersion: "growth-capabilities.v1",
    revision: 1,
    createdBy: "admin-1",
    createdAt: FIXED_INSTANT,
    ...overrides
  };
}

export function quoteInputFixture(
  overrides: Partial<QuoteCalculationInput> = {}
): QuoteCalculationInput {
  return {
    workspaceId: "team-a",
    catalogItemId: "catalog-item-1",
    pricingPolicyVersionId: "pricing-policy-1",
    quantityMicros: 1_000_000,
    offeredUnitPriceMinor: 9_000,
    orderDiscountMinor: 0,
    paymentTermDays: 30,
    giftItems: [],
    surchargeContext: { region: null, deliveryMethod: null },
    customerTargetPriceMinor: null,
    creditRiskBps: null,
    manualEscalation: false,
    ...overrides
  };
}

export function workspaceContextFixture(
  role: Role,
  capabilities: readonly GrowthCapability[] = capabilitiesForHumanRole(role),
  actorId = `${role}-actor-1`
): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId: "team-a",
    kind: "team",
    actorId,
    role,
    teamId: "team-a",
    capabilities: Object.freeze([...capabilities]),
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

export function commandContextFixture(
  overrides: Partial<CommandContext> = {}
): CommandContext {
  const workspace = overrides.workspace ?? workspaceContextFixture("sales");
  return Object.freeze({
    workspace,
    actorId: workspace.actorId,
    idempotencyKey: "quote-command-1",
    requestHash: `sha256:${"1".padStart(64, "0")}`,
    expectedRevision: null,
    ...overrides
  });
}
