import { uid } from "../db.mjs";
import { parseJson } from "../helpers.mjs";
import { mapsUrlFromRaw } from "../../shared/location-parse.mjs";

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

/** Hubs heredan el stay del día; el resto arranca pending (§4.2). */
export function locationModeForKind(kind) {
  return kind === "hub_out" || kind === "hub_back" ? "inherit_stay" : "pending";
}

/**
 * Normalización de nombre para re-link (§7.3):
 * NFKC → lower → sin diacríticos → sin markdown *_` → sin paréntesis finales → spaces → trim.
 */
export function nameNorm(name) {
  let s = String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[*_`]/g, "");
  s = s.replace(/\s*\([^)]*\)\s*$/u, "");
  return s.replace(/\s+/g, " ").trim();
}

function emptyRelinkReport() {
  return { located: 0, not_applicable: 0, inherited: 0, pending: 0, warnings: [] };
}

function tallyMode(report, mode) {
  if (mode === "coords") report.located += 1;
  else if (mode === "not_applicable") report.not_applicable += 1;
  else if (mode === "inherit_stay") report.inherited += 1;
  else report.pending += 1;
}

/** Campos de ubicación a insertar a partir de un location de locationsByDay. */
function fieldsFromMatchedLocation(location) {
  const mode = location?.mode || "pending";
  if (mode === "coords") {
    return {
      location_mode: "coords",
      lat: location.lat ?? null,
      lng: location.lng ?? null,
      location_precision: location.precision || "place",
      raw_input: location.raw_input ?? null,
    };
  }
  if (mode === "not_applicable") {
    return {
      location_mode: "not_applicable",
      lat: null,
      lng: null,
      location_precision: null,
      raw_input: null,
    };
  }
  if (mode === "inherit_stay") {
    return {
      location_mode: "inherit_stay",
      lat: null,
      lng: null,
      location_precision: null,
      raw_input: null,
    };
  }
  return {
    location_mode: "pending",
    lat: null,
    lng: null,
    location_precision: null,
    raw_input: location?.raw_input ?? null,
  };
}

/** Ubicación ya validada en la parada (dump / import-json con trustLocations). */
function fieldsFromTrustedStop(stop, kind) {
  if (stop.location_mode) {
    return fieldsFromMatchedLocation({
      mode: stop.location_mode,
      lat: stop.lat,
      lng: stop.lng,
      precision: stop.location_precision,
      raw_input: stop.raw_input,
    });
  }
  return {
    location_mode: locationModeForKind(kind),
    lat: null,
    lng: null,
    location_precision: null,
    raw_input: null,
  };
}

/**
 * Resuelve una parada final contra las paradas MD del día (§7.3):
 * (a) name_norm unívoco; (b) índice+nombre solo si misma cantidad; (c) sin match → pending.
 * Sin mdStops: usa campos trusted de la parada (§9.4) o defaults por kind.
 */
export function resolveDayStop(stop, index, mdStops, finalCount, dayNumber) {
  const kind = stop.kind || "stop";
  const defaultMode = locationModeForKind(kind);
  const md = Array.isArray(mdStops) ? mdStops : [];

  if (!md.length) {
    return {
      fields: fieldsFromTrustedStop(stop, kind),
      done: !!stop.done,
      warning: null,
    };
  }

  const norm = nameNorm(stop.name);
  const byNorm = new Map();
  for (const ms of md) {
    const n = nameNorm(ms.name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(ms);
  }

  let matched = null;
  const unique = byNorm.get(norm);
  if (unique && unique.length === 1) {
    matched = unique[0];
  } else if (md.length === finalCount) {
    const atIdx = md[index];
    if (atIdx && nameNorm(atIdx.name) === norm) {
      matched = atIdx;
    }
  }

  if (!matched) {
    return {
      fields: {
        location_mode: defaultMode,
        lat: null,
        lng: null,
        location_precision: null,
        raw_input: null,
      },
      done: !!stop.done,
      warning: `LOCATION_UNMATCHED: día ${dayNumber} · «${stop.name}»`,
    };
  }

  let fields = fieldsFromMatchedLocation(matched.location);
  // Hubs sin ubicación explícita → inherit_stay (§4.2 / §7.3)
  if (
    (kind === "hub_out" || kind === "hub_back") &&
    fields.location_mode === "pending"
  ) {
    fields = {
      location_mode: "inherit_stay",
      lat: null,
      lng: null,
      location_precision: null,
      raw_input: null,
    };
  }

  return {
    fields,
    done: !!matched.done,
    warning: null,
  };
}

function stayFieldsFromLocation(stay) {
  if (!stay || stay.mode !== "coords") {
    return {
      stay_lat: null,
      stay_lng: null,
      stay_precision: null,
      stay_raw_input: null,
    };
  }
  return {
    stay_lat: stay.lat ?? null,
    stay_lng: stay.lng ?? null,
    stay_precision: stay.precision || "place",
    stay_raw_input: stay.raw_input ?? null,
  };
}

/** stay_* ya validados en el día (dump / import-json con trustLocations). */
function stayFieldsFromTrustedDay(d) {
  if (d?.stay_lat == null || d?.stay_lng == null) {
    return {
      stay_lat: null,
      stay_lng: null,
      stay_precision: null,
      stay_raw_input: d?.stay_raw_input ?? null,
    };
  }
  return {
    stay_lat: d.stay_lat,
    stay_lng: d.stay_lng,
    stay_precision: d.stay_precision || "place",
    stay_raw_input: d.stay_raw_input ?? null,
  };
}

export function mapStop(row) {
  const mapsUrl = mapsUrlFromRaw(row.raw_input);
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
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    location_mode: row.location_mode ?? "pending",
    location_precision: row.location_precision ?? null,
    ...(mapsUrl ? { maps_url: mapsUrl } : {}),
    version: row.version ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapDay(row, stops = []) {
  const stayMapsUrl = mapsUrlFromRaw(row.stay_raw_input);
  return {
    id: row.id,
    day_number: row.day_number,
    title: row.title,
    base: row.base,
    stay_label: row.stay_label,
    hub: row.hub,
    notes: row.notes,
    sort: row.sort,
    stay_lat: row.stay_lat ?? null,
    stay_lng: row.stay_lng ?? null,
    stay_precision: row.stay_precision ?? null,
    ...(stayMapsUrl ? { stay_maps_url: stayMapsUrl } : {}),
    version: row.version ?? 1,
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

/**
 * Reemplazo total del itinerario desde JSON canónico validado.
 * Ubicaciones/done se aplican aquí (después de validate) vía `locationsByDay` (§7.3).
 *
 * @param {Map|object|null} [opts.locationsByDay]
 * @returns {{ itinerary: object, relink_report: object }}
 */
export function replaceItinerary(db, data, { source_filename = null, locationsByDay = null } = {}) {
  const locMap =
    locationsByDay instanceof Map
      ? locationsByDay
      : locationsByDay && typeof locationsByDay === "object"
        ? new Map(
            Object.entries(locationsByDay).map(([k, v]) => [Number(k), v]),
          )
        : null;

  const relink_report = emptyRelinkReport();

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM itinerary_stops").run();
    db.prepare("DELETE FROM itinerary_days").run();

    const insDay = db.prepare(
      `INSERT INTO itinerary_days
         (id, day_number, title, base, stay_label, hub, notes, sort,
          stay_lat, stay_lng, stay_precision, stay_raw_input)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insStop = db.prepare(
      `INSERT INTO itinerary_stops
         (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done,
          location_mode, lat, lng, location_precision, raw_input)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const d of data.days) {
      const dayId = uid();
      const dayLoc = locMap?.get(d.day_number) ?? null;
      const stay = dayLoc
        ? stayFieldsFromLocation(dayLoc.stay_location)
        : stayFieldsFromTrustedDay(d);
      insDay.run(
        dayId,
        d.day_number,
        d.title,
        d.base,
        d.stay_label,
        d.hub,
        d.notes,
        d.day_number,
        stay.stay_lat,
        stay.stay_lng,
        stay.stay_precision,
        stay.stay_raw_input,
      );

      const finalStops = d.stops || [];
      const mdStops = Array.isArray(dayLoc?.stops) ? dayLoc.stops : [];
      finalStops.forEach((s, i) => {
        const kind = s.kind || "stop";
        const resolved = resolveDayStop(s, i, mdStops, finalStops.length, d.day_number);
        if (resolved.warning) relink_report.warnings.push(resolved.warning);
        const { fields } = resolved;
        tallyMode(relink_report, fields.location_mode);
        insStop.run(
          uid(),
          dayId,
          i,
          s.name,
          s.detail || "",
          s.how_to_get || "",
          s.est_duration || "",
          s.notes || "",
          kind,
          resolved.done ? 1 : 0,
          fields.location_mode,
          fields.lat,
          fields.lng,
          fields.location_precision,
          fields.raw_input,
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
  return { itinerary: loadItinerary(db), relink_report };
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
      stay_lat: d.stay_lat,
      stay_lng: d.stay_lng,
      stay_precision: d.stay_precision,
      stops: d.stops.map((s) => ({
        kind: s.kind,
        name: s.name,
        detail: s.detail,
        how_to_get: s.how_to_get,
        est_duration: s.est_duration,
        notes: s.notes,
        done: s.done,
        lat: s.lat,
        lng: s.lng,
        location_mode: s.location_mode,
        location_precision: s.location_precision,
      })),
    })),
  };
}
