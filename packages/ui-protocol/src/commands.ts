import { z } from "zod";
import { ApprovalDecisionSchema } from "./events.js";
import { IdSchema, NonEmptyStringSchema } from "./primitives.js";

export const RunCommandSchema = z.strictObject({
  kind: z.literal("run"),
  threadId: IdSchema.optional(),
  workspaceRoot: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema
});

export const ResumeCommandSchema = z.strictObject({
  kind: z.literal("resume"),
  threadId: IdSchema,
  prompt: NonEmptyStringSchema.optional()
});

export const CancelCommandSchema = z.strictObject({
  kind: z.literal("cancel"),
  runId: IdSchema
});

export const ApproveCommandSchema = z.strictObject({
  kind: z.literal("approve"),
  decision: ApprovalDecisionSchema
});

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
