import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatchTool, formatApplyPatchDiff } from "./index.js";

describe("applyPatchTool", () => {
  it("replaces exact text inside a workspace file", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello old world", "utf8");

    const result = await applyPatchTool.run(
      { path: "hello.txt", oldText: "old", newText: "new", expectedReplacements: 1 },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "hello.txt",
        replacements: 1
      }
    });
    await expect(readFile(path.join(workspaceRoot, "hello.txt"), "utf8")).resolves.toBe("hello new world");
  });

  it("does not write when old text is missing", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello world", "utf8");

    const result = await applyPatchTool.run(
      { path: "hello.txt", oldText: "missing", newText: "new", expectedReplacements: 1 },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "tool_failed"
      }
    });
    await expect(readFile(path.join(workspaceRoot, "hello.txt"), "utf8")).resolves.toBe("hello world");
  });

  it("rejects paths that escape the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));

    const result = await applyPatchTool.run(
      { path: "../outside.txt", oldText: "old", newText: "new", expectedReplacements: 1 },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "denied"
      }
    });
  });

  it("rejects symlinks that resolve outside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-outside-"));
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "old", "utf8");
    await symlink(outsideFile, path.join(workspaceRoot, "link.txt"));

    const result = await applyPatchTool.run(
      { path: "link.txt", oldText: "old", newText: "new", expectedReplacements: 1 },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "denied"
      }
    });
  });

  it("formats a simple apply patch diff preview", () => {
    expect(
      formatApplyPatchDiff({
        path: "hello.txt",
        oldText: "old",
        newText: "new"
      })
    ).toBe("--- a/hello.txt\n+++ b/hello.txt\n@@\n-old\n+new\n");
  });

  it("formats multiline apply patch diff preview lines", () => {
    expect(
      formatApplyPatchDiff({
        path: "hello.txt",
        oldText: "old\nline",
        newText: "new\nline"
      })
    ).toBe("--- a/hello.txt\n+++ b/hello.txt\n@@\n-old\n-line\n+new\n+line\n");
  });

  it("includes a diff in successful patch output", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello old world", "utf8");

    const result = await applyPatchTool.run(
      { path: "hello.txt", oldText: "old", newText: "new", expectedReplacements: 1 },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "hello.txt",
        replacements: 1,
        diff: "--- a/hello.txt\n+++ b/hello.txt\n@@\n-old\n+new\n"
      }
    });
  });

  it("includes one diff hunk per successful replacement", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "old and old", "utf8");

    const result = await applyPatchTool.run(
      { path: "hello.txt", oldText: "old", newText: "new", expectedReplacements: 2 },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "hello.txt",
        replacements: 2,
        diff: "--- a/hello.txt\n+++ b/hello.txt\n@@\n-old\n+new\n@@\n-old\n+new\n"
      }
    });
  });
});
