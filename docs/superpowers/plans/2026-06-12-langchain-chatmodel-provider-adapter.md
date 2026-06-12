# LangChain ChatModel Provider Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LangChain ChatModel-backed `ModelProvider` implementation so Code Easy can use OpenAI-compatible chat gateways without hand-writing each provider transport.

**Architecture:** Keep `packages/runtime/src/modelProvider.ts` as Code Easy's stable runtime boundary. Add a LangChain adapter underneath that boundary, then wire OpenAI-compatible config to `@langchain/openai` through an explicit API mode switch. Do not replace `SessionManager`, approval flow, persistence, event protocol, or agent orchestration with LangGraph prebuilt agents in this task.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, `@langchain/core`, `@langchain/openai`, existing Code Easy runtime/provider interfaces.

---

## References

- `packages/runtime/src/modelProvider.ts` - Code Easy provider-neutral contract.
- `packages/runtime/src/modelConfig.ts` - model config loading and provider factory.
- `packages/runtime/src/sessionManager.ts` - current consumer of `ModelProvider.generateText()`.
- `packages/runtime/src/modelToolSchemas.ts` - read-only model-callable tool definitions.
- `packages/runtime/src/openaiResponsesProvider.ts` - current raw OpenAI Responses provider.
- `packages/runtime/src/anthropicMessagesProvider.ts` - current raw Anthropic Messages-compatible provider.
- `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md` - M1.2 roadmap entry.
- LangChain provider docs: `https://docs.langchain.com/oss/javascript/integrations/providers/overview`
- LangChain OpenAI docs: `https://docs.langchain.com/oss/javascript/integrations/chat/openai`

## File Structure

- Create `packages/runtime/src/langchainChatModelProvider.ts`
  - Owns conversion between Code Easy's `ModelProvider` contract and LangChain messages/tool calls.
  - Exposes `createLangChainChatModelProvider()` for tests and dependency injection.
  - Exposes `createOpenAIChatModelProvider()` for config wiring with `@langchain/openai`.
- Create `packages/runtime/src/langchainChatModelProvider.test.ts`
  - Uses fake chat models. No network. No real API keys.
  - Covers message conversion, tool binding, tool call extraction, and tool result follow-up.
- Modify `packages/runtime/src/modelConfig.ts`
  - Adds an OpenAI API mode switch while preserving the current default raw Responses provider.
  - Wires `chat` mode to the LangChain adapter.
- Modify `packages/runtime/src/modelConfig.test.ts`
  - Covers default mode, explicit `responses`, explicit `chat`, and factory selection.
- Modify `packages/runtime/src/index.ts`
  - Exports the new adapter for tests and future runtime reuse.
- Modify `packages/runtime/package.json`
  - Adds `@langchain/openai` as a runtime dependency.
- Modify `pnpm-lock.yaml`
  - Updated by pnpm when the dependency is installed.
- Modify `.code-easy/config.example.json`
  - Shows the new optional API mode key with a safe example value.
- Modify `docs/PROGRESS.md`
  - Records completion and verification after implementation.

## Config Decision

Use `CODE_EASY_OPENAI_API_KIND` for the OpenAI provider transport mode.

Allowed values:

- `responses` - current raw `openaiResponsesProvider.ts`; remains the default.
- `chat` - new LangChain ChatModel adapter using `@langchain/openai`.

Example:

```json
{
  "CODE_EASY_MODEL_PROVIDER": "openai",
  "CODE_EASY_OPENAI_API_KIND": "chat",
  "CODE_EASY_AUTH_TOKEN": "your_token_here",
  "CODE_EASY_BASE_URL": "https://api.example.com/v1",
  "CODE_EASY_MODEL": "gpt-5.5"
}
```

Rationale:

- `provider=openai` still describes the API family or compatibility target.
- `openai api kind=chat` describes the transport implementation.
- Existing users without the new key stay on `responses`, so this is a low-risk migration.

---

### Task 1: Install The LangChain OpenAI Provider Package

**Files:**

- Modify: `packages/runtime/package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Confirm the dependency is not already installed**

Run:

```bash
pnpm --filter @code-easy/runtime list @langchain/openai
```

Expected:

```text
Legend: production dependency, optional only, dev only
```

or no `@langchain/openai` package in the output.

- [x] **Step 2: Install `@langchain/openai` for the runtime package**

Run:

```bash
pnpm --filter @code-easy/runtime add @langchain/openai
```

Expected:

```text
dependencies:
+ @langchain/openai
```

If the command fails with a network or registry access error, rerun it with sandbox escalation and ask the user to allow dependency download.

- [x] **Step 3: Verify package metadata**

Run:

```bash
pnpm --filter @code-easy/runtime list @langchain/openai
```

Expected: output includes `@langchain/openai`.

---

### Task 2: Add Failing Tests For The LangChain Adapter

**Files:**

- Create: `packages/runtime/src/langchainChatModelProvider.test.ts`

- [x] **Step 1: Create the failing test file**

Create `packages/runtime/src/langchainChatModelProvider.test.ts` with:

```ts
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { createLangChainChatModelProvider } from "./langchainChatModelProvider.js";

