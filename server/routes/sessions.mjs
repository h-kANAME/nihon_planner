import { uid } from "../db.mjs";
import { sendError, parseJson } from "../helpers.mjs";
import { buildTripContext, systemPromptFor, COMPACT_PROMPT } from "../prompts.mjs";
import { createAIProvider } from "../ai/provider.mjs";
import { buildAiConfig } from "../config.mjs";

const SESSION_AI_PROVIDERS = new Set(["deepseek", "google"]);

/** @returns {'deepseek'|'google'|null} null = valor inválido explícito */
function parseSessionAiProvider(raw) {
  const p = String(raw ?? "").toLowerCase().trim();
  if (!p) return "deepseek";
  if (p === "gemini") return "google";
  if (SESSION_AI_PROVIDERS.has(p)) return p;
  return null;
}

function sessionAiProvider(session) {
  return parseSessionAiProvider(session?.ai_provider) || "deepseek";
}

function aiForSession(session) {
  const provider = sessionAiProvider(session);
  return createAIProvider(buildAiConfig(provider));
}

function serializeSession(db, s) {
  return {
    id: s.id,
    name: s.name,
    mode: s.mode,
    ai_provider: sessionAiProvider(s),
    message_count: messageCount(db, s.id),
    updated_at: s.updated_at,
    created_at: s.created_at,
    has_summary: !!s.summary,
  };
}

function messageCount(db, sessionId) {
  return db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE session_id = ?").get(sessionId).n;
}

function listMessages(db, sessionId, { excludeCompacted = false } = {}) {
  const rows = db
    .prepare("SELECT * FROM ai_messages WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);
  return rows
    .map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      meta: parseJson(r.meta),
      created_at: r.created_at,
    }))
    .filter((m) => !(excludeCompacted && m.meta?.compacted));
}

async function maybeCompact(db, sessionAi, session, config, log) {
  const threshold = config.compactThreshold;
  const all = listMessages(db, session.id);
  if (all.length <= threshold) return session;

  const keep = 10;
  const toCompact = all.slice(0, Math.max(0, all.length - keep)).filter((m) => !m.meta?.compacted);
  if (toCompact.length === 0) return session;

  log.info({ sessionId: session.id, count: toCompact.length }, "Compactando memoria de sesión");

  const transcript = toCompact.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  let summaryText = session.summary || "";
  try {
    const result = await sessionAi.chat({
      system: COMPACT_PROMPT,
      messages: [{ role: "user", content: transcript }],
    });
    summaryText = [session.summary, result.content].filter(Boolean).join("\n\n").slice(0, 4000);
  } catch (e) {
    log.warn({ err: e.message }, "Compactación falló; se continúa sin resumir");
    return session;
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE ai_sessions SET summary = ?, updated_at = datetime('now') WHERE id = ?").run(
      summaryText,
      session.id,
    );
    const upd = db.prepare("UPDATE ai_messages SET meta = ? WHERE id = ?");
    for (const m of toCompact) {
      upd.run(JSON.stringify({ ...m.meta, compacted: true }), m.id);
    }
  });
  tx();

  return db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(session.id);
}

function contextMessages(db, session) {
  const all = listMessages(db, session.id);
  const active = all.filter((m) => !m.meta?.compacted);
  const last10 = active.slice(-10);
  return last10.map((m) => ({ role: m.role, content: m.content }));
}

