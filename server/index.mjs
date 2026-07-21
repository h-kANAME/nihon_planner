import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.mjs";
import { openDb, migrate } from "./db.mjs";
import { authHook } from "./auth/session.mjs";
import { createAppAIProvider } from "./ai/provider.mjs";
import { seedDefaultDocs, setRates, getRates } from "./helpers.mjs";
import { authRoutes } from "./routes/auth.mjs";
import { expensesRoutes } from "./routes/expenses.mjs";
import { planRoutes } from "./routes/plan.mjs";
import { itineraryRoutes } from "./routes/itinerary.mjs";
import { ratesRoutes } from "./routes/rates.mjs";
import { sessionsRoutes } from "./routes/sessions.mjs";
import { importRoutes } from "./routes/import.mjs";
import { adminRoutes } from "./routes/admin.mjs";
import { uid } from "./db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  migrate(db);
  seedDefaultDocs(db, uid);

  if (!getRates(db).updatedAt) {
    setRates(db, { usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null });
  }

  const ai = createAppAIProvider(config);

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || "info" },
    requestIdHeader: "x-request-id",
    genReqId: () => uid(),
  });

  app.decorate("db", db);
  app.decorate("config", config);
  app.decorate("ai", ai);

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = config.frontendOrigin;
      if (!origin || origin === allowed || allowed === "*") return cb(null, true);
      // en prod sirve static desde el mismo origin
      if (config.serveStatic) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });

  await app.register(cookie);

  app.get("/health", async () => ({
    ok: true,
    provider: ai.provider || config.aiProvider,
    model: ai.model || config.aiModel,
    primary: ai.primary || { provider: config.aiProvider, model: config.aiModel, ready: !!config.aiApiKey },
    fallback: ai.fallback || {
      provider: config.aiFallback?.provider,
      model: config.aiFallback?.model,
      ready: !!config.aiFallback?.aiApiKey,
    },
    stickyFallback: !!ai.stickyFallback,
    lastFailover: ai.lastFailover || null,
  }));
  app.get("/api/v1/health", async () => ({ ok: true }));

  // Auth hook para /api/*
  app.addHook("preHandler", authHook(config));
  // /auth/me y /auth/logout necesitan estar autenticados parcialmente — el hook
  // deja pasar solo /auth/google como público entre auth; /me y /logout manejan 401 ellos.

  // Hacer públicos logout y me (me responde 401 si no hay cookie)
  // Ajuste: authHook ya bloquea todo /api excepto google y health.
  // Necesitamos que /auth/me y /auth/logout pasen sin cookie.
  // Re-register a softer check — override in authHook.

  await authRoutes(app, { config });
  await expensesRoutes(app, { db });
  await planRoutes(app, { db });
  await itineraryRoutes(app, { db, ai, config });
  await ratesRoutes(app, { db, config });
  await sessionsRoutes(app, { db, ai, config });
  await importRoutes(app, { db });
  await adminRoutes(app, { config, db });

  if (config.serveStatic) {
    const dist = path.isAbsolute(config.staticDir)
      ? config.staticDir
      : path.join(path.dirname(__dirname), config.staticDir);
    if (fs.existsSync(dist)) {
      await app.register(fastifyStatic, { root: dist, wildcard: false });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith("/api/")) {
          return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
        }
        return reply.sendFile("index.html");
      });
    } else {
      app.log.warn({ dist }, "SERVE_STATIC=true pero dist no existe");
    }
  }

  await app.listen({ port: config.port, host: config.host });
  const fb = config.aiFallback;
  app.log.info(
    `Nihon API en http://${config.host}:${config.port} · AI=${config.aiProvider}/${config.aiModel}` +
      (fb?.aiApiKey ? ` · fallback=${fb.provider}/${fb.model}` : " · fallback=off"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
