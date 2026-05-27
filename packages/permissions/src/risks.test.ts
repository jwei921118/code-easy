import { describe, expect, it } from "vitest";
import { classifyToolRisk, decidePermission } from "./index.js";

describe("permission policy", () => {
  it("allows read-only tools", () => {
    expect(classifyToolRisk("read_file")).toBe("read");
    expect(decidePermission("git_status")).toMatchObject({ action: "allow", risk: "read" });
  });

  it("asks before write and execute tools", () => {
    expect(decidePermission("apply_patch")).toMatchObject({ action: "ask", risk: "write" });
    expect(decidePermission("run_command")).toMatchObject({ action: "ask", risk: "execute" });
  });

  it("treats unknown tools as external", () => {
    expect(decidePermission("unknown_tool")).toMatchObject({ action: "ask", risk: "external" });
  });
});
