/**
 * Export determinístico MD ← JSON/SQL canónico (sin AI).
 */

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
    if (d.stay_label) lines.push(`**Alojamiento:** ${d.stay_label}`);
    if (d.hub) lines.push(`**Hub logístico:** ${d.hub}`);
    if (d.base || d.stay_label || d.hub) lines.push("");

    const stops = d.stops || [];
    if (stops.length) {
      lines.push("#### Paradas", "", "| # | Parada | Detalle | Cómo llegar | Est. | Notas | Kind |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      stops.forEach((s, i) => {
        const n =
          s.kind === "hub_out" ? "—" : s.kind === "hub_back" ? "—" : String(i + 1);
        lines.push(
          `| ${n} | ${esc(s.name)} | ${esc(s.detail)} | ${esc(s.how_to_get)} | ${esc(s.est_duration)} | ${esc(s.notes)} | ${esc(s.kind || "stop")} |`,
        );
      });
      lines.push("");
    }

    if (d.notes) {
      lines.push("#### Notas del día", "", d.notes, "");
    }

    lines.push("---", "");
  }

  return lines.join("\n").trim() + "\n";
}

function esc(v) {
  return String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}
