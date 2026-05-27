import { execFile } from "node:child_process";
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
});
