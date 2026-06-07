import { mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommandTool } from "./index.js";

describe("runCommandTool", () => {
  it("runs a command inside the workspace without a shell", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-command-"));

    const result = await runCommandTool.run(
      {
        command: process.execPath,
        args: ["-e", "console.log('hello command')"],
        cwd: ".",
        timeoutMs: 10_000,
        maxOutputBytes: 200_000
      },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        stdout: "hello command\n",
        stderr: "",
        exitCode: 0
      }
    });
  });

  it("rejects cwd paths that escape the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-command-"));

    const result = await runCommandTool.run(
      {
        command: process.execPath,
        args: ["-e", "console.log('outside')"],
        cwd: "..",
        timeoutMs: 10_000,
        maxOutputBytes: 200_000
      },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "denied"
      }
    });
  });

  it("rejects cwd symlinks that resolve outside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-command-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-command-outside-"));
    await symlink(outsideRoot, path.join(workspaceRoot, "outside-link"));

    const result = await runCommandTool.run(
      {
        command: process.execPath,
        args: ["-e", "console.log('outside')"],
        cwd: "outside-link",
        timeoutMs: 10_000,
        maxOutputBytes: 200_000
      },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "denied"
      }
    });
  });
});
