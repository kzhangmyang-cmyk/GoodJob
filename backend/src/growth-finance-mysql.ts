import type mysql from "mysql2/promise";
import { AcquisitionCostLedgerService } from "./acquisition-cost-ledger.js";
import { MysqlVerifiedFinancialLedgerSealedReader } from "./financial-ledger-as-of-mysql-reader.js";
import { VerifiedFinancialLedgerAsOfBoundary } from "./financial-ledger-as-of-reader.js";
import {
  ensureFinancialLedgerMysqlSchema,
  MysqlFinancialLedgerRepository
} from "./financial-ledger-mysql-repository.js";
import type { GrowthFoundationServices } from "./growth-foundation-module.js";
import { assertGrowthTemporalBarrier } from "./growth-temporal-barrier.js";

export async function createGrowthFinanceMysql(input: {
  pool: mysql.Pool;
  foundation: GrowthFoundationServices;
}) {
  await ensureFinancialLedgerMysqlSchema(input.pool);
  assertGrowthTemporalBarrier(input.foundation.temporalBarrier);
  const repository = new MysqlFinancialLedgerRepository(input.pool);
  const sealedReader = new MysqlVerifiedFinancialLedgerSealedReader(input.pool);
  return Object.freeze({
    repository,
    costLedger: new AcquisitionCostLedgerService({
      repository,
      foundation: input.foundation
    }),
    sealedReader,
    verifiedLedgerAsOf: new VerifiedFinancialLedgerAsOfBoundary({
      foundation: input.foundation,
      sealedReader
    })
  });
}
