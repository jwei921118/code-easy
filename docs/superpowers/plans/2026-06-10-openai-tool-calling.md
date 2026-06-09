# OpenAI Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Responses API native function calling so configured model runs can request approved read-only workspace tools and receive their results before producing a final answer.

**Architecture:** Keep OpenAI protocol parsing in `openaiResponsesProvider`, keep local side effects and permissions in `SessionManager`, and expose only a runtime-maintained allowlist of read-only tools. The provider returns provider-neutral tool-call structures; the runtime executes local tools through the existing `PermissionedToolExecutor` and feeds `function_call_output` results back to the provider.

**Tech Stack:** TypeScript, Vitest, Node `fetch`, OpenAI Responses API, existing runtime/tool/event protocol.

---

## File Structure

- Modify: `packages/runtime/src/modelProvider.ts` - add model tool definition, call, and result types.
- Modify: `packages/runtime/src/modelProvider.test.ts` - cover prompt/tool-result message construction behavior.
- Create: `packages/runtime/src/modelToolSchemas.ts` - read-only model tool allowlist and OpenAI-compatible JSON schemas.
- Create: `packages/runtime/src/modelToolSchemas.test.ts` - schema/allowlist tests.
- Modify: `packages/runtime/src/openaiResponsesProvider.ts` - send `tools`, `parallel_tool_calls: false`, parse `function_call`, and send `function_call_output`.
- Modify: `packages/runtime/src/openaiResponsesProvider.test.ts` - provider request/parse tests.
- Modify: `packages/runtime/src/sessionManager.ts` - run model tool-call loop with max round count.
- Modify: `packages/runtime/src/sessionManager.test.ts` - fake provider tool-call loop/error tests.
- Modify: `packages/runtime/src/index.ts` - export model tool schema helpers.
- Modify: `docs/PROGRESS.md` - append completion status after implementation.

### Task 1: Extend Model Provider Types

**Files:**

- Modify: `packages/runtime/src/modelProvider.ts`
- Modify: `packages/runtime/src/modelProvider.test.ts`

- [ ] **Step 1: Write failing tests for tool-capable provider types**

Append to `packages/runtime/src/modelProvider.test.ts`:

```ts
import type { GenerateTextInput, GenerateTextResult, ModelToolCall, ModelToolResult } from "./modelProvider.js";

it("allows provider inputs to include tool definitions and prior tool results", () => {
  const toolResult: ModelToolResult = {
    callId: "call-1",
    output: "{\"ok\":true}"
  };
  const input: GenerateTextInput = {
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Read package.json" }],
    tools: [
      {
        name: "read_file",
        description: "Read a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" }
          },
          required: ["path"],
          additionalProperties: false
        }
      }
    ],
    toolResults: [toolResult]
  };

  expect(input.toolResults).toEqual([toolResult]);
});

it("allows providers to return tool calls instead of final text", () => {
  const call: ModelToolCall = {
    callId: "call-1",
    name: "read_file",
    argumentsText: "{\"path\":\"package.json\"}"
  };
  const result: GenerateTextResult = {
    toolCalls: [call],
    raw: { output: [] }
  };

  expect(result.toolCalls).toEqual([call]);
});
```

- [ ] **Step 2: Run model provider tests to verify failure**

Run: `pnpm --filter @code-easy/runtime test -- modelProvider.test.ts`

Expected: FAIL with TypeScript errors because `ModelToolCall`, `ModelToolResult`, `tools`, and `toolResults` do not exist yet.

- [ ] **Step 3: Extend provider types**

Update `packages/runtime/src/modelProvider.ts`:

```ts
export type ModelMessage = {
  role: "system" | "user";
  content: string;
};

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

Keep the existing `WorkspaceContextPromptInput` and `buildWorkspaceContextMessages()` definitions below these types.

- [ ] **Step 4: Run model provider tests**

Run: `pnpm --filter @code-easy/runtime test -- modelProvider.test.ts`

Expected: all model provider tests pass.

### Task 2: Add Read-Only Model Tool Schemas

**Files:**

- Create: `packages/runtime/src/modelToolSchemas.ts`
- Create: `packages/runtime/src/modelToolSchemas.test.ts`
- Modify: `packages/runtime/src/index.ts`

- [ ] **Step 1: Write failing schema tests**

Create `packages/runtime/src/modelToolSchemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getModelCallableTool, modelCallableToolNames, modelToolDefinitions } from "./modelToolSchemas.js";

