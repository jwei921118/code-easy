# Model Apply Patch Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the model request `apply_patch` edits while preventing writes until the user approves the requested tool call.

**Architecture:** `apply_patch` becomes a model-callable tool, but it keeps `write` risk and still goes through `PermissionedToolExecutor`. `SessionManager.run()` pauses on model-requested write approval, records enough in-memory state to continue, and exposes a runtime-level `approve()` method for tests and later CLI wiring. M1.4 will turn this in-memory approval path into durable CLI/protocol flow with persisted pending approvals.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Zod, existing Code Easy runtime/tool/ui-protocol packages.

---

## Scope Boundary

This task implements runtime capability only:

- The model can request `apply_patch`.
- The runtime emits `diff.ready` and `approval.requested`.
- The file is not modified before approval.
- A runtime caller can approve or deny the pending model tool call through `SessionManager.approve()`.
- Approval or denial feeds a model-visible tool result back into the model loop.

This task does not implement:

- CLI approval prompts for model-requested tool calls.
- Durable pending approval records.
- Resuming approval after process restart.
- `run_command` as a model-callable tool.

Those remain M1.4.

## File Structure

- Modify `packages/runtime/src/modelToolSchemas.ts`
  - Add `apply_patch` to the model-callable allowlist and tool schema.
- Modify `packages/runtime/src/modelToolSchemas.test.ts`
  - Cover `apply_patch` schema and verify `run_command` remains unavailable.
- Modify `packages/tools/src/applyPatchTool.ts`
  - Add a small exported `formatApplyPatchDiff()` helper.
  - Include the diff string in successful `apply_patch` output.
- Modify `packages/tools/src/applyPatchTool.test.ts`
  - Cover diff formatting and successful output diff.
- Modify `packages/runtime/src/toolExecutor.ts`
  - Let callers pass an existing approval id so `approval.resolved` matches `approval.requested`.
- Modify `packages/runtime/src/sessionManager.ts`
  - Add pending model approval state.
  - Pause model runs on approval-required write calls.
  - Add `approve()` to continue or deny pending model tool calls.
  - Emit `diff.ready` for `apply_patch` requests before approval.
- Modify `packages/runtime/src/sessionManager.test.ts`
  - Add tests for pause, approval, denial, no pre-approval writes, and `run_command` still blocked.
- Modify `packages/ui-protocol/src/events.ts`
  - Add `run.paused` event.
- Modify `packages/ui-protocol/src/events.test.ts`
  - Validate `run.paused`.
- Modify `docs/PROGRESS.md`
  - Record plan completion and next execution step.
- Modify `AGENT.md`
  - Point future workers at this M1.3 plan.

---

### Task 1: Add `run.paused` Event To UI Protocol

**Files:**

- Modify: `packages/ui-protocol/src/events.ts`
- Modify: `packages/ui-protocol/src/events.test.ts`

- [ ] **Step 1: Add a failing event schema test**

Append this test in `packages/ui-protocol/src/events.test.ts`:

```ts
  it("validates a run paused event for pending approval", () => {
    const event = AgentEventSchema.parse({
      type: "run.paused",
      runId: "run-1",
      reason: "approval_required",
      approvalId: "approval-1"
    });

    expect(event).toEqual({
      type: "run.paused",
      runId: "run-1",
      reason: "approval_required",
      approvalId: "approval-1"
    });
  });
```

- [ ] **Step 2: Run the focused UI protocol test and verify failure**

Run:

```bash
pnpm --filter @code-easy/ui-protocol test -- events.test.ts
```

Expected: FAIL because `run.paused` is not part of `AgentEventSchema`.

- [ ] **Step 3: Add `run.paused` to the event schema**

In `packages/ui-protocol/src/events.ts`, add this member to `AgentEventSchema` before `run.completed`:

```ts
  z.strictObject({
    type: z.literal("run.paused"),
    runId: IdSchema,
    reason: z.literal("approval_required"),
    approvalId: IdSchema
  }),
```

- [ ] **Step 4: Run the focused UI protocol test**

Run:

```bash
pnpm --filter @code-easy/ui-protocol test -- events.test.ts
```

