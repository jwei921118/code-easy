import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { CodeEasyTool } from "./types.js";

const execFileAsync = promisify(execFile);

const GitStatusInputSchema = z.object({
  porcelain: z.boolean().default(true)
});

type GitStatusOutput = {
  stdout: string;
  stderr: string;
};

/** 安全读取工作区 Git 状态，禁用可能触发外部进程的仓库配置。 */
export const gitStatusTool: CodeEasyTool<typeof GitStatusInputSchema, GitStatusOutput> = {
  name: "git_status",
  risk: "read",
  description: "Inspect Git status for the workspace.",
  inputSchema: GitStatusInputSchema,
  /** 运行 git status 并返回 stdout/stderr。 */
  async run(input, context) {
    try {
      const args = [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "maintenance.auto=false",
        "-c",
        "gc.auto=0",
        "status",
        ...(input.porcelain ? ["--short"] : [])
      ];
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: context.workspaceRoot,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0"
        },
        timeout: 10_000,
        maxBuffer: 200_000
      });

      return { ok: true, output: { stdout, stderr } };
    } catch (error) {
      return {
        ok: false,
        error: {
          category: "tool_failed",
          message: "Failed to inspect Git status.",
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
