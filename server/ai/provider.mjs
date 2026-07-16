/**
 * Abstracción multi-proveedor. El resto del backend consume chat() / chatComplete().
 */

export const CONTINUE_PROMPT =
  "Continuá exactamente desde donde cortaste, sin repetir lo ya escrito.";

export function normalizeStopReason(provider, raw) {
  if (provider === "anthropic") {
    if (raw === "max_tokens") return "max_tokens";
    if (raw === "end_turn" || raw === "stop_sequence") return "end";
    return "other";
  }
  if (raw === "length") return "max_tokens";
  if (raw === "stop" || raw === "end") return "end";
  return "other";
}

export function mergeParts(prev, next) {
  if (!prev) return next || "";
  if (!next) return prev;
  if (/\n$/.test(prev) || /^\n/.test(next)) return prev + next;
  return prev + next;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, { retries = 1 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e.status || e.statusCode;
      if (i < retries && (status === 429 || (status >= 500 && status < 600))) {
        await sleep(800 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function chatAnthropic({ baseUrl, apiKey, model, maxTokens, system, messages }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const content = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return {
      content,
      stop_reason: normalizeStopReason("anthropic", data.stop_reason),
      usage: {
        tokens_in: data.usage?.input_tokens ?? null,
        tokens_out: data.usage?.output_tokens ?? null,
        model,
        provider: "anthropic",
      },
    };
  } finally {
    clearTimeout(t);
  }
}

async function chatOpenAICompatible({ baseUrl, apiKey, model, maxTokens, system, messages }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60_000);
  try {
    const openaiMessages = [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: openaiMessages,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || `AI HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const content = data.choices?.[0]?.message?.content ?? "";
    const finish = data.choices?.[0]?.finish_reason;
    return {
      content,
      stop_reason: normalizeStopReason("openai-compatible", finish),
      usage: {
        tokens_in: data.usage?.prompt_tokens ?? null,
        tokens_out: data.usage?.completion_tokens ?? null,
        model,
        provider: "openai-compatible",
      },
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 1 llamada inicial + hasta maxContinuations extras mientras stop_reason === max_tokens.
 * Inyectable via chatFn para tests.
 */
export async function runChatComplete(chatFn, {
  system,
  messages,
  maxContinuations = 3,
  log,
  wallMs = 180_000,
} = {}) {
  const baseMessages = messages.map((m) => ({ role: m.role, content: m.content }));
  let accumulated = "";
  let parts = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let lastStop = "end";
  let lastUsage = {};
  const wallDeadline = Date.now() + wallMs;

  while (true) {
    if (Date.now() > wallDeadline) {
      const err = new Error("Timeout total de continuación AI (180s)");
      err.status = 504;
      throw err;
    }

    const callMessages = accumulated
      ? [
          ...baseMessages,
          { role: "assistant", content: accumulated },
          { role: "user", content: CONTINUE_PROMPT },
        ]
      : baseMessages;

    const result = await chatFn({ system, messages: callMessages });
    parts += 1;
    accumulated = mergeParts(accumulated, result.content || "");
    lastStop = result.stop_reason || "other";
    lastUsage = result.usage || {};

    if (typeof result.usage?.tokens_in === "number") tokensIn += result.usage.tokens_in;
    if (typeof result.usage?.tokens_out === "number") tokensOut += result.usage.tokens_out;

    log?.info?.({ part: parts, stop_reason: lastStop, chars: accumulated.length }, "AI chat part");

    const extrasUsed = parts - 1;
    if (lastStop !== "max_tokens" || extrasUsed >= maxContinuations) break;
  }

  return {
    content: accumulated.trim(),
    stop_reason: lastStop,
    parts,
    continued: parts > 1,
    usage: {
      tokens_in: tokensIn || lastUsage.tokens_in || null,
      tokens_out: tokensOut || lastUsage.tokens_out || null,
      model: lastUsage.model,
      provider: lastUsage.provider,
    },
  };
}

export function createAIProvider(config) {
  const {
    aiProvider,
    aiModel,
    aiBaseUrl,
    aiApiKey,
    aiMaxTokens,
    aiMaxContinuations = 3,
  } = config;

  if (!aiApiKey) {
    const missing = async () => {
      const err = new Error("AI_API_KEY no configurada");
      err.status = 503;
      throw err;
    };
    return { chat: missing, chatComplete: missing };
  }

  async function chatOnce({ system, messages }) {
    return withRetry(async () => {
      if (aiProvider === "anthropic") {
        return chatAnthropic({
          baseUrl: aiBaseUrl,
          apiKey: aiApiKey,
          model: aiModel,
          maxTokens: aiMaxTokens,
          system,
          messages,
        });
      }
      return chatOpenAICompatible({
        baseUrl: aiBaseUrl,
        apiKey: aiApiKey,
        model: aiModel,
        maxTokens: aiMaxTokens,
        system,
        messages,
      });
    });
  }

  return {
    chat: chatOnce,
    async chatComplete({ system, messages, log }) {
      return runChatComplete(chatOnce, {
        system,
        messages,
        maxContinuations: Number.isFinite(aiMaxContinuations) ? aiMaxContinuations : 3,
        log,
      });
    },
  };
}
