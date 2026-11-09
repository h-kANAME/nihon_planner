/**
 * Deep links a Google Maps (texto o coordenadas).
 * Puro: sin red, sin DB. M0 no requiere ubicaciones validadas.
 */

/** @typedef {{ lat: number, lng: number }} LatLng */
/** @typedef {string | LatLng} MapsPoint */

/**
 * @param {object|null|undefined} stop
 * @param {object|null|undefined} day
 * @returns {LatLng|null}
 */
export function effectiveLocation(stop, day) {
  const mode = stop?.location_mode || "pending";
  if (mode === "coords") {
    if (stop?.lat == null || stop?.lng == null) return null;
    return { lat: Number(stop.lat), lng: Number(stop.lng) };
  }
  if (mode === "inherit_stay") {
    if (day?.stay_lat == null || day?.stay_lng == null) return null;
    return { lat: Number(day.stay_lat), lng: Number(day.stay_lng) };
  }
  return null;
}

/**
 * §4.3: coords / not_applicable / inherit_stay con alojamiento ubicado.
 * @param {object|null|undefined} stop
 * @param {object|null|undefined} day
 */
export function isLocationResolved(stop, day) {
  const mode = stop?.location_mode || "pending";
  if (mode === "coords" || mode === "not_applicable") return true;
  if (mode === "inherit_stay") {
    return day?.stay_lat != null && day?.stay_lng != null;
  }
  return false;
}

/**
 * @param {object|null|undefined} day
 * @returns {{ total: number, resolved: number, pending: number }}
 */
export function locationProgress(day) {
  const stops = day?.stops || [];
  const total = stops.length;
  let resolved = 0;
  for (const stop of stops) {
    if (isLocationResolved(stop, day)) resolved += 1;
  }
  return { total, resolved, pending: total - resolved };
}

/**
 * Tone del badge de progreso por día (§8.3).
 * completo → accent; parcial → warn; 0 resueltas o sin paradas → muted.
 * @param {{ total?: number, resolved?: number, pending?: number }|null|undefined} progress
 * @returns {'accent'|'warn'|'muted'}
 */
export function locationProgressTone(progress) {
  const total = Number(progress?.total) || 0;
  const resolved = Number(progress?.resolved) || 0;
  if (total <= 0 || resolved <= 0) return "muted";
  if (resolved === total) return "accent";
  return "warn";
}

/**
 * @param {{ resolved?: number, total?: number }|null|undefined} progress
 */
export function formatLocationProgressLabel(progress) {
  const total = Number(progress?.total) || 0;
  const resolved = Number(progress?.resolved) || 0;
  return `${resolved}/${total} ubicadas`;
}

/**
 * Porcentaje entero 0–100 para card Resumen (§8.3).
 * @param {{ resolved?: number, total?: number }|null|undefined} progress
 */
export function locationProgressPercent(progress) {
  const total = Number(progress?.total) || 0;
  const resolved = Number(progress?.resolved) || 0;
  if (total <= 0) return 0;
  return Math.round((resolved / total) * 100);
}

/**
 * Copy global Resumen: `4/8 ubicadas (50%)`.
 * @param {{ resolved?: number, total?: number }|null|undefined} progress
 */
export function formatGlobalLocationProgress(progress) {
  const total = Number(progress?.total) || 0;
  const resolved = Number(progress?.resolved) || 0;
  const pct = locationProgressPercent(progress);
  return `${resolved}/${total} ubicadas (${pct}%)`;
}

/** ¿El día tiene al menos una parada pendiente de ubicar? (§8.3 filtro Plan). */
export function dayHasPendingLocations(day) {
  return locationProgress(day).pending > 0;
}

/**
 * CTA corto para abrir el picker desde Plan.
 * @param {boolean} resolved
 * @param {'stop'|'stay'} [kind]
 */
