/**
 * Abstracción multi-proveedor. El resto del backend consume chat() / chatComplete().
 */

export const CONTINUE_PROMPT =
  "Continuá exactamente desde donde cortaste, sin repetir lo ya escrito.";

export const CONTINUE_JSON_PROMPT =
  "El JSON quedó truncado. Continuá SOLO con los caracteres JSON que faltan desde el punto de corte, sin repetir lo ya escrito, sin fences markdown y sin explicación.";


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

/** Extrae delay sugerido de errores Gemini/OpenAI (Retry-After / "retry in Ns"). */
export function parseRetryAfterMs(err, fallbackMs = 45_000) {
  const header = Number(err?.retryAfterMs);
  if (Number.isFinite(header) && header > 0) return header;

  const msg = String(err?.message || "");
  const m = /retry in\s+(\d+(?:\.\d+)?)\s*s/i.exec(msg);
  if (m) return Math.ceil(Number(m[1]) * 1000);

  const details = err?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const delay = d?.retryDelay;
      if (typeof delay === "string") {
        const sec = Number(String(delay).replace(/s$/i, ""));
        if (Number.isFinite(sec) && sec > 0) return Math.ceil(sec * 1000);
      }
    }
  }
  return fallbackMs;
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
        const waitMs =
          status === 429
            ? parseRetryAfterMs(e, 45_000) + i * 5_000
            : 800 * (i + 1);
        await sleep(waitMs);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

function createRateGate(minIntervalMs) {
  let last = 0;
  return async () => {
    if (!minIntervalMs || minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = last + minIntervalMs - now;
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

async function chatAnthropic({ baseUrl, apiKey, model, maxTokens, system, messages, timeoutMs = 120_000 }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
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

async function chatOpenAICompatible({
  baseUrl,
  apiKey,
  model,
  maxTokens,
  system,
  messages,
  timeoutMs = 120_000,
  providerLabel = "openai-compatible",
}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
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
      err.details = data?.error?.details;
      const retryInfo = Array.isArray(data?.error?.details)
        ? data.error.details.find((d) => d?.retryDelay)
        : null;
      if (retryInfo?.retryDelay) {
        const sec = Number(String(retryInfo.retryDelay).replace(/s$/i, ""));
        if (Number.isFinite(sec)) err.retryAfterMs = Math.ceil(sec * 1000);
      }
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
        provider: providerLabel,
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
  continuePrompt = CONTINUE_PROMPT,
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
      const err = new Error("Timeout total de continuación AI (wall clock)");
      err.status = 504;
      throw err;
    }

    const callMessages = accumulated
      ? [
          ...baseMessages,
          { role: "assistant", content: accumulated },
          { role: "user", content: continuePrompt },
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
    truncated: lastStop === "max_tokens",
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
    aiModel,
    aiBaseUrl,
    aiApiKey,
    aiMaxTokens,
    aiMaxContinuations = 3,
    aiRetries,
  } = config;
  const aiProvider =
    config.aiProvider === "gemini" ? "google" : String(config.aiProvider || "deepseek").toLowerCase();

  if (!aiApiKey) {
    const missing = async () => {
      const err = new Error(
        aiProvider === "google"
          ? "GEMINI_API_KEY / GOOGLE_AI_API_KEY no configurada"
          : "DEEPSEEK_API_KEY / AI_API_KEY no configurada",
      );
      err.status = 503;
      err.code = "AI_KEY_MISSING";
      throw err;
    };
    return { chat: missing, chatComplete: missing, provider: aiProvider, model: aiModel, ready: false };
  }

  // Con billing, pacing leve; con failover externo preferí pocos retries (aiRetries).
  const pace = createRateGate(aiProvider === "google" ? 400 : 0);
  const retries = Number.isFinite(aiRetries)
    ? aiRetries
    : aiProvider === "google"
      ? 2
      : 1;

  async function chatOnce({ system, messages, maxTokens }) {
    const tokens = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : aiMaxTokens;
    await pace();
    return withRetry(
      async () => {
        if (aiProvider === "anthropic") {
          return chatAnthropic({
            baseUrl: aiBaseUrl,
            apiKey: aiApiKey,
            model: aiModel,
            maxTokens: tokens,
            system,
            messages,
            timeoutMs: 120_000,
          });
        }
        return chatOpenAICompatible({
          baseUrl: aiBaseUrl,
          apiKey: aiApiKey,
          model: aiModel,
          maxTokens: tokens,
          system,
          messages,
          timeoutMs: 120_000,
          providerLabel: aiProvider === "google" ? "google" : aiProvider === "deepseek" ? "deepseek" : "openai-compatible",
        });
      },
      { retries },
    );
  }

  return {
    provider: aiProvider,
    model: aiModel,
    ready: true,
    chat: chatOnce,
    async chatComplete({
      system,
      messages,
      log,
      maxTokens,
      maxContinuations,
      continuePrompt,
      wallMs,
    } = {}) {
      const bound = (args) => chatOnce({ ...args, maxTokens });
      return runChatComplete(bound, {
        system,
        messages,
        maxContinuations: Number.isFinite(maxContinuations)
          ? maxContinuations
          : Number.isFinite(aiMaxContinuations)
            ? aiMaxContinuations
            : 3,
        continuePrompt,
        log,
        wallMs,
      });
    },
  };
}

/** Errores donde conviene pasar al fallback (cuota, red, 5xx). */
export function isFailoverError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status === 429 || status === 402 || status === 503 || status === 502 || status === 504) return true;
  if (status >= 500 && status < 600) return true;
  if (err.code === "AI_KEY_MISSING") return true;
  if (err.name === "AbortError") return true;
  const msg = String(err.message || "");
  if (/quota|resource.?exhausted|rate.?limit|billing|insufficient|tokens?|capacity|unavailable|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)) {
    return true;
  }
  // Modelos deprecados / no disponibles para la cuenta
  if (status === 404 && /no longer available|not found|NOT_FOUND/i.test(msg)) return true;
  return false;
}

