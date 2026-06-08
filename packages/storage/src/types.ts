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

export interface SessionStore {
  recordRunStarted(record: RunStartedRecord): Promise<void>;
  recordRunCompleted(record: RunCompletedRecord): Promise<void>;
  recordEvent(event: AgentEvent): Promise<void>;
}
