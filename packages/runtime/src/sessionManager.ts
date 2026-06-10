import { randomUUID } from "node:crypto";
import path from "node:path";
import { createCodeEasyGraph } from "@code-easy/agent-core";
import { SqliteSessionStore, type SessionStore, type StoredSessionSummary } from "@code-easy/storage";
import { RuntimeCommandSchema, type AgentEvent, type RunCommand } from "@code-easy/ui-protocol";
import { AgentEventBus } from "./eventBus.js";
import {
  buildWorkspaceContextMessages,
  type ModelProvider,
  type ModelToolCall,
  type ModelToolResult
} from "./modelProvider.js";
import { getModelCallableTool, modelToolDefinitions } from "./modelToolSchemas.js";
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

export type WorkspaceSessionCommand = {
  workspaceRoot: string;
};

export type ResumeSessionCommand = WorkspaceSessionCommand & {
  threadId: string;
  prompt?: string;
};

export type SessionManagerOptions = {
  tools?: ToolRegistry;
  store?: SessionStore | false;
  modelProvider?: ModelProvider | false;
  model?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractSearchPattern(prompt: string): string {
  const quoted = prompt.match(/["']([^"']+)["']/);
  if (quoted?.[1]) return quoted[1];

  const stopWords = new Set(["find", "search", "inspect", "check", "explain", "project", "workspace", "code", "for", "the"]);
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
  private readonly configuredStore?: SessionStore | false;
  private readonly modelProvider?: ModelProvider | false;
  private readonly model: string;

  constructor(options: SessionManagerOptions = {}) {
    this.tools = options.tools ?? createDefaultToolRegistry();
    this.configuredStore = options.store;
    this.modelProvider = options.modelProvider;
    this.model = options.model ?? "gpt-5-mini";
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
    const store = await this.getStore(command.workspaceRoot);
    const persist = this.captureStoredEvents(store);

    await store?.recordRunStarted({
      runId,
      threadId,
      workspaceRoot: command.workspaceRoot,
      prompt: command.prompt,
      startedAt: new Date().toISOString()
    });

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
      const gitStatusSummary = summarizeGitStatus(gitStatus);
      const fileSummary = summarizeFiles(fileList);
      const searchSummary = summarizeSearch(searchPattern, searchResults);
      const graphMessage = result.messages.at(-1) ?? "Runtime completed.";
      let messageText: string | undefined;
      let summary: string | undefined;

      if (this.modelProvider) {
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
      } else {
        messageText = ["Workspace context", gitStatusSummary, fileSummary, searchSummary, graphMessage].join("\n\n");
        summary = "Workspace inspection completed.";
      }

      this.events.publish({ type: "node.completed", runId, node: "context_builder" });
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
      await store?.recordRunCompleted({
        runId,
        status: "completed",
        completedAt: new Date().toISOString(),
        summary
      });
      await persist.flush();

      return { runId, threadId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.events.publish({
        type: "run.failed",
        runId,
        error: {
          category: "runtime_failed",
          message: "Session run failed.",
          detail
        }
      });
      await store?.recordRunCompleted({
        runId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: detail
      });
      await persist.flush();
      throw error;
    } finally {
      persist.unsubscribe();
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

    let completedResult: unknown;
    const unsubscribe = this.events.subscribe((event) => {
      if (event.type === "tool.completed" && event.runId === runId && event.result.name === call.name) {
        completedResult = event.result;
      }
    });

    const executor = new PermissionedToolExecutor(this.events);
    try {
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
        output: JSON.stringify(completedResult)
      };
    } finally {
      unsubscribe();
    }
  }

  async runTool(command: RunToolCommand): Promise<RunToolResult> {
    const runId = randomUUID();
    const threadId = command.threadId ?? randomUUID();
    const tool = this.tools.get(command.toolName);
    const store = await this.getStore(command.workspaceRoot);
    const persist = this.captureStoredEvents(store);

    await store?.recordRunStarted({
      runId,
      threadId,
      workspaceRoot: command.workspaceRoot,
      prompt: `tool:${command.toolName}`,
      startedAt: new Date().toISOString()
    });

    this.events.publish({ type: "run.started", runId, threadId });

    if (!tool) {
      const error = {
        category: "invalid_tool_call" as const,
        message: `Unknown tool: ${command.toolName}`
      };
      this.events.publish({ type: "run.failed", runId, error });
      await store?.recordRunCompleted({
        runId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error.message
      });
      await persist.flush();
      persist.unsubscribe();
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
        await store?.recordRunCompleted({
          runId,
          status: "completed",
          completedAt: new Date().toISOString(),
          summary: `Tool ${command.toolName} completed.`
        });
      }

      await persist.flush();
      return { runId, threadId, outcome };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.events.publish({
        type: "run.failed",
        runId,
        error: {
          category: "runtime_failed",
          message: `Tool ${command.toolName} failed.`,
          detail
        }
      });
      await store?.recordRunCompleted({
        runId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: detail
      });
      await persist.flush();
      throw error;
    } finally {
      persist.unsubscribe();
    }
  }

  async listSessions(command: WorkspaceSessionCommand): Promise<StoredSessionSummary[]> {
    const store = await this.getStore(command.workspaceRoot);
    return (await store?.listSessions()) ?? [];
  }

  async resume(command: ResumeSessionCommand): Promise<StoredSessionSummary | RunResult> {
    const store = await this.getStore(command.workspaceRoot);
    if (!store) {
      throw new Error("Session storage is disabled.");
    }

    const sessions = await store.listSessions();
    const session = sessions.find((candidate) => candidate.threadId === command.threadId);
    if (!session) {
      throw new Error(`Unknown thread: ${command.threadId}`);
    }

    if (command.prompt !== undefined) {
      return this.run({
        kind: "run",
        workspaceRoot: command.workspaceRoot,
        threadId: command.threadId,
        prompt: command.prompt
      });
    }

    const runIds = session.runIds.length > 0 ? session.runIds : [session.runId];
    const events = (await Promise.all(runIds.map((runId) => store.listEvents(runId))))
      .flat()
      .sort((left, right) => left.sequence - right.sequence);

    for (const record of events) {
      this.events.publish(record.event);
    }

    return session;
  }

  private async getStore(workspaceRoot: string): Promise<SessionStore | undefined> {
    if (this.configuredStore === false) return undefined;
    if (this.configuredStore) return this.configuredStore;
    return SqliteSessionStore.open(path.join(workspaceRoot, ".code-easy", "local"));
  }

  private captureStoredEvents(store: SessionStore | undefined): {
    flush: () => Promise<void>;
    unsubscribe: () => void;
  } {
    if (!store) {
      return {
        flush: async () => {},
        unsubscribe: () => {}
      };
    }

    const writes: Promise<void>[] = [];
    const unsubscribe = this.events.subscribe((event) => {
      writes.push(store.recordEvent(event));
    });

    return {
      flush: async () => {
        await Promise.all(writes);
      },
      unsubscribe
    };
  }
}
