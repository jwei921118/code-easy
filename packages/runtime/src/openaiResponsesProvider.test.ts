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
});
