/**
 * Pure location parser (no Node APIs). Used by server (write) and client (preview).
 * Plus Codes: see shared/pluscode.mjs (ESM fallback; open-location-code@1.0.3 is CJS).
 */
import {
  decode as olcDecode,
  isFull,
  isShort,
  isValid,
  recoverNearest,
} from "./pluscode.mjs";

const JAPAN_LAT = { min: 20, max: 46 };
const JAPAN_LNG = { min: 122, max: 154 };
const SHORT_CODE_FAR_KM = 25;

const DECIMAL_RE =
  /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/;

const DMS_COORD =
  /(\d{1,3})(?:°|º|\s)\s*(\d{1,2})(?:'|’|′|\s)\s*(\d{1,2}(?:\.\d+)?)(?:"|”|″)?\s*([NSEW])/gi;
const DMS_FULL_RE =
  /^\s*\d{1,3}(?:°|º|\s)\s*\d{1,2}(?:'|’|′|\s)\s*\d{1,2}(?:\.\d+)?(?:"|”|″)?\s*[NS]\s+[,\s]*\d{1,3}(?:°|º|\s)\s*\d{1,2}(?:'|’|′|\s)\s*\d{1,2}(?:\.\d+)?(?:"|”|″)?\s*[EW]\s*$/i;

// El pb puede traer más de un par: centro de vista (!1m5) y lugar (!3m5).
// Preferimos el bloque con place id (!1s...!8m2!3d!4d); el centro de la vista
// puede estar a cientos de metros. Fallback: último par !3d!4d válido.
// `g` es solo para matchAll; no usar .exec/.test sobre estas constantes.
const PLACE_BLOCK_RE = /!1s[^!]*!8m2!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/gi;
const PLACE_MARKERS_RE = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/gi;

function validWorldCoords(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
const AT_COORDS_RE = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
const QUERY_COORDS_RE =
  /(?:[?&](?:q|query|ll|destination)=)(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i;
const PLACE_NAME_RE = /\/place\/([^/]+)\//;

const PLUS_GLOBAL_RE = /^([2-9CFGHJMPQRVWX]{8}\+[2-9CFGHJMPQRVWX]{2,})$/i;
const PLUS_SHORT_RE =
  /^([2-9CFGHJMPQRVWX]{2,7}\+[2-9CFGHJMPQRVWX]{2,})(?:\s+.+)?$/i;

const UNRECOGNIZED =
  'Formato no reconocido. En Google Maps: click derecho en el mapa → "Copiar coordenadas".';

function okResult({ lat, lng, source, precision, suggested_name, warnings }) {
  const out = {
    ok: true,
    lat,
    lng,
    source,
    precision,
    warnings: warnings ?? [],
  };
  if (suggested_name) out.suggested_name = suggested_name;
  return out;
}

function fail(error, warnings = []) {
  return { ok: false, error, warnings };
}

function japanWarnings(lat, lng, warnings) {
  if (
    lat < JAPAN_LAT.min ||
    lat > JAPAN_LAT.max ||
    lng < JAPAN_LNG.min ||
    lng > JAPAN_LNG.max
  ) {
    warnings.push(
      "Coordenada fuera del rango aproximado de Japón (posible lat/lng invertidos).",
    );
  }
  return warnings;
}

function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function dmsToDecimal(deg, min, sec, hemi) {
  let value = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
  const h = hemi.toUpperCase();
  if (h === "S" || h === "W") value = -value;
  return value;
}

function parseDecimalPair(raw) {
  const m = DECIMAL_RE.exec(raw);
  if (!m) return null;
  const a = m[1];
  const b = m[2];
  if (!a.includes(".") && !b.includes(".")) {
    return { error: "Se necesitan decimales (p. ej. 35.714765, 139.796655)." };
  }
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: "Latitud o longitud fuera de rango." };
  }
  return { lat, lng };
}

function tryDecimal(raw) {
  const parsed = parseDecimalPair(raw);
  if (!parsed) return null;
  if (parsed.error) return fail(parsed.error);
  const warnings = japanWarnings(parsed.lat, parsed.lng, []);
  return okResult({
    lat: parsed.lat,
    lng: parsed.lng,
    source: "decimal",
    precision: "place",
    warnings,
  });
}

function tryDms(raw) {
  if (!DMS_FULL_RE.test(raw)) return null;
  DMS_FULL_RE.lastIndex = 0;
  const parts = [];
  let m;
  const re = new RegExp(DMS_COORD.source, "gi");
  while ((m = re.exec(raw)) !== null) {
    parts.push(dmsToDecimal(m[1], m[2], m[3], m[4]));
  }
  if (parts.length !== 2) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return fail("Latitud o longitud fuera de rango.");
  }
  return okResult({
    lat,
    lng,
    source: "dms",
    precision: "place",
    warnings: japanWarnings(lat, lng, []),
  });
}

function looksLikeMapsUrl(raw) {
  return (
    /^https?:\/\//i.test(raw) ||
    /(?:maps\.google\.|google\.[^/]+\/maps|maps\.app\.goo\.gl)/i.test(raw)
  );
}

function extractSuggestedName(raw) {
  const m = PLACE_NAME_RE.exec(raw);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return m[1].replace(/\+/g, " ");
  }
}