Expected: PASS.

---

### Task 2: Add `apply_patch` To Model-Callable Tools

**Files:**

- Modify: `packages/runtime/src/modelToolSchemas.ts`
- Modify: `packages/runtime/src/modelToolSchemas.test.ts`

- [ ] **Step 1: Add failing schema tests**

Append these tests in `packages/runtime/src/modelToolSchemas.test.ts`:

```ts
  it("exposes apply_patch as a model-callable write tool", () => {
    expect(getModelCallableTool("apply_patch")).toMatchObject({
      name: "apply_patch",
      description: expect.stringContaining("exact text replacement")
    });
    expect(modelCallableToolNames).toContain("apply_patch");
  });

  it("keeps run_command unavailable to model-directed calls", () => {
    expect(getModelCallableTool("run_command")).toBeUndefined();
    expect(modelCallableToolNames).not.toContain("run_command");
  });
```

- [ ] **Step 2: Run the focused runtime test and verify failure**

Run:

```bash
pnpm --filter @code-easy/runtime test -- modelToolSchemas.test.ts
```

Expected: FAIL because `apply_patch` is not model-callable yet.

- [ ] **Step 3: Add the `apply_patch` schema**

In `packages/runtime/src/modelToolSchemas.ts`, change the allowlist:

```ts
export const modelCallableToolNames = ["git_status", "list_files", "rg_search", "read_file", "apply_patch"] as const;
```

Add this entry to `modelToolDefinitions` after `read_file`:

```ts
  {
    name: "apply_patch",
    description: "Request approval to apply an exact text replacement to an existing workspace file.",
    parameters: objectSchema(
      {
        path: { type: "string", description: "Workspace-relative file path." },
        oldText: { type: "string", description: "Exact text currently in the file." },
        newText: { type: "string", description: "Replacement text." },
        expectedReplacements: {
          type: "number",
          description: "Expected number of replacements. Use 1 unless intentionally replacing repeated text."
        }
      },
      ["path", "oldText", "newText", "expectedReplacements"]
    )
  }
```

- [ ] **Step 4: Run the focused runtime test**

Run:

```bash
pnpm --filter @code-easy/runtime test -- modelToolSchemas.test.ts
```

Expected: PASS.

---

### Task 3: Add Diff Preview Support To `apply_patch`

**Files:**

- Modify: `packages/tools/src/applyPatchTool.ts`
- Modify: `packages/tools/src/applyPatchTool.test.ts`

- [ ] **Step 1: Add failing tool tests**

Append these tests in `packages/tools/src/applyPatchTool.test.ts`:

```ts
  it("formats a simple apply patch diff preview", () => {
    expect(
      formatApplyPatchDiff({
        path: "hello.txt",
        oldText: "old",
        newText: "new"
      })
    ).toBe("--- a/hello.txt\n+++ b/hello.txt\n@@\n-old\n+new\n");
  });

  it("includes a diff in successful patch output", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello old world", "utf8");

    const result = await applyPatchTool.run(
      { path: "hello.txt", oldText: "old", newText: "new", expectedReplacements: 1 },
      { workspaceRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        path: "hello.txt",
        replacements: 1,
        diff: "--- a/hello.txt\n+++ b/hello.txt\n@@\n-old\n+new\n"
      }
    });
  });
```

Update the import at the top of the same file:

```ts
import { applyPatchTool, formatApplyPatchDiff } from "./index.js";
```

- [ ] **Step 2: Run the focused tools test and verify failure**

Run:

```bash
pnpm --filter @code-easy/tools test -- applyPatchTool.test.ts
```

Expected: FAIL because `formatApplyPatchDiff()` does not exist and output has no `diff`.

- [ ] **Step 3: Implement diff formatting**

In `packages/tools/src/applyPatchTool.ts`, add this exported type near `ApplyPatchOutput`:

```ts
export type ApplyPatchDiffInput = {
  path: string;
  oldText: string;
  newText: string;
};
```

Change `ApplyPatchOutput`:

```ts
type ApplyPatchOutput = {
  path: string;
  replacements: number;
  diff: string;
};
```

