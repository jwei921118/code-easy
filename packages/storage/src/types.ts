import type { AgentEvent } from "@code-easy/ui-protocol";

export type RunStartedRecord = {
  runId: string;
  threadId: string;
  workspaceRoot: string;
  prompt: string;
  startedAt: string;
};

export type RunCompletedRecord = {
  runId: string;
  status: "completed" | "failed";
  completedAt: string;
  summary?: string;
  error?: string;
};

export type StoredEventRecord = {
  sequence: number;
  event: AgentEvent;
};

export type StoredSessionSummary = {
  runId: string;
  runIds: string[];
  runCount: number;
  threadId: string;
  workspaceRoot: string;
  prompt: string;
  status: "started" | "completed" | "failed";
  startedAt: string;
  lastUpdatedAt: string;
  completedAt?: string;
  summary?: string;
  error?: string;
};

type StoredModelMessage = {
  role: "system" | "user";
  content: string;
};

type StoredModelToolCall = {
  callId: string;
  name: string;
  argumentsText: string;
};

type StoredModelToolResult = {
  callId: string;
  output: string;
};

export type PendingApprovalRecord = {
  approvalId: string;
  runId: string;
  threadId: string;
  workspaceRoot: string;
  call: StoredModelToolCall;
  input: unknown;
  messages: StoredModelMessage[];
  toolResults: StoredModelToolResult[];
  nextRound: number;
  createdAt: string;
};

/** 会话持久化接口，统一文件存储和 SQLite 存储的行为。 */
export interface SessionStore {
  /** 记录运行启动元数据。 */
  recordRunStarted(record: RunStartedRecord): Promise<void>;
  /** 记录运行完成或失败元数据。 */
  recordRunCompleted(record: RunCompletedRecord): Promise<void>;
  /** 记录可回放的运行时事件。 */
  recordEvent(event: AgentEvent): Promise<void>;
  /** 列出按 thread 聚合后的会话摘要。 */
  listSessions(): Promise<StoredSessionSummary[]>;
  /** 列出事件流，可选按 runId 过滤。 */
  listEvents(runId?: string): Promise<StoredEventRecord[]>;
  /** 保存模型工具调用的待审批暂停点。 */
  recordPendingApproval(record: PendingApprovalRecord): Promise<void>;
  /** 读取指定审批暂停点。 */
  getPendingApproval(approvalId: string): Promise<PendingApprovalRecord | undefined>;
  /** 删除已处理的审批暂停点。 */
  deletePendingApproval(approvalId: string): Promise<void>;
}
