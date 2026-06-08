import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SessionManager } from "./index.js";
import type { AgentEvent } from "@code-easy/ui-protocol";
import type { SessionStore, RunStartedRecord, RunCompletedRecord, StoredEventRecord } from "@code-easy/storage";

const execFileAsync = promisify(execFile);

class CapturingStore implements SessionStore {
  readonly startedRuns: RunStartedRecord[] = [];
  readonly completedRuns: RunCompletedRecord[] = [];
  readonly events: StoredEventRecord[] = [];

  async recordRunStarted(record: RunStartedRecord): Promise<void> {
    this.startedRuns.push(record);
  }

  async recordRunCompleted(record: RunCompletedRecord): Promise<void> {
    this.completedRuns.push(record);
  }

  async recordEvent(event: AgentEvent): Promise<void> {
    this.events.push({
      sequence: this.events.length + 1,
      event
    });
  }
}

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

    expect(events[0]).toBe("run.started");
    expect(events).toContain("node.started");
    expect(events).toContain("node.completed");
    expect(events).toContain("tool.started");
    expect(events).toContain("tool.completed");
    expect(events).toContain("message.delta");
    expect(events.at(-1)).toBe("run.completed");
  });

  it("runs a deterministic read-only tool loop for run commands", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-loop-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "README.md"), "SessionManager loop context\n", "utf8");
    const manager = new SessionManager();
    const events: AgentEvent[] = [];

    manager.subscribe((event) => {
      events.push(event);
    });

    await manager.run({
      kind: "run",
      workspaceRoot,
      prompt: "Find SessionManager"
    });

    const toolNames = events.flatMap((event) => (event.type === "tool.started" ? [event.call.name] : []));
    const messageText = events
      .filter((event) => event.type === "message.delta")
      .map((event) => event.text)
      .join("\n");

    expect(toolNames).toEqual(["git_status", "list_files", "rg_search"]);
    expect(messageText).toContain("Workspace context");
    expect(messageText).toContain("README.md");
    expect(messageText).toContain("SessionManager");
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      summary: "Workspace inspection completed."
    });
  });

  it("persists run metadata and event stream when a session store is configured", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-persist-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "README.md"), "SessionManager persistence context\n", "utf8");
    const store = new CapturingStore();
    const manager = new SessionManager({ store });

    const result = await manager.run({
      kind: "run",
      workspaceRoot,
      prompt: "Find SessionManager"
    });

    expect(store.startedRuns).toEqual([
      expect.objectContaining({
        runId: result.runId,
        threadId: result.threadId,
        workspaceRoot,
        prompt: "Find SessionManager"
      })
    ]);
    expect(store.events.map((record) => record.event.type)).toContain("message.delta");
    expect(store.events.at(-1)?.event).toMatchObject({
      type: "run.completed",
      runId: result.runId
    });
    expect(store.completedRuns).toEqual([
      expect.objectContaining({
        runId: result.runId,
        status: "completed",
        summary: "Workspace inspection completed."
      })
    ]);
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

  it("runs default search tools without requesting approval", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-runtime-"));
    await writeFile(path.join(workspaceRoot, "README.md"), "hello search\n", "utf8");
    const manager = new SessionManager();
    const events: AgentEvent[] = [];

    manager.subscribe((event) => {
      events.push(event);
    });

    const result = await manager.runTool({
      workspaceRoot,
      toolName: "rg_search",
      input: { pattern: "search", path: ".", maxMatches: 10 }
    });

    expect(result.outcome.status).toBe("completed");
    expect(events.map((event) => event.type)).toEqual(["run.started", "tool.started", "tool.completed", "run.completed"]);
    expect(events[1]).toMatchObject({
      type: "tool.started",
      call: {
        name: "rg_search",
        risk: "read"
      }
    });
    expect(events[2]).toMatchObject({
      type: "tool.completed",
      result: {
        name: "rg_search",
        ok: true,
        output: {
          matches: [
            {
              path: "README.md",
              line: 1,
              text: "hello search"
            }
          ]
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
