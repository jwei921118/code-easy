import type { RunResult, SessionManager } from "@code-easy/runtime";

type ApprovalPrompt = (approvalId: string) => Promise<boolean>;

type ApprovalFlowManager = Pick<SessionManager, "approve">;

type ContinueAfterApprovalPromptInput = {
  manager: ApprovalFlowManager;
  workspaceRoot: string;
  result: RunResult;
  shouldPrompt: boolean;
  prompt: ApprovalPrompt;
};

export async function continueAfterApprovalPrompt(
  input: ContinueAfterApprovalPromptInput
): Promise<RunResult> {
  if (input.result.status !== "approval_required" || input.result.approvalId === undefined || !input.shouldPrompt) {
    return input.result;
  }

  const approved = await input.prompt(input.result.approvalId);

  return input.manager.approve({
    workspaceRoot: input.workspaceRoot,
    approvalId: input.result.approvalId,
    approved
  });
}
