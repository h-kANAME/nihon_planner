import { sendError, logisticsFromExpenses } from "../helpers.mjs";

const GONE =
  "plan-items está deprecado: usá /api/v1/expenses (categorías documentacion/vuelos/reservas/alojamiento)";

/** Lectura compat + escritura deprecada (logística vive en expenses). */
export async function planRoutes(app, { db }) {
  app.get("/api/v1/plan-items", async (request) => {
    const { type, format } = request.query || {};
    let sql = "SELECT * FROM expenses WHERE kind IN ('flight','stay','booking','doc')";
    const params = [];
    if (type) {
      sql += " AND kind = ?";
      params.push(type);
    }
    sql += " ORDER BY datetime_start IS NULL, datetime_start";
    const rows = db.prepare(sql).all(...params);
    if (format === "logistics") return logisticsFromExpenses(rows);
    return rows.map((r) => ({
      id: r.id,
      type: r.kind,
      title: r.description,
      done: !!r.done,
      datetime_start: r.datetime_start,
      datetime_end: r.datetime_end,
      meta: JSON.parse(r.meta_json || "{}"),
      created_at: r.created_at,
      updated_at: r.created_at,
    }));
  });

  app.get("/api/v1/plan-items/timeline", async () => {
    const rows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE kind IN ('flight','stay','booking','doc')
           AND datetime_start IS NOT NULL AND datetime_start != ''
         ORDER BY datetime_start ASC`,
      )
      .all();
    return rows.map((r) => ({
      id: r.id,
      type: r.kind,
      title: r.description,
      done: !!r.done,
      datetime_start: r.datetime_start,
      datetime_end: r.datetime_end,
      meta: JSON.parse(r.meta_json || "{}"),
    }));
  });

  app.post("/api/v1/plan-items", async (_request, reply) => sendError(reply, 410, "GONE", GONE));
  app.put("/api/v1/plan-items/sync-logistics", async (_request, reply) =>
    sendError(reply, 410, "GONE", GONE),
  );
  app.put("/api/v1/plan-items/:id", async (_request, reply) => sendError(reply, 410, "GONE", GONE));
  app.delete("/api/v1/plan-items/:id", async (_request, reply) => sendError(reply, 410, "GONE", GONE));
}