Add this helper after `replaceExactText()`:

```ts
export function formatApplyPatchDiff(input: ApplyPatchDiffInput): string {
  return [`--- a/${input.path}`, `+++ b/${input.path}`, "@@", `-${input.oldText}`, `+${input.newText}`, ""].join("\n");
}
```

Add `diff` to the successful output:

```ts
      return {
        ok: true,
        output: {
          path: input.path,
          replacements: patched.replacements,
          diff: formatApplyPatchDiff(input)
        }
      };
```

- [ ] **Step 4: Run the focused tools test**

Run:

```bash
pnpm --filter @code-easy/tools test -- applyPatchTool.test.ts
```

Expected: PASS.

---

### Task 4: Preserve Approval Ids In `PermissionedToolExecutor`

**Files:**

- Modify: `packages/runtime/src/toolExecutor.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`

- [ ] **Step 1: Add a failing runtime test for approval id reuse**

Append this test in `packages/runtime/src/sessionManager.test.ts`:

```ts
  it("uses a supplied approval id when resolving an approved tool execution", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-approved-id-"));
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello old world", "utf8");
    const manager = new SessionManager();
    const events: AgentEvent[] = [];

    manager.subscribe((event) => {
      events.push(event);
    });

    await manager.runTool({
      workspaceRoot,
      toolName: "apply_patch",
      input: {
        path: "hello.txt",
        oldText: "old",
        newText: "new"
      },
      approved: true,
      approvalId: "approval-known"
    });

    expect(events.find((event) => event.type === "approval.resolved")).toMatchObject({
      type: "approval.resolved",
      decision: {
        approvalId: "approval-known",
        approved: true
      }
    });
  });
```

Update `RunToolCommand` in `packages/runtime/src/sessionManager.ts` to include `approvalId?: string` during this test step so TypeScript can compile the test:

```ts
export type RunToolCommand = {
  threadId?: string;
  workspaceRoot: string;
  toolName: string;
  input: unknown;
  approved?: boolean;
  approvalId?: string;
};
```

Pass `approvalId: command.approvalId` into `executor.execute()` in `runTool()`.

- [ ] **Step 2: Run the focused runtime test and verify failure**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: FAIL because `PermissionedToolExecutor` ignores supplied approval ids.

- [ ] **Step 3: Add `approvalId` to the executor request**

In `packages/runtime/src/toolExecutor.ts`, extend `ToolExecutionRequest`:

```ts
  approvalId?: string;
```

Replace:

```ts
    const approvalId = randomUUID();
```

with:

```ts
    const approvalId = request.approvalId ?? randomUUID();
```

- [ ] **Step 4: Run the focused runtime test**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: PASS.

---

### Task 5: Pause Model Runs On `apply_patch` Approval

**Files:**

- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`

- [ ] **Step 1: Add a failing test for model-requested apply patch pause**

Append this test in `packages/runtime/src/sessionManager.test.ts`:

```ts
  it("pauses when the model requests apply_patch and does not modify the file before approval", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-model-patch-pause-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello old world", "utf8");
    const manager = new SessionManager({
      modelProvider: {
        name: "fake",
        async generateText() {
          return {
            toolCalls: [
              {
                callId: "call-apply",
                name: "apply_patch",
                argumentsText:
                  "{\"path\":\"hello.txt\",\"oldText\":\"old\",\"newText\":\"new\",\"expectedReplacements\":1}"
              }
            ]
          };
        }
      }
    });
    const events: AgentEvent[] = [];

    manager.subscribe((event) => {
      events.push(event);
    });

    const result = await manager.run({
      kind: "run",
      workspaceRoot,
      prompt: "Patch hello"
    });

    expect(result).toMatchObject({
      status: "approval_required",
      threadId: expect.any(String),
      runId: expect.any(String),
      approvalId: expect.any(String)
    });
    expect(events.map((event) => event.type)).toContain("diff.ready");
    expect(events.map((event) => event.type)).toContain("approval.requested");
    expect(events.at(-1)).toMatchObject({
      type: "run.paused",
      reason: "approval_required",
      approvalId: result.approvalId
    });
    expect(events.some((event) => event.type === "tool.started" && event.call.name === "apply_patch")).toBe(false);
    await expect(readFile(path.join(workspaceRoot, "hello.txt"), "utf8")).resolves.toBe("hello old world");
  });