export function locateCtaLabel(resolved, kind = "stop") {
  if (kind === "stay") {
    return resolved ? "Cambiar alojamiento" : "Ubicar alojamiento";
  }
  return resolved ? "Cambiar ubicación" : "Ubicar";
}

/**
 * Modelo puro de lo que DayMap renderiza (§8.5 / §4.3).
 * Solo paradas con `effectiveLocation` ≠ null (pending / not_applicable /
 * inherit_stay sin stay → ausentes). Numeración = índice visual entre ubicados
 * respetando `sort_order`. Stay aparte si hay `stay_lat`/`stay_lng`.
 *
 * @param {object|null|undefined} day
 * @returns {{
 *   stopMarkers: Array<{
 *     kind: 'stop',
 *     id: string,
 *     number: number,
 *     lat: number,
 *     lng: number,
 *     name: string,
 *     stop: object,
 *   }>,
 *   stayMarker: { kind: 'stay', id: 'stay', lat: number, lng: number, name: string } | null,
 *   lineCoordinates: Array<[number, number]>,
 *   boundsPoints: Array<{ lat: number, lng: number }>,
 *   pendingStops: object[],
 *   isEmpty: boolean,
 * }}
 */
export function buildDayMapModel(day) {
  const stops = [...(day?.stops || [])].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0),
  );

  /** @type {ReturnType<typeof buildDayMapModel>['stopMarkers']} */
  const stopMarkers = [];
  let visualIndex = 0;
  for (const stop of stops) {
    const loc = effectiveLocation(stop, day);
    if (!loc) continue;
    visualIndex += 1;
    stopMarkers.push({
      kind: "stop",
      id: String(stop.id),
      number: visualIndex,
      lat: loc.lat,
      lng: loc.lng,
      name: String(stop.name || ""),
      stop,
    });
  }

  const stayMarker =
    day?.stay_lat != null && day?.stay_lng != null
      ? {
          kind: /** @type {const} */ ("stay"),
          id: /** @type {const} */ ("stay"),
          lat: Number(day.stay_lat),
          lng: Number(day.stay_lng),
          name: String(day.stay_label || "Alojamiento"),
        }
      : null;

  const lineCoordinates = stopMarkers.map((m) => /** @type {[number, number]} */ ([m.lng, m.lat]));
  const boundsPoints = [
    ...stopMarkers.map((m) => ({ lat: m.lat, lng: m.lng })),
    ...(stayMarker ? [{ lat: stayMarker.lat, lng: stayMarker.lng }] : []),
  ];
  const pendingStops = stops.filter((s) => (s.location_mode || "pending") === "pending");

  return {
    stopMarkers,
    stayMarker,
    lineCoordinates,
    boundsPoints,
    pendingStops,
    isEmpty: boundsPoints.length === 0,
  };
}

/**
 * Destino textual: "<nombre>, <base|stay_label>, Japón"
 * @param {object|null|undefined} stop
 * @param {object|null|undefined} day
 */
export function stopDestinationQuery(stop, day) {
  const name = String(stop?.name || "").trim();
  const place = String(day?.base || day?.stay_label || "").trim();
  return [name, place, "Japón"].filter(Boolean).join(", ");
}

/**
 * @param {MapsPoint|null|undefined} point
 * @returns {string}
 */
function formatMapsPoint(point) {
  if (point == null) return "";
  if (typeof point === "object" && point.lat != null && point.lng != null) {
    return `${point.lat},${point.lng}`;
  }
  return String(point);
}

/**
 * @param {string} query
 * @returns {string}
 */
