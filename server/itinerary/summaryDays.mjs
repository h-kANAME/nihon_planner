/**
 * Días que viven solo en tablas resumen (Día | Zona | Anclas),
 * sin heading ### Día N.
 */

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function cleanCell(s) {
  return String(s || "")
    .replace(/\*\*/g, "")
    .replace(/★/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDayCell(cell) {
  const m = /(\d{1,3})/.exec(cleanCell(cell));
  return m ? Number(m[1]) : null;
}

function splitAnchors(cell) {
  return cleanCell(cell)
    .split(/\s*[·•|]\s*|\s+·\s+/)
    .map((p) => p.trim())
    .filter((p) => p && !/^[-—–]+$/.test(p));
}

/**
 * Contexto de sección (## Título + Base) previo a una tabla.
 * @returns {{ heading: string, base: string, stay: string }}
 */
function sectionContextBefore(src, index) {
  const before = src.slice(0, index);
  const headingMatch = [...before.matchAll(/^##\s+(?!#\s*D[ií]a)(.+)$/gim)].pop();
  const heading = headingMatch ? headingMatch[1].trim() : "";
  const tail = before.slice(Math.max(0, before.length - 800));
  const base =
    /\*\*Base[^*]*:\*\*\s*([^\n—]+)/i.exec(tail)?.[1]?.replace(/\*\*/g, "").trim() ||
    /Base\s*\([^)]*\):\s*([^\n—]+)/i.exec(tail)?.[1]?.trim() ||
    heading ||
    "";
  const stay = base.split(/[—–-]/)[0].trim().slice(0, 200);
  return { heading, base: base.slice(0, 200), stay };
}

/**
 * @returns {{ day_number: number, title: string, notes: string, anchors: string[], base: string, stay_label: string, hub: string }[]}
 */
export function parseSummaryDayTables(markdown) {
  const src = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const out = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    const header = splitRow(line).map((c) => c.toLowerCase());
    const joined = header.join(" ");
    const isSummary =
      (joined.includes("día") || joined.includes("dia")) &&
      (joined.includes("zona") ||
        joined.includes("propuesta") ||
        joined.includes("ancla") ||
        joined.includes("atracci"));
    if (!isSummary) continue;

    const dayIdx = header.findIndex((c) => c.includes("día") || c.includes("dia"));
    const titleIdx = header.findIndex(
      (c) => c.includes("zona") || c.includes("propuesta") || c.includes("título") || c.includes("titulo"),
    );
    const anchorsIdx = header.findIndex((c) => c.includes("ancla") || c.includes("parada"));
    const notesIdx = header.findIndex((c) => c.includes("nota"));
    if (dayIdx < 0) continue;

    const tableStart = lines.slice(0, i + 1).join("\n").length;
    const ctx = sectionContextBefore(src, tableStart);

    let j = i + 1;
    for (; j < lines.length; j++) {
      const row = lines[j].trim();
      if (!row.startsWith("|")) break;
      if (/^[-:\s|]+$/.test(row.replace(/\|/g, ""))) continue;
      const cells = splitRow(row);
      const day_number = parseDayCell(cells[dayIdx] ?? cells[0]);
      if (!day_number || !Number.isInteger(day_number)) continue;
      if (seen.has(day_number)) continue;

      const title = cleanCell(cells[titleIdx >= 0 ? titleIdx : 1] || "").slice(0, 200);
      const notes = cleanCell(cells[notesIdx >= 0 ? notesIdx : cells.length - 1] || "").slice(0, 500);
      const anchors = splitAnchors(cells[anchorsIdx >= 0 ? anchorsIdx : 2] || "");
      if (!title && !anchors.length) continue;

      seen.add(day_number);
      out.push({
        day_number,
        title: title || `Día ${day_number}`,
        notes,
        anchors,
        base: ctx.heading || ctx.base,
        stay_label: ctx.stay,
        hub: ctx.stay,
      });
    }
    i = j - 1;
  }

  return out.sort((a, b) => a.day_number - b.day_number);
}

/** Markdown sintético para que AI/heurística traten el día como un chunk normal. */
export function synthesizeSummaryDayMarkdown(day) {
  const stops = (day.anchors || []).map((name, idx) => {
    const isOut = /salida|kix|aeropuerto/i.test(name);
    const isBack = /retorno|regreso|check-?in/i.test(name);
    const kind = isOut ? "hub_out" : isBack ? "hub_back" : "stop";
    return `| ${idx + 1} | **${name}** | | | ${kind === "stop" ? "" : kind} |`;
  });

  const table =
    stops.length > 0
      ? `| Orden | Parada | Cómo llegar | Est. en sitio | Notas |\n| --- | --- | --- | --- | --- |\n${stops.join("\n")}`
      : `| Orden | Parada | Cómo llegar | Est. en sitio | Notas |\n| --- | --- | --- | --- | --- |\n| 1 | **${day.title}** | | | |`;

  return [
    `### Día ${day.day_number} — ${day.title}`,
    "",
    day.stay_label ? `**Alojamiento:** ${day.stay_label}` : "",
    day.hub ? `**Hub logístico:** ${day.hub}` : "",
    "",
    "#### Orden eficiente propuesto",
    "",
    table,
    "",
    "#### Notas del día",
    "",
    day.notes ? `- ${day.notes}` : "- (desde tabla resumen del Markdown)",
    "",
  ]
    .filter((l, idx, arr) => !(l === "" && arr[idx - 1] === ""))
    .join("\n")
    .trim();
}

/**
 * Quita del chunk tablas/secciones resumen cuyos day_number no son el del chunk.
 */
export function stripForeignSummaryTables(text, ownDayNumber) {
  const src = String(text || "");
  const lines = src.split("\n");
  const keep = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|")) {
      const header = splitRow(line).map((c) => c.toLowerCase());
      const joined = header.join(" ");
      const isSummary =
        (joined.includes("día") || joined.includes("dia")) &&
        (joined.includes("zona") ||
          joined.includes("propuesta") ||
          joined.includes("ancla") ||
          joined.includes("atracci"));
      if (isSummary) {
        const dayIdx = header.findIndex((c) => c.includes("día") || c.includes("dia"));
        const rowDays = [];
        let j = i + 1;
        for (; j < lines.length; j++) {
          const row = lines[j].trim();
          if (!row.startsWith("|")) break;
          if (/^[-:\s|]+$/.test(row.replace(/\|/g, ""))) continue;
          const n = parseDayCell(splitRow(row)[dayIdx] ?? "");
          if (n) rowDays.push(n);
        }
        const foreign = rowDays.some((n) => n !== ownDayNumber);
        if (foreign) {
          // También dropear el bloquequote / heading previo inmediato de “por completar”
          while (keep.length && /^\s*(>|\*\*Detalle|#{2}\s+)/.test(keep[keep.length - 1])) {
            const last = keep[keep.length - 1];
            if (/^#{2,3}\s*D[ií]a\s+/i.test(last)) break;
            keep.pop();
            if (/^##\s+/.test(last) && !/^##\s*D[ií]a/i.test(last)) break;
          }
          i = j;
          continue;
        }
      }
    }
    keep.push(line);
    i += 1;
  }

  return keep.join("\n").trim();
}

/**
 * @param {{ dayNumber: number|null, text: string }[]} headingChunks
 * @returns {{ dayNumber: number|null, text: string, fromSummary?: boolean }[]}
 */
export function augmentChunksWithSummaryDays(markdown, headingChunks) {
  const existing = new Set(
    headingChunks.map((c) => c.dayNumber).filter((n) => n != null && Number.isInteger(n)),
  );

  const cleaned = headingChunks.map((c) => ({
    dayNumber: c.dayNumber,
    text:
      c.dayNumber != null
        ? stripForeignSummaryTables(c.text, c.dayNumber)
        : c.text,
    fromSummary: false,
  }));

  const extras = [];
  for (const day of parseSummaryDayTables(markdown)) {
    if (existing.has(day.day_number)) continue;
    existing.add(day.day_number);
    extras.push({
      dayNumber: day.day_number,
      text: synthesizeSummaryDayMarkdown(day),
      fromSummary: true,
    });
  }

  return [...cleaned, ...extras].sort((a, b) => {
    const an = a.dayNumber ?? 9999;
    const bn = b.dayNumber ?? 9999;
    return an - bn;
  });
}
