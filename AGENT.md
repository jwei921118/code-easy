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
- Project-local `.code-easy/config.json` model settings.
- Provider-neutral `ModelProvider` runtime boundary.
- LangChain ChatModel adapter with `@langchain/openai` for OpenAI-compatible chat gateways.
- Read-only model tool calling for `git_status`, `list_files`, `rg_search`, and `read_file`.
- Model-requested `apply_patch` behind runtime approval.
- Durable pending approval records in session storage.
- Tool registry for read/search/Git/patch/command execution tools.
- Permission classification and approval event emission.
- SQLite-backed run and event persistence.
- Shared runtime command and event schemas.
- M1.1 cleanup: interactive debug output removed, large tool output bounded, and uppercase model ids rejected with a clearer config error.

Known gaps:

- The graph in `packages/agent-core/src/graph.ts` is still a placeholder.
- `SessionManager.run()` still owns most orchestration directly.
- Same-process CLI model-approval prompts are not implemented yet.
- Model-directed shell commands are not supported yet.
- Resume is event replay plus new runs, not checkpoint-based continuation.
- Workspace context loading is shallow.
- CLI output is still noisy and line-oriented.
- Desktop client does not exist yet.

## Next Task

Continue `M1.4: Implement Approval Continue Flow` from `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md`.

The stored approval continue path is implemented. The next small slice is same-process interactive prompting:

1. When `code-easy run` pauses with `approval_required` and stdin is interactive, prompt approve/deny and call `SessionManager.approve()` in the same process.
2. Do the same carefully for the interactive chat loop without fighting the readline prompt.
3. Keep non-interactive behavior as a clean pause with an approval id and `code-easy approve` instructions.
4. Keep `run_command` unavailable to model-directed calls until execute approval and sandbox policy are designed.
5. Preserve the M1.3 tests for pause, no pre-approval write, approved continuation, and denied continuation.

## Execution Rules

- Do not start desktop/client work until the runtime can reliably plan, edit, approve, verify, persist, and resume from the CLI.
- Keep CLI and future desktop behavior behind shared runtime APIs and `packages/ui-protocol`.
- Every side effect must go through tool schemas, permission checks, event emission, and persistence where applicable.
- Do not commit secrets. `.code-easy/config.json` is local-only and ignored.
- Prefer small, verified capability slices over broad refactors.
