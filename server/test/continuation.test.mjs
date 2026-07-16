import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStopReason,
  mergeParts,
  runChatComplete,
  CONTINUE_PROMPT,
} from "../ai/provider.mjs";

test("normalizeStopReason anthropic / openai", () => {
  assert.equal(normalizeStopReason("anthropic", "max_tokens"), "max_tokens");
  assert.equal(normalizeStopReason("anthropic", "end_turn"), "end");
  assert.equal(normalizeStopReason("openai-compatible", "length"), "max_tokens");
  assert.equal(normalizeStopReason("openai-compatible", "stop"), "end");
});

test("mergeParts mid-line vs newline", () => {
  assert.equal(mergeParts("Día 15 (19/", "4): Osaka"), "Día 15 (19/4): Osaka");
  assert.equal(mergeParts("bloque 1\n", "bloque 2"), "bloque 1\nbloque 2");
});

test("runChatComplete merges 3 parts when truncated twice", async () => {
  let calls = 0;
  const chatFn = async ({ messages }) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(messages.filter((m) => m.role === "user").length, 1);
      return {
        content: "PARTE1-",
        stop_reason: "max_tokens",
        usage: { tokens_in: 10, tokens_out: 5, model: "mock", provider: "mock" },
      };
    }
    if (calls === 2) {
      const lastUser = messages[messages.length - 1];
      assert.equal(lastUser.content, CONTINUE_PROMPT);
      assert.ok(messages.some((m) => m.role === "assistant" && m.content.includes("PARTE1")));
      return {
        content: "PARTE2-",
        stop_reason: "max_tokens",
        usage: { tokens_in: 20, tokens_out: 5, model: "mock", provider: "mock" },
      };
    }
    return {
      content: "PARTE3",
      stop_reason: "end",
      usage: { tokens_in: 30, tokens_out: 5, model: "mock", provider: "mock" },
    };
  };

  const result = await runChatComplete(chatFn, {
    system: "sys",
    messages: [{ role: "user", content: "dame itinerario" }],
    maxContinuations: 3,
  });

  assert.equal(calls, 3);
  assert.equal(result.parts, 3);
  assert.equal(result.continued, true);
  assert.equal(result.content, "PARTE1-PARTE2-PARTE3");
  assert.equal(result.stop_reason, "end");
  assert.equal(result.usage.tokens_in, 60);
  assert.equal(result.usage.tokens_out, 15);
});

test("runChatComplete stops at maxContinuations even if still truncated", async () => {
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    return {
      content: `X${calls}`,
      stop_reason: "max_tokens",
      usage: { tokens_in: 1, tokens_out: 1, model: "mock", provider: "mock" },
    };
  };

  const result = await runChatComplete(chatFn, {
    system: "sys",
    messages: [{ role: "user", content: "largo" }],
    maxContinuations: 2, // 1 + 2 extras = 3 calls
  });

  assert.equal(calls, 3);
  assert.equal(result.parts, 3);
  assert.equal(result.stop_reason, "max_tokens");
  assert.equal(result.content, "X1X2X3");
});