describe("model tool schemas", () => {
  it("exposes only read-only tools to the model", () => {
    expect(modelCallableToolNames).toEqual(["git_status", "list_files", "rg_search", "read_file"]);
    expect(modelCallableToolNames).not.toContain("apply_patch");
    expect(modelCallableToolNames).not.toContain("run_command");
  });

  it("uses strict schemas with no additional properties", () => {
    for (const tool of modelToolDefinitions) {
      expect(tool.parameters).toMatchObject({
        type: "object",
        additionalProperties: false
      });
      expect(Array.isArray((tool.parameters as { required?: unknown }).required)).toBe(true);
    }
  });

  it("finds callable tool definitions by name", () => {
    expect(getModelCallableTool("read_file")).toMatchObject({
      name: "read_file",
      description: expect.stringContaining("Read")
    });
    expect(getModelCallableTool("run_command")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run schema tests to verify failure**

Run: `pnpm --filter @code-easy/runtime test -- modelToolSchemas.test.ts`

Expected: FAIL because `modelToolSchemas.ts` does not exist.

- [ ] **Step 3: Implement read-only tool schemas**

Create `packages/runtime/src/modelToolSchemas.ts`:

```ts
import type { ModelToolDefinition } from "./modelProvider.js";

export const modelCallableToolNames = ["git_status", "list_files", "rg_search", "read_file"] as const;

export type ModelCallableToolName = (typeof modelCallableToolNames)[number];

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[]
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

export const modelToolDefinitions: ModelToolDefinition[] = [
  {
    name: "git_status",
    description: "Inspect Git status for the current workspace.",
    parameters: objectSchema(
      {
        porcelain: {
          type: "boolean",
          description: "Use short porcelain output. Use true unless the user asks for full status."
        }
      },
      ["porcelain"]
    )
  },
  {
    name: "list_files",
    description: "List files inside the workspace while skipping generated directories.",
    parameters: objectSchema(
      {
        path: { type: "string", description: "Workspace-relative directory path." },
        limit: { type: "number", description: "Maximum number of files to return, from 1 to 5000." },
        includeHidden: { type: "boolean", description: "Whether to include hidden files." }
      },
      ["path", "limit", "includeHidden"]
    )
  },
  {
    name: "rg_search",
    description: "Search workspace text with ripgrep and return bounded structured matches.",
    parameters: objectSchema(
      {
        pattern: { type: "string", description: "Search pattern." },
        path: { type: "string", description: "Workspace-relative file or directory path." },
        maxMatches: { type: "number", description: "Maximum number of matches, from 1 to 1000." },
        caseSensitive: { type: "boolean", description: "Whether search is case-sensitive." }
      },
      ["pattern", "path", "maxMatches", "caseSensitive"]
    )
  },
  {
    name: "read_file",
    description: "Read a bounded UTF-8 text file inside the workspace.",
    parameters: objectSchema(
      {
        path: { type: "string", description: "Workspace-relative file path." },
        maxBytes: { type: "number", description: "Maximum bytes to read, from 1 to 200000." }
      },
      ["path", "maxBytes"]
    )
  }
];

export function getModelCallableTool(name: string): ModelToolDefinition | undefined {
  return modelToolDefinitions.find((tool) => tool.name === name);
}
```

- [ ] **Step 4: Export schema helpers**

Update `packages/runtime/src/index.ts`:

```ts
export * from "./eventBus.js";
export * from "./modelConfig.js";
export * from "./modelProvider.js";
export * from "./modelToolSchemas.js";
export * from "./openaiResponsesProvider.js";
export * from "./sessionManager.js";
export * from "./toolExecutor.js";
export * from "./toolRegistry.js";
```

- [ ] **Step 5: Run schema tests**

Run: `pnpm --filter @code-easy/runtime test -- modelToolSchemas.test.ts`

Expected: all schema tests pass.

### Task 3: Teach OpenAI Provider To Send And Parse Tool Calls

**Files:**

- Modify: `packages/runtime/src/openaiResponsesProvider.ts`
- Modify: `packages/runtime/src/openaiResponsesProvider.test.ts`

- [ ] **Step 1: Add failing provider tests for tool request payloads and tool-call parsing**

Append to `packages/runtime/src/openaiResponsesProvider.test.ts`:

```ts
it("sends tools with parallel tool calls disabled", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenAIResponsesProvider({
    apiKey: "test-key",
    baseUrl: "https://api.openai.test/v1",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ output_text: "done" }), { status: 200 });
    }
  });

  await provider.generateText({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "hello" }],
    tools: [
      {
        name: "read_file",
        description: "Read a file.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false
        }
      }
    ]
  });

  const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  expect(body).toMatchObject({
    parallel_tool_calls: false,
    tools: [
      {
        type: "function",
        name: "read_file",
        strict: true
      }
    ]
  });
});

it("parses function_call output items", async () => {
  const provider = createOpenAIResponsesProvider({
    apiKey: "test-key",
    baseUrl: "https://api.openai.test/v1",
    fetch: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "read_file",
              arguments: "{\"path\":\"package.json\",\"maxBytes\":80000}"
            }
          ]
        }),
        { status: 200 }
      )
  });

  await expect(
    provider.generateText({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "read package" }]
    })
  ).resolves.toMatchObject({
    toolCalls: [
      {
        callId: "call-1",
        name: "read_file",
        argumentsText: "{\"path\":\"package.json\",\"maxBytes\":80000}"
      }
    ]
  });
});

it("sends function_call_output items on follow-up requests", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenAIResponsesProvider({
    apiKey: "test-key",
    baseUrl: "https://api.openai.test/v1",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ output_text: "final" }), { status: 200 });
    }
  });

  await provider.generateText({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "continue" }],
    toolResults: [{ callId: "call-1", output: "{\"ok\":true}" }]
  });

  const body = JSON.parse(String(calls[0]?.init.body)) as { input: unknown[] };
  expect(body.input).toContainEqual({
    type: "function_call_output",
    call_id: "call-1",
    output: "{\"ok\":true}"
  });
});
```

- [ ] **Step 2: Run provider tests to verify failure**

Run: `pnpm --filter @code-easy/runtime test -- openaiResponsesProvider.test.ts`

Expected: FAIL because tools/tool results/tool calls are not implemented.

- [ ] **Step 3: Implement OpenAI request mapping and response parsing**

Update `packages/runtime/src/openaiResponsesProvider.ts`:

```ts
import type {
  GenerateTextInput,
  GenerateTextResult,
  ModelProvider,
  ModelToolCall,
  ModelToolDefinition
} from "./modelProvider.js";

function toOpenAITools(tools: ModelToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    strict: true,
    parameters: tool.parameters
  }));
}

function toOpenAIInput(input: GenerateTextInput): unknown[] {
  return [
    ...input.messages.map((message) => ({
      role: message.role,
      content: message.content
    })),
    ...(input.toolResults ?? []).map((result) => ({
      type: "function_call_output",
      call_id: result.callId,
      output: result.output
    }))
  ];
}

function extractToolCalls(body: unknown): ModelToolCall[] {
  if (typeof body !== "object" || body === null) return [];

  const output = Array.isArray((body as Record<string, unknown>).output)
    ? ((body as Record<string, unknown>).output as unknown[])
    : [];

  return output.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];

    const record = item as Record<string, unknown>;
    if (record.type !== "function_call") return [];
    if (typeof record.call_id !== "string") return [];
    if (typeof record.name !== "string") return [];
    if (typeof record.arguments !== "string") return [];

    return [
      {
        callId: record.call_id,
        name: record.name,
        argumentsText: record.arguments
      }
    ];
  });
}
```

In `generateText`, replace the request body with:

```ts
const requestBody: Record<string, unknown> = {
  model: input.model,
  input: toOpenAIInput(input)
};

const tools = toOpenAITools(input.tools);
if (tools) {
  requestBody.tools = tools;
  requestBody.parallel_tool_calls = false;
}
```

Then send `body: JSON.stringify(requestBody)`.

After parsing response JSON:

```ts
const toolCalls = extractToolCalls(body);
if (toolCalls.length > 0) {
  return { toolCalls, raw: body };
}

const text = extractOutputText(body);
if (!text) {
  throw new Error("OpenAI Responses API response did not include text output.");
}

return { text, raw: body };
```

- [ ] **Step 4: Run provider tests**

Run: `pnpm --filter @code-easy/runtime test -- openaiResponsesProvider.test.ts`

Expected: all OpenAI provider tests pass.

### Task 4: Add Runtime Tool-Calling Loop

**Files:**

- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`

- [ ] **Step 1: Add failing runtime tests for model-requested read tools**

Append to `packages/runtime/src/sessionManager.test.ts`:

```ts
it("executes a model-requested read tool and sends the result back for a final answer", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-tool-loop-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await writeFile(path.join(workspaceRoot, "README.md"), "Tool loop context\n", "utf8");
  const calls: unknown[] = [];
  const manager = new SessionManager({
    modelProvider: {
      name: "fake",
      async generateText(input) {
        calls.push(input);
        if (calls.length === 1) {
          return {
            toolCalls: [
              {
                callId: "call-1",
                name: "read_file",
                argumentsText: "{\"path\":\"README.md\",\"maxBytes\":80000}"
              }
            ]
          };
        }

        return { text: "Final answer from tool output" };
      }
    },
    model: "fake-model"
  });
  const events: AgentEvent[] = [];

  manager.subscribe((event) => {
    events.push(event);
  });

  await manager.run({
    kind: "run",
    workspaceRoot,
    prompt: "Read README"
  });

  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[0])).toContain("\"tools\"");
  expect(JSON.stringify(calls[1])).toContain("Tool loop context");
  expect(events.flatMap((event) => (event.type === "tool.started" ? [event.call.name] : []))).toContain("read_file");
  expect(events.find((event) => event.type === "message.delta")).toMatchObject({
    type: "message.delta",
    text: "Final answer from tool output"
  });
});

it("fails when the model requests a non-callable tool", async () => {
  const manager = new SessionManager({
    modelProvider: {
      name: "fake",
      async generateText() {
        return {
          toolCalls: [
            {
              callId: "call-1",
              name: "run_command",
              argumentsText: "{\"command\":\"node\"}"
            }
          ]
        };
      }
    }
  });

  await expect(
    manager.run({
      kind: "run",
      workspaceRoot: process.cwd(),
      prompt: "Run command"
    })
  ).rejects.toThrow("Model requested unavailable tool: run_command");
});

it("fails when the model returns invalid tool arguments JSON", async () => {
  const manager = new SessionManager({
    modelProvider: {
      name: "fake",
      async generateText() {
        return {
          toolCalls: [
            {
              callId: "call-1",
              name: "read_file",
              argumentsText: "{bad json"
            }
          ]
        };
      }
    }
  });

  await expect(
    manager.run({
      kind: "run",
      workspaceRoot: process.cwd(),
      prompt: "Read file"
    })
  ).rejects.toThrow("Model returned invalid JSON arguments for read_file");
});

it("fails when the model returns multiple tool calls", async () => {
  const manager = new SessionManager({
    modelProvider: {
      name: "fake",
      async generateText() {
        return {
          toolCalls: [
            { callId: "call-1", name: "git_status", argumentsText: "{\"porcelain\":true}" },
            { callId: "call-2", name: "list_files", argumentsText: "{\"path\":\".\",\"limit\":10,\"includeHidden\":false}" }
          ]
        };
      }
    }
  });

  await expect(
    manager.run({
      kind: "run",
      workspaceRoot: process.cwd(),
      prompt: "Inspect workspace"
    })
  ).rejects.toThrow("Model returned 2 tool calls; expected at most 1");
});
```

- [ ] **Step 2: Run session manager tests to verify failure**

Run: `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts`

Expected: FAIL because runtime does not yet execute provider tool calls.

- [ ] **Step 3: Add helper methods to SessionManager**

In `packages/runtime/src/sessionManager.ts`, import schema helpers and model tool result type:

```ts
import { getModelCallableTool, modelToolDefinitions } from "./modelToolSchemas.js";
import type { ModelToolCall, ModelToolResult } from "./modelProvider.js";
```

Add helper methods inside `SessionManager`:

```ts
private parseToolArguments(call: ModelToolCall): unknown {
  try {
    return JSON.parse(call.argumentsText) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Model returned invalid JSON arguments for ${call.name}: ${detail}`);
  }
}

private async executeModelToolCall(runId: string, workspaceRoot: string, call: ModelToolCall): Promise<ModelToolResult> {
  if (!getModelCallableTool(call.name)) {
    throw new Error(`Model requested unavailable tool: ${call.name}`);
  }

  const tool = this.tools.get(call.name);
  if (!tool) {
    throw new Error(`Model requested unregistered tool: ${call.name}`);
  }

  const executor = new PermissionedToolExecutor(this.events);
  const outcome = await executor.execute({
    runId,
    workspaceRoot,
    tool,
    input: this.parseToolArguments(call)
  });

  if (outcome.status !== "completed") {
    throw new Error(`Model-requested tool ${call.name} did not complete.`);
  }

  return {
    callId: call.callId,
    output: JSON.stringify(outcome.result)
  };
}
```

- [ ] **Step 4: Replace single provider call with tool loop**

In `run()`, replace the single provider call block:

```ts
const modelResult = await this.modelProvider.generateText({
  model: this.model,
  messages: buildWorkspaceContextMessages({
    userPrompt: command.prompt,
    gitStatusSummary,
    fileSummary,
    searchSummary
  })
});
messageText = modelResult.text;
summary = "Model response completed.";
```

with:

```ts
const messages = buildWorkspaceContextMessages({
  userPrompt: command.prompt,
  gitStatusSummary,
  fileSummary,
  searchSummary
});
const toolResults: ModelToolResult[] = [];

for (let round = 0; round < 4; round += 1) {
  const modelResult = await this.modelProvider.generateText({
    model: this.model,
    messages,
    tools: modelToolDefinitions,
    toolResults
  });

  const toolCalls = modelResult.toolCalls ?? [];
  if (toolCalls.length === 0) {
    messageText = modelResult.text ?? "";
    summary = "Model response completed.";
    break;
  }

  if (toolCalls.length > 1) {
    throw new Error(`Model returned ${toolCalls.length} tool calls; expected at most 1`);
  }

  if (round === 3) {
    throw new Error("Model exceeded maximum tool call rounds.");
  }

  toolResults.push(await this.executeModelToolCall(runId, command.workspaceRoot, toolCalls[0]));
}

if (messageText === undefined || summary === undefined) {
  throw new Error("Model did not produce a final response.");
}
```

Change the declarations before the branch from:

```ts
let messageText: string;
let summary: string;
```

to:

```ts
let messageText: string | undefined;
let summary: string | undefined;
```

- [ ] **Step 5: Run session manager tests**

Run: `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts`

Expected: all session manager tests pass.

### Task 5: Full Verification And Progress Update

**Files:**

- Modify: `docs/PROGRESS.md`
- Modify: `docs/superpowers/plans/2026-06-10-openai-tool-calling.md`

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`

Expected: all workspace tests pass.

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`

Expected: all workspace packages typecheck.

- [ ] **Step 3: Update progress log**

Append to `docs/PROGRESS.md`:

```md
### 2026-06-10 - Add OpenAI native tool calling plan

Completed:

- Added an implementation plan for OpenAI Responses API native function calling.

Verification:

- Documentation-only change. No code tests required.

Next:

- Execute `docs/superpowers/plans/2026-06-10-openai-tool-calling.md` task by task.
```

After implementation, append:

```md
### 2026-06-10 - Add OpenAI native tool calling

Completed:

- Added provider-neutral model tool call/result types.
- Added strict read-only model tool schemas.
- Extended the OpenAI Responses provider to send tools, parse `function_call`, and send `function_call_output`.
- Added a bounded runtime loop for model-requested read tools.

Verification:

- `pnpm test` passed.
- `pnpm typecheck` passed.

Next:

- Decide whether to add model-directed write tools behind approvals, SQLite/checkpoints, or a desktop shell.
```

- [ ] **Step 4: Check diff**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/runtime docs/PROGRESS.md docs/superpowers/plans/2026-06-10-openai-tool-calling.md
git commit -m "feat: add openai tool calling"
```

## Plan Self-Review

Spec coverage:

- OpenAI native `tools` request field: Task 3.
- `function_call` parsing: Task 3.
- `function_call_output` follow-up input: Task 3.
- Read-only allowlist: Task 2 and Task 4.
- Permissioned execution path: Task 4.
- Max 3 tool rounds: Task 4.
- Existing offline behavior: Task 4 keeps the non-provider branch and tests it.
- Progress tracking: Task 5.

Placeholder scan:

- No placeholder markers or unspecified implementation steps remain.

Type consistency:

- `ModelToolDefinition`, `ModelToolCall`, and `ModelToolResult` are introduced in Task 1 and reused by schema, provider, and runtime tasks.
