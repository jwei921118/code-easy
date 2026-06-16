# Code Easy Progress

Last updated: 2026-06-16

## Purpose

This document is the project's working progress log. Update it after every completed task so the current state, verification result, and next step stay visible without reading Git history or old chat context.

## Update Rules

After each task:

1. Update `Last updated`.
2. Refresh `Current Snapshot` if scope, status, or verification changed.
3. Add one entry to `Task Log` with the completed work and verification.
4. Move the next actionable item to the top of `Next Steps`.
5. Keep completed implementation details short; link to code or docs when more context is needed.

## Current Snapshot

Status: M1.4 approval continuation is implemented. The project has a working CLI/runtime foundation with read-only model tool calling, SQLite event persistence, project-local model config, a LangChain OpenAI-compatible provider path, model-requested `apply_patch` approval, stored pending approvals, `code-easy approve <approvalId> --yes/--no`, and same-process interactive approval prompts for TTY runs.

Branch: `codex/approval-continue-flow`

Working tree: clean at last check after the M1.4 cleanup/review commit.

Verification:

- `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts modelToolSchemas.test.ts` passed on 2026-06-16.
- `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts` passed on 2026-06-16.
- `pnpm --filter @code-easy/storage test -- sqliteSessionStore.test.ts` passed on 2026-06-16.
- `pnpm --filter @code-easy/cli test -- index.test.ts` passed on 2026-06-16.
- `pnpm --filter @code-easy/cli test -- approvalFlow.test.ts index.test.ts` passed on 2026-06-16.
- `pnpm --filter @code-easy/tools test -- applyPatchTool.test.ts` passed on 2026-06-16.
- `pnpm --filter @code-easy/ui-protocol test -- events.test.ts` passed on 2026-06-16.
- `pnpm --filter @code-easy/runtime typecheck` passed on 2026-06-16.
- `pnpm typecheck` passed on 2026-06-16.
- `pnpm test` passed on 2026-06-16.
- `pnpm --filter @code-easy/cli test -- index.test.ts` passed on 2026-06-12.
- `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts` passed on 2026-06-12.
- `pnpm --filter @code-easy/runtime test -- langchainChatModelProvider.test.ts modelConfig.test.ts` passed on 2026-06-12.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets on 2026-06-16.
- `git diff --check` passed on 2026-06-16.
- `git diff --check -- docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md` passed on 2026-06-12.

Primary references:

- `AGENT.md` - short agent handoff, current goal, and execution rules.
- `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md` - current capability roadmap and milestone task list.
- `docs/superpowers/plans/2026-06-16-model-apply-patch-approval.md` - focused M1.3 implementation plan.
- `docs/superpowers/plans/2026-06-12-langchain-chatmodel-provider-adapter.md` - focused M1.2 implementation plan.
- `docs/superpowers/specs/2026-05-26-code-easy-agent-design.md` - original product and architecture direction.

Implemented:

- TypeScript pnpm monorepo foundation.
- Shared UI protocol schemas for runtime commands and agent events.
- Permission risk classification and approval handling.
- Tool system with file read, file listing, ripgrep search, Git status, patch, and command execution tools.
- Minimal LangGraph agent core.
- Runtime session manager, event bus, tool registry, permissioned executor, and local session/event persistence.
- SQLite-backed session/event persistence with an internal SQL driver boundary.
- CLI commands for `run`, `sessions`, `resume`, and `tool`.
- Interactive `code-easy` command-line chat loop.
- Optional model provider path for `code-easy run`, with deterministic offline fallback.
- Model tool calling for read-only workspace tools.
- Project-local `.code-easy/config.json` settings using `CODE_EASY_*` keys.
- M1.1 CLI/config cleanup: debug output removed, large tool output bounded, and uppercase model ids rejected with a clear case-sensitivity error.
- M1.2 LangChain ChatModel adapter with `@langchain/openai` for OpenAI-compatible chat gateways.
- M1.3 model-requested `apply_patch` behind in-memory runtime approval, with `diff.ready`, `run.paused`, approved continuation, and denied continuation.
- M1.4 durable pending approval records and CLI `approve <approvalId> --yes/--no` continuation command.
- M1.4 same-process interactive approval prompt for TTY `run` and chat flows.

Known gap:

- There is no `.planning/` GSD project state yet, so phase-level progress is tracked here and in `docs/superpowers/` until a GSD project is initialized.
- `packages/agent-core/src/graph.ts` is still a placeholder graph.
- Checkpoint-based resume and richer workspace context are not implemented yet.

## Task Log

### 2026-06-16 - Review M1.4 approval continuation cleanup

Completed:

