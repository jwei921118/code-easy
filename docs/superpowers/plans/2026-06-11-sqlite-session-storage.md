# SQLite Session Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite-backed session/event persistence with an internal SQL adapter layer that can later support PostgreSQL without changing runtime code.

**Architecture:** `SessionManager` continues to depend only on `SessionStore`. `packages/storage` gains a shared SQL session repository plus a narrow database driver interface; SQLite is the first driver. The JSONL `FileSessionStore` remains available, while the runtime default changes to SQLite at `.code-easy/local/code-easy.sqlite`.

**Tech Stack:** TypeScript, Vitest, `better-sqlite3`, existing `SessionStore`, existing `AgentEventSchema`.

---

## File Structure

- Modify: `packages/storage/package.json` - add SQLite runtime and type dependencies.
- Create: `packages/storage/src/localStorage.ts` - shared helper that creates `.code-easy/local` and keeps it ignored by Git.
- Modify: `packages/storage/src/fileSessionStore.ts` - reuse `ensureLocalStorageRoot()` instead of private default-storage ignore logic.
- Create: `packages/storage/src/sqlDriver.ts` - internal SQL driver interface using logical `?` placeholders.
- Create: `packages/storage/src/sqliteDriver.ts` - `better-sqlite3` implementation and SQLite schema creation.
- Create: `packages/storage/src/sqlSessionRepository.ts` - shared `SessionStore` implementation over the SQL driver.
- Create: `packages/storage/src/sqliteSessionStore.ts` - public SQLite store wrapper.
- Create: `packages/storage/src/sqliteSessionStore.test.ts` - SQLite persistence behavior tests.
- Modify: `packages/storage/src/index.ts` - export `SqliteSessionStore`.
- Modify: `packages/runtime/src/sessionManager.ts` - change default store from `FileSessionStore` to `SqliteSessionStore`.
- Modify: `packages/runtime/src/sessionManager.test.ts` - cover default SQLite persistence and keep injected-store behavior.
- Modify: `docs/PROGRESS.md` - append implementation-plan status and next step.

### Task 1: Verify SQLite Dependency and Shared Local Storage Helper

**Files:**

- Modify: `packages/storage/package.json`
- Create: `packages/storage/src/localStorage.ts`
- Modify: `packages/storage/src/fileSessionStore.ts`
- Modify: `packages/storage/src/fileSessionStore.test.ts`

- [x] **Step 1: Verify `node:sqlite` is unavailable in the current runtime**

Run:

```bash
node -e "try { require('node:sqlite'); console.log('node:sqlite available'); } catch (error) { console.log(error.code); process.exit(1); }"
```

Expected: FAIL with `ERR_UNKNOWN_BUILTIN_MODULE` in the current Node v23 environment. Continue with `better-sqlite3`.

- [x] **Step 2: Add SQLite dependency**

Run:

```bash
pnpm --filter @code-easy/storage add better-sqlite3
pnpm --filter @code-easy/storage add -D @types/better-sqlite3
```

Expected: `packages/storage/package.json` and `pnpm-lock.yaml` update successfully.

- [x] **Step 3: Write a failing helper reuse test**

Extend `packages/storage/src/fileSessionStore.test.ts` with this test:

```ts
it("creates default local storage through the shared helper", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-store-helper-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  const store = new FileSessionStore(path.join(workspaceRoot, ".code-easy", "local"));

  await store.recordRunStarted({
    runId: "run-1",
    threadId: "thread-1",
    workspaceRoot,
    prompt: "Use helper",
    startedAt: "2026-06-11T00:00:00.000Z"
  });

  const ignore = await readFile(path.join(workspaceRoot, ".code-easy", ".gitignore"), "utf8");
  expect(ignore.split(/\r?\n/)).toContain("*");
});
```

- [x] **Step 4: Run the helper test to verify current behavior**

Run:

```bash
pnpm --filter @code-easy/storage test -- fileSessionStore.test.ts
```

Expected: PASS before refactor. This locks current behavior before moving the helper.

- [x] **Step 5: Create shared local storage helper**

Create `packages/storage/src/localStorage.ts`:

```ts
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureLocalStorageRoot(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });

  const codeEasyRoot = path.dirname(rootPath);
  if (path.basename(rootPath) !== "local" || path.basename(codeEasyRoot) !== ".code-easy") return;

  const ignorePath = path.join(codeEasyRoot, ".gitignore");
  const current = await readFileIfExists(ignorePath);
  if (current.split(/\r?\n/).includes("*")) return;

  await writeFile(ignorePath, `${current}${current.length > 0 && !current.endsWith("\n") ? "\n" : ""}*\n`, "utf8");
}

export async function readFileIfExists(filePath: string): Promise<string> {
  try {
    await stat(filePath);
    return readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}
```

