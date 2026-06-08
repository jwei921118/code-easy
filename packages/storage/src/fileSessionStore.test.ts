import { mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { FileSessionStore } from "./index.js";

const execFileAsync = promisify(execFile);

describe("FileSessionStore", () => {
  it("persists run metadata and events as replayable JSON lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-store-"));
    const store = new FileSessionStore(root);

    await store.recordRunStarted({
      runId: "run-1",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "Inspect the project",
      startedAt: "2026-06-08T00:00:00.000Z"
    });
    await store.recordEvent({
      type: "run.started",
      runId: "run-1",
      threadId: "thread-1"
    });
    await store.recordEvent({
      type: "run.completed",
      runId: "run-1",
      summary: "Completed."
    });
    await store.recordRunCompleted({
      runId: "run-1",
      status: "completed",
      completedAt: "2026-06-08T00:00:01.000Z",
      summary: "Completed."
    });

    await expect(store.listRunRecords()).resolves.toMatchObject([
      {
        runId: "run-1",
        threadId: "thread-1",
        status: "started"
      },
      {
        runId: "run-1",
        status: "completed",
        summary: "Completed."
      }
    ]);
    await expect(store.listEvents("run-1")).resolves.toEqual([
      {
        sequence: 1,
        event: {
          type: "run.started",
          runId: "run-1",
          threadId: "thread-1"
        }
      },
      {
        sequence: 2,
        event: {
          type: "run.completed",
          runId: "run-1",
          summary: "Completed."
        }
      }
    ]);

    const eventLines = await readFile(path.join(root, "events.jsonl"), "utf8");
    expect(eventLines.trim().split("\n")).toHaveLength(2);
  });

  it("keeps default .code-easy local storage out of git status", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-store-git-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    const store = new FileSessionStore(path.join(workspaceRoot, ".code-easy", "local"));

    await store.recordEvent({
      type: "run.completed",
      runId: "run-1",
      summary: "Completed."
    });

    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: workspaceRoot });
    expect(stdout).toBe("");
  });
});
