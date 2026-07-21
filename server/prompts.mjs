/**
 * System prompts en español rioplatense (mismos textos del front original).
 */

import { loadItinerary } from "./itinerary/store.mjs";

function estado(done) {
  return done ? "CUMPLIDO ✓" : "pendiente";
}

export function buildTripContext(db) {
  const ratesRow = db.prepare("SELECT value FROM settings WHERE key = 'rates'").get();
  const rates = ratesRow ? JSON.parse(ratesRow.value) : { usdArs: 1300, usdJpy: 155 };

  const expenses = db.prepare("SELECT * FROM expenses ORDER BY spent_at DESC").all();
  const items = db.prepare("SELECT * FROM plan_items ORDER BY datetime_start").all();
  let itineraryBlock = null;
  try {
    const it = loadItinerary(db);
    itineraryBlock = {
      titulo: it.meta.title || "",
      fecha_ancla: it.meta.anchor_date,
      dias: it.days.map((d) => ({
        dia: d.day_number,
        titulo: d.title,
        base: d.base,
        dormir: d.stay_label,
        hub: d.hub,
        notas: d.notes,
        paradas: d.stops.map((s) => ({
          nombre: s.name,
          kind: s.kind,
          detalle: s.detail,
          como_llegar: s.how_to_get,
          est: s.est_duration,
          notas: s.notes,
          estado: estado(s.done),
        })),
      })),
    };
  } catch {
    itineraryBlock = null;
  }

  const toUSD = (amount, currency) => {
    if (currency === "USD") return amount;
    if (currency === "ARS") return amount / rates.usdArs;
    return amount / rates.usdJpy;
  };

  let totalUSD = 0;
  const gastos = expenses.map((e) => {
    const usd = toUSD(e.amount, e.currency);
    totalUSD += usd;
    return {
      desc: e.description,
      monto: e.amount,
      moneda: e.currency,
      cat: e.category,
      fecha: e.spent_at?.slice(0, 10),
    };
  });

  const flights = items.filter((i) => i.type === "flight");
  const stays = items.filter((i) => i.type === "stay");
  const bookings = items.filter((i) => i.type === "booking");
  const docs = items.filter((i) => i.type === "doc");

  const parseMeta = (m) => {
    try {
      return JSON.parse(m || "{}");
    } catch {
      return {};
    }
  };

  const data = {
    cotizaciones: { "1 USD en ARS": rates.usdArs, "1 USD en JPY": rates.usdJpy },
    totales_gastados: {
      JPY: Math.round(totalUSD * rates.usdJpy),
      USD: +totalUSD.toFixed(2),
      ARS: Math.round(totalUSD * rates.usdArs),
    },
    gastos,
    vuelos: flights.map((f) => {
      const meta = parseMeta(f.meta);
      return {
        ruta: f.title,
        fecha_hora: f.datetime_start,
        codigo: meta.code || "",
        estado: estado(!!f.done),
      };
    }),
    alojamientos: stays.map((s) => {
      const meta = parseMeta(s.meta);
      return {
        ciudad: meta.city || "",
        nombre: fTitle(s.title, meta.name),
        checkin: s.datetime_start,
        checkout: s.datetime_end,
        estado: estado(!!s.done),
      };
    }),
    reservas: bookings.map((b) => ({
      actividad: b.title,
      fecha_hora: b.datetime_start,
      estado: estado(!!b.done),
    })),
    documentacion: docs.map((d) => ({
      item: d.title,
      estado: estado(!!d.done),
    })),
    itinerario: itineraryBlock,
  };

  return JSON.stringify(data);
}

function fTitle(title, name) {
  return name || title;
}

export function systemPromptFor(mode, tripJson, summary) {
  const base =
    mode === "consultar"
      ? `Sos un asistente de viaje conciso en español rioplatense. Respondés SOLO en base a los datos ya cargados del viaje (JSON abajo). Si algo no está en los datos, decilo claramente. Cada ítem tiene un campo "estado": si dice CUMPLIDO ✓ informalo explícitamente como cumplido/realizado; si dice pendiente, marcalo como pendiente. Viaje: Japón, 20 días, pareja argentina. Si la respuesta es larga, cerrá bloques coherentes (la continuación ante cortes la maneja el servidor).\nDATOS ACTUALES DEL VIAJE:\n${tripJson}`
      : `Sos un asesor de turismo experto en Japón, en español rioplatense, tono cercano y práctico. Ayudás a planificar un viaje de 20 días para una pareja argentina. Intereses: cultura y templos, anime/gaming/tecnología, naturaleza, y cultura automotriz JDM (quieren conocer Daikoku PA). Presupuesto sin tope pero registran gastos. Das recomendaciones concretas: rutas, tiempos, reservas con anticipación, transporte (JR Pass vs sueltos), estacionalidad. Respuestas accionables, con bullets cuando ayude. Si armás itinerarios largos, priorizá bloques cerrados y coherentes (la continuación ante cortes la maneja el servidor; no te auto-limites en N partes fijas).\nContexto de lo ya planificado (para no contradecirlo):\n${tripJson}`;

  if (summary) {
    return `${base}\n\nRESUMEN DE CONVERSACIÓN PREVIA (decisiones e info acordada):\n${summary}`;
  }
  return base;
}

export const COMPACT_PROMPT =
  "Resumí en español rioplatense (≤ 300 palabras) las decisiones tomadas y la información acordada en esta conversación de planificación de viaje a Japón. Solo hechos útiles para continuar la charla; sin saludos ni relleno.";
