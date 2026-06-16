import { randomUUID } from "node:crypto";
import path from "node:path";
import { createCodeEasyGraph } from "@code-easy/agent-core";
import { SqliteSessionStore, type PendingApprovalRecord, type SessionStore, type StoredSessionSummary } from "@code-easy/storage";
import { formatApplyPatchDiff } from "@code-easy/tools";
import { RuntimeCommandSchema, type AgentEvent, type RunCommand } from "@code-easy/ui-protocol";
import { AgentEventBus } from "./eventBus.js";
import {
  buildWorkspaceContextMessages,
  type ModelProvider,
  type ModelToolCall,
  type ModelToolResult
} from "./modelProvider.js";
import { getModelCallableTool, modelToolDefinitions } from "./modelToolSchemas.js";
import { PermissionedToolExecutor, type ToolExecutionOutcome } from "./toolExecutor.js";
import { createDefaultToolRegistry, type ToolRegistry } from "./toolRegistry.js";

export type RunResult = {
  runId: string;
  threadId: string;
  status?: "completed" | "approval_required";
  approvalId?: string;
};

export type RunToolCommand = {
  threadId?: string;
  workspaceRoot: string;
  toolName: string;
  input: unknown;
  approved?: boolean;
  approvalId?: string;
};

export type RunToolResult = RunResult & {
  outcome: ToolExecutionOutcome;
};

export type ApproveCommand = {
  workspaceRoot: string;
  approvalId: string;
  approved: boolean;
};

export type WorkspaceSessionCommand = {
  workspaceRoot: string;
};

export type ResumeSessionCommand = WorkspaceSessionCommand & {
  threadId: string;
  prompt?: string;
};

export type SessionManagerOptions = {
  tools?: ToolRegistry;
  store?: SessionStore | false;
  modelProvider?: ModelProvider | false;
  model?: string;
};

type PendingModelApproval = {
  approvalId: string;
  runId: string;
  threadId: string;
  workspaceRoot: string;
  call: ModelToolCall;
  input: unknown;
  toolResults: ModelToolResult[];
  messages: ReturnType<typeof buildWorkspaceContextMessages>;
  nextRound: number;
};

/** 将内存中的模型审批状态转换为可持久化记录。 */
function toPendingApprovalRecord(pending: PendingModelApproval): PendingApprovalRecord {
  return {
    approvalId: pending.approvalId,
    runId: pending.runId,
    threadId: pending.threadId,
    workspaceRoot: pending.workspaceRoot,
    call: pending.call,
    input: pending.input,
    messages: pending.messages,
    toolResults: pending.toolResults,
    nextRound: pending.nextRound,
    createdAt: new Date().toISOString()
  };
}

/** 从持久化记录恢复模型审批状态，用于跨进程继续运行。 */
function pendingModelApprovalFromRecord(record: PendingApprovalRecord): PendingModelApproval {
  return {
    approvalId: record.approvalId,
    runId: record.runId,
    threadId: record.threadId,
    workspaceRoot: record.workspaceRoot,
    call: record.call,
    input: record.input,
    messages: record.messages,
    toolResults: record.toolResults,
    nextRound: record.nextRound
  };
}

/** 判断未知值是否为普通对象，便于后续安全读取字段。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 从用户提示中提取默认搜索词，给确定性上下文收集使用。 */
function extractSearchPattern(prompt: string): string {
  const quoted = prompt.match(/["']([^"']+)["']/);
  if (quoted?.[1]) return quoted[1];

  const stopWords = new Set(["find", "search", "inspect", "check", "explain", "project", "workspace", "code", "for", "the"]);
  const tokens = prompt.match(/[A-Za-z0-9_-]{3,}/g) ?? [];
  const candidate = tokens.find((token) => !stopWords.has(token.toLowerCase()));

  return candidate ?? tokens[0] ?? prompt.trim();
}

/** 把 git_status 工具输出压缩成模型和 CLI 可读摘要。 */
function summarizeGitStatus(output: unknown): string {
  if (!isRecord(output) || typeof output.stdout !== "string") return "Git status unavailable.";

  const status = output.stdout.trim();
  return status === "" ? "Git status: clean." : `Git status:\n${status}`;
}

