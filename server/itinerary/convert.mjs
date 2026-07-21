/**
 * Import MD → JSON canónico (híbrido fijo):
 * 1) parser local (estructura)
 * 2) AI meta + AI refine por chunk (siempre)
 */

import { CONTINUE_JSON_PROMPT } from "../ai/provider.mjs";
import { extractJsonObject, validateItineraryJson } from "./schema.mjs";
import { heuristicDaysFromChunk } from "./heuristic.mjs";
import { augmentChunksWithSummaryDays } from "./summaryDays.mjs";
import {
  ITINERARY_META_SYSTEM,
  ITINERARY_REFINE_SYSTEM,
  ITINERARY_IMPORT_SYSTEM,
  itineraryImportUserMessage,
  itineraryMetaUserMessage,
  itineraryRefineUserMessage,
} from "./importPrompt.mjs";

const IMPORT_MAX_TOKENS = 8192;
const IMPORT_CONTINUATIONS = 6;
const IMPORT_WALL_MS = 420_000;
const DAYS_PER_CHUNK = 2;

/**
 * Parte el MD por headings de día (### Día N / ## Día N).
 * @returns {{ preamble: string, chunks: { dayNumber: number|null, text: string }[] }}
 */
export function splitMarkdownByDays(markdown) {
  const src = String(markdown || "").replace(/\r\n/g, "\n");
  const re = /(?:^|\n)(#{2,3}\s*D[ií]a\s+(\d+)[^\n]*)/gi;
  const matches = [...src.matchAll(re)];
  if (!matches.length) {
    return { preamble: src, chunks: [{ dayNumber: null, text: src }] };
  }

  const preamble = src.slice(0, matches[0].index).trim();
  const chunks = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
    const end = i + 1 < matches.length ? matches[i + 1].index : src.length;
    const text = src.slice(start, end).trim();
    chunks.push({ dayNumber: Number(m[2]), text });
  }
  return { preamble, chunks };
}

function batchChunks(chunks, size) {
  const out = [];
  for (let i = 0; i < chunks.length; i += size) {
    out.push(chunks.slice(i, i + size));
  }
  return out;
}

function parseLooseMeta(content) {
  const raw = extractJsonObject(content);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return {
      title: typeof obj.title === "string" ? obj.title : "",
      anchor_date: obj.anchor_date ?? null,
    };
  } catch {
    return null;
  }
}

function validateDaysArrayPayload(content) {
  const raw = extractJsonObject(content);
  if (!raw) return { ok: false, days: [], warnings: [] };
  try {
    const obj = JSON.parse(raw);
    const days = Array.isArray(obj) ? obj : obj.days;
    if (!Array.isArray(days)) return { ok: false, days: [], warnings: [] };
    const v = validateItineraryJson({ title: "tmp", anchor_date: null, days });
    if (!v.ok) return { ok: false, days: [], warnings: v.warnings };
    return { ok: true, days: v.data.days, warnings: v.warnings };
  } catch {
    return { ok: false, days: [], warnings: [] };
  }
}

function tryParseDays(content) {
  const validated = validateItineraryJson(content);
  if (validated.ok) return { ok: true, days: validated.data.days, warnings: validated.warnings };
  const daysOnly = validateDaysArrayPayload(content);
  if (daysOnly.ok && daysOnly.days?.length) {
    return { ok: true, days: daysOnly.days, warnings: daysOnly.warnings };
  }
  return { ok: false, days: [], warnings: validated.warnings || [] };
}

function pickNonEmpty(a, b) {
  const as = String(a || "").trim();
  const bs = String(b || "").trim();
  if (as && !/^d[ií]a\s*\d+$/i.test(as)) return as;
  if (bs) return bs;
  return as || bs;
}

/**
 * Fusiona día refinado por AI sobre la base heurística.
 * Si AI omite un día o deja stops vacíos, se conserva la base.
 */
export function mergeRefinedDay(base, refined) {
  if (!base) return refined || null;
  if (!refined) return base;
  const refinedStops = Array.isArray(refined.stops) ? refined.stops.filter((s) => s?.name) : [];
  const baseStops = Array.isArray(base.stops) ? base.stops : [];
  return {
    day_number: base.day_number,
    title: pickNonEmpty(refined.title, base.title),
    base: pickNonEmpty(refined.base, base.base),
    stay_label: pickNonEmpty(refined.stay_label, base.stay_label),
    hub: pickNonEmpty(refined.hub, base.hub),
    notes: pickNonEmpty(refined.notes, base.notes) || base.notes || "",
    stops: refinedStops.length ? refinedStops : baseStops,
  };
}

export function mergeRefinedDays(baseDays, refinedDays) {
  const refinedMap = new Map((refinedDays || []).map((d) => [d.day_number, d]));
  return (baseDays || []).map((b) => mergeRefinedDay(b, refinedMap.get(b.day_number)));
}

