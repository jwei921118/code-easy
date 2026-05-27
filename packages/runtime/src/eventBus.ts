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
