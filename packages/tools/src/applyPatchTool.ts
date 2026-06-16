import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CodeEasyTool } from "./types.js";

const ApplyPatchInputSchema = z.strictObject({
  path: z.string().min(1),
  oldText: z.string().min(1),
  newText: z.string(),
  expectedReplacements: z.number().int().positive().default(1)
});

type ApplyPatchOutput = {
  path: string;
  replacements: number;
  diff: string;
};

export type ApplyPatchDiffInput = {
  path: string;
  oldText: string;
  newText: string;
  replacements?: number;
};

/** 表示写文件请求不符合工作区路径约束。 */
class WorkspaceWriteDeniedError extends Error {
  /** 创建工作区写入拒绝错误。 */
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceWriteDeniedError";
  }
}

/** 解析待写入路径，并拒绝直接越过工作区的路径。 */
function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceWriteDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return resolved;
}

/** 判断真实路径是否位于工作区真实根目录内。 */
function isPathInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/** 解析可写文件真实路径，并拒绝 symlink 越界或非普通文件。 */
async function resolveWritableFileInsideWorkspace(workspaceRoot: string, relativePath: string): Promise<string> {
  const absolutePath = resolveInsideWorkspace(workspaceRoot, relativePath);
  const [workspaceRealPath, targetRealPath] = await Promise.all([realpath(workspaceRoot), realpath(absolutePath)]);

  if (!isPathInside(workspaceRealPath, targetRealPath)) {
    throw new WorkspaceWriteDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  const fileStats = await stat(targetRealPath);
  if (!fileStats.isFile()) {
    throw new WorkspaceWriteDeniedError(`Path is not a regular file: ${relativePath}`);
  }

  return targetRealPath;
}

/** 对文件内容执行精确文本替换，并统计替换次数。 */
function replaceExactText(content: string, oldText: string, newText: string): { content: string; replacements: number } {
  let replacements = 0;
  const nextContent = content.replaceAll(oldText, () => {
    replacements += 1;
    return newText;
  });

  return { content: nextContent, replacements };
}

/** 为待审批或已执行的文本替换生成简化 diff 预览。 */
export function formatApplyPatchDiff(input: ApplyPatchDiffInput): string {
  const replacements = input.replacements ?? 1;
  const hunks = Array.from({ length: replacements }, () => [
    "@@",
    ...prefixedLines("-", input.oldText),
    ...prefixedLines("+", input.newText)
  ]).flat();

  return [`--- a/${input.path}`, `+++ b/${input.path}`, ...hunks, ""].join("\n");
}

/** 为多行文本添加 diff 前缀。 */
function prefixedLines(prefix: string, text: string): string[] {
  return text.split("\n").map((line) => `${prefix}${line}`);
}

/** 对工作区内已有文件执行精确文本替换。 */
export const applyPatchTool: CodeEasyTool<typeof ApplyPatchInputSchema, ApplyPatchOutput> = {
  name: "apply_patch",
  risk: "write",
  description: "Apply an exact text replacement to an existing workspace file.",
  inputSchema: ApplyPatchInputSchema,
  /** 校验文件边界和替换次数后写回文件。 */
  async run(input, context) {
    try {
      const absolutePath = await resolveWritableFileInsideWorkspace(context.workspaceRoot, input.path);
      const originalContent = await readFile(absolutePath, "utf8");
      const patched = replaceExactText(originalContent, input.oldText, input.newText);

      if (patched.replacements !== input.expectedReplacements) {
        return {
          ok: false,
          error: {
            category: "tool_failed",
            message: `Expected ${input.expectedReplacements} replacement(s), found ${patched.replacements}.`
          }
        };
      }

      await writeFile(absolutePath, patched.content, "utf8");

      return {
        ok: true,
        output: {
          path: input.path,
          replacements: patched.replacements,
          diff: formatApplyPatchDiff({ ...input, replacements: patched.replacements })
        }
      };
    } catch (error) {
      const denied = error instanceof WorkspaceWriteDeniedError;

      return {
        ok: false,
        error: {
          category: denied ? "denied" : "tool_failed",
          message: `Failed to apply patch to ${input.path}`,
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
