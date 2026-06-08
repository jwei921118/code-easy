import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEventSchema, type AgentEvent } from "@code-easy/ui-protocol";
import type {
  RunCompletedRecord,
  RunStartedRecord,
  SessionStore,
  StoredEventRecord,
  StoredSessionSummary
} from "./types.js";

type RunRecord =
  | (RunStartedRecord & { status: "started" })
  | (RunCompletedRecord & { threadId?: string; workspaceRoot?: string; prompt?: string });

function parseJsonLines<T>(content: string): T[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf8");
    return parseJsonLines<T>(content);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export class FileSessionStore implements SessionStore {
  private readonly runsPath: string;
  private readonly eventsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly rootPath: string) {
    this.runsPath = path.join(rootPath, "runs.jsonl");
    this.eventsPath = path.join(rootPath, "events.jsonl");
  }

  async recordRunStarted(record: RunStartedRecord): Promise<void> {
    await this.appendJsonLine(this.runsPath, {
      ...record,
      status: "started"
    });
  }

  async recordRunCompleted(record: RunCompletedRecord): Promise<void> {
    await this.appendJsonLine(this.runsPath, record);
  }

  async recordEvent(event: AgentEvent): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureRoot();
      const records = await readJsonLines<StoredEventRecord>(this.eventsPath);
      const sequence = (records.at(-1)?.sequence ?? 0) + 1;
      const parsed = AgentEventSchema.parse(event);
      const previous = await readFileIfExists(this.eventsPath);
      await writeFile(
        this.eventsPath,
        `${previous}${JSON.stringify({
          sequence,
          event: parsed
        })}\n`,
        "utf8"
      );
    });
  }

  async listRunRecords(): Promise<RunRecord[]> {
    return readJsonLines<RunRecord>(this.runsPath);
  }

  async listSessions(): Promise<StoredSessionSummary[]> {
    const records = await this.listRunRecords();
    const byRunId = new Map<string, StoredSessionSummary>();

    for (const record of records) {
      const existing = byRunId.get(record.runId);

      if (record.status === "started") {
        byRunId.set(record.runId, {
          runId: record.runId,
          threadId: record.threadId,
          workspaceRoot: record.workspaceRoot,
          prompt: record.prompt,
          status: "started",
          startedAt: record.startedAt
        });
        continue;
      }

      if (!existing) continue;

      byRunId.set(record.runId, {
        ...existing,
        status: record.status,
        completedAt: record.completedAt,
        summary: record.summary,
        error: record.error
      });
    }

    return [...byRunId.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async listEvents(runId?: string): Promise<StoredEventRecord[]> {
    const records = await readJsonLines<StoredEventRecord>(this.eventsPath);
    return runId === undefined ? records : records.filter((record) => record.event.runId === runId);
  }

  private async appendJsonLine(filePath: string, value: unknown): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureRoot();
      const line = `${JSON.stringify(value)}\n`;
      const previous = await readFileIfExists(filePath);
      await writeFile(filePath, `${previous}${line}`, "utf8");
    });
  }

  private async enqueue(action: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(action);
    return this.writeChain;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true });

    const codeEasyRoot = path.dirname(this.rootPath);
    if (path.basename(this.rootPath) !== "local" || path.basename(codeEasyRoot) !== ".code-easy") return;

    const ignorePath = path.join(codeEasyRoot, ".gitignore");
    const current = await readFileIfExists(ignorePath);
    if (current.split(/\r?\n/).includes("*")) return;

    await writeFile(ignorePath, `${current}${current.length > 0 && !current.endsWith("\n") ? "\n" : ""}*\n`, "utf8");
  }
}

async function readFileIfExists(filePath: string): Promise<string> {
  try {
    await stat(filePath);
    return readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}
