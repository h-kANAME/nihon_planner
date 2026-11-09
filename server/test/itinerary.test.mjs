import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate } from "../db.mjs";
import { validateItineraryJson, extractJsonObject } from "../itinerary/schema.mjs";
import { itineraryToMarkdown } from "../itinerary/exportMd.mjs";
import { replaceItinerary, loadItinerary, itineraryToCanonical } from "../itinerary/store.mjs";
import { splitMarkdownByDays, mergeRefinedDay, mergeRefinedDays } from "../itinerary/convert.mjs";
import { heuristicDaysFromChunk } from "../itinerary/heuristic.mjs";
import { itineraryRoutes } from "../routes/itinerary.mjs";


test("extractJsonObject y validateItineraryJson", () => {
  const raw = '```json\n{"title":"T","anchor_date":null,"days":[{"day_number":1,"title":"Arribo","base":"Tokyo","stay_label":"Ikebukuro","hub":"Ikebukuro","notes":"","stops":[{"kind":"stop","name":"Check-in","detail":"","how_to_get":"","est_duration":"","notes":""}]}]}\n```';
  const extracted = extractJsonObject(raw);
  assert.ok(extracted);
  const v = validateItineraryJson(raw);
  assert.equal(v.ok, true);
  assert.equal(v.data.days.length, 1);
  assert.equal(v.data.days[0].stops[0].name, "Check-in");
});

test("validate rechaza sin días", () => {
  const v = validateItineraryJson({ title: "x", days: [] });
  assert.equal(v.ok, false);
});

test("validate acepta claves en español", () => {
  const v = validateItineraryJson({
    titulo: "Viaje",
    fecha_ancla: null,
    dias: [
      {
        dia: 1,
        titulo: "Arribo",
        alojamiento: "Ikebukuro",
        paradas: [{ nombre: "Check-in", tipo: "stop" }],
      },
    ],
  });
  assert.equal(v.ok, true);
  assert.equal(v.data.days[0].day_number, 1);
  assert.equal(v.data.days[0].stops[0].name, "Check-in");
});

test("heuristicDaysFromChunk lee tablas de paradas", () => {
  const md = `### Día 1

**Alojamiento:** Ikebukuro

#### Paradas

| # | Parada | Detalle | Notas / reserva |
| --- | --- | --- | --- |
| 1 | Ikebukuro | Base / check-in | Desde aeropuerto |

#### Notas del día

- Descansar
`;
  const days = heuristicDaysFromChunk(md, [1]);
  assert.equal(days.length, 1);
  assert.equal(days[0].day_number, 1);
  assert.equal(days[0].stay_label, "Ikebukuro");
  assert.ok(days[0].stops.some((s) => s.name.includes("Ikebukuro")));
  const v = validateItineraryJson({ title: "t", days });
  assert.equal(v.ok, true);
});

test("splitMarkdownByDays detecta ### Día N", () => {
  const md = `# Título

Intro

### Día 1

Parada A

### Día 2 — Oeste

Parada B
`;
  const { preamble, chunks } = splitMarkdownByDays(md);
  assert.match(preamble, /Intro/);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].dayNumber, 1);
  assert.equal(chunks[1].dayNumber, 2);
  assert.match(chunks[1].text, /Parada B/);
});

test("tablas resumen Día|Zona|Anclas amplían chunks a 20 en plan.example", async () => {
  const { fileURLToPath } = await import("node:url");
  const { augmentChunksWithSummaryDays, parseSummaryDayTables } = await import(
    "../itinerary/summaryDays.mjs"
  );
  const mdPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../docs/plan.example.md");
  const md = fs.readFileSync(mdPath, "utf8");
  const { chunks: heading } = splitMarkdownByDays(md);
  assert.equal(heading.length, 20);
  const summary = parseSummaryDayTables(md);
  assert.equal(summary.filter((d) => d.day_number >= 13).length, 0);
  const chunks = augmentChunksWithSummaryDays(md, heading);
  assert.equal(chunks.length, 20);
  assert.equal(chunks.filter((c) => c.fromSummary).length, 0);
  const d18 = chunks.find((c) => c.dayNumber === 18);
  assert.match(d18.text, /USJ|Universal/i);
});

