export type ModelMessage = {
  role: "system" | "user";
  content: string;
};

export type GenerateTextInput = {
  model: string;
  messages: ModelMessage[];
};

export type GenerateTextResult = {
  text: string;
  raw?: unknown;
};

export type ModelProvider = {
  name: string;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
};

export type WorkspaceContextPromptInput = {
  userPrompt: string;
  gitStatusSummary: string;
  fileSummary: string;
  searchSummary: string;
};

export function buildWorkspaceContextMessages(input: WorkspaceContextPromptInput): ModelMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Code Easy, a local coding assistant. Answer from the provided workspace context. Cite file paths when useful. Do not claim you edited files or ran commands unless the context says so."
    },
    {
      role: "user",
      content: [
        `User request:\n${input.userPrompt}`,
        `Git status:\n${input.gitStatusSummary}`,
        `Workspace files:\n${input.fileSummary}`,
        `Search results:\n${input.searchSummary}`
      ].join("\n\n")
    }
  ];
}