type FakeRunnable = {
  invoke(input: BaseMessage[]): Promise<AIMessage>;
};

type FakeChatModel = FakeRunnable & {
  bindTools?: (tools: unknown[], kwargs?: Record<string, unknown>) => FakeRunnable;
};

describe("createLangChainChatModelProvider", () => {
  it("converts Code Easy system and user messages to LangChain messages", async () => {
    let capturedInput: BaseMessage[] = [];
    const model: FakeChatModel = {
      async invoke(input) {
        capturedInput = input;
        return new AIMessage("model answer");
      }
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model
    });

    await expect(
      provider.generateText({
        model: "ignored-by-injected-model",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "hello" }
        ]
      })
    ).resolves.toMatchObject({ text: "model answer" });

    expect(capturedInput).toHaveLength(2);
    expect(capturedInput[0]).toBeInstanceOf(SystemMessage);
    expect(capturedInput[0].content).toBe("system prompt");
    expect(capturedInput[1]).toBeInstanceOf(HumanMessage);
    expect(capturedInput[1].content).toBe("hello");
  });

  it("binds provider-neutral tools as OpenAI-style function tools", async () => {
    let capturedTools: unknown[] = [];
    let capturedKwargs: Record<string, unknown> | undefined;
    const model: FakeChatModel = {
      async invoke() {
        throw new Error("invoke should use bound runnable when tools are present");
      },
      bindTools(tools, kwargs) {
        capturedTools = tools;
        capturedKwargs = kwargs;
        return {
          async invoke() {
            return new AIMessage("done");
          }
        };
      }
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model
    });

    await provider.generateText({
      model: "ignored-by-injected-model",
      messages: [{ role: "user", content: "read package" }],
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false
          }
        }
      ]
    });

    expect(capturedKwargs).toEqual({ parallel_tool_calls: false });
    expect(capturedTools).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false
          }
        }
      }
    ]);
  });

  it("extracts LangChain tool calls into Code Easy tool calls", async () => {
    const model: FakeChatModel = {
      async invoke() {
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call-1",
              name: "read_file",
              args: { path: "README.md", maxBytes: 80000 }
            }
          ]
        });
      }
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model
    });

    await expect(
      provider.generateText({
        model: "ignored-by-injected-model",
        messages: [{ role: "user", content: "read README" }]
      })
    ).resolves.toMatchObject({
      toolCalls: [
        {
          callId: "call-1",
          name: "read_file",
          argumentsText: "{\"path\":\"README.md\",\"maxBytes\":80000}"
        }
      ]
    });
  });

  it("adds tool result messages after the user-visible messages", async () => {
    let capturedInput: BaseMessage[] = [];
    const model: FakeChatModel = {
      async invoke(input) {
        capturedInput = input;
        return new AIMessage("final answer");
      }
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model
    });

    await provider.generateText({
      model: "ignored-by-injected-model",
      messages: [{ role: "user", content: "continue" }],
      toolResults: [{ callId: "call-1", output: "{\"ok\":true}" }]
    });

    expect(capturedInput).toHaveLength(2);
    expect(capturedInput[1]).toBeInstanceOf(ToolMessage);
    expect(capturedInput[1].content).toBe("{\"ok\":true}");
    expect((capturedInput[1] as ToolMessage).tool_call_id).toBe("call-1");
  });

  it("throws when tools are provided but the chat model cannot bind tools", async () => {
    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model: {
        async invoke() {
          return new AIMessage("unused");
        }
      }
    });

    await expect(
      provider.generateText({
        model: "ignored-by-injected-model",
        messages: [{ role: "user", content: "read file" }],
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false
            }
          }
        ]
      })
    ).rejects.toThrow("LangChain chat model does not support bindTools()");
  });
});
```

- [x] **Step 2: Run the new tests and verify they fail for the expected reason**

Run:

```bash
pnpm --filter @code-easy/runtime test -- langchainChatModelProvider.test.ts
```

Expected: FAIL because `./langchainChatModelProvider.js` does not exist.

---

### Task 3: Implement The LangChain Adapter

**Files:**

- Create: `packages/runtime/src/langchainChatModelProvider.ts`
- Modify: `packages/runtime/src/index.ts`

- [x] **Step 1: Add the adapter implementation**

Create `packages/runtime/src/langchainChatModelProvider.ts` with:

```ts
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage
} from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type {
  GenerateTextInput,
  GenerateTextResult,
  ModelProvider,
  ModelToolDefinition
} from "./modelProvider.js";

