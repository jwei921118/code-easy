import { z } from "zod";
import { ApprovalDecisionSchema } from "./events.js";
import { IdSchema, NonEmptyStringSchema } from "./primitives.js";

/** 启动一次新运行或在指定 thread 上继续运行的命令。 */
export const RunCommandSchema = z.strictObject({
  kind: z.literal("run"),
  threadId: IdSchema.optional(),
  workspaceRoot: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema
});

/** 重放历史会话，或携带新 prompt 继续指定 thread。 */
export const ResumeCommandSchema = z.strictObject({
  kind: z.literal("resume"),
  threadId: IdSchema,
  prompt: NonEmptyStringSchema.optional()
});

/** 取消指定运行的命令；当前协议先保留该能力边界。 */
export const CancelCommandSchema = z.strictObject({
  kind: z.literal("cancel"),
  runId: IdSchema
});

/** 提交审批结果的运行时命令。 */
export const ApproveCommandSchema = z.strictObject({
  kind: z.literal("approve"),
  decision: ApprovalDecisionSchema
});

/** 运行时命令总入口，按 kind 做严格区分。 */
export const RuntimeCommandSchema = z.discriminatedUnion("kind", [
  RunCommandSchema,
  ResumeCommandSchema,
  CancelCommandSchema,
  ApproveCommandSchema
]);

export type RunCommand = z.infer<typeof RunCommandSchema>;
export type ResumeCommand = z.infer<typeof ResumeCommandSchema>;
export type CancelCommand = z.infer<typeof CancelCommandSchema>;
export type ApproveCommand = z.infer<typeof ApproveCommandSchema>;
export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;
