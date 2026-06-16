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

/** 创建运行时默认工具注册表，供 CLI 和模型调用共用。 */
export function createDefaultToolRegistry(): ToolRegistry {
  return new Map(
    [readFileTool, listFilesTool, rgSearchTool, gitStatusTool, applyPatchTool, runCommandTool].map((tool) => [
      tool.name,
      tool as RegisteredTool
    ])
  );
}
