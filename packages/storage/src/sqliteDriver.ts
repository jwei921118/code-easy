import Database from "better-sqlite3";
import type { SqlDriver, SqlParams, SqlRow } from "./sqlDriver.js";

export class SqliteDriver implements SqlDriver {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
  }

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

  execute(sql: string, params: SqlParams = []): void {
    this.database.prepare(sql).run(...params);
  }

  query<T extends SqlRow = SqlRow>(sql: string, params: SqlParams = []): T[] {
    return this.database.prepare(sql).all(...params) as T[];
  }

  queryOne<T extends SqlRow = SqlRow>(sql: string, params: SqlParams = []): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined;
  }

  transaction<T>(action: () => T): T {
    return this.database.transaction(action)();
  }

  close(): void {
    this.database.close();
  }
}
