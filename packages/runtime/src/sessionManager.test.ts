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

    expect(events).toEqual(["run.started", "node.started", "node.completed", "message.delta", "run.completed"]);
  });
});
