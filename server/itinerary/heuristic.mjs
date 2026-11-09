/**
 * Parser local determinístico: headings ### Día N → días/paradas desde tablas MD.
 * Ubicaciones/Hecho se extraen aparte (§7.2) → locationsByDay; no van a la AI.
 */

import { MAX_STR } from "./schema.mjs";

/** Celda Ubicación: lat,lng opcionalmente prefijada con ~ (§7.2). */
const COORDS_CELL_RE = /^\s*(~?)\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Quita el apéndice v1.0 `## Ubicaciones`, parsea lugares y los deja para resolver `@slug`.
 * @returns {{ markdown: string, places: Map<string, { lat: number, lng: number, precision: string, raw_input: string }> }}
 */
export function stripLocationsAppendix(markdown) {
  const src = String(markdown || "").replace(/\r\n/g, "\n");
  const m = /^##\s+Ubicaciones\s*$/im.exec(src);
  if (!m) {
    return { markdown: src, places: new Map() };
  }

  const start = m.index;
  const afterHeading = src.slice(start + m[0].length);
  const nextH2 = /^##\s+\S/m.exec(afterHeading);
  const end = nextH2 ? start + m[0].length + nextH2.index : src.length;
  const section = src.slice(start, end);
  const places = parseLocationsAppendixSection(section);

  const before = src.slice(0, start).replace(/\s+$/, "");
  const after = src.slice(end).replace(/^\s+/, "");
  const markdownOut = [before, after].filter(Boolean).join("\n\n");
  return { markdown: markdownOut, places };
}

function parseLocationsAppendixSection(section) {
  const places = new Map();
  const lines = section.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const header = splitRow(line).map((c) => c.toLowerCase());
    const slugIdx = header.findIndex(
      (c) => c.includes("slug") || c === "@" || c.includes("@slug"),
    );
    const locIdx = header.findIndex(
      (c) =>
        c.includes("ubic") ||
        c.includes("coord") ||
        c.includes("lat") ||
        c === "location",
    );
    if (slugIdx < 0 || locIdx < 0) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j].trim();
      if (!row.startsWith("|")) break;
      if (/^[-:\s|\\]+$/.test(row.replace(/\\\|/g, "").replace(/\|/g, ""))) continue;
      const cells = splitRow(row);
      const slugRaw = (cells[slugIdx] || "").replace(/\*\*/g, "").trim();
      const locRaw = (cells[locIdx] || "").trim();
      const key = normalizeSlugKey(slugRaw);
      if (!key) continue;
      const parsed = parseLocationCell(locRaw);
      if (parsed.mode !== "coords") continue;
      const entry = {
        lat: parsed.lat,
        lng: parsed.lng,
        precision: parsed.precision || "place",
        raw_input: parsed.raw_input || locRaw,
      };
      places.set(key, entry);
      places.set(`@${key}`, entry);
    }
    break;
  }

  // Lista: - @slug — Nombre: lat,lng  /  - `@slug`: lat,lng
  for (const line of lines) {
    const lm =
      /^[-*]\s+`?@([\w.-]+)`?\s*[:—–-]\s*(?:[^:]*:\s*)?(.+)$/i.exec(line.trim()) ||
      /^[-*]\s+\*\*?@([\w.-]+)\*\*?\s*[:—–-]\s*(.+)$/i.exec(line.trim());
    if (!lm) continue;
    const key = lm[1].toLowerCase();
    const parsed = parseLocationCell(lm[2].trim());
    if (parsed.mode !== "coords") continue;
    const entry = {
      lat: parsed.lat,
      lng: parsed.lng,
      precision: parsed.precision || "place",
      raw_input: parsed.raw_input || lm[2].trim(),
    };
    places.set(key, entry);
    places.set(`@${key}`, entry);
  }

  return places;
}

function normalizeSlugKey(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^@/, "");
  return s ? s.toLowerCase() : "";
}

/**
 * Orden §7.2: — → stay → coords → unparsable → vacío.
 * Si `places` tiene `@slug`, resuelve a coords.
 */
export function parseLocationCell(raw, { places } = {}) {
  const s = String(raw ?? "").trim();
  if (s === "—" || s === "–") {
    return { mode: "not_applicable" };
  }
  if (/^stay$/i.test(s)) {
    return { mode: "inherit_stay" };
  }

  const coords = COORDS_CELL_RE.exec(s);
  if (coords) {
    const tilde = coords[1] === "~";
    return {
      mode: "coords",
      lat: Number(coords[2]),
      lng: Number(coords[3]),
      precision: tilde ? "view" : "place",
      raw_input: s,
    };
  }

  if (places && places.size) {
    const slugKey = s.startsWith("@") ? s.toLowerCase() : `@${s.toLowerCase()}`;
    const hit = places.get(slugKey) || places.get(s.replace(/^@/, "").toLowerCase());
    if (hit && /^@[\w.-]+$/i.test(s)) {
      return {
        mode: "coords",
        lat: hit.lat,
        lng: hit.lng,
        precision: hit.precision || "place",
        raw_input: hit.raw_input || s,
      };
    }
  }

  if (s) {
    return {
      mode: "pending",
      warning: "LOCATION_UNPARSABLE",
      raw_input: s,
    };
  }
  return { mode: "pending" };
}

