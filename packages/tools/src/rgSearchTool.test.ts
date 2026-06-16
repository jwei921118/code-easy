import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rgSearchTool } from "./index.js";

describe("rgSearchTool", () => {
  it("returns bounded ripgrep matches inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-rg-"));
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "src/index.ts"), "const token = 'needle';\n", "utf8");
    await writeFile(path.join(workspaceRoot, "README.md"), "no match\n", "utf8");

    const result = await rgSearchTool.run(
      { pattern: "needle", path: ".", maxMatches: 10, caseSensitive: true },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        matches: [
          {
            path: "src/index.ts",
            line: 1,
            column: 16,
            text: "const token = 'needle';"
          }
        ],
        truncated: false
      }
    });
  });

  it("returns no matches when ripgrep exits with no results", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-rg-"));
    await writeFile(path.join(workspaceRoot, "README.md"), "hello\n", "utf8");

    const result = await rgSearchTool.run(
      { pattern: "missing", path: ".", maxMatches: 10, caseSensitive: true },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        matches: [],
        truncated: false
      }
    });
  });

  it("falls back to built-in search when ripgrep is not installed", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-rg-"));
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "src/index.ts"), "const token = 'needle';\n", "utf8");
    const previousPath = process.env.PATH;
    process.env.PATH = "";

    try {
      const result = await rgSearchTool.run(
        { pattern: "needle", path: ".", maxMatches: 10, caseSensitive: true },
        { workspaceRoot }
      );

      expect(result).toMatchObject({
        ok: true,
        output: {
          matches: [
            {
              path: "src/index.ts",
              line: 1,
              column: 16,
              text: "const token = 'needle';"
            }
          ],
          truncated: false
        }
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("skips local worktree directories during built-in fallback search", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-rg-"));
    await mkdir(path.join(workspaceRoot, ".worktrees/old/packages/runtime/src"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "packages/runtime/src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".worktrees/old/packages/runtime/src/sessionManager.ts"),
      "class SessionManager {}\n",
      "utf8"
    );
    await writeFile(
      path.join(workspaceRoot, "packages/runtime/src/sessionManager.ts"),
      "export class SessionManager {}\n",
      "utf8"
    );
    const previousPath = process.env.PATH;
    process.env.PATH = "";

    try {
      const result = await rgSearchTool.run(
        { pattern: "SessionManager", path: ".", maxMatches: 10, caseSensitive: true },
        { workspaceRoot }
      );

      expect(result).toMatchObject({
        ok: true,
        output: {
          matches: [
            {
              path: "packages/runtime/src/sessionManager.ts",
              line: 1,
              column: 14,
              text: "export class SessionManager {}"
            }
          ],
          truncated: false
        }
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("rejects symlink search roots that resolve outside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-rg-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-rg-outside-"));
    await symlink(outsideRoot, path.join(workspaceRoot, "outside-link"));

    const result = await rgSearchTool.run(
      { pattern: "anything", path: "outside-link", maxMatches: 10, caseSensitive: true },
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
