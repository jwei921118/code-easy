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

export interface SessionStore {
  recordRunStarted(record: RunStartedRecord): Promise<void>;
  recordRunCompleted(record: RunCompletedRecord): Promise<void>;
  recordEvent(event: AgentEvent): Promise<void>;
  listSessions(): Promise<StoredSessionSummary[]>;
  listEvents(runId?: string): Promise<StoredEventRecord[]>;
}