type ChatRunnable = {
  invoke(input: BaseMessage[]): Promise<AIMessage>;
};

type ChatModelLike = ChatRunnable & {
  bindTools?: (
    tools: Array<Record<string, unknown>>,
    kwargs?: Record<string, unknown>
  ) => Runnable<BaseMessage[], AIMessage> | ChatRunnable;
};

export type LangChainChatModelProviderOptions = {
  name: string;
  model: ChatModelLike;
};

export type OpenAIChatModelProviderOptions = {
  apiKey: string;
  baseUrl: string;
};

function toLangChainMessages(input: GenerateTextInput): BaseMessage[] {
  const messages: BaseMessage[] = input.messages.map((message) => {
    if (message.role === "system") {
      return new SystemMessage(message.content);
    }

    return new HumanMessage(message.content);
  });

  for (const result of input.toolResults ?? []) {
    messages.push(
      new ToolMessage({
        content: result.output,
        tool_call_id: result.callId
      })
    );
  }

  return messages;
}

function toOpenAITool(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

function extractText(message: AIMessage): string | undefined {
  if (typeof message.content === "string") {
    return message.content;
  }

  const text = message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("");

  return text.length > 0 ? text : undefined;
}

function toResult(message: AIMessage): GenerateTextResult {
  const toolCalls = message.tool_calls?.map((toolCall) => ({
    callId: toolCall.id ?? toolCall.name,
    name: toolCall.name,
    argumentsText: JSON.stringify(toolCall.args ?? {})
  }));

  return {
    text: toolCalls && toolCalls.length > 0 ? undefined : extractText(message),
    toolCalls,
    raw: message
  };
}

export function createLangChainChatModelProvider(
  options: LangChainChatModelProviderOptions
): ModelProvider {
  return {
    name: options.name,
    async generateText(input) {
      const messages = toLangChainMessages(input);
      const tools = input.tools?.map(toOpenAITool) ?? [];
      const runnable =
        tools.length === 0
          ? options.model
          : options.model.bindTools?.(tools, { parallel_tool_calls: false });

      if (!runnable) {
        throw new Error("LangChain chat model does not support bindTools()");
      }

      return toResult(await runnable.invoke(messages));
    }
  };
}

export function createOpenAIChatModelProvider(
  options: OpenAIChatModelProviderOptions
): ModelProvider {
  return createLangChainChatModelProvider({
    name: "langchain-openai-chat",
    model: new ChatOpenAI({
      apiKey: options.apiKey,
      configuration: {
        baseURL: options.baseUrl
      }
    })
  });
}
```

- [x] **Step 2: Export the adapter**

Modify `packages/runtime/src/index.ts` so it includes:

```ts
export * from "./langchainChatModelProvider.js";
```

- [x] **Step 3: Run adapter tests**

Run:

```bash
pnpm --filter @code-easy/runtime test -- langchainChatModelProvider.test.ts
```

Expected: PASS.

- [x] **Step 4: Run runtime typecheck**

Run:

```bash
pnpm --filter @code-easy/runtime typecheck
```

Expected: PASS. If TypeScript rejects the `ChatOpenAI` constructor shape because the installed `@langchain/openai` version uses a different option name for `baseURL`, inspect the installed package types and adjust only `createOpenAIChatModelProvider()`.

---

### Task 4: Add Config Switching For OpenAI API Kind

**Files:**

- Modify: `packages/runtime/src/modelConfig.ts`
- Modify: `packages/runtime/src/modelConfig.test.ts`

- [x] **Step 1: Add failing config tests**

Add these tests to `describe("loadModelConfig", ...)` in `packages/runtime/src/modelConfig.test.ts`:

```ts
  it("defaults OpenAI config to the Responses API kind", () => {
    expect(
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          CODE_EASY_AUTH_TOKEN: "test-key",
          CODE_EASY_MODEL: "gpt-5-mini"
        }
      })
    ).toMatchObject({
      provider: "openai",
      apiKind: "responses"
    });
  });

  it("builds OpenAI chat config when CODE_EASY_OPENAI_API_KIND=chat", () => {
    expect(
      loadModelConfig({
        env: {},
        settings: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          CODE_EASY_OPENAI_API_KIND: "chat",
          CODE_EASY_AUTH_TOKEN: "test-key",
          CODE_EASY_BASE_URL: "https://api.example.test/v1",
          CODE_EASY_MODEL: "gpt-5.5"
        }
      })
    ).toEqual({
      enabled: true,
      provider: "openai",
      apiKind: "chat",
      apiKey: "test-key",
      model: "gpt-5.5",
      baseUrl: "https://api.example.test/v1"
    });
  });

  it("rejects unsupported OpenAI API kind values", () => {
    expect(() =>
      loadModelConfig({
        env: {},
        settings: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          CODE_EASY_OPENAI_API_KIND: "completions",
          CODE_EASY_AUTH_TOKEN: "test-key",
          CODE_EASY_MODEL: "gpt-5-mini"
        }
      })
    ).toThrow("Unsupported CODE_EASY_OPENAI_API_KIND: completions");
  });

  it("creates a LangChain OpenAI chat provider for OpenAI chat config", () => {
    const provider = createModelProviderFromConfig({
      enabled: true,
      provider: "openai",
      apiKind: "chat",
      apiKey: "test-key",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.test/v1"
    });

    expect(provider).toMatchObject({ name: "langchain-openai-chat" });
  });
