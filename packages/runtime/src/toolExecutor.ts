import { randomUUID } from "node:crypto";
import { decidePermission, type ToolRisk } from "@code-easy/permissions";
import type { CodeEasyTool, ToolContext } from "@code-easy/tools";
import type { AgentError, AgentEvent, ApprovalDecision, ApprovalRequest, ToolCallView, ToolResultView } from "@code-easy/ui-protocol";
import type { z } from "zod";
import { AgentEventBus } from "./eventBus.js";

type ApprovalRisk = Exclude<ToolRisk, "read">;

export type ToolExecutionRequest<TInputSchema extends z.ZodTypeAny, TOutput> = {
  runId: string;
  workspaceRoot: string;
  tool: CodeEasyTool<TInputSchema, TOutput>;
  input: unknown;
  approved?: boolean;
  approvalId?: string;
};

export type ToolExecutionOutcome =
  | { status: "approval_required"; approvalId: string }
  | { status: "completed"; toolCallId: string };

/** 生成统一 ISO 时间戳，保证工具事件时间格式一致。 */
function nowIso(): string {
  return new Date().toISOString();
}

/** 判断工具风险是否需要用户审批。 */
function isApprovalRisk(risk: ToolRisk): risk is ApprovalRisk {
  return risk !== "read";
}

/** 将工具层错误归一化为 UI 协议中的 AgentError。 */
function toAgentError(error: { category: "tool_failed" | "timeout" | "denied"; message: string; detail?: string }): AgentError {
  return {
    category: error.category,
    message: error.message,
    detail: error.detail
  };
}

/** 负责执行工具，并在执行前后发出审批、开始和完成事件。 */
export class PermissionedToolExecutor {
  /** 注入事件总线，让执行器可以把工具生命周期广播给外部。 */
  constructor(private readonly events: AgentEventBus) {}

  /** 执行单次工具调用；写入/执行风险工具会先返回审批请求。 */
  async execute<TInputSchema extends z.ZodTypeAny, TOutput>(
    request: ToolExecutionRequest<TInputSchema, TOutput>
  ): Promise<ToolExecutionOutcome> {
    const decision = decidePermission(request.tool.name);
    const approvalId = request.approvalId ?? randomUUID();

    if (decision.action === "ask" && isApprovalRisk(decision.risk) && request.approved !== true) {
      const approvalRequest: ApprovalRequest = {
        approvalId,
        reason: decision.reason,
        risk: decision.risk,
        toolName: request.tool.name
      };

      this.events.publish({
        type: "approval.requested",
        runId: request.runId,
        request: approvalRequest
      });

      return { status: "approval_required", approvalId };
    }

    if (decision.action === "ask" && request.approved === true) {
      const approvalDecision: ApprovalDecision = {
        approvalId,
        approved: true,
        rememberForSession: false
      };

      this.events.publish({
        type: "approval.resolved",
        runId: request.runId,
        decision: approvalDecision
      });
    }

    const toolCallId = randomUUID();
    const parsedInput = request.tool.inputSchema.parse(request.input);
    const call: ToolCallView = {
      toolCallId,
      name: request.tool.name,
      risk: request.tool.risk,
      input: parsedInput,
      startedAt: nowIso()
    };

    this.events.publish({
      type: "tool.started",
      runId: request.runId,
      call
    });

    const context: ToolContext = {
      workspaceRoot: request.workspaceRoot
    };
    const result = await request.tool.run(parsedInput, context);
    const eventResult: ToolResultView = result.ok
      ? {
          toolCallId,
          name: request.tool.name,
          ok: true,
          output: result.output,
          finishedAt: nowIso()
        }
      : {
          toolCallId,
          name: request.tool.name,
          ok: false,
          error: toAgentError(result.error),
          finishedAt: nowIso()
        };

    const event: AgentEvent = {
      type: "tool.completed",
      runId: request.runId,
      result: eventResult
    };
    this.events.publish(event);

    return { status: "completed", toolCallId };
  }
}
