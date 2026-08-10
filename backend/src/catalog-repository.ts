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

export interface CommissionCatalogMigrationEntry {
  item: CatalogItem;
  pricingPolicy: PricingPolicyVersion;
  link: CommissionProductCatalogLink;
}

export interface CommissionCatalogMigrationCommit {
  run: CommissionCatalogMigrationRun;
  entries: readonly CommissionCatalogMigrationEntry[];
}

export interface CatalogRepository {
  appendCatalogItem(item: CatalogItem): Promise<CatalogItem>;
  findCatalogItem(workspaceId: string, id: string): Promise<CatalogItem | null>;
  appendPricingPolicyVersion(policy: PricingPolicyVersion): Promise<PricingPolicyVersion>;
  findPricingPolicyVersion(
    workspaceId: string,
    pricingPolicyVersionId: string
  ): Promise<PricingPolicyVersion | null>;
  appendPackageVersion(version: PackageVersion): Promise<PackageVersion>;
  findPackageVersion(workspaceId: string, id: string): Promise<PackageVersion | null>;
  replaceDraftPackageComponents(
    workspaceId: string,
    packageVersionId: string,
    components: readonly PackageComponent[]
  ): Promise<readonly PackageComponent[]>;
  findCommissionProductLink(
    workspaceId: string,
    commissionProductId: string
  ): Promise<CommissionProductCatalogLink | null>;
  findCommissionCatalogMigrationRun(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<CommissionCatalogMigrationRun | null>;
  commitCommissionCatalogMigration(
    commit: CommissionCatalogMigrationCommit
  ): Promise<CommissionCatalogMigrationRun>;
}

function key(workspaceId: string, id: string): string {
  return `${workspaceId}\u0000${id}`;
}

function conflict(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly catalogItems = new Map<string, CatalogItem>();
  private readonly pricingPolicies = new Map<string, PricingPolicyVersion>();
  private readonly packageVersions = new Map<string, PackageVersion>();
  private readonly packageComponents = new Map<string, readonly PackageComponent[]>();
  private readonly commissionLinks = new Map<string, CommissionProductCatalogLink>();
  private readonly migrationRuns = new Map<string, CommissionCatalogMigrationRun>();

  async appendCatalogItem(item: CatalogItem): Promise<CatalogItem> {
    const itemKey = key(item.workspaceId, item.id);
    if (this.catalogItems.has(itemKey)) throw conflict("catalog_item_already_exists");
    const stored = immutableClone(item) as CatalogItem;
    this.catalogItems.set(itemKey, stored);
    return immutableClone(stored) as CatalogItem;
  }

  async findCatalogItem(workspaceId: string, id: string): Promise<CatalogItem | null> {
    const item = this.catalogItems.get(key(workspaceId, id));
    return item ? immutableClone(item) as CatalogItem : null;
  }

  async appendPricingPolicyVersion(
    policy: PricingPolicyVersion
  ): Promise<PricingPolicyVersion> {
    const policyKey = key(policy.workspaceId, policy.id);
    if (this.pricingPolicies.has(policyKey)) {
      throw conflict("pricing_policy_version_already_exists");
    }
    const stored = immutableClone(policy) as PricingPolicyVersion;
    this.pricingPolicies.set(policyKey, stored);
    return immutableClone(stored) as PricingPolicyVersion;
  }

  async findPricingPolicyVersion(
    workspaceId: string,
    pricingPolicyVersionId: string
  ): Promise<PricingPolicyVersion | null> {
    const policy = this.pricingPolicies.get(key(workspaceId, pricingPolicyVersionId));
    return policy ? immutableClone(policy) as PricingPolicyVersion : null;
  }

  async appendPackageVersion(version: PackageVersion): Promise<PackageVersion> {
    const versionKey = key(version.workspaceId, version.id);
    if (this.packageVersions.has(versionKey)) {
      throw conflict("package_version_already_exists");
    }
    const stored = immutableClone(version) as PackageVersion;
    this.packageVersions.set(versionKey, stored);
    return immutableClone(stored) as PackageVersion;
  }

  async findPackageVersion(workspaceId: string, id: string): Promise<PackageVersion | null> {
    const version = this.packageVersions.get(key(workspaceId, id));
    return version ? immutableClone(version) as PackageVersion : null;
  }

  async replaceDraftPackageComponents(
    workspaceId: string,
    packageVersionId: string,
    components: readonly PackageComponent[]
  ): Promise<readonly PackageComponent[]> {
    const version = this.packageVersions.get(key(workspaceId, packageVersionId));
    if (!version) throw conflict("package_version_not_found");
    if (version.status !== "draft") throw conflict("package_version_immutable");
    if (components.some((component) =>
      component.workspaceId !== workspaceId
      || component.packageVersionId !== packageVersionId)) {
      throw conflict("invalid_package_component_scope");
    }
    const stored = immutableClone(components) as readonly PackageComponent[];
    this.packageComponents.set(key(workspaceId, packageVersionId), stored);
    return immutableClone(stored) as readonly PackageComponent[];
  }

  async findCommissionProductLink(
    workspaceId: string,
    commissionProductId: string
  ): Promise<CommissionProductCatalogLink | null> {
    const link = this.commissionLinks.get(key(workspaceId, commissionProductId));
    return link ? immutableClone(link) as CommissionProductCatalogLink : null;
  }

  async findCommissionCatalogMigrationRun(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<CommissionCatalogMigrationRun | null> {
    const run = this.migrationRuns.get(key(workspaceId, idempotencyKey));
    return run ? immutableClone(run) as CommissionCatalogMigrationRun : null;
  }

  async commitCommissionCatalogMigration(
    commit: CommissionCatalogMigrationCommit
  ): Promise<CommissionCatalogMigrationRun> {
    const runKey = key(commit.run.workspaceId, commit.run.idempotencyKey);
    const existing = this.migrationRuns.get(runKey);
    if (existing) {
      if (existing.inputSnapshotHash !== commit.run.inputSnapshotHash) {
        throw conflict("commission_catalog_migration_conflict");
      }
      return immutableClone(existing) as CommissionCatalogMigrationRun;
    }

    const seenItems = new Set<string>();
    const seenPolicies = new Set<string>();
    const seenLinks = new Set<string>();
    for (const entry of commit.entries) {
      const itemKey = key(entry.item.workspaceId, entry.item.id);
      const policyKey = key(entry.pricingPolicy.workspaceId, entry.pricingPolicy.id);
      const linkKey = key(entry.link.workspaceId, entry.link.commissionProductId);
      if (this.catalogItems.has(itemKey) || seenItems.has(itemKey)) {
        throw conflict("catalog_item_already_exists");
      }
      if (this.pricingPolicies.has(policyKey) || seenPolicies.has(policyKey)) {
        throw conflict("pricing_policy_version_already_exists");
      }
      if (this.commissionLinks.has(linkKey) || seenLinks.has(linkKey)) {
        throw conflict("commission_product_already_migrated");
      }
      seenItems.add(itemKey);
      seenPolicies.add(policyKey);
      seenLinks.add(linkKey);
    }

    for (const entry of commit.entries) {
      this.catalogItems.set(
        key(entry.item.workspaceId, entry.item.id),
        immutableClone(entry.item) as CatalogItem
      );
      this.pricingPolicies.set(
        key(entry.pricingPolicy.workspaceId, entry.pricingPolicy.id),
        immutableClone(entry.pricingPolicy) as PricingPolicyVersion
      );
      this.commissionLinks.set(
        key(entry.link.workspaceId, entry.link.commissionProductId),
        immutableClone(entry.link) as CommissionProductCatalogLink
      );
    }
    const storedRun = immutableClone(commit.run) as CommissionCatalogMigrationRun;
    this.migrationRuns.set(runKey, storedRun);
    return immutableClone(storedRun) as CommissionCatalogMigrationRun;
  }
}

export type { CommissionCatalogMigrationItemResult };
