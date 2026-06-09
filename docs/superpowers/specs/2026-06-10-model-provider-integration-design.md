# Model Provider Integration Design

Date: 2026-06-10

## Goal

Let `code-easy run` produce a real model-written answer from gathered workspace context while preserving the current deterministic, offline behavior when no provider is configured.

## Current State

`SessionManager.run()` currently executes a small deterministic loop:

- invokes the minimal LangGraph intake node,
- runs `git_status`, `list_files`, and `rg_search`,
- summarizes those tool outputs,
- appends the fixed graph message `Runtime initialized.`,
- emits `run.completed` with `Workspace inspection completed.`

This is useful for smoke testing and session persistence, but it is not yet an agent response.

## Approach

Add a small model provider boundary inside `packages/runtime`. The runtime already owns side effects, environment access, and event emission, so provider setup belongs there rather than in `apps/cli` or `packages/agent-core`.

The default runtime remains offline. If no provider is configured, all existing CLI and runtime behavior should remain unchanged. Tests should inject fake providers instead of calling network APIs.

The first real provider should call OpenAI's Responses API with `model` and `input`. OpenAI's current API reference documents `POST /v1/responses` for creating model responses, and the text generation guide shows `client.responses.create({ model, input })` as the direct text-generation path. This project can use Node's built-in `fetch` instead of adding an SDK dependency for the first slice.

References:

- [OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses/create?api-mode=responses)
- [OpenAI text generation guide](https://platform.openai.com/docs/guides/text?api-mode=responses)

## User-Facing Behavior

Default behavior:

- `code-easy run "Find SessionManager"` continues to work without API keys.
- Existing tests that assert deterministic workspace context keep passing.

Configured behavior:

- `OPENAI_API_KEY=... CODE_EASY_MODEL_PROVIDER=openai CODE_EASY_MODEL=gpt-5-mini code-easy run "Explain this project"` calls the configured provider.
- The CLI still renders ordinary `message.delta` and `run.completed` events.
- Provider failures emit `run.failed` and persist the failed run, matching current runtime failure behavior.

Optional CLI controls:

- `--model <model>` overrides `CODE_EASY_MODEL` for a single run.
- `--no-model` forces deterministic offline behavior for a single run.

## Runtime Components

`packages/runtime/src/modelProvider.ts` defines provider-neutral types:

- `ModelMessage`
- `GenerateTextInput`
- `GenerateTextResult`
- `ModelProvider`

`packages/runtime/src/modelConfig.ts` reads environment and CLI overrides:

- provider: `off` or `openai`
- model: from override, `CODE_EASY_MODEL`, or a conservative default
- API key: from `OPENAI_API_KEY`
- base URL: from `CODE_EASY_OPENAI_BASE_URL` or `https://api.openai.com/v1`

`packages/runtime/src/openaiResponsesProvider.ts` implements the first provider with `fetch`.

`SessionManager` accepts an optional `modelProvider` or model config override in its constructor. `run()` gathers workspace context as it does today, then either:

- calls the model provider with the user prompt and workspace context, or
- falls back to the existing deterministic summary.

## Prompt Shape

The runtime sends a compact prompt with:

- a system message defining Code Easy as a local coding assistant,
- the user's request,
- Git status summary,
- top workspace files,
- search results from the current heuristic query,
- a constraint to cite file paths from the provided context and avoid claiming edits were made.

This first slice does not add model tool-calling. Tool use remains deterministic and runtime-controlled.

## Error Handling

Provider configuration errors should be explicit:

- `CODE_EASY_MODEL_PROVIDER=openai` without `OPENAI_API_KEY` fails before the run starts.
- malformed provider responses fail with a clear `runtime_failed` detail.
- non-2xx HTTP responses include status and a short response body excerpt.

Network calls happen only when the provider is explicitly enabled.

## Testing Strategy

Runtime tests:

- no configured provider keeps the current deterministic output,
- injected fake provider receives workspace context and prompt,
- fake provider output is emitted in `message.delta`,
- provider failure emits and persists `run.failed`,
- env/config loader rejects missing API keys for `openai`.

CLI tests:

- existing no-key CLI tests remain deterministic,
- `--no-model` forces offline mode,
- `--model test-model` passes the model override to a testable runtime construction path if the CLI is refactored to expose a factory.

No test should call OpenAI or require network access.

## Out Of Scope

- Streaming token-by-token model deltas.
- Model-driven tool calls.
- Multi-provider routing beyond OpenAI-compatible Responses API.
- SQLite checkpoints or conversation memory compression.
- Desktop UI changes.
