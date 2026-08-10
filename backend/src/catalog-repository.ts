import { createHash } from "node:crypto";
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

function invalidMigrationCommit(): Error & { code: string } {
  return Object.assign(new Error("invalid_commission_catalog_migration_commit"), {
    code: "invalid_commission_catalog_migration_commit"
  });
}

function concreteToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const token = value.trim();
  return token !== "" && token === value && token !== "all";
}

function sha256(bytes: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validSnapshot(value: unknown): boolean {
  if (!Array.isArray(value) || typeof value[0] !== "string") return false;
  const [tag, payload] = value;
  if (["null", "undefined", "hole"].includes(tag)) return value.length === 1;
  if (tag === "boolean") return value.length === 2 && typeof payload === "boolean";
  if (["number", "string", "bigint", "date"].includes(tag)) {
    return value.length === 2 && typeof payload === "string";
  }
  if (tag === "array") {
    return value.length === 2 && Array.isArray(payload) && payload.every(validSnapshot);
  }
  if (tag === "map" && value.length === 2 && Array.isArray(payload)) {
    let previous: string | null = null;
    for (const entry of payload) {
      if (!Array.isArray(entry) || entry.length !== 2
        || !validSnapshot(entry[0]) || !validSnapshot(entry[1])) return false;
      const bytes = JSON.stringify(entry);
      if (previous !== null && previous > bytes) return false;
      previous = bytes;
    }
    return true;
  }
  if (tag === "set" && value.length === 2 && Array.isArray(payload)) {
    let previous: string | null = null;
    for (const item of payload) {
      if (!validSnapshot(item)) return false;
      const bytes = JSON.stringify(item);
      if (previous !== null && previous > bytes) return false;
      previous = bytes;
    }
    return true;
  }
  if (tag === "regexp") {
    return value.length === 4 && typeof value[1] === "string"
      && typeof value[2] === "string" && validSnapshot(value[3]);
  }
  if (tag === "object" && value.length === 2 && Array.isArray(payload)) {
    let previous: string | null = null;
    for (const entry of payload) {
      if (!Array.isArray(entry) || entry.length !== 2
        || typeof entry[0] !== "string" || !validSnapshot(entry[1])) return false;
      if (previous !== null && previous >= entry[0]) return false;
      previous = entry[0];
    }
    return true;
  }
  return false;
}

export function assertCommissionCatalogMigrationCommitInvariant(
  commit: CommissionCatalogMigrationCommit
): void {
  const { run, entries } = commit;
  if (!run || !Array.isArray(entries)
    || !concreteToken(run.workspaceId) || !concreteToken(run.id)
    || !concreteToken(run.actorId) || !concreteToken(run.idempotencyKey)
    || run.status !== "completed"
    || !Number.isFinite(Date.parse(run.startedAt))
    || !Number.isFinite(Date.parse(run.completedAt))
    || !Array.isArray(run.items)) throw invalidMigrationCommit();
  if (![run.scanned, run.migrated, run.repairRequired].every((value) =>
    Number.isSafeInteger(value) && value >= 0)) throw invalidMigrationCommit();
  if (run.scanned !== run.items.length
    || run.migrated + run.repairRequired !== run.scanned) {
    throw invalidMigrationCommit();
  }
  const resultByProduct = new Map<string, CommissionCatalogMigrationItemResult>();
  let migrated = 0;
  for (const result of run.items) {
    if (result.workspaceId !== run.workspaceId
      || !concreteToken(result.commissionProductId)
      || resultByProduct.has(result.commissionProductId)
      || !validSnapshot(result.snapshot)) throw invalidMigrationCommit();
    const snapshotBytes = JSON.stringify(result.snapshot);
    if (result.snapshotHash !== sha256(snapshotBytes)) throw invalidMigrationCommit();
    if (result.status === "migrated") {
      migrated += 1;
      if (result.code !== "migrated" || !concreteToken(result.catalogItemId)
        || !concreteToken(result.pricingPolicyVersionId)) {
        throw invalidMigrationCommit();
      }
    } else if (result.status === "repair_required") {
      if (result.code === "migrated" || result.catalogItemId !== null
        || result.pricingPolicyVersionId !== null) throw invalidMigrationCommit();
    } else {
      throw invalidMigrationCommit();
    }
    resultByProduct.set(result.commissionProductId, result);
  }
  if (run.migrated !== migrated || run.repairRequired !== run.scanned - migrated) {
    throw invalidMigrationCommit();
  }
  const expectedInputHash = sha256(JSON.stringify([
    "commission-catalog-migration-input.v1",
    run.workspaceId,
    run.items.map((item) => item.snapshot)
  ]));
  const expectedReportHash = sha256(JSON.stringify([
    "commission-catalog-migration-report.v1",
    run.workspaceId,
    run.items.map((item) => [
      item.commissionProductId, item.status, item.code, item.snapshotHash
    ])
  ]));
  if (run.inputSnapshotHash !== expectedInputHash
    || run.reportHash !== expectedReportHash) throw invalidMigrationCommit();

  const itemIds = new Set<string>();
  const policyIds = new Set<string>();
  const productIds = new Set<string>();
  for (const entry of entries) {
    const { item, pricingPolicy, link } = entry;
    if (item?.workspaceId !== run.workspaceId
      || pricingPolicy?.workspaceId !== run.workspaceId
      || link?.workspaceId !== run.workspaceId
      || !concreteToken(item.id) || !concreteToken(pricingPolicy.id)
      || !concreteToken(link.commissionProductId)
      || pricingPolicy.catalogItemId !== item.id
      || link.catalogItemId !== item.id
      || link.pricingPolicyVersionId !== pricingPolicy.id
      || itemIds.has(item.id) || policyIds.has(pricingPolicy.id)
      || productIds.has(link.commissionProductId)) throw invalidMigrationCommit();
    const result = resultByProduct.get(link.commissionProductId);
    if (!result || result.status !== "migrated"
      || result.catalogItemId !== item.id
      || result.pricingPolicyVersionId !== pricingPolicy.id) {
      throw invalidMigrationCommit();
    }
    itemIds.add(item.id);
    policyIds.add(pricingPolicy.id);
    productIds.add(link.commissionProductId);
  }
}

function migrationEntryProductIds(
  commit: CommissionCatalogMigrationCommit
): ReadonlySet<string> {
  return new Set(commit.entries.map((entry) => entry.link.commissionProductId));
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
    assertCommissionCatalogMigrationCommitInvariant(commit);
    const runKey = key(commit.run.workspaceId, commit.run.idempotencyKey);
    const existing = this.migrationRuns.get(runKey);
    if (existing) {
      if (existing.inputSnapshotHash !== commit.run.inputSnapshotHash) {
        throw conflict("commission_catalog_migration_conflict");
      }
      return immutableClone(existing) as CommissionCatalogMigrationRun;
    }

    const entryProductIds = migrationEntryProductIds(commit);
    for (const result of commit.run.items) {
      if (result.status !== "migrated"
        || entryProductIds.has(result.commissionProductId)) continue;
      if (result.catalogItemId === null
        || result.pricingPolicyVersionId === null) throw invalidMigrationCommit();
      const link = this.commissionLinks.get(key(
        commit.run.workspaceId, result.commissionProductId
      ));
      const item = this.catalogItems.get(key(
        commit.run.workspaceId, result.catalogItemId
      ));
      const policy = this.pricingPolicies.get(key(
        commit.run.workspaceId, result.pricingPolicyVersionId
      ));
      if (!link || !item || !policy
        || link.workspaceId !== commit.run.workspaceId
        || link.catalogItemId !== result.catalogItemId
        || link.pricingPolicyVersionId !== result.pricingPolicyVersionId
        || item.workspaceId !== commit.run.workspaceId
        || item.id !== result.catalogItemId
        || policy.workspaceId !== commit.run.workspaceId
        || policy.id !== result.pricingPolicyVersionId
        || policy.catalogItemId !== result.catalogItemId) {
        throw invalidMigrationCommit();
      }
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
