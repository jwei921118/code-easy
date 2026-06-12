import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelProvider } from './modelProvider.js';
import { createAnthropicMessagesProvider } from './anthropicMessagesProvider.js';
import { createOpenAIChatModelProvider } from './langchainChatModelProvider.js';
import { createOpenAIResponsesProvider } from './openaiResponsesProvider.js';

export type DisabledModelConfig = {
  enabled: false;
};

export type OpenAIModelConfig = {
  enabled: true;
  provider: 'openai';
  apiKind: 'responses' | 'chat';
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type AnthropicModelConfig = {
  enabled: true;
  provider: 'anthropic';
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type ModelConfig =
  | DisabledModelConfig
  | OpenAIModelConfig
  | AnthropicModelConfig;

export type ProjectModelSettings = Record<string, string | undefined>;

export type LoadModelConfigInput = {
  env?: Record<string, string | undefined>;
  settings?: ProjectModelSettings;
  modelOverride?: string;
  disabled?: boolean;
};

function readSetting(
  settings: ProjectModelSettings | undefined,
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return settings?.[key] ?? env[key];
}

function readAnthropicModel(
  settings: ProjectModelSettings | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  return (
    readSetting(settings, env, 'CODE_EASY_MODEL') ??
    readSetting(settings, env, 'CODE_EASY_DEFAULT_SONNET_MODEL') ??
    readSetting(settings, env, 'CODE_EASY_DEFAULT_OPUS_MODEL') ??
    readSetting(settings, env, 'CODE_EASY_DEFAULT_HAIKU_MODEL') ??
    readSetting(settings, env, 'CODE_EASY_REASONING_MODEL') ??
    readSetting(settings, env, 'ANTHROPIC_MODEL') ??
    readSetting(settings, env, 'ANTHROPIC_DEFAULT_SONNET_MODEL') ??
    readSetting(settings, env, 'ANTHROPIC_DEFAULT_OPUS_MODEL') ??
    readSetting(settings, env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL') ??
    readSetting(settings, env, 'ANTHROPIC_REASONING_MODEL')
  );
}

function normalizeProvider(
  provider: string | undefined,
): 'off' | 'openai' | 'anthropic' {
  if (!provider || provider.length === 0) return 'off';
  if (provider === 'off' || provider === 'openai' || provider === 'anthropic')
    return provider;

  throw new Error(`Unsupported CODE_EASY_MODEL_PROVIDER: ${provider}`);
}

function normalizeOpenAIApiKind(
  value: string | undefined,
): 'responses' | 'chat' {
  if (!value || value.length === 0) return 'responses';
  if (value === 'responses' || value === 'chat') return value;

  throw new Error(`Unsupported CODE_EASY_OPENAI_API_KIND: ${value}`);
}

function validateModelId(name: string, value: string): string {
  if (/[A-Z]/.test(value)) {
    throw new Error(
      `${name} must use the provider model id exactly; model ids are case-sensitive and usually lowercase. Received: ${value}`,
    );
  }

  return value;
}

export async function loadProjectModelSettings(
  workspaceRoot: string,
): Promise<ProjectModelSettings> {
  try {
    const text = await readFile(
      path.join(workspaceRoot, '.code-easy', 'config.json'),
      'utf8',
    );
    const parsed = JSON.parse(text) as unknown;

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('.code-easy/config.json must contain a JSON object.');
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {};
    }

    throw error;
  }
}

export function loadModelConfig(input: LoadModelConfigInput = {}): ModelConfig {
  if (input.disabled === true) return { enabled: false };

  const env = input.env ?? process.env;
  const settings = input.settings;
  const explicitProvider = readSetting(
    settings,
    env,
    'CODE_EASY_MODEL_PROVIDER',
  );
  const provider = normalizeProvider(
    explicitProvider ??
      (readSetting(settings, env, 'CODE_EASY_AUTH_TOKEN') ||
      readSetting(settings, env, 'CODE_EASY_API_KEY') ||
      readSetting(settings, env, 'ANTHROPIC_AUTH_TOKEN') ||
      readSetting(settings, env, 'ANTHROPIC_API_KEY')
        ? 'anthropic'
        : 'off'),
  );
  if (provider === 'off') return { enabled: false };

  if (provider === 'anthropic') {
    const apiKey =
      readSetting(settings, env, 'CODE_EASY_AUTH_TOKEN') ??
      readSetting(settings, env, 'CODE_EASY_API_KEY') ??
      readSetting(settings, env, 'ANTHROPIC_AUTH_TOKEN') ??
      readSetting(settings, env, 'ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error(
        'CODE_EASY_AUTH_TOKEN is required when CODE_EASY_MODEL_PROVIDER=anthropic',
      );
    }

    const model = input.modelOverride ?? readAnthropicModel(settings, env);
    if (!model) {
      throw new Error(
        'CODE_EASY_MODEL is required when CODE_EASY_MODEL_PROVIDER=anthropic',
      );
    }

    return {
      enabled: true,
      provider: 'anthropic',
      apiKey,
      model: validateModelId('CODE_EASY_MODEL', model),
      baseUrl:
        readSetting(settings, env, 'CODE_EASY_BASE_URL') ??
        readSetting(settings, env, 'ANTHROPIC_BASE_URL') ??
        'https://api.anthropic.com/v1',
    };
  }

  const apiKey =
    readSetting(settings, env, 'CODE_EASY_AUTH_TOKEN') ??
    readSetting(settings, env, 'CODE_EASY_API_KEY') ??
    readSetting(settings, env, 'OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'CODE_EASY_AUTH_TOKEN is required when CODE_EASY_MODEL_PROVIDER=openai',
    );
  }

  return {
    enabled: true,
    provider: 'openai',
    apiKind: normalizeOpenAIApiKind(
      readSetting(settings, env, 'CODE_EASY_OPENAI_API_KIND'),
    ),
    apiKey,
    model: validateModelId(
      'CODE_EASY_MODEL',
      input.modelOverride ??
        readSetting(settings, env, 'CODE_EASY_MODEL') ??
        'gpt-5-mini',
    ),
    baseUrl:
      readSetting(settings, env, 'CODE_EASY_BASE_URL') ??
      readSetting(settings, env, 'CODE_EASY_OPENAI_BASE_URL') ??
      'https://api.openai.com/v1',
  };
}

export function createModelProviderFromConfig(
  config: ModelConfig,
): ModelProvider | false {
  if (!config.enabled) return false;

  if (config.provider === 'anthropic') {
    return createAnthropicMessagesProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
  }

  if (config.apiKind === 'chat') {
    return createOpenAIChatModelProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
  }

  return createOpenAIResponsesProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}
