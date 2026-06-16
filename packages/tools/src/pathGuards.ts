import { realpath } from "node:fs/promises";
import path from "node:path";

/** 表示请求路径越过工作区边界，工具必须拒绝执行。 */
export class WorkspacePathDeniedError extends Error {
  /** 创建工作区路径拒绝错误。 */
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathDeniedError";
  }
}

/** 判断目标路径在真实路径语义上是否位于工作区根目录内。 */
export function isPathInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/** 解析工作区相对路径，并拒绝明显越界的路径。 */
export function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new WorkspacePathDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return resolved;
}

/** 解析真实路径以防 symlink 越界。 */
export async function resolveRealPathInsideWorkspace(workspaceRoot: string, relativePath: string): Promise<string> {
  const absolutePath = resolveInsideWorkspace(workspaceRoot, relativePath);
  const [workspaceRealPath, targetRealPath] = await Promise.all([realpath(workspaceRoot), realpath(absolutePath)]);

  if (!isPathInside(workspaceRealPath, targetRealPath)) {
    throw new WorkspacePathDeniedError(`Path escapes workspace: ${relativePath}`);
  }

  return targetRealPath;
}

/** 将绝对路径转换成稳定的工作区相对路径。 */
export function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(workspaceRoot), absolutePath).split(path.sep).join("/");
}