/**
 * @returns {{ days: object[], locationsByDay: Map<number, DayLocations>, warnings: string[] }}
 * DayLocations = { stay_location: object|null, stops: [{ index, name, location, done }] }
 */
export function heuristicParseChunk(markdown, dayHints = [], { places } = {}) {
  const parts = String(markdown || "")
    .split(/\n(?=#{2,3}\s*D[ií]a\s+\d+)/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks = parts.length ? parts : [String(markdown || "")];
  const days = [];
  /** @type {Map<number, { stay_location: object|null, stops: object[] }>} */
  const locationsByDay = new Map();
  const warnings = [];

  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i];
    const m = /#{2,3}\s*D[ií]a\s+(\d+)\s*[—\-–:]?\s*(.*)$/im.exec(text);
    const day_number = m ? Number(m[1]) : dayHints[i] || dayHints[0] || null;
    if (!day_number || !Number.isInteger(day_number)) continue;

    const title = (m?.[2] || "").replace(/[#*]/g, "").trim();
    const base =
      /^\*\*Base:\*\*\s*(.+)$/im.exec(text)?.[1]?.replace(/\*\*/g, "").trim() || "";
    // Anclado: el fallback /Alojamiento:/i capturaba "**Ubicación alojamiento:**"
    const stay =
      /^\*\*Alojamiento:\*\*\s*(.+)$/im.exec(text)?.[1]?.replace(/\*\*/g, "").trim() ||
      "";
    const hub =
      /^\*\*Hub[^:]*:\*\*\s*(.+)$/im.exec(text)?.[1]?.replace(/\*\*/g, "").trim() ||
      /^\*\*Hub logístico:\*\*\s*(.+)$/im.exec(text)?.[1]?.replace(/\*\*/g, "").trim() ||
      "";

    const stayLocRaw =
      /^\*\*Ubicación alojamiento:\*\*\s*(.+)$/im.exec(text)?.[1]?.trim() || "";
    let stay_location = null;
    if (stayLocRaw) {
      stay_location = parseLocationCell(stayLocRaw, { places });
      if (stay_location.warning) {
        warnings.push(`Día ${day_number}: stay ${stay_location.warning}: ${stayLocRaw}`);
      }
    }

    const notesMatch = /####\s*Notas[^\n]*\n([\s\S]*?)(?=\n#{2,4}\s|\n---|$)/i.exec(text);
    const notes = notesMatch
      ? notesMatch[1]
          .split("\n")
          .map((l) => l.replace(/^[-*]\s*/, "").trim())
          .filter(Boolean)
          .join("\n")
          .slice(0, MAX_STR)
      : "";

    const { stops, locationStops, tableWarnings } = parseBestStopTable(text, { places });
    for (const w of tableWarnings) {
      warnings.push(`Día ${day_number}: ${w}`);
    }

    locationsByDay.set(day_number, {
      stay_location,
      stops: locationStops,
    });

    days.push({
      day_number,
      title,
      base: base.slice(0, 200),
      stay_label: stay.slice(0, 200),
      hub: hub.slice(0, 200),
      notes,
      // Sin location/done en stops: van en locationsByDay (§7.2 / §7.3)
      stops: stops.length
        ? stops
        : [{ kind: "stop", name: title || `Día ${day_number}`, detail: "", how_to_get: "", est_duration: "", notes: "" }],
    });
  }

  return { days, locationsByDay, warnings };
}

/** Compat: solo el array de días (tests / callers viejos). */
export function heuristicDaysFromChunk(markdown, dayHints = [], opts = {}) {
  return heuristicParseChunk(markdown, dayHints, opts).days;
}

/** Elige la mejor tabla de paradas/orden (evita tablas de clusters/análisis). */
function parseBestStopTable(text, { places } = {}) {
  const candidates = findStopTableCandidates(text, { places });
  if (!candidates.length) {
    return { stops: [], locationStops: [], tableWarnings: [] };
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    stops: best.stops,
    locationStops: best.locationStops,
    tableWarnings: best.tableWarnings,
  };
}

function findStopTableCandidates(text, { places } = {}) {
  const lines = text.split("\n").map((l) => l.trim());
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) continue;
    const headerCells = splitRow(line);
    if (!headerCells.length) continue;
    const headerJoined = headerCells.join(" ").toLowerCase();
    const looksLikeStops =
      headerJoined.includes("parada") ||
      headerJoined.includes("orden") ||
      (headerJoined.includes("#") && headerJoined.includes("detalle"));
    if (!looksLikeStops) continue;

    const cols = headerCells.map((c) => c.toLowerCase());
    const stops = [];
    const locationStops = [];
    const tableWarnings = [];
    let j = i + 1;
    let stopIndex = 0;
    for (; j < lines.length; j++) {
      const row = lines[j].trim();
      if (!row.startsWith("|")) break;
      if (/^[-:\s|\\]+$/.test(row.replace(/\\\|/g, "").replace(/\|/g, ""))) continue;
      const parsed = rowToStop(splitRow(row), cols, { places });
      if (!parsed) continue;
      stops.push(parsed.stop);
      locationStops.push({
        index: stopIndex,
        name: parsed.stop.name,
        location: parsed.location,
        done: parsed.done,
      });
      if (parsed.location?.warning) {
        tableWarnings.push(
          `${parsed.location.warning} en «${parsed.stop.name}»: ${parsed.location.raw_input || ""}`,
        );
      }
      stopIndex += 1;
    }

    if (!stops.length) {
      i = j - 1;
      continue;
    }

    const sectionCtx = lines.slice(Math.max(0, i - 3), i).join(" ").toLowerCase();
    let score = stops.length;
    if (headerJoined.includes("cómo llegar") || headerJoined.includes("como llegar")) score += 8;
    if (headerJoined.includes("est") && headerJoined.includes("sitio")) score += 5;
    if (headerJoined.includes("orden")) score += 6;
    if (headerJoined.includes("ubic")) score += 4;
    if (headerJoined.includes("hecho")) score += 2;
    if (sectionCtx.includes("orden eficiente") || sectionCtx.includes("orden logístico")) score += 10;
    if (sectionCtx.includes("paradas (orden")) score += 7;
    if (headerJoined.includes("cluster") || sectionCtx.includes("cluster") || sectionCtx.includes("análisis")) {
      score -= 40;
    }
    if (headerJoined.includes("relación espacial") || headerJoined.includes("tiempo interno")) score -= 40;

    out.push({ score, stops, locationStops, tableWarnings, start: i });
    i = j - 1;
  }

  return out;
}

