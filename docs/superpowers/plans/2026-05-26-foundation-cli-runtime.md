# Foundation CLI Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first executable slice of Code Easy: a pnpm TypeScript monorepo with shared UI protocol, backend permission/tool/runtime packages, a minimal LangGraph core, and a CLI that can start a streamed local session.

**Architecture:** This plan implements the spec's frontend/backend boundary by making `apps/cli` depend only on `packages/runtime` and `packages/ui-protocol`, while backend side effects live under `packages/tools`, `packages/permissions`, `packages/storage`, and `packages/agent-core`. The first runtime is intentionally small: it emits typed events, validates command inputs, calls a minimal LangGraph graph, and leaves room for approvals and SQLite in the next plan.

**Tech Stack:** TypeScript, ESM, pnpm workspaces, Vitest, tsup, zod, commander, @langchain/langgraph.

---

## File Structure

Create these files:

- `package.json`: root workspace scripts and dev dependencies.
- `pnpm-workspace.yaml`: workspace package discovery.
- `tsconfig.base.json`: shared strict TypeScript settings.
- `.gitignore`: Node, build, local database, and editor ignores.
- `packages/ui-protocol/package.json`: shared frontend/backend contract package.
- `packages/ui-protocol/tsconfig.json`: package TypeScript config.
- `packages/ui-protocol/src/events.ts`: `AgentEvent` schemas and types.
- `packages/ui-protocol/src/commands.ts`: runtime command schemas and types.
- `packages/ui-protocol/src/index.ts`: public exports.
- `packages/ui-protocol/src/events.test.ts`: event schema tests.
- `packages/permissions/package.json`: permission policy package.
- `packages/permissions/tsconfig.json`: package TypeScript config.
- `packages/permissions/src/risks.ts`: risk levels and classifier.
- `packages/permissions/src/index.ts`: public exports.
- `packages/permissions/src/risks.test.ts`: permission tests.
- `packages/tools/package.json`: backend tool package.
- `packages/tools/tsconfig.json`: package TypeScript config.
- `packages/tools/src/types.ts`: tool contracts.
- `packages/tools/src/readFileTool.ts`: bounded file read tool.
- `packages/tools/src/gitStatusTool.ts`: read-only Git status tool.
- `packages/tools/src/index.ts`: public exports.
- `packages/tools/src/readFileTool.test.ts`: file read tests.
- `packages/agent-core/package.json`: LangGraph core package.
- `packages/agent-core/tsconfig.json`: package TypeScript config.
- `packages/agent-core/src/state.ts`: graph state annotations.
- `packages/agent-core/src/graph.ts`: minimal graph factory.
- `packages/agent-core/src/index.ts`: public exports.
- `packages/agent-core/src/graph.test.ts`: graph smoke test.
- `packages/runtime/package.json`: session runtime package.
- `packages/runtime/tsconfig.json`: package TypeScript config.
- `packages/runtime/src/eventBus.ts`: synchronous typed event bus.
- `packages/runtime/src/sessionManager.ts`: run orchestration.
- `packages/runtime/src/index.ts`: public exports.
- `packages/runtime/src/sessionManager.test.ts`: event stream test.
- `apps/cli/package.json`: CLI package and `code-easy` bin.
- `apps/cli/tsconfig.json`: package TypeScript config.
- `apps/cli/src/index.ts`: commander-based CLI entry.

The desktop app is intentionally excluded from this plan. It will consume the same `packages/ui-protocol` and `packages/runtime` APIs in a later plan.

### Task 1: Root Workspace Foundation

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "code-easy",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.12.1",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsup": "^8.5.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
.turbo/
.DS_Store
*.log
*.sqlite
*.sqlite-shm
*.sqlite-wal
.code-easy/local/
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`

Expected: pnpm creates `pnpm-lock.yaml` and installs all root dev dependencies without errors.

- [ ] **Step 6: Commit foundation files**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: initialize typescript workspace"
```

### Task 2: Shared UI Protocol Package

**Files:**

