import {
  applyPatchTool,
  gitStatusTool,
  listFilesTool,
  readFileTool,
  rgSearchTool,
  runCommandTool,
  type CodeEasyTool
} from "@code-easy/tools";
import type { z } from "zod";

export type RegisteredTool = CodeEasyTool<z.ZodTypeAny, unknown>;
export type ToolRegistry = ReadonlyMap<string, RegisteredTool>;

export function createDefaultToolRegistry(): ToolRegistry {
  return new Map(
    [readFileTool, listFilesTool, rgSearchTool, gitStatusTool, applyPatchTool, runCommandTool].map((tool) => [
      tool.name,
      tool as RegisteredTool
    ])
  );
}
