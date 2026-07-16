import { uid } from "../db.mjs";
import { mapExpense, expenseToFront, getRates, makeConverter, sendError } from "../helpers.mjs";

export async function expensesRoutes(app, { db }) {
  app.get("/api/v1/expenses", async (request) => {
    const { category, from, to, format } = request.query || {};
    let sql = "SELECT * FROM expenses WHERE 1=1";
    const params = [];
    if (category) {
      sql += " AND category = ?";
      params.push(category);
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
    return rows.map(mapExpense);
  });

  app.get("/api/v1/expenses/totals", async () => {
    const rates = getRates(db);
    const convert = makeConverter(rates);
    const rows = db.prepare("SELECT * FROM expenses").all();
    const t = { USD: 0, ARS: 0, JPY: 0 };
    const byCat = {};
    for (const e of rows) {
      const c = convert(e.amount, e.currency);
      t.USD += c.USD;
      t.ARS += c.ARS;
      t.JPY += c.JPY;
      byCat[e.category] = (byCat[e.category] || 0) + c.USD;
    }
    return { ...t, byCat, rates };
  });

  /** Sync completo (adapter storage Fase 1) — antes de :id */
  app.put("/api/v1/expenses/sync", async (request, reply) => {
    const list = Array.isArray(request.body) ? request.body : request.body?.expenses;
    if (!Array.isArray(list)) return sendError(reply, 400, "VALIDATION", "Se espera un array");

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM expenses").run();
      const ins = db.prepare(
        `INSERT INTO expenses (id, description, amount, currency, category, spent_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const e of list) {
        const description = (e.description ?? e.desc ?? "").trim();
        const amount = Number(e.amount);
        if (!description || !(amount > 0)) continue;
        ins.run(
          e.id || uid(),
          description,
          amount,
          e.currency || "JPY",
          e.category || "otros",
          e.spent_at || e.date || new Date().toISOString(),
        );
      }
    });
    tx();
    const rows = db.prepare("SELECT * FROM expenses ORDER BY spent_at DESC").all();
    return rows.map(expenseToFront);
  });

  app.post("/api/v1/expenses", async (request, reply) => {
    const body = request.body || {};
    const description = body.description ?? body.desc;
    const amount = Number(body.amount);
    const currency = body.currency;
    const category = body.category;
    const spent_at = body.spent_at || body.date || new Date().toISOString();

    if (!description?.trim() || !(amount > 0) || !["ARS", "USD", "JPY"].includes(currency)) {
      return sendError(reply, 400, "VALIDATION", "Campos inválidos");
    }
    const cats = ["comida", "transporte", "alojamiento", "actividades", "compras", "otros"];
    if (!cats.includes(category)) {
      return sendError(reply, 400, "VALIDATION", "Categoría inválida");
    }

    const id = body.id || uid();
    db.prepare(
      `INSERT INTO expenses (id, description, amount, currency, category, spent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, description.trim(), amount, currency, category, spent_at);

    const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
    return reply.code(201).send(mapExpense(row));
  });

  app.put("/api/v1/expenses/:id", async (request, reply) => {
    const existing = db.prepare("SELECT * FROM expenses WHERE id = ?").get(request.params.id);
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "Gasto no encontrado");

    const body = request.body || {};
    const description = (body.description ?? body.desc ?? existing.description).trim();
    const amount = body.amount != null ? Number(body.amount) : existing.amount;
    const currency = body.currency ?? existing.currency;
    const category = body.category ?? existing.category;
    const spent_at = body.spent_at || body.date || existing.spent_at;

    if (!(amount > 0)) return sendError(reply, 400, "VALIDATION", "Monto inválido");

    db.prepare(
      `UPDATE expenses SET description=?, amount=?, currency=?, category=?, spent_at=? WHERE id=?`,
    ).run(description, amount, currency, category, spent_at, request.params.id);

    return mapExpense(db.prepare("SELECT * FROM expenses WHERE id = ?").get(request.params.id));
  });

  app.delete("/api/v1/expenses/:id", async (request, reply) => {
    const info = db.prepare("DELETE FROM expenses WHERE id = ?").run(request.params.id);
    if (!info.changes) return sendError(reply, 404, "NOT_FOUND", "Gasto no encontrado");
    return { ok: true };
  });
}
