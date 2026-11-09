/**
 * Sigue el enlace corto de Compartir y deja el texto listo para parseLocationInput.
 * Solo pide hosts de Google Maps.
 */
import { isShortMapsUrl, mapsUrlFromRaw, parseLocationInput } from "../../shared/location-parse.mjs";

const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "www.google.com",
  "google.com",
  "maps.google.com",
]);

function mapsHostOrThrow(url) {
  const host = url.hostname.toLowerCase();
  if (!MAPS_HOSTS.has(host)) {
    const err = new Error("El enlace no apunta a Google Maps.");
    err.code = "INVALID_LOCATION";
    throw err;
  }
}

/**
 * @param {string} raw
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>} URL larga, o el texto original si no es un enlace corto
 */
export async function expandMapsShareUrl(raw, fetchImpl = globalThis.fetch) {
  const text = String(raw ?? "").trim();
  if (!isShortMapsUrl(text)) return text;

  let current = text;
  for (let hop = 0; hop < 4; hop += 1) {
    const url = new URL(current);
    mapsHostOrThrow(url);
    const res = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "nihon-planner", accept: "text/html" },
    });
    if (res.status < 300 || res.status >= 400) break;
    const loc = res.headers.get("location");
    if (!loc) break;
    const next = new URL(loc, current);
    mapsHostOrThrow(next);
    current = next.toString();
    if (!isShortMapsUrl(current)) return current;
  }

  const err = new Error("No se pudo resolver el enlace corto de Google Maps.");
  err.code = "INVALID_LOCATION";
  throw err;
}

/**
 * Expande el enlace corto, parsea y devuelve el raw que se guarda (ficha sin tracking).
 * @param {string} raw
 * @param {{ lat: number, lng: number }} [reference]
 * @param {typeof fetch} [fetchImpl]
 */
export async function readLocationInput(raw, reference, fetchImpl) {
  const expanded = await expandMapsShareUrl(raw, fetchImpl);
  const parsed = parseLocationInput(expanded, reference ? { reference } : undefined);
  const canonical = mapsUrlFromRaw(expanded);
  return {
    parsed,
    raw_input: canonical || String(raw ?? "").trim(),
  };
}