- Removed unused `listPendingApprovals()` public API from the storage boundary and implementations.
- Made internal pending approval model subtypes and CLI approval-flow helper types non-exported.
- Fixed approval continuation so a missing model provider fails before any approved patch is executed.
- Added a regression test proving `approve()` does not write files when model continuation is impossible.

Verification:

- `pnpm --filter @code-easy/storage test -- sqliteSessionStore.test.ts` passed.
- `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts` passed.
- `pnpm --filter @code-easy/cli test -- approvalFlow.test.ts index.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `git diff --check` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.

Next:

- Start M1.5: move orchestration toward a plan / act / observe / verify loop.

### 2026-06-16 - Add durable approval continue flow

Completed:

- Added pending approval persistence to the `SessionStore` boundary.
- Added SQLite and file-store pending approval implementations.
- Stored model-requested `apply_patch` pending state before returning `approval_required`.
- Let a fresh `SessionManager` restore a stored pending approval and continue approved or denied decisions.
- Added `code-easy approve <approvalId> --yes/--no`.
- Rendered approval ids, diff previews, and paused-run continuation hints in CLI output.
- Added `docs/superpowers/plans/2026-06-16-approval-continue-flow.md`.

Verification:

- `pnpm --filter @code-easy/storage test -- sqliteSessionStore.test.ts` passed.
- `pnpm --filter @code-easy/storage typecheck` passed.
- `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts` passed.
- `pnpm --filter @code-easy/cli test -- index.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `git diff --check` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.

Next:

- Continue with the same-process interactive prompt work recorded in the next entry.

### 2026-06-16 - Add same-process interactive approval prompts

Completed:

- Added a CLI approval-flow helper for continuing `approval_required` runs after prompting.
- Wired `code-easy run` to prompt and continue in the same process when stdin is a TTY.
- Wired the interactive `code-easy>` chat loop to prompt and continue with the same `SessionManager`.
- Preserved non-TTY behavior: output approval id and continue instructions without blocking for input.

Verification:

- `pnpm --filter @code-easy/cli test -- approvalFlow.test.ts index.test.ts` passed.
- `pnpm --filter @code-easy/cli typecheck` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `git diff --check` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.

Next:

- Start M1.5: move orchestration toward a plan / act / observe / verify loop.

### 2026-06-16 - Add model-requested apply patch approval gate

Completed:

- Added `apply_patch` to the model-callable tool allowlist while keeping `run_command` unavailable.
- Emitted `diff.ready`, `approval.requested`, and `run.paused` for model-requested patches.
- Paused model runs before write execution and kept pending approval state in memory.
- Added runtime approval continuation through `SessionManager.approve()` for approved and denied decisions.
- Preserved approval ids so `approval.resolved` matches the original request.
- Added tests for pause, no pre-approval write, approved continuation, denied continuation, blocked `run_command`, and direct tool approval id reuse.

Verification:

- `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts modelToolSchemas.test.ts` passed.
- `pnpm --filter @code-easy/runtime typecheck` passed.
- `pnpm --filter @code-easy/ui-protocol test -- events.test.ts` passed.
- `pnpm --filter @code-easy/tools test -- applyPatchTool.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `git diff --check` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.
- Spec review approved M1.3 coverage and scope.
- Code quality review approved after fixing multi-replacement previews, pre-approval schema validation, and duplicate approved diff events.

Next:

- Start M1.4 after merge: durable approval records, CLI approval prompts for model-requested patches, and replayable approval continuation.

### 2026-06-16 - Plan M1.3 model-requested apply patch approval

Completed:

- Added `docs/superpowers/plans/2026-06-16-model-apply-patch-approval.md`.
- Scoped M1.3 to runtime capability: model-requested `apply_patch`, `diff.ready`, `approval.requested`, `run.paused`, and in-memory `SessionManager.approve()` continuation.
- Kept durable approval storage, CLI approval prompts, and replayable approval continuation in M1.4.
- Captured tests for pre-approval no-write behavior, approved continuation, denied continuation, and keeping `run_command` unavailable to the model.

Verification:

- Documentation-only change.
- `git diff --check -- docs/superpowers/plans/2026-06-16-model-apply-patch-approval.md docs/PROGRESS.md AGENT.md` passed.

Next:

- Execute `docs/superpowers/plans/2026-06-16-model-apply-patch-approval.md` task by task.
- Start with `run.paused` event schema tests, then add `apply_patch` to model-callable tools.

### 2026-06-12 - Remove legacy raw provider code

Completed:

- Removed the hand-written OpenAI Responses provider and tests.
- Removed the Anthropic Messages-compatible provider and tests.
- Simplified model config so `CODE_EASY_MODEL_PROVIDER=openai` always uses the LangChain ChatModel adapter.
- Removed the no-longer-needed `CODE_EASY_OPENAI_API_KIND` example/config surface.
- Reduced `.code-easy/config.example.json` to the settings currently read by runtime.

Verification:

- `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts langchainChatModelProvider.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `git diff --check` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.

