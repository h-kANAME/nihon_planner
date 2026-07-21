/**
 * Score de efectividad del import híbrido (mismas dimensiones usadas en auditoría ~91%).
 * No es un gold-set etiquetado: mide cobertura, estructura, títulos, fidelidad, ancla y robustez.
 */

const GENERIC_TITLE = /^d[ií]a\s*\d+$/i;

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {{ title?: string, anchor_date?: string|null, days?: object[] }} data
 * @param {{ expectedDays?: number, warnings?: string[], strategy?: string }} opts
 */
export function scoreItineraryEffectiveness(data, opts = {}) {
  const days = Array.isArray(data?.days) ? data.days : [];
  const warnings = Array.isArray(opts.warnings) ? opts.warnings : [];
  const expectedDays = Math.max(1, Number(opts.expectedDays) || days.length || 1);
  const strategy = opts.strategy || "";

  const dayCount = days.length;
  const coverage = clamp((dayCount / expectedDays) * 100);

  const emptyDays = days.filter((d) => !(d.stops && d.stops.length)).length;
  const stopCount = days.reduce((n, d) => n + (d.stops?.length || 0), 0);
  const namelessStops = days.reduce(
    (n, d) => n + (d.stops || []).filter((s) => !String(s?.name || "").trim()).length,
    0,
  );
  const structPenalty =
    emptyDays * 8 +
    namelessStops * 3 +
    warnings.filter((w) => /omit|truncad|sin nombre/i.test(w)).length * 2;
  const structure = clamp(
    (stopCount > 0 ? 96 : 40) - structPenalty + Math.min(4, Math.floor(stopCount / 40)),
  );

  const titlesOk = days.filter((d) => {
    const t = String(d.title || "").trim();
    return t && !GENERIC_TITLE.test(t);
  }).length;
  const titles = clamp((titlesOk / Math.max(dayCount, 1)) * 100);

  const fidelityHits = warnings.filter((w) =>
    /invent|sin JSON usable|refine AI falló|parser local no extrajo|fallback|ai-full/i.test(w),
  ).length;
  const fidelity = clamp(95 - fidelityHits * 7 - (strategy === "ai-full" ? 15 : 0));

  const anchorRaw = data?.anchor_date;
  const anchorOk = typeof anchorRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw);
  const anchor = anchorOk ? 100 : anchorRaw == null || anchorRaw === "" ? 70 : 40;

  const hybridBonus = strategy === "hybrid" ? 8 : strategy === "ai-full" ? -5 : 0;
  const warnSoft = warnings.filter((w) => /tablas resumen|Meta AI/i.test(w)).length;
  const robustness = clamp(85 + hybridBonus - warnings.length + warnSoft * 0.5);

  const dimensions = {
    coverage: round1(coverage),
    structure: round1(structure),
    titles: round1(titles),
    fidelity: round1(fidelity),
    anchor: round1(anchor),
    robustness: round1(robustness),
  };

  const global = round1(
    (dimensions.coverage +
      dimensions.structure +
      dimensions.titles +
      dimensions.fidelity +
      dimensions.anchor +
      dimensions.robustness) /
      6,
  );

  return {
    global,
    dimensions,
    stats: {
      expectedDays,
      days: dayCount,
      stops: stopCount,
      emptyDays,
      titlesOk,
      warnings: warnings.length,
      anchor: anchorRaw ?? null,
      strategy: strategy || null,
      title: data?.title || "",
    },
  };
}
