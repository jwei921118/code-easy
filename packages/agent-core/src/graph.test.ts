import { describe, expect, it } from "vitest";
import { createCodeEasyGraph } from "./index.js";

describe("createCodeEasyGraph", () => {
  it("returns a minimal initialized plan", async () => {
    const graph = createCodeEasyGraph();
    const result = await graph.invoke({
      messages: ["Build a CLI"],
      workspaceRoot: "/tmp/project"
    });

    expect(result.plan).toEqual([
      {
        id: "understand-request",
        title: "Understand: Build a CLI",
        status: "completed"
      }
    ]);
    expect(result.messages).toContain("Runtime initialized.");
  });
});