/**
 * @param {{ log?: object, onProgress?: (p: object) => void }} opts
 * @returns {{ data: object, warnings: string[], meta: object }}
 */
export async function convertMarkdownToItinerary(ai, markdown, { log, onProgress } = {}) {
  const emit = (p) => {
    try {
      onProgress?.(p);
    } catch {
      /* ignore UI callback errors */
    }
  };

  const warnings = [];
  const { preamble, chunks: headingChunks } = splitMarkdownByDays(markdown);
  const chunks = augmentChunksWithSummaryDays(markdown, headingChunks);
  const summaryExtra = chunks.filter((c) => c.fromSummary).length;
  if (summaryExtra > 0) {
    warnings.push(
      `Se detectaron ${summaryExtra} día(s) solo en tablas resumen (sin heading ### Día N)`,
    );
  }

  log?.info?.(
    {
      headingDays: headingChunks.length,
      daysDetected: chunks.length,
      summaryExtra,
      chars: markdown.length,
      strategy: "hybrid",
    },
    "Import itinerario: estrategia híbrida",
  );

  emit({
    phase: "analyze",
    percent: 4,
    message: "Analizando el Markdown y detectando días…",
    detail:
      chunks.length > 1
        ? `${chunks.length} días detectados${summaryExtra ? ` (${summaryExtra} desde tablas resumen)` : ""}`
        : "Documento corto",
  });

  // --- 1) Parser local (base estructural, siempre) ---
  emit({
    phase: "parse",
    percent: 10,
    message: "Parseando tablas y headings en local…",
    detail: "Estructura determinística antes de la AI",
  });

  const baseByDay = new Map();
  for (const chunk of chunks) {
    const hints = chunk.dayNumber != null ? [chunk.dayNumber] : [];
    const heur = heuristicDaysFromChunk(chunk.text, hints);
    for (const d of heur) {
      if (!baseByDay.has(d.day_number)) baseByDay.set(d.day_number, d);
    }
  }

  let baseDays = [...baseByDay.values()].sort((a, b) => a.day_number - b.day_number);
  const baseValidated = validateItineraryJson({
    title: "tmp",
    anchor_date: null,
    days: baseDays,
  });
  if (baseValidated.ok) {
    baseDays = baseValidated.data.days;
    warnings.push(...baseValidated.warnings);
  }

  // Sin días locales: último recurso = AI full-doc (docs sin plantilla)
  if (!baseDays.length) {
    warnings.push("Parser local no extrajo días; convirtiendo el documento completo con AI");
    emit({
      phase: "convert",
      percent: 20,
      message: "Sin estructura local · convirtiendo con AI…",
      detail: "Documento fuera de plantilla",
    });
    const result = await ai.chatComplete({
      system: ITINERARY_IMPORT_SYSTEM,
      messages: [{ role: "user", content: itineraryImportUserMessage(markdown) }],
      log,
      maxTokens: IMPORT_MAX_TOKENS,
      maxContinuations: IMPORT_CONTINUATIONS,
      continuePrompt: CONTINUE_JSON_PROMPT,
      wallMs: IMPORT_WALL_MS,
    });
    if (result.truncated) {
      const err = new Error("La respuesta AI quedó truncada (import completo).");
      err.status = 422;
      err.code = "AI_TRUNCATED";
      throw err;
    }
    const validated = validateItineraryJson(result.content);
    if (!validated.ok) {
      const err = new Error(validated.error);
      err.status = 422;
      err.code = "INVALID_ITINERARY";
      err.warnings = validated.warnings;
      throw err;
    }
    return {
      data: validated.data,
      warnings: [...warnings, ...validated.warnings],
      meta: {
        model: result.usage?.model,
        provider: result.usage?.provider,
        continued: !!result.continued,
        parts: result.parts,
        strategy: "ai-full",
      },
    };
  }

  emit({
    phase: "parse_done",
    percent: 18,
    message: `Base local lista · ${baseDays.length} días`,
    detail: "Pasamos a metadatos y refinamiento AI",
  });

  // --- 2) Meta (AI fijo) ---
  let title = "";
  let anchor_date = null;
  const h1 = /^#\s+(.+)$/m.exec(preamble || markdown);
  const titleLocal = h1 ? h1[1].trim().slice(0, 200) : "";

  emit({
    phase: "meta",
    percent: 22,
    message: "Extrayendo título y fecha ancla con AI…",
    detail: "Metadatos del preámbulo",
  });

  let metaUsage = {};
  try {
    const metaUser = itineraryMetaUserMessage(preamble || chunks[0]?.text?.slice(0, 4000) || "");
    const metaResult = await ai.chatComplete({
      system: ITINERARY_META_SYSTEM,
      messages: [{ role: "user", content: metaUser }],
      log,
      maxTokens: 1024,
      maxContinuations: 2,
      continuePrompt: CONTINUE_JSON_PROMPT,
      wallMs: 120_000,
    });
    metaUsage = metaResult.usage || {};
    const raw = parseLooseMeta(metaResult.content);
    if (raw) {
      title = raw.title || "";
      anchor_date = raw.anchor_date ?? null;
    } else {
      warnings.push("Meta AI no parseable; se usó título del H1");
    }
  } catch (e) {
    warnings.push(`Meta AI falló: ${e.message}`);
  }

  title = pickNonEmpty(title, titleLocal) || "Itinerario importado";

  // --- 3) Refine AI por chunk (fijo) ---
  const batches = batchChunks(chunks, DAYS_PER_CHUNK);
  const refinedByDay = new Map(baseDays.map((d) => [d.day_number, d]));
  let partsTotal = 0;
  let lastUsage = metaUsage;

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchMd = batch.map((c) => c.text).join("\n\n---\n\n");
    const dayHints = batch.map((c) => c.dayNumber).filter((n) => n != null);
    const baseBatch = dayHints.length
      ? dayHints.map((n) => refinedByDay.get(n)).filter(Boolean)
      : baseDays;
    const pct = 25 + Math.round((bi / Math.max(batches.length, 1)) * 62);
    const dayLabel =
      dayHints.length === 0
        ? `bloque ${bi + 1}`
        : dayHints.length === 1
          ? `día ${dayHints[0]}`
          : `días ${dayHints[0]}–${dayHints[dayHints.length - 1]}`;

    emit({
      phase: "refine",
      percent: pct,
      message: `Refinando ${dayLabel} con AI…`,
      detail: "Títulos, hubs y limpieza de paradas",
      current: bi + 1,
      total: batches.length,
      dayHints,
    });

    log?.info?.(
      { batch: bi + 1, of: batches.length, days: dayHints, baseStops: baseBatch.reduce((n, d) => n + (d.stops?.length || 0), 0) },
      "Import itinerario: refine",
    );

    let refined = null;
    let chunkWarnings = [];

    try {
      const result = await ai.chatComplete({
        system: ITINERARY_REFINE_SYSTEM,
        messages: [{ role: "user", content: itineraryRefineUserMessage(batchMd, baseBatch, dayHints) }],
        log,
        maxTokens: IMPORT_MAX_TOKENS,
        maxContinuations: IMPORT_CONTINUATIONS,
        continuePrompt: CONTINUE_JSON_PROMPT,
        wallMs: IMPORT_WALL_MS,
      });
      partsTotal += result.parts || 1;
      lastUsage = result.usage || lastUsage;
      if (!result.truncated) {
        const parsed = tryParseDays(result.content);
        if (parsed.ok && parsed.days.length) {
          refined = parsed.days;
          chunkWarnings = parsed.warnings || [];
        }
      } else {
        warnings.push(`${dayLabel}: refine AI truncado; se conserva base local`);
      }
    } catch (e) {
      log?.warn?.({ err: e.message, batch: bi + 1 }, "Refine AI falló; se conserva base local");
      warnings.push(`${dayLabel}: refine AI falló (${e.message}); se conserva base local`);
    }

    if (refined?.length) {
      const merged = mergeRefinedDays(baseBatch, refined);
      for (const d of merged) refinedByDay.set(d.day_number, d);
      warnings.push(...chunkWarnings);
    } else if (!chunkWarnings.length) {
      warnings.push(`${dayLabel}: refine sin JSON usable; se conserva base local`);
    }

    emit({
      phase: "refine_done",
      percent: 25 + Math.round(((bi + 1) / Math.max(batches.length, 1)) * 62),
      message: `${dayLabel} listo`,
      detail: `${refinedByDay.size} días acumulados`,
      current: bi + 1,
      total: batches.length,
    });
  }

  const allDays = [...refinedByDay.values()].sort((a, b) => a.day_number - b.day_number);

  emit({
    phase: "validate",
    percent: 92,
    message: "Uniendo y validando el itinerario…",
    detail: `${allDays.length} días para guardar`,
  });

  const merged = validateItineraryJson({ title, anchor_date, days: allDays });
  if (!merged.ok) {
    const err = new Error(merged.error);
    err.status = 422;
    err.code = "INVALID_ITINERARY";
    err.warnings = [...warnings, ...merged.warnings];
    throw err;
  }

  return {
    data: merged.data,
    warnings: [...warnings, ...merged.warnings],
    meta: {
      model: lastUsage.model,
      provider: lastUsage.provider,
      strategy: "hybrid",
      chunks: batches.length,
      parts: partsTotal,
      baseDays: baseDays.length,
    },
  };
}
