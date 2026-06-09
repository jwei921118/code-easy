import type { GenerateTextInput, GenerateTextResult, ModelProvider } from "./modelProvider.js";

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

export function createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): ModelProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";

  return {
    name: "openai-responses",
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: input.model,
          input: input.messages.map((message) => ({
            role: message.role,
            content: message.content
          }))
        })
      });

      const textBody = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI Responses API failed with status ${response.status}: ${textBody.slice(0, 500)}`);
      }

      const body = JSON.parse(textBody) as unknown;
      const text = extractOutputText(body);
      if (!text) {
        throw new Error("OpenAI Responses API response did not include text output.");
      }

      return { text, raw: body };
    }
  };
}
