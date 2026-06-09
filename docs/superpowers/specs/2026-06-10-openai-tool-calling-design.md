# OpenAI Tool Calling Design

Date: 2026-06-10

## Goal

Let `code-easy run` use OpenAI Responses API native function calling to request local workspace tools, execute approved tool calls through the existing runtime tool system, and feed tool results back to the model for a final answer.

## Current State

The model provider integration adds a provider boundary and an OpenAI Responses API provider, but the provider only returns text. `SessionManager.run()` still gathers a deterministic initial context with `git_status`, `list_files`, and `rg_search`, then either calls the configured model once or returns the offline workspace summary.

This means the model can answer from the initial context but cannot ask for more specific files or searches.

## OpenAI API Behavior

OpenAI's Responses API supports custom function tools through the `tools` request field. The function calling guide shows this loop:

1. Send tools and input to the model.
2. Inspect `response.output` for `function_call` items.
3. Parse each call's `name` and JSON `arguments`.
4. Execute the local function.
5. Append a `function_call_output` item with the same `call_id`.
6. Call the model again with the updated input.

The docs also describe `parallel_tool_calls`; setting it to `false` makes the first implementation simpler because the model can call at most one function in a turn. Strict mode is available for function schemas and should be used so tool arguments follow the declared JSON Schema.

References:

- [OpenAI function calling guide](https://platform.openai.com/docs/guides/function-calling?api-mode=responses)
- [OpenAI Responses API create reference](https://platform.openai.com/docs/api-reference/responses/create?api-mode=responses)

## Scope

First implementation scope:

- Use OpenAI native function tool calling only for the OpenAI Responses provider.
- Expose only read-risk local tools to the model:
  - `git_status`
  - `list_files`
  - `rg_search`
  - `read_file`
- Set `parallel_tool_calls: false`.
- Set strict tool schemas.
- Limit model tool loops to 3 rounds.
- Keep the no-provider/offline path unchanged.
- Keep `apply_patch` and `run_command` unavailable to model-directed calls.

Out of scope:

- Model-directed write or execute tools.
- Streaming function-call deltas.
- Provider-neutral tool calling for non-OpenAI providers.
- OpenAI built-in tools such as web search, shell, or apply_patch.
- Automatic committing, editing, or command execution.

## Architecture

Add tool-calling support in the runtime/provider boundary without moving tool execution into the provider.

`packages/runtime/src/openaiResponsesProvider.ts` remains responsible only for OpenAI HTTP details:

- convert messages and tool definitions into Responses API request payloads,
- parse response text,
- parse `function_call` output items,
- support follow-up `function_call_output` input items.

`SessionManager` remains responsible for local side effects:

- select which local tools are exposed to the model,
- execute requested tools through `PermissionedToolExecutor`,
- emit normal tool events,
- format tool results as `function_call_output`,
- stop after the max tool-call round count.

This keeps provider code network-focused and runtime code permission-focused.

## Types

Extend `packages/runtime/src/modelProvider.ts` with provider-neutral structures that can represent OpenAI tool calls without leaking raw OpenAI response details everywhere:

```ts
export type ModelToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelToolCall = {
  callId: string;
  name: string;
  argumentsText: string;
};

export type ModelToolResult = {
  callId: string;
  output: string;
};

export type GenerateTextInput = {
  model: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  toolResults?: ModelToolResult[];
};

export type GenerateTextResult = {
  text?: string;
  toolCalls?: ModelToolCall[];
  raw?: unknown;
};
```

The first provider will return either text or tool calls. Runtime treats a response with tool calls as an instruction to execute tools and continue the loop.

## Tool Schema Mapping

Create `packages/runtime/src/modelToolSchemas.ts` to translate selected local tools into OpenAI-compatible function schemas.

The first version should define schemas manually rather than trying to introspect Zod. Manual schemas are more explicit and easier to keep strict:

- `additionalProperties: false`
- all required properties listed
- optional inputs represented as nullable fields when needed

Example shape:

```ts
{
  type: "function",
  name: "read_file",
  description: "Read a UTF-8 text file from the current workspace.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      maxBytes: { type: ["number", "null"], description: "Maximum bytes to read." }
    },
    required: ["path", "maxBytes"],
    additionalProperties: false
  }
}
```

The runtime should keep an allowlist for model-callable tools. It must reject any model call outside that allowlist even if a tool exists in the registry.

## Runtime Flow

`SessionManager.run()` will keep the current initial deterministic context gathering. When a model provider is configured:

1. Build initial model messages from prompt and deterministic context.
2. Build read-only model tool definitions.
3. Call `modelProvider.generateText({ model, messages, tools })`.
4. If the response has text and no tool calls, emit it as `message.delta` and complete.
5. If the response has one tool call:
   - validate the tool name is in the read-only allowlist,
   - parse `argumentsText` as JSON,
   - execute the local tool through `PermissionedToolExecutor`,
   - serialize the result or error as a JSON string,
   - append a `ModelToolResult` with the original `callId`,
   - call the model again with the accumulated tool result.
6. Stop after 3 tool rounds and fail clearly if the model keeps requesting tools.

Although read-only tools do not require approval today, using `PermissionedToolExecutor` preserves one path for future write-tool support.

## Error Handling

Runtime should fail the run with `runtime_failed` when:

- the provider returns a tool call with unknown name,
- the provider returns invalid JSON arguments,
- the provider returns more than one tool call while `parallel_tool_calls: false` was requested,
- the max tool-call rounds are exceeded,
- the local tool execution fails.

The failure should still be persisted by the existing run failure path.

For local tool errors, the first implementation should fail the run rather than letting the model recover. A later iteration can feed tool errors back as function output if that proves useful.

## Event And CLI Behavior

Tool execution must continue to emit existing events:

- `tool.started`
- `tool.completed`
- `approval.requested` if future allowed tools require approval

CLI rendering should not need new event types for the first version. It will show tool activity as it already does, then print the final model answer through `message.delta`.

## Testing Strategy

Runtime tests:

- fake provider first returns a `read_file` tool call, then returns final text after receiving tool output.
- model-requested tool calls emit normal tool events.
- unknown model tool names fail the run.
- invalid JSON arguments fail the run.
- multiple tool calls fail the run.
- max tool-call rounds fail the run.
- offline/no-provider behavior remains unchanged.

OpenAI provider tests:

- request body includes `tools` and `parallel_tool_calls: false`.
- provider parses `function_call` output items.
- provider sends `function_call_output` items in follow-up input.
- provider still parses plain text output.

CLI tests:

- existing no-provider CLI tests remain deterministic.
- configured provider behavior is covered at runtime level with fake providers, not by real network CLI tests.

No test should require `OPENAI_API_KEY` or network access.

## Progress Tracking

After implementation, update `docs/PROGRESS.md` with:

- OpenAI native function calling support.
- Read-only model-callable tool allowlist.
- Verification commands and results.
- The next recommended step.
