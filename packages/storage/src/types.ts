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

export type StoredModelMessage = {
  role: "system" | "user";
  content: string;
};

export type StoredModelToolCall = {
  callId: string;
  name: string;
  argumentsText: string;
};

export type StoredModelToolResult = {
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

export interface SessionStore {
  recordRunStarted(record: RunStartedRecord): Promise<void>;
  recordRunCompleted(record: RunCompletedRecord): Promise<void>;
  recordEvent(event: AgentEvent): Promise<void>;
  listSessions(): Promise<StoredSessionSummary[]>;
  listEvents(runId?: string): Promise<StoredEventRecord[]>;
  recordPendingApproval(record: PendingApprovalRecord): Promise<void>;
  getPendingApproval(approvalId: string): Promise<PendingApprovalRecord | undefined>;
  deletePendingApproval(approvalId: string): Promise<void>;
  listPendingApprovals(): Promise<PendingApprovalRecord[]>;
}