test("heuristic evita tabla de clusters y toma orden eficiente", () => {
  const md = `### Día 3 — Este

**Alojamiento:** Ikebukuro

#### Análisis de clusters

| Cluster | Paradas | Relación espacial |
| --- | --- | --- |
| A | Ueno · Parque | mismo parque |

#### Orden eficiente propuesto

| Orden | Parada | Cómo llegar | Est. en sitio | Acum. |
| --- | --- | --- | --- | --- |
| — | **Ikebukuro** (salida) | — | — | 0 h |
| 1 | Ueno | Yamanote | 15 min | ~0,4 h |
| — | **Ikebukuro** (retorno) | Yamanote | — | **~1 h** |
`;
  const days = heuristicDaysFromChunk(md, [3]);
  assert.equal(days.length, 1);
  assert.equal(days[0].title, "Este");
  assert.ok(days[0].stops.some((s) => s.name.includes("Ueno")));
  assert.ok(!days[0].stops.some((s) => /Ueno · Parque/i.test(s.name)));
  assert.ok(days[0].stops.some((s) => s.kind === "hub_out"));
});

test("mergeRefinedDay conserva base si AI deja stops vacíos", () => {
  const base = {
    day_number: 11,
    title: "",
    base: "",
    stay_label: "Meieki",
    hub: "Meieki",
    notes: "n",
    stops: [{ kind: "stop", name: "Castillo", detail: "", how_to_get: "", est_duration: "", notes: "" }],
  };
  const refined = {
    day_number: 11,
    title: "Nagoya",
    base: "Nagoya",
    stay_label: "Meieki (Nagoya Station)",
    hub: "Meieki",
    notes: "mejor",
    stops: [],
  };
  const m = mergeRefinedDay(base, refined);
  assert.equal(m.title, "Nagoya");
  assert.equal(m.stops.length, 1);
  assert.equal(m.stops[0].name, "Castillo");
  const batch = mergeRefinedDays([base], [refined]);
  assert.equal(batch[0].title, "Nagoya");
});

test("export MD + replace TX + import-json", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-itin-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  migrate(db);

  const app = Fastify({ logger: false });
  await itineraryRoutes(app, {
    db,
    ai: {},
    config: { aiProvider: "test", aiModel: "test", dbPath },
  });

  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const fixture = {
    title: "Viaje test",
    anchor_date: "2026-04-05",
    days: [
      {
        day_number: 1,
        title: "Arribo",
        base: "Tokyo",
        stay_label: "Ikebukuro",
        hub: "Ikebukuro",
        notes: "Descansar",
        stops: [
          { kind: "hub_out", name: "Ikebukuro", detail: "salida", how_to_get: "", est_duration: "", notes: "" },
          { kind: "stop", name: "Harajuku", detail: "Zona", how_to_get: "Yamanote", est_duration: "45 min", notes: "" },
        ],
      },
      {
        day_number: 2,
        title: "Este",
        base: "Tokyo",
        stay_label: "Ikebukuro",
        hub: "Ikebukuro",
        notes: "",
        stops: [{ kind: "stop", name: "Ueno", detail: "", how_to_get: "", est_duration: "", notes: "" }],
      },
    ],
  };

  replaceItinerary(db, fixture, { source_filename: "t.md" });
  const loaded = loadItinerary(db);
  assert.equal(loaded.days.length, 2);
  assert.equal(loaded.meta.title, "Viaje test");
  assert.equal(loaded.meta.anchor_date, "2026-04-05");
  assert.equal(loaded.days[0].stops.length, 2);

  const md = itineraryToMarkdown(itineraryToCanonical(db));
  assert.match(md, /# Viaje test/);
  assert.match(md, /## Día 1 — Arribo/);
  assert.match(md, /Harajuku/);

  const replaced = {
    title: "Solo un día",
    anchor_date: null,
    days: [
      {
        day_number: 9,
        title: "Hakone",
        base: "Hakone",
        stay_label: "Ryokan",
        hub: "",
        notes: "n",
        stops: [{ kind: "stop", name: "Onsen", detail: "", how_to_get: "", est_duration: "", notes: "" }],
      },
    ],
  };
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-json",
    payload: replaced,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.itinerary.days.length, 1);
  assert.equal(body.itinerary.days[0].day_number, 9);
  assert.equal(body.itinerary.meta.anchor_date, null);

  const exportRes = await app.inject({ method: "GET", url: "/api/v1/itinerary/export.md" });
  assert.equal(exportRes.statusCode, 200);
  assert.match(exportRes.body, /Día 9/);
});