Next:

- Commit the cleanup, then merge `codex/langchain-chatmodel-adapter` into `main`.

### 2026-06-12 - Add LangChain ChatModel provider adapter

Completed:

- Added `@langchain/openai` as the first LangChain provider package used by runtime.
- Added `createLangChainChatModelProvider()` for converting Code Easy messages, tools, and tool results to LangChain chat model calls.
- Added `createOpenAIChatModelProvider()` for OpenAI-compatible chat gateways.
- Wired OpenAI-compatible config to the LangChain ChatModel adapter.
- Updated safe example config for OpenAI-compatible chat mode.

Verification:

- `pnpm --filter @code-easy/runtime test -- langchainChatModelProvider.test.ts modelConfig.test.ts` passed.
- `pnpm --filter @code-easy/runtime typecheck` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `git diff --check` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.

Next:

- Start M1.3: expand model tool calls to write tools behind approval.
- Legacy raw providers were removed in the follow-up cleanup task.

### 2026-06-12 - Plan M1.2 LangChain ChatModel provider adapter

Completed:

- Added `docs/superpowers/plans/2026-06-12-langchain-chatmodel-provider-adapter.md`.
- Captured the agreed design: keep Code Easy's `ModelProvider` boundary and use LangChain provider packages underneath it.
- Broke M1.2 into dependency installation, fake-model adapter tests, adapter implementation, config switching, docs updates, verification, and optional real gateway smoke testing.
- Initially planned an explicit OpenAI API mode switch; this was removed later when the provider surface was simplified to one LangChain OpenAI-compatible path.

Verification:

- Documentation-only change.
- `git diff --check -- docs/superpowers/plans/2026-06-12-langchain-chatmodel-provider-adapter.md docs/PROGRESS.md AGENT.md` passed.

Next:

- Execute `docs/superpowers/plans/2026-06-12-langchain-chatmodel-provider-adapter.md` task by task.
- Install `@langchain/openai` for `@code-easy/runtime` before writing adapter code.

### 2026-06-12 - Retarget M1.2 to LangChain ChatModel provider adapter

Completed:

- Reviewed the LangChain provider direction against the current Code Easy runtime boundary.
- Updated the capability roadmap so M1.2 introduces a LangChain `BaseChatModel` adapter instead of a hand-written OpenAI Chat Completions transport.
- Kept Code Easy's internal `ModelProvider` boundary as the stable runtime contract for tools, events, approvals, persistence, and future clients.

Verification:

- Documentation-only change. No code tests required.

Next:

- Create a focused implementation plan for M1.2 before editing runtime provider behavior.
- Start with `@langchain/openai` and fake-model adapter tests, then wire config once the adapter contract is passing.

### 2026-06-12 - Complete M1.1 CLI and config cleanup

Completed:

- Added `docs/superpowers/plans/2026-06-12-clean-cli-config-surface.md`.
- Removed the interactive `threadId ====>` debug output.
- Added bounded JSON rendering for large tool outputs in the CLI.
- Added tests for no debug output and large output truncation.
- Added model id case validation so uppercase configured model ids fail with a clear case-sensitivity message.
- Updated `.code-easy/config.example.json` to use lower-case model ids.
- Marked M1.1 complete in the capability roadmap.
- Updated `AGENT.md` so the next task is M1.2.

Verification:

