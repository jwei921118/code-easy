import { randomUUID } from "node:crypto";
import { createCodeEasyGraph } from "@code-easy/agent-core";
import { RuntimeCommandSchema, type AgentEvent, type RunCommand } from "@code-easy/ui-protocol";
import { AgentEventBus } from "./eventBus.js";
import { PermissionedToolExecutor, type ToolExecutionOutcome } from "./toolExecutor.js";
import { createDefaultToolRegistry, type ToolRegistry } from "./toolRegistry.js";

export type RunResult = {
  runId: string;
  threadId: string;
};

export type RunToolCommand = {
  threadId?: string;
  workspaceRoot: string;
  toolName: string;
  input: unknown;
  approved?: boolean;
};

export type RunToolResult = RunResult & {
  outcome: ToolExecutionOutcome;
};

export type SessionManagerOptions = {
  tools?: ToolRegistry;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractSearchPattern(prompt: string): string {
  const quoted = prompt.match(/["']([^"']+)["']/);
  if (quoted?.[1]) return quoted[1];

  const stopWords = new Set(["find", "search", "inspect", "check", "project", "workspace", "code", "for", "the"]);
  const tokens = prompt.match(/[A-Za-z0-9_-]{3,}/g) ?? [];
  const candidate = tokens.find((token) => !stopWords.has(token.toLowerCase()));

  return candidate ?? tokens[0] ?? prompt.trim();
}

function summarizeGitStatus(output: unknown): string {
  if (!isRecord(output) || typeof output.stdout !== "string") return "Git status unavailable.";

  const status = output.stdout.trim();
  return status === "" ? "Git status: clean." : `Git status:\n${status}`;
}

function summarizeFiles(output: unknown): string {
  if (!isRecord(output) || !Array.isArray(output.files)) return "Files unavailable.";

  const files = output.files.filter((file): file is string => typeof file === "string").slice(0, 10);
  return files.length === 0 ? "Files: none found." : `Files:\n${files.map((file) => `- ${file}`).join("\n")}`;
}

function summarizeSearch(pattern: string, output: unknown): string {
  if (!isRecord(output) || !Array.isArray(output.matches)) return `Search matches for "${pattern}": unavailable.`;

  const matches = output.matches.filter(isRecord).slice(0, 5);
  if (matches.length === 0) return `Search matches for "${pattern}": none.`;

  return `Search matches for "${pattern}":\n${matches
    .map((match) => {
      const filePath = typeof match.path === "string" ? match.path : "unknown";
      const line = typeof match.line === "number" ? match.line : 0;
      const text = typeof match.text === "string" ? match.text : "";
      return `- ${filePath}:${line} ${text}`;
    })
    .join("\n")}`;
}

export class SessionManager {
  private readonly events = new AgentEventBus();
  private readonly tools: ToolRegistry;

  constructor(options: SessionManagerOptions = {}) {
    this.tools = options.tools ?? createDefaultToolRegistry();
  }

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
      this.events.publish({ type: "node.started", runId, node: "context_builder" });

      const searchPattern = extractSearchPattern(command.prompt);
      const gitStatus = await this.executeToolForRun(runId, command.workspaceRoot, "git_status", { porcelain: true });
      const fileList = await this.executeToolForRun(runId, command.workspaceRoot, "list_files", {
        path: ".",
        limit: 50,
        includeHidden: false
      });
      const searchResults = await this.executeToolForRun(runId, command.workspaceRoot, "rg_search", {
        pattern: searchPattern,
        path: ".",
        maxMatches: 10,
        caseSensitive: true
      });

      this.events.publish({ type: "node.completed", runId, node: "context_builder" });
      this.events.publish({
        type: "message.delta",
        runId,
        text: [
          "Workspace context",
          summarizeGitStatus(gitStatus),
          summarizeFiles(fileList),
          summarizeSearch(searchPattern, searchResults),
          result.messages.at(-1) ?? "Runtime completed."
        ].join("\n\n")
      });
      this.events.publish({
        type: "run.completed",
        runId,
        summary: "Workspace inspection completed."
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

  private async executeToolForRun(runId: string, workspaceRoot: string, toolName: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    let output: unknown;
    const unsubscribe = this.events.subscribe((event) => {
      if (event.type === "tool.completed" && event.runId === runId && event.result.name === toolName && event.result.ok) {
        output = event.result.output;
      }
    });

    try {
      const executor = new PermissionedToolExecutor(this.events);
      const outcome = await executor.execute({
        runId,
        workspaceRoot,
        tool,
        input
      });

      if (outcome.status !== "completed") {
        throw new Error(`Tool ${toolName} unexpectedly required approval.`);
      }

      return output;
    } finally {
      unsubscribe();
    }
  }

  async runTool(command: RunToolCommand): Promise<RunToolResult> {
    const runId = randomUUID();
    const threadId = command.threadId ?? randomUUID();
    const tool = this.tools.get(command.toolName);

    this.events.publish({ type: "run.started", runId, threadId });

    if (!tool) {
      const error = {
        category: "invalid_tool_call" as const,
        message: `Unknown tool: ${command.toolName}`
      };
      this.events.publish({ type: "run.failed", runId, error });
      throw new Error(error.message);
    }

    try {
      const executor = new PermissionedToolExecutor(this.events);
      const outcome = await executor.execute({
        runId,
        workspaceRoot: command.workspaceRoot,
        tool,
        input: command.input,
        approved: command.approved
      });

      if (outcome.status === "completed") {
        this.events.publish({
          type: "run.completed",
          runId,
          summary: `Tool ${command.toolName} completed.`
        });
      }

      return { runId, threadId, outcome };
    } catch (error) {
      this.events.publish({
        type: "run.failed",
        runId,
        error: {
          category: "runtime_failed",
          message: `Tool ${command.toolName} failed.`,
          detail: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }
}
