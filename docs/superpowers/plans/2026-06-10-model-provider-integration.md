# Model Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real model provider path to `code-easy run` while preserving the current deterministic offline behavior by default.

**Architecture:** The runtime owns provider configuration, provider calls, and failure reporting because it already owns side effects and event emission. The first provider uses OpenAI's Responses API through Node's built-in `fetch`; tests inject fake providers and never call the network.

**Tech Stack:** TypeScript, Node `fetch`, Vitest, commander, zod, existing runtime event protocol.

---

## File Structure

- Create: `packages/runtime/src/modelProvider.ts` - provider-neutral interfaces and context prompt helpers.
- Create: `packages/runtime/src/modelConfig.ts` - environment and CLI override parsing.
- Create: `packages/runtime/src/openaiResponsesProvider.ts` - OpenAI Responses API implementation.
- Create: `packages/runtime/src/modelConfig.test.ts` - config loader tests.
- Create: `packages/runtime/src/openaiResponsesProvider.test.ts` - provider fetch/parse tests with mocked fetch.
- Modify: `packages/runtime/src/sessionManager.ts` - inject and call a provider after workspace context gathering.
- Modify: `packages/runtime/src/sessionManager.test.ts` - fake-provider runtime behavior tests.
- Modify: `packages/runtime/src/index.ts` - export provider types/config helpers.
- Modify: `apps/cli/src/index.ts` - add `--model` and `--no-model` run/resume options.
- Modify: `apps/cli/src/index.test.ts` - verify deterministic default and option rendering paths.
- Modify: `docs/PROGRESS.md` - append task completion status after implementation.

### Task 1: Add Provider Types And Prompt Builder

**Files:**

- Create: `packages/runtime/src/modelProvider.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: covered by later runtime tests

- [x] **Step 1: Create provider-neutral runtime types**

Create `packages/runtime/src/modelProvider.ts`:

```ts
export type ModelMessage = {
  role: "system" | "user";
  content: string;
};

export type GenerateTextInput = {
  model: string;
  messages: ModelMessage[];
};

export type GenerateTextResult = {
  text: string;
  raw?: unknown;
};

export type ModelProvider = {
  name: string;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
};

export type WorkspaceContextPromptInput = {
  userPrompt: string;
  gitStatusSummary: string;
  fileSummary: string;
  searchSummary: string;
};

export function buildWorkspaceContextMessages(input: WorkspaceContextPromptInput): ModelMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Code Easy, a local coding assistant. Answer from the provided workspace context. Cite file paths when useful. Do not claim you edited files or ran commands unless the context says so."
    },
    {
      role: "user",
      content: [
        `User request:\n${input.userPrompt}`,
        `Git status:\n${input.gitStatusSummary}`,
        `Workspace files:\n${input.fileSummary}`,
        `Search results:\n${input.searchSummary}`
      ].join("\n\n")
    }
  ];
}
```

- [x] **Step 2: Export provider types**

Update `packages/runtime/src/index.ts`:

```ts
export * from "./eventBus.js";
export * from "./modelProvider.js";
export * from "./sessionManager.js";
export * from "./toolExecutor.js";
export * from "./toolRegistry.js";
```

- [x] **Step 3: Build and typecheck runtime**

Run: `pnpm --filter @code-easy/runtime typecheck`

Expected: TypeScript succeeds with no errors.

### Task 2: Add Model Configuration Loading

**Files:**

- Create: `packages/runtime/src/modelConfig.ts`
- Create: `packages/runtime/src/modelConfig.test.ts`
- Modify: `packages/runtime/src/index.ts`

- [x] **Step 1: Write failing config tests**

Create `packages/runtime/src/modelConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadModelConfig } from "./modelConfig.js";

describe("loadModelConfig", () => {
  it("disables model calls by default when no provider is configured", () => {
    expect(loadModelConfig({ env: {} })).toEqual({ enabled: false });
  });

  it("builds OpenAI config from environment", () => {
    expect(
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          CODE_EASY_MODEL: "gpt-5-mini"
        }
      })
    ).toEqual({
      enabled: true,
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1"
    });
  });

  it("lets CLI model override environment model", () => {
    expect(
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          CODE_EASY_MODEL: "gpt-5-mini"
        },
        modelOverride: "gpt-5"
      })
    ).toMatchObject({
      enabled: true,
      model: "gpt-5"
    });
  });

  it("lets CLI disable model calls", () => {
    expect(
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key"
        },
        disabled: true
      })
    ).toEqual({ enabled: false });
  });

  it("throws when OpenAI is selected without an API key", () => {
    expect(() =>
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai"
        }
      })
    ).toThrow("OPENAI_API_KEY is required when CODE_EASY_MODEL_PROVIDER=openai");
  });
});
```

- [x] **Step 2: Run config test to verify it fails**

Run: `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts`

Expected: FAIL because `modelConfig.ts` does not exist.

- [x] **Step 3: Implement config loader**

Create `packages/runtime/src/modelConfig.ts`:

```ts
export type DisabledModelConfig = {
  enabled: false;
};

