# Code Easy Capability Roadmap And Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: For each implementation task selected from this roadmap, first create a focused task plan with `superpowers:writing-plans`, then implement with `superpowers:test-driven-development` and verify with `superpowers:verification-before-completion`. This roadmap is the capability backlog; it is not a substitute for task-level TDD plans.

**Goal:** Build Code Easy into a Claude Code-like local coding agent, with the shared runtime capability layer completed before desktop/client work.

**Architecture:** The runtime remains the product core. CLI, future desktop, and any other client consume the same typed commands, event stream, session store, tool registry, model providers, and approval workflow. Client work starts only after the runtime can plan, edit, execute, verify, persist, and resume reliably from the CLI.

**Tech Stack:** TypeScript, Node.js, pnpm workspaces, Vitest, LangGraph, LangChain provider packages, SQLite, Zod, commander, OpenAI-compatible APIs, Anthropic-compatible APIs, future Electron + React desktop.

---

## Current Baseline

### Implemented

- CLI entrypoint in `apps/cli/src/index.ts`.
- Interactive `code-easy` readline loop.
- One-shot `code-easy run`.
- `sessions`, `resume`, and direct `tool` commands.
- Project-local model config through `.code-easy/config.json`.
- OpenAI Responses provider in `packages/runtime/src/openaiResponsesProvider.ts`.
- Anthropic Messages provider in `packages/runtime/src/anthropicMessagesProvider.ts`.
- Provider-neutral runtime boundary in `packages/runtime/src/modelProvider.ts`.
- Runtime event bus and session manager in `packages/runtime/src/sessionManager.ts`.
- Read-only model tool calling for `git_status`, `list_files`, `rg_search`, and `read_file`.
- Tool registry for `read_file`, `list_files`, `rg_search`, `git_status`, `apply_patch`, and `run_command`.
- Permission classification in `packages/permissions/src/risks.ts`.
- SQLite-backed run and event persistence in `packages/storage`.
- Shared event and command schemas in `packages/ui-protocol`.

### Current Gaps

- `packages/agent-core/src/graph.ts` is still a minimal placeholder graph.
- `SessionManager.run()` owns most orchestration directly instead of using a real plan/act/observe/verify graph.
- Model-directed tools are read-only; the model cannot yet request `apply_patch` or `run_command`.
- Approval requests can be emitted, but full agent interrupt/resume around approvals is not implemented.
- Resume replays events and starts a new run; it is not checkpoint-based continuation.
- Workspace context is shallow: Git status, file list, simple search pattern.
- CLI output is line-based and noisy; tool output is not folded or diff-aware.
- Desktop client does not exist yet.
- There are known cleanup items in current CLI output, including debug logging in the interactive loop.

---

## Milestone M1: Reliable CLI Coding Agent

**Outcome:** `code-easy` can inspect a project, plan a small code change, request approval for writes or commands, apply patches, run verification, and summarize the result from the CLI.

### Task M1.1: Clean Current CLI And Config Surface

**Purpose:** Remove sharp edges before adding more agent behavior.

**Files:**

- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`
- Modify: `packages/runtime/src/modelConfig.ts`
- Modify: `packages/runtime/src/modelConfig.test.ts`
- Modify: `.code-easy/config.example.json`

**Work:**

- [x] Remove interactive debug output such as `threadId ====>`.
- [x] Make `renderEvent()` avoid dumping large raw tool outputs by default.
- [x] Add concise model config error messages that never include tokens.
- [x] Add a config validation test for lower-case model IDs when provider models are case-sensitive.
- [x] Keep `.code-easy/config.json` ignored and keep only safe example values in Git.

**Acceptance:**

- [x] `printf '1+1?\n:q\n' | code-easy --no-model` exits cleanly.
- [x] `pnpm --filter @code-easy/cli test -- index.test.ts` passes.
- [x] `rg "sk-[A-Za-z0-9]{10,}" .` does not find committed secrets.

### Task M1.2: Introduce LangChain ChatModel Provider Adapter

**Purpose:** Stop hand-writing every provider transport. Keep Code Easy's internal `ModelProvider` boundary, but implement provider calls through LangChain chat model integrations where they fit, starting with `@langchain/openai` for OpenAI-compatible gateways.

**Files:**

- Create: `packages/runtime/src/langchainChatModelProvider.ts`
- Create: `packages/runtime/src/langchainChatModelProvider.test.ts`
- Modify: `packages/runtime/src/modelConfig.ts`
- Modify: `packages/runtime/src/modelConfig.test.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.code-easy/config.example.json`

**Work:**

- [x] Add `@langchain/openai` as the first provider package.
- [x] Add a `BaseChatModel`-backed adapter that implements Code Easy's `ModelProvider`.
- [x] Convert provider-neutral messages and tool definitions to LangChain messages and bindable tools.
- [x] Convert LangChain `AIMessage.content` and `tool_calls` back to `GenerateTextResult`.
- [x] Send tool results as LangChain `ToolMessage` instances.
- [x] Add a config switch for OpenAI API mode: current raw `responses` provider vs LangChain chat model provider.
- [x] Preserve the raw Responses provider temporarily until the LangChain adapter proves equivalent for Code Easy's runtime needs.

**Acceptance:**

- [x] Unit tests cover message conversion, text extraction, tool call extraction, and tool result follow-up using a fake chat model.
- [x] A local config can switch providers without changing CLI code.
- [x] `pnpm --filter @code-easy/runtime test -- langchainChatModelProvider.test.ts modelConfig.test.ts` passes.
- [x] `pnpm typecheck` passes.

### Task M1.3: Expand Model Tool Calls To Write Tools Behind Approval

**Purpose:** Let the model request code edits while preserving explicit user approval.

**Files:**

- Modify: `packages/runtime/src/modelToolSchemas.ts`
- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`
- Modify: `packages/tools/src/applyPatchTool.ts`
- Modify: `packages/tools/src/applyPatchTool.test.ts`
- Modify: `packages/ui-protocol/src/events.ts`

**Work:**

- [ ] Add `apply_patch` to model-callable tools with strict schema.
- [ ] Keep `run_command` unavailable to the model until approval continuation works.
- [ ] When model requests `apply_patch`, emit `approval.requested` instead of throwing.
- [ ] Preserve pending model tool call state so approved execution can resume.
- [ ] Emit `diff.ready` before or after patch execution so clients can render the edit.

**Acceptance:**

- [ ] Model-requested `apply_patch` produces approval instead of executing immediately.
- [ ] Approved patch execution emits `approval.resolved`, `tool.started`, `tool.completed`, and final model response.
- [ ] Denied patch execution produces a useful model-visible denial result.
- [ ] Existing direct `code-easy tool apply_patch ... --yes` still works.

### Task M1.4: Implement Approval Continue Flow

**Purpose:** Make approval a runtime command, not a one-off CLI prompt.

**Files:**

- Modify: `packages/ui-protocol/src/commands.ts`
- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/toolExecutor.ts`
- Modify: `packages/storage/src/types.ts`
- Modify: `packages/storage/src/sqlSessionRepository.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`

**Work:**

- [ ] Store pending approval records with run id, thread id, tool name, input, and model call id.
- [ ] Add `SessionManager.approve()` or a runtime command handler for `ApproveCommand`.
- [ ] Let CLI prompt approve/deny during interactive runs.
- [ ] Let non-interactive command output include the approval id and stop cleanly.
- [ ] Persist approval decisions for session replay.

**Acceptance:**

- [ ] Agent run pauses on write approval and exits with a clear pending state in non-interactive mode.
- [ ] Interactive CLI can approve and continue the same run.
- [ ] `code-easy resume <threadId>` can replay approval events.

### Task M1.5: Add Basic Plan / Act / Observe / Verify Loop

**Purpose:** Move orchestration out of fixed context gathering and toward agent execution.

**Files:**

- Modify: `packages/agent-core/src/state.ts`
- Modify: `packages/agent-core/src/graph.ts`
- Modify: `packages/agent-core/src/graph.test.ts`
- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`
- Modify: `packages/ui-protocol/src/events.ts`

