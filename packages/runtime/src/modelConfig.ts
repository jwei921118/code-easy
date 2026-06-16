import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelProvider } from './modelProvider.js';
import { createOpenAIChatModelProvider } from './langchainChatModelProvider.js';

export type DisabledModelConfig = {
  enabled: false;
};

export type OpenAIModelConfig = {
  enabled: true;
  provider: 'openai';
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type ModelConfig = DisabledModelConfig | OpenAIModelConfig;

export type ProjectModelSettings = Record<string, string | undefined>;

export type LoadModelConfigInput = {
  env?: Record<string, string | undefined>;
  settings?: ProjectModelSettings;
  modelOverride?: string;
  disabled?: boolean;
};

/** 按项目配置优先、环境变量兜底的顺序读取模型设置。 */
function readSetting(
  settings: ProjectModelSettings | undefined,
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return settings?.[key] ?? env[key];
}

/** 规范化模型提供方名称，并拒绝暂不支持的 provider。 */
function normalizeProvider(
  provider: string | undefined,
): 'off' | 'openai' {
  if (!provider || provider.length === 0) return 'off';
  if (provider === 'off' || provider === 'openai') return provider;

  throw new Error(`Unsupported CODE_EASY_MODEL_PROVIDER: ${provider}`);
}

/** 校验模型 id，避免把大小写不匹配的别名误传给 provider。 */
function validateModelId(name: string, value: string): string {
  if (/[A-Z]/.test(value)) {
    throw new Error(
      `${name} must use the provider model id exactly; model ids are case-sensitive and usually lowercase. Received: ${value}`,
    );
  }

  return value;
}

/** 读取工作区 `.code-easy/config.json` 中的模型设置。 */
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

/** 合并项目设置、环境变量和 CLI 覆盖，生成运行时模型配置。 */
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
      readSetting(settings, env, 'OPENAI_API_KEY')
        ? 'openai'
        : 'off'),
  );
  if (provider === 'off') return { enabled: false };

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

/** 根据模型配置创建实际 provider；关闭模型时返回 false。 */
export function createModelProviderFromConfig(
  config: ModelConfig,
): ModelProvider | false {
  if (!config.enabled) return false;
  return createOpenAIChatModelProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}