export async function sessionsRoutes(app, { db, ai: _appAi, config }) {
  app.get("/api/v1/sessions", async () => {
    const rows = db.prepare("SELECT * FROM ai_sessions ORDER BY updated_at DESC").all();
    return rows.map((s) => serializeSession(db, s));
  });

  app.post("/api/v1/sessions", async (request, reply) => {
    const body = request.body || {};
    const mode = body.mode === "consultar" ? "consultar" : "planificar";
    const name =
      String(body.name || "").trim().slice(0, 80) ||
      `Sesión · ${new Date().toLocaleDateString("es-AR")}`;
    const aiProvider = parseSessionAiProvider(body.ai_provider);
    if (aiProvider == null) {
      return sendError(reply, 400, "VALIDATION", "ai_provider debe ser deepseek o google");
    }
    const id = uid();
    db.prepare("INSERT INTO ai_sessions (id, name, mode, ai_provider) VALUES (?, ?, ?, ?)").run(
      id,
      name,
      mode,
      aiProvider,
    );
    const s = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(id);
    return reply.code(201).send(serializeSession(db, s));
  });

  app.patch("/api/v1/sessions/:id", async (request, reply) => {
    const body = request.body || {};
    const s0 = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(request.params.id);
    if (!s0) return sendError(reply, 404, "NOT_FOUND", "Sesión no encontrada");

    let name = s0.name;
    if (body.name !== undefined) {
      name = String(body.name || "").trim();
      if (!name) return sendError(reply, 400, "VALIDATION", "name requerido");
      if (name.length > 80) {
        return sendError(reply, 400, "VALIDATION", "name no puede superar 80 caracteres");
      }
    }

    let aiProvider = sessionAiProvider(s0);
    if (body.ai_provider !== undefined) {
      aiProvider = parseSessionAiProvider(body.ai_provider);
      if (aiProvider == null) {
        return sendError(reply, 400, "VALIDATION", "ai_provider debe ser deepseek o google");
      }
    }

    if (body.name === undefined && body.ai_provider === undefined) {
      return sendError(reply, 400, "VALIDATION", "name o ai_provider requerido");
    }

    db.prepare(
      "UPDATE ai_sessions SET name = ?, ai_provider = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(name, aiProvider, request.params.id);

    const s = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(request.params.id);
    return serializeSession(db, s);
  });

  app.delete("/api/v1/sessions/:id", async (request, reply) => {
    const info = db.prepare("DELETE FROM ai_sessions WHERE id = ?").run(request.params.id);
    if (!info.changes) return sendError(reply, 404, "NOT_FOUND", "Sesión no encontrada");
    return { ok: true };
  });

  app.get("/api/v1/sessions/:id/messages", async (request, reply) => {
    const s = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(request.params.id);
    if (!s) return sendError(reply, 404, "NOT_FOUND", "Sesión no encontrada");
    return {
      session: {
        id: s.id,
        name: s.name,
        mode: s.mode,
        ai_provider: sessionAiProvider(s),
        summary: s.summary,
        updated_at: s.updated_at,
      },
      messages: listMessages(db, s.id),
    };
  });

  app.post("/api/v1/sessions/:id/chat", async (request, reply) => {
    const s = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(request.params.id);
    if (!s) return sendError(reply, 404, "NOT_FOUND", "Sesión no encontrada");

    const content = (request.body?.content || "").trim();
    if (!content) return sendError(reply, 400, "VALIDATION", "content requerido");

    db.prepare(
      `INSERT INTO ai_messages (session_id, role, content, meta) VALUES (?, 'user', ?, '{}')`,
    ).run(s.id, content);
    db.prepare("UPDATE ai_sessions SET updated_at = datetime('now') WHERE id = ?").run(s.id);

    const sessionAi = aiForSession(s);
    let session = await maybeCompact(db, sessionAi, s, config, request.log);

    const tripJson = buildTripContext(db);
    const system = systemPromptFor(session.mode, tripJson, session.summary);
    const messages = contextMessages(db, session);
    const preferred = sessionAiProvider(session);

    let result;
    try {
      request.log.info(
        {
          sessionId: session.id,
          mode: session.mode,
          msgCount: messages.length,
          hasSummary: !!session.summary,
          provider: preferred,
          model: sessionAi.model,
        },
        "Llamada AI (sesión)",
      );
      result = await sessionAi.chatComplete({ system, messages, log: request.log });
    } catch (e) {
      request.log.error({ err: e.message, status: e.status, provider: preferred }, "Upstream AI error");
      return sendError(reply, 502, "AI_UPSTREAM", e.message || "Error del proveedor AI");
    }

    const meta = {
      model: result.usage?.model || sessionAi.model,
      tokens_in: result.usage?.tokens_in,
      tokens_out: result.usage?.tokens_out,
      provider: result.usage?.provider || preferred,
      stop_reason: result.stop_reason,
      parts: result.parts,
      continued: !!result.continued,
    };

    const info = db
      .prepare(`INSERT INTO ai_messages (session_id, role, content, meta) VALUES (?, 'assistant', ?, ?)`)
      .run(session.id, result.content || "(sin respuesta)", JSON.stringify(meta));
    db.prepare("UPDATE ai_sessions SET updated_at = datetime('now') WHERE id = ?").run(session.id);

    const assistantMsg = db.prepare("SELECT * FROM ai_messages WHERE id = ?").get(info.lastInsertRowid);
    session = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(session.id);

    return {
      message: {
        id: assistantMsg.id,
        role: assistantMsg.role,
        content: assistantMsg.content,
        meta: parseJson(assistantMsg.meta),
        created_at: assistantMsg.created_at,
      },
      session: serializeSession(db, session),
    };
  });

  app.post("/api/v1/sessions/:id/reset", async (request, reply) => {
    const s = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(request.params.id);
    if (!s) return sendError(reply, 404, "NOT_FOUND", "Sesión no encontrada");
    db.prepare("DELETE FROM ai_messages WHERE session_id = ?").run(s.id);
    db.prepare("UPDATE ai_sessions SET summary = NULL, updated_at = datetime('now') WHERE id = ?").run(s.id);
    return { ok: true };
  });

  app.get("/api/v1/sessions/:id/export", async (request, reply) => {
    const s = db.prepare("SELECT * FROM ai_sessions WHERE id = ?").get(request.params.id);
    if (!s) return sendError(reply, 404, "NOT_FOUND", "Sesión no encontrada");
    const messages = listMessages(db, s.id).map((m) => ({ role: m.role, content: m.content }));
    return {
      herramienta: "nihon-planner",
      version: 1,
      exportado: new Date().toISOString(),
      tipo: s.mode === "consultar" ? "consulta" : "planificacion",
      sesion: {
        id: s.id,
        nombre: s.name,
        ai_provider: sessionAiProvider(s),
        mensajes: messages,
      },
    };
  });

  app.get("/api/v1/search", async (request, reply) => {
    const q = (request.query?.q || "").trim();
    if (!q) return sendError(reply, 400, "VALIDATION", "q requerido");
    const rows = db
      .prepare(
        `SELECT m.session_id, snippet(ai_messages_fts, 0, '[', ']', '…', 12) AS snippet, m.created_at
         FROM ai_messages_fts
         JOIN ai_messages m ON m.id = ai_messages_fts.rowid
         WHERE ai_messages_fts MATCH ?
         ORDER BY m.id DESC
         LIMIT 50`,
      )
      .all(q);
    return rows;
  });
}