export type OpenAIModelConfig = {
  enabled: true;
  provider: "openai";
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type ModelConfig = DisabledModelConfig | OpenAIModelConfig;

export type LoadModelConfigInput = {
  env?: Record<string, string | undefined>;
  modelOverride?: string;
  disabled?: boolean;
};

export function loadModelConfig(input: LoadModelConfigInput = {}): ModelConfig {
  if (input.disabled === true) return { enabled: false };

  const env = input.env ?? process.env;
  const provider = env.CODE_EASY_MODEL_PROVIDER ?? "off";
  if (provider === "off" || provider.length === 0) return { enabled: false };

  if (provider !== "openai") {
    throw new Error(`Unsupported CODE_EASY_MODEL_PROVIDER: ${provider}`);
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when CODE_EASY_MODEL_PROVIDER=openai");
  }

  return {
    enabled: true,
    provider: "openai",
    apiKey,
    model: input.modelOverride ?? env.CODE_EASY_MODEL ?? "gpt-5-mini",
    baseUrl: env.CODE_EASY_OPENAI_BASE_URL ?? "https://api.openai.com/v1"
  };
}
```

- [x] **Step 4: Export config helpers**

Update `packages/runtime/src/index.ts`:

```ts
export * from "./eventBus.js";
export * from "./modelConfig.js";
export * from "./modelProvider.js";
export * from "./sessionManager.js";
export * from "./toolExecutor.js";
export * from "./toolRegistry.js";
```

- [x] **Step 5: Run config tests**

Run: `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts`

Expected: all `modelConfig` tests pass.

### Task 3: Implement OpenAI Responses Provider

**Files:**

- Create: `packages/runtime/src/openaiResponsesProvider.ts`
- Create: `packages/runtime/src/openaiResponsesProvider.test.ts`
- Modify: `packages/runtime/src/index.ts`

- [x] **Step 1: Write provider tests with mocked fetch**

Create `packages/runtime/src/openaiResponsesProvider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOpenAIResponsesProvider } from "./openaiResponsesProvider.js";

describe("createOpenAIResponsesProvider", () => {
  it("posts to the Responses API and returns output_text", async () => {
    const calls: unknown[] = [];
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ output_text: "model answer" }), { status: 200 });
      }
    });

    const result = await provider.generateText({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(result.text).toBe("model answer");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.test/v1/responses"
    });
  });

  it("extracts text from output content when output_text is absent", async () => {
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            output: [{ content: [{ type: "output_text", text: "nested answer" }] }]
          }),
          { status: 200 }
        )
    });

    await expect(
      provider.generateText({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }]
      })
    ).resolves.toMatchObject({ text: "nested answer" });
  });

  it("throws with status details for non-2xx responses", async () => {
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async () => new Response("bad request", { status: 400 })
    });

    await expect(
      provider.generateText({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }]
      })
    ).rejects.toThrow("OpenAI Responses API failed with status 400: bad request");
  });
});
```

- [x] **Step 2: Run provider test to verify it fails**

Run: `pnpm --filter @code-easy/runtime test -- openaiResponsesProvider.test.ts`

Expected: FAIL because `openaiResponsesProvider.ts` does not exist.

- [x] **Step 3: Implement provider**

Create `packages/runtime/src/openaiResponsesProvider.ts`:

```ts
import type { GenerateTextInput, GenerateTextResult, ModelProvider } from "./modelProvider.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type OpenAIResponsesProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
};

function extractOutputText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

export function createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): ModelProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";

  return {
    name: "openai-responses",
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: input.model,
          input: input.messages.map((message) => ({
            role: message.role,
            content: message.content
          }))
        })
      });

      const textBody = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI Responses API failed with status ${response.status}: ${textBody.slice(0, 500)}`);
      }

      const body = JSON.parse(textBody) as unknown;
      const text = extractOutputText(body);
      if (!text) {
        throw new Error("OpenAI Responses API response did not include text output.");
      }

      return { text, raw: body };
    }
  };
}
```

- [x] **Step 4: Export provider factory**

Update `packages/runtime/src/index.ts`:

```ts
export * from "./eventBus.js";
export * from "./modelConfig.js";
export * from "./modelProvider.js";
export * from "./openaiResponsesProvider.js";
export * from "./sessionManager.js";
export * from "./toolExecutor.js";
export * from "./toolRegistry.js";
```

- [x] **Step 5: Run provider tests**

Run: `pnpm --filter @code-easy/runtime test -- openaiResponsesProvider.test.ts`

Expected: all provider tests pass.