- Create: `packages/ui-protocol/package.json`
- Create: `packages/ui-protocol/tsconfig.json`
- Create: `packages/ui-protocol/src/events.ts`
- Create: `packages/ui-protocol/src/commands.ts`
- Create: `packages/ui-protocol/src/index.ts`
- Create: `packages/ui-protocol/src/events.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add runtime schema dependency**

Run: `pnpm add -w zod`

Expected: root `package.json` includes `zod` and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Create `packages/ui-protocol/package.json`**

```json
{
  "name": "@code-easy/ui-protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.1.9"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Create `packages/ui-protocol/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Create `packages/ui-protocol/src/events.ts`**

```ts
import { z } from "zod";

export const AgentErrorSchema = z.object({
  category: z.enum([
    "cancelled",
    "denied",
    "timeout",
    "tool_failed",
    "model_failed",
    "runtime_failed",
    "invalid_tool_call"
  ]),
  message: z.string(),
  detail: z.string().optional()
});

export const ToolCallViewSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  risk: z.enum(["read", "write", "execute", "network", "destructive", "external"]),
  input: z.unknown(),
  startedAt: z.string()
});

export const ToolResultViewSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: AgentErrorSchema.optional(),
  finishedAt: z.string()
});

export const ApprovalRequestSchema = z.object({
  approvalId: z.string(),
  runId: z.string(),
  reason: z.string(),
  risk: z.enum(["write", "execute", "network", "destructive", "external"]),
  command: z.string().optional(),
  toolName: z.string()
});

export const ApprovalDecisionSchema = z.object({
  approvalId: z.string(),
  approved: z.boolean(),
  rememberForSession: z.boolean().default(false)
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), runId: z.string(), threadId: z.string() }),
  z.object({ type: z.literal("message.delta"), runId: z.string(), text: z.string() }),
  z.object({ type: z.literal("node.started"), runId: z.string(), node: z.string() }),
  z.object({ type: z.literal("node.completed"), runId: z.string(), node: z.string() }),
  z.object({ type: z.literal("tool.started"), runId: z.string(), call: ToolCallViewSchema }),
  z.object({ type: z.literal("tool.output"), runId: z.string(), toolCallId: z.string(), chunk: z.string() }),
  z.object({ type: z.literal("tool.completed"), runId: z.string(), result: ToolResultViewSchema }),
  z.object({ type: z.literal("diff.ready"), runId: z.string(), diff: z.string() }),
  z.object({ type: z.literal("approval.requested"), runId: z.string(), request: ApprovalRequestSchema }),
  z.object({ type: z.literal("approval.resolved"), runId: z.string(), decision: ApprovalDecisionSchema }),
  z.object({ type: z.literal("run.completed"), runId: z.string(), summary: z.string() }),
  z.object({ type: z.literal("run.failed"), runId: z.string(), error: AgentErrorSchema })
]);

export type AgentError = z.infer<typeof AgentErrorSchema>;
export type ToolCallView = z.infer<typeof ToolCallViewSchema>;
export type ToolResultView = z.infer<typeof ToolResultViewSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
```

- [ ] **Step 5: Create `packages/ui-protocol/src/commands.ts`**

```ts
import { z } from "zod";
import { ApprovalDecisionSchema } from "./events.js";

export const RunCommandSchema = z.object({
  kind: z.literal("run"),
  threadId: z.string().optional(),
  workspaceRoot: z.string(),
  prompt: z.string().min(1)
});

export const ResumeCommandSchema = z.object({
  kind: z.literal("resume"),
  threadId: z.string(),
  prompt: z.string().optional()
});

export const CancelCommandSchema = z.object({
  kind: z.literal("cancel"),
  runId: z.string()
});

export const ApproveCommandSchema = z.object({
  kind: z.literal("approve"),
  decision: ApprovalDecisionSchema
});

export const RuntimeCommandSchema = z.discriminatedUnion("kind", [
  RunCommandSchema,
  ResumeCommandSchema,
  CancelCommandSchema,
  ApproveCommandSchema
]);

