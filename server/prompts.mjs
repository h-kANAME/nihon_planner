/**
 * System prompts en español rioplatense (mismos textos del front original).
 */

import { loadItinerary } from "./itinerary/store.mjs";
import { parseJson, LOGISTICS_KINDS } from "./helpers.mjs";

function estado(done) {
  return done ? "CUMPLIDO ✓" : "pendiente";
}

export function buildTripContext(db) {
  const ratesRow = db.prepare("SELECT value FROM settings WHERE key = 'rates'").get();
  const rates = ratesRow ? JSON.parse(ratesRow.value) : { usdArs: 1300, usdJpy: 155 };

  const expenses = db.prepare("SELECT * FROM expenses ORDER BY spent_at DESC").all();
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
    if (amount == null || !currency) return 0;
    if (currency === "USD") return amount;
    if (currency === "ARS") return amount / rates.usdArs;
    return amount / rates.usdJpy;
  };

  let totalUSD = 0;
  const gastos = [];
  const flights = [];
  const stays = [];
  const bookings = [];
  const docs = [];

  for (const e of expenses) {
    if (e.amount != null && e.currency) {
      totalUSD += toUSD(e.amount, e.currency);
    }
    if (LOGISTICS_KINDS.has(e.kind)) {
      const meta = parseJson(e.meta_json, {});
      if (e.kind === "flight") {
        flights.push({
          ruta: e.description,
          fecha_hora: e.datetime_start,
          codigo: meta.code || "",
          monto: e.amount,
          moneda: e.currency,
          estado: estado(!!e.done),
        });
      } else if (e.kind === "stay") {
        stays.push({
          ciudad: meta.city || "",
          nombre: meta.name || e.description,
          checkin: e.datetime_start,
          checkout: e.datetime_end,
          monto: e.amount,
          moneda: e.currency,
          estado: estado(!!e.done),
        });
      } else if (e.kind === "booking") {
        bookings.push({
          actividad: e.description,
          fecha_hora: e.datetime_start,
          monto: e.amount,
          moneda: e.currency,
          estado: estado(!!e.done),
        });
      } else if (e.kind === "doc") {
        docs.push({
          item: e.description,
          estado: estado(!!e.done),
        });
      }
    } else {
      gastos.push({
        desc: e.description,
        monto: e.amount,
        moneda: e.currency,
        cat: e.category,
        fecha: e.spent_at?.slice(0, 10),
        estado: estado(!!e.done),
      });
    }
  }

  const data = {
    cotizaciones: { "1 USD en ARS": rates.usdArs, "1 USD en JPY": rates.usdJpy },
    totales_gastados: {
      JPY: Math.round(totalUSD * rates.usdJpy),
      USD: +totalUSD.toFixed(2),
      ARS: Math.round(totalUSD * rates.usdArs),
    },
    gastos,
    vuelos: flights,
    alojamientos: stays,
    reservas: bookings,
    documentacion: docs,
    itinerario: itineraryBlock,
  };

  return JSON.stringify(data);
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
