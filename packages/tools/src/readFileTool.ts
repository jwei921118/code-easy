import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CodeEasyTool } from "./types.js";

const ReadFileInputSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(200_000).default(80_000)
});

type ReadFileOutput = {
  path: string;
  content: string;
  truncated: boolean;
};

class WorkspaceReadDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceReadDeniedError";
  }
}

function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceReadDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return resolved;
}

function isPathInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function resolveRealPathInsideWorkspace(workspaceRoot: string, relativePath: string): Promise<string> {
  const absolutePath = resolveInsideWorkspace(workspaceRoot, relativePath);
  const [workspaceRealPath, targetRealPath] = await Promise.all([realpath(workspaceRoot), realpath(absolutePath)]);

  if (!isPathInside(workspaceRealPath, targetRealPath)) {
    throw new WorkspaceReadDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return targetRealPath;
}

async function readBoundedUtf8File(absolutePath: string, maxBytes: number): Promise<{ content: string; truncated: boolean }> {
  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile()) {
    throw new WorkspaceReadDeniedError(`Path is not a regular file: ${absolutePath}`);
  }

  const bytesToRead = maxBytes + 1;
  const buffer = Buffer.alloc(bytesToRead);
  const fileHandle = await open(absolutePath, "r");
  let totalBytesRead = 0;

  try {
    while (totalBytesRead < bytesToRead) {
      const result = await fileHandle.read(buffer, totalBytesRead, bytesToRead - totalBytesRead, totalBytesRead);

      if (result.bytesRead === 0) {
        break;
      }

      totalBytesRead += result.bytesRead;
    }
  } finally {
    await fileHandle.close();
  }

  const truncated = totalBytesRead > maxBytes;
  const content = buffer.subarray(0, Math.min(totalBytesRead, maxBytes)).toString("utf8");

  return { content, truncated };
}

export const readFileTool: CodeEasyTool<typeof ReadFileInputSchema, ReadFileOutput> = {
  name: "read_file",
  risk: "read",
  description: "Read a bounded UTF-8 text file inside the workspace.",
  inputSchema: ReadFileInputSchema,
  async run(input, context) {
    try {
      const absolutePath = await resolveRealPathInsideWorkspace(context.workspaceRoot, input.path);
      const { content, truncated } = await readBoundedUtf8File(absolutePath, input.maxBytes);

      return {
        ok: true,
        output: {
          path: input.path,
          content,
          truncated
        }
      };
    } catch (error) {
      const denied = error instanceof WorkspaceReadDeniedError;
      return {
        ok: false,
        error: {
          category: denied ? "denied" : "tool_failed",
          message: `Failed to read ${input.path}`,
          detail: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
