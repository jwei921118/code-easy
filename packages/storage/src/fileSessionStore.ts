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

/** 解析 JSONL 内容，忽略空行并返回结构化记录。 */
function parseJsonLines<T>(content: string): T[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/** 读取 JSONL 文件；文件不存在时按空记录处理。 */
async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf8");
    return parseJsonLines<T>(content);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** 使用 JSONL 文件持久化运行、事件和待审批记录的会话存储。 */
export class FileSessionStore implements SessionStore {
  private readonly runsPath: string;
  private readonly eventsPath: string;
  private readonly pendingApprovalsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  /** 绑定文件存储根目录，并派生运行、事件和审批 JSONL 路径。 */
  constructor(private readonly rootPath: string) {
    this.runsPath = path.join(rootPath, "runs.jsonl");
    this.eventsPath = path.join(rootPath, "events.jsonl");
    this.pendingApprovalsPath = path.join(rootPath, "pending-approvals.jsonl");
  }

  /** 记录一次运行启动，用于后续会话列表和事件回放关联。 */
  async recordRunStarted(record: RunStartedRecord): Promise<void> {
    await this.appendJsonLine(this.runsPath, {
      ...record,
      status: "started"
    });
  }

  /** 记录一次运行结束状态，包括完成摘要或失败错误。 */
  async recordRunCompleted(record: RunCompletedRecord): Promise<void> {
    await this.appendJsonLine(this.runsPath, record);
  }

  /** 追加一条经过协议校验的 Agent 事件，并生成递增序号。 */
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

  /** 返回原始运行记录，主要供文件存储内部聚合会话摘要。 */
  async listRunRecords(): Promise<RunRecord[]> {
    return readJsonLines<RunRecord>(this.runsPath);
  }

  /** 将运行记录按 thread 聚合为面向用户的会话摘要。 */
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

  /** 列出事件流；传入 runId 时只返回对应运行的事件。 */
  async listEvents(runId?: string): Promise<StoredEventRecord[]> {
    const records = await readJsonLines<StoredEventRecord>(this.eventsPath);
    return runId === undefined ? records : records.filter((record) => record.event.runId === runId);
  }

  /** 保存或替换一个待审批记录，用于稍后继续原运行。 */
  async recordPendingApproval(record: PendingApprovalRecord): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureRoot();
      const records = await this.readPendingApprovals();
      const nextRecords = [...records.filter((candidate) => candidate.approvalId !== record.approvalId), record];
      await writeJsonLines(this.pendingApprovalsPath, nextRecords);
    });
  }

  /** 按审批 id 读取待审批记录。 */
  async getPendingApproval(approvalId: string): Promise<PendingApprovalRecord | undefined> {
    const records = await this.readPendingApprovals();
    return records.find((record) => record.approvalId === approvalId);
  }

  /** 删除已经处理完的待审批记录。 */
  async deletePendingApproval(approvalId: string): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureRoot();
      const records = await this.readPendingApprovals();
      await writeJsonLines(
        this.pendingApprovalsPath,
        records.filter((record) => record.approvalId !== approvalId)
      );
    });
  }

  /** 读取当前文件存储中的所有待审批记录。 */
  private async readPendingApprovals(): Promise<PendingApprovalRecord[]> {
    return readJsonLines<PendingApprovalRecord>(this.pendingApprovalsPath);
  }

  /** 以串行写入方式追加一行 JSON，避免并发写覆盖。 */
  private async appendJsonLine(filePath: string, value: unknown): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureRoot();
      const line = `${JSON.stringify(value)}\n`;
      const previous = await readFileIfExists(filePath);
      await writeFile(filePath, `${previous}${line}`, "utf8");
    });
  }

  /** 将写操作接到同一个 promise 链上，保证文件存储写入顺序。 */
  private async enqueue(action: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(action);
    return this.writeChain;
  }

  /** 确保存储目录存在，并维护本地 `.code-easy` 忽略规则。 */
  private async ensureRoot(): Promise<void> {
    await ensureLocalStorageRoot(this.rootPath);
  }
}

/** 将记录数组覆盖写回 JSONL 文件。 */
async function writeJsonLines<T>(filePath: string, values: T[]): Promise<void> {
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join("\n") + (values.length > 0 ? "\n" : ""), "utf8");
}

/** 从运行结束记录中提取可放入会话摘要的完成信息。 */
function completionDetails(record: RunCompletedRecord): CompletionDetails {
  return {
    completedAt: record.completedAt,
    ...(record.summary !== undefined ? { summary: record.summary } : {}),
    ...(record.error !== undefined ? { error: record.error } : {})
  };
}
