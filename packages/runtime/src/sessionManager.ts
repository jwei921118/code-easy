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
