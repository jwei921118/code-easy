# Clean CLI And Config Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean the current CLI and model config surface so the next coding-agent capabilities start from a stable, non-leaky baseline.

**Architecture:** Keep this task limited to CLI rendering and config validation. The runtime behavior, provider request implementations, tool registry, and storage schema should not change except for model config validation helpers.

**Tech Stack:** TypeScript, commander, Node readline, Vitest, existing runtime model config helpers.

---

## File Structure

- Modify: `apps/cli/src/index.ts` - remove debug output and add bounded tool output rendering.
- Modify: `apps/cli/src/index.test.ts` - add regression tests for no debug output and large output truncation.
- Modify: `packages/runtime/src/modelConfig.ts` - validate configured model ids and improve secret-safe error messages.
- Modify: `packages/runtime/src/modelConfig.test.ts` - add model id validation tests and update uppercase fixture values.
- Modify: `.code-easy/config.example.json` - use lower-case sample model ids.
- Modify: `docs/PROGRESS.md` - record M1.1 completion after verification.

## Task 1: Remove Interactive Debug Output

- [x] **Step 1: Write failing CLI regression test**

Add an assertion to `apps/cli/src/index.test.ts` in `starts an interactive chat when no subcommand is provided`:

```ts
expect(result.stdout).not.toContain("threadId ====>");
```

- [x] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @code-easy/cli test -- index.test.ts
```

Expected: FAIL because `apps/cli/src/index.ts` still prints `threadId ====>`.

- [x] **Step 3: Remove debug log**

Remove this line from `startChat()`:

```ts
console.log('threadId ====>', threadId);
```

- [x] **Step 4: Re-run CLI test**

Run:

```bash
pnpm --filter @code-easy/cli test -- index.test.ts
```

Expected: PASS.

## Task 2: Bound Large Tool Output Rendering

- [x] **Step 1: Write failing CLI truncation test**

Add a CLI test that runs `read_file` against a file larger than the render limit and expects:

```ts
expect(stdout).toContain("[output truncated:");
expect(stdout.length).toBeLessThan(20_000);
```

- [x] **Step 2: Run failing CLI test**

Run:

```bash
pnpm --filter @code-easy/cli test -- index.test.ts
```

Expected: FAIL because `renderEvent()` prints full JSON output.

- [x] **Step 3: Add bounded renderer**

In `apps/cli/src/index.ts`, add:

```ts
const MAX_TOOL_OUTPUT_CHARS = 12_000;

function renderJsonOutput(output: unknown): string {
  const text = JSON.stringify(output, null, 2);
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;

  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[output truncated: ${text.length - MAX_TOOL_OUTPUT_CHARS} characters omitted]`;
}
```

Then replace:

```ts
console.log(JSON.stringify(event.result.output, null, 2));
```

with:

```ts
console.log(renderJsonOutput(event.result.output));
```

- [x] **Step 4: Re-run CLI test**

Run:

```bash
pnpm --filter @code-easy/cli test -- index.test.ts
```

Expected: PASS, existing small tool-output tests still show useful content.

## Task 3: Validate Model Id Case

- [x] **Step 1: Write failing runtime test**

Add a test in `packages/runtime/src/modelConfig.test.ts`:

```ts
it("rejects uppercase model ids because provider model ids are case-sensitive", () => {
  expect(() =>
    loadModelConfig({
      env: {},
      settings: {
        CODE_EASY_MODEL_PROVIDER: "openai",
        CODE_EASY_AUTH_TOKEN: "test-key",
        CODE_EASY_MODEL: "GPT-5.5"
      }
    })
  ).toThrow("CODE_EASY_MODEL must use the provider model id exactly; model ids are case-sensitive and usually lowercase");
});
```

- [x] **Step 2: Run failing runtime test**

Run:

```bash
pnpm --filter @code-easy/runtime test -- modelConfig.test.ts
```

Expected: FAIL because uppercase model ids are currently accepted.

- [x] **Step 3: Implement validation helper**

In `packages/runtime/src/modelConfig.ts`, add a helper that checks model strings before returning enabled configs:

```ts
function validateModelId(name: string, value: string): string {
  if (/[A-Z]/.test(value)) {
    throw new Error(`${name} must use the provider model id exactly; model ids are case-sensitive and usually lowercase. Received: ${value}`);
  }

  return value;
}
```

Use it when selecting `model` for OpenAI and Anthropic configs.

- [x] **Step 4: Update fixtures and example config**

Replace uppercase `GPT-5.5` fixture/example values with `gpt-5.5` in:

- `packages/runtime/src/modelConfig.test.ts`
- `.code-easy/config.example.json`

- [x] **Step 5: Re-run runtime tests**

Run:

```bash
pnpm --filter @code-easy/runtime test -- modelConfig.test.ts
```

Expected: PASS.

## Task 4: Final Verification And Progress

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @code-easy/cli test -- index.test.ts
pnpm --filter @code-easy/runtime test -- modelConfig.test.ts
```

Expected: both PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Update progress**

Update `docs/PROGRESS.md`:

- Add a task log entry for M1.1.
- Update verification commands and dates.
- Move next step to M1.2: OpenAI Chat Completions provider.
