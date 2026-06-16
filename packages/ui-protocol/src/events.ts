import { z } from "zod";
import { DateTimeStringSchema, IdSchema, NonEmptyStringSchema } from "./primitives.js";

/** 描述运行、模型或工具失败时传给 UI 的标准错误结构。 */
export const AgentErrorSchema = z.strictObject({
  category: z.enum([
    "cancelled",
    "denied",
    "timeout",
    "tool_failed",
    "model_failed",
    "runtime_failed",
    "invalid_tool_call"
  ]),
  message: NonEmptyStringSchema,
  detail: z.string().optional()
});

/** 描述一个工具调用在 UI 中可展示的开始状态。 */
export const ToolCallViewSchema = z.strictObject({
  toolCallId: IdSchema,
  name: NonEmptyStringSchema,
  risk: z.enum(["read", "write", "execute", "network", "destructive", "external"]),
  input: z.unknown(),
  startedAt: DateTimeStringSchema
});

/** 工具完成事件的公共字段 schema。 */
const ToolResultBaseSchema = z.strictObject({
  toolCallId: IdSchema,
  name: NonEmptyStringSchema,
  finishedAt: DateTimeStringSchema
});

/** 描述工具成功或失败后的 UI 可展示结果。 */
export const ToolResultViewSchema = z.discriminatedUnion("ok", [
  ToolResultBaseSchema.extend({
    ok: z.literal(true),
    output: z.unknown().optional()
  }).strict(),
  ToolResultBaseSchema.extend({
    ok: z.literal(false),
    error: AgentErrorSchema
  }).strict()
]);

/** 描述需要用户批准的工具请求。 */
export const ApprovalRequestSchema = z.strictObject({
  approvalId: IdSchema,
  reason: NonEmptyStringSchema,
  risk: z.enum(["write", "execute", "network", "destructive", "external"]),
  command: z.string().optional(),
  toolName: NonEmptyStringSchema
});

/** 描述用户对审批请求的处理结果。 */
export const ApprovalDecisionSchema = z.strictObject({
  approvalId: IdSchema,
  approved: z.boolean(),
  rememberForSession: z.boolean().default(false)
});

/** 定义运行时向 CLI/桌面端广播的全部事件协议。 */
export const AgentEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("run.started"), runId: IdSchema, threadId: IdSchema }),
  z.strictObject({ type: z.literal("message.delta"), runId: IdSchema, text: z.string() }),
  z.strictObject({ type: z.literal("node.started"), runId: IdSchema, node: NonEmptyStringSchema }),
  z.strictObject({ type: z.literal("node.completed"), runId: IdSchema, node: NonEmptyStringSchema }),
  z.strictObject({ type: z.literal("tool.started"), runId: IdSchema, call: ToolCallViewSchema }),
  z.strictObject({ type: z.literal("tool.output"), runId: IdSchema, toolCallId: IdSchema, chunk: z.string() }),
  z.strictObject({ type: z.literal("tool.completed"), runId: IdSchema, result: ToolResultViewSchema }),
  z.strictObject({ type: z.literal("diff.ready"), runId: IdSchema, diff: z.string() }),
  z.strictObject({ type: z.literal("approval.requested"), runId: IdSchema, request: ApprovalRequestSchema }),
  z.strictObject({ type: z.literal("approval.resolved"), runId: IdSchema, decision: ApprovalDecisionSchema }),
  z.strictObject({
    type: z.literal("run.paused"),
    runId: IdSchema,
    reason: z.literal("approval_required"),
    approvalId: IdSchema
  }),
  z.strictObject({ type: z.literal("run.completed"), runId: IdSchema, summary: NonEmptyStringSchema }),
  z.strictObject({ type: z.literal("run.failed"), runId: IdSchema, error: AgentErrorSchema })
]);

export type AgentError = z.infer<typeof AgentErrorSchema>;
export type ToolCallView = z.infer<typeof ToolCallViewSchema>;
export type ToolResultView = z.infer<typeof ToolResultViewSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
