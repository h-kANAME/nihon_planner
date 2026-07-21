import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFailoverError,
  createFailoverAIProvider,
  createAppAIProvider,
} from "../ai/provider.mjs";

test("isFailoverError detecta cuota / 429 / key missing", () => {
  assert.equal(isFailoverError({ status: 429, message: "rate" }), true);
  assert.equal(isFailoverError({ status: 400, message: "bad json" }), false);
  assert.equal(isFailoverError({ status: 503, code: "AI_KEY_MISSING", message: "no key" }), true);
  assert.equal(
    isFailoverError({
      status: 404,
      message: "This model models/x is no longer available to new users",
    }),
    true,
  );
  assert.equal(
    isFailoverError({ status: 403, message: "You exceeded your current quota" }),
    true,
  );
});

test("createFailoverAIProvider sticky tras 429 de primary", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = {
    provider: "google",
    model: "gemini-flash-lite-latest",
    ready: true,
    chat: async () => {
      primaryCalls += 1;
      const err = new Error("quota exceeded");
      err.status = 429;
      throw err;
    },
    chatComplete: async (args) => primary.chat(args),
  };
  const fallback = {
    provider: "deepseek",
    model: "deepseek-chat",
    ready: true,
    chat: async () => {
      fallbackCalls += 1;
      return {
        content: "ok-ds",
        stop_reason: "end",
        usage: { tokens_in: 1, tokens_out: 1, model: "deepseek-chat", provider: "deepseek" },
      };
    },
    chatComplete: async (args) => fallback.chat(args),
  };

  const ai = createFailoverAIProvider(primary, fallback);
  const r1 = await ai.chatComplete({ system: "s", messages: [{ role: "user", content: "h" }] });
  assert.equal(r1.content, "ok-ds");
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(ai.stickyFallback, true);

  const r2 = await ai.chatComplete({ system: "s", messages: [{ role: "user", content: "h2" }] });
  assert.equal(r2.content, "ok-ds");
  assert.equal(primaryCalls, 1, "sticky no vuelve a pegarle a Google");
  assert.equal(fallbackCalls, 2);
  assert.equal(ai.lastFailover?.to, "deepseek");
});

test("createAppAIProvider arma google→deepseek con ambas keys", () => {
  const ai = createAppAIProvider({
    aiProvider: "google",
    aiModel: "gemini-flash-lite-latest",
    aiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    aiApiKey: "gem",
    aiMaxTokens: 100,
    aiMaxContinuations: 1,
    aiFallback: {
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
      aiApiKey: "ds",
    },
  });
  assert.equal(ai.primary.provider, "google");
  assert.equal(ai.fallback.provider, "deepseek");
  assert.equal(ai.primary.ready, true);
  assert.equal(ai.fallback.ready, true);
});