export type RunCommand = z.infer<typeof RunCommandSchema>;
export type ResumeCommand = z.infer<typeof ResumeCommandSchema>;
export type CancelCommand = z.infer<typeof CancelCommandSchema>;
export type ApproveCommand = z.infer<typeof ApproveCommandSchema>;
export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;
```

- [ ] **Step 6: Create `packages/ui-protocol/src/index.ts`**

```ts
export * from "./commands.js";
export * from "./events.js";
```

- [ ] **Step 7: Create `packages/ui-protocol/src/events.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { AgentEventSchema, RuntimeCommandSchema } from "./index.js";

describe("ui protocol", () => {
  it("validates a run started event", () => {
    const event = AgentEventSchema.parse({
      type: "run.started",
      runId: "run-1",
      threadId: "thread-1"
    });

    expect(event.runId).toBe("run-1");
  });

  it("rejects an empty run prompt", () => {
    expect(() =>
      RuntimeCommandSchema.parse({
        kind: "run",
        workspaceRoot: "/tmp/project",
        prompt: ""
      })
    ).toThrow();
  });
});
```

- [ ] **Step 8: Refresh workspace links**

Run: `pnpm install`

Expected: pnpm links `@code-easy/ui-protocol` as a workspace package and completes without errors.

- [ ] **Step 9: Run UI protocol tests**

Run: `pnpm --filter @code-easy/ui-protocol test`

Expected: both tests pass.

- [ ] **Step 10: Commit UI protocol**

```bash
git add package.json pnpm-lock.yaml packages/ui-protocol
git commit -m "feat: add shared ui protocol"
```

### Task 3: Permission Policy Package

**Files:**

- Create: `packages/permissions/package.json`
- Create: `packages/permissions/tsconfig.json`
- Create: `packages/permissions/src/risks.ts`
- Create: `packages/permissions/src/index.ts`
- Create: `packages/permissions/src/risks.test.ts`

- [ ] **Step 1: Create `packages/permissions/package.json`**

```json
{
  "name": "@code-easy/permissions",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `packages/permissions/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/permissions/src/risks.ts`**

```ts
export type ToolRisk = "read" | "write" | "execute" | "network" | "destructive" | "external";

export type PermissionDecision =
  | { action: "allow"; risk: ToolRisk; reason: string }
  | { action: "ask"; risk: ToolRisk; reason: string };

const readTools = new Set(["read_file", "list_files", "rg_search", "git_status", "git_diff"]);
const writeTools = new Set(["apply_patch", "write_file"]);
const executeTools = new Set(["run_command"]);
const externalTools = new Set(["mcp_call", "browser_open", "browser_snapshot", "browser_click"]);

export function classifyToolRisk(toolName: string): ToolRisk {
  if (readTools.has(toolName)) return "read";
  if (writeTools.has(toolName)) return "write";
  if (executeTools.has(toolName)) return "execute";
  if (externalTools.has(toolName)) return "external";
  return "external";
}

export function decidePermission(toolName: string): PermissionDecision {
  const risk = classifyToolRisk(toolName);

  if (risk === "read") {
    return { action: "allow", risk, reason: "Read-only workspace inspection is allowed by default." };
  }

  return {
    action: "ask",
    risk,
    reason: `Tool ${toolName} has ${risk} risk and requires user approval.`
  };
}
```

- [ ] **Step 4: Create `packages/permissions/src/index.ts`**

```ts
export * from "./risks.js";
```

- [ ] **Step 5: Create `packages/permissions/src/risks.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { classifyToolRisk, decidePermission } from "./index.js";

describe("permission policy", () => {
  it("allows read-only tools", () => {
    expect(classifyToolRisk("read_file")).toBe("read");
    expect(decidePermission("git_status")).toMatchObject({ action: "allow", risk: "read" });
  });

  it("asks before write and execute tools", () => {
    expect(decidePermission("apply_patch")).toMatchObject({ action: "ask", risk: "write" });
    expect(decidePermission("run_command")).toMatchObject({ action: "ask", risk: "execute" });
  });

  it("treats unknown tools as external", () => {
    expect(decidePermission("unknown_tool")).toMatchObject({ action: "ask", risk: "external" });
  });
});
```

- [ ] **Step 6: Refresh workspace links**

Run: `pnpm install`

Expected: pnpm links `@code-easy/permissions` as a workspace package and completes without errors.

- [ ] **Step 7: Run permission tests**

Run: `pnpm --filter @code-easy/permissions test`

Expected: all permission tests pass.

- [ ] **Step 8: Commit permission package**

```bash
git add packages/permissions
git commit -m "feat: add permission policy"
```

### Task 4: Backend Tool Contracts And Read-Only Tools

**Files:**

- Create: `packages/tools/package.json`
- Create: `packages/tools/tsconfig.json`
- Create: `packages/tools/src/types.ts`
- Create: `packages/tools/src/readFileTool.ts`
- Create: `packages/tools/src/gitStatusTool.ts`
- Create: `packages/tools/src/index.ts`
- Create: `packages/tools/src/readFileTool.test.ts`

- [ ] **Step 1: Create `packages/tools/package.json`**

```json
{
  "name": "@code-easy/tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@code-easy/permissions": "workspace:*",
    "zod": "^4.1.9"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `packages/tools/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/tools/src/types.ts`**

```ts
import type { ToolRisk } from "@code-easy/permissions";
import type { z } from "zod";

export type ToolContext = {
  workspaceRoot: string;
  signal?: AbortSignal;
};

export type ToolResult<TOutput> =
  | { ok: true; output: TOutput }
  | { ok: false; error: { category: "tool_failed" | "timeout" | "denied"; message: string; detail?: string } };

export type CodeEasyTool<TInputSchema extends z.ZodTypeAny, TOutput> = {
  name: string;
  risk: ToolRisk;
  description: string;
  inputSchema: TInputSchema;
  run(input: z.infer<TInputSchema>, context: ToolContext): Promise<ToolResult<TOutput>>;
};
```

- [ ] **Step 4: Create `packages/tools/src/readFileTool.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CodeEasyTool } from "./types.js";

const ReadFileInputSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(200_000).default(80_000)
});

type ReadFileOutput = {
  path: string;
  content: string;
  truncated: boolean;
};

function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return resolved;
}

export const readFileTool: CodeEasyTool<typeof ReadFileInputSchema, ReadFileOutput> = {
  name: "read_file",
  risk: "read",
  description: "Read a bounded UTF-8 text file inside the workspace.",
  inputSchema: ReadFileInputSchema,
  async run(input, context) {
    try {
      const absolutePath = resolveInsideWorkspace(context.workspaceRoot, input.path);
      const buffer = await readFile(absolutePath);
      const truncated = buffer.byteLength > input.maxBytes;
      const content = buffer.subarray(0, input.maxBytes).toString("utf8");

      return {
        ok: true,
        output: {
          path: input.path,
          content,
          truncated
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          category: "tool_failed",
          message: `Failed to read ${input.path}`,
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
```

- [ ] **Step 5: Create `packages/tools/src/gitStatusTool.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { CodeEasyTool } from "./types.js";

const execFileAsync = promisify(execFile);

const GitStatusInputSchema = z.object({
  porcelain: z.boolean().default(true)
});

type GitStatusOutput = {
  stdout: string;
  stderr: string;
};

export const gitStatusTool: CodeEasyTool<typeof GitStatusInputSchema, GitStatusOutput> = {
  name: "git_status",
  risk: "read",
  description: "Inspect Git status for the workspace.",
  inputSchema: GitStatusInputSchema,
  async run(input, context) {
    try {
      const args = input.porcelain ? ["status", "--short"] : ["status"];
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: context.workspaceRoot,
        timeout: 10_000,
        maxBuffer: 200_000
      });

      return { ok: true, output: { stdout, stderr } };
    } catch (error) {
      return {
        ok: false,
        error: {
          category: "tool_failed",
          message: "Failed to inspect Git status.",
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
```

- [ ] **Step 6: Create `packages/tools/src/index.ts`**

```ts
export * from "./gitStatusTool.js";
export * from "./readFileTool.js";
export * from "./types.js";
```

- [ ] **Step 7: Create `packages/tools/src/readFileTool.test.ts`**

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readFileTool } from "./index.js";

describe("readFileTool", () => {
  it("reads a file inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello world", "utf8");

    const result = await readFileTool.run({ path: "hello.txt", maxBytes: 80_000 }, { workspaceRoot });

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "hello.txt",
        content: "hello world",
        truncated: false
      }
    });
  });

  it("rejects paths that escape the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));

    const result = await readFileTool.run({ path: "../outside.txt", maxBytes: 80_000 }, { workspaceRoot });

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 8: Refresh workspace links**

Run: `pnpm install`

Expected: pnpm links `@code-easy/tools` and its workspace dependencies without errors.

- [ ] **Step 9: Run tool tests**

Run: `pnpm --filter @code-easy/tools test`

Expected: both read file tests pass.

- [ ] **Step 10: Commit read-only tool package**

```bash
git add packages/tools
git commit -m "feat: add backend tool contracts"
```

### Task 5: Minimal LangGraph Agent Core

**Files:**

- Modify: `package.json`
- Create: `packages/agent-core/package.json`
- Create: `packages/agent-core/tsconfig.json`
- Create: `packages/agent-core/src/state.ts`
- Create: `packages/agent-core/src/graph.ts`
- Create: `packages/agent-core/src/index.ts`
- Create: `packages/agent-core/src/graph.test.ts`

- [ ] **Step 1: Add LangGraph dependency**

Run: `pnpm add -w @langchain/langgraph @langchain/core`

Expected: root `package.json` and `pnpm-lock.yaml` include LangGraph packages.

- [ ] **Step 2: Create `packages/agent-core/package.json`**

```json
{
  "name": "@code-easy/agent-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@langchain/core": "^1.0.0",
    "@langchain/langgraph": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Create `packages/agent-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Create `packages/agent-core/src/state.ts`**

```ts
import { Annotation } from "@langchain/langgraph";

export type PlanStep = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
};

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => []
  }),
  plan: Annotation<PlanStep[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),
  workspaceRoot: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => process.cwd()
  })
});

export type AgentState = typeof AgentStateAnnotation.State;
```

- [ ] **Step 5: Create `packages/agent-core/src/graph.ts`**

```ts
import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentStateAnnotation } from "./state.js";

export function createCodeEasyGraph() {
  return new StateGraph(AgentStateAnnotation)
    .addNode("intake", async (state) => {
      const lastMessage = state.messages.at(-1) ?? "";

      return {
        plan: [
          {
            id: "understand-request",
            title: lastMessage.length > 0 ? `Understand: ${lastMessage}` : "Understand the request",
            status: "completed" as const
          }
        ],
        messages: ["Runtime initialized."]
      };
    })
    .addEdge(START, "intake")
    .addEdge("intake", END)
    .compile();
}
```

- [ ] **Step 6: Create `packages/agent-core/src/index.ts`**

```ts
export * from "./graph.js";
export * from "./state.js";
```

- [ ] **Step 7: Create `packages/agent-core/src/graph.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { createCodeEasyGraph } from "./index.js";

describe("createCodeEasyGraph", () => {
  it("returns a minimal initialized plan", async () => {
    const graph = createCodeEasyGraph();
    const result = await graph.invoke({
      messages: ["Build a CLI"],
      workspaceRoot: "/tmp/project"
    });

    expect(result.plan).toEqual([
      {
        id: "understand-request",
        title: "Understand: Build a CLI",
        status: "completed"
      }
    ]);
    expect(result.messages).toContain("Runtime initialized.");
  });
});
```

- [ ] **Step 8: Refresh workspace links**

Run: `pnpm install`

Expected: pnpm links `@code-easy/agent-core` and installs LangGraph dependencies without errors.

- [ ] **Step 9: Run agent-core test**

Run: `pnpm --filter @code-easy/agent-core test`

Expected: graph smoke test passes.

- [ ] **Step 10: Commit LangGraph core**

```bash
git add package.json pnpm-lock.yaml packages/agent-core
git commit -m "feat: add minimal langgraph core"
```

### Task 6: Runtime Session Manager

**Files:**

- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/src/eventBus.ts`
- Create: `packages/runtime/src/sessionManager.ts`
- Create: `packages/runtime/src/index.ts`
- Create: `packages/runtime/src/sessionManager.test.ts`

- [ ] **Step 1: Create `packages/runtime/package.json`**

```json
{
  "name": "@code-easy/runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@code-easy/agent-core": "workspace:*",
    "@code-easy/ui-protocol": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `packages/runtime/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/runtime/src/eventBus.ts`**

```ts
import type { AgentEvent } from "@code-easy/ui-protocol";

export type AgentEventHandler = (event: AgentEvent) => void;

export class AgentEventBus {
  private readonly handlers = new Set<AgentEventHandler>();

  subscribe(handler: AgentEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(event: AgentEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
```

- [ ] **Step 4: Create `packages/runtime/src/sessionManager.ts`**

```ts
import { randomUUID } from "node:crypto";
import { createCodeEasyGraph } from "@code-easy/agent-core";
import { RuntimeCommandSchema, type AgentEvent, type RunCommand } from "@code-easy/ui-protocol";
import { AgentEventBus } from "./eventBus.js";

export type RunResult = {
  runId: string;
  threadId: string;
};

export class SessionManager {
  private readonly events = new AgentEventBus();

  subscribe(handler: (event: AgentEvent) => void): () => void {
    return this.events.subscribe(handler);
  }

  async run(commandInput: RunCommand): Promise<RunResult> {
    const command = RuntimeCommandSchema.parse(commandInput);

    if (command.kind !== "run") {
      throw new Error(`Unsupported command kind for run(): ${command.kind}`);
    }

    const runId = randomUUID();
    const threadId = command.threadId ?? randomUUID();

    this.events.publish({ type: "run.started", runId, threadId });
    this.events.publish({ type: "node.started", runId, node: "intake" });

    try {
      const graph = createCodeEasyGraph();
      const result = await graph.invoke({
        messages: [command.prompt],
        workspaceRoot: command.workspaceRoot
      });

      this.events.publish({ type: "node.completed", runId, node: "intake" });
      this.events.publish({
        type: "message.delta",
        runId,
        text: result.messages.at(-1) ?? "Runtime completed."
      });
      this.events.publish({
        type: "run.completed",
        runId,
        summary: `Initialized ${result.plan.length} plan step.`
      });

      return { runId, threadId };
    } catch (error) {
      this.events.publish({
        type: "run.failed",
        runId,
        error: {
          category: "runtime_failed",
          message: "Session run failed.",
          detail: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }
}
```

- [ ] **Step 5: Create `packages/runtime/src/index.ts`**

```ts
export * from "./eventBus.js";
export * from "./sessionManager.js";
```

- [ ] **Step 6: Create `packages/runtime/src/sessionManager.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { SessionManager } from "./index.js";

describe("SessionManager", () => {
  it("emits run lifecycle events", async () => {
    const manager = new SessionManager();
    const events: string[] = [];

    manager.subscribe((event) => {
      events.push(event.type);
    });

    await manager.run({
      kind: "run",
      workspaceRoot: process.cwd(),
      prompt: "Build a CLI"
    });

    expect(events).toEqual([
      "run.started",
      "node.started",
      "node.completed",
      "message.delta",
      "run.completed"
    ]);
  });
});
```

- [ ] **Step 7: Refresh workspace links**

Run: `pnpm install`

Expected: pnpm links `@code-easy/runtime` and local package dependencies without errors.

- [ ] **Step 8: Run runtime test**

Run: `pnpm --filter @code-easy/runtime test`

Expected: lifecycle event test passes.

- [ ] **Step 9: Commit runtime session manager**

```bash
git add packages/runtime
git commit -m "feat: add runtime session manager"
```

### Task 7: CLI Entry Point

**Files:**

- Modify: `package.json`
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/index.ts`

- [ ] **Step 1: Add CLI dependency**

Run: `pnpm add -w commander`

Expected: root `package.json` and `pnpm-lock.yaml` include `commander`.

- [ ] **Step 2: Create `apps/cli/package.json`**

```json
{
  "name": "@code-easy/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "code-easy": "dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --banner:js \"#!/usr/bin/env node\"",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@code-easy/runtime": "workspace:*",
    "@code-easy/ui-protocol": "workspace:*",
    "commander": "^14.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Create `apps/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Create `apps/cli/src/index.ts`**

```ts
#!/usr/bin/env node
import { program } from "commander";
import { SessionManager } from "@code-easy/runtime";

function renderEvent(event: { type: string; [key: string]: unknown }): void {
  switch (event.type) {
    case "run.started":
      console.log(`Run started: ${event.runId}`);
      break;
    case "node.started":
      console.log(`Node started: ${event.node}`);
      break;
    case "node.completed":
      console.log(`Node completed: ${event.node}`);
      break;
    case "message.delta":
      process.stdout.write(String(event.text));
      process.stdout.write("\n");
      break;
    case "run.completed":
      console.log(`Run completed: ${event.summary}`);
      break;
    case "run.failed":
      console.error(`Run failed: ${JSON.stringify(event.error)}`);
      break;
    default:
      console.log(JSON.stringify(event));
  }
}

program
  .name("code-easy")
  .description("Local TypeScript coding agent")
  .version("0.0.0");

program
  .command("run")
  .argument("<prompt>", "Task to run")
  .option("-w, --workspace <path>", "Workspace root", process.cwd())
  .action(async (prompt: string, options: { workspace: string }) => {
    const manager = new SessionManager();
    manager.subscribe(renderEvent);

    await manager.run({
      kind: "run",
      workspaceRoot: options.workspace,
      prompt
    });
  });

program.action(() => {
  program.help();
});

await program.parseAsync(process.argv);
```

- [ ] **Step 5: Refresh workspace links**

Run: `pnpm install`

Expected: pnpm links `@code-easy/cli`, `@code-easy/runtime`, and `@code-easy/ui-protocol` without errors.

- [ ] **Step 6: Run CLI in dev mode**

Run: `pnpm --filter @code-easy/cli dev -- run "Build a CLI"`

Expected output includes these lines:

```text
Run started:
Node started: intake
Node completed: intake
Runtime initialized.
Run completed: Initialized 1 plan step.
```

- [ ] **Step 7: Build CLI**

Run: `pnpm --filter @code-easy/cli build`

Expected: `apps/cli/dist/index.js` exists and starts with a Node shebang.

- [ ] **Step 8: Commit CLI entry point**

```bash
git add package.json pnpm-lock.yaml apps/cli
git commit -m "feat: add cli entry point"
```

### Task 8: Workspace Verification

**Files:**

- Modify: files changed by formatting or package manager lock updates only.

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: all workspace tests pass.

- [ ] **Step 2: Run all type checks**

Run: `pnpm typecheck`

Expected: all packages typecheck without errors.

- [ ] **Step 3: Run all builds**

Run: `pnpm build`

Expected: every package produces a `dist` directory.

- [ ] **Step 4: Check Git status**

Run: `git status --short`

Expected: no unstaged changes except intentional build artifacts if `dist` is ignored by `.gitignore`.

- [ ] **Step 5: Add a verification note to the final implementation response**

Report the exact commands run and whether each passed:

```text
Verification:
- pnpm test: PASS
- pnpm typecheck: PASS
- pnpm build: PASS
- pnpm --filter @code-easy/cli dev -- run "Build a CLI": PASS
```

## Plan Self-Review

- Spec coverage: this plan covers the first executable slice from the spec: monorepo, shared protocol, backend boundary, permission policy, read-only tools, minimal LangGraph runtime, and CLI entry.
- Frontend/backend constraints: CLI consumes runtime and protocol only; backend packages own graph, tools, and side effects.
- Scope control: desktop, SQLite persistence, write tools, shell execution, approvals, MCP, and profiles are intentionally left for later dedicated plans.
- Type consistency: event, command, permission, and tool names match across package boundaries.
- Test coverage: every package introduced here includes at least one focused test, and workspace-level verification is required before completion.
