import type { AgentEvent } from "@code-easy/ui-protocol";

export type AgentEventHandler = (event: AgentEvent) => void;

/** 在运行时内部广播 Agent 事件，供 CLI、存储和未来客户端订阅。 */
export class AgentEventBus {
  private readonly handlers = new Set<AgentEventHandler>();

  /** 注册一个事件处理器，并返回用于取消订阅的函数。 */
  subscribe(handler: AgentEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** 将事件同步分发给当前所有订阅者。 */
  publish(event: AgentEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
