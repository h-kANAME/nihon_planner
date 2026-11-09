import { uid } from "../db.mjs";
import {
  mapExpense,
  expenseToFront,
  sendError,
  EXPENSE_CATEGORIES,
  normalizeExpenseInput,
  computeExpenseMoneyTotals,
  logisticsFromExpenses,
  LOGISTICS_KINDS,
} from "../helpers.mjs";
import { loadItinerary } from "../itinerary/store.mjs";
import { locationProgress } from "../../src/lib/locations.js";

/** Agregado global §6.2 / §8.3 — misma semántica que `locationProgress` por día. */
export function aggregateLocationProgress(days) {
  let total = 0;
  let resolved = 0;
  for (const day of days || []) {
    const p = locationProgress(day);
    total += p.total;
    resolved += p.resolved;
  }
  return { total, resolved, pending: total - resolved };
}

const INSERT_SQL = `INSERT INTO expenses (
  id, description, amount, currency, category, spent_at, done, kind, meta_json, datetime_start, datetime_end
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertExpense(db, id, n) {
  db.prepare(INSERT_SQL).run(
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
}

function validateNormalized(n) {
  if (!n.description) return "Descripción requerida";
  if (!EXPENSE_CATEGORIES.includes(n.category)) return "Categoría inválida";
  if (n.amount != null) {
    if (!(n.amount > 0)) return "Monto inválido";
    if (!["ARS", "USD", "JPY"].includes(n.currency)) return "Moneda inválida";
  }
  return null;
}

function nextItineraryDays(db) {
  try {
    const it = loadItinerary(db);
    const days = it.days || [];
    const anchor = it.meta?.anchor_date;
    let startIdx = 0;
    if (anchor) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const a = new Date(`${anchor}T00:00:00`);
      const diff = Math.floor((today - a) / 86400000);
      if (diff >= 0 && diff < days.length) startIdx = diff;
    }
    return {
      days: days.length,
      stops: days.reduce((n, d) => n + (d.stops?.length || 0), 0),
      title: it.meta?.title || "",
      anchor_date: anchor || null,
      locations: aggregateLocationProgress(days),
      nextDays: days.slice(startIdx, startIdx + 3).map((d) => ({
        day_number: d.day_number,
        title: d.title,
        stay_label: d.stay_label,
        base: d.base,
        stops: d.stops?.length || 0,
      })),
      corridor: buildCorridor(days),
      dayChips: days.map((d) => ({
        day_number: d.day_number,
        title: d.title,
        base: d.base || d.stay_label || "",
      })),
    };
  } catch {
    return {
      days: 0,
      stops: 0,
      title: "",
      anchor_date: null,
      locations: { total: 0, resolved: 0, pending: 0 },
      nextDays: [],
      corridor: [],
      dayChips: [],
    };
  }
}

function cityKey(day) {
  const raw = (day.base || day.stay_label || day.title || "").trim();
  if (!raw) return null;
  const first = raw.split(/[—(–,\-/]/)[0].trim();
  const cleaned = first
    .replace(/\(.*?\)/g, "")
    .replace(/check-?in|check-?out|noche|noches|estación|station/gi, "")
    .trim();
  if (!cleaned || /^d[ií]a\s*\d+/i.test(cleaned)) return null;
  return cleaned;
}

function buildCorridor(days) {
  const out = [];
  for (const d of days) {
    const city = cityKey(d);
    if (!city) continue;
    const last = out[out.length - 1];
    if (last && last.city.toLowerCase() === city.toLowerCase()) {
      last.dayNumbers.push(d.day_number);
    } else {
      out.push({ city, dayNumbers: [d.day_number] });
    }
  }
  return out;
}

export async function expensesRoutes(app, { db }) {
  app.get("/api/v1/expenses", async (request) => {
    const { category, from, to, format, kind, done } = request.query || {};
    let sql = "SELECT * FROM expenses WHERE 1=1";
    const params = [];
    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }
    if (kind) {
      sql += " AND kind = ?";
      params.push(kind);
    }
    if (done === "0" || done === "1") {
      sql += " AND done = ?";
      params.push(Number(done));
    }
    if (from) {
      sql += " AND spent_at >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND spent_at <= ?";
      params.push(to);
    }
    sql += " ORDER BY spent_at DESC";
    const rows = db.prepare(sql).all(...params);
    if (format === "front") return rows.map(expenseToFront);
    if (format === "logistics") return logisticsFromExpenses(rows.filter((r) => LOGISTICS_KINDS.has(r.kind)));
    return rows.map(mapExpense);
  });

  app.get("/api/v1/expenses/totals", async () => {
    const money = computeExpenseMoneyTotals(db);
    return money.totals;
  });

  app.get("/api/v1/expenses/dashboard", async () => {
    const money = computeExpenseMoneyTotals(db);
    const itinerary = nextItineraryDays(db);
    return { ...money, itinerary };
  });

  /** Sync completo (adapter storage) — antes de :id */
  app.put("/api/v1/expenses/sync", async (request, reply) => {
    const list = Array.isArray(request.body) ? request.body : request.body?.expenses;
    if (!Array.isArray(list)) return sendError(reply, 400, "VALIDATION", "Se espera un array");

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM expenses").run();
      for (const e of list) {
        const n = normalizeExpenseInput(e);
        const err = validateNormalized(n);
        if (err) continue;
        insertExpense(db, e.id || uid(), n);
      }
    });
    tx();
    const rows = db.prepare("SELECT * FROM expenses ORDER BY spent_at DESC").all();
    return rows.map(expenseToFront);
  });

  app.post("/api/v1/expenses", async (request, reply) => {
    const n = normalizeExpenseInput(request.body || {});
    const err = validateNormalized(n);
    if (err) return sendError(reply, 400, "VALIDATION", err);

    const id = request.body?.id || uid();
    insertExpense(db, id, n);
    const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
    return reply.code(201).send(mapExpense(row));
  });

  app.put("/api/v1/expenses/:id", async (request, reply) => {
    const existing = db.prepare("SELECT * FROM expenses WHERE id = ?").get(request.params.id);
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "Gasto no encontrado");

    const n = normalizeExpenseInput(request.body || {}, existing);
    const err = validateNormalized(n);
    if (err) return sendError(reply, 400, "VALIDATION", err);

    db.prepare(
      `UPDATE expenses SET description=?, amount=?, currency=?, category=?, spent_at=?,
       done=?, kind=?, meta_json=?, datetime_start=?, datetime_end=? WHERE id=?`,
    ).run(
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
      request.params.id,
    );

    return mapExpense(db.prepare("SELECT * FROM expenses WHERE id = ?").get(request.params.id));
  });

  app.delete("/api/v1/expenses/:id", async (request, reply) => {
    const info = db.prepare("DELETE FROM expenses WHERE id = ?").run(request.params.id);
    if (!info.changes) return sendError(reply, 404, "NOT_FOUND", "Gasto no encontrado");
    return { ok: true };
  });
}
