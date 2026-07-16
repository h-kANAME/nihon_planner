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

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";

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

    aiProvider: (process.env.AI_PROVIDER || "deepseek").toLowerCase(),
    aiModel: process.env.AI_MODEL || (process.env.AI_PROVIDER === "anthropic" ? "claude-sonnet-4-6" : "deepseek-chat"),
    aiBaseUrl: process.env.AI_BASE_URL || (
      process.env.AI_PROVIDER === "anthropic"
        ? "https://api.anthropic.com"
        : "https://api.deepseek.com/v1"
    ),
    aiApiKey: process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY || "",
    aiMaxTokens: Number(process.env.AI_MAX_TOKENS || 2048),
    aiMaxContinuations: Number(process.env.AI_MAX_CONTINUATIONS || 3),
    compactThreshold: Number(process.env.COMPACT_THRESHOLD || 40),
    ratesCacheMinutes: 30,
  };
}

function pathResolve(rel) {
  // resolved at runtime relative to cwd (container /app)
  return rel;
}
