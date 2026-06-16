import type { ModelToolDefinition } from "./modelProvider.js";

export const modelCallableToolNames = ["git_status", "list_files", "rg_search", "read_file", "apply_patch"] as const;

export type ModelCallableToolName = (typeof modelCallableToolNames)[number];

const objectSchema = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

export const modelToolDefinitions: ModelToolDefinition[] = [
  {
    name: "git_status",
    description: "Inspect Git status for the current workspace.",
    parameters: objectSchema(
      {
        porcelain: {
          type: "boolean",
          description: "Use short porcelain output. Use true unless the user asks for full status."
        }
      },
      ["porcelain"]
    )
  },
  {
    name: "list_files",
    description: "List files inside the workspace while skipping generated directories.",
    parameters: objectSchema(
      {
        path: { type: "string", description: "Workspace-relative directory path." },
        limit: { type: "number", description: "Maximum number of files to return, from 1 to 5000." },
        includeHidden: { type: "boolean", description: "Whether to include hidden files." }
      },
      ["path", "limit", "includeHidden"]
    )
  },
  {
    name: "rg_search",
    description: "Search workspace text with ripgrep and return bounded structured matches.",
    parameters: objectSchema(
      {
        pattern: { type: "string", description: "Search pattern." },
        path: { type: "string", description: "Workspace-relative file or directory path." },
        maxMatches: { type: "number", description: "Maximum number of matches, from 1 to 1000." },
        caseSensitive: { type: "boolean", description: "Whether search is case-sensitive." }
      },
      ["pattern", "path", "maxMatches", "caseSensitive"]
    )
  },
  {
    name: "read_file",
    description: "Read a bounded UTF-8 text file inside the workspace.",
    parameters: objectSchema(
      {
        path: { type: "string", description: "Workspace-relative file path." },
        maxBytes: { type: "number", description: "Maximum bytes to read, from 1 to 200000." }
      },
      ["path", "maxBytes"]
    )
  },
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
];

export function getModelCallableTool(name: string): ModelToolDefinition | undefined {
  return modelToolDefinitions.find((tool) => tool.name === name);
}