```

Add `readFile` to the existing `node:fs/promises` import in `packages/runtime/src/sessionManager.test.ts`.

- [ ] **Step 2: Run the focused runtime test and verify failure**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: FAIL because `apply_patch` either remains unavailable or the run fails instead of pausing.

- [ ] **Step 3: Add run result and pending approval types**

In `packages/runtime/src/sessionManager.ts`, change `RunResult`:

```ts
export type RunResult = {
  runId: string;
  threadId: string;
  status?: "completed" | "approval_required";
  approvalId?: string;
};
```

Add this internal type near `SessionManagerOptions`:

```ts
type PendingModelApproval = {
  approvalId: string;
  runId: string;
  threadId: string;
  workspaceRoot: string;
  call: ModelToolCall;
  input: unknown;
  toolResults: ModelToolResult[];
  nextRound: number;
};
```

Add this field to `SessionManager`:

```ts
  private readonly pendingModelApprovals = new Map<string, PendingModelApproval>();
```

- [ ] **Step 4: Add an approval-required return path**

In `executeModelToolCall()`, change the return type to:

```ts
  private async executeModelToolCall(
    runId: string,
    workspaceRoot: string,
    call: ModelToolCall,
    approvalId?: string,
    approved?: boolean,
  ): Promise<
    | { status: "completed"; result: ModelToolResult }
    | { status: "approval_required"; approvalId: string; input: unknown }
  > {
```

Inside the method:

```ts
    const input = this.parseToolArguments(call);
    if (call.name === "apply_patch" && isRecord(input)) {
      this.events.publish({
        type: "diff.ready",
        runId,
        diff: formatApplyPatchDiff({
          path: String(input.path),
          oldText: String(input.oldText),
          newText: String(input.newText)
        })
      });
    }
```

Pass `input`, `approvalId`, and `approved` into the executor:

```ts
      const outcome = await executor.execute({
        runId,
        workspaceRoot,
        tool,
        input,
        approvalId,
        approved
      });
```

Return pending instead of throwing:

```ts
      if (outcome.status === "approval_required") {
        return { status: "approval_required", approvalId: outcome.approvalId, input };
      }

      return {
        status: "completed",
        result: {
          callId: call.callId,
          output: JSON.stringify(completedResult)
        }
      };
```

Import `formatApplyPatchDiff`:

```ts
import { formatApplyPatchDiff } from "@code-easy/tools";
```

- [ ] **Step 5: Store pending state and publish `run.paused`**

In the model tool loop inside `run()`, replace the direct push:

```ts
          toolResults.push(await this.executeModelToolCall(runId, command.workspaceRoot, toolCalls[0]));
```

with:

```ts
          const toolExecution = await this.executeModelToolCall(runId, command.workspaceRoot, toolCalls[0]);
          if (toolExecution.status === "approval_required") {
            this.pendingModelApprovals.set(toolExecution.approvalId, {
              approvalId: toolExecution.approvalId,
              runId,
              threadId,
              workspaceRoot: command.workspaceRoot,
              call: toolCalls[0],
              input: toolExecution.input,
              toolResults,
              nextRound: round + 1
            });
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
```

Change the normal successful return at the end of `run()`:

```ts
      return { runId, threadId, status: "completed" };
```

- [ ] **Step 6: Run the focused runtime test**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: PASS for the new pause test.

---

### Task 6: Continue Approved Model `apply_patch` Calls

**Files:**

- Modify: `packages/runtime/src/sessionManager.ts`
- Modify: `packages/runtime/src/sessionManager.test.ts`

- [ ] **Step 1: Add a failing approval continuation test**

Append this test in `packages/runtime/src/sessionManager.test.ts`:

```ts
  it("continues the model loop after approving a model-requested apply_patch", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-model-patch-approve-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello old world", "utf8");
    const calls: unknown[] = [];
    const manager = new SessionManager({
      modelProvider: {
        name: "fake",
        async generateText(input) {
          calls.push(input);
          if (calls.length === 1) {
            return {
              toolCalls: [
                {
                  callId: "call-apply",
                  name: "apply_patch",
                  argumentsText:
                    "{\"path\":\"hello.txt\",\"oldText\":\"old\",\"newText\":\"new\",\"expectedReplacements\":1}"
                }
              ]
            };
          }

          return { text: "Patch applied" };
        }
      }
    });
    const events: AgentEvent[] = [];
    manager.subscribe((event) => {
      events.push(event);
    });

    const paused = await manager.run({
      kind: "run",
      workspaceRoot,
      prompt: "Patch hello"
    });
    const completed = await manager.approve({
      kind: "approve",
      decision: {
        approvalId: paused.approvalId ?? "",
        approved: true,
        rememberForSession: false
      }
    });

    expect(completed).toMatchObject({
      runId: paused.runId,
      threadId: paused.threadId,
      status: "completed"
    });
    expect(events.find((event) => event.type === "approval.resolved")).toMatchObject({
      type: "approval.resolved",
      decision: {
        approvalId: paused.approvalId,
        approved: true
      }
    });
    expect(events.flatMap((event) => (event.type === "tool.started" ? [event.call.name] : []))).toContain("apply_patch");
    expect(events.find((event) => event.type === "message.delta")).toMatchObject({
      type: "message.delta",
      text: "Patch applied"
    });
    await expect(readFile(path.join(workspaceRoot, "hello.txt"), "utf8")).resolves.toBe("hello new world");
    expect(JSON.stringify(calls[1])).toContain("apply_patch");
  });
```

- [ ] **Step 2: Run the focused runtime test and verify failure**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: FAIL because `SessionManager.approve()` does not exist.

- [ ] **Step 3: Add `approve()` and a continuation helper**

Import `ApproveCommand`:

```ts
import { RuntimeCommandSchema, type AgentEvent, type ApproveCommand, type RunCommand } from "@code-easy/ui-protocol";
```

Add this method to `SessionManager`:

```ts
  async approve(commandInput: ApproveCommand): Promise<RunResult> {
    const command = RuntimeCommandSchema.parse(commandInput);
    if (command.kind !== "approve") {
      throw new Error(`Unsupported command kind for approve(): ${command.kind}`);
    }

    const pending = this.pendingModelApprovals.get(command.decision.approvalId);
    if (!pending) {
      throw new Error(`Unknown approval: ${command.decision.approvalId}`);
    }
    this.pendingModelApprovals.delete(command.decision.approvalId);

    const store = await this.getStore(pending.workspaceRoot);
    const persist = this.captureStoredEvents(store);

    try {
      if (!command.decision.approved) {
        this.events.publish({
          type: "approval.resolved",
          runId: pending.runId,
          decision: command.decision
        });
        pending.toolResults.push({
          callId: pending.call.callId,
          output: JSON.stringify({
            ok: false,
            error: {
              category: "denied",
              message: `User denied ${pending.call.name}.`
            }
          })
        });
        return await this.continueModelLoop(pending, persist.flush);
      }

      const execution = await this.executeModelToolCall(
        pending.runId,
        pending.workspaceRoot,
        pending.call,
        pending.approvalId,
        true
      );
      if (execution.status !== "completed") {
        throw new Error(`Approved model-requested tool ${pending.call.name} did not complete.`);
      }
      pending.toolResults.push(execution.result);
      return await this.continueModelLoop(pending, persist.flush);
    } finally {
      persist.unsubscribe();
    }
  }
```

Add `continueModelLoop()` that continues from the saved state:

```ts
  private async continueModelLoop(pending: PendingModelApproval, flush: () => Promise<void>): Promise<RunResult> {
    if (!this.modelProvider) {
      throw new Error("Cannot continue model approval without a model provider.");
    }

    for (let round = pending.nextRound; round < 4; round += 1) {
      const modelResult = await this.modelProvider.generateText({
        model: this.model,
        messages: buildWorkspaceContextMessages({
          userPrompt: "",
          gitStatusSummary: "Continuation after approval.",
          fileSummary: "No refreshed file summary.",
          searchSummary: "No refreshed search summary."
        }),
        tools: modelToolDefinitions,
        toolResults: pending.toolResults
      });

      const toolCalls = modelResult.toolCalls ?? [];
      if (toolCalls.length === 0) {
        const messageText = modelResult.text ?? "";
        this.events.publish({ type: "message.delta", runId: pending.runId, text: messageText });
        this.events.publish({ type: "run.completed", runId: pending.runId, summary: "Model response completed." });
        await flush();
        return { runId: pending.runId, threadId: pending.threadId, status: "completed" };
      }

      if (toolCalls.length > 1) {
        throw new Error(`Model returned ${toolCalls.length} tool calls; expected at most 1`);
      }

      if (round === 3) {
        throw new Error("Model exceeded maximum tool call rounds.");
      }

      const execution = await this.executeModelToolCall(pending.runId, pending.workspaceRoot, toolCalls[0]);
      if (execution.status === "approval_required") {
        this.pendingModelApprovals.set(execution.approvalId, {
          ...pending,
          approvalId: execution.approvalId,
          call: toolCalls[0],
          input: execution.input,
          nextRound: round + 1
        });
        this.events.publish({
          type: "run.paused",
          runId: pending.runId,
          reason: "approval_required",
          approvalId: execution.approvalId
        });
        await flush();
        return {
          runId: pending.runId,
          threadId: pending.threadId,
          status: "approval_required",
          approvalId: execution.approvalId
        };
      }

      pending.toolResults.push(execution.result);
    }

    throw new Error("Model did not produce a final response.");
  }
```

During implementation, prefer reusing the original context messages in `PendingModelApproval` instead of rebuilding placeholder messages. If you store `messages` in `PendingModelApproval`, pass those exact messages into `generateText()`.

- [ ] **Step 4: Run the focused runtime test**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: PASS for the approval continuation test.

---

### Task 7: Continue Denied Model `apply_patch` Calls

**Files:**

- Modify: `packages/runtime/src/sessionManager.test.ts`
- Modify: `packages/runtime/src/sessionManager.ts`

- [ ] **Step 1: Add a failing denial continuation test**

Append this test in `packages/runtime/src/sessionManager.test.ts`:

```ts
  it("continues the model loop with a denied tool result when apply_patch is denied", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-model-patch-deny-"));
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "hello.txt"), "hello old world", "utf8");
    const calls: unknown[] = [];
    const manager = new SessionManager({
      modelProvider: {
        name: "fake",
        async generateText(input) {
          calls.push(input);
          if (calls.length === 1) {
            return {
              toolCalls: [
                {
                  callId: "call-apply",
                  name: "apply_patch",
                  argumentsText:
                    "{\"path\":\"hello.txt\",\"oldText\":\"old\",\"newText\":\"new\",\"expectedReplacements\":1}"
                }
              ]
            };
          }

          return { text: "Patch denied" };
        }
      }
    });
    const events: AgentEvent[] = [];
    manager.subscribe((event) => {
      events.push(event);
    });

    const paused = await manager.run({
      kind: "run",
      workspaceRoot,
      prompt: "Patch hello"
    });
    await manager.approve({
      kind: "approve",
      decision: {
        approvalId: paused.approvalId ?? "",
        approved: false,
        rememberForSession: false
      }
    });

    expect(events.find((event) => event.type === "approval.resolved")).toMatchObject({
      type: "approval.resolved",
      decision: {
        approvalId: paused.approvalId,
        approved: false
      }
    });
    expect(events.find((event) => event.type === "message.delta")).toMatchObject({
      type: "message.delta",
      text: "Patch denied"
    });
    expect(JSON.stringify(calls[1])).toContain("User denied apply_patch");
    await expect(readFile(path.join(workspaceRoot, "hello.txt"), "utf8")).resolves.toBe("hello old world");
  });
