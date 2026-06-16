#!/usr/bin/env node
import { createInterface, type Interface } from 'node:readline/promises';
import { program } from 'commander';
import {
  createModelProviderFromConfig,
  loadModelConfig,
  loadProjectModelSettings,
  SessionManager,
} from '@code-easy/runtime';
import type { AgentEvent } from '@code-easy/ui-protocol';
import { continueAfterApprovalPrompt } from './approvalFlow.js';

type ModelOptions = {
  model?: string | false;
};

type WorkspaceModelOptions = {
  workspace: string;
} & ModelOptions;

type ToolCommandOptions = {
  workspace: string;
  yes?: boolean;
};

type ApprovalCommandOptions = WorkspaceModelOptions & {
  yes?: boolean;
  no?: boolean;
};

const MAX_TOOL_OUTPUT_CHARS = 12_000;

/** 将工具输出格式化为适合终端展示的 JSON，并限制超大输出长度。 */
function renderJsonOutput(output: unknown): string {
  const text = JSON.stringify(output, null, 2);
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;

  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[output truncated: ${text.length - MAX_TOOL_OUTPUT_CHARS} characters omitted]`;
}

/** 按“命令局部参数优先，全局参数兜底”的规则读取 commander 选项。 */
function commandOption<T>(
  localOptions: Record<string, unknown>,
  globalOptions: Record<string, unknown>,
  name: string,
  fallback: T,
): T {
  return (
    (localOptions[name] as T | undefined) ??
    (globalOptions[name] as T | undefined) ??
    fallback
  );
}

/** 解析需要工作区和模型配置的命令选项。 */
function resolveWorkspaceModelOptions(
  localOptions: Record<string, unknown>,
): WorkspaceModelOptions {
  const globalOptions = program.opts<Record<string, unknown>>();

  return {
    workspace: commandOption(
      localOptions,
      globalOptions,
      'workspace',
      process.cwd(),
    ),
    model: commandOption<string | false | undefined>(
      localOptions,
      globalOptions,
      'model',
      undefined,
    ),
  };
}

/** 解析直接执行工具命令所需的工作区和审批选项。 */
function resolveToolOptions(
  localOptions: Record<string, unknown>,
): ToolCommandOptions {
  const globalOptions = program.opts<Record<string, unknown>>();

  return {
    workspace: commandOption(
      localOptions,
      globalOptions,
      'workspace',
      process.cwd(),
    ),
    yes: commandOption<boolean | undefined>(
      localOptions,
      globalOptions,
      'yes',
      undefined,
    ),
  };
}

/** 解析审批继续命令的工作区、模型和批准/拒绝选项。 */
function resolveApprovalOptions(
  localOptions: Record<string, unknown>,
): ApprovalCommandOptions {
  const workspaceOptions = resolveWorkspaceModelOptions(localOptions);

  return {
    ...workspaceOptions,
    yes: commandOption<boolean | undefined>(
      localOptions,
      program.opts<Record<string, unknown>>(),
      'yes',
      undefined,
    ),
    no: commandOption<boolean | undefined>(
      localOptions,
      program.opts<Record<string, unknown>>(),
      'no',
      undefined,
    ),
  };
}

/** 将 CLI 的字符串参数解析为工具输入对象，并把 JSON 错误转成用户可读异常。 */
function parseJsonInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(
      `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 在终端中询问一次审批决定，供写入或执行类工具继续运行。 */
async function promptForApproval(
  toolName: string,
  existingReadline?: Interface,
): Promise<boolean> {
  const readline =
    existingReadline ??
    createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  try {
    const answer = await readline.question(`Approve ${toolName}? [y/N] `);
    return (
      answer.trim().toLowerCase() === 'y' ||
      answer.trim().toLowerCase() === 'yes'
    );
  } finally {
    if (existingReadline === undefined) {
      readline.close();
    }
  }
}

/** 从项目配置和环境变量创建带模型提供方的运行时会话管理器。 */
async function createSessionManager(
  options: WorkspaceModelOptions,
): Promise<SessionManager> {
  const settings = await loadProjectModelSettings(options.workspace);
  const config = loadModelConfig({
    settings,
    modelOverride:
      typeof options.model === 'string' ? options.model : undefined,
    disabled: options.model === false,
  });

  return new SessionManager({
    modelProvider: createModelProviderFromConfig(config),
    model: config.enabled ? config.model : undefined,
  });
}

/** 启动持续对话模式，并在同一 thread 中串联后续用户输入。 */
async function startChat(options: WorkspaceModelOptions): Promise<void> {
  const manager = await createSessionManager(options);
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let threadId: string | undefined;

  manager.subscribe(renderEvent);
  readline.setPrompt('code-easy> ');
  readline.prompt();

  try {
    for await (const prompt of readline) {
      const trimmed = prompt.trim();

      if (trimmed === '') {
        readline.prompt();
        continue;
      }
      if (trimmed === ':q' || trimmed === 'exit' || trimmed === 'quit') break;

      try {
        let result;
        if (threadId === undefined) {
          result = await manager.run({
            kind: 'run',
            workspaceRoot: options.workspace,
            prompt,
          });
        } else {
          result = await manager.run({
            kind: 'run',
            workspaceRoot: options.workspace,
            threadId,
            prompt,
          });
        }
        result = await continueAfterApprovalPrompt({
          manager,
          workspaceRoot: options.workspace,
          result,
          shouldPrompt: process.stdin.isTTY === true,
          prompt: (approvalId) =>
            promptForApproval(`approval ${approvalId}`, readline),
        });

        if ('threadId' in result) {
          threadId = result.threadId;
        }
      } catch (error) {
        console.error(
          `Command failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      readline.prompt();
    }
  } finally {
    readline.close();
  }
}

/** 把运行时事件转换为当前 CLI 的文本输出。 */
function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'run.started':
      console.log(`Run started: ${event.runId}`);
      break;
    case 'node.started':
      console.log(`Node started: ${event.node}`);
      break;
    case 'node.completed':
      console.log(`Node completed: ${event.node}`);
      break;
    case 'message.delta':
      process.stdout.write(String(event.text));
      process.stdout.write('\n');
      break;
    case 'tool.started':
      console.log(`Tool started: ${event.call.name}`);
      break;
    case 'tool.completed':
      console.log(`Tool completed: ${event.result.name}`);
      if (event.result.ok && event.result.output !== undefined) {
        console.log(renderJsonOutput(event.result.output));
      }
      if (!event.result.ok) {
        console.error(`Tool error: ${JSON.stringify(event.result.error)}`);
      }
      break;
    case 'diff.ready':
      console.log('Diff ready:');
      console.log(event.diff);
      break;
    case 'approval.requested':
      console.log(
        `Approval required: ${event.request.toolName} (${event.request.risk})`,
      );
      console.log(`Approval id: ${event.request.approvalId}`);
      console.log(event.request.reason);
      break;
    case 'approval.resolved':
      console.log(
        `Approval resolved: ${event.decision.approved ? 'approved' : 'denied'}`,
      );
      break;
    case 'run.paused':
      console.log(`Run paused: approval required (${event.approvalId})`);
      console.log(`Continue with: code-easy approve ${event.approvalId} --yes`);
      console.log(`Deny with: code-easy approve ${event.approvalId} --no`);
      break;
    case 'run.completed':
      console.log(`Run completed: ${event.summary}`);
      break;
    case 'run.failed':
      console.error(`Run failed: ${JSON.stringify(event.error)}`);
      break;
    default:
      console.log(JSON.stringify(event));
  }
}

/** 渲染本地持久化的会话摘要列表。 */
function renderSessions(
  sessions: Awaited<ReturnType<SessionManager['listSessions']>>,
): void {
  console.log('Stored sessions:');

  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  for (const session of sessions) {
    const summary = session.summary ?? session.error ?? '';
    console.log(
      `- ${session.threadId} ${session.status} runs=${session.runCount} updated=${session.lastUpdatedAt} "${session.prompt}" ${summary}`.trim(),
    );
  }
}

program
  .name('code-easy')
  .description('Local TypeScript coding agent')
  .version('0.0.0')
  .option('-w, --workspace <path>', 'Workspace root', process.cwd())
  .option('--model <model>', 'Model name for configured provider')
  .option('--no-model', 'Disable model provider for this run');

program
  .command('run')
  .argument('<prompt>', 'Task to run')
  .option('-w, --workspace <path>', 'Workspace root')
  .option('--model <model>', 'Model name for configured provider')
  .option('--no-model', 'Disable model provider for this run')
  .action(async (prompt: string, localOptions: Record<string, unknown>) => {
    const options = resolveWorkspaceModelOptions(localOptions);
    const manager = await createSessionManager(options);
    manager.subscribe(renderEvent);

    const result = await manager.run({
      kind: 'run',
      workspaceRoot: options.workspace,
      prompt,
    });
    await continueAfterApprovalPrompt({
      manager,
      workspaceRoot: options.workspace,
      result,
      shouldPrompt: process.stdin.isTTY === true,
      prompt: (approvalId) => promptForApproval(`approval ${approvalId}`),
    });
  });

program
  .command('sessions')
  .option('-w, --workspace <path>', 'Workspace root')
  .action(async (localOptions: Record<string, unknown>) => {
    const options = resolveWorkspaceModelOptions(localOptions);
    const manager = new SessionManager();
    const sessions = await manager.listSessions({
      workspaceRoot: options.workspace,
    });

    renderSessions(sessions);
  });

program
  .command('resume')
  .argument('<threadId>', 'Thread id to replay or continue')
  .argument('[prompt]', 'Optional task to continue on this thread')
  .option('-w, --workspace <path>', 'Workspace root')
  .option('--model <model>', 'Model name for configured provider')
  .option('--no-model', 'Disable model provider for this run')
  .action(
    async (
      threadId: string,
      prompt: string | undefined,
      localOptions: Record<string, unknown>,
    ) => {
      const options = resolveWorkspaceModelOptions(localOptions);
      const manager = await createSessionManager(options);

      console.log(
        `${prompt === undefined ? 'Replaying' : 'Continuing'} session: ${threadId}`,
      );
      manager.subscribe(renderEvent);
      await manager.resume({
        workspaceRoot: options.workspace,
        threadId,
        prompt,
      });
    },
  );

program
  .command('tool')
  .argument('<name>', 'Tool name to run')
  .argument('[input]', 'Tool input as JSON', '{}')
  .option('-w, --workspace <path>', 'Workspace root')
  .option('-y, --yes', 'Approve risky tool execution')
  .action(
    async (
      name: string,
      input: string,
      localOptions: Record<string, unknown>,
    ) => {
      const options = resolveToolOptions(localOptions);
      const manager = new SessionManager();
      manager.subscribe(renderEvent);
      const parsedInput = parseJsonInput(input);

      const result = await manager.runTool({
        workspaceRoot: options.workspace,
        toolName: name,
        input: parsedInput,
        approved: options.yes === true,
      });

      if (
        result.outcome.status === 'approval_required' &&
        options.yes !== true
      ) {
        const approved = await promptForApproval(name);

        if (!approved) {
          console.log('Approval denied.');
          process.exitCode = 1;
          return;
        }

        await manager.runTool({
          workspaceRoot: options.workspace,
          toolName: name,
          input: parsedInput,
          approved: true,
        });
      }
    },
  );

program
  .command('approve')
  .argument('<approvalId>', 'Approval id to resolve')
  .option('-w, --workspace <path>', 'Workspace root')
  .option('--model <model>', 'Model name for configured provider')
  .option('--no-model', 'Disable model provider for this run')
  .option('-y, --yes', 'Approve the pending action')
  .option('-n, --no', 'Deny the pending action')
  .action(
    async (approvalId: string, localOptions: Record<string, unknown>) => {
      const options = resolveApprovalOptions(localOptions);

      if (options.yes === true && options.no === true) {
        throw new Error('Cannot pass both --yes and --no');
      }

      const approved =
        options.yes === true
          ? true
          : options.no === true
            ? false
            : await promptForApproval(`approval ${approvalId}`);
      const manager = await createSessionManager(options);
      manager.subscribe(renderEvent);

      await manager.approve({
        workspaceRoot: options.workspace,
        approvalId,
        approved,
      });
    },
  );

program.action(async () => {
  const options = program.opts<WorkspaceModelOptions>();
  await startChat(options);
});

const argv =
  process.argv[2] === '--'
    ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
    : process.argv;

await program.parseAsync(argv);
