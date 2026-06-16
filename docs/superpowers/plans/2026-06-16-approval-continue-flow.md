# Approval Continue Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a model-requested `apply_patch` approval survive the paused `run` process and continue later through a runtime/CLI approval command.

**Architecture:** Persist pending model approval state in the existing `SessionStore` boundary. `SessionManager.run()` records pending approval state before returning `approval_required`; `SessionManager.approve()` first checks memory, then loads pending state from storage and continues the saved model loop. CLI exposes `code-easy approve <approvalId> --yes/--no` as the first client path.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Zod event schemas, existing SQLite/File session stores, Commander CLI.

---

## Scope Boundary

This phase implements:

- Durable pending approval records for model-requested `apply_patch`.
- Runtime approval continuation after creating a new `SessionManager` instance.
- CLI `approve` command for approving or denying a pending model patch.
- Better CLI rendering for approval ids, diff previews, and paused runs.

This phase does not implement:

- Model-directed `run_command`.
- Multi-approval UI policy, remembered approvals, or session-wide allow rules.
- Desktop client UX.
- Full LangGraph checkpoint migration.

## File Structure

- Modify `packages/storage/src/types.ts`
  - Add `PendingApprovalRecord` and required `SessionStore` methods.
- Modify `packages/storage/src/sqliteDriver.ts`
  - Add `pending_approvals` table.
- Modify `packages/storage/src/sqlSessionRepository.ts`
  - Persist, load, delete, and list pending approvals.
- Modify `packages/storage/src/sqliteSessionStore.ts`
  - Delegate pending approval methods.
- Modify `packages/storage/src/fileSessionStore.ts`
  - Persist pending approvals for tests and non-SQL store compatibility.
- Modify `packages/storage/src/sqliteSessionStore.test.ts`
  - Cover pending approval persistence and deletion.
- Modify `packages/runtime/src/sessionManager.ts`
  - Store pending approvals during pause and restore them in `approve()`.
- Modify `packages/runtime/src/sessionManager.test.ts`
  - Cover approving and denying after constructing a new manager with the same store.
- Modify `apps/cli/src/index.ts`
  - Add `approve` command and render approval ids, diffs, and paused runs.
- Modify `apps/cli/src/index.test.ts`
  - Cover `approve` command validation and rendering.
- Modify `docs/PROGRESS.md`, `AGENT.md`, and the roadmap.

## Tasks

### Task 1: Persist Pending Approvals In Storage

- [ ] Add failing storage tests for recording, loading, deleting, and listing a pending approval.
- [ ] Add `PendingApprovalRecord` and `SessionStore` methods.
- [ ] Add SQLite table and repository implementation.
- [ ] Add file-store compatibility implementation.
- [ ] Run `pnpm --filter @code-easy/storage test -- sqliteSessionStore.test.ts`.

### Task 2: Restore Pending Approvals In Runtime

- [ ] Add failing runtime tests showing a new `SessionManager` can approve and deny a stored pending approval.
- [ ] Persist pending approval state before `approval.requested` is emitted.
- [ ] Load pending approval state from storage when memory does not contain it.
- [ ] Delete resolved pending approval records after terminal approve/deny continuation.
- [ ] Run `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts`.

### Task 3: Add CLI Approval Command

- [ ] Add failing CLI tests for `approve <approvalId> --yes/--no` option validation and output rendering.
- [ ] Add `code-easy approve <approvalId>` command.
- [ ] Render approval ids in `approval.requested`, render `diff.ready`, and render `run.paused`.
- [ ] Run `pnpm --filter @code-easy/cli test -- index.test.ts`.

### Task 4: Documentation And Verification

- [ ] Mark M1.4 storage/runtime/CLI approval continue flow as implemented in the roadmap.
- [ ] Update `docs/PROGRESS.md` and `AGENT.md`.
- [ ] Run focused tests for storage, runtime, and CLI.
- [ ] Run `pnpm typecheck`, `pnpm test`, `git diff --check`, and `rg "sk-[A-Za-z0-9]{10,}" .`.

## Self-Review

- Spec coverage: The plan covers durable pending approvals, runtime restore, CLI approval command, and documentation.
- Scope boundary: Model-directed shell execution and desktop UX remain out of scope.
- Type consistency: The plan uses `PendingApprovalRecord`, `approvalId`, `SessionStore`, and `SessionManager.approve()` consistently.
