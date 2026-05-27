#!/usr/bin/env node
import { program } from "commander";
import { SessionManager } from "@code-easy/runtime";

function renderEvent(event: { type: string; [key: string]: unknown }): void {
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

program.action(() => {
  program.help();
});

const argv = process.argv[2] === "--" ? [...process.argv.slice(0, 2), ...process.argv.slice(3)] : process.argv;

await program.parseAsync(argv);
