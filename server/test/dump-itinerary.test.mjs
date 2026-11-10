import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate } from "../db.mjs";
import { validateItineraryJson } from "../itinerary/schema.mjs";
import {
  replaceItinerary,
  loadItinerary,
  itineraryToCanonical,
} from "../itinerary/store.mjs";
import { itineraryToMarkdown } from "../itinerary/exportMd.mjs";
import { convertMarkdownToItinerary } from "../itinerary/convert.mjs";
import { importRoutes } from "../routes/import.mjs";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-dump-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  migrate(db);
  return { db, dir, dbPath };
}

function seedRichItinerary(db) {
  replaceItinerary(db, {
    title: "Dump RT",
    anchor_date: "2026-04-05",
    days: [
      {
        day_number: 1,
        title: "Tokyo",
        base: "Tokyo",
        stay_label: "Ikebukuro",
        hub: "Ikebukuro",
        notes: "Día con nota | pipe",
        stay_lat: 35.7295,
        stay_lng: 139.7109,
        stay_precision: "place",
        stops: [
          {
            kind: "hub_out",
            name: "Ikebukuro",
            detail: "",
            how_to_get: "",
            est_duration: "",
            notes: "",
            done: false,
            location_mode: "inherit_stay",
          },
          {
            kind: "stop",
            name: "Sensō-ji",
            detail: "Templo",
            how_to_get: "Metro",
            est_duration: "90 min",
            notes: "Reservar | entrada",
            done: true,
            lat: 35.714765,
            lng: 139.796655,
            location_mode: "coords",
            location_precision: "place",
          },
          {
            kind: "stop",
            name: "Almuerzo",
            detail: "",
            how_to_get: "",
            est_duration: "45 min",
            notes: "",
            done: false,
            location_mode: "not_applicable",
          },
          {
            kind: "stop",
            name: "Mirador",
            detail: "",
            how_to_get: "",
            est_duration: "30 min",
            notes: "",
            done: false,
            lat: 35.709,
            lng: 139.81,
            location_mode: "coords",
            location_precision: "view",
          },
          {
            kind: "hub_back",
            name: "Retorno",
            detail: "",
            how_to_get: "",
            est_duration: "",
            notes: "",
            done: false,
            location_mode: "inherit_stay",
          },
        ],
      },
    ],
  });
}

test("trustLocations true conserva lat/lng/mode/precision/stay; false los descarta", () => {
  const raw = {
    title: "T",
    days: [
      {
        day_number: 1,
        title: "D",
        stay_lat: 35.7,
        stay_lng: 139.7,
        stay_precision: "view",
        stay_raw_input: "~35.7,139.7",
        stops: [
          {
            kind: "stop",
            name: "A",
            detail: "",
            how_to_get: "",
            est_duration: "",
            notes: "",
            done: true,
            lat: 35.1,
            lng: 139.2,
            location_mode: "coords",
            location_precision: "place",
            raw_input: "35.1,139.2",
          },
        ],
      },
    ],
  };

  const trusted = validateItineraryJson(raw, { trustLocations: true });
  assert.equal(trusted.ok, true);
  assert.equal(trusted.data.days[0].stay_lat, 35.7);
  assert.equal(trusted.data.days[0].stay_precision, "view");
  assert.equal(trusted.data.days[0].stay_raw_input, "~35.7,139.7");
  const ts = trusted.data.days[0].stops[0];
  assert.equal(ts.lat, 35.1);
  assert.equal(ts.lng, 139.2);
  assert.equal(ts.location_mode, "coords");
  assert.equal(ts.location_precision, "place");
  assert.equal(ts.raw_input, "35.1,139.2");
  assert.equal(ts.done, true);

  const stripped = validateItineraryJson(raw, { trustLocations: false });
  assert.equal(stripped.ok, true);
  assert.equal(stripped.data.days[0].stay_lat, undefined);
  assert.equal(stripped.data.days[0].stops[0].lat, undefined);
  assert.equal(stripped.data.days[0].stops[0].location_mode, undefined);
  assert.equal(stripped.data.days[0].stops[0].done, true);
});

