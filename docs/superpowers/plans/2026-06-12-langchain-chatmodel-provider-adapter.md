# LangChain ChatModel Provider Adapter Implementation Plan

> **For agentic workers:** This plan has been executed. The runtime provider surface was simplified after implementation, so the current source of truth is this completed summary plus `docs/PROGRESS.md`.

**Goal:** Use LangChain provider packages underneath Code Easy's provider-neutral runtime boundary.

**Architecture:** Code Easy keeps its own `ModelProvider` contract for runtime events, tools, approvals, persistence, CLI, and future desktop clients. The concrete OpenAI-compatible model call path now goes through `@langchain/openai` and `packages/runtime/src/langchainChatModelProvider.ts`. Legacy hand-written OpenAI Responses and Anthropic Messages-compatible providers were removed to keep the runtime provider surface small.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, `@langchain/core`, `@langchain/openai`.

---

## Final Provider Surface

Supported runtime model config:

```json
{
  "CODE_EASY_MODEL_PROVIDER": "openai",
  "CODE_EASY_AUTH_TOKEN": "your_token_here",
  "CODE_EASY_BASE_URL": "https://api.example.com/v1",
  "CODE_EASY_MODEL": "gpt-5.5"
}
```

Runtime behavior:

- `CODE_EASY_MODEL_PROVIDER=openai` creates `langchain-openai-chat`.
- `CODE_EASY_AUTH_TOKEN`, `CODE_EASY_API_KEY`, or `OPENAI_API_KEY` can provide the API key.
- `CODE_EASY_BASE_URL` points at OpenAI-compatible gateways.
- `CODE_EASY_MODEL` is passed as the LangChain `ChatOpenAI` model.
- No `CODE_EASY_OPENAI_API_KIND` switch remains.
- No Anthropic-prefixed fallback remains.

## Completed Tasks

- [x] Added `@langchain/openai` to `@code-easy/runtime`.
- [x] Added `packages/runtime/src/langchainChatModelProvider.ts`.
- [x] Added fake-model tests in `packages/runtime/src/langchainChatModelProvider.test.ts`.
- [x] Converted Code Easy system/user messages to LangChain `SystemMessage` and `HumanMessage`.
- [x] Converted Code Easy tool results to LangChain `ToolMessage`.
- [x] Bound provider-neutral tools through LangChain `bindTools()`.
- [x] Converted LangChain `AIMessage.tool_calls` to Code Easy `ModelToolCall`.
- [x] Wired `createModelProviderFromConfig()` to return `langchain-openai-chat` for OpenAI-compatible config.
- [x] Removed the raw OpenAI Responses provider and tests.
- [x] Removed the Anthropic Messages-compatible provider and tests.
- [x] Reduced `.code-easy/config.example.json` to the settings currently read by runtime.
- [x] Updated `AGENT.md`, `docs/PROGRESS.md`, and the capability roadmap.

## Verification

- `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts langchainChatModelProvider.test.ts` passed.
- `pnpm --filter @code-easy/runtime typecheck` passed.
- `pnpm typecheck` passed before cleanup; rerun after cleanup before merge.
- `pnpm test` passed before cleanup; rerun after cleanup before merge.
- `git diff --check` passed before cleanup; rerun after cleanup before merge.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets before cleanup; rerun after cleanup before merge.

## Next

- Run full verification after cleanup.
- Merge `codex/langchain-chatmodel-adapter` into `main`.
- Start M1.3: expand model tool calls to write tools behind approval.