export function mapsSearch(query) {
  const q = String(query || "").trim();
  const params = new URLSearchParams({ api: "1", query: q });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * @param {{ origin?: MapsPoint, destination?: MapsPoint, travelmode?: string }} opts
 * @returns {string}
 */
export function mapsDirections({ origin, destination, travelmode = "transit" } = {}) {
  const params = new URLSearchParams({
    api: "1",
    origin: formatMapsPoint(origin),
    destination: formatMapsPoint(destination),
    travelmode: travelmode || "transit",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Origen del tramo: coords de la parada anterior si existen, si no su nombre;
 * si es la primera parada, coords del alojamiento o `stay_label`.
 * @param {object[]} stops sorted
 * @param {number} index
 * @param {object|null|undefined} day
 * @returns {MapsPoint}
 */
export function stopDirectionsOrigin(stops, index, day) {
  if (index > 0) {
    const prev = stops[index - 1];
    const loc = effectiveLocation(prev, day);
    if (loc) return loc;
    const name = String(prev?.name || "").trim();
    if (name) return name;
  }
  if (day?.stay_lat != null && day?.stay_lng != null) {
    return { lat: Number(day.stay_lat), lng: Number(day.stay_lng) };
  }
  return String(day?.stay_label || "").trim();
}

/**
 * @param {object|null|undefined} stop
 * @param {object|null|undefined} day
 * @param {object[]} stops
 * @param {number} index
 */
export function mapsDirectionsForStop(stop, day, stops, index) {
  const destLoc = effectiveLocation(stop, day);
  const destination = destLoc || stopDestinationQuery(stop, day);
  const origin = stopDirectionsOrigin(stops, index, day);
  return mapsDirections({ origin, destination, travelmode: "transit" });
}

/**
 * @param {object|null|undefined} stop
 * @param {object|null|undefined} day
 */
export function mapsSearchForStop(stop, day) {
  const loc = effectiveLocation(stop, day);
  if (loc) return mapsSearch(`${loc.lat},${loc.lng}`);
  return mapsSearch(stopDestinationQuery(stop, day));
}

/**
 * Destino textual del alojamiento: "<stay_label>, <base>, Japón"
 * @param {object|null|undefined} day
 */
export function stayDestinationQuery(day) {
  const label = String(day?.stay_label || "").trim();
  const base = String(day?.base || "").trim();
  return [label, base, "Japón"].filter(Boolean).join(", ");
}

/**
 * "Ver lugar" del alojamiento: coords si hay, texto si no (M0).
 * @param {object|null|undefined} day
 */
export function mapsSearchForStay(day) {
  if (day?.stay_lat != null && day?.stay_lng != null) {
    return mapsSearch(`${Number(day.stay_lat)},${Number(day.stay_lng)}`);
  }
  return mapsSearch(stayDestinationQuery(day));
}

/**
 * "Cómo llegar" al alojamiento cuando hay destino usable (coords o label).
 * Origin: `base` del día (texto); sin destino → null.
 * @param {object|null|undefined} day
 * @returns {string|null}
 */
export function mapsDirectionsForStay(day) {
  const hasCoords = day?.stay_lat != null && day?.stay_lng != null;
  const label = String(day?.stay_label || "").trim();
  if (!hasCoords && !label) return null;
  const destination = hasCoords
    ? { lat: Number(day.stay_lat), lng: Number(day.stay_lng) }
    : stayDestinationQuery(day);
  const origin = String(day?.base || "").trim();
  return mapsDirections({ origin, destination, travelmode: "transit" });
}

/**
 * Links del popup del mapa (§8.5): Cómo llegar / Ver lugar.
 * @param {{ kind: 'stop'|'stay', stop?: object|null, id?: string }|null|undefined} selection
 * @param {object|null|undefined} day
 * @returns {{
 *   name: string,
 *   how_to_get: string,
 *   est_duration: string,
 *   directionsUrl: string|null,
 *   searchUrl: string|null,
 * } | null}
 */
export function dayMapPopupLinks(selection, day) {
  if (!selection || !day) return null;
  if (selection.kind === "stay") {
    return {
      name: String(day.stay_label || selection.name || "Alojamiento"),
      how_to_get: "",
      est_duration: "",
      directionsUrl: mapsDirectionsForStay(day),
      searchUrl: mapsSearchForStay(day),
    };
  }
  const stops = [...(day.stops || [])].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0),
  );
  const stop =
    selection.stop ||
    stops.find((s) => String(s.id) === String(selection.id)) ||
    null;
  if (!stop) return null;
  const index = stops.findIndex((s) => String(s.id) === String(stop.id));
  return {
    name: String(stop.name || selection.name || ""),
    how_to_get: String(stop.how_to_get || "").trim(),
    est_duration: String(stop.est_duration || "").trim(),
    directionsUrl: mapsDirectionsForStop(stop, day, stops, index < 0 ? 0 : index),
    searchUrl: mapsSearchForStop(stop, day),
  };
}

/**
 * Estado visual del chip LocationBadge (§8.1).
 * @param {{ mode?: string|null, precision?: string|null, kind?: 'stop'|'stay' }} [opts]
 * @returns {{ key: string, label: string, tone: 'accent'|'warn'|'muted' }}
 */
export function resolveLocationBadge({ mode, precision, kind: _kind = "stop" } = {}) {
  const m = mode || "pending";
  if (m === "coords") {
    if (precision === "view") {
      return { key: "approximate", label: "Aproximada", tone: "warn" };
    }
    return { key: "located", label: "Ubicada", tone: "accent" };
  }
  if (m === "inherit_stay") {
    return { key: "inherited", label: "Heredada", tone: "muted" };
  }
  if (m === "not_applicable") {
    return { key: "not_applicable", label: "No aplica", tone: "muted" };
  }
  return { key: "pending", label: "Pendiente", tone: "muted" };
}

/**
 * Query de búsqueda del picker: "<nombre> <base>" (§8.4.2).
 * @param {{ target?: 'stop'|'stay', stop?: object|null, day?: object|null }} opts
 */
export function locationPickerSearchQuery({ target = "stop", stop, day } = {}) {
  if (target === "stay") {
    return [day?.stay_label, day?.base].filter(Boolean).join(" ").trim();
  }
  const place = String(day?.base || day?.stay_label || "").trim();
  return [stop?.name, place].filter(Boolean).join(" ").trim();
}

/** Modo efectivo del alojamiento para LocationBadge. */
export function stayLocationMode(day) {
  if (day?.stay_lat != null && day?.stay_lng != null) return "coords";
  return "pending";
}

/**
 * Body de confirmación coords de parada: solo version + mode + raw_input (nunca lat/lng).
 * @param {number} version
 * @param {string} raw_input
 */
export function buildStopLocationCoordsBody(version, raw_input) {
  return { version, mode: "coords", raw_input: String(raw_input ?? "") };
}

/**
 * @param {number} version
 * @param {'pending'|'not_applicable'|'inherit_stay'} mode
 */
export function buildStopLocationModeBody(version, mode) {
  return { version, mode };
}

/**
 * @param {number} version
 * @param {string} raw_input
 */
export function buildStayLocationBody(version, raw_input) {
  return { version, raw_input: String(raw_input ?? "") };
}

/** @param {number} version */
export function buildStayLocationClearBody(version) {
  return { version, clear: true };
}

/**
 * Paradas del día en modo `pending` (orden de lista = sort_order).
 * @param {object|null|undefined} day
 * @returns {object[]}
 */
export function pendingStopsForBatch(day) {
  return (day?.stops || []).filter((s) => (s.location_mode || "pending") === "pending");
}

/**
 * Una línea de lote: `nombre<TAB>dato` o solo `dato` (§8.4.6).
 * @param {string} line
 * @returns {{ empty: true } | { empty: false, name: string|null, raw_input: string }}
 */
export function splitBatchLine(line) {
  const raw = String(line ?? "");
  if (!raw.trim()) return { empty: true };
  const tab = raw.indexOf("\t");
  if (tab >= 0) {
    return {
      empty: false,
      name: raw.slice(0, tab).trim() || null,
      raw_input: raw.slice(tab + 1).trim(),
    };
  }
  return { empty: false, name: null, raw_input: raw.trim() };
}

/**
 * Asigna líneas no vacías del textarea a paradas pending en orden.
 * @param {string} text
 * @param {object[]} pendingStops
 * @returns {Array<{
 *   lineIndex: number,
 *   line: string,
 *   nameHint: string|null,
 *   raw_input: string,
 *   stop: object|null,
 *   stop_id: string|null,
 *   version: number|null,
 * }>}
 */
export function assignBatchLines(text, pendingStops) {
  const stops = pendingStops || [];
  const lines = String(text ?? "").split(/\r?\n/);
  /** @type {ReturnType<typeof assignBatchLines>} */
  const out = [];
  let stopIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const parts = splitBatchLine(lines[i]);
    if (parts.empty) continue;
    const stop = stops[stopIdx] || null;
    stopIdx += 1;
    out.push({
      lineIndex: i,
      line: lines[i],
      nameHint: parts.name,
      raw_input: parts.raw_input,
      stop,
      stop_id: stop?.id ?? null,
      version: stop != null ? Number(stop.version ?? 1) : null,
    });
  }
  return out;
}

/**
 * Preview local por línea (mismo parseLocationInput).
 * @param {string} text
 * @param {object[]} pendingStops
 * @param {(raw: string, opts?: object) => { ok: boolean, error?: string, [k: string]: unknown }} parseFn
 * @param {{ lat: number, lng: number }|undefined} [reference]
 */
export function previewBatchLines(text, pendingStops, parseFn, reference) {
  return assignBatchLines(text, pendingStops).map((row) => {
    if (!row.stop_id) {
      return {
        ...row,
        ok: false,
        error: "No hay más paradas pendientes en el día",
        parsed: null,
      };
    }
    if (!row.raw_input) {
      return { ...row, ok: false, error: "Dato vacío", parsed: null };
    }
    try {
      const parsed = parseFn(row.raw_input, reference ? { reference } : undefined);
      return {
        ...row,
        ok: !!parsed?.ok,
        error: parsed?.ok ? null : parsed?.error || "Formato no reconocido",
        parsed,
      };
    } catch (e) {
      return {
        ...row,
        ok: false,
        error: e?.message || "Error al parsear",
        parsed: null,
      };
    }
  });
}

/**
 * Registro de aplicación exitosa: `{ stop_id, version }` donde `version` es la
 * enviada en el PUT que ganó (§8.4.6). Al reanudar se omite por `stop_id`
 * (la version del registro documenta con cuál se aplicó; tras el PUT el stop
 * ya tiene version+1 y no debe volver a encolarse).
 * @param {{ stop_id?: string|null, version?: number|null }} row
 * @param {Array<{ stop_id: string, version: number }>} applied
 */
export function isBatchRowApplied(row, applied) {
  if (row?.stop_id == null) return false;
  const sid = String(row.stop_id);
  return (applied || []).some((a) => String(a.stop_id) === sid);
}

/**
 * Filtra filas ok aún no aplicadas (para PUT / reintento tras 409).
 * @param {Array<{ ok?: boolean, stop_id?: string|null, version?: number|null }>} rows
 * @param {Array<{ stop_id: string, version: number }>} applied
 */
export function batchRowsToApply(rows, applied) {
  return (rows || []).filter((r) => r.ok && r.stop_id && !isBatchRowApplied(r, applied));
}

/**
 * ¿El registro applied corresponde a este stop_id + version enviada?
 * (assert de semántica / tests; el skip de cola usa `isBatchRowApplied`).
 */
export function batchAppliedEntryMatches(entry, stopId, versionSent) {
  return (
    entry != null &&
    String(entry.stop_id) === String(stopId) &&
    Number(entry.version) === Number(versionSent)
  );
}