test("Dump: export/dump → import restaura itinerario con coordenadas y done", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = Fastify({ logger: false });
  await importRoutes(app, { db, config: { dbPath } });
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedRichItinerary(db);
  const before = loadItinerary(db);

  const dumpRes = await app.inject({ method: "GET", url: "/api/v1/export/dump" });
  assert.equal(dumpRes.statusCode, 200);
  const dump = dumpRes.json();
  assert.ok(dump["jp:itinerary"]);
  assert.equal(dump["jp:itinerary"].title, "Dump RT");
  assert.equal(dump["jp:itinerary"].days[0].stops.find((s) => s.name === "Sensō-ji").done, true);
  assert.equal(dump["jp:itinerary"].days[0].stay_lat, 35.7295);

  // Vaciar itinerario para probar restauración
  replaceItinerary(db, {
    title: "vacío",
    anchor_date: null,
    days: [
      {
        day_number: 99,
        title: "X",
        base: "",
        stay_label: "",
        hub: "",
        notes: "",
        stops: [{ kind: "stop", name: "Solo", detail: "", how_to_get: "", est_duration: "", notes: "" }],
      },
    ],
  });
  assert.equal(loadItinerary(db).days[0].day_number, 99);

  const importRes = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:itinerary": dump["jp:itinerary"] },
  });
  assert.equal(importRes.statusCode, 200);
  const imported = importRes.json();
  assert.equal(imported.ok, true);
  assert.equal(imported.imported.itinerary, true);

  const after = loadItinerary(db);
  assert.equal(after.meta.title, before.meta.title);
  assert.equal(after.days.length, 1);
  assert.equal(after.days[0].day_number, 1);
  assert.equal(after.days[0].stay_lat, 35.7295);
  assert.equal(after.days[0].stay_lng, 139.7109);
  assert.equal(after.days[0].stay_precision, "place");

  const byName = Object.fromEntries(after.days[0].stops.map((s) => [s.name, s]));
  assert.equal(byName["Ikebukuro"].location_mode, "inherit_stay");
  assert.equal(byName["Sensō-ji"].location_mode, "coords");
  assert.equal(byName["Sensō-ji"].lat, 35.714765);
  assert.equal(byName["Sensō-ji"].lng, 139.796655);
  assert.equal(byName["Sensō-ji"].done, true);
  assert.equal(byName["Almuerzo"].location_mode, "not_applicable");
  assert.equal(byName["Mirador"].location_mode, "coords");
  assert.equal(byName["Mirador"].location_precision, "view");
  assert.equal(byName["Mirador"].lat, 35.709);
  assert.equal(byName["Retorno"].location_mode, "inherit_stay");
});

test("Round-trip MD: export → import (heurística) conserva ubicaciones, view, done y nota con |", async () => {
  const { db, dir } = tmpDb();
  try {
    seedRichItinerary(db);
    const before = loadItinerary(db);
    const md = itineraryToMarkdown(itineraryToCanonical(db));
    assert.match(md, /Reservar \\\| entrada/);
    assert.match(md, /~35\.709000,139\.810000/);

    const aiStub = {
      async chatComplete() {
        throw new Error("AI offline — usar base local");
      },
    };
    const converted = await convertMarkdownToItinerary(aiStub, md);
    assert.ok(converted.data.days.length >= 1);
    assert.ok(converted.locationsByDay.size >= 1);

    replaceItinerary(db, converted.data, { locationsByDay: converted.locationsByDay });
    const after = loadItinerary(db);

    assert.equal(after.days.length, before.days.length);
    assert.equal(after.days[0].stay_lat, before.days[0].stay_lat);
    assert.equal(after.days[0].stay_lng, before.days[0].stay_lng);

    const beforeBy = Object.fromEntries(before.days[0].stops.map((s) => [s.name, s]));
    const afterBy = Object.fromEntries(after.days[0].stops.map((s) => [s.name, s]));
    for (const name of Object.keys(beforeBy)) {
      assert.ok(afterBy[name], `falta parada ${name}`);
      assert.equal(afterBy[name].location_mode, beforeBy[name].location_mode, name);
      assert.equal(afterBy[name].lat, beforeBy[name].lat, name);
      assert.equal(afterBy[name].lng, beforeBy[name].lng, name);
      assert.equal(afterBy[name].location_precision, beforeBy[name].location_precision, name);
      assert.equal(afterBy[name].done, beforeBy[name].done, name);
    }
    assert.equal(afterBy["Sensō-ji"].notes, "Reservar | entrada");
    assert.equal(afterBy["Mirador"].location_precision, "view");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
