import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type {
  GenerateTextInput,
  GenerateTextResult,
  ModelProvider,
  ModelToolDefinition,
} from "./modelProvider.js";

type LangChainAIMessage = AIMessage | AIMessageChunk;

type ChatRunnable = {
  invoke(input: BaseMessage[]): Promise<LangChainAIMessage>;
};

type ChatModelLike = ChatRunnable & {
  bindTools?: (
    tools: Array<Record<string, unknown>>,
    kwargs?: Record<string, unknown>,
  ) => ChatRunnable;
};

export type LangChainChatModelProviderOptions = {
  name: string;
  model: ChatModelLike;
};

export type OpenAIChatModelProviderOptions = {
  apiKey: string;
  baseUrl: string;
};

function toLangChainMessages(input: GenerateTextInput): BaseMessage[] {
  const messages: BaseMessage[] = input.messages.map((message) => {
    if (message.role === "system") {
      return new SystemMessage(message.content);
    }

    return new HumanMessage(message.content);
  });

  for (const result of input.toolResults ?? []) {
    messages.push(
      new ToolMessage({
        content: result.output,
        tool_call_id: result.callId,
      }),
    );
  }

  return messages;
}

function toOpenAITool(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function isTextContentPart(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function extractText(message: LangChainAIMessage): string | undefined {
  if (typeof message.content === "string") {
    return message.content;
  }

  const text = message.content.filter(isTextContentPart).map((part) => part.text).join("");
  return text.length > 0 ? text : undefined;
}

async function generateWithModel(
  providerName: string,
  model: ChatModelLike,
  input: GenerateTextInput,
): Promise<GenerateTextResult> {
  const messages = toLangChainMessages(input);
  const tools = input.tools?.map(toOpenAITool) ?? [];
  const runnable =
    tools.length === 0 ? model : model.bindTools?.(tools, { parallel_tool_calls: false });

  if (!runnable) {
    throw new Error("LangChain chat model does not support bindTools()");
  }

  const message = await runnable.invoke(messages);
  const toolCalls = message.tool_calls?.map((toolCall) => ({
    callId: toolCall.id ?? toolCall.name,
    name: toolCall.name,
    argumentsText: JSON.stringify(toolCall.args ?? {}),
  }));

  return {
    text: toolCalls && toolCalls.length > 0 ? undefined : extractText(message),
    toolCalls,
    raw: {
      provider: providerName,
      message,
    },
  };
}

export function createLangChainChatModelProvider(
  options: LangChainChatModelProviderOptions,
): ModelProvider {
  return {
    name: options.name,
    generateText(input) {
      return generateWithModel(options.name, options.model, input);
    },
  };
}

export function createOpenAIChatModelProvider(
  options: OpenAIChatModelProviderOptions,
): ModelProvider {
  return {
    name: "langchain-openai-chat",
    generateText(input) {
      const model = new ChatOpenAI({
        model: input.model,
        apiKey: options.apiKey,
        configuration: {
          baseURL: options.baseUrl,
        },
      });

      return generateWithModel(this.name, model as unknown as ChatModelLike, input);
    },
  };
}
