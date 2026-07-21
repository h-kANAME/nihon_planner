import { uid } from "../db.mjs";
import {
  planItemFromFront,
  setRates,
  getRates,
  sendError,
  logisticsFromExpenses,
  categoryForKind,
  normalizeExpenseInput,
  EXPENSE_CATEGORIES,
} from "../helpers.mjs";

function upsertExpense(db, e) {
  const n = normalizeExpenseInput(e);
  if (!n.description) return null;
  if (n.amount != null && !(n.amount > 0)) return null;
  if (!EXPENSE_CATEGORIES.includes(n.category)) n.category = "otros";
  const id = e.id || uid();
  db.prepare(
    `INSERT INTO expenses (
       id, description, amount, currency, category, spent_at, done, kind, meta_json, datetime_start, datetime_end
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       description=excluded.description,
       amount=excluded.amount,
       currency=excluded.currency,
       category=excluded.category,
       spent_at=excluded.spent_at,
       done=excluded.done,
       kind=excluded.kind,
       meta_json=excluded.meta_json,
       datetime_start=excluded.datetime_start,
       datetime_end=excluded.datetime_end`,
  ).run(
    id,
    n.description,
    n.amount,
    n.currency,
    n.category,
    n.spent_at,
    n.done,
    n.kind,
    n.meta_json,
    n.datetime_start,
    n.datetime_end,
  );
  return id;
}

function upsertLogisticsAsExpense(db, type, item) {
  const mapped = planItemFromFront(type, item);
  return upsertExpense(db, {
    id: item.id,
    desc: mapped.title,
    amount: item.amount ?? null,
    currency: item.currency ?? null,
    category: categoryForKind(mapped.type),
    kind: mapped.type,
    done: mapped.done,
    date: mapped.datetime_start || new Date().toISOString(),
    datetime_start: mapped.datetime_start,
    datetime_end: mapped.datetime_end,
    meta: mapped.meta,
  });
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

        const expenses = body["jp:expenses"] ?? body.expenses;
        if (Array.isArray(expenses)) {
          for (const e of expenses) {
            if (upsertExpense(db, e)) summary.expenses += 1;
          }
        }

        const logistics = body["jp:logistics"] ?? body.logistics;
        if (logistics && typeof logistics === "object") {
          for (const f of logistics.flights || []) {
            if (upsertLogisticsAsExpense(db, "flight", f)) summary.plan_items += 1;
          }
          for (const s of logistics.stays || []) {
            if (upsertLogisticsAsExpense(db, "stay", s)) summary.plan_items += 1;
          }
          for (const b of logistics.bookings || []) {
            if (upsertLogisticsAsExpense(db, "booking", b)) summary.plan_items += 1;
          }
          for (const d of logistics.docs || []) {
            if (upsertLogisticsAsExpense(db, "doc", d)) summary.plan_items += 1;
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
    const logisticsRows = db
      .prepare("SELECT * FROM expenses WHERE kind IN ('flight','stay','booking','doc')")
      .all();
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
        done: !!e.done,
        kind: e.kind,
        meta: JSON.parse(e.meta_json || "{}"),
        datetime_start: e.datetime_start,
        datetime_end: e.datetime_end,
      })),
      "jp:logistics": logisticsFromExpenses(logisticsRows),
      "jp:rates": getRates(db),
      "jp:sessions": dumpSessions,
    };
  });
}
