/**
 * Parser determinístico: Google Doc de organización → jp:logistics.
 * No usa AI. Re-import estable vía ids `gdoc-*`.
 */

const TRAMITES_HEADER = /TR[ÁA]MITES\s+Y\s+ORGANIZACI[ÓO]N\s+PREVIA/i;
const ITINERARY_START = /(?:^|\n)\s*Itinerario\s*(?:\n|$)/i;
const DAY_START = /(?:^|\n)\s*D[ií]a\s+\d+/i;

const FLIGHT_KEYS = new Set(["PASAJES", "PASAJE", "VUELOS", "VUELO"]);
const DOC_KEYS = new Set([
  "PASAPORTE",
  "LICENCIA DE CONDUCIR",
  "LICENCIA",
  "SEGURO MÉDICO",
  "SEGURO MEDICO",
  "SEGURO",
  "ESIM",
  "E-SIM",
  "MIGRACIONES",
  "VISA",
  "VISIT JAPAN WEB",
]);

/** @param {string} s */
export function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "item";
}

/**
 * Extrae monto USD aproximado del texto (prioriza el primer match razonable).
 * @param {string} text
 * @returns {{ amount: number, currency: 'USD' }|null}
 */
export function extractUsdAmount(text) {
  const t = String(text || "");
  const patterns = [
    /\$\s*([\d.]+)\s*USD/i,
    /USD\s*\$?\s*([\d.]+)/i,
    /entre\s+USD\s*([\d.]+)/i,
    /\$\s*([\d.]+)\s*c\/u/i,
    /costo aproximado(?: de)?\s*\$\s*([\d.]+)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    // AR locale: 2.200 = 2200; 30 = 30; 25 = 25
    const token = m[1];
    const n = /^\d{1,3}(\.\d{3})+$/.test(token)
      ? Number(token.replace(/\./g, ""))
      : Number(token);
    if (!(n > 0) || n >= 50000) continue; // evita pisos de cobertura (100.000)
    return { amount: n, currency: "USD" };
  }
  return null;
}

/**
 * @param {string} key
 * @returns {'flight'|'doc'|'booking'|'stay'}
 */
function kindForTramiteKey(key) {
  const k = key.trim().toUpperCase();
  if (FLIGHT_KEYS.has(k) || FLIGHT_KEYS.has(k.replace(/S$/, ""))) return "flight";
  return "doc";
}

/**
 * Corta el bloque de trámites (antes del itinerario).
 * @param {string} text
 */
export function extractTramitesBlock(text) {
  const src = String(text || "").replace(/\r\n/g, "\n");
  const start = src.search(TRAMITES_HEADER);
  if (start < 0) return "";
  const after = src.slice(start);
  const endItin = after.search(ITINERARY_START);
  const endDay = after.search(DAY_START);
  let end = after.length;
  if (endItin >= 0) end = Math.min(end, endItin);
  if (endDay >= 0) end = Math.min(end, endDay);
  return after.slice(0, end);
}

/**
 * @param {string} block
 * @returns {Array<{ key: string, body: string }>}
 */
export function splitTramiteItems(block) {
  const lines = String(block || "").split("\n");
  const items = [];
  let current = null;
  const itemRe = /^\*\s+([^*:\n][^:\n]{1,80}):\s*(.*)$/;

  for (const line of lines) {
    const m = line.match(itemRe);
    if (m) {
      if (current) items.push(current);
      current = { key: m[1].trim(), body: m[2].trim() };
      continue;
    }
    if (current) {
      const t = line.trim();
      if (!t || /^_{3,}$/.test(t)) continue;
      if (/^TR[ÁA]MITES/i.test(t) || /^Itinerario/i.test(t)) continue;
      current.body = current.body ? `${current.body}\n${t}` : t;
    }
  }
  if (current) items.push(current);
  return items;
}

/**
 * @param {string} text
 * @returns {Array<{ id: string, city: string, name: string, checkin: string, checkout: string, done: boolean, amount: number|null, currency: string|null }>}
 */
export function parseStaysFromItinerary(text) {
  const src = String(text || "").replace(/\r\n/g, "\n");
  const stayRe = /^Alojamiento:\s*(.+)$/gim;
  const seen = new Map();
  let m;
  while ((m = stayRe.exec(src))) {
    let raw = m[1].trim();
    if (!raw || raw === "—" || raw === "-") continue;
    // "check-out Kyoto → check-in Osaka (Namba) — …" → tomar destino
    const arrow = raw.match(/check-in\s+(.+)$/i) || raw.match(/→\s*(.+)$/);
    if (arrow) raw = arrow[1].replace(/—.*$/, "").trim();
    raw = raw.replace(/\s*—\s*.*$/, "").trim();
    if (/^a definir/i.test(raw)) continue;
    const name = raw;
    const city = (raw.match(/^([^—(]+)/) || [, raw])[1].trim();
    const id = `gdoc-stay-${slugify(name)}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      city,
      name,
      checkin: "",
      checkout: "",
      done: false,
      amount: null,
      currency: null,
    });
  }

  // Hotel explícito en paradas (día 1)
  const hotelRe = /^\s*\d+\s*\n\s*(Hotel[^\n]+)/gim;
  // Plain export is messy; also match "Hotel Clio..."
  const hotelNameRe = /(Hotel\s+[A-Za-z0-9][A-Za-z0-9 .'-]{2,60})/g;
  let hm;
  while ((hm = hotelNameRe.exec(src))) {
    const name = hm[1].trim();
    if (/hotel wifi/i.test(name)) continue;
    const id = `gdoc-stay-${slugify(name)}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      city: "",
      name,
      checkin: "",
      checkout: "",
      done: false,
      amount: null,
      currency: null,
    });
  }

  return [...seen.values()];
}

