/**
 * Contrato JSON canónico del itinerario (AI import + API).
 */

export const STOP_KINDS = new Set(["stop", "hub_out", "hub_back"]);
export const LOCATION_MODES = new Set(["pending", "coords", "not_applicable", "inherit_stay"]);
export const LOCATION_PRECISIONS = new Set(["place", "view"]);
export const MAX_MD_CHARS = 400_000;
export const MAX_DAYS = 60;
export const MAX_STOPS_PER_DAY = 40;
export const MAX_STR = 4000;
export const MAX_RAW_INPUT = 2000;

function asStr(v, max = MAX_STR) {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

function asKind(v) {
  const k = asStr(v, 32) || "stop";
  return STOP_KINDS.has(k) ? k : "stop";
}

function pick(obj, keys, fallback = undefined) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return fallback;
}

/** Normaliza claves EN/ES y shapes alternativos que suele devolver la AI. */
export function normalizeItineraryShape(input) {
  if (!input) return input;
  if (Array.isArray(input)) {
    return { title: "", anchor_date: null, days: input.map(normalizeDayShape) };
  }
  if (typeof input !== "object") return input;

  const daysRaw = pick(input, ["days", "dias", "Days", "Dias"], []);
  return {
    title: asStr(pick(input, ["title", "titulo", "nombre"], ""), 200),
    anchor_date: pick(input, ["anchor_date", "fecha_ancla", "anchorDate"], null),
    days: (Array.isArray(daysRaw) ? daysRaw : []).map(normalizeDayShape),
  };
}

function normalizeDayShape(d) {
  if (!d || typeof d !== "object") return d;
  const stopsRaw = pick(d, ["stops", "paradas", "Stops"], []);
  const num = pick(d, ["day_number", "dayNumber", "day", "dia", "numero", "n"], null);
  const out = {
    day_number: num,
    title: pick(d, ["title", "titulo", "nombre"], "") ?? "",
    base: pick(d, ["base", "ciudad", "city"], "") ?? "",
    stay_label: pick(d, ["stay_label", "stay", "alojamiento", "dormir"], "") ?? "",
    hub: pick(d, ["hub", "hub_logistico"], "") ?? "",
    notes: pick(d, ["notes", "notas"], "") ?? "",
    stops: (Array.isArray(stopsRaw) ? stopsRaw : []).map(normalizeStopShape),
  };
  // Campos de ubicación: se pasan para dump/import-json; validate los descarta sin trustLocations.
  if ("stay_lat" in d) out.stay_lat = d.stay_lat;
  if ("stay_lng" in d) out.stay_lng = d.stay_lng;
  if ("stay_precision" in d) out.stay_precision = d.stay_precision;
  if ("stay_raw_input" in d) out.stay_raw_input = d.stay_raw_input;
  return out;
}

function normalizeStopShape(s) {
  if (!s || typeof s !== "object") return s;
  const out = {
    kind: pick(s, ["kind", "tipo"], "stop"),
    name: pick(s, ["name", "nombre", "parada"], "") ?? "",
    detail: pick(s, ["detail", "detalle"], "") ?? "",
    how_to_get: pick(s, ["how_to_get", "como_llegar", "howToGet"], "") ?? "",
    est_duration: pick(s, ["est_duration", "est", "duracion", "tiempo"], "") ?? "",
    notes: pick(s, ["notes", "notas", "reserva"], "") ?? "",
    done: !!s.done,
  };
  if ("lat" in s) out.lat = s.lat;
  if ("lng" in s) out.lng = s.lng;
  if ("location_mode" in s) out.location_mode = s.location_mode;
  if ("location_precision" in s) out.location_precision = s.location_precision;
  if ("raw_input" in s) out.raw_input = s.raw_input;
  return out;
}

function asFiniteNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeRawInput(v) {
  if (v == null || v === "") return null;
  return asStr(v, MAX_RAW_INPUT) || null;
}

/**
 * Conserva y valida campos de ubicación de una parada (§9.4 trustLocations).
 * @returns {object} campos a fusionar en la parada
 */
