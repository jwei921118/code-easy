import type { ToolRisk } from "@code-easy/permissions";
import type { z } from "zod";

export type ToolContext = {
  workspaceRoot: string;
  signal?: AbortSignal;
};

export type ToolResult<TOutput> =
  | { ok: true; output: TOutput }
  | { ok: false; error: { category: "tool_failed" | "timeout" | "denied"; message: string; detail?: string } };

export type CodeEasyTool<TInputSchema extends z.ZodTypeAny, TOutput> = {
  name: string;
  risk: ToolRisk;
  description: string;
  inputSchema: TInputSchema;
  run(input: z.infer<TInputSchema>, context: ToolContext): Promise<ToolResult<TOutput>>;
};
