import type mysql from "mysql2/promise";
import {
  InMemoryAcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import {
  InMemoryAcquisitionDouyinCommentEventRepository
} from "./acquisition-douyin-comment-events.js";
import {
  MysqlAcquisitionDouyinCommentEventRepository
} from "./acquisition-douyin-comment-events-mysql-repository.js";
import {
  MysqlAcquisitionDomainRepository
} from "./acquisition-mysql-repositories.js";
import {
  InMemoryAcquisitionCandidateDirectory,
  MysqlAcquisitionCandidateDirectory
} from "./acquisition-tool-support-repositories.js";

export interface AcquisitionDouyinCommentIngestionUnitOfWork {
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export class InMemoryAcquisitionDouyinCommentIngestionUnitOfWork
implements AcquisitionDouyinCommentIngestionUnitOfWork {
  constructor(
    private readonly domain: InMemoryAcquisitionDomainRepository,
    private readonly events: InMemoryAcquisitionDouyinCommentEventRepository,
    private readonly directory: InMemoryAcquisitionCandidateDirectory
  ) {}

  transaction<T>(work: () => Promise<T>) {
    return this.domain.transaction(() =>
      this.events.transaction(() => this.directory.transaction(work)));
  }
}

export class MysqlAcquisitionDouyinCommentIngestionUnitOfWork
implements AcquisitionDouyinCommentIngestionUnitOfWork {
  constructor(
    private readonly pool: mysql.Pool,
    private readonly domain: MysqlAcquisitionDomainRepository,
    private readonly events: MysqlAcquisitionDouyinCommentEventRepository,
    private readonly directory: MysqlAcquisitionCandidateDirectory
  ) {}

  async transaction<T>(work: () => Promise<T>) {
    const connection = await this.pool.getConnection();
    try {
      return await this.directory.withTransactionConnection(
        connection,
        () => this.domain.withTransactionConnection(connection, async () => {
          try {
            await connection.beginTransaction();
            const result = await this.events.withTransactionConnection(
              connection,
              work
            );
            await connection.commit();
            return result;
          } catch (error) {
            await connection.rollback();
            throw error;
          }
        })
      );
    } finally {
      connection.release();
    }
  }
}
