import { describe, expect, it } from "vitest";
import { buildWorkspaceContextMessages } from "./modelProvider.js";

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
});
