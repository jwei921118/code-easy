import { describe, expect, it } from "vitest";
import { createAnthropicMessagesProvider } from "./anthropicMessagesProvider.js";

describe("createAnthropicMessagesProvider", () => {
  it("sends Anthropic Messages requests to the configured base URL", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const provider = createAnthropicMessagesProvider({
      apiKey: "test-token",
      baseUrl: "https://api.example.test/v1",
      fetch: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;

        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "hello from anthropic" }]
          }),
          { status: 200 }
        );
      }
    });

    const result = await provider.generateText({
      model: "GPT-5.5",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" }
      ],
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" }
            },
            required: ["path"],
            additionalProperties: false
          }
        }
      ]
    });

    expect(result).toEqual({
      text: "hello from anthropic",
      raw: {
        content: [{ type: "text", text: "hello from anthropic" }]
      }
    });
    expect(capturedUrl).toBe("https://api.example.test/v1/messages");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": "test-token"
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: "GPT-5.5",
      max_tokens: 4096,
      system: "system prompt",
      messages: [{ role: "user", content: "user prompt" }],
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" }
            },
            required: ["path"],
            additionalProperties: false
          }
        }
      ]
    });
  });

  it("extracts Anthropic tool calls", async () => {
    const provider = createAnthropicMessagesProvider({
      apiKey: "test-token",
      fetch: async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                id: "toolu_123",
                name: "read_file",
                input: { path: "README.md" }
              }
            ]
          }),
          { status: 200 }
        )
    });

    await expect(
      provider.generateText({
        model: "GPT-5.5",
        messages: [{ role: "user", content: "read README" }]
      })
    ).resolves.toEqual({
      toolCalls: [
        {
          callId: "toolu_123",
          name: "read_file",
          argumentsText: "{\"path\":\"README.md\"}"
        }
      ],
      raw: {
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "read_file",
            input: { path: "README.md" }
          }
        ]
      }
    });
  });
});