```

- [ ] **Step 2: Run the focused runtime test and verify failure if denial is incomplete**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: PASS if Task 6 already included denial behavior; otherwise FAIL until denial result handling is implemented.

- [ ] **Step 3: Implement denial behavior if needed**

If the denial test fails, update `approve()` so the denied branch publishes `approval.resolved`, pushes a denied `ModelToolResult`, continues the model loop, and never executes the tool.

- [ ] **Step 4: Run the focused runtime test**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts
```

Expected: PASS.

---

### Task 8: Keep Execute Tools Blocked And Direct Tool Approval Working

**Files:**

- Modify: `packages/runtime/src/sessionManager.test.ts`

- [ ] **Step 1: Add or update regression tests**

Ensure these assertions exist in `packages/runtime/src/sessionManager.test.ts`:

```ts
  it("still rejects model-requested run_command", async () => {
    const manager = new SessionManager({
      modelProvider: {
        name: "fake",
        async generateText() {
          return {
            toolCalls: [
              {
                callId: "call-1",
                name: "run_command",
                argumentsText: "{\"command\":\"node\"}"
              }
            ]
          };
        }
      }
    });

    await expect(
      manager.run({
        kind: "run",
        workspaceRoot: process.cwd(),
        prompt: "Run command"
      })
    ).rejects.toThrow("Model requested unavailable tool: run_command");
  });
```