- `pnpm --filter @code-easy/cli test -- index.test.ts` passed.
- `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.
- `git diff --check` passed.

Next:

- Start M1.2: introduce a LangChain ChatModel provider adapter for third-party OpenAI-compatible gateways.
- Create a focused implementation plan for M1.2 before editing runtime provider behavior.

### 2026-06-12 - Add capability roadmap and agent handoff

Completed:

- Added `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md`.
- Captured the current implemented capabilities and gaps.
- Split the product direction into M1-M4 milestones:
  - M1: reliable CLI coding agent.
  - M2: persistence, recovery, and long-running work.
  - M3: rules, profiles, MCP, and browser/tool extensions.
  - M4: client protocol and desktop shell.
- Added `AGENT.md` as the short handoff entry for future agents and sessions.
- Linked `AGENT.md`, the roadmap, and the original architecture spec from this progress document.

Verification:

- Documentation-only change.
- `git diff --check -- docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md` passed.

Next:

- Start M1.1: clean the current CLI and config surface.
- Create a focused implementation plan for M1.1 before editing runtime or CLI behavior.

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

### 2026-06-11 - Plan SQLite session storage

Completed:

- Added `docs/superpowers/plans/2026-06-11-sqlite-session-storage.md`.
- Planned the SQLite store implementation around a shared SQL repository and narrow database driver boundary.
- Included dependency verification, TDD steps, runtime default switch, final verification, and progress update tasks.

Verification:

- Documentation-only change. No code tests required.

Next:

- Execute the SQLite session storage plan task by task.

### 2026-06-10 - Design SQLite session storage

Completed:

- Selected SQLite-backed session/event storage as the next implementation slice.
- Added a SQL storage adapter layer requirement so a future PostgreSQL store can reuse repository behavior without changing runtime code.
- Scoped LangGraph checkpoint persistence as the immediate follow-up rather than part of this slice.
- Added `docs/superpowers/specs/2026-06-10-sqlite-session-storage-design.md`.

Verification:

- Documentation-only change. No code tests required.

Next:

- Review the design spec, then create the implementation plan for `SqliteSessionStore` and the runtime default store switch.

### 2026-06-10 - Add OpenAI native tool calling

Completed:

- Added provider-neutral model tool definition, call, and result types.
- Added strict read-only model tool schemas for `git_status`, `list_files`, `rg_search`, and `read_file`.
- Extended the OpenAI Responses provider to send `tools`, parse `function_call`, and send `function_call_output`.
- Added a bounded runtime loop for model-requested read tools.
- Kept write and execute tools unavailable to model-directed calls.

Verification:

- `pnpm test` passed.
- `pnpm typecheck` passed.

Next:

- Committed as `c4b0323`, then decide whether to add model-directed write tools behind approvals, SQLite/checkpoints, or a desktop shell.

### 2026-06-10 - Plan OpenAI native tool calling

Completed:

- Added an implementation plan for OpenAI Responses API native function calling.
- Scoped first implementation to read-only local tools with strict schemas and a bounded runtime loop.

Verification:

- Documentation-only change. No code tests required.

Next:

- Execute `docs/superpowers/plans/2026-06-10-openai-tool-calling.md` task by task.

### 2026-06-10 - Add model provider integration

Completed:

- Added runtime model provider types and prompt construction.
- Added model configuration loading and OpenAI Responses API provider support.
- Wired injected model providers into `SessionManager.run()` after deterministic workspace context gathering.
- Added CLI `--model` and `--no-model` controls for run/resume flows.
- Preserved deterministic offline behavior by default.

Verification:

- `pnpm test` passed.
- `pnpm typecheck` passed.

Next:

- Committed as `90ae2d6`, then decide whether to add model-driven tool calling or SQLite/LangGraph checkpoint persistence next.

### 2026-06-10 - Plan model provider integration

Completed:

- Added a model provider integration design spec.
- Added a task-by-task implementation plan for runtime provider types, OpenAI Responses API support, CLI controls, tests, and progress updates.
- Kept the plan scoped so default behavior remains offline and deterministic unless a provider is explicitly configured.

Verification:

- Documentation-only change. No code tests required.

Next:

- Execute `docs/superpowers/plans/2026-06-10-model-provider-integration.md` task by task.

### 2026-06-10 - Synchronize foundation plan status

Completed:

- Marked the foundation CLI/runtime implementation plan checklist as complete.
- Added a status note explaining that the implementation has advanced beyond the original foundation slice.
- Removed the stale progress gap about unchecked foundation plan items.

Verification:

- Confirmed no unchecked checklist items remain in `docs/superpowers/plans/2026-05-26-foundation-cli-runtime.md`.
- Documentation-only change. No code tests required.

Next:

- Plan the next implementation milestone. Recommended direction: add real model/provider integration so `code-easy run` can move beyond deterministic workspace inspection.

### 2026-06-10 - Add progress tracking document

Completed:

- Added `docs/PROGRESS.md` as the project progress source of truth.
- Captured the current implementation snapshot, verification status, update rules, and next steps.

Verification:

- Documentation-only change. No code tests required.

Next:

- Decide the next implementation direction and update this document after the task is done.

### 2026-06-10 - Verify current project progress

Completed:

- Confirmed the project has no `.planning/` directory.
- Reviewed existing design and foundation plan docs.
- Checked implemented packages and recent Git history.
- Ran build-backed test and typecheck workflows.

Verification:

- `pnpm test` passed.
- `pnpm typecheck` passed.

Next:

- Create this progress document so future task completion has a durable update target.

## Next Steps

1. Execute `docs/superpowers/plans/2026-06-16-model-apply-patch-approval.md` task by task.
2. Start with `run.paused` event schema tests and `apply_patch` model tool schema tests.
3. After M1.3 lands, plan M1.4 durable approval continue flow.
