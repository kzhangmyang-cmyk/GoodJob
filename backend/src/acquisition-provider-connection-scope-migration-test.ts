import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type mysql from "mysql2/promise";
import {
  ensureProviderConnectionOwnerTeamUniqueness
} from "./mysql-store.js";

const schemaSources = [
  readFileSync(new URL("../schema.mysql.sql", import.meta.url), "utf8"),
  readFileSync(new URL("../goodjob_crm.full.sql", import.meta.url), "utf8"),
  readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8")
];

test("provider connection fresh schemas enforce owner-and-team uniqueness", () => {
  for (const source of schemaSources) {
    assert.match(
      source,
      /CREATE TABLE(?: IF NOT EXISTS)? provider_catalog\s*\(/u
    );
    assert.match(
      source,
      /CREATE TABLE(?: IF NOT EXISTS)? provider_connections\s*\([\s\S]*?credential_version BIGINT UNSIGNED NOT NULL DEFAULT 1[\s\S]*?UNIQUE KEY uk_provider_connection_owner_team\s*\(\s*provider_id\s*,\s*owner_id\s*,\s*team_id\s*\)/u
    );
    assert.doesNotMatch(
      source,
      /UNIQUE KEY uk_provider_connection_owner\s*\(\s*provider_id\s*,\s*owner_id\s*\)/u
    );
  }
});

interface IndexDefinition {
  columns: string[];
  unique: boolean;
}

class FakeProviderConnectionIndexPool {
  readonly calls: string[] = [];
  readonly indexes = new Map<string, IndexDefinition>();
  readonly duplicateScopes: Array<{
    providerId: string;
    ownerId: string;
    teamId: string;
    duplicateCount: number;
    connectionIds: string;
  }>;

  constructor(
    indexes: Record<string, IndexDefinition>,
    duplicateScopes: FakeProviderConnectionIndexPool[
      "duplicateScopes"
    ] = []
  ) {
    for (const [name, definition] of Object.entries(indexes)) {
      this.indexes.set(name, structuredClone(definition));
    }
    this.duplicateScopes = structuredClone(duplicateScopes);
  }

  async query(sql: string, values: unknown[] = []) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.calls.push(normalized);
    if (
      normalized.includes("FROM provider_connections")
      && normalized.includes("GROUP BY provider_id")
    ) {
      return [structuredClone(this.duplicateScopes), []];
    }
    if (normalized.includes("FROM information_schema.statistics")) {
      const indexName = String(values[1] ?? "");
      const definition = this.indexes.get(indexName);
      if (normalized.includes("COUNT(*) AS count")) {
        return [[{ count: definition ? definition.columns.length : 0 }], []];
      }
      return [
        (definition?.columns ?? []).map((columnName) => ({
          columnName,
          nonUnique: definition?.unique ? 0 : 1
        })),
        []
      ];
    }
    const add = normalized.match(
      /ALTER TABLE `provider_connections` ADD UNIQUE KEY `([^`]+)` \(([^)]+)\)/u
    );
    if (add) {
      this.indexes.set(add[1]!, {
        columns: [...add[2]!.matchAll(/`([^`]+)`/gu)]
          .map((match) => match[1]!),
        unique: true
      });
      return [{ affectedRows: 0 }, []];
    }
    const drop = normalized.match(
      /ALTER TABLE `provider_connections` DROP INDEX `([^`]+)`/u
    );
    if (drop) {
      this.indexes.delete(drop[1]!);
      return [{ affectedRows: 0 }, []];
    }
    throw new Error(`Unexpected query: ${normalized}`);
  }
}

function asPool(pool: FakeProviderConnectionIndexPool) {
  return pool as unknown as mysql.Pool;
}

test("legacy provider connection indexes upgrade safely and idempotently", async () => {
  const pool = new FakeProviderConnectionIndexPool({
    uk_provider_connection_owner: {
      columns: ["provider_id", "owner_id"],
      unique: true
    },
    uk_provider_connection_owner_team: {
      columns: ["provider_id", "team_id"],
      unique: true
    }
  });

  await ensureProviderConnectionOwnerTeamUniqueness(asPool(pool));
  assert.deepEqual(
    pool.indexes.get("uk_provider_connection_owner_team"),
    {
      columns: ["provider_id", "owner_id", "team_id"],
      unique: true
    }
  );
  assert.equal(pool.indexes.has("uk_provider_connection_owner"), false);
  const firstPassAlterCalls = pool.calls.filter(
    (sql) => sql.startsWith("ALTER TABLE")
  );
  assert.ok(
    firstPassAlterCalls.findIndex((sql) =>
      sql.includes("ADD UNIQUE KEY `uk_provider_connection_owner_team`"))
    < firstPassAlterCalls.findIndex((sql) =>
      sql.includes("DROP INDEX `uk_provider_connection_owner`"))
  );

  await ensureProviderConnectionOwnerTeamUniqueness(asPool(pool));
  assert.deepEqual(
    pool.calls.filter((sql) => sql.startsWith("ALTER TABLE")),
    firstPassAlterCalls
  );
});

test("provider connection scope duplicates fail fast without deleting BYOK rows", async () => {
  const duplicateScopes = [{
    providerId: "serper",
    ownerId: "owner-a",
    teamId: "team-a",
    duplicateCount: 2,
    connectionIds: "connection-a,connection-b"
  }];
  const pool = new FakeProviderConnectionIndexPool(
    {},
    duplicateScopes
  );

  await assert.rejects(
    ensureProviderConnectionOwnerTeamUniqueness(asPool(pool)),
    /PROVIDER_CONNECTION_SCOPE_DUPLICATES.*serper.*owner-a.*team-a/u
  );
  assert.deepEqual(pool.duplicateScopes, duplicateScopes);
  assert.equal(
    pool.calls.some((sql) => /ALTER TABLE|DELETE FROM/u.test(sql)),
    false
  );
});
