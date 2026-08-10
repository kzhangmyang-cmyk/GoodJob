import mysql from "mysql2/promise";
import type { CommissionProduct } from "./types.js";
import {
  MysqlCatalogRepository,
  ensureCatalogMysqlSchema
} from "./catalog-mysql-repository.js";
import { CommissionCatalogMigrationService } from "./commission-catalog-migration.js";

function argument(name: string): string {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length).trim();
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "").trim() : "";
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

function databaseUrl(): string {
  const configured = process.env.DATABASE_URL?.trim()
    || process.env.MYSQL_URL?.trim();
  if (!configured) {
    throw new Error("commission catalog migration requires DATABASE_URL or MYSQL_URL");
  }
  const url = new URL(configured);
  if (url.protocol !== "mysql:") throw new Error("database URL must use mysql protocol");
  return configured;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(text)) {
    return new Date(`${text.replace(" ", "T")}Z`).toISOString();
  }
  return new Date(text).toISOString();
}

async function main(): Promise<void> {
  const workspaceId = requiredArgument("workspace");
  const actorId = requiredArgument("actor");
  const idempotencyKey = requiredArgument("idempotency");
  const pool = mysql.createPool({
    uri: databaseUrl(),
    connectionLimit: 2,
    timezone: "Z",
    dateStrings: true
  });
  try {
    await ensureCatalogMysqlSchema(pool);
    const repository = new MysqlCatalogRepository(pool);
    const service = new CommissionCatalogMigrationService({
      repository,
      products: async (workspace) => {
        const [rows] = await pool.query(
          `SELECT id,name,category,model,currency,default_price,cost_price,
             status,remark,owner_id,team_id,updated_at
           FROM commission_products
           WHERE team_id = ?
           ORDER BY id`,
          [workspace]
        );
        return (rows as Array<Record<string, unknown>>).map((row): CommissionProduct => ({
          id: String(row.id),
          name: String(row.name),
          category: String(row.category ?? ""),
          model: String(row.model ?? ""),
          currency: String(row.currency),
          defaultPrice: Number(row.default_price),
          costPrice: Number(row.cost_price),
          status: row.status === "active" ? "active" : "disabled",
          remark: String(row.remark ?? ""),
          ownerId: String(row.owner_id),
          teamId: String(row.team_id),
          updatedAt: iso(row.updated_at)
        }));
      }
    });
    const run = await service.execute(workspaceId, actorId, idempotencyKey);
    const summary = Object.freeze({
      id: run.id,
      workspaceId: run.workspaceId,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      status: run.status,
      scanned: run.scanned,
      migrated: run.migrated,
      repairRequired: run.repairRequired,
      reportHash: run.reportHash
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await pool.end();
  }
}

await main();