function tryUrl(raw) {
  if (!looksLikeMapsUrl(raw)) return null;

  const suggested_name = extractSuggestedName(raw);
  const candidates = (re) =>
    [...raw.matchAll(re)]
      .map((m) => ({ lat: Number(m[1]), lng: Number(m[2]) }))
      .filter((c) => validWorldCoords(c.lat, c.lng));
  const placeBlocks = candidates(PLACE_BLOCK_RE);
  const markers = candidates(PLACE_MARKERS_RE);
  const pair = placeBlocks.length
    ? placeBlocks[placeBlocks.length - 1]
    : markers.length
      ? markers[markers.length - 1]
      : null;
  if (pair) {
    return okResult({
      lat: pair.lat,
      lng: pair.lng,
      source: "url",
      precision: "place",
      suggested_name,
      warnings: japanWarnings(pair.lat, pair.lng, []),
    });
  }

  const q = QUERY_COORDS_RE.exec(raw);
  if (q) {
    const lat = Number(q[1]);
    const lng = Number(q[2]);
    return okResult({
      lat,
      lng,
      source: "url",
      precision: "place",
      suggested_name,
      warnings: japanWarnings(lat, lng, []),
    });
  }

  const at = AT_COORDS_RE.exec(raw);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    const warnings = japanWarnings(lat, lng, ["coordenada aproximada"]);
    return okResult({
      lat,
      lng,
      source: "url",
      precision: "view",
      suggested_name,
      warnings,
    });
  }

  return fail("URL de Maps sin coordenadas reconocibles.");
}

function tryPlusGlobal(raw) {
  const m = PLUS_GLOBAL_RE.exec(raw);
  if (!m) return null;
  const code = m[1].toUpperCase();
  if (!isFull(code)) return null;
  try {
    const area = olcDecode(code);
    const lat = area.latitudeCenter;
    const lng = area.longitudeCenter;
    return okResult({
      lat,
      lng,
      source: "plus_code",
      precision: "place",
      warnings: japanWarnings(lat, lng, []),
    });
  } catch {
    return null;
  }
}

function tryPlusShort(raw, reference) {
  const m = PLUS_SHORT_RE.exec(raw);
  if (!m) return null;
  const codePart = m[1].toUpperCase();
  if (!isValid(codePart) || !isShort(codePart)) return null;

  if (
    !reference ||
    typeof reference.lat !== "number" ||
    typeof reference.lng !== "number"
  ) {
    return fail(
      "Plus Code corto: hace falta el código completo o un punto de referencia (alojamiento del día).",
    );
  }

  try {
    const full = recoverNearest(codePart, reference.lat, reference.lng);
    const area = olcDecode(full);
    const lat = area.latitudeCenter;
    const lng = area.longitudeCenter;
    const warnings = japanWarnings(lat, lng, []);
    const dist = haversineKm(reference, { lat, lng });
    if (dist > SHORT_CODE_FAR_KM) {
      warnings.push("SHORT_CODE_FAR");
    }
    return okResult({
      lat,
      lng,
      source: "plus_code",
      precision: "place",
      warnings,
    });
  } catch (err) {
    return fail(err?.message || "No se pudo recuperar el Plus Code corto.");
  }
}

/**
 * Enlace corto de Compartir (maps.app.goo.gl o goo.gl/maps).
 * No trae coordenadas: hay que seguir la redirección.
 * @param {string} raw
 */
export function isShortMapsUrl(raw) {
  try {
    const url = new URL(String(raw ?? "").trim());
    const host = url.hostname.toLowerCase();
    if (host === "maps.app.goo.gl") return url.pathname.length > 1;
    if (host === "goo.gl") return url.pathname.startsWith("/maps");
    return false;
  } catch {
    return false;
  }
}

/**
 * Enlace de ficha para abrir en Maps, sin el texto crudo ni parámetros de tracking.
 * Devuelve null si el pegado no es una URL de Maps.
 * @param {string} raw
 * @returns {string|null}
 */
export function mapsUrlFromRaw(raw) {
  const text = String(raw ?? "").trim();
  if (!looksLikeMapsUrl(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key === "entry" || key === "g_ep" || key === "skid" || key.startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  const query = url.searchParams.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/**
 * @param {string} input
 * @param {{ reference?: { lat: number, lng: number } }} [opts]
 */
export function parseLocationInput(input, { reference } = {}) {
  if (typeof input !== "string") {
    return fail(UNRECOGNIZED);
  }
  const raw = input.trim();
  if (!raw) {
    return fail(UNRECOGNIZED);
  }

  const decimal = tryDecimal(raw);
  if (decimal) return decimal;

  const dms = tryDms(raw);
  if (dms) return dms;

  const url = tryUrl(raw);
  if (url) return url;

  const plusGlobal = tryPlusGlobal(raw);
  if (plusGlobal) return plusGlobal;

  const plusShort = tryPlusShort(raw, reference);
  if (plusShort) return plusShort;

  return fail(UNRECOGNIZED);
}
