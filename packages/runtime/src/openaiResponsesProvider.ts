import type {
  GenerateTextInput,
  GenerateTextResult,
  ModelProvider,
  ModelToolCall,
  ModelToolDefinition
} from "./modelProvider.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type OpenAIResponsesProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
};

function extractOutputText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const record = body as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;

    const contentValue = (item as Record<string, unknown>).content;
    const content = Array.isArray(contentValue) ? contentValue : [];

    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;

      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function toOpenAITools(tools: ModelToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    strict: true,
    parameters: tool.parameters
  }));
}

function toOpenAIInput(input: GenerateTextInput): unknown[] {
  return [
    ...input.messages.map((message) => ({
      role: message.role,
      content: message.content
    })),
    ...(input.toolResults ?? []).map((result) => ({
      type: "function_call_output",
      call_id: result.callId,
      output: result.output
    }))
  ];
}

function extractToolCalls(body: unknown): ModelToolCall[] {
  if (typeof body !== "object" || body === null) return [];

  const outputValue = (body as Record<string, unknown>).output;
  const output = Array.isArray(outputValue) ? outputValue : [];

  return output.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];

    const record = item as Record<string, unknown>;
    if (record.type !== "function_call") return [];
    if (typeof record.call_id !== "string") return [];
    if (typeof record.name !== "string") return [];
    if (typeof record.arguments !== "string") return [];

    return [
      {
        callId: record.call_id,
        name: record.name,
        argumentsText: record.arguments
      }
    ];
  });
}

export function createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): ModelProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";

  return {
    name: "openai-responses",
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const requestBody: Record<string, unknown> = {
        model: input.model,
        input: toOpenAIInput(input)
      };
      const tools = toOpenAITools(input.tools);
      if (tools) {
        requestBody.tools = tools;
        requestBody.parallel_tool_calls = false;
      }

      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const textBody = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI Responses API failed with status ${response.status}: ${textBody.slice(0, 500)}`);
      }

      const body = JSON.parse(textBody) as unknown;
      const toolCalls = extractToolCalls(body);
      if (toolCalls.length > 0) {
        return { toolCalls, raw: body };
      }

      const text = extractOutputText(body);
      if (!text) {
        throw new Error("OpenAI Responses API response did not include text output.");
      }

      return { text, raw: body };
    }
  };
}
