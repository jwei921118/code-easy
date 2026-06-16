import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEventSchema, type AgentEvent } from "@code-easy/ui-protocol";
import { ensureLocalStorageRoot, readFileIfExists } from "./localStorage.js";
import type {
  PendingApprovalRecord,
  RunCompletedRecord,
  RunStartedRecord,
  SessionStore,
  StoredEventRecord,
  StoredSessionSummary
} from "./types.js";

type RunRecord =
  | (RunStartedRecord & { status: "started" })
  | (RunCompletedRecord & { threadId?: string; workspaceRoot?: string; prompt?: string });

type CompletionDetails = {
  completedAt?: string;
  summary?: string;
  error?: string;
};

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
  private readonly pendingApprovalsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly rootPath: string) {
    this.runsPath = path.join(rootPath, "runs.jsonl");
    this.eventsPath = path.join(rootPath, "events.jsonl");
    this.pendingApprovalsPath = path.join(rootPath, "pending-approvals.jsonl");
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
    const byThreadId = new Map<string, StoredSessionSummary>();
    const runToThreadId = new Map<string, string>();

    for (const record of records) {
      if (record.status === "started") {
        runToThreadId.set(record.runId, record.threadId);
        const existing = byThreadId.get(record.threadId);

        byThreadId.set(record.threadId, {
          runId: record.runId,
          runIds: [...(existing?.runIds ?? []), record.runId],
          runCount: (existing?.runCount ?? 0) + 1,
          threadId: record.threadId,
          workspaceRoot: record.workspaceRoot,
          prompt: record.prompt,
          status: "started",
          startedAt: existing?.startedAt ?? record.startedAt,
          lastUpdatedAt: record.startedAt
        });
        continue;
      }

      const threadId = runToThreadId.get(record.runId);
      if (!threadId) continue;

      const existing = byThreadId.get(threadId);
      if (!existing) continue;

      const completion = completionDetails(record);
      byThreadId.set(threadId, {
        ...existing,
        lastUpdatedAt: record.completedAt,
        ...(existing.runId === record.runId
          ? {
              status: record.status,
              ...completion
            }
          : {})
      });
    }

    return [...byThreadId.values()].sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
  }

  async listEvents(runId?: string): Promise<StoredEventRecord[]> {
    const records = await readJsonLines<StoredEventRecord>(this.eventsPath);
    return runId === undefined ? records : records.filter((record) => record.event.runId === runId);
  }

  async recordPendingApproval(record: PendingApprovalRecord): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureRoot();
      const records = await this.listPendingApprovals();
      const nextRecords = [...records.filter((candidate) => candidate.approvalId !== record.approvalId), record];
      await writeJsonLines(this.pendingApprovalsPath, nextRecords);
    });
  }

  async getPendingApproval(approvalId: string): Promise<PendingApprovalRecord | undefined> {
    const records = await this.listPendingApprovals();
    return records.find((record) => record.approvalId === approvalId);
  }

  async deletePendingApproval(approvalId: string): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureRoot();
      const records = await this.listPendingApprovals();
      await writeJsonLines(
        this.pendingApprovalsPath,
        records.filter((record) => record.approvalId !== approvalId)
      );
    });
  }

  async listPendingApprovals(): Promise<PendingApprovalRecord[]> {
    return readJsonLines<PendingApprovalRecord>(this.pendingApprovalsPath);
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
    await ensureLocalStorageRoot(this.rootPath);
  }
}

async function writeJsonLines<T>(filePath: string, values: T[]): Promise<void> {
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join("\n") + (values.length > 0 ? "\n" : ""), "utf8");
}

function completionDetails(record: RunCompletedRecord): CompletionDetails {
  return {
    completedAt: record.completedAt,
    ...(record.summary !== undefined ? { summary: record.summary } : {}),
    ...(record.error !== undefined ? { error: record.error } : {})
  };
}
