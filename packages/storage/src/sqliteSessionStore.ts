import path from "node:path";
import { ensureLocalStorageRoot } from "./localStorage.js";
import { SqliteDriver } from "./sqliteDriver.js";
import { SqlSessionRepository } from "./sqlSessionRepository.js";
import type { PendingApprovalRecord, RunCompletedRecord, RunStartedRecord, SessionStore } from "./types.js";
import type { AgentEvent } from "@code-easy/ui-protocol";

export class SqliteSessionStore implements SessionStore {
  private constructor(private readonly repository: SqlSessionRepository) {}

  static async open(rootPath: string): Promise<SqliteSessionStore> {
    await ensureLocalStorageRoot(rootPath);
    const driver = new SqliteDriver(path.join(rootPath, "code-easy.sqlite"));
    driver.migrate();
    return new SqliteSessionStore(new SqlSessionRepository(driver));
  }

  async recordRunStarted(record: RunStartedRecord): Promise<void> {
    await this.repository.recordRunStarted(record);
  }

  async recordRunCompleted(record: RunCompletedRecord): Promise<void> {
    await this.repository.recordRunCompleted(record);
  }

  async recordEvent(event: AgentEvent): Promise<void> {
    await this.repository.recordEvent(event);
  }

  async listSessions() {
    return this.repository.listSessions();
  }

  async listEvents(runId?: string) {
    return this.repository.listEvents(runId);
  }

  async recordPendingApproval(record: PendingApprovalRecord) {
    return this.repository.recordPendingApproval(record);
  }

  async getPendingApproval(approvalId: string) {
    return this.repository.getPendingApproval(approvalId);
  }

  async deletePendingApproval(approvalId: string) {
    return this.repository.deletePendingApproval(approvalId);
  }

  async listPendingApprovals() {
    return this.repository.listPendingApprovals();
  }
}
