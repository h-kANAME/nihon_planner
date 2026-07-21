import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAiProvider,
  aiProviderDefaults,
  resolveAiApiKey,
  buildAiConfig,
} from "../config.mjs";

test("normalizeAiProvider aliases gemini → google", () => {
  assert.equal(normalizeAiProvider("gemini"), "google");
  assert.equal(normalizeAiProvider("Google"), "google");
  assert.equal(normalizeAiProvider("deepseek"), "deepseek");
});

test("aiProviderDefaults google usa endpoint OpenAI-compatible Gemini", () => {
  const d = aiProviderDefaults("google");
  assert.equal(d.provider, "google");
  assert.equal(d.model, "gemini-flash-lite-latest");
  assert.match(d.baseUrl, /generativelanguage\.googleapis\.com.*openai/);
});

test("resolveAiApiKey usa keys dedicadas (convivencia failover)", () => {
  const env = {
    AI_PROVIDER: "google",
    AI_API_KEY: "sk-legacy",
    GEMINI_API_KEY: "gem-key",
    DEEPSEEK_API_KEY: "ds-key",
  };
  assert.equal(resolveAiApiKey("google", env), "gem-key");
  assert.equal(resolveAiApiKey("deepseek", env), "ds-key");
  assert.equal(resolveAiApiKey("google", { AI_PROVIDER: "google", AI_API_KEY: "only" }), "");
  assert.equal(resolveAiApiKey("deepseek", { AI_API_KEY: "sk-only" }), "sk-only");
  assert.equal(resolveAiApiKey("anthropic", { ANTHROPIC_API_KEY: "ant" }), "ant");
});

test("buildAiConfig ignora AI_MODEL compartido (perfil limpio por provider)", () => {
  const env = {
    AI_MODEL: "deepseek-chat",
    AI_BASE_URL: "https://api.deepseek.com/v1",
    GEMINI_API_KEY: "g",
  };
  const g = buildAiConfig("google", env);
  assert.equal(g.aiProvider, "google");
  assert.equal(g.aiModel, "gemini-flash-lite-latest");
  assert.match(g.aiBaseUrl, /openai\/?$/);
  assert.equal(g.aiApiKey, "g");
});
