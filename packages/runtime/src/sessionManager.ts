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
