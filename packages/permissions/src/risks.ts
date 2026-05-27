export type ToolRisk = "read" | "write" | "execute" | "network" | "destructive" | "external";

export type PermissionDecision =
  | { action: "allow"; risk: ToolRisk; reason: string }
  | { action: "ask"; risk: ToolRisk; reason: string };

const readTools = new Set(["read_file", "list_files", "rg_search", "git_status", "git_diff"]);
const writeTools = new Set(["apply_patch", "write_file"]);
const executeTools = new Set(["run_command"]);
const externalTools = new Set(["mcp_call", "browser_open", "browser_snapshot", "browser_click"]);

export function classifyToolRisk(toolName: string): ToolRisk {
  if (readTools.has(toolName)) return "read";
  if (writeTools.has(toolName)) return "write";
  if (executeTools.has(toolName)) return "execute";
  if (externalTools.has(toolName)) return "external";
  return "external";
}

export function decidePermission(toolName: string): PermissionDecision {
  const risk = classifyToolRisk(toolName);

  if (risk === "read") {
    return { action: "allow", risk, reason: "Read-only workspace inspection is allowed by default." };
  }

  return {
    action: "ask",
    risk,
    reason: `Tool ${toolName} has ${risk} risk and requires user approval.`
  };
}