- [x] **Step 6: Reuse helper in `FileSessionStore`**

In `packages/storage/src/fileSessionStore.ts`, change imports:

```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEventSchema, type AgentEvent } from "@code-easy/ui-protocol";
import { ensureLocalStorageRoot, readFileIfExists } from "./localStorage.js";
```

Replace the private `ensureRoot()` method body with:

```ts
private async ensureRoot(): Promise<void> {
  await ensureLocalStorageRoot(this.rootPath);
}
```

Delete the private `readFileIfExists()` function at the bottom of `fileSessionStore.ts`; it now comes from `localStorage.ts`.

- [x] **Step 7: Run storage tests**

Run:

```bash
pnpm --filter @code-easy/storage test -- fileSessionStore.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit dependency and helper refactor**

Run:

```bash
git add packages/storage/package.json pnpm-lock.yaml packages/storage/src/localStorage.ts packages/storage/src/fileSessionStore.ts packages/storage/src/fileSessionStore.test.ts
git commit -m "chore: add sqlite dependency and storage helper"
```

### Task 2: Add SQL Driver Boundary and SQLite Driver

**Files:**

- Create: `packages/storage/src/sqlDriver.ts`
- Create: `packages/storage/src/sqliteDriver.ts`
- Create: `packages/storage/src/sqliteDriver.test.ts`

- [ ] **Step 1: Write failing SQLite driver tests**

Create `packages/storage/src/sqliteDriver.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteDriver } from "./sqliteDriver.js";

describe("SqliteDriver", () => {
  it("creates the session schema and executes parameterized queries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-driver-"));
    const driver = new SqliteDriver(path.join(root, "code-easy.sqlite"));

    try {
      driver.migrate();
      driver.execute(
        "insert into runs (run_id, thread_id, workspace_root, prompt, started_at) values (?, ?, ?, ?, ?)",
        ["run-1", "thread-1", "/workspace", "Inspect", "2026-06-11T00:00:00.000Z"]
      );

      expect(
        driver.queryOne<{ run_id: string; prompt: string }>("select run_id, prompt from runs where run_id = ?", [
          "run-1"
        ])
      ).toEqual({
        run_id: "run-1",
        prompt: "Inspect"
      });
    } finally {
      driver.close();
    }
  });

  it("rolls back failed transactions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-driver-"));
    const driver = new SqliteDriver(path.join(root, "code-easy.sqlite"));

    try {
      driver.migrate();
      expect(() =>
        driver.transaction(() => {
          driver.execute(
            "insert into runs (run_id, thread_id, workspace_root, prompt, started_at) values (?, ?, ?, ?, ?)",
            ["run-1", "thread-1", "/workspace", "Inspect", "2026-06-11T00:00:00.000Z"]
          );
          throw new Error("fail");
        })
      ).toThrow("fail");

      expect(driver.query("select run_id from runs")).toEqual([]);
    } finally {
      driver.close();
    }
  });
});
```

- [ ] **Step 2: Run driver tests to verify failure**

Run:

```bash
pnpm --filter @code-easy/storage test -- sqliteDriver.test.ts
```

Expected: FAIL because `sqliteDriver.ts` does not exist.

- [ ] **Step 3: Add SQL driver interface**

Create `packages/storage/src/sqlDriver.ts`:

```ts
export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];
export type SqlRow = Record<string, SqlValue>;

export interface SqlDriver {
  migrate(): void;
  execute(sql: string, params?: SqlParams): void;
  query<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): T[];
  queryOne<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): T | undefined;
  transaction<T>(action: () => T): T;
  close(): void;
}
```

- [ ] **Step 4: Add SQLite driver implementation**

Create `packages/storage/src/sqliteDriver.ts`:

```ts
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

      create index if not exists idx_runs_thread_started on runs(thread_id, started_at);
      create index if not exists idx_events_run_sequence on events(run_id, sequence);
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
```

- [ ] **Step 5: Run driver tests**

Run:

```bash
pnpm --filter @code-easy/storage test -- sqliteDriver.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit driver boundary**

Run:

```bash
git add packages/storage/src/sqlDriver.ts packages/storage/src/sqliteDriver.ts packages/storage/src/sqliteDriver.test.ts
git commit -m "feat: add sqlite sql driver"
```

### Task 3: Add Shared SQL Session Repository and SQLite Store

**Files:**

- Create: `packages/storage/src/sqlSessionRepository.ts`
- Create: `packages/storage/src/sqliteSessionStore.ts`
- Create: `packages/storage/src/sqliteSessionStore.test.ts`
- Modify: `packages/storage/src/index.ts`

