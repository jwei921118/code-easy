export type ModelMessage = {
  role: "system" | "user";
  content: string;
};

export type ModelToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelToolCall = {
  callId: string;
  name: string;
  argumentsText: string;
};

export type ModelToolResult = {
  callId: string;
  output: string;
};

export type GenerateTextInput = {
  model: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  toolResults?: ModelToolResult[];
};

export type GenerateTextResult = {
  text?: string;
  toolCalls?: ModelToolCall[];
  raw?: unknown;
};

export type ModelProvider = {
  name: string;
  /** 根据消息、工具定义和工具结果生成模型响应。 */
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
};

export type WorkspaceContextPromptInput = {
  userPrompt: string;
  gitStatusSummary: string;
  fileSummary: string;
  searchSummary: string;
};

/** 把工作区上下文整理成模型可消费的 system/user 消息。 */
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
