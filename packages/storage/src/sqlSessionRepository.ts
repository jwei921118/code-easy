import { AgentEventSchema, type AgentEvent } from "@code-easy/ui-protocol";
import type { SqlDriver, SqlRow } from "./sqlDriver.js";
import type {
  RunCompletedRecord,
  RunStartedRecord,
  SessionStore,
  StoredEventRecord,
  StoredSessionSummary
} from "./types.js";

type RunRow = SqlRow & {
  run_id: string;
  thread_id: string;
  workspace_root: string;
  prompt: string;
  started_at: string;
  status: "completed" | "failed" | null;
  completed_at: string | null;
  summary: string | null;
  error: string | null;
};

type EventRow = SqlRow & {
  sequence: number;
  event_json: string;
};

export class SqlSessionRepository implements SessionStore {
  constructor(private readonly driver: SqlDriver) {}

  async recordRunStarted(record: RunStartedRecord): Promise<void> {
    this.driver.execute(
      "insert into runs (run_id, thread_id, workspace_root, prompt, started_at) values (?, ?, ?, ?, ?)",
      [record.runId, record.threadId, record.workspaceRoot, record.prompt, record.startedAt]
    );
  }

  async recordRunCompleted(record: RunCompletedRecord): Promise<void> {
    this.driver.execute(
      "insert into run_completions (run_id, status, completed_at, summary, error) values (?, ?, ?, ?, ?)",
      [record.runId, record.status, record.completedAt, record.summary ?? null, record.error ?? null]
    );
  }

  async recordEvent(event: AgentEvent): Promise<void> {
    const parsed = AgentEventSchema.parse(event);
    this.driver.execute("insert into events (run_id, type, event_json) values (?, ?, ?)", [
      parsed.runId,
      parsed.type,
      JSON.stringify(parsed)
    ]);
  }

  async listSessions(): Promise<StoredSessionSummary[]> {
    const rows = this.driver.query<RunRow>(`
      select
        runs.run_id,
        runs.thread_id,
        runs.workspace_root,
        runs.prompt,
        runs.started_at,
        run_completions.status,
        run_completions.completed_at,
        run_completions.summary,
        run_completions.error
      from runs
      left join run_completions on run_completions.run_id = runs.run_id
      order by runs.started_at asc
    `);
    const byThreadId = new Map<string, StoredSessionSummary>();

    for (const row of rows) {
      const existing = byThreadId.get(row.thread_id);
      const completion =
        row.completed_at === null
          ? {}
          : {
              completedAt: row.completed_at,
              ...(row.summary !== null ? { summary: row.summary } : {}),
              ...(row.error !== null ? { error: row.error } : {})
            };
      const status = row.status ?? "started";

      byThreadId.set(row.thread_id, {
        runId: row.run_id,
        runIds: [...(existing?.runIds ?? []), row.run_id],
        runCount: (existing?.runCount ?? 0) + 1,
        threadId: row.thread_id,
        workspaceRoot: row.workspace_root,
        prompt: row.prompt,
        status,
        startedAt: existing?.startedAt ?? row.started_at,
        lastUpdatedAt: row.completed_at ?? row.started_at,
        ...completion
      });
    }

    return [...byThreadId.values()].sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
  }

  async listEvents(runId?: string): Promise<StoredEventRecord[]> {
    const rows =
      runId === undefined
        ? this.driver.query<EventRow>("select sequence, event_json from events order by sequence asc")
        : this.driver.query<EventRow>("select sequence, event_json from events where run_id = ? order by sequence asc", [
            runId
          ]);

    return rows.map((row) => ({
      sequence: row.sequence,
      event: AgentEventSchema.parse(JSON.parse(row.event_json))
    }));
  }
}
