/**
 * Guarda anti-pérdida §7.4: cuenta celdas importables del MD y paradas resueltas en DB.
 */

import { parseLocationCell, splitRow } from "./heuristic.mjs";

/** Tokens válidos: lat,lng · ~lat,lng · stay · — (no vacío, no basura). */
export function isImportableLocationToken(raw) {
  const mode = parseLocationCell(raw).mode;
  return mode === "coords" || mode === "inherit_stay" || mode === "not_applicable";
}

/**
 * Celdas no vacías de columna Ubicación + líneas `**Ubicación alojamiento:**` con token válido.
 * Cabecera sola / celdas vacías → 0 (mira datos, no cabeceras).
 */
export function countImportableLocationCells(markdown) {
  const src = String(markdown || "").replace(/\r\n/g, "\n");
  let count = 0;

  const stayRe = /^\*\*Ubicación alojamiento:\*\*\s*(.*)$/gim;
  let m;
  while ((m = stayRe.exec(src))) {
    const val = (m[1] || "").trim();
    if (val && isImportableLocationToken(val)) count += 1;
  }

  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const header = splitRow(line).map((c) => c.toLowerCase());
    const ubicIdx = header.findIndex(
      (c) => c.includes("ubicaci") || c === "ubicación" || c === "ubicacion",
    );
    if (ubicIdx < 0) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j].trim();
      if (!row.startsWith("|")) break;
      if (/^[-:\s|\\]+$/.test(row.replace(/\\\|/g, "").replace(/\|/g, ""))) continue;
      const cells = splitRow(row);
      const val = (cells[ubicIdx] || "").trim();
      if (val && isImportableLocationToken(val)) count += 1;
    }
  }

  return count;
}

/** Paradas resueltas §4.3: coords | not_applicable | inherit_stay con stay ubicado. */
export function countResolvedStops(db) {
  const rows = db
    .prepare(
      `SELECT s.location_mode AS location_mode, d.stay_lat AS stay_lat, d.stay_lng AS stay_lng
       FROM itinerary_stops s
       JOIN itinerary_days d ON d.id = s.day_id`,
    )
    .all();
  let n = 0;
  for (const r of rows) {
    const mode = r.location_mode || "pending";
    if (mode === "coords" || mode === "not_applicable") {
      n += 1;
    } else if (mode === "inherit_stay" && r.stay_lat != null && r.stay_lng != null) {
      n += 1;
    }
  }
  return n;
}

/**
 * @returns {{ blocked: false, resolved: number, importable: number, discardWarning: string|null }
 *         | { blocked: true, resolved: number, importable: number }}
 */
export function evaluateLocationsAtRisk(markdown, db, { force = false } = {}) {
  const importable = countImportableLocationCells(markdown);
  const resolved = countResolvedStops(db);
  if (importable === 0 && resolved > 0 && !force) {
    return { blocked: true, resolved, importable };
  }
  const discardWarning =
    force && importable === 0 && resolved > 0
      ? `${resolved} ubicaciones descartadas`
      : null;
  return { blocked: false, resolved, importable, discardWarning };
}