/** 把 list_files 工具输出压缩成有限文件列表摘要。 */
function summarizeFiles(output: unknown): string {
  if (!isRecord(output) || !Array.isArray(output.files)) return "Files unavailable.";

  const files = output.files.filter((file): file is string => typeof file === "string").slice(0, 10);
  return files.length === 0 ? "Files: none found." : `Files:\n${files.map((file) => `- ${file}`).join("\n")}`;
}

/** 把 rg_search 工具输出压缩成有限匹配摘要。 */
function summarizeSearch(pattern: string, output: unknown): string {
  if (!isRecord(output) || !Array.isArray(output.matches)) return `Search matches for "${pattern}": unavailable.`;

  const matches = output.matches.filter(isRecord).slice(0, 5);
  if (matches.length === 0) return `Search matches for "${pattern}": none.`;

  return `Search matches for "${pattern}":\n${matches
    .map((match) => {
      const filePath = typeof match.path === "string" ? match.path : "unknown";
      const line = typeof match.line === "number" ? match.line : 0;
      const text = typeof match.text === "string" ? match.text : "";
      return `- ${filePath}:${line} ${text}`;
    })
    .join("\n")}`;
}

/** 管理一次或多次 Agent 运行，串联工具、模型、审批、事件和持久化。 */
export class SessionManager {
  private readonly events = new AgentEventBus();
  private readonly tools: ToolRegistry;
  private readonly configuredStore?: SessionStore | false;
  private readonly modelProvider?: ModelProvider | false;
  private readonly model: string;
  private readonly pendingModelApprovals = new Map<string, PendingModelApproval>();

  /** 初始化会话管理器，可注入工具、存储和模型提供方以支持测试或不同客户端。 */
  constructor(options: SessionManagerOptions = {}) {
    this.tools = options.tools ?? createDefaultToolRegistry();
    this.configuredStore = options.store;
    this.modelProvider = options.modelProvider;
    this.model = options.model ?? "gpt-5-mini";
  }

  /** 订阅运行时事件，供 CLI 渲染或存储层记录事件流。 */
  subscribe(handler: (event: AgentEvent) => void): () => void {
    return this.events.subscribe(handler);
  }