function rowToStop(cells, cols, { places } = {}) {
  const cell = (idx) => (idx >= 0 && cells[idx] != null ? String(cells[idx]) : "");
  const nameIdx = cols.findIndex((c) => c.includes("parada") || c.includes("lugar"));
  const detailIdx = cols.findIndex((c) => c.includes("detalle") || c.includes("detail"));
  const howIdx = cols.findIndex((c) => c.includes("llegar") || c.includes("cómo") || c.includes("como"));
  const estIdx = cols.findIndex(
    (c) => (c.includes("est") && c.includes("sitio")) || c === "est." || c.startsWith("est "),
  );
  const notesIdx = cols.findIndex(
    (c) => (c.includes("nota") || c.includes("reserva")) && !c.includes("ubic"),
  );
  const ordenIdx = cols.findIndex((c) => c.includes("orden") || c === "#" || c === "n");
  const hechoIdx = cols.findIndex((c) => c.includes("hecho") || c === "done");
  const ubicIdx = cols.findIndex((c) => c.includes("ubicaci") || c === "ubicación" || c === "ubicacion");

  const name = (nameIdx >= 0 ? cell(nameIdx) : cells[1] || cells[0] || "")
    .replace(/\*\*/g, "")
    .trim();
  if (!name || /^[-—–]+$/.test(name)) return null;
  if (/^(parada|orden|#)$/i.test(name)) return null;

  const ordenCell = ordenIdx >= 0 ? cell(ordenIdx) : cells[0] || "";
  const isHubOut = /salida/i.test(name) || /salida/i.test(ordenCell);
  const isHubBack = /retorno|regreso/i.test(name) || /retorno/i.test(ordenCell);

  const hechoRaw = hechoIdx >= 0 ? cell(hechoIdx).trim() : "";
  const done = /^x$/i.test(hechoRaw) || /^✓|✔|done|si|sí$/i.test(hechoRaw);

  const ubicRaw = ubicIdx >= 0 ? cell(ubicIdx) : "";
  const location = parseLocationCell(ubicRaw, { places });

  return {
    stop: {
      kind: isHubOut ? "hub_out" : isHubBack ? "hub_back" : "stop",
      name: name.slice(0, 200),
      detail: cell(detailIdx).replace(/\*\*/g, "").trim().slice(0, MAX_STR),
      how_to_get: cell(howIdx).replace(/\*\*/g, "").trim().slice(0, MAX_STR),
      est_duration: cell(estIdx).replace(/\*\*/g, "").trim().slice(0, 80),
      notes: cell(notesIdx).replace(/\*\*/g, "").trim().slice(0, MAX_STR),
    },
    location,
    done,
  };
}

/**
 * Corta por `|` no escapado y des-escapa `\|` (§7.2).
 */
export function splitRow(line) {
  let s = String(line || "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !isEscapedPipeAt(s, s.length - 1)) {
    s = s.slice(0, -1);
  }

  const cells = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      buf += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

/** `|` escapado si hay un número impar de `\` inmediatamente antes. */
function isEscapedPipeAt(s, pipeIdx) {
  let bs = 0;
  for (let i = pipeIdx - 1; i >= 0 && s[i] === "\\"; i--) bs += 1;
  return bs % 2 === 1;
}
