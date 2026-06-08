import { execFile, spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function runCliWithInput(args: string[], input: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--import", "tsx", "src/index.ts", ...args], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("CLI command timed out"));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.end(input);
  });
}

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

  it("runs a search tool and renders matches", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-cli-"));
    await writeFile(path.join(workspaceRoot, "note.txt"), "hello search cli\n", "utf8");

    const { stdout } = await execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        "src/index.ts",
        "tool",
        "rg_search",
        "{\"pattern\":\"search\",\"path\":\".\",\"maxMatches\":10}",
        "--workspace",
        workspaceRoot
      ],
      {
        cwd: process.cwd(),
        timeout: 10_000
      }
    );

    expect(stdout).toContain("Tool started: rg_search");
    expect(stdout).toContain("note.txt");
    expect(stdout).toContain("hello search cli");
    expect(stdout).toContain("Run completed:");
  });

  it("runs the basic agent loop and renders workspace context", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-cli-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "README.md"), "SessionManager cli context\n", "utf8");

    const { stdout } = await execFileAsync(
      "node",
      ["--import", "tsx", "src/index.ts", "run", "Find SessionManager", "--workspace", workspaceRoot],
      {
        cwd: process.cwd(),
        timeout: 10_000
      }
    );

    expect(stdout).toContain("Tool started: git_status");
    expect(stdout).toContain("Tool started: list_files");
    expect(stdout).toContain("Tool started: rg_search");
    expect(stdout).toContain("Workspace context");
    expect(stdout).toContain("README.md");
    expect(stdout).toContain("SessionManager");
    expect(stdout).toContain("Run completed: Workspace inspection completed.");
  });

  it("runs an approved command tool and renders command output", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-cli-"));
    const input = JSON.stringify({
      command: process.execPath,
      args: ["-e", "console.log('hello command')"]
    });

    const { stdout } = await execFileAsync(
      "node",
      ["--import", "tsx", "src/index.ts", "tool", "run_command", input, "--workspace", workspaceRoot, "--yes"],
      {
        cwd: process.cwd(),
        timeout: 10_000
      }
    );

    expect(stdout).toContain("Tool started: run_command");
    expect(stdout).toContain("hello command");
    expect(stdout).toContain("Tool completed: run_command");
    expect(stdout).toContain("Run completed:");
  });

  it("prompts for approval before running an execute tool", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-cli-"));
    const input = JSON.stringify({
      command: process.execPath,
      args: ["-e", "console.log('hello approved prompt')"]
    });

    const result = await runCliWithInput(
      ["tool", "run_command", input, "--workspace", workspaceRoot],
      "y\n"
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Approval required: run_command (execute)");
    expect(result.stdout).toContain("Approve run_command? [y/N]");
    expect(result.stdout).toContain("Approval resolved: approved");
    expect(result.stdout).toContain("hello approved prompt");
    expect(result.stdout).toContain("Run completed:");
  });
});
