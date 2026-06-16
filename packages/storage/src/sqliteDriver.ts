import Database from "better-sqlite3";
import type { SqlDriver, SqlParams, SqlRow } from "./sqlDriver.js";

/** 对 better-sqlite3 的薄封装，提供项目内部统一 SQL driver 接口。 */
export class SqliteDriver implements SqlDriver {
  private readonly database: Database.Database;

  /** 打开数据库并设置外键和 WAL。 */
  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
  }

  /** 创建或更新会话存储所需的数据库表和索引。 */
  migrate(): void {
    this.database.exec(`
      create table if not exists runs (
        run_id text primary key,
        thread_id text not null,
        workspace_root text not null,
        prompt text not null,
        started_at text not null
      );

      create table if not exists run_completions (
        run_id text primary key references runs(run_id) on delete cascade,
        status text not null check (status in ('completed', 'failed')),
        completed_at text not null,
        summary text,
        error text
      );

      create table if not exists events (
        sequence integer primary key autoincrement,
        run_id text not null,
        type text not null,
        event_json text not null
      );

      create table if not exists pending_approvals (
        approval_id text primary key,
        run_id text not null,
        thread_id text not null,
        workspace_root text not null,
        call_json text not null,
        input_json text not null,
        messages_json text not null,
        tool_results_json text not null,
        next_round integer not null,
        created_at text not null
      );

      create index if not exists idx_runs_thread_started on runs(thread_id, started_at);
      create index if not exists idx_events_run_sequence on events(run_id, sequence);
      create index if not exists idx_pending_approvals_created on pending_approvals(created_at);
    `);
  }

  /** 执行不返回行的 SQL 语句。 */
  execute(sql: string, params: SqlParams = []): void {
    this.database.prepare(sql).run(...params);
  }

  /** 执行查询并返回所有结果行。 */
  query<T extends SqlRow = SqlRow>(sql: string, params: SqlParams = []): T[] {
    return this.database.prepare(sql).all(...params) as T[];
  }

  /** 执行查询并返回第一行结果。 */
  queryOne<T extends SqlRow = SqlRow>(sql: string, params: SqlParams = []): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined;
  }

  /** 在 SQLite 事务中执行一组同步数据库操作。 */
  transaction<T>(action: () => T): T {
    return this.database.transaction(action)();
  }

  /** 关闭底层数据库连接。 */
  close(): void {
    this.database.close();
  }
}
