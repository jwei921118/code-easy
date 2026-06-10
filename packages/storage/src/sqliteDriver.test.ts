import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteDriver } from "./sqliteDriver.js";

describe("SqliteDriver", () => {
  it("creates the session schema and executes parameterized queries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-driver-"));
    const driver = new SqliteDriver(path.join(root, "code-easy.sqlite"));

    try {
      driver.migrate();
      driver.execute(
        "insert into runs (run_id, thread_id, workspace_root, prompt, started_at) values (?, ?, ?, ?, ?)",
        ["run-1", "thread-1", "/workspace", "Inspect", "2026-06-11T00:00:00.000Z"]
      );

      expect(
        driver.queryOne<{ run_id: string; prompt: string }>("select run_id, prompt from runs where run_id = ?", [
          "run-1"
        ])
      ).toEqual({
        run_id: "run-1",
        prompt: "Inspect"
      });
    } finally {
      driver.close();
    }
  });

  it("rolls back failed transactions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-easy-sqlite-driver-"));
    const driver = new SqliteDriver(path.join(root, "code-easy.sqlite"));

    try {
      driver.migrate();
      expect(() =>
        driver.transaction(() => {
          driver.execute(
            "insert into runs (run_id, thread_id, workspace_root, prompt, started_at) values (?, ?, ?, ?, ?)",
            ["run-1", "thread-1", "/workspace", "Inspect", "2026-06-11T00:00:00.000Z"]
          );
          throw new Error("fail");
        })
      ).toThrow("fail");

      expect(driver.query("select run_id from runs")).toEqual([]);
    } finally {
      driver.close();
    }
  });
});
