# Code Easy Agent Handoff

## Current Goal

Build Code Easy into a Claude Code-like local coding agent. The current priority is the shared capability layer: runtime, model providers, tools, approvals, persistence, and event protocol. CLI remains the proving ground. Desktop/client work starts after these capabilities are stable.

## Read These First

1. `docs/PROGRESS.md` - current status, latest completed work, and next actionable step.
2. `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md` - capability roadmap and milestone task list.
3. `docs/superpowers/plans/2026-06-12-langchain-chatmodel-provider-adapter.md` - focused M1.2 implementation plan.
4. `docs/superpowers/specs/2026-05-26-code-easy-agent-design.md` - original architecture and product direction.

## Current Baseline

Implemented:

- TypeScript pnpm monorepo with `apps/cli` and shared packages.
- CLI commands: interactive `code-easy`, `run`, `sessions`, `resume`, and `tool`.
- Project-local `.code-easy/config.json` model settings.
- OpenAI Responses and Anthropic Messages model providers.
- Provider-neutral `ModelProvider` runtime boundary.
- Read-only model tool calling for `git_status`, `list_files`, `rg_search`, and `read_file`.
- Tool registry for read/search/Git/patch/command execution tools.
- Permission classification and approval event emission.
- SQLite-backed run and event persistence.
- Shared runtime command and event schemas.
- M1.1 cleanup: interactive debug output removed, large tool output bounded, and uppercase model ids rejected with a clearer config error.

Known gaps:

- The graph in `packages/agent-core/src/graph.ts` is still a placeholder.
- `SessionManager.run()` still owns most orchestration directly.
- Model-directed writes and shell commands are not supported yet.
- Approval interrupt/resume is incomplete.
- Resume is event replay plus new runs, not checkpoint-based continuation.
- Workspace context loading is shallow.
- CLI output is still noisy and line-oriented.
- Desktop client does not exist yet.

## Next Task

Execute `docs/superpowers/plans/2026-06-12-langchain-chatmodel-provider-adapter.md` task by task.

Direction:

- Keep Code Easy's internal `ModelProvider` boundary.
- Use LangChain provider packages, starting with `@langchain/openai`, underneath that boundary where possible.
- Do not move all orchestration into a LangGraph prebuilt agent yet; Code Easy still needs custom events, permissions, approvals, storage, and client protocol behavior.

Expected task-level flow:

1. Install `@langchain/openai` for `@code-easy/runtime`.
2. Write failing fake-model adapter tests.
3. Implement the smallest passing adapter.
4. Add config switching with tests.
5. Run focused tests, `pnpm typecheck`, `pnpm test`, `git diff --check`, and the secret scan.
6. Update `docs/PROGRESS.md`.

## Execution Rules

- Do not start desktop/client work until the runtime can reliably plan, edit, approve, verify, persist, and resume from the CLI.
- Keep CLI and future desktop behavior behind shared runtime APIs and `packages/ui-protocol`.
- Every side effect must go through tool schemas, permission checks, event emission, and persistence where applicable.
- Do not commit secrets. `.code-easy/config.json` is local-only and ignored.
- Prefer small, verified capability slices over broad refactors.
