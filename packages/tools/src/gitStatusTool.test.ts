import { execFile } from "node:child_process";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { gitStatusTool } from "./index.js";

const execFileAsync = promisify(execFile);

async function initRepo(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-git-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: workspaceRoot });

  return workspaceRoot;
}

describe("gitStatusTool", () => {
  it("returns porcelain status for a git repo", async () => {
    const workspaceRoot = await initRepo();
    await writeFile(path.join(workspaceRoot, "untracked.txt"), "hello", "utf8");

    const result = await gitStatusTool.run({ porcelain: true }, { workspaceRoot });

    expect(result).toMatchObject({
      ok: true,
      output: {
        stdout: expect.stringContaining("?? untracked.txt")
      }
    });
  });

  it("does not execute repo configured fsmonitor hooks", async () => {
    const workspaceRoot = await initRepo();
    const markerPath = path.join(workspaceRoot, "fsmonitor-ran");
    const hookPath = path.join(workspaceRoot, "fsmonitor-hook.sh");
    await writeFile(hookPath, `#!/bin/sh\ntouch ${JSON.stringify(markerPath)}\n`, "utf8");
    await chmod(hookPath, 0o755);
    await execFileAsync("git", ["config", "core.fsmonitor", hookPath], { cwd: workspaceRoot });

    const result = await gitStatusTool.run({ porcelain: true }, { workspaceRoot });

    expect(result.ok).toBe(true);
    await expect(stat(markerPath)).rejects.toThrow();
  });
});