### Task 4: Wire Provider Into SessionManager

**Files:**

- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`

- [x] **Step 1: Add failing runtime tests for injected provider**

Add to `packages/runtime/src/sessionManager.test.ts`:

```ts
it("uses an injected model provider after gathering workspace context", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-model-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await writeFile(path.join(workspaceRoot, "README.md"), "Model provider context\n", "utf8");
  const calls: unknown[] = [];
  const manager = new SessionManager({
    modelProvider: {
      name: "fake",
      async generateText(input) {
        calls.push(input);
        return { text: "fake model answer" };
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
    prompt: "Explain Model provider"
  });

  expect(calls).toHaveLength(1);
  expect(JSON.stringify(calls[0])).toContain("Model provider context");
  expect(events).toContainEqual({
    type: "message.delta",
    runId: expect.any(String),
    text: expect.stringContaining("fake model answer")
  });
  expect(events.at(-1)).toMatchObject({
    type: "run.completed",
    summary: "Model response completed."
  });
});

it("keeps deterministic workspace inspection when modelProvider is false", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-no-model-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await writeFile(path.join(workspaceRoot, "README.md"), "Offline context\n", "utf8");
  const manager = new SessionManager({ modelProvider: false });
  const events: AgentEvent[] = [];

  manager.subscribe((event) => {
    events.push(event);
  });

  await manager.run({
    kind: "run",
    workspaceRoot,
    prompt: "Find Offline"
  });

  const messageText = events
    .filter((event) => event.type === "message.delta")
    .map((event) => event.text)
    .join("\n");

  expect(messageText).toContain("Workspace context");
  expect(messageText).toContain("Runtime initialized.");
  expect(events.at(-1)).toMatchObject({
    type: "run.completed",
    summary: "Workspace inspection completed."
  });
});
```

- [x] **Step 2: Run runtime test to verify provider test fails**

Run: `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts`

Expected: FAIL because `SessionManagerOptions` does not yet accept `modelProvider` or `model`.

- [x] **Step 3: Update SessionManager options and imports**

Modify the imports and option type in `packages/runtime/src/sessionManager.ts`:

```ts
import {
  buildWorkspaceContextMessages,
  type ModelProvider
} from "./modelProvider.js";
```

```ts
export type SessionManagerOptions = {
  tools?: ToolRegistry;
  store?: SessionStore | false;
  modelProvider?: ModelProvider | false;
  model?: string;
};
```

Add private fields:

```ts
private readonly modelProvider?: ModelProvider | false;
private readonly model: string;
```

Initialize them in the constructor:

```ts
this.modelProvider = options.modelProvider;
this.model = options.model ?? "gpt-5-mini";
```

- [x] **Step 4: Call the provider after context tools finish**

Replace the `message.delta` and summary block in `run()` with:

```ts
const gitStatusSummary = summarizeGitStatus(gitStatus);
const fileSummary = summarizeFiles(fileList);
const searchSummary = summarizeSearch(searchPattern, searchResults);
const graphMessage = result.messages.at(-1) ?? "Runtime completed.";

let messageText: string;
let summary: string;

if (this.modelProvider && this.modelProvider !== false) {
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
} else {
  messageText = ["Workspace context", gitStatusSummary, fileSummary, searchSummary, graphMessage].join("\n\n");
  summary = "Workspace inspection completed.";
}

this.events.publish({
  type: "message.delta",
  runId,
  text: messageText
});
this.events.publish({
  type: "run.completed",
  runId,
  summary
});
```

Keep the existing `recordRunCompleted` call, but use the new `summary` variable.

- [x] **Step 5: Run runtime tests**

Run: `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts`

Expected: all session manager tests pass.

### Task 5: Add Runtime Provider Factory

**Files:**

- Modify: `packages/runtime/src/modelConfig.ts`
- Modify: `packages/runtime/src/modelConfig.test.ts`

- [x] **Step 1: Add tests for creating a provider from config**

Append to `packages/runtime/src/modelConfig.test.ts`:

```ts
import { createModelProviderFromConfig } from "./modelConfig.js";

it("returns false for disabled config", () => {
  expect(createModelProviderFromConfig({ enabled: false })).toBe(false);
});

it("creates an OpenAI provider for OpenAI config", () => {
  const provider = createModelProviderFromConfig({
    enabled: true,
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-5-mini",
    baseUrl: "https://api.openai.test/v1"
  });

  expect(provider).toMatchObject({ name: "openai-responses" });
});
```

- [x] **Step 2: Run config tests to verify provider factory fails**

Run: `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts`

Expected: FAIL because `createModelProviderFromConfig` does not exist.

- [x] **Step 3: Implement provider factory**

Add to `packages/runtime/src/modelConfig.ts`:

```ts
import type { ModelProvider } from "./modelProvider.js";
import { createOpenAIResponsesProvider } from "./openaiResponsesProvider.js";
```

```ts
export function createModelProviderFromConfig(config: ModelConfig): ModelProvider | false {
  if (!config.enabled) return false;

  return createOpenAIResponsesProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl
  });
}
```

- [x] **Step 4: Run config tests**

Run: `pnpm --filter @code-easy/runtime test -- modelConfig.test.ts`

Expected: all config tests pass.

### Task 6: Add CLI Model Options

**Files:**

- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`

