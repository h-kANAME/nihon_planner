import { uid } from "../db.mjs";
import {
  planItemFromFront,
  setRates,
  getRates,
  sendError,
  logisticsFromItems,
} from "../helpers.mjs";

function upsertExpense(db, e) {
  const id = e.id || uid();
  const description = (e.description ?? e.desc ?? "").trim();
  const amount = Number(e.amount);
  if (!description || !(amount > 0)) return null;
  db.prepare(
    `INSERT INTO expenses (id, description, amount, currency, category, spent_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       description=excluded.description,
       amount=excluded.amount,
       currency=excluded.currency,
       category=excluded.category,
       spent_at=excluded.spent_at`,
  ).run(
    id,
    description,
    amount,
    e.currency || "JPY",
    e.category || "otros",
    e.spent_at || e.date || new Date().toISOString(),
  );
  return id;
}

function upsertPlanItem(db, type, item) {
  const mapped = planItemFromFront(type, item);
  const id = item.id || uid();
  db.prepare(
    `INSERT INTO plan_items (id, type, title, done, datetime_start, datetime_end, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type,
       title=excluded.title,
       done=excluded.done,
       datetime_start=excluded.datetime_start,
       datetime_end=excluded.datetime_end,
       meta=excluded.meta,
       updated_at=datetime('now')`,
  ).run(
    id,
    mapped.type,
    mapped.title,
    mapped.done ? 1 : 0,
    mapped.datetime_start,
    mapped.datetime_end,
    JSON.stringify(mapped.meta),
  );
  return id;
}

function upsertSessionWithMessages(db, sesion, modeHint) {
  const id = sesion.id || uid();
  const name = sesion.nombre || sesion.name || `Importada · ${id.slice(0, 6)}`;
  const mode = modeHint || sesion.mode || "planificar";
  db.prepare(
    `INSERT INTO ai_sessions (id, name, mode)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, mode=excluded.mode, updated_at=datetime('now')`,
  ).run(id, name, mode === "consultar" ? "consultar" : "planificar");

  const mensajes = sesion.mensajes || sesion.messages || [];
  // Idempotente: si ya hay mensajes, no duplicar por re-import
  const existing = db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE session_id = ?").get(id).n;
  if (existing === 0 && mensajes.length) {
    const ins = db.prepare(
      `INSERT INTO ai_messages (session_id, role, content, meta) VALUES (?, ?, ?, '{}')`,
    );
    for (const m of mensajes) {
      if (!m?.role || !m?.content) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      ins.run(id, m.role, m.content);
    }
  }
  return id;
}

export async function importRoutes(app, { db }) {
  app.post("/api/v1/import", async (request, reply) => {
    const body = request.body || {};
    const summary = { expenses: 0, plan_items: 0, sessions: 0, rates: false };

    try {
      const tx = db.transaction(() => {
        // Formato artifact export directo
        if (body.herramienta === "nihon-planner" || body.tipo) {
          if (body.sesion) {
            upsertSessionWithMessages(db, body.sesion, body.tipo === "consulta" ? "consultar" : "planificar");
            summary.sessions += 1;
          }
          if (Array.isArray(body.sesiones)) {
            for (const s of body.sesiones) {
              upsertSessionWithMessages(db, s, "planificar");
              summary.sessions += 1;
            }
          }
          if (Array.isArray(body.mensajes) && body.tipo === "consulta") {
            upsertSessionWithMessages(
              db,
              { id: body.id || uid(), nombre: "Consulta importada", mensajes: body.mensajes },
              "consultar",
            );
            summary.sessions += 1;
          }
        }

        // Dump localStorage keys
        const expenses = body["jp:expenses"] ?? body.expenses;
        if (Array.isArray(expenses)) {
          for (const e of expenses) {
            if (upsertExpense(db, e)) summary.expenses += 1;
          }
        }

        const logistics = body["jp:logistics"] ?? body.logistics;
        if (logistics && typeof logistics === "object") {
          for (const f of logistics.flights || []) {
            upsertPlanItem(db, "flight", f);
            summary.plan_items += 1;
          }
          for (const s of logistics.stays || []) {
            upsertPlanItem(db, "stay", s);
            summary.plan_items += 1;
          }
          for (const b of logistics.bookings || []) {
            upsertPlanItem(db, "booking", b);
            summary.plan_items += 1;
          }
          for (const d of logistics.docs || []) {
            upsertPlanItem(db, "doc", d);
            summary.plan_items += 1;
          }
        }

        const rates = body["jp:rates"] ?? body.rates;
        if (rates && typeof rates === "object" && (rates.usdArs || rates.usdJpy)) {
          setRates(db, {
            ...getRates(db),
            ...rates,
            updatedAt: rates.updatedAt || new Date().toISOString(),
          });
          summary.rates = true;
        }

        const sessions = body["jp:sessions"] ?? body.sessions;
        if (Array.isArray(sessions)) {
          for (const s of sessions) {
            upsertSessionWithMessages(
              db,
              {
                id: s.id,
                nombre: s.name || s.nombre,
                mensajes: s.messages || s.mensajes,
                mode: s.mode || "planificar",
              },
              s.mode,
            );
            summary.sessions += 1;
          }
        }
      });
      tx();

      return { ok: true, imported: summary };
    } catch (e) {
      request.log.error({ err: e.message }, "Import falló");
      return sendError(reply, 400, "IMPORT_FAILED", e.message);
    }
  });

  app.get("/api/v1/export/dump", async () => {
    const expenses = db.prepare("SELECT * FROM expenses ORDER BY spent_at DESC").all();
    const items = db.prepare("SELECT * FROM plan_items").all();
    const sessions = db.prepare("SELECT * FROM ai_sessions ORDER BY updated_at DESC").all();
    const dumpSessions = sessions.map((s) => {
      const messages = db
        .prepare("SELECT role, content FROM ai_messages WHERE session_id = ? ORDER BY id")
        .all(s.id);
      return { id: s.id, name: s.name, mode: s.mode, messages };
    });
    return {
      "jp:expenses": expenses.map((e) => ({
        id: e.id,
        desc: e.description,
        amount: e.amount,
        currency: e.currency,
        category: e.category,
        date: e.spent_at?.slice(0, 10),
      })),
      "jp:logistics": logisticsFromItems(items),
      "jp:rates": getRates(db),
      "jp:sessions": dumpSessions,
    };
  });
}
