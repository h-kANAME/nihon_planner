# Itinerario: import / export Markdown

El tab **Plan** es un itinerario día a día (días → paradas → notas). La logística tipada (vuelos, alojamientos, reservas, docs) vive en **Resumen**.

## Flujo de import

1. Subís un `.md` (referencia de estilo: [`plan.example.md`](./plan.example.md)).
2. Pipeline **híbrido fijo**: parser local (headings + tablas) → meta AI (título/ancla) → refine AI por chunk sobre la base local → JSON canónico. Si el refine falla, se conserva la base local.
3. Se valida el JSON y se **reemplaza** todo el itinerario en SQLite.
4. La fecha ancla (Día 1 = `YYYY-MM-DD`) es **opcional**; podés dejarla vacía y completarla después en la UI.

## Export

`GET /api/v1/itinerary/export.md` genera Markdown **determinístico** desde la DB (sin AI), pensado para re-importar.

## JSON canónico (resumen)

```json
{
  "title": "string",
  "anchor_date": "YYYY-MM-DD | null",
  "days": [
    {
      "day_number": 1,
      "title": "",
      "base": "",
      "stay_label": "",
      "hub": "",
      "notes": "",
      "stops": [
        {
          "kind": "stop | hub_out | hub_back",
          "name": "",
          "detail": "",
          "how_to_get": "",
          "est_duration": "",
          "notes": ""
        }
      ]
    }
  ]
}
```

También existe `POST /api/v1/itinerary/import-json` para cargar el JSON sin pasar por AI (tests / backups).
