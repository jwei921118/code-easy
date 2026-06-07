import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("code-easy cli", () => {
  it("shows help when pnpm-style argument forwarding includes a standalone separator", async () => {
    const { stdout } = await execFileAsync("node", ["--import", "tsx", "src/index.ts", "--", "--help"], {
      cwd: process.cwd(),
      timeout: 10_000
    });

    expect(stdout).toContain("Usage: code-easy");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("run [options] <prompt>");
  });

  it("runs a read tool and renders tool events", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-cli-"));
    await writeFile(path.join(workspaceRoot, "note.txt"), "hello cli\n", "utf8");

    const { stdout } = await execFileAsync(
      "node",
      ["--import", "tsx", "src/index.ts", "tool", "read_file", "{\"path\":\"note.txt\"}", "--workspace", workspaceRoot],
      {
        cwd: process.cwd(),
        timeout: 10_000
      }
    );

    expect(stdout).toContain("Run started:");
    expect(stdout).toContain("Tool started: read_file");
    expect(stdout).toContain("hello cli");
    expect(stdout).toContain("Tool completed: read_file");
    expect(stdout).toContain("Run completed:");
  });
});
