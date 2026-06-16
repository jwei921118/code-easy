import path from "node:path";
import { ensureLocalStorageRoot } from "./localStorage.js";
import { SqliteDriver } from "./sqliteDriver.js";
import { SqlSessionRepository } from "./sqlSessionRepository.js";
import type { PendingApprovalRecord, RunCompletedRecord, RunStartedRecord, SessionStore } from "./types.js";
import type { AgentEvent } from "@code-easy/ui-protocol";

/** 打开工作区本地 SQLite 数据库，并把 SessionStore 接口委托给 SQL repository。 */
export class SqliteSessionStore implements SessionStore {
  /** 通过静态 open() 构造，确保 schema 迁移已完成。 */
  private constructor(private readonly repository: SqlSessionRepository) {}

  /** 初始化默认 SQLite 存储目录、迁移 schema，并返回可用存储实例。 */
  static async open(rootPath: string): Promise<SqliteSessionStore> {
    await ensureLocalStorageRoot(rootPath);
    const driver = new SqliteDriver(path.join(rootPath, "code-easy.sqlite"));
    driver.migrate();
    return new SqliteSessionStore(new SqlSessionRepository(driver));
  }

  /** 转发运行启动记录到 SQL repository。 */
  async recordRunStarted(record: RunStartedRecord): Promise<void> {
    await this.repository.recordRunStarted(record);
  }

  /** 转发运行结束记录到 SQL repository。 */
  async recordRunCompleted(record: RunCompletedRecord): Promise<void> {
    await this.repository.recordRunCompleted(record);
  }

  /** 转发事件记录到 SQL repository。 */
  async recordEvent(event: AgentEvent): Promise<void> {
    await this.repository.recordEvent(event);
  }

  /** 列出已存储会话。 */
  async listSessions() {
    return this.repository.listSessions();
  }

  /** 列出事件流，可按 runId 过滤。 */
  async listEvents(runId?: string) {
    return this.repository.listEvents(runId);
  }

  /** 保存待审批记录。 */
  async recordPendingApproval(record: PendingApprovalRecord) {
    return this.repository.recordPendingApproval(record);
  }

  /** 读取待审批记录。 */
  async getPendingApproval(approvalId: string) {
    return this.repository.getPendingApproval(approvalId);
  }

  /** 删除待审批记录。 */
  async deletePendingApproval(approvalId: string) {
    return this.repository.deletePendingApproval(approvalId);
  }
}