function trustedStopLocation(s, dayNumber, stopName, warnings) {
  let mode = s.location_mode == null || s.location_mode === "" ? null : asStr(s.location_mode, 32);
  if (mode && !LOCATION_MODES.has(mode)) {
    warnings.push(`Día ${dayNumber} · «${stopName}»: location_mode inválido (${mode}); se ignora`);
    mode = null;
  }

  let precision =
    s.location_precision == null || s.location_precision === ""
      ? null
      : asStr(s.location_precision, 16);
  if (precision && !LOCATION_PRECISIONS.has(precision)) {
    warnings.push(
      `Día ${dayNumber} · «${stopName}»: location_precision inválida (${precision}); se ignora`,
    );
    precision = null;
  }

  const lat = asFiniteNumber(s.lat);
  const lng = asFiniteNumber(s.lng);
  const raw_input = sanitizeRawInput(s.raw_input);

  if (mode === "coords") {
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      warnings.push(
        `Día ${dayNumber} · «${stopName}»: coords fuera de rango; se deja pending`,
      );
      return {
        location_mode: "pending",
        lat: null,
        lng: null,
        location_precision: null,
        raw_input,
      };
    }
    return {
      location_mode: "coords",
      lat,
      lng,
      location_precision: precision || "place",
      raw_input,
    };
  }

  if (mode === "not_applicable" || mode === "inherit_stay" || mode === "pending") {
    return {
      location_mode: mode,
      lat: null,
      lng: null,
      location_precision: null,
      raw_input: mode === "pending" ? raw_input : null,
    };
  }

  // Sin mode explícito: si hay lat/lng válidos, coords; si no, no adjuntar campos.
  if (lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    return {
      location_mode: "coords",
      lat,
      lng,
      location_precision: precision || "place",
      raw_input,
    };
  }

  return {};
}

/**
 * Conserva y valida stay_* del día (§9.4 trustLocations).
 */
function trustedStayLocation(d, dayNumber, warnings) {
  const lat = asFiniteNumber(d.stay_lat);
  const lng = asFiniteNumber(d.stay_lng);
  let precision =
    d.stay_precision == null || d.stay_precision === "" ? null : asStr(d.stay_precision, 16);
  if (precision && !LOCATION_PRECISIONS.has(precision)) {
    warnings.push(`Día ${dayNumber}: stay_precision inválida (${precision}); se ignora`);
    precision = null;
  }
  const stay_raw_input = sanitizeRawInput(d.stay_raw_input);

  if (lat == null || lng == null) {
    return {
      stay_lat: null,
      stay_lng: null,
      stay_precision: null,
      stay_raw_input,
    };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    warnings.push(`Día ${dayNumber}: stay coords fuera de rango; se descartan`);
    return {
      stay_lat: null,
      stay_lng: null,
      stay_precision: null,
      stay_raw_input,
    };
  }
  return {
    stay_lat: lat,
    stay_lng: lng,
    stay_precision: precision || "place",
    stay_raw_input,
  };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.trustLocations] — true: dump / import-json; false: MD / AI (§9.4)
 * @returns {{ ok: true, data: object, warnings: string[] } | { ok: false, error: string, warnings: string[] }}
 */
