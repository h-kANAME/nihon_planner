import { uid } from "../db.mjs";
import { sendError } from "../helpers.mjs";
import { validateItineraryJson, validateMarkdownInput } from "../itinerary/schema.mjs";
import {
  getTripMeta,
  setTripMeta,
  loadItinerary,
  replaceItinerary,
  itineraryToCanonical,
  mapDay,
  mapStop,
} from "../itinerary/store.mjs";
import { itineraryToMarkdown } from "../itinerary/exportMd.mjs";
import { convertMarkdownToItinerary } from "../itinerary/convert.mjs";

export async function itineraryRoutes(app, { db, ai, config }) {
  app.get("/api/v1/itinerary", async () => loadItinerary(db));

  app.put("/api/v1/itinerary/meta", async (request, reply) => {
    const body = request.body || {};
    const prev = getTripMeta(db);
    let anchor_date = prev.anchor_date;
    if ("anchor_date" in body) {
      if (body.anchor_date == null || body.anchor_date === "") {
        anchor_date = null;
      } else {
        const a = String(body.anchor_date).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) {
          return sendError(reply, 400, "VALIDATION", "anchor_date debe ser YYYY-MM-DD o vacío");
        }
        anchor_date = a;
      }
    }
    const title = "title" in body ? String(body.title || "").trim().slice(0, 200) : prev.title;
    return setTripMeta(db, {
      ...prev,
      title,
      anchor_date,
    });
  });

  app.post("/api/v1/itinerary/days", async (request, reply) => {
    const body = request.body || {};
    const day_number = Number(body.day_number);
    if (!Number.isInteger(day_number) || day_number < 1) {
      return sendError(reply, 400, "VALIDATION", "day_number requerido (entero >= 1)");
    }
    const exists = db.prepare("SELECT id FROM itinerary_days WHERE day_number = ?").get(day_number);
    if (exists) return sendError(reply, 409, "CONFLICT", `Ya existe el día ${day_number}`);

    const id = uid();
    db.prepare(
      `INSERT INTO itinerary_days (id, day_number, title, base, stay_label, hub, notes, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      day_number,
      String(body.title || "").trim().slice(0, 200),
      String(body.base || "").trim().slice(0, 120),
      String(body.stay_label || "").trim().slice(0, 200),
      String(body.hub || "").trim().slice(0, 200),
      String(body.notes || "").trim().slice(0, 4000),
      day_number,
    );
    const row = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(id);
    return reply.code(201).send(mapDay(row, []));
  });

  app.patch("/api/v1/itinerary/days/:id", async (request, reply) => {
    const row = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(request.params.id);
    if (!row) return sendError(reply, 404, "NOT_FOUND", "Día no encontrado");
    const body = request.body || {};

    let day_number = row.day_number;
    if ("day_number" in body) {
      day_number = Number(body.day_number);
      if (!Number.isInteger(day_number) || day_number < 1) {
        return sendError(reply, 400, "VALIDATION", "day_number inválido");
      }
      const clash = db
        .prepare("SELECT id FROM itinerary_days WHERE day_number = ? AND id != ?")
        .get(day_number, row.id);
      if (clash) return sendError(reply, 409, "CONFLICT", `Ya existe el día ${day_number}`);
    }

    const next = {
      day_number,
      title: "title" in body ? String(body.title || "").trim().slice(0, 200) : row.title,
      base: "base" in body ? String(body.base || "").trim().slice(0, 120) : row.base,
      stay_label:
        "stay_label" in body ? String(body.stay_label || "").trim().slice(0, 200) : row.stay_label,
      hub: "hub" in body ? String(body.hub || "").trim().slice(0, 200) : row.hub,
      notes: "notes" in body ? String(body.notes || "").trim().slice(0, 4000) : row.notes,
      sort: day_number,
    };

    db.prepare(
      `UPDATE itinerary_days SET day_number=?, title=?, base=?, stay_label=?, hub=?, notes=?, sort=?,
       updated_at=datetime('now') WHERE id=?`,
    ).run(next.day_number, next.title, next.base, next.stay_label, next.hub, next.notes, next.sort, row.id);

    const updated = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(row.id);
    const stops = db
      .prepare("SELECT * FROM itinerary_stops WHERE day_id = ? ORDER BY sort_order")
      .all(row.id);
    return mapDay(updated, stops);
  });

  app.delete("/api/v1/itinerary/days/:id", async (request, reply) => {
    const info = db.prepare("DELETE FROM itinerary_days WHERE id = ?").run(request.params.id);
    if (!info.changes) return sendError(reply, 404, "NOT_FOUND", "Día no encontrado");
    return { ok: true };
  });

  app.post("/api/v1/itinerary/days/:dayId/stops", async (request, reply) => {
    const day = db.prepare("SELECT id FROM itinerary_days WHERE id = ?").get(request.params.dayId);
    if (!day) return sendError(reply, 404, "NOT_FOUND", "Día no encontrado");
    const body = request.body || {};
    const name = String(body.name || "").trim();
    if (!name) return sendError(reply, 400, "VALIDATION", "name requerido");

    const maxSort = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM itinerary_stops WHERE day_id = ?")
      .get(day.id).m;
    const id = uid();
    const kind = ["stop", "hub_out", "hub_back"].includes(body.kind) ? body.kind : "stop";
    db.prepare(
      `INSERT INTO itinerary_stops
         (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      day.id,
      body.sort_order != null ? Number(body.sort_order) : maxSort + 1,
      name.slice(0, 200),
      String(body.detail || "").trim().slice(0, 500),
      String(body.how_to_get || "").trim().slice(0, 500),
      String(body.est_duration || "").trim().slice(0, 80),
      String(body.notes || "").trim().slice(0, 4000),
      kind,
      body.done ? 1 : 0,
    );
    const row = db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(id);
    return reply.code(201).send(mapStop(row));
  });

  app.patch("/api/v1/itinerary/stops/:id", async (request, reply) => {
    const row = db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(request.params.id);
    if (!row) return sendError(reply, 404, "NOT_FOUND", "Parada no encontrada");
    const body = request.body || {};
    const kind =
      "kind" in body && ["stop", "hub_out", "hub_back"].includes(body.kind) ? body.kind : row.kind;
    const next = {
      name: "name" in body ? String(body.name || "").trim().slice(0, 200) : row.name,
      detail: "detail" in body ? String(body.detail || "").trim().slice(0, 500) : row.detail,
      how_to_get:
        "how_to_get" in body ? String(body.how_to_get || "").trim().slice(0, 500) : row.how_to_get,
      est_duration:
        "est_duration" in body
          ? String(body.est_duration || "").trim().slice(0, 80)
          : row.est_duration,
      notes: "notes" in body ? String(body.notes || "").trim().slice(0, 4000) : row.notes,
      kind,
      done: "done" in body ? (body.done ? 1 : 0) : row.done,
      sort_order: "sort_order" in body ? Number(body.sort_order) : row.sort_order,
    };
    if (!next.name) return sendError(reply, 400, "VALIDATION", "name requerido");

    db.prepare(
      `UPDATE itinerary_stops SET name=?, detail=?, how_to_get=?, est_duration=?, notes=?, kind=?, done=?,
       sort_order=?, updated_at=datetime('now') WHERE id=?`,
    ).run(
      next.name,
      next.detail,
      next.how_to_get,
      next.est_duration,
      next.notes,
      next.kind,
      next.done,
      next.sort_order,
      row.id,
    );
    return mapStop(db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(row.id));
  });

  app.delete("/api/v1/itinerary/stops/:id", async (request, reply) => {
    const info = db.prepare("DELETE FROM itinerary_stops WHERE id = ?").run(request.params.id);
    if (!info.changes) return sendError(reply, 404, "NOT_FOUND", "Parada no encontrada");
    return { ok: true };
  });

  /** Reemplazo total desde Markdown vía AI. Con stream:true → NDJSON de progreso. */
  app.post("/api/v1/itinerary/import-md", async (request, reply) => {
    const body = request.body || {};
    const check = validateMarkdownInput(body.markdown);
    if (!check.ok) return sendError(reply, 400, "VALIDATION", check.error);

    const filename = body.filename ? String(body.filename).slice(0, 200) : null;
    const wantStream = body.stream === true || body.stream === "true";

    const runImport = async (onProgress) => {
      request.log.info({ chars: check.markdown.length, filename, wantStream }, "Import itinerario MD vía AI");
      onProgress?.({
        phase: "start",
        percent: 1,
        message: "Arrancando importación…",
        detail: filename || "Markdown",
      });
      const converted = await convertMarkdownToItinerary(ai, check.markdown, {
        log: request.log,
        onProgress,
      });
      onProgress?.({
        phase: "save",
        percent: 95,
        message: "Guardando en la base de datos…",
        detail: "Reemplazo total del itinerario",
      });
      const itinerary = replaceItinerary(db, converted.data, { source_filename: filename });
      return {
        itinerary,
        warnings: converted.warnings,
        meta: {
          model: converted.meta?.model || config.aiModel,
          provider: converted.meta?.provider || config.aiProvider,
          continued: !!converted.meta?.continued,
          parts: converted.meta?.parts,
          strategy: converted.meta?.strategy,
          chunks: converted.meta?.chunks,
        },
      };
    };

    if (!wantStream) {
      try {
        return await runImport(null);
      } catch (e) {
        request.log.error({ err: e.message, code: e.code }, "AI import itinerario falló");
        const status = e.status || (e.message?.includes("AI") ? 502 : 422);
        return sendError(
          reply,
          status,
          e.code || "INVALID_ITINERARY",
          e.message || "Error al importar itinerario",
        );
      }
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    });

    const writeLine = (obj) => {
      reply.raw.write(`${JSON.stringify(obj)}\n`);
    };

    try {
      const result = await runImport((p) => writeLine({ type: "progress", ...p }));
      writeLine({
        type: "done",
        percent: 100,
        message: "Importación completa",
        detail: `${result.itinerary.days?.length || 0} días guardados`,
        itinerary: result.itinerary,
        warnings: result.warnings,
        meta: result.meta,
      });
    } catch (e) {
      request.log.error({ err: e.message, code: e.code }, "AI import itinerario falló (stream)");
      writeLine({
        type: "error",
        percent: 100,
        message: e.message || "Error al importar itinerario",
        code: e.code || "INVALID_ITINERARY",
        status: e.status || 422,
      });
    } finally {
      reply.raw.end();
    }
  });

  /** Import directo de JSON canónico (tests / reimport sin AI). */
  app.post("/api/v1/itinerary/import-json", async (request, reply) => {
    const validated = validateItineraryJson(request.body);
    if (!validated.ok) return sendError(reply, 400, "VALIDATION", validated.error);
    const itinerary = replaceItinerary(db, validated.data, {
      source_filename: request.body?.source_filename || null,
    });
    return { itinerary, warnings: validated.warnings };
  });

  app.get("/api/v1/itinerary/export.md", async (_request, reply) => {
    const md = itineraryToMarkdown(itineraryToCanonical(db));
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    reply.header(
      "Content-Disposition",
      'attachment; filename="nihon-itinerario.md"',
    );
    return reply.send(md);
  });
}
