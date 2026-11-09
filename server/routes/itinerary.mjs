import { uid } from "../db.mjs";
import { sendError, sendVersionConflict } from "../helpers.mjs";
import { validateItineraryJson, validateMarkdownInput } from "../itinerary/schema.mjs";
import {
  getTripMeta,
  setTripMeta,
  loadItinerary,
  replaceItinerary,
  itineraryToCanonical,
  locationModeForKind,
  mapDay,
  mapStop,
} from "../itinerary/store.mjs";
import { itineraryToMarkdown } from "../itinerary/exportMd.mjs";
import { convertMarkdownToItinerary } from "../itinerary/convert.mjs";
import { evaluateLocationsAtRisk } from "../itinerary/importGuard.mjs";
import { createImportSnapshot } from "../itinerary/snapshot.mjs";
import { mapsUrlFromRaw } from "../../shared/location-parse.mjs";
import { readLocationInput } from "../itinerary/expandMapsUrl.mjs";

const LOCATION_MODES = new Set(["pending", "coords", "not_applicable", "inherit_stay"]);
const RAW_INPUT_MAX = 2000;

function requireVersion(body) {
  const version = Number(body?.version);
  if (!Number.isInteger(version)) return { ok: false, error: "version requerida (entero)" };
  return { ok: true, version };
}

