# SQLite Session Storage Design

Date: 2026-06-10

## Goal

Add SQLite-backed local persistence for Code Easy session metadata and event replay while preserving the existing `SessionStore` contract. The implementation should include a thin SQL storage adapter layer so a later PostgreSQL backend can reuse the session repository behavior without changing runtime code. This is the next storage slice after model provider and OpenAI tool calling work. LangGraph checkpoint persistence remains the immediate follow-up task, not part of this implementation slice.

## Scope

Included:

- Add a `SqliteSessionStore` in `packages/storage`.
- Add an internal SQL persistence boundary so SQLite-specific connection, migration, placeholder, and row conversion details do not leak into runtime code.
- Persist run starts, run completions, and typed event records in SQLite.
- Switch the runtime default store from JSONL files to SQLite at `.code-easy/local/code-easy.sqlite`.
- Keep `FileSessionStore` available for compatibility, fallback, and targeted tests.
- Preserve current CLI behavior for `run`, `sessions`, `resume`, and `tool`.
- Keep default local storage ignored by Git.

Excluded:

- LangGraph checkpoint adapter wiring.
- Migration from existing JSONL files.
- PostgreSQL implementation.
- Desktop-specific storage UI.
- Profiles, approvals, normalized chat messages, and model settings tables.

## Architecture

`packages/storage` remains the only package that writes local persistence files. Runtime and CLI code continue to depend on the `SessionStore` interface instead of directly using SQLite.

The storage package should use three layers:

1. Public runtime contract: `SessionStore`.
2. Shared SQL session repository: implements the session/event behavior once.
3. Database driver: owns SQLite-specific connection setup, schema migration, SQL execution, placeholder syntax, and row decoding.

The new SQLite-backed store implements the same methods as `FileSessionStore`:

- `recordRunStarted`
- `recordRunCompleted`
- `recordEvent`
- `listSessions`
- `listEvents`

`SqliteSessionStore` should be a small composition wrapper around the shared SQL repository and a SQLite driver. A future `PostgresSessionStore` should be able to provide a PostgreSQL driver to the same repository, with runtime still depending only on `SessionStore`.

`SessionManager` keeps accepting an injected `store` for tests and alternate embeddings. When no store is injected, it creates a `SqliteSessionStore` rooted at the workspace's `.code-easy/local` directory.

## Database Layout

The initial logical schema uses a compact shape aligned with the existing interface:

- `runs`: one row per started run, including `run_id`, `thread_id`, `workspace_root`, `prompt`, and `started_at`.
- `run_completions`: one row per completed or failed run, including `run_id`, `status`, `completed_at`, optional `summary`, and optional `error`.
- `events`: append-only event stream with an auto-increment `sequence`, `run_id`, `type`, and validated event JSON.

The SQLite driver creates the physical schema idempotently when the store opens. The SQL repository derives `StoredSessionSummary` by grouping runs by `thread_id`, preserving the current behavior where repeated `resume <threadId> <prompt>` calls appear as one session with multiple run ids.

The adapter layer should keep database-specific differences localized:

- SQLite uses local file paths, `INTEGER PRIMARY KEY AUTOINCREMENT`, and JSON stored as text.
- PostgreSQL can later use connection strings, `BIGSERIAL` or identity columns, and `jsonb`.
- Placeholder syntax, transactions, and date/string conversion belong inside the driver, not `SessionManager`.

The design reserves room for a future `checkpoints` table keyed by thread id, checkpoint namespace, checkpoint id, and parent checkpoint id, but this table is not required for the first implementation.

## Data Flow

For a run:

1. `SessionManager` creates a run id and thread id.
2. The store records the run start.
3. Published runtime events are captured and appended to `events`.
4. The store records completion or failure.
5. `resume` replays stored events by thread run ids in sequence order.

The runtime event stream remains the source used by CLI replay. SQLite only changes the durable backend.

## Error Handling

SQLite storage initialization creates the `.code-easy/local` directory and writes `.code-easy/.gitignore` with `*` when using the default local storage path.

Storage write failures should fail the current run rather than silently losing session state. Read failures from a corrupt or inaccessible database should surface to the caller. Missing databases are initialized automatically.

## Dependency Choice

Use a synchronous native SQLite package only if it integrates cleanly with the existing ESM TypeScript build and tests. If installation or native build support is not viable in the current environment, use a lightweight async SQLite package with explicit open/close handling. The implementation plan must verify the chosen dependency before code changes rely on it.

The adapter layer should avoid introducing a full ORM in this slice. The goal is a narrow driver interface around the operations the current session store needs, not a broad database abstraction.

## Testing

Tests should cover:

- SQLite store persistence for run metadata and event replay.
- Shared SQL repository behavior through the SQLite driver.
- Session listing order and completion details.
- Multiple runs grouped into one thread summary.
- Default `.code-easy/local` storage ignored by Git status.
- `SessionManager` default store path using SQLite without breaking injected stores.

Run the full project verification after implementation:

- `pnpm test`
- `pnpm typecheck`
- `git diff --check`

## Follow-Up

The next storage task after this slice is a LangGraph checkpoint adapter backed by the same SQLite database. That task should introduce a dedicated checkpoint interface or adapter rather than expanding `SessionStore` with graph-specific methods.