- [x] **Step 1: Add CLI tests for offline default and options**

Add tests to `apps/cli/src/index.test.ts`:

```ts
it("keeps run deterministic when --no-model is passed", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-cli-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await writeFile(path.join(workspaceRoot, "README.md"), "No model cli context\n", "utf8");

  const { stdout } = await execFileAsync(
    "node",
    ["--import", "tsx", "src/index.ts", "run", "Find No", "--workspace", workspaceRoot, "--no-model"],
    {
      cwd: process.cwd(),
      timeout: 10_000
    }
  );

  expect(stdout).toContain("Workspace context");
  expect(stdout).toContain("Run completed: Workspace inspection completed.");
});
```

- [x] **Step 2: Run CLI tests to verify option fails**

Run: `pnpm --filter @code-easy/cli test -- index.test.ts`

Expected: FAIL because `--no-model` is not defined yet.

- [x] **Step 3: Wire options into CLI run and resume**

Modify imports in `apps/cli/src/index.ts`:

```ts
import { createModelProviderFromConfig, loadModelConfig, SessionManager } from "@code-easy/runtime";
```

Add a helper:

```ts
type ModelOptions = {
  model?: string;
  modelEnabled?: boolean;
};

function createSessionManager(options: ModelOptions = {}): SessionManager {
  const config = loadModelConfig({
    modelOverride: options.model,
    disabled: options.modelEnabled === false
  });

  return new SessionManager({
    modelProvider: createModelProviderFromConfig(config),
    model: config.enabled ? config.model : options.model
  });
}
```

Update `run` options and action:

```ts
.option("--model <model>", "Model name for configured provider")
.option("--no-model", "Disable model provider for this run")
.action(async (prompt: string, options: { workspace: string; model?: string; modelEnabled?: boolean }) => {
  const manager = createSessionManager(options);
  manager.subscribe(renderEvent);

  await manager.run({
    kind: "run",
    workspaceRoot: options.workspace,
    prompt
  });
});
```

Update `resume` options and action the same way, so continuing a session can use the same provider settings:

```ts
.option("--model <model>", "Model name for configured provider")
.option("--no-model", "Disable model provider for this run")
.action(async (
  threadId: string,
  prompt: string | undefined,
  options: { workspace: string; model?: string; modelEnabled?: boolean }
) => {
  const manager = createSessionManager(options);
  // existing body continues
});
```

- [x] **Step 4: Run CLI tests**

Run: `pnpm --filter @code-easy/cli test -- index.test.ts`

Expected: all CLI tests pass.

### Task 7: Full Verification And Progress Update

**Files:**

- Modify: `docs/PROGRESS.md`

- [x] **Step 1: Run full test suite**

Run: `pnpm test`

Expected: all workspace tests pass.

- [x] **Step 2: Run full typecheck**

Run: `pnpm typecheck`

Expected: all workspace packages typecheck.

- [x] **Step 3: Update progress log**

Append to `docs/PROGRESS.md`:

```md
### 2026-06-10 - Add model provider integration

Completed:

- Added runtime model provider types and prompt construction.
- Added OpenAI Responses API provider configuration and implementation.
- Wired provider calls into `SessionManager.run()` while preserving offline default behavior.
- Added CLI `--model` and `--no-model` controls.

Verification:

- `pnpm test` passed.
- `pnpm typecheck` passed.

Next:

- Decide whether to add model-driven tool calling or SQLite/LangGraph checkpoint persistence next.
```

Update `Current Snapshot` so it includes:

```md
- Optional model provider path for `code-easy run`, with deterministic offline fallback.
```

- [x] **Step 4: Check diff**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/runtime apps/cli docs/PROGRESS.md
git commit -m "feat: add model provider integration"
```

## Plan Self-Review

Spec coverage:

- Real model output path: Tasks 1, 3, 4, and 6.
- Offline default preservation: Tasks 2, 4, and 6.
- Provider failures: Task 3 and existing `SessionManager.run()` failure handling.
- No network in tests: Tasks 3 and 4 use fake fetch/provider.
- CLI control: Task 6.
- Progress tracking: Task 7.

Placeholder scan:

- No placeholder markers or unspecified implementation steps remain.

Type consistency:

- `ModelProvider`, `GenerateTextInput`, and `GenerateTextResult` are introduced once in Task 1 and reused consistently in later tasks.