```

Update the existing OpenAI config equality tests so expected objects include:

```ts
apiKind: "responses",
```

Update the existing `creates an OpenAI provider for OpenAI config` test input so it includes:

```ts
apiKind: "responses",
```

- [x] **Step 2: Run model config tests and verify failure**

Run:

```bash
pnpm --filter @code-easy/runtime test -- modelConfig.test.ts
```

Expected: FAIL because `apiKind` is not in `OpenAIModelConfig` yet.

- [x] **Step 3: Implement config parsing and factory selection**

Modify `packages/runtime/src/modelConfig.ts`:

```ts
import { createOpenAIChatModelProvider } from './langchainChatModelProvider.js';
```

Change `OpenAIModelConfig` to:

```ts
export type OpenAIModelConfig = {
  enabled: true;
  provider: 'openai';
  apiKind: 'responses' | 'chat';
  apiKey: string;
  model: string;
  baseUrl: string;
};
```

Add this helper near `normalizeProvider()`:

```ts
function normalizeOpenAIApiKind(
  value: string | undefined,
): 'responses' | 'chat' {
  if (!value || value.length === 0) return 'responses';
  if (value === 'responses' || value === 'chat') return value;

  throw new Error(`Unsupported CODE_EASY_OPENAI_API_KIND: ${value}`);
}
```

Add `apiKind` to the OpenAI return object in `loadModelConfig()`:

```ts
    apiKind: normalizeOpenAIApiKind(
      readSetting(settings, env, 'CODE_EASY_OPENAI_API_KIND'),
    ),
```

Update `createModelProviderFromConfig()`:

```ts
  if (config.apiKind === 'chat') {
    return createOpenAIChatModelProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
  }

  return createOpenAIResponsesProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
