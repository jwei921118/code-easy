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
