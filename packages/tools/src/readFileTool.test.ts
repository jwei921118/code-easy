import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readFileTool } from "./index.js";

describe("readFileTool", () => {
  it("reads a file inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello world", "utf8");

    const result = await readFileTool.run({ path: "hello.txt", maxBytes: 80_000 }, { workspaceRoot });

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "hello.txt",
        content: "hello world",
        truncated: false
      }
    });
  });

  it("rejects paths that escape the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));

    const result = await readFileTool.run({ path: "../outside.txt", maxBytes: 80_000 }, { workspaceRoot });

    expect(result.ok).toBe(false);
  });

  it("rejects symlinks that resolve outside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-outside-"));
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "outside", "utf8");
    await symlink(outsideFile, path.join(workspaceRoot, "link.txt"));

    const result = await readFileTool.run({ path: "link.txt", maxBytes: 80_000 }, { workspaceRoot });

    expect(result.ok).toBe(false);
  });

  it("reads at most maxBytes and marks larger files as truncated", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "large.txt"), "abcdef", "utf8");

    const result = await readFileTool.run({ path: "large.txt", maxBytes: 3 }, { workspaceRoot });

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "large.txt",
        content: "abc",
        truncated: true
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.content.length).toBe(3);
    }
  });
});
