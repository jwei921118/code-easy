import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "./index.js";
import type { AgentEvent } from "@code-easy/ui-protocol";

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

  it("runs default read tools through the permissioned executor", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-runtime-"));
    await writeFile(path.join(workspaceRoot, "README.md"), "hello runtime\n", "utf8");
    const manager = new SessionManager();
    const events: AgentEvent[] = [];

    manager.subscribe((event) => {
      events.push(event);
    });

    const result = await manager.runTool({
      workspaceRoot,
      toolName: "read_file",
      input: { path: "README.md" }
    });

    expect(result.outcome.status).toBe("completed");
    expect(events.map((event) => event.type)).toEqual(["run.started", "tool.started", "tool.completed", "run.completed"]);
    expect(events[1]).toMatchObject({
      type: "tool.started",
      call: {
        name: "read_file",
        risk: "read",
        input: { path: "README.md", maxBytes: 80000 }
      }
    });
    expect(events[2]).toMatchObject({
      type: "tool.completed",
      result: {
        name: "read_file",
        ok: true,
        output: {
          path: "README.md",
          content: "hello runtime\n",
          truncated: false
        }
      }
    });
  });

  it("requests approval when default write tools are run without approval", async () => {
    const manager = new SessionManager();
    const events: AgentEvent[] = [];

    manager.subscribe((event) => {
      events.push(event);
    });

    const result = await manager.runTool({
      workspaceRoot: process.cwd(),
      toolName: "apply_patch",
      input: {
        path: "package.json",
        oldText: "\"name\": \"code-easy\"",
        newText: "\"name\": \"code-easy\""
      }
    });

    expect(result.outcome.status).toBe("approval_required");
    expect(events.map((event) => event.type)).toEqual(["run.started", "approval.requested"]);
    expect(events[1]).toMatchObject({
      type: "approval.requested",
      request: {
        risk: "write",
        toolName: "apply_patch"
      }
    });
  });

  it("requests approval when default execute tools are run without approval", async () => {
    const manager = new SessionManager();
    const events: AgentEvent[] = [];

    manager.subscribe((event) => {
      events.push(event);
    });

    const result = await manager.runTool({
      workspaceRoot: process.cwd(),
      toolName: "run_command",
      input: {
        command: process.execPath,
        args: ["-e", "console.log('hello')"]
      }
    });

    expect(result.outcome.status).toBe("approval_required");
    expect(events.map((event) => event.type)).toEqual(["run.started", "approval.requested"]);
    expect(events[1]).toMatchObject({
      type: "approval.requested",
      request: {
        risk: "execute",
        toolName: "run_command"
      }
    });
  });
});