The existing direct `runTool()` approval tests should remain unchanged except for optional `approvalId` support.

- [ ] **Step 2: Run focused runtime tests**

Run:

```bash
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts modelToolSchemas.test.ts
```

Expected: PASS.

---

### Task 9: Update Documentation And Progress

**Files:**

- Modify: `docs/PROGRESS.md`
- Modify: `AGENT.md`
- Modify: `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md`

- [ ] **Step 1: Mark M1.3 complete in the roadmap after implementation**

In `docs/superpowers/plans/2026-06-12-code-easy-capability-roadmap.md`, mark M1.3 work and acceptance checkboxes complete.

- [ ] **Step 2: Add a progress log entry**

Add this entry near the top of `docs/PROGRESS.md` after implementation:

```markdown
### 2026-06-16 - Add model-requested apply patch approval gate

Completed:

- Added `apply_patch` to the model-callable tool allowlist.
- Emitted `diff.ready` and `approval.requested` for model-requested patches.
- Paused model runs before executing write tools.
- Added in-memory runtime approval continuation through `SessionManager.approve()`.
- Added approved and denied continuation tests.

Verification:

- `pnpm --filter @code-easy/runtime test -- sessionManager.test.ts modelToolSchemas.test.ts` passed.
- `pnpm --filter @code-easy/tools test -- applyPatchTool.test.ts` passed.
- `pnpm --filter @code-easy/ui-protocol test -- events.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `git diff --check` passed.
- `rg "sk-[A-Za-z0-9]{10,}" .` found no committed secrets.

