import { uid } from "../db.mjs";
import {
  mapPlanItem,
  logisticsFromItems,
  planItemFromFront,
  sendError,
} from "../helpers.mjs";

export async function planRoutes(app, { db }) {
  app.get("/api/v1/plan-items", async (request) => {
    const { type, format } = request.query || {};
    let rows;
    if (type) {
      rows = db
        .prepare("SELECT * FROM plan_items WHERE type = ? ORDER BY datetime_start IS NULL, datetime_start")
        .all(type);
    } else {
      rows = db
        .prepare("SELECT * FROM plan_items ORDER BY type, datetime_start IS NULL, datetime_start")
        .all();
    }
    if (format === "logistics") return logisticsFromItems(rows);
    return rows.map(mapPlanItem);
  });

  app.get("/api/v1/plan-items/timeline", async () => {
    const rows = db
      .prepare(
        `SELECT * FROM plan_items
         WHERE datetime_start IS NOT NULL AND datetime_start != ''
         ORDER BY datetime_start ASC`,
      )
      .all();
    return rows.map(mapPlanItem);
  });

  app.post("/api/v1/plan-items", async (request, reply) => {
    const body = request.body || {};
    const type = body.type;
    if (!["flight", "stay", "booking", "doc"].includes(type)) {
      return sendError(reply, 400, "VALIDATION", "type inválido");
    }
    const title = (body.title || "").trim();
    if (!title) return sendError(reply, 400, "VALIDATION", "title requerido");

    const id = body.id || uid();
    const meta = typeof body.meta === "string" ? body.meta : JSON.stringify(body.meta || {});
    db.prepare(
      `INSERT INTO plan_items (id, type, title, done, datetime_start, datetime_end, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      type,
      title,
      body.done ? 1 : 0,
      body.datetime_start || null,
      body.datetime_end || null,
      meta,
    );
    return reply.code(201).send(mapPlanItem(db.prepare("SELECT * FROM plan_items WHERE id = ?").get(id)));
  });

  /** Sync logistics shape (Fase 1 storage adapter) — antes de :id */
  app.put("/api/v1/plan-items/sync-logistics", async (request, reply) => {
    const logistics = request.body || {};
    const buckets = [
      ["flight", logistics.flights || []],
      ["stay", logistics.stays || []],
      ["booking", logistics.bookings || []],
      ["doc", logistics.docs || []],
    ];

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM plan_items").run();
      const ins = db.prepare(
        `INSERT INTO plan_items (id, type, title, done, datetime_start, datetime_end, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [type, list] of buckets) {
        for (const item of list) {
          const mapped = planItemFromFront(type, item);
          ins.run(
            item.id || uid(),
            mapped.type,
            mapped.title,
            mapped.done ? 1 : 0,
            mapped.datetime_start,
            mapped.datetime_end,
            JSON.stringify(mapped.meta),
          );
        }
      }
    });
    tx();
    const rows = db.prepare("SELECT * FROM plan_items").all();
    return logisticsFromItems(rows);
  });

  app.put("/api/v1/plan-items/:id", async (request, reply) => {
    const existing = db.prepare("SELECT * FROM plan_items WHERE id = ?").get(request.params.id);
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "Ítem no encontrado");

    const body = request.body || {};
    const title = body.title != null ? String(body.title).trim() : existing.title;
    const done = body.done != null ? (body.done ? 1 : 0) : existing.done;
    const datetime_start = body.datetime_start !== undefined ? body.datetime_start : existing.datetime_start;
    const datetime_end = body.datetime_end !== undefined ? body.datetime_end : existing.datetime_end;
    const meta =
      body.meta !== undefined
        ? typeof body.meta === "string"
          ? body.meta
          : JSON.stringify(body.meta)
        : existing.meta;

    db.prepare(
      `UPDATE plan_items SET title=?, done=?, datetime_start=?, datetime_end=?, meta=?,
       updated_at=datetime('now') WHERE id=?`,
    ).run(title, done, datetime_start, datetime_end, meta, request.params.id);

    return mapPlanItem(db.prepare("SELECT * FROM plan_items WHERE id = ?").get(request.params.id));
  });

  app.delete("/api/v1/plan-items/:id", async (request, reply) => {
    const info = db.prepare("DELETE FROM plan_items WHERE id = ?").run(request.params.id);
    if (!info.changes) return sendError(reply, 404, "NOT_FOUND", "Ítem no encontrado");
    return { ok: true };
  });
}
