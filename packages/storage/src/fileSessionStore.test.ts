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

  it("lists sessions with completion details first by newest start time", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-store-"));
    const store = new FileSessionStore(root);

    await store.recordRunStarted({
      runId: "run-old",
      threadId: "thread-old",
      workspaceRoot: "/workspace",
      prompt: "Old task",
      startedAt: "2026-06-08T00:00:00.000Z"
    });
    await store.recordRunStarted({
      runId: "run-new",
      threadId: "thread-new",
      workspaceRoot: "/workspace",
      prompt: "New task",
      startedAt: "2026-06-08T00:01:00.000Z"
    });
    await store.recordRunCompleted({
      runId: "run-new",
      status: "completed",
      completedAt: "2026-06-08T00:01:01.000Z",
      summary: "New task done."
    });

    await expect(store.listSessions()).resolves.toEqual([
      {
        runId: "run-new",
        runIds: ["run-new"],
        runCount: 1,
        threadId: "thread-new",
        workspaceRoot: "/workspace",
        prompt: "New task",
        status: "completed",
        startedAt: "2026-06-08T00:01:00.000Z",
        lastUpdatedAt: "2026-06-08T00:01:01.000Z",
        completedAt: "2026-06-08T00:01:01.000Z",
        summary: "New task done."
      },
      {
        runId: "run-old",
        runIds: ["run-old"],
        runCount: 1,
        threadId: "thread-old",
        workspaceRoot: "/workspace",
        prompt: "Old task",
        status: "started",
        startedAt: "2026-06-08T00:00:00.000Z",
        lastUpdatedAt: "2026-06-08T00:00:00.000Z"
      }
    ]);
  });

  it("groups multiple runs for the same thread into one latest session summary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-store-"));
    const store = new FileSessionStore(root);

    await store.recordRunStarted({
      runId: "run-1",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "First task",
      startedAt: "2026-06-08T00:00:00.000Z"
    });
    await store.recordRunCompleted({
      runId: "run-1",
      status: "completed",
      completedAt: "2026-06-08T00:00:01.000Z",
      summary: "First done."
    });
    await store.recordRunStarted({
      runId: "run-2",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "Followup task",
      startedAt: "2026-06-08T00:02:00.000Z"
    });
    await store.recordRunCompleted({
      runId: "run-2",
      status: "completed",
      completedAt: "2026-06-08T00:02:01.000Z",
      summary: "Followup done."
    });

    await expect(store.listSessions()).resolves.toEqual([
      {
        runId: "run-2",
        runIds: ["run-1", "run-2"],
        runCount: 2,
        threadId: "thread-1",
        workspaceRoot: "/workspace",
        prompt: "Followup task",
        status: "completed",
        startedAt: "2026-06-08T00:00:00.000Z",
        lastUpdatedAt: "2026-06-08T00:02:01.000Z",
        completedAt: "2026-06-08T00:02:01.000Z",
        summary: "Followup done."
      }
    ]);
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
