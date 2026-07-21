import { uid } from "../db.mjs";
import { parseJson } from "../helpers.mjs";

const DEFAULT_META = {
  title: "",
  anchor_date: null,
  imported_at: null,
  source_filename: null,
};

export function getTripMeta(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'trip_meta'").get();
  if (!row) return { ...DEFAULT_META };
  return { ...DEFAULT_META, ...parseJson(row.value, DEFAULT_META) };
}

export function setTripMeta(db, meta) {
  const next = {
    title: meta.title ?? "",
    anchor_date: meta.anchor_date ?? null,
    imported_at: meta.imported_at ?? null,
    source_filename: meta.source_filename ?? null,
  };
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('trip_meta', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(next));
  return next;
}

export function mapStop(row) {
  return {
    id: row.id,
    day_id: row.day_id,
    sort_order: row.sort_order,
    name: row.name,
    detail: row.detail,
    how_to_get: row.how_to_get,
    est_duration: row.est_duration,
    notes: row.notes,
    kind: row.kind,
    done: !!row.done,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapDay(row, stops = []) {
  return {
    id: row.id,
    day_number: row.day_number,
    title: row.title,
    base: row.base,
    stay_label: row.stay_label,
    hub: row.hub,
    notes: row.notes,
    sort: row.sort,
    stops: stops.map(mapStop),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function loadItinerary(db) {
  const meta = getTripMeta(db);
  const days = db
    .prepare("SELECT * FROM itinerary_days ORDER BY sort ASC, day_number ASC")
    .all();
  const stopStmt = db.prepare(
    "SELECT * FROM itinerary_stops WHERE day_id = ? ORDER BY sort_order ASC, created_at ASC",
  );
  return {
    meta,
    days: days.map((d) => mapDay(d, stopStmt.all(d.id))),
  };
}

/** Reemplazo total del itinerario desde JSON canónico validado. */
export function replaceItinerary(db, data, { source_filename = null } = {}) {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM itinerary_stops").run();
    db.prepare("DELETE FROM itinerary_days").run();

    const insDay = db.prepare(
      `INSERT INTO itinerary_days (id, day_number, title, base, stay_label, hub, notes, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insStop = db.prepare(
      `INSERT INTO itinerary_stops
         (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const d of data.days) {
      const dayId = uid();
      insDay.run(
        dayId,
        d.day_number,
        d.title,
        d.base,
        d.stay_label,
        d.hub,
        d.notes,
        d.day_number,
      );
      (d.stops || []).forEach((s, i) => {
        insStop.run(
          uid(),
          dayId,
          i,
          s.name,
          s.detail || "",
          s.how_to_get || "",
          s.est_duration || "",
          s.notes || "",
          s.kind || "stop",
          s.done ? 1 : 0,
        );
      });
    }

    const prev = getTripMeta(db);
    setTripMeta(db, {
      title: data.title || prev.title || "",
      anchor_date: data.anchor_date !== undefined ? data.anchor_date : prev.anchor_date,
      imported_at: new Date().toISOString(),
      source_filename,
    });
  });
  tx();
  return loadItinerary(db);
}

export function itineraryToCanonical(db) {
  const { meta, days } = loadItinerary(db);
  return {
    title: meta.title || "",
    anchor_date: meta.anchor_date,
    days: days.map((d) => ({
      day_number: d.day_number,
      title: d.title,
      base: d.base,
      stay_label: d.stay_label,
      hub: d.hub,
      notes: d.notes,
      stops: d.stops.map((s) => ({
        kind: s.kind,
        name: s.name,
        detail: s.detail,
        how_to_get: s.how_to_get,
        est_duration: s.est_duration,
        notes: s.notes,
        done: s.done,
      })),
    })),
  };
}
