import { describe, expect, it } from "vitest";
import { createOpenAIResponsesProvider } from "./openaiResponsesProvider.js";

describe("createOpenAIResponsesProvider", () => {
  it("posts to the Responses API and returns output_text", async () => {
    const calls: unknown[] = [];
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ output_text: "model answer" }), { status: 200 });
      }
    });

    const result = await provider.generateText({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(result.text).toBe("model answer");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.test/v1/responses"
    });
  });

  it("extracts text from output content when output_text is absent", async () => {
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            output: [{ content: [{ type: "output_text", text: "nested answer" }] }]
          }),
          { status: 200 }
        )
    });

    await expect(
      provider.generateText({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }]
      })
    ).resolves.toMatchObject({ text: "nested answer" });
  });

  it("throws with status details for non-2xx responses", async () => {
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async () => new Response("bad request", { status: 400 })
    });

    await expect(
      provider.generateText({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }]
      })
    ).rejects.toThrow("OpenAI Responses API failed with status 400: bad request");
  });

  it("sends tools with parallel tool calls disabled", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ output_text: "done" }), { status: 200 });
      }
    });

    await provider.generateText({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "read_file",
          description: "Read a file.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false
          }
        }
      ]
    });

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      parallel_tool_calls: false,
      tools: [
        {
          type: "function",
          name: "read_file",
          strict: true
        }
      ]
    });
  });

  it("parses function_call output items", async () => {
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                call_id: "call-1",
                name: "read_file",
                arguments: "{\"path\":\"package.json\",\"maxBytes\":80000}"
              }
            ]
          }),
          { status: 200 }
        )
    });

    await expect(
      provider.generateText({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "read package" }]
      })
    ).resolves.toMatchObject({
      toolCalls: [
        {
          callId: "call-1",
          name: "read_file",
          argumentsText: "{\"path\":\"package.json\",\"maxBytes\":80000}"
        }
      ]
    });
  });

  it("sends function_call_output items on follow-up requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.test/v1",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ output_text: "final" }), { status: 200 });
      }
    });

    await provider.generateText({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "continue" }],
      toolResults: [{ callId: "call-1", output: "{\"ok\":true}" }]
    });

    const body = JSON.parse(String(calls[0]?.init.body)) as { input: unknown[] };
    expect(body.input).toContainEqual({
      type: "function_call_output",
      call_id: "call-1",
      output: "{\"ok\":true}"
    });
  });
});
