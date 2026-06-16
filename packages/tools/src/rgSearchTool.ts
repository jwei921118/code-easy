import { execFile } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { resolveRealPathInsideWorkspace, toWorkspaceRelativePath, WorkspacePathDeniedError } from "./pathGuards.js";
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

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".code-easy",
  ".codegraph",
  ".worktrees"
]);

/** 从 execFile 错误中提取进程退出码。 */
function getExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

/** 判断 execFile 错误是否表示系统中没有安装 rg。 */
function isCommandNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 从 execFile 错误中提取 stdout，兼容 ripgrep 无匹配退出码。 */
function getStdout(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stdout" in error)) {
    return "";
  }

  const stdout = (error as { stdout?: unknown }).stdout;
  return typeof stdout === "string" ? stdout : "";
}

/** 解析 ripgrep JSONL 输出，并转换成有限的结构化匹配列表。 */
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

/** 判断内置搜索是否应跳过该目录。 */
function shouldSkipDirectory(name: string): boolean {
  return ignoredDirectories.has(name);
}

/** 在单个文件内容中查找匹配行，并追加到结果列表。 */
async function searchFile(
  workspaceRoot: string,
  absolutePath: string,
  regex: RegExp,
  maxMatches: number,
  matches: RgSearchMatch[]
): Promise<boolean> {
  const content = await readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const [index, text] of lines.entries()) {
    regex.lastIndex = 0;
    const match = regex.exec(text);
    if (!match) continue;

    if (matches.length >= maxMatches) return true;
    matches.push({
      path: toWorkspaceRelativePath(workspaceRoot, absolutePath),
      line: index + 1,
      column: match.index + 1,
      text
    });
  }

  return false;
}

/** 递归遍历文件系统，作为没有 rg 时的内置搜索兜底。 */
async function searchPathFallback(
  workspaceRoot: string,
  absolutePath: string,
  regex: RegExp,
  maxMatches: number,
  matches: RgSearchMatch[]
): Promise<boolean> {
  const pathStats = await stat(absolutePath);
  if (pathStats.isFile()) {
    return searchFile(workspaceRoot, absolutePath, regex, maxMatches, matches);
  }
  if (!pathStats.isDirectory()) return false;

  const entries = await readdir(absolutePath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (matches.length >= maxMatches) return true;
    if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;

    const entryPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory() || entry.isFile()) {
      const truncated = await searchPathFallback(workspaceRoot, entryPath, regex, maxMatches, matches);
      if (truncated) return true;
    }
  }

  return false;
}

/** 在 rg 不可用时，用 Node 内置能力执行基础正则文本搜索。 */
async function runFallbackSearch(
  workspaceRoot: string,
  searchRoot: string,
  pattern: string,
  maxMatches: number,
  caseSensitive: boolean
): Promise<RgSearchOutput> {
  const regex = new RegExp(pattern, caseSensitive ? "" : "i");
  const matches: RgSearchMatch[] = [];
  const truncated = await searchPathFallback(workspaceRoot, searchRoot, regex, maxMatches, matches);

  return { matches, truncated };
}

/** 使用 ripgrep 在工作区内搜索文本并返回结构化匹配。 */
export const rgSearchTool: CodeEasyTool<typeof RgSearchInputSchema, RgSearchOutput> = {
  name: "rg_search",
  risk: "read",
  description: "Search workspace text with ripgrep and return bounded structured matches.",
  inputSchema: RgSearchInputSchema,
  /** 先校验搜索路径，再运行 rg 并处理无匹配退出码。 */
  async run(input, context) {
    let searchRoot: string;
    let workspaceRealPath: string;
    try {
      [workspaceRealPath, searchRoot] = await Promise.all([
        realpath(context.workspaceRoot),
        resolveRealPathInsideWorkspace(context.workspaceRoot, input.path)
      ]);
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
      "--glob",
      "!.worktrees/**",
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
      if (isCommandNotFound(error)) {
        try {
          return {
            ok: true,
            output: await runFallbackSearch(
              workspaceRealPath,
              searchRoot,
              input.pattern,
              input.maxMatches,
              input.caseSensitive
            )
          };
        } catch (fallbackError) {
          return {
            ok: false,
            error: {
              category: "tool_failed",
              message: "Failed to search workspace with built-in fallback.",
              detail: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            }
          };
        }
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
