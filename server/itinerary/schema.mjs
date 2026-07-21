/**
 * Contrato JSON canónico del itinerario (AI import + API).
 */

export const STOP_KINDS = new Set(["stop", "hub_out", "hub_back"]);
export const MAX_MD_CHARS = 400_000;
export const MAX_DAYS = 60;
export const MAX_STOPS_PER_DAY = 40;
export const MAX_STR = 4000;

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
  return {
    day_number: num,
    title: pick(d, ["title", "titulo", "nombre"], "") ?? "",
    base: pick(d, ["base", "ciudad", "city"], "") ?? "",
    stay_label: pick(d, ["stay_label", "stay", "alojamiento", "dormir"], "") ?? "",
    hub: pick(d, ["hub", "hub_logistico"], "") ?? "",
    notes: pick(d, ["notes", "notas"], "") ?? "",
    stops: (Array.isArray(stopsRaw) ? stopsRaw : []).map(normalizeStopShape),
  };
}

function normalizeStopShape(s) {
  if (!s || typeof s !== "object") return s;
  return {
    kind: pick(s, ["kind", "tipo"], "stop"),
    name: pick(s, ["name", "nombre", "parada"], "") ?? "",
    detail: pick(s, ["detail", "detalle"], "") ?? "",
    how_to_get: pick(s, ["how_to_get", "como_llegar", "howToGet"], "") ?? "",
    est_duration: pick(s, ["est_duration", "est", "duracion", "tiempo"], "") ?? "",
    notes: pick(s, ["notes", "notas", "reserva"], "") ?? "",
    done: !!s.done,
  };
}

/**
 * @returns {{ ok: true, data: object, warnings: string[] } | { ok: false, error: string, warnings: string[] }}
 */
export function validateItineraryJson(raw) {
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
      stops.push({
        kind: asKind(s.kind),
        name,
        detail: asStr(s.detail, 500),
        how_to_get: asStr(s.how_to_get, 500),
        est_duration: asStr(s.est_duration, 80),
        notes: asStr(s.notes, MAX_STR),
        done: !!s.done,
      });
    }

    days.push({
      day_number,
      title: asStr(d.title, 200),
      base: asStr(d.base, 120),
      stay_label: asStr(d.stay_label, 200),
      hub: asStr(d.hub, 200),
      notes: asStr(d.notes, MAX_STR),
      stops,
    });
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
