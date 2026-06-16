import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveRealPathInsideWorkspace, toWorkspaceRelativePath, WorkspacePathDeniedError } from "./pathGuards.js";
import type { CodeEasyTool } from "./types.js";

const ListFilesInputSchema = z.strictObject({
  path: z.string().min(1).default("."),
  limit: z.number().int().positive().max(5_000).default(200),
  includeHidden: z.boolean().default(false)
});

type ListFilesOutput = {
  files: string[];
  truncated: boolean;
};

const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".turbo", ".code-easy", ".codegraph"]);

/** 判断目录项是否应从文件列表中排除。 */
function shouldSkipEntry(name: string, includeHidden: boolean): boolean {
  if (ignoredDirectories.has(name)) return true;
  if (!includeHidden && name.startsWith(".")) return true;
  return false;
}

/** 递归收集工作区文件，并在超过 limit 后停止深入。 */
async function collectFiles(
  workspaceRoot: string,
  directoryPath: string,
  limit: number,
  includeHidden: boolean,
  files: string[]
): Promise<void> {
  if (files.length > limit) return;

  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (files.length > limit) return;
    if (shouldSkipEntry(entry.name, includeHidden)) continue;

    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await collectFiles(workspaceRoot, absolutePath, limit, includeHidden, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(toWorkspaceRelativePath(workspaceRoot, absolutePath));
    }
  }
}

/** 列出工作区内文件，默认跳过生成目录和隐藏目录。 */
export const listFilesTool: CodeEasyTool<typeof ListFilesInputSchema, ListFilesOutput> = {
  name: "list_files",
  risk: "read",
  description: "List files inside the workspace while skipping generated directories.",
  inputSchema: ListFilesInputSchema,
  /** 校验目录边界后返回有限文件列表。 */
  async run(input, context) {
    try {
      const workspaceRealPath = await realpath(context.workspaceRoot);
      const directoryPath = await resolveRealPathInsideWorkspace(context.workspaceRoot, input.path);
      const directoryStats = await stat(directoryPath);

      if (!directoryStats.isDirectory()) {
        return {
          ok: false,
          error: {
            category: "denied",
            message: `Path is not a directory: ${input.path}`
          }
        };
      }

      const files: string[] = [];
      await collectFiles(workspaceRealPath, directoryPath, input.limit, input.includeHidden, files);

      const truncated = files.length > input.limit;
      return {
        ok: true,
        output: {
          files: files.slice(0, input.limit),
          truncated
        }
      };
    } catch (error) {
      const denied = error instanceof WorkspacePathDeniedError;
      return {
        ok: false,
        error: {
          category: denied ? "denied" : "tool_failed",
          message: `Failed to list files under ${input.path}`,
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
