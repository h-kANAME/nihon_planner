/**
 * Export determinístico MD ← JSON/SQL canónico (sin AI).
 * Columna Ubicación / Hecho: docs/req_mapa.md §7.1.
 */

import { MAX_STR } from "./schema.mjs";

export function itineraryToMarkdown(canonical) {
  const title = canonical.title || "Itinerario";
  const lines = [`# ${title}`, ""];

  if (canonical.anchor_date) {
    lines.push(`**Fecha ancla (Día 1):** ${canonical.anchor_date}`, "");
  }

  lines.push(
    "Plan de viaje: cada día tiene **alojamiento**, **paradas** y espacio para notas.",
    "",
    "---",
    "",
  );

  const days = [...(canonical.days || [])].sort((a, b) => a.day_number - b.day_number);
  for (const d of days) {
    const heading = d.title ? `## Día ${d.day_number} — ${d.title}` : `## Día ${d.day_number}`;
    lines.push(heading, "");
    if (d.base) lines.push(`**Base:** ${d.base}`);
    if (d.stay_label) {
      lines.push(`**Alojamiento:** ${d.stay_label}`);
      const stayLoc = formatStayLocation(d);
      if (stayLoc) lines.push(`**Ubicación alojamiento:** ${stayLoc}`);
    }
    if (d.hub) lines.push(`**Hub logístico:** ${d.hub}`);
    if (d.base || d.stay_label || d.hub) lines.push("");

    const stops = d.stops || [];
    if (stops.length) {
      lines.push(
        "#### Paradas",
        "",
        "| # | Parada | Detalle | Cómo llegar | Est. | Notas | Kind | Hecho | Ubicación |",
      );
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
      stops.forEach((s, i) => {
        const n =
          s.kind === "hub_out" ? "—" : s.kind === "hub_back" ? "—" : String(i + 1);
        const hecho = s.done ? "x" : "";
        const ubicacion = formatLocationToken(s);
        lines.push(
          `| ${n} | ${esc(s.name)} | ${esc(s.detail)} | ${esc(s.how_to_get)} | ${esc(s.est_duration)} | ${esc(clipNotes(s.notes))} | ${esc(s.kind || "stop")} | ${hecho} | ${ubicacion} |`,
        );
      });
      lines.push("");
    }

    if (d.notes) {
      lines.push("#### Notas del día", "", clipNotes(d.notes), "");
    }

    lines.push("---", "");
  }

  return lines.join("\n").trim() + "\n";
}

/** Tokens simétricos con el import (§7.1): lat,lng · ~lat,lng · — · stay · vacío. */
export function formatLocationToken(stop) {
  const mode = stop?.location_mode || "pending";
  if (mode === "not_applicable") return "—";
  if (mode === "inherit_stay") return "stay";
  if (mode === "pending") return "";
  if (mode === "coords" && stop.lat != null && stop.lng != null) {
    return formatCoords(stop.lat, stop.lng, stop.location_precision);
  }
  return "";
}

export function formatStayLocation(day) {
  if (day?.stay_lat == null || day?.stay_lng == null) return "";
  return formatCoords(day.stay_lat, day.stay_lng, day.stay_precision);
}

function formatCoords(lat, lng, precision) {
  const coords = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  return precision === "view" ? `~${coords}` : coords;
}

function clipNotes(v) {
  return String(v ?? "").slice(0, MAX_STR);
}

function esc(v) {
  return String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}