/**
 * Reservas mencionadas en notas del itinerario.
 * @param {string} text
 */
export function parseBookingsFromItinerary(text) {
  const src = String(text || "").replace(/\r\n/g, "\n");
  /** @type {Map<string, { id: string, name: string, datetime: string, done: boolean, amount: null, currency: null }>} */
  const found = new Map();

  const add = (name) => {
    const n = String(name || "").trim().replace(/\s+/g, " ");
    if (!n || n.length < 3) return;
    const id = `gdoc-booking-${slugify(n)}`;
    if (found.has(id)) return;
    found.set(id, { id, name: n, datetime: "", done: false, amount: null, currency: null });
  };

  // Patrones explícitos
  const patterns = [
    /Reserva\s+obligatoria[^\n]*—?\s*([^\n]{0,40})/gi,
    /Reservar\s+([A-Za-z0-9][A-Za-z0-9 .'-]{2,50})/gi,
    /Reserva\s+anticipada[^\n]*/gi,
  ];

  // Catálogo conocido del plan
  const known = [
    { re: /Kirby/i, name: "Café Kirby (reserva)" },
    { re: /WB Studio|Warner Bros|Harry Potter/i, name: "Warner Bros. Studio Tour Tokyo" },
    { re: /teamLab|Planets/i, name: "teamLab Planets (slot)" },
    { re: /Fun2Drive/i, name: "Fun2Drive JDM" },
    { re: /Express Pass|USJ/i, name: "USJ Express Pass" },
    { re: /Tokyo Supercars/i, name: "Tokyo Supercars" },
    { re: /Ghibli/i, name: "Ghibli Museum" },
  ];

  for (const k of known) {
    if (k.re.test(src) && /reserv/i.test(src)) {
      // solo si aparece cerca de "reserv"
      const idx = src.search(k.re);
      if (idx >= 0) {
        const window = src.slice(Math.max(0, idx - 120), idx + 160);
        if (/reserv/i.test(window) || k.name.includes("Express") || k.name.includes("Fun2")) {
          add(k.name);
        }
      }
    }
  }

  // Fun2Drive / USJ siempre si aparecen con "Reservar"
  if (/Reservar\s+Fun2Drive/i.test(src) || /Fun2Drive YA/i.test(src)) add("Fun2Drive JDM");
  if (/Express Pass/i.test(src) && /reserv/i.test(src)) add("USJ Express Pass");
  if (/Reserva\s+obligatoria/i.test(src) && /Harry Potter|WB Studio|Toshimaen/i.test(src)) {
    add("Warner Bros. Studio Tour Tokyo");
  }
  if (/Reserva anticipada/i.test(src) && /Kirby/i.test(src)) add("Café Kirby (reserva)");
  if (/Tokyo Supercars/i.test(src) && /reserv/i.test(src)) add("Tokyo Supercars");
  if (/teamLab|Planets/i.test(src) && /Reserva\/slot|slot/i.test(src)) add("teamLab Planets (slot)");

  void patterns;
  return [...found.values()];
}

/**
 * @param {string} text
 * @returns {{
 *   docs: object[],
 *   flights: object[],
 *   stays: object[],
 *   bookings: object[],
 *   warnings: string[],
 * }}
 */
export function parseGoogleDocLogistics(text) {
  const warnings = [];
  const docs = [];
  const flights = [];
  const bookings = [];

  const block = extractTramitesBlock(text);
  if (!block) {
    warnings.push("No se encontró la sección TRÁMITES Y ORGANIZACIÓN PREVIA");
  } else {
    const items = splitTramiteItems(block);
    if (!items.length) warnings.push("Sección de trámites sin ítems `* TÍTULO:`");
    for (const it of items) {
      const kind = kindForTramiteKey(it.key);
      const money = extractUsdAmount(it.body);
      const label = it.key.replace(/\s+/g, " ");
      const detail = it.body.replace(/\s+/g, " ").trim();
      if (kind === "flight") {
        flights.push({
          id: `gdoc-flight-${slugify(label)}`,
          route: `${label}: ${detail.slice(0, 160)}${detail.length > 160 ? "…" : ""}`,
          datetime: "",
          code: "",
          done: false,
          amount: money?.amount ?? null,
          currency: money?.currency ?? null,
        });
      } else {
        docs.push({
          id: `gdoc-doc-${slugify(label)}`,
          label: detail ? `${label} — ${detail.slice(0, 200)}${detail.length > 200 ? "…" : ""}` : label,
          done: false,
          amount: money?.amount ?? null,
          currency: money?.currency ?? null,
        });
      }
    }
  }

  const stays = parseStaysFromItinerary(text);
  const bookingItems = parseBookingsFromItinerary(text);
  for (const b of bookingItems) bookings.push(b);

  if (!stays.length) warnings.push("No se detectaron líneas Alojamiento:");
  if (!bookings.length) warnings.push("No se detectaron reservas en notas");

  return { docs, flights, stays, bookings, warnings };
}
