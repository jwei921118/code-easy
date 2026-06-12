import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { createLangChainChatModelProvider } from "./langchainChatModelProvider.js";

type FakeRunnable = {
  invoke(input: BaseMessage[]): Promise<AIMessage>;
};

type FakeChatModel = FakeRunnable & {
  bindTools?: (
    tools: unknown[],
    kwargs?: Record<string, unknown>,
  ) => FakeRunnable;
};

describe("createLangChainChatModelProvider", () => {
  it("converts Code Easy system and user messages to LangChain messages", async () => {
    let capturedInput: BaseMessage[] = [];
    const model: FakeChatModel = {
      async invoke(input) {
        capturedInput = input;
        return new AIMessage("model answer");
      },
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model,
    });

    await expect(
      provider.generateText({
        model: "ignored-by-injected-model",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "hello" },
        ],
      }),
    ).resolves.toMatchObject({ text: "model answer" });

    expect(capturedInput).toHaveLength(2);
    expect(capturedInput[0]).toBeInstanceOf(SystemMessage);
    expect(capturedInput[0]?.content).toBe("system prompt");
    expect(capturedInput[1]).toBeInstanceOf(HumanMessage);
    expect(capturedInput[1]?.content).toBe("hello");
  });

  it("binds provider-neutral tools as OpenAI-style function tools", async () => {
    let capturedTools: unknown[] = [];
    let capturedKwargs: Record<string, unknown> | undefined;
    const model: FakeChatModel = {
      async invoke() {
        throw new Error("invoke should use bound runnable when tools are present");
      },
      bindTools(tools, kwargs) {
        capturedTools = tools;
        capturedKwargs = kwargs;
        return {
          async invoke() {
            return new AIMessage("done");
          },
        };
      },
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model,
    });

    await provider.generateText({
      model: "ignored-by-injected-model",
      messages: [{ role: "user", content: "read package" }],
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      ],
    });

    expect(capturedKwargs).toEqual({ parallel_tool_calls: false });
    expect(capturedTools).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
    ]);
  });

  it("extracts LangChain tool calls into Code Easy tool calls", async () => {
    const model: FakeChatModel = {
      async invoke() {
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call-1",
              name: "read_file",
              args: { path: "README.md", maxBytes: 80000 },
            },
          ],
        });
      },
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model,
    });

    await expect(
      provider.generateText({
        model: "ignored-by-injected-model",
        messages: [{ role: "user", content: "read README" }],
      }),
    ).resolves.toMatchObject({
      toolCalls: [
        {
          callId: "call-1",
          name: "read_file",
          argumentsText: "{\"path\":\"README.md\",\"maxBytes\":80000}",
        },
      ],
    });
  });

  it("adds tool result messages after the user-visible messages", async () => {
    let capturedInput: BaseMessage[] = [];
    const model: FakeChatModel = {
      async invoke(input) {
        capturedInput = input;
        return new AIMessage("final answer");
      },
    };

    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model,
    });

    await provider.generateText({
      model: "ignored-by-injected-model",
      messages: [{ role: "user", content: "continue" }],
      toolResults: [{ callId: "call-1", output: "{\"ok\":true}" }],
    });

    expect(capturedInput).toHaveLength(2);
    expect(capturedInput[1]).toBeInstanceOf(ToolMessage);
    expect(capturedInput[1]?.content).toBe("{\"ok\":true}");
    expect((capturedInput[1] as ToolMessage).tool_call_id).toBe("call-1");
  });

  it("throws when tools are provided but the chat model cannot bind tools", async () => {
    const provider = createLangChainChatModelProvider({
      name: "test-langchain",
      model: {
        async invoke() {
          return new AIMessage("unused");
        },
      },
    });

    await expect(
      provider.generateText({
        model: "ignored-by-injected-model",
        messages: [{ role: "user", content: "read file" }],
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
          },
        ],
      }),
    ).rejects.toThrow("LangChain chat model does not support bindTools()");
  });
});