export function validateItineraryJson(raw, { trustLocations = false } = {}) {
  const warnings = [];
  let input = raw;

  if (typeof raw === "string") {
    const extracted = extractJsonObject(raw);
    if (!extracted) {
      return { ok: false, error: "No se encontró un objeto JSON válido en la respuesta", warnings };
    }
    try {
      input = JSON.parse(extracted);
    } catch {
      return { ok: false, error: "JSON inválido (parse error)", warnings };
    }
  }

  input = normalizeItineraryShape(input);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "El itinerario debe ser un objeto JSON", warnings };
  }

  const title = asStr(input.title, 200);
  let anchor_date = input.anchor_date == null || input.anchor_date === "" ? null : asStr(input.anchor_date, 32);
  if (anchor_date && !/^\d{4}-\d{2}-\d{2}$/.test(anchor_date)) {
    warnings.push(`anchor_date ignorada (formato inválido: ${anchor_date})`);
    anchor_date = null;
  }

  const daysIn = Array.isArray(input.days) ? input.days : null;
  if (!daysIn) {
    return { ok: false, error: "Falta el array days", warnings };
  }
  if (daysIn.length > MAX_DAYS) {
    warnings.push(`Se truncaron días a ${MAX_DAYS}`);
  }

  const seen = new Set();
  const days = [];
  for (const d of daysIn.slice(0, MAX_DAYS)) {
    if (!d || typeof d !== "object") {
      warnings.push("Día omitido (no es objeto)");
      continue;
    }
    const day_number = Number(d.day_number);
    if (!Number.isInteger(day_number) || day_number < 1) {
      warnings.push(`Día omitido (day_number inválido: ${d.day_number})`);
      continue;
    }
    if (seen.has(day_number)) {
      warnings.push(`Día ${day_number} duplicado; se conserva el primero`);
      continue;
    }
    seen.add(day_number);

    const stopsIn = Array.isArray(d.stops) ? d.stops : [];
    if (stopsIn.length > MAX_STOPS_PER_DAY) {
      warnings.push(`Día ${day_number}: paradas truncadas a ${MAX_STOPS_PER_DAY}`);
    }
    const stops = [];
    for (const [i, s] of stopsIn.slice(0, MAX_STOPS_PER_DAY).entries()) {
      if (!s || typeof s !== "object") continue;
      const name = asStr(s.name, 200);
      if (!name) {
        warnings.push(`Día ${day_number}: parada #${i + 1} sin nombre, omitida`);
        continue;
      }
      const stop = {
        kind: asKind(s.kind),
        name,
        detail: asStr(s.detail, 500),
        how_to_get: asStr(s.how_to_get, 500),
        est_duration: asStr(s.est_duration, 80),
        notes: asStr(s.notes, MAX_STR),
        done: !!s.done,
      };
      if (trustLocations) {
        Object.assign(stop, trustedStopLocation(s, day_number, name, warnings));
      }
      stops.push(stop);
    }

    const day = {
      day_number,
      title: asStr(d.title, 200),
      base: asStr(d.base, 120),
      stay_label: asStr(d.stay_label, 200),
      hub: asStr(d.hub, 200),
      notes: asStr(d.notes, MAX_STR),
      stops,
    };
    if (trustLocations) {
      Object.assign(day, trustedStayLocation(d, day_number, warnings));
    }
    days.push(day);
  }

  days.sort((a, b) => a.day_number - b.day_number);

  if (!days.length) {
    return { ok: false, error: "El itinerario no tiene días válidos", warnings };
  }

  return {
    ok: true,
    data: { title, anchor_date, days },
    warnings,
  };
}

/**
 * Extrae JSON: prioriza el objeto que contenga "days"/"dias".
 * Si hay fences ```json, los usa. Soporta el primer objeto balanceado como fallback.
 */
export function extractJsonObject(text) {
  const src = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(src);
  const candidate = fenced ? fenced[1] : src;

  const objects = extractAllJsonObjects(candidate);
  if (!objects.length) return null;

  const withDays = objects.find((o) => {
    try {
      const p = JSON.parse(o);
      return p && typeof p === "object" && (Array.isArray(p.days) || Array.isArray(p.dias) || Array.isArray(p));
    } catch {
      return false;
    }
  });
  return withDays || objects[objects.length - 1];
}

function extractAllJsonObjects(candidate) {
  const out = [];
  for (let start = 0; start < candidate.length; start++) {
    if (candidate[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(candidate.slice(start, i + 1));
          start = i;
          break;
        }
      }
    }
  }
  return out;
}

export function validateMarkdownInput(markdown) {
  const md = String(markdown || "");
  if (!md.trim()) return { ok: false, error: "markdown vacío" };
  if (md.length > MAX_MD_CHARS) {
    return { ok: false, error: `markdown supera ${MAX_MD_CHARS} caracteres` };
  }
  return { ok: true, markdown: md };
}
