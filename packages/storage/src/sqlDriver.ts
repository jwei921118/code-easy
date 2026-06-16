export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];
export type SqlRow = Record<string, SqlValue>;

/** 抽象 SQL 能力，隔离 repository 与具体数据库实现。 */
export interface SqlDriver {
  /** 准备数据库 schema。 */
  migrate(): void;
  /** 执行写入或 DDL 语句。 */
  execute(sql: string, params?: SqlParams): void;
  /** 查询多行结果。 */
  query<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): T[];
  /** 查询单行结果。 */
  queryOne<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): T | undefined;
  /** 在事务中执行操作。 */
  transaction<T>(action: () => T): T;
  /** 释放底层连接。 */
  close(): void;
}
