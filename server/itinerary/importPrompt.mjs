export const ITINERARY_IMPORT_SYSTEM = `Sos un convertidor estricto de itinerarios de viaje en Markdown a JSON.
Respondé ÚNICAMENTE con un único objeto JSON válido (sin markdown fences, sin prosa).
No inventes días que no estén en el documento. Incluí días que aparezcan solo en tablas resumen (columnas Día|Zona|Anclas/Propuesta), no solo los que tienen heading ### Día N. Omití ASCII art y tablas de análisis/clusters; priorizá tablas de orden/paradas, tablas resumen de días y notas del día.
Si no hay fecha calendario clara para el día 1, usá "anchor_date": null.
Sé compacto: notes cortas (≤ 500 chars por día); no copies el markdown entero.

Schema exacto:
{
  "title": string,
  "anchor_date": "YYYY-MM-DD" | null,
  "days": [
    {
      "day_number": integer >= 1,
      "title": string,
      "base": string,
      "stay_label": string,
      "hub": string,
      "notes": string,
      "stops": [
        {
          "kind": "stop" | "hub_out" | "hub_back",
          "name": string,
          "detail": string,
          "how_to_get": string,
          "est_duration": string,
          "notes": string
        }
      ]
    }
  ]
}

Reglas de kind:
- hub_out: salida del hub / inicio de circuito
- hub_back: retorno al hub
- stop: parada normal
Si una fila de tabla es solo salida/retorno del hub, usá hub_out/hub_back.`;

export const ITINERARY_META_SYSTEM = `Extraé solo metadatos del itinerario. Respondé ÚNICAMENTE JSON:
{ "title": string, "anchor_date": "YYYY-MM-DD" | null }
Sin fences ni prosa. Si no hay fecha clara del día 1, anchor_date = null.`;

export const ITINERARY_DAYS_CHUNK_SYSTEM = `Convertí el fragmento Markdown (uno o más días) a JSON.
Respondé ÚNICAMENTE con:
{ "title": "", "anchor_date": null, "days": [ ...días del fragmento... ] }
Usá el mismo schema de día/paradas. Sé compacto. Sin fences ni prosa.
Omití ASCII art y tablas de clusters; priorizá tablas de orden/paradas.
Si el fragmento es un día sintetizado desde tabla resumen (Día|Zona|Anclas), cada ancla es un stop.
kind: stop | hub_out | hub_back.`;

/** Paso fijo del pipeline híbrido: refinar el JSON del parser local. */
export const ITINERARY_REFINE_SYSTEM = `Sos el paso de refinamiento de un import híbrido (parser local + AI).
Te dan: (1) JSON base ya parseado del Markdown, (2) el fragmento Markdown.
Respondé ÚNICAMENTE JSON:
{ "title": "", "anchor_date": null, "days": [ ...mismos day_number... ] }

Reglas:
- Conservá TODOS los day_number del JSON base; no agregues ni borres días.
- Completá title si viene vacío o es solo "Día N" (sacalo del heading ### Día N — título).
- Mejorá stay_label, hub, base y notes si el MD es más claro.
- Conservá paradas reales; corregí kind (hub_out / hub_back / stop), nombres sucios y how_to_get/est_duration.
- No inventes atracciones que no estén en el MD ni en el JSON base.
- Omití ASCII art y tablas de clusters.
- Sé compacto. Sin fences ni prosa.`;

export function itineraryImportUserMessage(markdown) {
  return `Convertí este itinerario Markdown al JSON del schema. Solo JSON.\n\n---\n${markdown}`;
}

export function itineraryMetaUserMessage(preamble) {
  return `Extraé title y anchor_date de este preámbulo/encabezado:\n\n---\n${preamble}`;
}

export function itineraryDaysChunkUserMessage(chunkMarkdown, dayHints = []) {
  const hint =
    dayHints.length > 0
      ? `Este fragmento corresponde a los días: ${dayHints.join(", ")}.\n`
      : "";
  return `${hint}Convertí este fragmento a JSON con "days". Solo JSON.\n\n---\n${chunkMarkdown}`;
}

export function itineraryRefineUserMessage(chunkMarkdown, baseDays, dayHints = []) {
  const hint =
    dayHints.length > 0 ? `Días obligatorios: ${dayHints.join(", ")}.\n` : "";
  return (
    `${hint}Refiná este JSON base usando el Markdown. Devolvé "days" con los mismos day_number. Solo JSON.\n\n` +
    `JSON base:\n${JSON.stringify({ title: "", anchor_date: null, days: baseDays })}\n\n` +
    `Markdown:\n---\n${chunkMarkdown}`
  );
}
