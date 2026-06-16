# Code Easy Agent Handoff

## Current Goal

Build Code Easy into a Claude Code-like local coding agent. The current priority is the shared capability layer: runtime, model providers, tools, approvals, persistence, and event protocol. CLI remains the proving ground. Desktop/client work starts after these capabilities are stable.

## Read These First

1. `docs/PROGRESS.md` - current status, latest completed work, and next actionable step.
2. `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md` - capability roadmap and milestone task list.
3. `docs/superpowers/plans/2026-06-16-approval-continue-flow.md` - focused M1.4 implementation plan.
4. `docs/superpowers/plans/2026-06-16-model-apply-patch-approval.md` - focused M1.3 implementation plan.
5. `docs/superpowers/plans/2026-06-12-langchain-chatmodel-provider-adapter.md` - focused M1.2 implementation summary.
6. `docs/superpowers/specs/2026-05-26-code-easy-agent-design.md` - original architecture and product direction.

## Current Baseline

Implemented:

- TypeScript pnpm monorepo with `apps/cli` and shared packages.
- CLI commands: interactive `code-easy`, `run`, `sessions`, `resume`, and `tool`.
- CLI command: `approve <approvalId> --yes/--no` for stored pending model approvals.
- Same-process approval prompts for TTY `run` and interactive chat flows.
- Project-local `.code-easy/config.json` model settings.
- Provider-neutral `ModelProvider` runtime boundary.
- LangChain ChatModel adapter with `@langchain/openai` for OpenAI-compatible chat gateways.
- Read-only model tool calling for `git_status`, `list_files`, `rg_search`, and `read_file`.
- Built-in fallback search when `rg_search` cannot find a local `ripgrep` binary.
- Model-requested `apply_patch` behind runtime approval.
- Durable pending approval records in session storage.
- Tool registry for read/search/Git/patch/command execution tools.
- Permission classification and approval event emission.
- SQLite-backed run and event persistence.
- Shared runtime command and event schemas.
- M1.1 cleanup: interactive debug output removed, large tool output bounded, and uppercase model ids rejected with a clearer config error.
- M1.5 Chinese purpose comments on core methods across CLI/runtime/storage/tools/protocol/agent-core.

Known gaps:

- The graph in `packages/agent-core/src/graph.ts` is still a placeholder.
- `SessionManager.run()` still owns most orchestration directly.
- Model-directed shell commands are not supported yet.
- Resume is event replay plus new runs, not checkpoint-based continuation.
- Workspace context loading is shallow.
- CLI output is still noisy and line-oriented.
- Desktop client does not exist yet.

## Next Task

Start `M1.6: Add Basic Plan / Act / Observe / Verify Loop` from `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md`.

M1.5 is complete: the core code now has concise Chinese purpose comments on exported functions, classes, public methods, and non-trivial private helpers. Continue with the next behavior slice:

1. Move orchestration out of the current fixed context-gathering path.
2. Introduce explicit plan, act, observe, and verify phases in the runtime/graph boundary.
3. Keep tool calls, approvals, persistence, and UI events flowing through the existing shared APIs.
4. Preserve current CLI behavior while adding the new loop incrementally.
5. Verify with focused runtime tests first, then full `pnpm typecheck` and `pnpm test`.

## Execution Rules

- Do not start desktop/client work until the runtime can reliably plan, edit, approve, verify, persist, and resume from the CLI.
- Keep CLI and future desktop behavior behind shared runtime APIs and `packages/ui-protocol`.
- Every side effect must go through tool schemas, permission checks, event emission, and persistence where applicable.
- Do not commit secrets. `.code-easy/config.json` is local-only and ignored.
- Prefer small, verified capability slices over broad refactors.
