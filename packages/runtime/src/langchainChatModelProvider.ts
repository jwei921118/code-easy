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
  /** 执行一次 LangChain 消息调用并返回 AI 消息。 */
  invoke(input: BaseMessage[]): Promise<LangChainAIMessage>;
};

type ChatModelLike = ChatRunnable & {
  /** 绑定工具定义，返回支持工具调用的 runnable。 */
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

/** 将 Code Easy 的模型消息和工具结果转换成 LangChain 消息。 */
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

/** 将 provider 无关的工具定义转换成 OpenAI function tool 格式。 */
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

/** 判断 LangChain 返回内容中的分片是否为文本片段。 */
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

/** 从 LangChain AI 消息中提取最终文本内容。 */
function extractText(message: LangChainAIMessage): string | undefined {
  if (typeof message.content === "string") {
    return message.content;
  }

  const text = message.content.filter(isTextContentPart).map((part) => part.text).join("");
  return text.length > 0 ? text : undefined;
}

/** 调用具体 LangChain 模型，并把文本或工具调用结果转换回 Code Easy 格式。 */
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

/** 用任意 LangChain ChatModel 创建 Code Easy 模型提供方适配器。 */
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

/** 创建 OpenAI 兼容 ChatModel provider，支持自定义 base URL。 */
export function createOpenAIChatModelProvider(
  options: OpenAIChatModelProviderOptions,
): ModelProvider {
  return {
    name: "langchain-openai-chat",
    generateText(input) {
      const model = new ChatOpenAI({
        model: input.model,
        apiKey: options.apiKey,
        maxRetries: 0,
        configuration: {
          baseURL: options.baseUrl,
        },
      });

      return generateWithModel(this.name, model as unknown as ChatModelLike, input);
    },
  };
}
