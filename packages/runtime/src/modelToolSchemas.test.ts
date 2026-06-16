import { describe, expect, it } from "vitest";
import { getModelCallableTool, modelCallableToolNames, modelToolDefinitions } from "./modelToolSchemas.js";

describe("model tool schemas", () => {
  it("exposes only approved tools to the model", () => {
    expect(modelCallableToolNames).toEqual(["git_status", "list_files", "rg_search", "read_file", "apply_patch"]);
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
  });

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
});
