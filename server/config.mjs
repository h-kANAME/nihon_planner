function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Falta variable de entorno: ${name}`);
  }
  return v;
}

function parseEmails(raw) {
  return (raw || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Normaliza alias de proveedor AI (`gemini` → `google`). */
export function normalizeAiProvider(name) {
  const p = String(name || "deepseek").toLowerCase().trim();
  if (p === "gemini") return "google";
  return p || "deepseek";
}

/**
 * Defaults de modelo / base URL por proveedor.
 * Google usa el endpoint OpenAI-compatible de Gemini API.
 */
export function aiProviderDefaults(provider) {
  const p = normalizeAiProvider(provider);
  if (p === "anthropic") {
    return { provider: p, model: "claude-sonnet-4-6", baseUrl: "https://api.anthropic.com" };
  }
  if (p === "google") {
    return {
      provider: p,
      model: "gemini-flash-lite-latest",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    };
  }
  return { provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" };
}

/**
 * Resuelve la API key según el proveedor pedido.
 * Keys dedicadas siempre ganan; así Google + DeepSeek conviven para failover.
 */
export function resolveAiApiKey(provider, env = process.env) {
  const p = normalizeAiProvider(provider);
  if (p === "anthropic") {
    return env.ANTHROPIC_API_KEY || "";
  }
  if (p === "google") {
    return env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || "";
  }
  return env.DEEPSEEK_API_KEY || env.AI_API_KEY || "";
}

/** Perfil AI completo (útil para benches multi-proveedor). Ignora AI_MODEL/BASE_URL compartidos. */
export function buildAiConfig(provider, env = process.env, overrides = {}) {
  const defaults = aiProviderDefaults(provider);
  const p = normalizeAiProvider(overrides.aiProvider || defaults.provider);
  return {
    aiProvider: p,
    aiModel: overrides.aiModel || defaults.model,
    aiBaseUrl: overrides.aiBaseUrl || defaults.baseUrl,
    aiApiKey: overrides.aiApiKey || resolveAiApiKey(p, env),
    aiMaxTokens: Number(overrides.aiMaxTokens ?? env.AI_MAX_TOKENS ?? 2048),
    aiMaxContinuations: Number(overrides.aiMaxContinuations ?? env.AI_MAX_CONTINUATIONS ?? 3),
  };
}

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";

  // Default: Google flash-lite; DeepSeek siempre como fallback si hay key.
  const aiProvider = normalizeAiProvider(process.env.AI_PROVIDER || "google");
  const aiDefaults = aiProviderDefaults(aiProvider);
  const fallbackProvider = normalizeAiProvider(
    process.env.AI_FALLBACK_PROVIDER || (aiProvider === "deepseek" ? "google" : "deepseek"),
  );

  // Evitar primary === fallback
  const resolvedFallback =
    fallbackProvider === aiProvider
      ? normalizeAiProvider(aiProvider === "google" ? "deepseek" : "google")
      : fallbackProvider;
  const resolvedFallbackDefaults = aiProviderDefaults(resolvedFallback);

  return {
    port: Number(process.env.PORT || 8787),
    host: process.env.HOST || "0.0.0.0",
    nodeEnv,
    isProd,
    dbPath: process.env.DB_PATH || (process.env.NODE_ENV === "production" ? "/app/data/nihon.db" : "./data/nihon.db"),
    frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    serveStatic: process.env.SERVE_STATIC === "true",
    staticDir: process.env.STATIC_DIR || pathResolve("dist"),

    googleClientId: required("GOOGLE_CLIENT_ID", isProd ? undefined : "dev-client-id.apps.googleusercontent.com"),
    allowedEmails: parseEmails(process.env.ALLOWED_EMAILS || ""),
    sessionSecret: required("SESSION_SECRET", isProd ? undefined : "dev-session-secret-change-me-32chars-min"),
    cookieSecure: process.env.COOKIE_SECURE === "true" || (isProd && process.env.COOKIE_SECURE !== "false"),
    sessionDays: 30,

    aiProvider,
    aiModel: process.env.AI_MODEL || aiDefaults.model,
    aiBaseUrl: process.env.AI_BASE_URL || aiDefaults.baseUrl,
    aiApiKey: resolveAiApiKey(aiProvider),
    aiMaxTokens: Number(process.env.AI_MAX_TOKENS || 2048),
    aiMaxContinuations: Number(process.env.AI_MAX_CONTINUATIONS || 3),
    aiPrimaryRetries: Number(process.env.AI_PRIMARY_RETRIES || 1),
    aiFallbackRetries: Number(process.env.AI_FALLBACK_RETRIES || 2),

    aiFallback: {
      provider: resolvedFallback,
      model: process.env.AI_FALLBACK_MODEL || resolvedFallbackDefaults.model,
      baseUrl: process.env.AI_FALLBACK_BASE_URL || resolvedFallbackDefaults.baseUrl,
      aiApiKey: resolveAiApiKey(resolvedFallback),
    },

    compactThreshold: Number(process.env.COMPACT_THRESHOLD || 40),
    ratesCacheMinutes: 30,
  };
}

function pathResolve(rel) {
  // resolved at runtime relative to cwd (container /app)
  return rel;
}