- [ ] **Step 1: Write failing SQLite session store tests**

Create `packages/storage/src/sqliteSessionStore.test.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SqliteSessionStore } from "./sqliteSessionStore.js";

const execFileAsync = promisify(execFile);

describe("SqliteSessionStore", () => {
  it("persists run metadata and events for replay", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-store-"));
    const store = await SqliteSessionStore.open(root);

    await store.recordRunStarted({
      runId: "run-1",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "Inspect the project",
      startedAt: "2026-06-11T00:00:00.000Z"
    });
    await store.recordEvent({ type: "run.started", runId: "run-1", threadId: "thread-1" });
    await store.recordEvent({ type: "run.completed", runId: "run-1", summary: "Completed." });
    await store.recordRunCompleted({
      runId: "run-1",
      status: "completed",
      completedAt: "2026-06-11T00:00:01.000Z",
      summary: "Completed."
    });

    await expect(store.listEvents("run-1")).resolves.toEqual([
      { sequence: 1, event: { type: "run.started", runId: "run-1", threadId: "thread-1" } },
      { sequence: 2, event: { type: "run.completed", runId: "run-1", summary: "Completed." } }
    ]);
  });

  it("lists grouped sessions newest first", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-store-"));
    const store = await SqliteSessionStore.open(root);

    await store.recordRunStarted({
      runId: "run-1",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "First task",
      startedAt: "2026-06-11T00:00:00.000Z"
    });
    await store.recordRunCompleted({
      runId: "run-1",
      status: "completed",
      completedAt: "2026-06-11T00:00:01.000Z",
      summary: "First done."
    });
    await store.recordRunStarted({
      runId: "run-2",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "Followup task",
      startedAt: "2026-06-11T00:02:00.000Z"
    });
    await store.recordRunCompleted({
      runId: "run-2",
      status: "completed",
      completedAt: "2026-06-11T00:02:01.000Z",
      summary: "Followup done."
    });

    await expect(store.listSessions()).resolves.toEqual([
      {
        runId: "run-2",
        runIds: ["run-1", "run-2"],
        runCount: 2,
        threadId: "thread-1",
        workspaceRoot: "/workspace",
        prompt: "Followup task",
        status: "completed",
        startedAt: "2026-06-11T00:00:00.000Z",
        lastUpdatedAt: "2026-06-11T00:02:01.000Z",
        completedAt: "2026-06-11T00:02:01.000Z",
        summary: "Followup done."
      }
    ]);
  });

  it("keeps default .code-easy local SQLite storage out of git status", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-git-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    const store = await SqliteSessionStore.open(path.join(workspaceRoot, ".code-easy", "local"));

    await store.recordEvent({ type: "run.completed", runId: "run-1", summary: "Completed." });

    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: workspaceRoot });
    expect(stdout).toBe("");
  });
});
```

- [ ] **Step 2: Run store tests to verify failure**

Run:

```bash
pnpm --filter @code-easy/storage test -- sqliteSessionStore.test.ts
```

Expected: FAIL because `sqliteSessionStore.ts` does not exist.

- [ ] **Step 3: Add SQL session repository**

Create `packages/storage/src/sqlSessionRepository.ts`:

```ts
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
```

- [ ] **Step 4: Add SQLite session store wrapper**

Create `packages/storage/src/sqliteSessionStore.ts`:

```ts
import path from "node:path";
import { ensureLocalStorageRoot } from "./localStorage.js";
import { SqliteDriver } from "./sqliteDriver.js";
import { SqlSessionRepository } from "./sqlSessionRepository.js";
import type { SessionStore } from "./types.js";

export class SqliteSessionStore implements SessionStore {
  private constructor(private readonly repository: SqlSessionRepository) {}

  static async open(rootPath: string): Promise<SqliteSessionStore> {
    await ensureLocalStorageRoot(rootPath);
    const driver = new SqliteDriver(path.join(rootPath, "code-easy.sqlite"));
    driver.migrate();
    return new SqliteSessionStore(new SqlSessionRepository(driver));
  }

  recordRunStarted: SessionStore["recordRunStarted"] = (record) => this.repository.recordRunStarted(record);
  recordRunCompleted: SessionStore["recordRunCompleted"] = (record) => this.repository.recordRunCompleted(record);
  recordEvent: SessionStore["recordEvent"] = (event) => this.repository.recordEvent(event);
  listSessions: SessionStore["listSessions"] = () => this.repository.listSessions();
  listEvents: SessionStore["listEvents"] = (runId) => this.repository.listEvents(runId);
}
```