**Work:**

- [ ] Add plan state with step id, title, status, and evidence.
- [ ] Emit plan events or structured message events clients can render.
- [ ] Route model outputs through a loop: plan, tool call, observation, next decision, final response.
- [ ] Add a bounded max round count and clear failure error when exceeded.
- [ ] Add a verification decision before final response when files changed.

**Acceptance:**

- [ ] A small code edit can be planned, patched, optionally verified, and summarized.
- [ ] Runtime tests cover successful completion, max-round failure, and verification-needed branch.

### Task M1.6: Improve Workspace Context Loading

**Purpose:** Give the model enough local project context without relying on a fragile search-pattern heuristic.

**Files:**

- Create: `packages/runtime/src/workspaceContext.ts`
- Create: `packages/runtime/src/workspaceContext.test.ts`
- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/modelProvider.ts`

**Work:**

- [ ] Load `package.json`, workspace package names, and scripts.
- [ ] Load `README.md` when present and bounded.
- [ ] Load `tsconfig.json`, `pnpm-workspace.yaml`, and nearby project metadata.
- [ ] Load local instruction files: `AGENTS.md`, `CODE_EASY.md`, `.code-easy/instructions.md`.
- [ ] Summarize context into provider-neutral model messages.

**Acceptance:**

- [ ] Context tests cover missing files, bounded reads, and instruction precedence.
- [ ] `SessionManager.run()` no longer depends on `extractSearchPattern()` as the main context strategy.

---

## Milestone M2: Persistence, Recovery, And Long-Running Work

**Outcome:** Code Easy can pause, resume, replay, cancel, and recover agent runs with durable state.

### Task M2.1: Add SQLite Checkpoint Adapter

**Files:**

- Create: `packages/storage/src/checkpointStore.ts`
- Create: `packages/storage/src/sqlCheckpointRepository.ts`
- Create: `packages/storage/src/sqliteCheckpointStore.test.ts`
- Modify: `packages/storage/src/sqliteDriver.ts`
- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/agent-core/src/graph.ts`

**Acceptance:**

- [ ] LangGraph checkpoints are persisted in `.code-easy/local/code-easy.sqlite`.
- [ ] A run interrupted for approval can resume without rebuilding all transient state from scratch.

### Task M2.2: Add Cancellation And Timeout Semantics

**Files:**

