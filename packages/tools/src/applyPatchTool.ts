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
};

class WorkspaceWriteDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceWriteDeniedError";
  }
}

function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceWriteDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return resolved;
}

function isPathInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

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

function replaceExactText(content: string, oldText: string, newText: string): { content: string; replacements: number } {
  let replacements = 0;
  const nextContent = content.replaceAll(oldText, () => {
    replacements += 1;
    return newText;
  });

  return { content: nextContent, replacements };
}

export const applyPatchTool: CodeEasyTool<typeof ApplyPatchInputSchema, ApplyPatchOutput> = {
  name: "apply_patch",
  risk: "write",
  description: "Apply an exact text replacement to an existing workspace file.",
  inputSchema: ApplyPatchInputSchema,
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
          replacements: patched.replacements
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
