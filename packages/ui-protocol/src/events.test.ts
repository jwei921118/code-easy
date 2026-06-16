import { describe, expect, it } from "vitest";
import { AgentEventSchema, ApprovalDecisionSchema, RuntimeCommandSchema } from "./index.js";

describe("ui protocol", () => {
  it("validates a run started event", () => {
    const event = AgentEventSchema.parse({
      type: "run.started",
      runId: "run-1",
      threadId: "thread-1"
    });

    expect(event.runId).toBe("run-1");
  });

  it("rejects an empty run prompt", () => {
    expect(() =>
      RuntimeCommandSchema.parse({
        kind: "run",
        workspaceRoot: "/tmp/project",
        prompt: ""
      })
    ).toThrow();
  });

  it("rejects extra keys in run commands", () => {
    expect(() =>
      RuntimeCommandSchema.parse({
        kind: "run",
        workspaceRoot: "/tmp/project",
        prompt: "start",
        extra: true
      })
    ).toThrow();
  });

  it("requires an error for failed tool results", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "tool.completed",
        runId: "run-1",
        result: {
          toolCallId: "tool-1",
          name: "shell",
          ok: false,
          finishedAt: "2026-05-26T00:00:00.000Z"
        }
      })
    ).toThrow();
  });

  it("rejects errors on successful tool results", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "tool.completed",
        runId: "run-1",
        result: {
          toolCallId: "tool-1",
          name: "shell",
          ok: true,
          output: "done",
          error: {
            category: "tool_failed",
            message: "failed"
          },
          finishedAt: "2026-05-26T00:00:00.000Z"
        }
      })
    ).toThrow();
  });

  it("rejects output on failed tool results", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "tool.completed",
        runId: "run-1",
        result: {
          toolCallId: "tool-1",
          name: "shell",
          ok: false,
          output: "partial output",
          error: {
            category: "tool_failed",
            message: "failed"
          },
          finishedAt: "2026-05-26T00:00:00.000Z"
        }
      })
    ).toThrow();
  });

  it("validates approval requests without nested request run ids", () => {
    const event = AgentEventSchema.parse({
      type: "approval.requested",
      runId: "run-1",
      request: {
        approvalId: "approval-1",
        reason: "Needs command access",
        risk: "execute",
        toolName: "shell"
      }
    });

    expect(event.type).toBe("approval.requested");
    if (event.type !== "approval.requested") {
      throw new Error("Expected approval requested event");
    }
    expect(event.request.approvalId).toBe("approval-1");
  });

  it("rejects approval requests with nested request run ids", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "approval.requested",
        runId: "run-1",
        request: {
          approvalId: "approval-1",
          runId: "run-1",
          reason: "Needs command access",
          risk: "execute",
          toolName: "shell"
        }
      })
    ).toThrow();
  });

  it("rejects whitespace-only run prompts", () => {
    expect(() =>
      RuntimeCommandSchema.parse({
        kind: "run",
        workspaceRoot: "/tmp/project",
        prompt: "   "
      })
    ).toThrow();
  });

  it("preserves spacing in valid run prompts", () => {
    const command = RuntimeCommandSchema.parse({
      kind: "run",
      workspaceRoot: "/tmp/project",
      prompt: "  keep spacing  "
    });

    expect(command.kind).toBe("run");
    if (command.kind !== "run") {
      throw new Error("Expected run command");
    }
    expect(command.prompt).toBe("  keep spacing  ");
  });

  it("rejects whitespace-only optional resume prompts", () => {
    expect(() =>
      RuntimeCommandSchema.parse({
        kind: "resume",
        threadId: "thread-1",
        prompt: "   "
      })
    ).toThrow();
  });

  it("rejects blank workspace roots", () => {
    expect(() =>
      RuntimeCommandSchema.parse({
        kind: "run",
        workspaceRoot: " ",
        prompt: "start"
      })
    ).toThrow();
  });

  it("rejects blank ids", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "run.started",
        runId: " ",
        threadId: "thread-1"
      })
    ).toThrow();
  });

  it("rejects extra top-level keys in run started events", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "run.started",
        runId: "run-1",
        threadId: "thread-1",
        extra: true
      })
    ).toThrow();
  });

  it("rejects extra keys in tool calls", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "tool.started",
        runId: "run-1",
        call: {
          toolCallId: "tool-1",
          name: "shell",
          risk: "execute",
          input: {},
          startedAt: "2026-05-26T00:00:00.000Z",
          extra: true
        }
      })
    ).toThrow();
  });

  it("rejects extra keys in approval decisions", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "approval.resolved",
        runId: "run-1",
        decision: {
          approvalId: "approval-1",
          approved: true,
          extra: true
        }
      })
    ).toThrow();
  });

  it("rejects blank tool names", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "tool.started",
        runId: "run-1",
        call: {
          toolCallId: "tool-1",
          name: " ",
          risk: "execute",
          input: {},
          startedAt: "2026-05-26T00:00:00.000Z"
        }
      })
    ).toThrow();
  });

  it("rejects blank agent error messages", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "run.failed",
        runId: "run-1",
        error: {
          category: "runtime_failed",
          message: " "
        }
      })
    ).toThrow();
  });

  it("rejects blank approval request reasons", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "approval.requested",
        runId: "run-1",
        request: {
          approvalId: "approval-1",
          reason: " ",
          risk: "execute",
          toolName: "shell"
        }
      })
    ).toThrow();
  });

  it("rejects blank run completed summaries", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "run.completed",
        runId: "run-1",
        summary: " "
      })
    ).toThrow();
  });

  it("rejects invalid tool start datetimes", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "tool.started",
        runId: "run-1",
        call: {
          toolCallId: "tool-1",
          name: "shell",
          risk: "execute",
          input: {},
          startedAt: "not-a-date"
        }
      })
    ).toThrow();
  });

  it("rejects invalid tool result datetimes", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "tool.completed",
        runId: "run-1",
        result: {
          toolCallId: "tool-1",
          name: "shell",
          ok: true,
          finishedAt: "not-a-date"
        }
      })
    ).toThrow();
  });

  it("defaults approval decisions to not remember for the session", () => {
    const decision = ApprovalDecisionSchema.parse({
      approvalId: "approval-1",
      approved: true
    });

    expect(decision.rememberForSession).toBe(false);
  });

  it("validates a run paused event for pending approval", () => {
    const event = AgentEventSchema.parse({
      type: "run.paused",
      runId: "run-1",
      reason: "approval_required",
      approvalId: "approval-1"
    });

    expect(event).toEqual({
      type: "run.paused",
      runId: "run-1",
      reason: "approval_required",
      approvalId: "approval-1"
    });
  });
});
