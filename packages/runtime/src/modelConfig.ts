import type { ModelProvider } from "./modelProvider.js";
import { createOpenAIResponsesProvider } from "./openaiResponsesProvider.js";

export type DisabledModelConfig = {
  enabled: false;
};

export type OpenAIModelConfig = {
  enabled: true;
  provider: "openai";
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type ModelConfig = DisabledModelConfig | OpenAIModelConfig;

export type LoadModelConfigInput = {
  env?: Record<string, string | undefined>;
  modelOverride?: string;
  disabled?: boolean;
};

export function loadModelConfig(input: LoadModelConfigInput = {}): ModelConfig {
  if (input.disabled === true) return { enabled: false };

  const env = input.env ?? process.env;
  const provider = env.CODE_EASY_MODEL_PROVIDER ?? "off";
  if (provider === "off" || provider.length === 0) return { enabled: false };

  if (provider !== "openai") {
    throw new Error(`Unsupported CODE_EASY_MODEL_PROVIDER: ${provider}`);
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when CODE_EASY_MODEL_PROVIDER=openai");
  }

  return {
    enabled: true,
    provider: "openai",
    apiKey,
    model: input.modelOverride ?? env.CODE_EASY_MODEL ?? "gpt-5-mini",
    baseUrl: env.CODE_EASY_OPENAI_BASE_URL ?? "https://api.openai.com/v1"
  };
}

export function createModelProviderFromConfig(config: ModelConfig): ModelProvider | false {
  if (!config.enabled) return false;

  return createOpenAIResponsesProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl
  });
}
