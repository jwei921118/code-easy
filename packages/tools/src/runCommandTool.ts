import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { CodeEasyTool } from "./types.js";

const execFileAsync = promisify(execFile);

const RunCommandInputSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).default("."),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000),
  maxOutputBytes: z.number().int().positive().max(1_000_000).default(200_000)
});

type RunCommandOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/** 表示命令执行目录不符合工作区边界约束。 */
class WorkspaceExecuteDeniedError extends Error {
  /** 创建工作区执行拒绝错误。 */
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceExecuteDeniedError";
  }
}

/** 判断真实 cwd 是否仍位于工作区内。 */
function isPathInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/** 解析命令 cwd，并拒绝直接或通过 symlink 越过工作区。 */
async function resolveCwdInsideWorkspace(workspaceRoot: string, relativeCwd: string): Promise<string> {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relativeCwd);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceExecuteDeniedError(`Command cwd escapes workspace: ${relativeCwd}`);
  }

  const [workspaceRealPath, cwdRealPath] = await Promise.all([realpath(root), realpath(resolved)]);

  if (!isPathInside(workspaceRealPath, cwdRealPath)) {
    throw new WorkspaceExecuteDeniedError(`Command cwd escapes workspace: ${relativeCwd}`);
  }

  return cwdRealPath;
}

/** 判断 execFile 失败是否来自超时终止。 */
function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { killed?: unknown; signal?: unknown };
  return candidate.killed === true && typeof candidate.signal === "string";
}

/** 在无 shell 环境下执行工作区内命令。 */
export const runCommandTool: CodeEasyTool<typeof RunCommandInputSchema, RunCommandOutput> = {
  name: "run_command",
  risk: "execute",
  description: "Run a command without a shell inside the workspace.",
  inputSchema: RunCommandInputSchema,
  /** 校验 cwd 后执行命令，并把失败映射为工具错误。 */
  async run(input, context) {
    let cwd: string;

    try {
      cwd = await resolveCwdInsideWorkspace(context.workspaceRoot, input.cwd);
    } catch (error) {
      return {
        ok: false,
        error: {
          category: "denied",
          message: "Command cwd is outside the workspace.",
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(input.command, input.args, {
        cwd,
        timeout: input.timeoutMs,
        maxBuffer: input.maxOutputBytes,
        env: process.env
      });

      return {
        ok: true,
        output: {
          stdout,
          stderr,
          exitCode: 0
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          category: isTimeoutError(error) ? "timeout" : "tool_failed",
          message: `Command failed: ${input.command}`,
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
