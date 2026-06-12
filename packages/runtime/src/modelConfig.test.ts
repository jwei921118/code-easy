import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModelProviderFromConfig, loadModelConfig, loadProjectModelSettings } from "./modelConfig.js";

describe("loadModelConfig", () => {
  it("disables model calls by default when no provider is configured", () => {
    expect(loadModelConfig({ env: {} })).toEqual({ enabled: false });
  });

  it("builds OpenAI config from environment", () => {
    expect(
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          CODE_EASY_MODEL: "gpt-5-mini"
        }
      })
    ).toEqual({
      enabled: true,
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1"
    });
  });

  it("builds OpenAI-compatible config from Code Easy project settings", () => {
    expect(
      loadModelConfig({
        env: {},
        settings: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          CODE_EASY_AUTH_TOKEN: "test-key",
          CODE_EASY_BASE_URL: "https://api.example.test/v1",
          CODE_EASY_MODEL: "gpt-5.5"
        }
      })
    ).toEqual({
      enabled: true,
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5.5",
      baseUrl: "https://api.example.test/v1"
    });
  });

  it("rejects uppercase model ids because provider model ids are case-sensitive", () => {
    expect(() =>
      loadModelConfig({
        env: {},
        settings: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          CODE_EASY_AUTH_TOKEN: "test-key",
          CODE_EASY_MODEL: "GPT-5.5"
        }
      })
    ).toThrow("CODE_EASY_MODEL must use the provider model id exactly; model ids are case-sensitive and usually lowercase");
  });

  it("builds Anthropic-compatible config from project settings", () => {
    expect(
      loadModelConfig({
        env: {},
        settings: {
          CODE_EASY_AUTH_TOKEN: "test-token",
          CODE_EASY_BASE_URL: "https://api.example.test/v1",
          CODE_EASY_MODEL: "gpt-5.5"
        }
      })
    ).toEqual({
      enabled: true,
      provider: "anthropic",
      apiKey: "test-token",
      model: "gpt-5.5",
      baseUrl: "https://api.example.test/v1"
    });
  });

  it("uses Code Easy default model aliases when CODE_EASY_MODEL is absent", () => {
    expect(
      loadModelConfig({
        env: {},
        settings: {
          CODE_EASY_AUTH_TOKEN: "test-token",
          CODE_EASY_BASE_URL: "https://api.example.test/v1",
          CODE_EASY_DEFAULT_SONNET_MODEL: "gpt-5.5"
        }
      })
    ).toMatchObject({
      enabled: true,
      provider: "anthropic",
      model: "gpt-5.5"
    });
  });

  it("lets CLI model override Anthropic-compatible project settings", () => {
    expect(
      loadModelConfig({
        env: {},
        settings: {
          CODE_EASY_AUTH_TOKEN: "test-token",
          CODE_EASY_BASE_URL: "https://api.example.test/v1",
          CODE_EASY_MODEL: "gpt-5.5"
        },
        modelOverride: "claude-sonnet-4"
      })
    ).toMatchObject({
      enabled: true,
      provider: "anthropic",
      model: "claude-sonnet-4"
    });
  });

  it("loads project model settings from .code-easy/config.json", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "code-easy-config-"));
    await mkdir(path.join(workspaceRoot, ".code-easy"));
    await writeFile(
      path.join(workspaceRoot, ".code-easy", "config.json"),
      JSON.stringify({
        CODE_EASY_AUTH_TOKEN: "test-token",
        CODE_EASY_BASE_URL: "https://api.example.test/v1",
        CODE_EASY_MODEL: "gpt-5.5"
      }),
      "utf8"
    );

    await expect(loadProjectModelSettings(workspaceRoot)).resolves.toEqual({
      CODE_EASY_AUTH_TOKEN: "test-token",
      CODE_EASY_BASE_URL: "https://api.example.test/v1",
      CODE_EASY_MODEL: "gpt-5.5"
    });
  });

  it("lets CLI model override environment model", () => {
    expect(
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          CODE_EASY_MODEL: "gpt-5-mini"
        },
        modelOverride: "gpt-5"
      })
    ).toMatchObject({
      enabled: true,
      model: "gpt-5"
    });
  });

  it("lets CLI disable model calls", () => {
    expect(
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key"
        },
        disabled: true
      })
    ).toEqual({ enabled: false });
  });

  it("throws when OpenAI is selected without an API key", () => {
    expect(() =>
      loadModelConfig({
        env: {
          CODE_EASY_MODEL_PROVIDER: "openai"
        }
      })
    ).toThrow("CODE_EASY_AUTH_TOKEN is required when CODE_EASY_MODEL_PROVIDER=openai");
  });

  it("returns false for disabled config", () => {
    expect(createModelProviderFromConfig({ enabled: false })).toBe(false);
  });

  it("creates an OpenAI provider for OpenAI config", () => {
    const provider = createModelProviderFromConfig({
      enabled: true,
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.test/v1"
    });

    expect(provider).toMatchObject({ name: "openai-responses" });
  });

  it("creates an Anthropic provider for Anthropic-compatible config", () => {
    const provider = createModelProviderFromConfig({
      enabled: true,
      provider: "anthropic",
      apiKey: "test-token",
      model: "GPT-5.5",
      baseUrl: "https://api.example.test/v1"
    });

    expect(provider).toMatchObject({ name: "anthropic-messages" });
  });
});
