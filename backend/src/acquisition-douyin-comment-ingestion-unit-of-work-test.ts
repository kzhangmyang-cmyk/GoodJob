import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import type {
  MysqlAcquisitionDouyinCommentEventRepository
} from "./acquisition-douyin-comment-events-mysql-repository.js";
import {
  MysqlAcquisitionDouyinCommentIngestionUnitOfWork
} from "./acquisition-douyin-comment-ingestion-unit-of-work.js";
import type {
  MysqlAcquisitionDomainRepository
} from "./acquisition-mysql-repositories.js";
import type {
  MysqlAcquisitionCandidateDirectory
} from "./acquisition-tool-support-repositories.js";

function mysqlUnitOfWorkHarness() {
  const lifecycle: string[] = [];
  const connection = {
    async beginTransaction() { lifecycle.push("begin"); },
    async commit() { lifecycle.push("commit"); },
    async rollback() { lifecycle.push("rollback"); },
    release() { lifecycle.push("release"); }
  } as unknown as mysql.PoolConnection;
  const pool = {
    async getConnection() {
      lifecycle.push("acquire");
      return connection;
    }
  } as unknown as mysql.Pool;
  const domain = {
    async withTransactionConnection(
      selected: mysql.PoolConnection,
      work: () => Promise<unknown>
    ) {
      assert.equal(selected, connection);
      lifecycle.push("domain");
      return work();
    }
  } as MysqlAcquisitionDomainRepository;
  const events = {
    async withTransactionConnection(
      selected: mysql.PoolConnection,
      work: () => Promise<unknown>
    ) {
      assert.equal(selected, connection);
      lifecycle.push("events");
      return work();
    }
  } as MysqlAcquisitionDouyinCommentEventRepository;
  const directory = {
    async withTransactionConnection(
      selected: mysql.PoolConnection,
      work: () => Promise<unknown>
    ) {
      assert.equal(selected, connection);
      lifecycle.push("directory");
      return work();
    }
  } as MysqlAcquisitionCandidateDirectory;
  return {
    lifecycle,
    unitOfWork: new MysqlAcquisitionDouyinCommentIngestionUnitOfWork(
      pool,
      domain,
      events,
      directory
    )
  };
}

test("mysql comment ingestion uses one connection and commits once", async () => {
  const { lifecycle, unitOfWork } = mysqlUnitOfWorkHarness();
  assert.equal(await unitOfWork.transaction(async () => {
    lifecycle.push("work");
    return "done";
  }), "done");
  assert.deepEqual(lifecycle, [
    "acquire",
    "directory",
    "domain",
    "begin",
    "events",
    "work",
    "commit",
    "release"
  ]);
});

test("mysql comment ingestion rolls the shared connection back on either side", async () => {
  const { lifecycle, unitOfWork } = mysqlUnitOfWorkHarness();
  await assert.rejects(
    unitOfWork.transaction(async () => {
      lifecycle.push("work");
      throw new Error("commit side failed");
    }),
    /commit side failed/u
  );
  assert.deepEqual(lifecycle, [
    "acquire",
    "directory",
    "domain",
    "begin",
    "events",
    "work",
    "rollback",
    "release"
  ]);
});