- Modify: `packages/ui-protocol/src/commands.ts`
- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/tools/src/runCommandTool.ts`
- Modify: `apps/cli/src/index.ts`

**Acceptance:**

- [ ] `CancelCommand` is implemented instead of only being a schema.
- [ ] Long shell commands can be cancelled.
- [ ] Cancelled runs emit `run.failed` with category `cancelled`.

### Task M2.3: Add Session Memory And Compaction

**Files:**

- Create: `packages/runtime/src/sessionMemory.ts`
- Create: `packages/runtime/src/sessionMemory.test.ts`
- Modify: `packages/storage/src/types.ts`
- Modify: `packages/storage/src/sqlSessionRepository.ts`
- Modify: `packages/runtime/src/sessionManager.ts`

**Acceptance:**

- [ ] Follow-up prompts include relevant previous messages and tool outcomes.
- [ ] Long sessions are compacted into a bounded summary.
- [ ] Compaction output is persisted and replayable.

---

## Milestone M3: Extension Layer

**Outcome:** Code Easy supports project rules, user profiles, skills, and external tools without hard-coding them into clients.

### Task M3.1: Project And User Rules

**Files:**

- Create: `packages/runtime/src/instructions.ts`
- Create: `packages/runtime/src/instructions.test.ts`
- Modify: `.code-easy/config.example.json`
- Modify: `packages/runtime/src/modelProvider.ts`

**Acceptance:**

- [ ] Instruction files are loaded in a deterministic order.
- [ ] Project instructions override broad defaults without leaking secrets.

### Task M3.2: Profiles And Model Aliases

**Files:**

- Create: `packages/runtime/src/profileConfig.ts`
- Create: `packages/runtime/src/profileConfig.test.ts`
- Modify: `packages/runtime/src/modelConfig.ts`
- Modify: `apps/cli/src/index.ts`

**Acceptance:**

- [ ] Users can select profiles such as `fast`, `balanced`, and `deep`.
- [ ] Profiles map to provider/model/reasoning settings.

### Task M3.3: MCP Tool Registry

**Files:**

- Create: `packages/runtime/src/mcpRegistry.ts`
- Create: `packages/tools/src/mcpCallTool.ts`
- Modify: `packages/runtime/src/toolRegistry.ts`
- Modify: `packages/permissions/src/risks.ts`

**Acceptance:**

- [ ] MCP tools are discoverable from config.
- [ ] MCP side effects require approval unless explicitly allowed.

### Task M3.4: Browser Verification Tools

**Files:**

- Create: `packages/tools/src/browserTools.ts`
- Modify: `packages/runtime/src/toolRegistry.ts`
- Modify: `packages/permissions/src/risks.ts`

**Acceptance:**

- [ ] Agent can open local URLs, inspect snapshots, and capture screenshots through approved external tools.
- [ ] Browser tools are optional and disabled when no browser backend is configured.

---

## Milestone M4: Client Readiness And Desktop

**Outcome:** Desktop is a renderer over the same runtime capabilities, not a separate agent implementation.

### Task M4.1: Stabilize Client Protocol

**Files:**

- Modify: `packages/ui-protocol/src/events.ts`
- Modify: `packages/ui-protocol/src/commands.ts`
- Create: `packages/ui-protocol/src/reducer.ts`
- Create: `packages/ui-protocol/src/reducer.test.ts`

**Acceptance:**

- [ ] Event replay can reconstruct a session view model.
- [ ] CLI and desktop can use the same reducer output.

### Task M4.2: Runtime Host API

**Files:**

- Create: `packages/runtime/src/runtimeHost.ts`
- Create: `packages/runtime/src/runtimeHost.test.ts`
- Modify: `apps/cli/src/index.ts`

**Acceptance:**

- [ ] Clients can send typed commands and subscribe to typed events through one API.
- [ ] CLI no longer manually wires individual `SessionManager` methods for every command.

### Task M4.3: Desktop Shell

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src/main/*`
- Create: `apps/desktop/src/preload/*`
- Create: `apps/desktop/src/renderer/*`
- Modify: `pnpm-workspace.yaml`

**Acceptance:**

- [ ] Desktop can list sessions, start a run, render event streams, and show approval dialogs.
- [ ] Renderer has no direct access to tools or workspace filesystem.

---

## Recommended Immediate Execution Order

1. M1.1 - Clean current CLI and config surface.
2. M1.2 - Add OpenAI Chat Completions provider for third-party gateways.
3. M1.3 - Add model-requested `apply_patch` behind approval.
4. M1.4 - Implement approval continue flow.
5. M1.5 - Add basic plan/act/observe/verify loop.
6. M1.6 - Improve workspace context loading.
7. M2.1 - Add SQLite checkpoint adapter.

This order keeps the product usable after each task. It also ensures the desktop client waits until the runtime has stable behaviors worth rendering.

## Execution Rule

Before implementing any task above:

1. Create a focused implementation plan in `docs/superpowers/plans/YYYY-MM-DD-<task-name>.md`.
2. Write failing tests first.
3. Implement the smallest change that passes those tests.
4. Run focused verification.
5. Run `pnpm typecheck` and the relevant test suite.
6. Update `docs/PROGRESS.md`.