  /** 执行用户任务：收集上下文、调用模型或确定性流程，并发布完整运行事件。 */
  async run(commandInput: RunCommand): Promise<RunResult> {
    const command = RuntimeCommandSchema.parse(commandInput);

    if (command.kind !== "run") {
      throw new Error(`Unsupported command kind for run(): ${command.kind}`);
    }

    const runId = randomUUID();
    const threadId = command.threadId ?? randomUUID();
    const store = await this.getStore(command.workspaceRoot);
    const persist = this.captureStoredEvents(store);

    await store?.recordRunStarted({
      runId,
      threadId,
      workspaceRoot: command.workspaceRoot,
      prompt: command.prompt,
      startedAt: new Date().toISOString()
    });

    this.events.publish({ type: "run.started", runId, threadId });
    this.events.publish({ type: "node.started", runId, node: "intake" });

    try {
      const graph = createCodeEasyGraph();
      const result = await graph.invoke({
        messages: [command.prompt],
        workspaceRoot: command.workspaceRoot
      });

      this.events.publish({ type: "node.completed", runId, node: "intake" });
      this.events.publish({ type: "node.started", runId, node: "context_builder" });

      const searchPattern = extractSearchPattern(command.prompt);
      const gitStatus = await this.executeToolForRun(runId, command.workspaceRoot, "git_status", { porcelain: true });
      const fileList = await this.executeToolForRun(runId, command.workspaceRoot, "list_files", {
        path: ".",
        limit: 50,
        includeHidden: false
      });
      const searchResults = await this.executeToolForRun(runId, command.workspaceRoot, "rg_search", {
        pattern: searchPattern,
        path: ".",
        maxMatches: 10,
        caseSensitive: true
      });
      const gitStatusSummary = summarizeGitStatus(gitStatus);
      const fileSummary = summarizeFiles(fileList);
      const searchSummary = summarizeSearch(searchPattern, searchResults);
      const graphMessage = result.messages.at(-1) ?? "Runtime completed.";
      let messageText: string | undefined;
      let summary: string | undefined;

      if (this.modelProvider) {
        const messages = buildWorkspaceContextMessages({
          userPrompt: command.prompt,
          gitStatusSummary,
          fileSummary,
          searchSummary
        });
        const toolResults: ModelToolResult[] = [];

        for (let round = 0; round < 4; round += 1) {
          const modelResult = await this.modelProvider.generateText({
            model: this.model,
            messages,
            tools: modelToolDefinitions,
            toolResults
          });
          const retryResult =
            (modelResult.toolCalls ?? []).length === 0 &&
            (modelResult.text === undefined || modelResult.text.trim().length === 0)
              ? await this.modelProvider.generateText({
                  model: this.model,
                  messages,
                  toolResults
                })
              : modelResult;

          const toolCalls = retryResult.toolCalls ?? [];
          if (toolCalls.length === 0) {
            messageText = retryResult.text;
            if (messageText === undefined || messageText.trim().length === 0) {
              throw new Error("Model returned an empty response.");
            }
            summary = "Model response completed.";
            break;
          }

          if (toolCalls.length > 1) {
            throw new Error(`Model returned ${toolCalls.length} tool calls; expected at most 1`);
          }

          if (round === 3) {
            throw new Error("Model exceeded maximum tool call rounds.");
          }

          const toolCall = toolCalls[0];
          const approvalId = toolCall.name === "apply_patch" ? randomUUID() : undefined;
          const toolExecution = await this.executeModelToolCall(
            runId,
            command.workspaceRoot,
            toolCall,
            approvalId,
            undefined,
            async (pendingApprovalId, input) => {
              await this.rememberPendingModelApproval(store, {
                approvalId: pendingApprovalId,
                runId,
                threadId,
                workspaceRoot: command.workspaceRoot,
                call: toolCall,
                input,
                toolResults: [...toolResults],
                messages,
                nextRound: round + 1
              });
            }
          );
          if (toolExecution.status === "approval_required") {
            this.events.publish({
              type: "run.paused",
              runId,
              reason: "approval_required",
              approvalId: toolExecution.approvalId
            });
            await persist.flush();

            return {
              runId,
              threadId,
              status: "approval_required",
              approvalId: toolExecution.approvalId
            };
          }

          toolResults.push(toolExecution.result);
        }

        if (messageText === undefined || summary === undefined) {
          throw new Error("Model did not produce a final response.");
        }
      } else {
        messageText = ["Workspace context", gitStatusSummary, fileSummary, searchSummary, graphMessage].join("\n\n");
        summary = "Workspace inspection completed.";
      }

      this.events.publish({ type: "node.completed", runId, node: "context_builder" });
      this.events.publish({
        type: "message.delta",
        runId,
        text: messageText
      });
      this.events.publish({
        type: "run.completed",
        runId,
        summary
      });
      await store?.recordRunCompleted({
        runId,
        status: "completed",
        completedAt: new Date().toISOString(),
        summary
      });
      await persist.flush();

      return { runId, threadId, status: "completed" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.events.publish({
        type: "run.failed",
        runId,
        error: {
          category: "runtime_failed",
          message: "Session run failed.",
          detail
        }
      });
      await store?.recordRunCompleted({
        runId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: detail
      });
      await persist.flush();
      throw error;
    } finally {
      persist.unsubscribe();
    }
  }

  /** 为 run() 的确定性上下文收集执行只读工具，并返回工具输出。 */
  private async executeToolForRun(runId: string, workspaceRoot: string, toolName: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    let output: unknown;
    const unsubscribe = this.events.subscribe((event) => {
      if (event.type === "tool.completed" && event.runId === runId && event.result.name === toolName && event.result.ok) {
        output = event.result.output;
      }
    });

    try {
      const executor = new PermissionedToolExecutor(this.events);
      const outcome = await executor.execute({
        runId,
        workspaceRoot,
        tool,
        input
      });

      if (outcome.status !== "completed") {
        throw new Error(`Tool ${toolName} unexpectedly required approval.`);
      }

      return output;
    } finally {
      unsubscribe();
    }
  }

  /** 解析模型返回的工具参数 JSON，并为错误附加工具名上下文。 */
  private parseToolArguments(call: ModelToolCall): unknown {
    try {
      return JSON.parse(call.argumentsText) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Model returned invalid JSON arguments for ${call.name}: ${detail}`);
    }
  }

  /** 执行模型请求的单个工具调用，并在 apply_patch 需要审批时保存暂停点。 */
  private async executeModelToolCall(
    runId: string,
    workspaceRoot: string,
    call: ModelToolCall,
    approvalId?: string,
    approved?: boolean,
    onApprovalRequired?: (approvalId: string, input: unknown) => void | Promise<void>,
    emitDiff = true
  ): Promise<
    | { status: "completed"; result: ModelToolResult }
    | { status: "approval_required"; approvalId: string; input: unknown }
  > {
    if (!getModelCallableTool(call.name)) {
      throw new Error(`Model requested unavailable tool: ${call.name}`);
    }

    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`Model requested unregistered tool: ${call.name}`);
    }

    const input = tool.inputSchema.parse(this.parseToolArguments(call));
    const requestApprovalId = approvalId ?? (call.name === "apply_patch" && approved !== true ? randomUUID() : undefined);
    if (emitDiff && call.name === "apply_patch" && isRecord(input)) {
      this.events.publish({
        type: "diff.ready",
        runId,
        diff: formatApplyPatchDiff({
          path: String(input.path),
          oldText: String(input.oldText),
          newText: String(input.newText),
          replacements: typeof input.expectedReplacements === "number" ? input.expectedReplacements : undefined
        })
      });
      if (approved !== true && requestApprovalId) {
        await onApprovalRequired?.(requestApprovalId, input);
      }
    }

    let completedResult: unknown;
    const unsubscribe = this.events.subscribe((event) => {
      if (event.type === "tool.completed" && event.runId === runId && event.result.name === call.name) {
        completedResult = event.result;
      }
    });

    const executor = new PermissionedToolExecutor(this.events);
    try {
      const outcome = await executor.execute({
        runId,
        workspaceRoot,
        tool,
        input,
        approvalId: requestApprovalId,
        approved
      });

      if (outcome.status === "approval_required") {
        return {
          status: "approval_required",
          approvalId: outcome.approvalId,
          input
        };
      }

      return {
        status: "completed",
        result: {
          callId: call.callId,
          output: JSON.stringify(completedResult)
        }
      };
    } finally {
      unsubscribe();
    }
  }

  /** 直接运行一个指定工具，主要服务 CLI tool 子命令和底层能力验证。 */
  async runTool(command: RunToolCommand): Promise<RunToolResult> {
    const runId = randomUUID();
    const threadId = command.threadId ?? randomUUID();
    const tool = this.tools.get(command.toolName);
    const store = await this.getStore(command.workspaceRoot);
    const persist = this.captureStoredEvents(store);

    await store?.recordRunStarted({
      runId,
      threadId,
      workspaceRoot: command.workspaceRoot,
      prompt: `tool:${command.toolName}`,
      startedAt: new Date().toISOString()
    });

    this.events.publish({ type: "run.started", runId, threadId });

    if (!tool) {
      const error = {
        category: "invalid_tool_call" as const,
        message: `Unknown tool: ${command.toolName}`
      };
      this.events.publish({ type: "run.failed", runId, error });
      await store?.recordRunCompleted({
        runId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error.message
      });
      await persist.flush();
      persist.unsubscribe();
      throw new Error(error.message);
    }

    try {
      const executor = new PermissionedToolExecutor(this.events);
      const outcome = await executor.execute({
        runId,
        workspaceRoot: command.workspaceRoot,
        tool,
        input: command.input,
        approved: command.approved,
        approvalId: command.approvalId
      });

      if (outcome.status === "completed") {
        this.events.publish({
          type: "run.completed",
          runId,
          summary: `Tool ${command.toolName} completed.`
        });
        await store?.recordRunCompleted({
          runId,
          status: "completed",
          completedAt: new Date().toISOString(),
          summary: `Tool ${command.toolName} completed.`
        });
      }

      await persist.flush();
      return { runId, threadId, outcome };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.events.publish({
        type: "run.failed",
        runId,
        error: {
          category: "runtime_failed",
          message: `Tool ${command.toolName} failed.`,
          detail
        }
      });
      await store?.recordRunCompleted({
        runId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: detail
      });
      await persist.flush();
      throw error;
    } finally {
      persist.unsubscribe();
    }
  }

  /** 处理用户对挂起审批的决定，并从原来的模型工具调用点继续运行。 */
  async approve(command: ApproveCommand): Promise<RunResult> {
    const store = await this.getStore(command.workspaceRoot);
    const pending = await this.loadPendingModelApproval(store, command.approvalId);
    if (!pending) {
      throw new Error(`Unknown approval: ${command.approvalId}`);
    }

    if (pending.workspaceRoot !== command.workspaceRoot) {
      throw new Error("Approval workspaceRoot does not match pending approval.");
    }

    const persist = this.captureStoredEvents(store);
    const toolResults = [...pending.toolResults];

    try {
      if (!this.modelProvider) {
        throw new Error("Cannot continue a model approval without a model provider.");
      }

      if (command.approved) {
        const approvedToolExecution = await this.executeModelToolCall(
          pending.runId,
        command.workspaceRoot,
        pending.call,
        pending.approvalId,
        true,
        undefined,
        false
      );

        if (approvedToolExecution.status !== "completed") {
          throw new Error(`Approved model tool ${pending.call.name} unexpectedly required approval.`);
        }

        toolResults.push(approvedToolExecution.result);
      } else {
        this.events.publish({
          type: "approval.resolved",
          runId: pending.runId,
          decision: {
            approvalId: pending.approvalId,
            approved: false,
            rememberForSession: false
          }
        });
        toolResults.push({
          callId: pending.call.callId,
          output: JSON.stringify({
            ok: false,
            error: {
              category: "denied",
              message: `User denied ${pending.call.name}.`
            }
          })
        });
      }

      let messageText: string | undefined;
      let summary: string | undefined;

      for (let round = pending.nextRound; round < 4; round += 1) {
        const modelResult = await this.modelProvider.generateText({
          model: this.model,
          messages: pending.messages,
          tools: modelToolDefinitions,
          toolResults
        });
        const retryResult =
          (modelResult.toolCalls ?? []).length === 0 &&
          (modelResult.text === undefined || modelResult.text.trim().length === 0)
            ? await this.modelProvider.generateText({
                model: this.model,
                messages: pending.messages,
                toolResults
              })
            : modelResult;

        const toolCalls = retryResult.toolCalls ?? [];
        if (toolCalls.length === 0) {
          messageText = retryResult.text;
          if (messageText === undefined || messageText.trim().length === 0) {
            throw new Error("Model returned an empty response.");
          }
          summary = "Model response completed.";
          break;
        }

        if (toolCalls.length > 1) {
          throw new Error(`Model returned ${toolCalls.length} tool calls; expected at most 1`);
        }

        if (round === 3) {
          throw new Error("Model exceeded maximum tool call rounds.");
        }

        const toolCall = toolCalls[0];
        const approvalId = toolCall.name === "apply_patch" ? randomUUID() : undefined;
        const toolExecution = await this.executeModelToolCall(
          pending.runId,
          command.workspaceRoot,
          toolCall,
          approvalId,
          undefined,
          async (pendingApprovalId, input) => {
            await this.rememberPendingModelApproval(store, {
              approvalId: pendingApprovalId,
              runId: pending.runId,
              threadId: pending.threadId,
              workspaceRoot: command.workspaceRoot,
              call: toolCall,
              input,
              toolResults: [...toolResults],
              messages: pending.messages,
              nextRound: round + 1
            });
          }
        );

        if (toolExecution.status === "approval_required") {
          this.events.publish({
            type: "run.paused",
            runId: pending.runId,
            reason: "approval_required",
            approvalId: toolExecution.approvalId
          });
          await persist.flush();

          return {
            runId: pending.runId,
            threadId: pending.threadId,
            status: "approval_required",
            approvalId: toolExecution.approvalId
          };
        }

        toolResults.push(toolExecution.result);
      }

      if (messageText === undefined || summary === undefined) {
        throw new Error("Model did not produce a final response.");
      }

      this.events.publish({ type: "node.completed", runId: pending.runId, node: "context_builder" });
      this.events.publish({
        type: "message.delta",
        runId: pending.runId,
        text: messageText
      });
      this.events.publish({
        type: "run.completed",
        runId: pending.runId,
        summary
      });
      await store?.recordRunCompleted({
        runId: pending.runId,
        status: "completed",
        completedAt: new Date().toISOString(),
        summary
      });
      await persist.flush();

      return { runId: pending.runId, threadId: pending.threadId, status: "completed" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.events.publish({
        type: "run.failed",
        runId: pending.runId,
        error: {
          category: "runtime_failed",
          message: "Session approval continuation failed.",
          detail
        }
      });
      await store?.recordRunCompleted({
        runId: pending.runId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: detail
      });
      await persist.flush();
      throw error;
    } finally {
      this.pendingModelApprovals.delete(command.approvalId);
      await store?.deletePendingApproval(command.approvalId);
      persist.unsubscribe();
    }
  }

  /** 同时写入内存和持久化存储，确保审批可以在当前进程或新进程继续。 */
  private async rememberPendingModelApproval(
    store: SessionStore | undefined,
    pending: PendingModelApproval
  ): Promise<void> {
    this.pendingModelApprovals.set(pending.approvalId, pending);
    await store?.recordPendingApproval(toPendingApprovalRecord(pending));
  }

  /** 优先从内存读取审批状态，不存在时再从持久化存储恢复。 */
  private async loadPendingModelApproval(
    store: SessionStore | undefined,
    approvalId: string
  ): Promise<PendingModelApproval | undefined> {
    const inMemory = this.pendingModelApprovals.get(approvalId);
    if (inMemory) return inMemory;

    const stored = await store?.getPendingApproval(approvalId);
    return stored === undefined ? undefined : pendingModelApprovalFromRecord(stored);
  }

  /** 列出当前工作区已持久化的会话摘要。 */
  async listSessions(command: WorkspaceSessionCommand): Promise<StoredSessionSummary[]> {
    const store = await this.getStore(command.workspaceRoot);
    return (await store?.listSessions()) ?? [];
  }

  /** 重放历史会话事件；如果传入新 prompt，则在同一 thread 上启动续跑。 */
  async resume(command: ResumeSessionCommand): Promise<StoredSessionSummary | RunResult> {
    const store = await this.getStore(command.workspaceRoot);
    if (!store) {
      throw new Error("Session storage is disabled.");
    }

    const sessions = await store.listSessions();
    const session = sessions.find((candidate) => candidate.threadId === command.threadId);
    if (!session) {
      throw new Error(`Unknown thread: ${command.threadId}`);
    }

    if (command.prompt !== undefined) {
      return this.run({
        kind: "run",
        workspaceRoot: command.workspaceRoot,
        threadId: command.threadId,
        prompt: command.prompt
      });
    }

    const runIds = session.runIds.length > 0 ? session.runIds : [session.runId];
    const events = (await Promise.all(runIds.map((runId) => store.listEvents(runId))))
      .flat()
      .sort((left, right) => left.sequence - right.sequence);

    for (const record of events) {
      this.events.publish(record.event);
    }

    return session;
  }

  /** 获取会话存储；未注入时使用工作区内默认 SQLite 本地存储。 */
  private async getStore(workspaceRoot: string): Promise<SessionStore | undefined> {
    if (this.configuredStore === false) return undefined;
    if (this.configuredStore) return this.configuredStore;
    return SqliteSessionStore.open(path.join(workspaceRoot, ".code-easy", "local"));
  }

  /** 捕获运行期间发布的事件，并提供批量 flush 和取消订阅能力。 */
  private captureStoredEvents(store: SessionStore | undefined): {
    flush: () => Promise<void>;
    unsubscribe: () => void;
  } {
    if (!store) {
      return {
        flush: async () => {},
        unsubscribe: () => {}
      };
    }

    const writes: Promise<void>[] = [];
    const unsubscribe = this.events.subscribe((event) => {
      writes.push(store.recordEvent(event));
    });

    return {
      flush: async () => {
        await Promise.all(writes);
      },
      unsubscribe
    };
  }
}
