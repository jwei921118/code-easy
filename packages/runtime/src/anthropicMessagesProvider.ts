import type {
  GenerateTextInput,
  GenerateTextResult,
  ModelProvider,
  ModelToolCall,
  ModelToolDefinition
} from "./modelProvider.js";

export type AnthropicFetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type AnthropicMessagesProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: AnthropicFetchLike;
};

function toAnthropicTools(tools: ModelToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));
}

function toAnthropicMessages(input: GenerateTextInput): unknown[] {
  return [
    ...input.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content
      })),
    ...(input.toolResults ?? []).map((result) => ({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: result.callId,
          content: result.output
        }
      ]
    }))
  ];
}

function extractSystemPrompt(input: GenerateTextInput): string | undefined {
  const systemMessages = input.messages.filter((message) => message.role === "system").map((message) => message.content);
  return systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
}

function extractText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const contentValue = (body as Record<string, unknown>).content;
  const content = Array.isArray(contentValue) ? contentValue : [];
  const chunks: string[] = [];

  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;

    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      chunks.push(record.text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function extractToolCalls(body: unknown): ModelToolCall[] {
  if (typeof body !== "object" || body === null) return [];

  const contentValue = (body as Record<string, unknown>).content;
  const content = Array.isArray(contentValue) ? contentValue : [];

  return content.flatMap((part) => {
    if (typeof part !== "object" || part === null) return [];

    const record = part as Record<string, unknown>;
    if (record.type !== "tool_use") return [];
    if (typeof record.id !== "string") return [];
    if (typeof record.name !== "string") return [];

    return [
      {
        callId: record.id,
        name: record.name,
        argumentsText: JSON.stringify(record.input ?? {})
      }
    ];
  });
}

export function createAnthropicMessagesProvider(options: AnthropicMessagesProviderOptions): ModelProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1";

  return {
    name: "anthropic-messages",
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const requestBody: Record<string, unknown> = {
        model: input.model,
        max_tokens: 4096,
        messages: toAnthropicMessages(input)
      };
      const system = extractSystemPrompt(input);
      if (system) requestBody.system = system;

      const tools = toAnthropicTools(input.tools);
      if (tools) requestBody.tools = tools;

      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": options.apiKey
        },
        body: JSON.stringify(requestBody)
      });

      const textBody = await response.text();
      if (!response.ok) {
        throw new Error(`Anthropic Messages API failed with status ${response.status}: ${textBody.slice(0, 500)}`);
      }

      const body = JSON.parse(textBody) as unknown;
      const toolCalls = extractToolCalls(body);
      if (toolCalls.length > 0) {
        return { toolCalls, raw: body };
      }

      const text = extractText(body);
      if (!text) {
        throw new Error("Anthropic Messages API response did not include text output.");
      }

      return { text, raw: body };
    }
  };
}