Next:

- Start M1.4: implement durable approval continue flow through runtime commands, CLI prompts, and storage.
```

- [ ] **Step 3: Update `AGENT.md` next task**

After implementation, change the next task to:

```markdown
Start with `M1.4: Implement Approval Continue Flow` from the roadmap.
```

---

### Task 10: Run Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @code-easy/ui-protocol test -- events.test.ts
pnpm --filter @code-easy/tools test -- applyPatchTool.test.ts
pnpm --filter @code-easy/runtime test -- sessionManager.test.ts modelToolSchemas.test.ts
```

Expected: PASS for all commands.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Check secrets**

Run:

```bash
rg "sk-[A-Za-z0-9]{10,}" .
```

Expected: no output and exit code `1`.

---

## Self-Review

- Spec coverage: The plan covers adding `apply_patch` to model-callable tools, preserving approval before writes, emitting a diff event, preserving pending state, approved continuation, denied continuation, and keeping `run_command` unavailable.
- Scope boundary: Durable approval storage, CLI prompt integration, and replayable approval continuation remain in M1.4.
- Placeholder scan: No deferred filler instructions are used. Each implementation task includes concrete files, snippets, commands, and expected outcomes.
- Type consistency: The plan consistently uses `approvalId`, `run.paused`, `SessionManager.approve()`, `PendingModelApproval`, and `formatApplyPatchDiff()`.
