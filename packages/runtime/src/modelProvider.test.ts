import { describe, expect, it } from "vitest";
import { buildWorkspaceContextMessages } from "./modelProvider.js";
import type { GenerateTextInput, GenerateTextResult, ModelToolCall, ModelToolResult } from "./modelProvider.js";

describe("buildWorkspaceContextMessages", () => {
  it("builds a system and user prompt from workspace context", () => {
    const messages = buildWorkspaceContextMessages({
      userPrompt: "Explain the runtime",
      gitStatusSummary: "Git status: clean.",
      fileSummary: "Files:\n- packages/runtime/src/sessionManager.ts",
      searchSummary: "Search matches for \"runtime\": none."
    });

    expect(messages).toEqual([
      {
        role: "system",
        content: expect.stringContaining("local coding assistant")
      },
      {
        role: "user",
        content: expect.stringContaining("Explain the runtime")
      }
    ]);
    expect(messages[1]?.content).toContain("packages/runtime/src/sessionManager.ts");
    expect(messages[1]?.content).toContain("Git status: clean.");
  });

  it("allows provider inputs to include tool definitions and prior tool results", () => {
    const toolResult: ModelToolResult = {
      callId: "call-1",
      output: "{\"ok\":true}"
    };
    const input: GenerateTextInput = {
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "Read package.json" }],
      tools: [
        {
          name: "read_file",
          description: "Read a file.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" }
            },
            required: ["path"],
            additionalProperties: false
          }
        }
      ],
      toolResults: [toolResult]
    };

    expect(input.toolResults).toEqual([toolResult]);
  });

  it("allows providers to return tool calls instead of final text", () => {
    const call: ModelToolCall = {
      callId: "call-1",
      name: "read_file",
      argumentsText: "{\"path\":\"package.json\"}"
    };
    const result: GenerateTextResult = {
      toolCalls: [call],
      raw: { output: [] }
    };

    expect(result.toolCalls).toEqual([call]);
  });
});
