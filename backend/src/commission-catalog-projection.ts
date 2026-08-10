import type { CatalogRepository } from "./catalog-repository.js";
import { requireGrowthCapabilities } from "./growth-capabilities.js";
import { currencyExponent } from "./growth-money.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";
import type { CommissionProduct } from "./types.js";

export type CommissionProductPatch = Partial<Pick<
  CommissionProduct,
  | "name" | "category" | "model" | "currency" | "defaultPrice"
  | "costPrice" | "status" | "remark"
>>;

export interface CommissionCatalogProjectionPort {
  projectProduct(
    context: ActiveWorkspaceContext,
    product: CommissionProduct
  ): Promise<CommissionProduct>;
  assertCommercialPatchAllowed(
    context: ActiveWorkspaceContext,
    productId: string,
    patch: CommissionProductPatch
  ): Promise<void>;
}

export class CommissionCatalogProjectionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code
  ) {
    super(message);
    this.name = "CommissionCatalogProjectionError";
  }
}

function unavailable(): never {
  throw new CommissionCatalogProjectionError(
    503,
    "catalog_projection_unavailable"
  );
}

function minorToMajor(minor: number, currency: string): number {
  const exponent = currencyExponent(currency);
  if (exponent === null || !Number.isSafeInteger(minor) || minor < 0) {
    unavailable();
  }
  if (exponent === 0) return minor;
  const digits = String(minor).padStart(exponent + 1, "0");
  const split = digits.length - exponent;
  const value = Number(`${digits.slice(0, split)}.${digits.slice(split)}`);
  if (!Number.isFinite(value)) unavailable();
  return value;
}

function markedMigrated(product: CommissionProduct): boolean {
  return product.catalogMigrationStatus === "migrated"
    || typeof product.catalogItemId === "string";
}

export class CommissionCatalogProjection
implements CommissionCatalogProjectionPort {
  constructor(private readonly options: Readonly<{
    repository: Pick<CatalogRepository,
      "findCommissionProductLink" | "findPricingPolicyVersion">;
  }>) {}

  private async linkedAuthority(
    context: ActiveWorkspaceContext,
    productId: string
  ) {
    const link = await this.options.repository.findCommissionProductLink(
      context.workspaceId,
      productId
    );
    if (!link) return null;
    const linkedPolicy = await this.options.repository.findPricingPolicyVersion(
      context.workspaceId,
      link.pricingPolicyVersionId
    );
    if (!linkedPolicy
      || link.workspaceId !== context.workspaceId
      || link.commissionProductId !== productId
      || linkedPolicy.workspaceId !== context.workspaceId
      || linkedPolicy.id !== link.pricingPolicyVersionId
      || linkedPolicy.catalogItemId !== link.catalogItemId) {
      unavailable();
    }
    return { link, linkedPolicy };
  }

  async projectProduct(
    context: ActiveWorkspaceContext,
    product: CommissionProduct
  ): Promise<CommissionProduct> {
    requireGrowthCapabilities(context, ["catalog.read"]);
    const authority = await this.linkedAuthority(context, product.id);
    if (!authority) {
      if (markedMigrated(product)) unavailable();
      return product;
    }
    const { link, linkedPolicy } = authority;
    if (product.catalogItemId !== undefined
      && product.catalogItemId !== link.catalogItemId) {
      unavailable();
    }
    return Object.freeze({
      ...product,
      catalogItemId: link.catalogItemId,
      catalogMigrationStatus: "migrated" as const,
      currency: linkedPolicy.currency,
      defaultPrice: minorToMajor(
        linkedPolicy.listUnitPriceMinor,
        linkedPolicy.currency
      ),
      costPrice: minorToMajor(
        linkedPolicy.unitStandardCostMinor,
        linkedPolicy.currency
      )
    });
  }

  async assertCommercialPatchAllowed(
    context: ActiveWorkspaceContext,
    productId: string,
    patch: CommissionProductPatch
  ): Promise<void> {
    requireGrowthCapabilities(context, ["catalog.read"]);
    const authority = await this.linkedAuthority(context, productId);
    if (!authority) return;
    if (["defaultPrice", "costPrice", "currency"].some((field) =>
      Object.hasOwn(patch, field))) {
      throw new CommissionCatalogProjectionError(
        409,
        "catalog_projection_read_only"
      );
    }
  }
}