```

- [x] **Step 4: Run config and adapter tests**

Run:

```bash
pnpm --filter @code-easy/runtime test -- modelConfig.test.ts langchainChatModelProvider.test.ts
```

Expected: PASS.

---

### Task 5: Update Example Config And Roadmap References

**Files:**

- Modify: `.code-easy/config.example.json`
- Modify: `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md`
- Modify: `AGENT.md`

- [x] **Step 1: Update the safe example config**

Change `.code-easy/config.example.json` to:

```json
{
  "CODE_EASY_MODEL_PROVIDER": "openai",
  "CODE_EASY_OPENAI_API_KIND": "chat",
  "CODE_EASY_AUTH_TOKEN": "your_token_here",
  "CODE_EASY_BASE_URL": "https://api.example.com/v1",
  "CODE_EASY_DEFAULT_HAIKU_MODEL": "gpt-5.5",
  "CODE_EASY_DEFAULT_OPUS_MODEL": "gpt-5.5",
  "CODE_EASY_DEFAULT_SONNET_MODEL": "gpt-5.5",
  "CODE_EASY_MODEL": "gpt-5.5",
  "CODE_EASY_REASONING_MODEL": "gpt-5.5"
}
```

- [x] **Step 2: Mark M1.2 implementation details as current in the roadmap**

In `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md`, keep the M1.2 task title as:

```markdown
### Task M1.2: Introduce LangChain ChatModel Provider Adapter
```

Update the M1.2 file list so it names:

```markdown
- Create: `packages/runtime/src/langchainChatModelProvider.ts`
- Create: `packages/runtime/src/langchainChatModelProvider.test.ts`
- Modify: `packages/runtime/src/modelConfig.ts`
- Modify: `packages/runtime/src/modelConfig.test.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.code-easy/config.example.json`
```

- [x] **Step 3: Update `AGENT.md` next task note if needed**

Ensure `AGENT.md` now says the next implementation task is:

```markdown
Start with `M1.3: Expand Model Tool Calls To Write Tools Behind Approval` from the roadmap after M1.2 final verification is complete.
```

---

### Task 6: Run Verification

**Files:**

- No new files.

- [x] **Step 1: Run focused runtime tests**

Run:

```bash
pnpm --filter @code-easy/runtime test -- langchainChatModelProvider.test.ts modelConfig.test.ts
```

Expected: PASS.

- [x] **Step 2: Run runtime typecheck**

Run:

```bash
pnpm --filter @code-easy/runtime typecheck
```

Expected: PASS.

- [x] **Step 3: Run full typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [x] **Step 4: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [x] **Step 5: Check formatting whitespace**

Run:

```bash
git diff --check
```

Expected: no output and exit code `0`.

- [x] **Step 6: Check that no secret was committed**

Run:

```bash
rg "sk-[A-Za-z0-9]{10,}" .
```

Expected: no output and exit code `1`.

---

### Task 7: Optional Real Gateway Smoke Test

**Files:**

- Uses local-only `.code-easy/config.json`, which must remain ignored.

- [ ] **Step 1: Confirm local config is ignored**

Run:

```bash
git check-ignore .code-easy/config.json
```

Expected:

```text
.code-easy/config.json
```

- [ ] **Step 2: Configure local-only OpenAI-compatible chat mode**

Edit `.code-easy/config.json` locally with safe values from the user's real gateway. Do not copy tokens into docs, tests, commits, or chat output.

Required shape:

```json
{
  "CODE_EASY_MODEL_PROVIDER": "openai",
  "CODE_EASY_OPENAI_API_KIND": "chat",
  "CODE_EASY_AUTH_TOKEN": "local_secret_token",
  "CODE_EASY_BASE_URL": "https://api.example.com/v1",
  "CODE_EASY_MODEL": "gpt-5.5"
}
```

- [ ] **Step 3: Run a one-question CLI smoke test**

Run:

```bash
printf '1+1?\n:q\n' | pnpm --filter @code-easy/cli dev -- --workspace .
```

Or use the existing built CLI path for this repo:

```bash
pnpm build
printf '1+1?\n:q\n' | node apps/cli/dist/index.js --workspace .
```

Expected:

- The CLI starts.
- The model returns a short answer.
- No token is printed.
- No `OPENAI_API_KEY is required` error appears when `CODE_EASY_AUTH_TOKEN` is configured.

---

### Task 8: Update Progress

**Files:**

- Modify: `docs/PROGRESS.md`
- Modify: `AGENT.md`

- [x] **Step 1: Add a task log entry to `docs/PROGRESS.md`**

Add a new top task log entry:

```markdown
### 2026-06-12 - Add LangChain ChatModel provider adapter

Completed:

- Added `@langchain/openai` as the first LangChain provider package used by runtime.
- Added `createLangChainChatModelProvider()` for converting Code Easy messages, tools, and tool results to LangChain chat model calls.
- Added `createOpenAIChatModelProvider()` for OpenAI-compatible chat gateways.
- Added `CODE_EASY_OPENAI_API_KIND=chat` while keeping `responses` as the default OpenAI mode.
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
- Keep raw Responses and Anthropic providers until the LangChain adapter is proven in normal CLI use.
```

Update `Current Snapshot` so the next objective becomes M1.3.

- [x] **Step 2: Update `AGENT.md` next task**

Change the next task section to:

```markdown
Start with `M1.3: Expand Model Tool Calls To Write Tools Behind Approval` from the roadmap.
```

Keep the warning:

```markdown
Do not commit secrets. `.code-easy/config.json` is local-only and ignored.
```

---

## Self-Review

- Spec coverage: This plan covers the user's decision to reuse LangChain provider integrations while preserving Code Easy's runtime boundary. It also covers dependency installation, adapter tests, config switching, docs/progress updates, and optional real-gateway verification.
- Placeholder scan: No task contains deferred filler instructions. Each code-changing task includes exact file paths, code snippets, commands, and expected outcomes.
- Type consistency: The plan consistently uses `createLangChainChatModelProvider()`, `createOpenAIChatModelProvider()`, `CODE_EASY_OPENAI_API_KIND`, and `apiKind: "responses" | "chat"`.
