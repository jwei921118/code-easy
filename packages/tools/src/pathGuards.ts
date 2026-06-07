import { realpath } from "node:fs/promises";
import path from "node:path";

export class WorkspacePathDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathDeniedError";
  }
}

export function isPathInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new WorkspacePathDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return resolved;
}

export async function resolveRealPathInsideWorkspace(workspaceRoot: string, relativePath: string): Promise<string> {
  const absolutePath = resolveInsideWorkspace(workspaceRoot, relativePath);
  const [workspaceRealPath, targetRealPath] = await Promise.all([realpath(workspaceRoot), realpath(absolutePath)]);

  if (!isPathInside(workspaceRealPath, targetRealPath)) {
    throw new WorkspacePathDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return targetRealPath;
}

export function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(workspaceRoot), absolutePath).split(path.sep).join("/");
}
