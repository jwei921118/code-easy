import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SqliteSessionStore } from "./sqliteSessionStore.js";

const execFileAsync = promisify(execFile);

describe("SqliteSessionStore", () => {
  it("persists run metadata and events for replay", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-store-"));
    const store = await SqliteSessionStore.open(root);

    await store.recordRunStarted({
      runId: "run-1",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "Inspect the project",
      startedAt: "2026-06-11T00:00:00.000Z"
    });
    await store.recordEvent({ type: "run.started", runId: "run-1", threadId: "thread-1" });
    await store.recordEvent({ type: "run.completed", runId: "run-1", summary: "Completed." });
    await store.recordRunCompleted({
      runId: "run-1",
      status: "completed",
      completedAt: "2026-06-11T00:00:01.000Z",
      summary: "Completed."
    });

    await expect(store.listEvents("run-1")).resolves.toEqual([
      { sequence: 1, event: { type: "run.started", runId: "run-1", threadId: "thread-1" } },
      { sequence: 2, event: { type: "run.completed", runId: "run-1", summary: "Completed." } }
    ]);
  });

  it("lists grouped sessions newest first", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-store-"));
    const store = await SqliteSessionStore.open(root);

    await store.recordRunStarted({
      runId: "run-1",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "First task",
      startedAt: "2026-06-11T00:00:00.000Z"
    });
    await store.recordRunCompleted({
      runId: "run-1",
      status: "completed",
      completedAt: "2026-06-11T00:00:01.000Z",
      summary: "First done."
    });
    await store.recordRunStarted({
      runId: "run-2",
      threadId: "thread-1",
      workspaceRoot: "/workspace",
      prompt: "Followup task",
      startedAt: "2026-06-11T00:02:00.000Z"
    });
    await store.recordRunCompleted({
      runId: "run-2",
      status: "completed",
      completedAt: "2026-06-11T00:02:01.000Z",
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
        startedAt: "2026-06-11T00:00:00.000Z",
        lastUpdatedAt: "2026-06-11T00:02:01.000Z",
        completedAt: "2026-06-11T00:02:01.000Z",
        summary: "Followup done."
      }
    ]);
  });

  it("keeps default .code-easy local SQLite storage out of git status", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-git-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    const store = await SqliteSessionStore.open(path.join(workspaceRoot, ".code-easy", "local"));

    await store.recordEvent({ type: "run.completed", runId: "run-1", summary: "Completed." });

    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: workspaceRoot });
    expect(stdout).toBe("");
  });
});
