import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listFilesTool } from "./index.js";

describe("listFilesTool", () => {
  it("lists files inside the workspace and skips generated directories", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-list-"));
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "node_modules/pkg"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "README.md"), "hello", "utf8");
    await writeFile(path.join(workspaceRoot, "src/index.ts"), "export {};\n", "utf8");
    await writeFile(path.join(workspaceRoot, "node_modules/pkg/index.js"), "ignored", "utf8");

    const result = await listFilesTool.run({ path: ".", limit: 100, includeHidden: false }, { workspaceRoot });

    expect(result).toMatchObject({
      ok: true,
      output: {
        files: ["README.md", "src/index.ts"],
        truncated: false
      }
    });
  });

  it("rejects paths that escape the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-list-"));

    const result = await listFilesTool.run({ path: "..", limit: 100, includeHidden: false }, { workspaceRoot });

    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "denied"
      }
    });
  });

  it("rejects symlink directories that resolve outside the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-list-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-list-outside-"));
    await symlink(outsideRoot, path.join(workspaceRoot, "outside-link"));

    const result = await listFilesTool.run({ path: "outside-link", limit: 100, includeHidden: false }, { workspaceRoot });

    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "denied"
      }
    });
  });
});
