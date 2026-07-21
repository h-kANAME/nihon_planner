/**
 * Parser local determinístico: headings ### Día N → días/paradas desde tablas MD.
 */

export function heuristicDaysFromChunk(markdown, dayHints = []) {
  const parts = String(markdown || "")
    .split(/\n(?=#{2,3}\s*D[ií]a\s+\d+)/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks = parts.length ? parts : [String(markdown || "")];
  const days = [];

  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i];
    const m = /#{2,3}\s*D[ií]a\s+(\d+)\s*[—\-–:]?\s*(.*)$/im.exec(text);
    const day_number = m ? Number(m[1]) : dayHints[i] || dayHints[0] || null;
    if (!day_number || !Number.isInteger(day_number)) continue;

    const title = (m?.[2] || "").replace(/[#*]/g, "").trim();
    const stay =
      /\*\*Alojamiento:\*\*\s*(.+)/i.exec(text)?.[1]?.replace(/\*\*/g, "").trim() ||
      /Alojamiento:\s*(.+)/i.exec(text)?.[1]?.trim() ||
      "";
    const hub =
      /\*\*Hub[^:]*:\*\*\s*(.+)/i.exec(text)?.[1]?.replace(/\*\*/g, "").trim() ||
      /Hub logístico:\s*(.+)/i.exec(text)?.[1]?.trim() ||
      "";

    const notesMatch = /####\s*Notas[^\n]*\n([\s\S]*?)(?=\n#{2,4}\s|\n---|$)/i.exec(text);
    const notes = notesMatch
      ? notesMatch[1]
          .split("\n")
          .map((l) => l.replace(/^[-*]\s*/, "").trim())
          .filter(Boolean)
          .join("\n")
          .slice(0, 2000)
      : "";

    const stops = parseBestStopTable(text);
    days.push({
      day_number,
      title,
      base: "",
      stay_label: stay.slice(0, 200),
      hub: hub.slice(0, 200),
      notes,
      stops: stops.length
        ? stops
        : [{ kind: "stop", name: title || `Día ${day_number}`, detail: "", how_to_get: "", est_duration: "", notes: "" }],
    });
  }

  return days;
}

/** Elige la mejor tabla de paradas/orden (evita tablas de clusters/análisis). */
function parseBestStopTable(text) {
  const candidates = findStopTableCandidates(text);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].stops;
}

function findStopTableCandidates(text) {
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
    let j = i + 1;
    for (; j < lines.length; j++) {
      const row = lines[j].trim();
      if (!row.startsWith("|")) break;
      if (/^[-:\s|]+$/.test(row.replace(/\|/g, ""))) continue;
      const stop = rowToStop(splitRow(row), cols);
      if (stop) stops.push(stop);
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
    if (sectionCtx.includes("orden eficiente") || sectionCtx.includes("orden logístico")) score += 10;
    if (sectionCtx.includes("paradas (orden")) score += 7;
    if (headerJoined.includes("cluster") || sectionCtx.includes("cluster") || sectionCtx.includes("análisis")) {
      score -= 40;
    }
    if (headerJoined.includes("relación espacial") || headerJoined.includes("tiempo interno")) score -= 40;

    out.push({ score, stops, start: i });
    i = j - 1;
  }

  return out;
}

function rowToStop(cells, cols) {
  const cell = (idx) => (idx >= 0 && cells[idx] != null ? String(cells[idx]) : "");
  const nameIdx = cols.findIndex((c) => c.includes("parada") || c.includes("lugar"));
  const detailIdx = cols.findIndex((c) => c.includes("detalle") || c.includes("detail"));
  const howIdx = cols.findIndex((c) => c.includes("llegar") || c.includes("cómo") || c.includes("como"));
  const estIdx = cols.findIndex(
    (c) => (c.includes("est") && c.includes("sitio")) || c === "est." || c.startsWith("est "),
  );
  const notesIdx = cols.findIndex((c) => c.includes("nota") || c.includes("reserva"));
  const ordenIdx = cols.findIndex((c) => c.includes("orden") || c === "#" || c === "n");

  const name = (nameIdx >= 0 ? cell(nameIdx) : cells[1] || cells[0] || "")
    .replace(/\*\*/g, "")
    .trim();
  if (!name || /^[-—–]+$/.test(name)) return null;
  if (/^(parada|orden|#)$/i.test(name)) return null;

  const ordenCell = ordenIdx >= 0 ? cell(ordenIdx) : cells[0] || "";
  const isHubOut = /salida/i.test(name) || /salida/i.test(ordenCell);
  const isHubBack = /retorno|regreso/i.test(name) || /retorno/i.test(ordenCell);

  return {
    kind: isHubOut ? "hub_out" : isHubBack ? "hub_back" : "stop",
    name: name.slice(0, 200),
    detail: cell(detailIdx).replace(/\*\*/g, "").trim().slice(0, 500),
    how_to_get: cell(howIdx).replace(/\*\*/g, "").trim().slice(0, 500),
    est_duration: cell(estIdx).replace(/\*\*/g, "").trim().slice(0, 80),
    notes: cell(notesIdx).replace(/\*\*/g, "").trim().slice(0, 500),
  };
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
