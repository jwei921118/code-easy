#!/usr/bin/env node
import { program } from "commander";
import { SessionManager } from "@code-easy/runtime";
import type { AgentEvent } from "@code-easy/ui-protocol";

function parseJsonInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case "run.started":
      console.log(`Run started: ${event.runId}`);
      break;
    case "node.started":
      console.log(`Node started: ${event.node}`);
      break;
    case "node.completed":
      console.log(`Node completed: ${event.node}`);
      break;
    case "message.delta":
      process.stdout.write(String(event.text));
      process.stdout.write("\n");
      break;
    case "tool.started":
      console.log(`Tool started: ${event.call.name}`);
      break;
    case "tool.completed":
      console.log(`Tool completed: ${event.result.name}`);
      if (event.result.ok && event.result.output !== undefined) {
        console.log(JSON.stringify(event.result.output, null, 2));
      }
      if (!event.result.ok) {
        console.error(`Tool error: ${JSON.stringify(event.result.error)}`);
      }
      break;
    case "approval.requested":
      console.log(`Approval required: ${event.request.toolName} (${event.request.risk})`);
      console.log(event.request.reason);
      break;
    case "approval.resolved":
      console.log(`Approval resolved: ${event.decision.approved ? "approved" : "denied"}`);
      break;
    case "run.completed":
      console.log(`Run completed: ${event.summary}`);
      break;
    case "run.failed":
      console.error(`Run failed: ${JSON.stringify(event.error)}`);
      break;
    default:
      console.log(JSON.stringify(event));
  }
}

program.name("code-easy").description("Local TypeScript coding agent").version("0.0.0");

program
  .command("run")
  .argument("<prompt>", "Task to run")
  .option("-w, --workspace <path>", "Workspace root", process.cwd())
  .action(async (prompt: string, options: { workspace: string }) => {
    const manager = new SessionManager();
    manager.subscribe(renderEvent);

    await manager.run({
      kind: "run",
      workspaceRoot: options.workspace,
      prompt
    });
  });

program
  .command("tool")
  .argument("<name>", "Tool name to run")
  .argument("[input]", "Tool input as JSON", "{}")
  .option("-w, --workspace <path>", "Workspace root", process.cwd())
  .option("-y, --yes", "Approve risky tool execution")
  .action(async (name: string, input: string, options: { workspace: string; yes?: boolean }) => {
    const manager = new SessionManager();
    manager.subscribe(renderEvent);

    await manager.runTool({
      workspaceRoot: options.workspace,
      toolName: name,
      input: parseJsonInput(input),
      approved: options.yes === true
    });
  });

program.action(() => {
  program.help();
});

const argv = process.argv[2] === "--" ? [...process.argv.slice(0, 2), ...process.argv.slice(3)] : process.argv;

await program.parseAsync(argv);