/**
 * Primary → fallback con sticky: tras el primer failover, las siguientes
 * llamadas de este proceso usan el fallback (evita 10×429 en import híbrido).
 */
export function createFailoverAIProvider(primary, fallback, { log } = {}) {
  let stickyFallback = false;
  let lastFailover = null;

  const chain = () => {
    const list = [];
    if (stickyFallback) {
      if (fallback?.ready) list.push(fallback);
      if (primary?.ready) list.push(primary);
    } else {
      if (primary?.ready) list.push(primary);
      if (fallback?.ready) list.push(fallback);
    }
    return list;
  };

  async function run(method, args) {
    const providers = chain();
    if (!providers.length) {
      const err = new Error("Ningún proveedor AI configurado (GEMINI_API_KEY + DEEPSEEK_API_KEY)");
      err.status = 503;
      err.code = "AI_KEY_MISSING";
      throw err;
    }

    let lastErr;
    for (let i = 0; i < providers.length; i++) {
      const p = providers[i];
      try {
        const result = await p[method](args);
        return result;
      } catch (e) {
        lastErr = e;
        const hasNext = i < providers.length - 1;
        if (hasNext && isFailoverError(e)) {
          stickyFallback = true;
          lastFailover = {
            at: new Date().toISOString(),
            from: p.provider,
            to: providers[i + 1].provider,
            status: e.status || e.statusCode || null,
            message: e.message,
          };
          (args?.log || log)?.warn?.(
            {
              from: p.provider,
              to: providers[i + 1].provider,
              status: lastFailover.status,
              err: e.message,
            },
            "AI failover → proveedor secundario",
          );
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  const active = () => (stickyFallback && fallback?.ready ? fallback : primary?.ready ? primary : fallback);

  return {
    provider: active()?.provider || primary?.provider || "none",
    model: active()?.model || primary?.model,
    primary: { provider: primary?.provider, model: primary?.model, ready: !!primary?.ready },
    fallback: { provider: fallback?.provider, model: fallback?.model, ready: !!fallback?.ready },
    get stickyFallback() {
      return stickyFallback;
    },
    get lastFailover() {
      return lastFailover;
    },
    chat: (args) => run("chat", args),
    chatComplete: (args) => run("chatComplete", args),
  };
}

/** Google (flash-lite) primario + DeepSeek fallback, según config de app. */
export function createAppAIProvider(config, { log } = {}) {
  const primary = createAIProvider({
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    aiMaxTokens: config.aiMaxTokens,
    aiMaxContinuations: config.aiMaxContinuations,
    // Pocos retries: si hay cuota/429, fallamos rápido al fallback.
    aiRetries: config.aiPrimaryRetries ?? 1,
  });

  const fb = config.aiFallback;
  const fallback = fb?.aiApiKey || fb?.provider
    ? createAIProvider({
        aiProvider: fb.provider || "deepseek",
        aiModel: fb.model,
        aiBaseUrl: fb.baseUrl,
        aiApiKey: fb.aiApiKey || "",
        aiMaxTokens: config.aiMaxTokens,
        aiMaxContinuations: config.aiMaxContinuations,
        aiRetries: config.aiFallbackRetries ?? 2,
      })
    : { ready: false, provider: "deepseek", model: "deepseek-chat", chat: null, chatComplete: null };

  if (!primary.ready && !fallback.ready) {
    return createAIProvider({ aiProvider: config.aiProvider, aiApiKey: "" });
  }
  if (primary.ready && !fallback.ready) return primary;
  if (!primary.ready && fallback.ready) return fallback;
  return createFailoverAIProvider(primary, fallback, { log });
}
