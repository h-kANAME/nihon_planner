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
import { validateItineraryJson } from "../itinerary/schema.mjs";
import { replaceItinerary, itineraryToCanonical } from "../itinerary/store.mjs";
import { createImportSnapshot } from "../itinerary/snapshot.mjs";

/** Marcador del archivo de viaje (§9.4). v1 = dump sin marcador. */
const TRIP_EXPORT_VERSION = 2;

/** Body limit del restore: el dump embebe todos los mensajes de todas las sesiones. */
const IMPORT_BODY_LIMIT = 32 * 1024 * 1024;

/** Backup canónico de un viaje sin días: es válido y vacía el itinerario al restaurar. */
function canonicalEmptyItinerary(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.days) || raw.days.length) return null;
  const anchor =
    typeof raw.anchor_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.anchor_date)
      ? raw.anchor_date
      : null;
  return { title: String(raw.title || "").slice(0, 200), anchor_date: anchor, days: [] };
}

/** `ai_provider` del schema; desconocido → null (no pisar el valor guardado). */
function normalizeAiProvider(raw) {
  const p = String(raw ?? "").toLowerCase().trim();
  if (p === "gemini") return "google";
  return p === "google" || p === "deepseek" ? p : null;
}

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

/** Validación estricta previa al DELETE: un gasto malformado aborta el restore. */
function validateExpensesInput(list) {
  for (const e of list) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return "Gasto inválido";
    const n = normalizeExpenseInput(e);
    if (!n.description) return "Gasto sin descripción";
    if (!EXPENSE_CATEGORIES.includes(n.category)) return `Categoría inválida: ${n.category}`;
    if (n.amount != null && !(n.amount > 0)) return `Monto inválido en «${n.description}»`;
  }
  return null;
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
  const provider = normalizeAiProvider(sesion.ai_provider ?? sesion.aiProvider);
  db.prepare(
    `INSERT INTO ai_sessions (id, name, mode, ai_provider)
     VALUES (?, ?, ?, COALESCE(?, 'deepseek'))
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, mode=excluded.mode,
       ai_provider=COALESCE(?, ai_sessions.ai_provider), updated_at=datetime('now')`,
  ).run(id, name, mode === "consultar" ? "consultar" : "planificar", provider, provider);

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

export async function importRoutes(app, { db, config }) {
  app.post("/api/v1/import", { bodyLimit: IMPORT_BODY_LIMIT }, async (request, reply) => {
    const body = request.body || {};
    const summary = {
      expenses: 0,
      plan_items: 0,
      sessions: 0,
      rates: false,
      itinerary: false,
      days: 0,
    };

    // Validar itinerario antes de tocar datos (§9.4). Un viaje sin días es un
    // backup válido: se restaura como itinerario vacío.
    const rawItinerary = body["jp:itinerary"] ?? body.itinerary;
    let itineraryData = null;
    if (rawItinerary != null) {
      itineraryData = canonicalEmptyItinerary(rawItinerary);
      if (!itineraryData) {
        const validated = validateItineraryJson(rawItinerary, { trustLocations: true });
        if (!validated.ok) {
          return sendError(reply, 400, "IMPORT_FAILED", validated.error);
        }
        itineraryData = validated.data;
      }
    }

    // `jp:expenses` presente → restore: reemplaza la colección. `jp:logistics` solo
    // se aplica si el archivo es viejo (v1 sin jp:expenses), porque es derivado.
    const expensesPayload = body["jp:expenses"] ?? body.expenses;
    const replacesExpenses = Array.isArray(expensesPayload);
    if (replacesExpenses) {
      const err = validateExpensesInput(expensesPayload);
      if (err) return sendError(reply, 400, "IMPORT_FAILED", err);
    }

    // Cotizaciones: se validan antes del DELETE, como los gastos.
    const ratesPayload = body["jp:rates"] ?? body.rates;
    let nextRates = null;
    if (
      ratesPayload &&
      typeof ratesPayload === "object" &&
      ("usdArs" in ratesPayload || "usdJpy" in ratesPayload)
    ) {
      const merged = { ...getRates(db), ...ratesPayload };
      if (!(Number(merged.usdArs) > 0) || !(Number(merged.usdJpy) > 0)) {
        return sendError(reply, 400, "IMPORT_FAILED", "Cotizaciones inválidas");
      }
      nextRates = {
        ...merged,
        usdArs: Number(merged.usdArs),
        usdJpy: Number(merged.usdJpy),
        updatedAt: merged.updatedAt || new Date().toISOString(),
      };
    }

    // Snapshot fail-closed antes de cualquier borrado (§9.3). Fuera de transacción.
    if (replacesExpenses || itineraryData) {
      try {
        await createImportSnapshot(db, config?.dbPath);
      } catch (e) {
        request.log.error({ err: e.message, code: e.code }, "Snapshot pre-import falló");
        return sendError(
          reply,
          e.status || 500,
          e.code || "SNAPSHOT_FAILED",
          e.message || "No se pudo crear snapshot antes del import",
        );
      }
    }

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

        if (replacesExpenses) {
          db.prepare("DELETE FROM expenses").run();
          for (const e of expensesPayload) {
            if (upsertExpense(db, e)) summary.expenses += 1;
          }
        } else {
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
        }

        if (nextRates) {
          setRates(db, nextRates);
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
                ai_provider: s.ai_provider,
              },
              s.mode,
            );
            summary.sessions += 1;
          }
        }

        if (itineraryData) {
          replaceItinerary(db, itineraryData, { source_filename: "dump" });
          summary.itinerary = true;
          summary.days = itineraryData.days.length;
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
      return { id: s.id, name: s.name, mode: s.mode, ai_provider: s.ai_provider, messages };
    });
    return {
      herramienta: "nihon-planner",
      version: TRIP_EXPORT_VERSION,
      exportado: new Date().toISOString(),
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
      "jp:itinerary": itineraryToCanonical(db),
    };
  });
}
