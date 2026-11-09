import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLocationCell,
  splitRow,
  heuristicParseChunk,
  stripLocationsAppendix,
} from "../itinerary/heuristic.mjs";
import {
  ITINERARY_IMPORT_SYSTEM,
  ITINERARY_REFINE_SYSTEM,
  ITINERARY_DAYS_CHUNK_SYSTEM,
} from "../itinerary/importPrompt.mjs";

test("parseLocationCell: tokens — / stay / coords / ~view / vacío / unparsable", () => {
  assert.equal(parseLocationCell("—").mode, "not_applicable");
  assert.equal(parseLocationCell("stay").mode, "inherit_stay");
  assert.equal(parseLocationCell("STAY").mode, "inherit_stay");

  const c = parseLocationCell("35.714765,139.796655");
  assert.equal(c.mode, "coords");
  assert.equal(c.lat, 35.714765);
  assert.equal(c.lng, 139.796655);
  assert.equal(c.precision, "place");

  const v = parseLocationCell("~35.709000,139.810000");
  assert.equal(v.mode, "coords");
  assert.equal(v.precision, "view");
  assert.equal(v.lat, 35.709);
  assert.equal(v.lng, 139.81);

  const spaced = parseLocationCell("  ~ 35.7 , 139.8 ");
  assert.equal(spaced.mode, "coords");
  assert.equal(spaced.precision, "view");

  assert.equal(parseLocationCell("").mode, "pending");
  assert.equal(parseLocationCell("   ").mode, "pending");

  const bad = parseLocationCell("cerca del templo");
  assert.equal(bad.mode, "pending");
  assert.equal(bad.warning, "LOCATION_UNPARSABLE");
  assert.equal(bad.raw_input, "cerca del templo");
});

test("splitRow: pipe escapado en notas no rompe columnas", () => {
  const cells = splitRow("| 1 | Sensō-ji | Templo | Metro | 90 min | Reservar \\| entrada | stop | x | 35.714765,139.796655 |");
  assert.equal(cells.length, 9);
  assert.equal(cells[5], "Reservar | entrada");
  assert.equal(cells[7], "x");
  assert.equal(cells[8], "35.714765,139.796655");
});

test("splitRow: celda final con \\| no se traga al quitar pipe de cierre", () => {
  const cells = splitRow("| a | b\\| |");
  assert.equal(cells.length, 2);
  assert.equal(cells[0], "a");
  assert.equal(cells[1], "b|");
});

