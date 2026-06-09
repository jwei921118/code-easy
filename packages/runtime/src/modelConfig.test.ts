import { describe, expect, it } from "vitest";
import { createModelProviderFromConfig, loadModelConfig } from "./modelConfig.js";

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
    ).toThrow("OPENAI_API_KEY is required when CODE_EASY_MODEL_PROVIDER=openai");
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
});