- [ ] **Step 5: Export SQLite store**

Update `packages/storage/src/index.ts`:

```ts
export * from "./fileSessionStore.js";
export * from "./sqliteSessionStore.js";
export * from "./types.js";
```

- [ ] **Step 6: Run SQLite store tests**

Run:

```bash
pnpm --filter @code-easy/storage test -- sqliteSessionStore.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run all storage tests**

Run:

```bash
pnpm --filter @code-easy/storage test
```

Expected: PASS.

- [ ] **Step 8: Commit SQL repository and SQLite store**

Run:

```bash
git add packages/storage/src/sqlSessionRepository.ts packages/storage/src/sqliteSessionStore.ts packages/storage/src/sqliteSessionStore.test.ts packages/storage/src/index.ts
git commit -m "feat: add sqlite session store"
```

### Task 4: Switch Runtime Default Store to SQLite

**Files:**

- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`

- [ ] **Step 1: Write failing runtime default-store test**

Append to `packages/runtime/src/sessionManager.test.ts`:

```ts
it("uses SQLite session storage by default", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-default-sqlite-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await writeFile(path.join(workspaceRoot, "README.md"), "Default sqlite context\n", "utf8");
  const manager = new SessionManager();

  const result = await manager.run({
    kind: "run",
    workspaceRoot,
    prompt: "Find sqlite"
  });

  const resumed = await manager.resume({
    workspaceRoot,
    threadId: result.threadId
  });

  expect(resumed).toMatchObject({
    threadId: result.threadId,
    status: "completed",
    summary: "Workspace inspection completed."
  });

  const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: workspaceRoot });
  expect(stdout).toBe("");
});
```

- [ ] **Step 2: Run runtime test to verify failure or current JSONL behavior**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: FAIL until `SessionManager` awaits the async SQLite default store creation, or PASS only if the implementation was already updated by an earlier task. Continue with the code change.

- [ ] **Step 3: Switch default store creation to SQLite**

Update imports in `packages/runtime/src/sessionManager.ts`:

```ts
import { SqliteSessionStore, type SessionStore, type StoredSessionSummary } from "@code-easy/storage";
```

Change `getStore()` to async and use SQLite:

```ts
private async getStore(workspaceRoot: string): Promise<SessionStore | undefined> {
  if (this.configuredStore === false) return undefined;
  if (this.configuredStore) return this.configuredStore;
  return SqliteSessionStore.open(path.join(workspaceRoot, ".code-easy", "local"));
}
```

Update call sites in `run()`, `runTool()`, `listSessions()`, and `resume()` from:

```ts
const store = this.getStore(command.workspaceRoot);
```

to:

```ts
const store = await this.getStore(command.workspaceRoot);
```

For `listSessions()`, return:

```ts
return (await (await this.getStore(command.workspaceRoot))?.listSessions()) ?? [];
```

- [ ] **Step 4: Run runtime tests**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run storage and runtime tests together**

Run:

```bash
pnpm --filter @code-easy/storage test
pnpm --filter @code-easy/runtime test
```

Expected: PASS.

- [ ] **Step 6: Commit runtime default switch**

Run:

```bash
git add packages/runtime/src/sessionManager.ts packages/runtime/src/sessionManager.test.ts
git commit -m "feat: use sqlite session storage by default"
```

### Task 5: Final Verification and Progress Update

**Files:**

- Modify: `docs/PROGRESS.md`
- Modify: `docs/superpowers/plans/2026-06-11-sqlite-session-storage.md`

- [ ] **Step 1: Mark completed plan checkboxes**

As each task completes, change its checkbox from `- [ ]` to `- [x]` in this plan. At this final step, all implementation steps should be checked.

- [ ] **Step 2: Update progress document**

Add a new top `Task Log` entry to `docs/PROGRESS.md`:

```md
### 2026-06-11 - Add SQLite session storage

Completed:

- Added SQLite-backed session/event persistence through an internal SQL driver boundary.
- Kept `SessionStore` as the runtime contract and preserved `FileSessionStore`.
- Switched the runtime default store to `.code-easy/local/code-easy.sqlite`.
- Preserved `sessions` and `resume` behavior over the new backend.

Verification:

- `pnpm test` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.

Next:

- Design and implement the LangGraph checkpoint adapter backed by the same SQLite database.
```

Update the `Current Snapshot` status and `Next Steps` to point to LangGraph checkpoint adapter work.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit final docs update**

Run:

```bash
git add docs/PROGRESS.md docs/superpowers/plans/2026-06-11-sqlite-session-storage.md
git commit -m "docs: update progress after sqlite session storage"
```