function requireRawInput(rawInput) {
  if (rawInput == null || String(rawInput).trim() === "") {
    return { ok: false, code: "RAW_INPUT_REQUIRED", message: "raw_input requerido" };
  }
  const raw = String(rawInput);
  if (raw.length > RAW_INPUT_MAX) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `raw_input supera ${RAW_INPUT_MAX} caracteres`,
    };
  }
  return { ok: true, raw };
}

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
         (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done, location_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      locationModeForKind(kind),
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

  /** Resuelve un enlace corto de Compartir y devuelve nombre, pin y ficha. */
  app.post("/api/v1/locations/preview", async (request, reply) => {
    const rawCheck = requireRawInput(request.body?.raw_input);
    if (!rawCheck.ok) return sendError(reply, 400, rawCheck.code, rawCheck.message);
    const reference = request.body?.reference;
    let read;
    try {
      read = await readLocationInput(
        rawCheck.raw,
        reference?.lat != null && reference?.lng != null ? reference : undefined,
      );
    } catch (err) {
      return sendError(reply, 400, "INVALID_LOCATION", err.message || "No se pudo resolver el enlace");
    }
    if (!read.parsed.ok) return sendError(reply, 400, "INVALID_LOCATION", read.parsed.error);
    return { ...read.parsed, maps_url: mapsUrlFromRaw(read.raw_input) };
  });

  /** Ubicación de parada: el servidor solo parsea raw_input (§6.1, §4.4). */
  app.put("/api/v1/itinerary/stops/:id/location", async (request, reply) => {
    const row = db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(request.params.id);
    if (!row) return sendError(reply, 404, "NOT_FOUND", "Parada no encontrada");

    const body = request.body || {};
    const ver = requireVersion(body);
    if (!ver.ok) return sendError(reply, 400, "VALIDATION", ver.error);
    if (ver.version !== row.version) return sendVersionConflict(reply, mapStop(row));

    const mode = body.mode;
    if (!LOCATION_MODES.has(mode)) {
      return sendError(reply, 400, "VALIDATION", "mode inválido");
    }

    let lat = null;
    let lng = null;
    let location_precision = null;
    let raw_input = null;
    let nextName = row.name;

    if (mode === "coords") {
      const rawCheck = requireRawInput(body.raw_input);
      if (!rawCheck.ok) return sendError(reply, 400, rawCheck.code, rawCheck.message);

      const day = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(row.day_id);
      const reference =
        day?.stay_lat != null && day?.stay_lng != null
          ? { lat: day.stay_lat, lng: day.stay_lng }
          : undefined;
      let read;
      try {
        read = await readLocationInput(rawCheck.raw, reference);
      } catch (err) {
        return sendError(reply, 400, "INVALID_LOCATION", err.message || "No se pudo resolver el enlace");
      }
      const parsed = read.parsed;
      if (!parsed.ok) {
        request.log.info({ stopId: row.id, parseOk: false }, "Parseo de ubicación falló");
        return sendError(reply, 400, "INVALID_LOCATION", parsed.error);
      }
      request.log.info(
        { stopId: row.id, source: parsed.source, precision: parsed.precision },
        "Ubicación de parada parseada",
      );
      lat = parsed.lat;
      lng = parsed.lng;
      location_precision = parsed.precision;
      raw_input = read.raw_input;
      if (parsed.suggested_name) nextName = String(parsed.suggested_name).slice(0, 200);
    }

    const nextVersion = row.version + 1;
    const info = db
      .prepare(
        `UPDATE itinerary_stops SET
           location_mode=?, lat=?, lng=?, location_precision=?, raw_input=?, name=?, version=?,
           updated_at=datetime('now')
         WHERE id=? AND version=?`,
      )
      .run(
        mode,
        lat,
        lng,
        location_precision,
        raw_input,
        nextName,
        nextVersion,
        row.id,
        ver.version,
      );
    if (!info.changes) {
      const current = db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(row.id);
      return sendVersionConflict(reply, mapStop(current));
    }
    return mapStop(db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(row.id));
  });

  /** Alojamiento del día: parsea raw_input o clear (§6.1). */
  app.put("/api/v1/itinerary/days/:id/stay-location", async (request, reply) => {
    const row = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(request.params.id);
    if (!row) return sendError(reply, 404, "NOT_FOUND", "Día no encontrado");

    const body = request.body || {};
    const ver = requireVersion(body);
    if (!ver.ok) return sendError(reply, 400, "VALIDATION", ver.error);
    if (ver.version !== row.version) return sendVersionConflict(reply, mapDay(row));

    let stay_lat = null;
    let stay_lng = null;
    let stay_precision = null;
    let stay_raw_input = null;
    let nextLabel = row.stay_label;

    if (body.clear === true) {
      // limpia coordenadas del alojamiento
    } else {
      const rawCheck = requireRawInput(body.raw_input);
      if (!rawCheck.ok) return sendError(reply, 400, rawCheck.code, rawCheck.message);

      let read;
      try {
        read = await readLocationInput(rawCheck.raw);
      } catch (err) {
        return sendError(reply, 400, "INVALID_LOCATION", err.message || "No se pudo resolver el enlace");
      }
      const parsed = read.parsed;
      if (!parsed.ok) {
        request.log.info({ dayId: row.id, parseOk: false }, "Parseo de stay-location falló");
        return sendError(reply, 400, "INVALID_LOCATION", parsed.error);
      }
      request.log.info(
        { dayId: row.id, source: parsed.source, precision: parsed.precision },
        "Stay-location parseada",
      );
      stay_lat = parsed.lat;
      stay_lng = parsed.lng;
      stay_precision = parsed.precision;
      stay_raw_input = read.raw_input;
      if (parsed.suggested_name) nextLabel = String(parsed.suggested_name).slice(0, 200);
    }

    const nextVersion = row.version + 1;
    const info = db
      .prepare(
        `UPDATE itinerary_days SET
           stay_lat=?, stay_lng=?, stay_precision=?, stay_raw_input=?, stay_label=?, version=?,
           updated_at=datetime('now')
         WHERE id=? AND version=?`,
      )
      .run(
        stay_lat,
        stay_lng,
        stay_precision,
        stay_raw_input,
        nextLabel,
        nextVersion,
        row.id,
        ver.version,
      );
    if (!info.changes) {
      const current = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(row.id);
      return sendVersionConflict(reply, mapDay(current));
    }

    const updated = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(row.id);
    const stops = db
      .prepare("SELECT * FROM itinerary_stops WHERE day_id = ? ORDER BY sort_order")
      .all(row.id);
    return mapDay(updated, stops);
  });

  /** Reemplazo total desde Markdown vía AI. Con stream:true → NDJSON de progreso. */
  app.post("/api/v1/itinerary/import-md", async (request, reply) => {
    const body = request.body || {};
    const check = validateMarkdownInput(body.markdown);
    if (!check.ok) return sendError(reply, 400, "VALIDATION", check.error);

    const filename = body.filename ? String(body.filename).slice(0, 200) : null;
    const wantStream = body.stream === true || body.stream === "true";
    const force = body.force === true || body.force === "true";

    // Guarda §7.4: antes de AI, hijack y snapshot
    const guard = evaluateLocationsAtRisk(check.markdown, db, { force });
    if (guard.blocked) {
      return sendError(
        reply,
        409,
        "LOCATIONS_AT_RISK",
        `Este Markdown no trae ubicaciones. Tu itinerario tiene ${guard.resolved} ubicaciones validadas y se van a perder.`,
        { resolved: guard.resolved },
      );
    }

    // Snapshot §9.3: después de la guarda, antes de AI / hijack / replaceItinerary
    try {
      await createImportSnapshot(db, config.dbPath);
    } catch (e) {
      request.log.error({ err: e.message, code: e.code }, "Snapshot pre-import falló");
      return sendError(
        reply,
        e.status || 500,
        e.code || "SNAPSHOT_FAILED",
        e.message || "No se pudo crear snapshot antes del import",
      );
    }

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
      const { itinerary, relink_report } = replaceItinerary(db, converted.data, {
        source_filename: filename,
        locationsByDay: converted.locationsByDay,
      });
      const warnings = [...(converted.warnings || [])];
      if (guard.discardWarning) warnings.push(guard.discardWarning);
      return {
        itinerary,
        warnings,
        relink_report,
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
        relink_report: result.relink_report,
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

  /** Import directo de JSON canónico (tests / reimport sin AI). Confía ubicaciones (§9.4). */
  app.post("/api/v1/itinerary/import-json", async (request, reply) => {
    const validated = validateItineraryJson(request.body, { trustLocations: true });
    if (!validated.ok) return sendError(reply, 400, "VALIDATION", validated.error);

    // Snapshot §9.3: fail-closed antes de replaceItinerary
    try {
      await createImportSnapshot(db, config.dbPath);
    } catch (e) {
      request.log.error({ err: e.message, code: e.code }, "Snapshot pre-import-json falló");
      return sendError(
        reply,
        e.status || 500,
        e.code || "SNAPSHOT_FAILED",
        e.message || "No se pudo crear snapshot antes del import",
      );
    }

    const { itinerary, relink_report } = replaceItinerary(db, validated.data, {
      source_filename: request.body?.source_filename || null,
      locationsByDay: request.body?.locationsByDay || null,
    });
    return { itinerary, warnings: validated.warnings, relink_report };
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