test("anclas stay: Alojamiento no captura Ubicación alojamiento", () => {
  const md = `### Día 1 — Tokyo

**Base:** Tokyo
**Alojamiento:** Ikebukuro
**Ubicación alojamiento:** 35.729500,139.710900
**Hub logístico:** Ikebukuro

#### Paradas

| # | Parada | Detalle | Cómo llegar | Est. | Notas | Kind | Hecho | Ubicación |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | Ikebukuro | | | | | hub_out | | stay |
| 1 | Sensō-ji | Templo | Metro | 90 min | nota \\| pipe | stop | x | 35.714765,139.796655 |
| 2 | Almuerzo | | | 45 min | | stop | | — |
| 3 | Mirador | | | 30 min | | stop | | ~35.709000,139.810000 |
| — | Retorno | | | | | hub_back | | stay |
| 4 | Pendiente | | | | | stop | | |
| 5 | Basura | | | | | stop | | no-es-coord |
`;

  const { days, locationsByDay, warnings } = heuristicParseChunk(md, [1]);
  assert.equal(days.length, 1);
  assert.equal(days[0].base, "Tokyo");
  assert.equal(days[0].stay_label, "Ikebukuro");
  assert.ok(!/35\.729/.test(days[0].stay_label), "stay_label no debe contaminarse con coords");

  const loc = locationsByDay.get(1);
  assert.ok(loc);
  assert.equal(loc.stay_location.mode, "coords");
  assert.equal(loc.stay_location.lat, 35.7295);
  assert.equal(loc.stay_location.lng, 139.7109);
  assert.equal(loc.stay_location.precision, "place");

  assert.equal(loc.stops.length, 7);
  assert.equal(loc.stops[0].location.mode, "inherit_stay");
  assert.equal(loc.stops[0].done, false);
  assert.equal(loc.stops[1].name, "Sensō-ji");
  assert.equal(loc.stops[1].done, true);
  assert.equal(loc.stops[1].location.mode, "coords");
  assert.equal(loc.stops[1].location.lat, 35.714765);
  assert.equal(days[0].stops[1].notes, "nota | pipe");

  assert.equal(loc.stops[2].location.mode, "not_applicable");
  assert.equal(loc.stops[3].location.mode, "coords");
  assert.equal(loc.stops[3].location.precision, "view");
  assert.equal(loc.stops[4].location.mode, "inherit_stay");
  assert.equal(loc.stops[5].name, "Pendiente");
  assert.equal(loc.stops[5].location.mode, "pending");
  assert.ok(!loc.stops[5].location.warning);

  assert.equal(loc.stops[6].name, "Basura");
  assert.equal(loc.stops[6].location.mode, "pending");
  assert.equal(loc.stops[6].location.warning, "LOCATION_UNPARSABLE");
  assert.ok(warnings.some((w) => w.includes("LOCATION_UNPARSABLE")));

  // days[] no lleva location/done (solo locationsByDay)
  assert.equal(days[0].stops[1].done, undefined);
  assert.equal(days[0].stops[1].location, undefined);
});

test("apéndice ## Ubicaciones: parse + strip + resolve @slug", () => {
  const md = `# Viaje

### Día 2 — Kyoto

**Alojamiento:** Gion
**Ubicación alojamiento:** @hotel

| # | Parada | Kind | Hecho | Ubicación |
| --- | --- | --- | --- | --- |
| 1 | Fushimi | stop | x | @fushimi |
| 2 | Almuerzo | stop | | — |

## Ubicaciones

| Slug | Nombre | Coordenadas |
| --- | --- | --- |
| @fushimi | Fushimi Inari | 34.967140,135.772695 |
| @hotel | Ryokan | ~35.003600,135.778600 |
`;

  const { markdown, places } = stripLocationsAppendix(md);
  assert.ok(!/^##\s+Ubicaciones/m.test(markdown));
  assert.ok(places.has("@fushimi"));
  assert.equal(places.get("@fushimi").lat, 34.96714);

  const { locationsByDay, warnings } = heuristicParseChunk(markdown, [2], { places });
  const loc = locationsByDay.get(2);
  assert.equal(loc.stay_location.mode, "coords");
  assert.equal(loc.stay_location.precision, "view");
  assert.equal(loc.stay_location.lat, 35.0036);
  assert.equal(loc.stops[0].location.mode, "coords");
  assert.equal(loc.stops[0].location.lat, 34.96714);
  assert.equal(loc.stops[0].done, true);
  assert.equal(loc.stops[1].location.mode, "not_applicable");
  assert.equal(warnings.filter((w) => w.includes("LOCATION_UNPARSABLE")).length, 0);
});

test("importPrompt: AI no inventa ubicaciones", () => {
  for (const prompt of [ITINERARY_IMPORT_SYSTEM, ITINERARY_REFINE_SYSTEM, ITINERARY_DAYS_CHUNK_SYSTEM]) {
    assert.match(prompt, /ubicaci/i);
    assert.match(prompt, /invent/i);
  }
  // Schema del prompt no pide campos de ubicación
  assert.doesNotMatch(ITINERARY_IMPORT_SYSTEM, /"lat"\s*:/);
  assert.doesNotMatch(ITINERARY_IMPORT_SYSTEM, /"location_mode"\s*:/);
  assert.doesNotMatch(ITINERARY_REFINE_SYSTEM, /"done"\s*:/);
});
