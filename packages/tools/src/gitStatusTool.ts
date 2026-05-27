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

export const gitStatusTool: CodeEasyTool<typeof GitStatusInputSchema, GitStatusOutput> = {
  name: "git_status",
  risk: "read",
  description: "Inspect Git status for the workspace.",
  inputSchema: GitStatusInputSchema,
  async run(input, context) {
    try {
      const args = input.porcelain ? ["status", "--short"] : ["status"];
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: context.workspaceRoot,
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
