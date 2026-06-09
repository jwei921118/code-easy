import { describe, expect, it } from "vitest";
import { getModelCallableTool, modelCallableToolNames, modelToolDefinitions } from "./modelToolSchemas.js";

describe("model tool schemas", () => {
  it("exposes only read-only tools to the model", () => {
    expect(modelCallableToolNames).toEqual(["git_status", "list_files", "rg_search", "read_file"]);
    expect(modelCallableToolNames).not.toContain("apply_patch");
    expect(modelCallableToolNames).not.toContain("run_command");
  });

  it("uses strict schemas with no additional properties", () => {
    for (const tool of modelToolDefinitions) {
      expect(tool.parameters).toMatchObject({
        type: "object",
        additionalProperties: false
      });
      expect(Array.isArray((tool.parameters as { required?: unknown }).required)).toBe(true);
    }
  });

  it("finds callable tool definitions by name", () => {
    expect(getModelCallableTool("read_file")).toMatchObject({
      name: "read_file",
      description: expect.stringContaining("Read")
    });
    expect(getModelCallableTool("run_command")).toBeUndefined();
  });
});
