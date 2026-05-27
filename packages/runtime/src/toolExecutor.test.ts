import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentEventBus, PermissionedToolExecutor } from "./index.js";
import type { CodeEasyTool } from "@code-easy/tools";
import type { AgentEvent } from "@code-easy/ui-protocol";

const InputSchema = z.strictObject({
  value: z.string()
});

function createTool(name: string, risk: "read" | "write"): CodeEasyTool<typeof InputSchema, { value: string }> {
  return {
    name,
    risk,
    description: `${name} test tool`,
    inputSchema: InputSchema,
    async run(input) {
      return { ok: true, output: { value: input.value } };
    }
  };
}

describe("PermissionedToolExecutor", () => {
  it("executes read tools without requesting approval", async () => {
    const events: AgentEvent[] = [];
    const bus = new AgentEventBus();
    bus.subscribe((event) => events.push(event));
    const executor = new PermissionedToolExecutor(bus);

    const result = await executor.execute({
      runId: "run-1",
      workspaceRoot: process.cwd(),
      tool: createTool("read_file", "read"),
      input: { value: "hello" }
    });

    expect(result.status).toBe("completed");
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.completed"]);
    expect(events[0]).toMatchObject({
      type: "tool.started",
      runId: "run-1",
      call: {
        name: "read_file",
        risk: "read",
        input: { value: "hello" }
      }
    });
    expect(events[1]).toMatchObject({
      type: "tool.completed",
      runId: "run-1",
      result: {
        name: "read_file",
        ok: true,
        output: { value: "hello" }
      }
    });
  });

  it("requests approval before write tools", async () => {
    const events: AgentEvent[] = [];
    const bus = new AgentEventBus();
    bus.subscribe((event) => events.push(event));
    const executor = new PermissionedToolExecutor(bus);

    const result = await executor.execute({
      runId: "run-1",
      workspaceRoot: process.cwd(),
      tool: createTool("apply_patch", "write"),
      input: { value: "hello" }
    });

    expect(result.status).toBe("approval_required");
    if (result.status !== "approval_required") {
      throw new Error(`Expected approval_required, received ${result.status}`);
    }
    expect(events).toEqual([
      {
        type: "approval.requested",
        runId: "run-1",
        request: {
          approvalId: result.approvalId,
          reason: "Tool apply_patch has write risk and requires user approval.",
          risk: "write",
          toolName: "apply_patch"
        }
      }
    ]);
  });

  it("executes write tools after approval", async () => {
    const events: AgentEvent[] = [];
    const bus = new AgentEventBus();
    bus.subscribe((event) => events.push(event));
    const executor = new PermissionedToolExecutor(bus);

    const result = await executor.execute({
      runId: "run-1",
      workspaceRoot: process.cwd(),
      tool: createTool("apply_patch", "write"),
      input: { value: "hello" },
      approved: true
    });

    expect(result.status).toBe("completed");
    expect(events.map((event) => event.type)).toEqual(["approval.resolved", "tool.started", "tool.completed"]);
    expect(events[0]).toMatchObject({
      type: "approval.resolved",
      runId: "run-1",
      decision: {
        approved: true,
        rememberForSession: false
      }
    });
    expect(events[1]).toMatchObject({
      type: "tool.started",
      runId: "run-1",
      call: {
        name: "apply_patch",
        risk: "write",
        input: { value: "hello" }
      }
    });
    expect(events[2]).toMatchObject({
      type: "tool.completed",
      runId: "run-1",
      result: {
        name: "apply_patch",
        ok: true,
        output: { value: "hello" }
      }
    });
  });
});
