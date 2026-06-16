import { describe, expect, it } from "vitest";
import { continueAfterApprovalPrompt } from "./approvalFlow.js";

describe("approval flow", () => {
  it("continues an approval-required run when interactive prompting is enabled", async () => {
    const approvals: unknown[] = [];
    const result = await continueAfterApprovalPrompt({
      manager: {
        async approve(command: unknown) {
          approvals.push(command);
          return {
            runId: "run-1",
            threadId: "thread-1",
            status: "completed"
          };
        }
      },
      workspaceRoot: "/workspace",
      result: {
        runId: "run-1",
        threadId: "thread-1",
        status: "approval_required",
        approvalId: "approval-1"
      },
      shouldPrompt: true,
      prompt: async (approvalId) => {
        expect(approvalId).toBe("approval-1");
        return true;
      }
    });

    expect(result).toMatchObject({
      runId: "run-1",
      threadId: "thread-1",
      status: "completed"
    });
    expect(approvals).toEqual([
      {
        workspaceRoot: "/workspace",
        approvalId: "approval-1",
        approved: true
      }
    ]);
  });

  it("leaves an approval-required run paused when prompting is disabled", async () => {
    const result = await continueAfterApprovalPrompt({
      manager: {
        async approve() {
          throw new Error("approve should not be called");
        }
      },
      workspaceRoot: "/workspace",
      result: {
        runId: "run-1",
        threadId: "thread-1",
        status: "approval_required",
        approvalId: "approval-1"
      },
      shouldPrompt: false,
      prompt: async () => true
    });

    expect(result).toMatchObject({
      runId: "run-1",
      threadId: "thread-1",
      status: "approval_required",
      approvalId: "approval-1"
    });
  });
});
