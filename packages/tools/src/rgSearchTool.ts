import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { resolveRealPathInsideWorkspace, WorkspacePathDeniedError } from "./pathGuards.js";
import type { CodeEasyTool } from "./types.js";

const execFileAsync = promisify(execFile);

const RgSearchInputSchema = z.strictObject({
  pattern: z.string().min(1),
  path: z.string().min(1).default("."),
  maxMatches: z.number().int().positive().max(1_000).default(100),
  caseSensitive: z.boolean().default(true)
});

type RgSearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
};

type RgSearchOutput = {
  matches: RgSearchMatch[];
  truncated: boolean;
};

type RgJsonEvent = {
  type?: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: Array<{ start?: number }>;
  };
};

function getExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function getStdout(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stdout" in error)) {
    return "";
  }

  const stdout = (error as { stdout?: unknown }).stdout;
  return typeof stdout === "string" ? stdout : "";
}

function parseRgJson(stdout: string, maxMatches: number): RgSearchOutput {
  const matches: RgSearchMatch[] = [];
  let truncated = false;

  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;

    const event = JSON.parse(line) as RgJsonEvent;
    if (event.type !== "match") continue;

    const filePath = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    const text = event.data?.lines?.text;
    const column = event.data?.submatches?.[0]?.start;

    if (filePath === undefined || lineNumber === undefined || text === undefined || column === undefined) {
      continue;
    }

    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }

    matches.push({
      path: filePath.startsWith("./") ? filePath.slice(2) : filePath,
      line: lineNumber,
      column: column + 1,
      text: text.replace(/\r?\n$/, "")
    });
  }

  return { matches, truncated };
}

export const rgSearchTool: CodeEasyTool<typeof RgSearchInputSchema, RgSearchOutput> = {
  name: "rg_search",
  risk: "read",
  description: "Search workspace text with ripgrep and return bounded structured matches.",
  inputSchema: RgSearchInputSchema,
  async run(input, context) {
    try {
      await resolveRealPathInsideWorkspace(context.workspaceRoot, input.path);
    } catch (error) {
      const denied = error instanceof WorkspacePathDeniedError;
      return {
        ok: false,
        error: {
          category: denied ? "denied" : "tool_failed",
          message: `Failed to validate search path ${input.path}`,
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }

    const args = [
      "--json",
      "--color",
      "never",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!dist/**",
      "--glob",
      "!.git/**",
      "--glob",
      "!.codegraph/**",
      ...(input.caseSensitive ? [] : ["-i"]),
      "--",
      input.pattern,
      input.path
    ];

    try {
      const { stdout } = await execFileAsync("rg", args, {
        cwd: context.workspaceRoot,
        timeout: 10_000,
        maxBuffer: 1_000_000
      });

      return { ok: true, output: parseRgJson(stdout, input.maxMatches) };
    } catch (error) {
      if (getExitCode(error) === 1) {
        return { ok: true, output: parseRgJson(getStdout(error), input.maxMatches) };
      }

      return {
        ok: false,
        error: {
          category: "tool_failed",
          message: "Failed to search workspace with ripgrep.",
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
