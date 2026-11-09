import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, migrate } from "../db.mjs";
import {
  itineraryToMarkdown,
  formatLocationToken,
  formatStayLocation,
} from "../itinerary/exportMd.mjs";
import { replaceItinerary, itineraryToCanonical } from "../itinerary/store.mjs";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-export-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);
  return db;
}

test("formatLocationToken: coords / view / — / stay / vacío", () => {
  assert.equal(
    formatLocationToken({
      location_mode: "coords",
      lat: 35.7147654,
      lng: 139.7966551,
      location_precision: "place",
    }),
    "35.714765,139.796655",
  );
  assert.equal(
    formatLocationToken({
      location_mode: "coords",
      lat: 35.709,
      lng: 139.81,
      location_precision: "view",
    }),
    "~35.709000,139.810000",
  );
  assert.equal(formatLocationToken({ location_mode: "not_applicable" }), "—");
  assert.equal(formatLocationToken({ location_mode: "inherit_stay" }), "stay");
  assert.equal(formatLocationToken({ location_mode: "pending" }), "");
  assert.equal(formatLocationToken({}), "");
});

test("formatStayLocation: coords y ~view", () => {
  assert.equal(
    formatStayLocation({ stay_lat: 34.985849, stay_lng: 135.758767, stay_precision: "place" }),
    "34.985849,135.758767",
  );
  assert.equal(
    formatStayLocation({ stay_lat: 34.985849, stay_lng: 135.758767, stay_precision: "view" }),
    "~34.985849,135.758767",
  );
  assert.equal(formatStayLocation({ stay_lat: null, stay_lng: null }), "");
});

test("itineraryToCanonical incluye lat/lng/mode/precision y stay_*", () => {
  const db = tmpDb();
  replaceItinerary(db, {
    title: "Canon",
    anchor_date: null,
    days: [
      {
        day_number: 1,
        title: "Kyoto",
        base: "Kyoto",
        stay_label: "Gion",
        hub: "Gion",
        notes: "",
        stops: [
          { kind: "hub_out", name: "Gion", detail: "", how_to_get: "", est_duration: "", notes: "" },
          { kind: "stop", name: "Fushimi", detail: "", how_to_get: "", est_duration: "", notes: "", done: true },
        ],
      },
    ],
  });

  const dayId = db.prepare("SELECT id FROM itinerary_days WHERE day_number = 1").get().id;
  db.prepare(
    `UPDATE itinerary_days SET stay_lat = ?, stay_lng = ?, stay_precision = ? WHERE id = ?`,
  ).run(34.985849, 135.758767, "place", dayId);
  db.prepare(
    `UPDATE itinerary_stops SET lat = ?, lng = ?, location_mode = ?, location_precision = ?, done = 1
     WHERE day_id = ? AND name = 'Fushimi'`,
  ).run(34.96714, 135.772695, "coords", "place", dayId);

  const canon = itineraryToCanonical(db);
  const day = canon.days[0];
  assert.equal(day.stay_lat, 34.985849);
  assert.equal(day.stay_lng, 135.758767);
  assert.equal(day.stay_precision, "place");

  const hub = day.stops.find((s) => s.kind === "hub_out");
  assert.equal(hub.location_mode, "inherit_stay");
  assert.equal(hub.lat, null);

  const stop = day.stops.find((s) => s.name === "Fushimi");
  assert.equal(stop.lat, 34.96714);
  assert.equal(stop.lng, 135.772695);
  assert.equal(stop.location_mode, "coords");
  assert.equal(stop.location_precision, "place");
  assert.equal(stop.done, true);
});

test("export MD: Hecho, Ubicación, ubicación alojamiento y nota con |", () => {
  const md = itineraryToMarkdown({
    title: "Viaje",
    anchor_date: "2026-04-05",
    days: [
      {
        day_number: 1,
        title: "Tokyo",
        base: "Tokyo",
        stay_label: "Ikebukuro",
        hub: "Ikebukuro",
        notes: "Día largo",
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
          {
            kind: "stop",
            name: "Pendiente",
            detail: "",
            how_to_get: "",
            est_duration: "",
            notes: "",
            done: false,
            location_mode: "pending",
          },
        ],
      },
    ],
  });

  assert.match(md, /\|\s*#\s*\|\s*Parada\s*\|.*\|\s*Hecho\s*\|\s*Ubicación\s*\|/);
  assert.match(md, /\*\*Ubicación alojamiento:\*\* 35\.729500,139\.710900/);
  assert.match(md, /Sensō-ji.*\|\s*x\s*\|\s*35\.714765,139\.796655\s*\|/);
  assert.match(md, /Reservar \\\| entrada/);
  assert.match(md, /Almuerzo.*\|\s*\|\s*—\s*\|/);
  assert.match(md, /Mirador.*\|\s*~35\.709000,139\.810000\s*\|/);
  assert.match(md, /hub_back.*\|\s*stay\s*\|/);
  assert.match(md, /Pendiente.*\|\s*\|\s*\|/);
  assert.doesNotMatch(md, /## Ubicaciones/);
});

test("export MD: notas de parada y día hasta 4000 (límite schema)", () => {
  const long = "a".repeat(4500);
  const md = itineraryToMarkdown({
    title: "T",
    days: [
      {
        day_number: 1,
        title: "D",
        stay_label: "",
        notes: long,
        stops: [
          {
            kind: "stop",
            name: "P",
            detail: "",
            how_to_get: "",
            est_duration: "",
            notes: long,
            location_mode: "pending",
          },
        ],
      },
    ],
  });
  const stopRow = md.split("\n").find((l) => l.includes("| P |"));
  assert.ok(stopRow);
  // celda Notas escapada: 4000 'a' (sin truncar a 500)
  assert.ok(stopRow.includes("a".repeat(4000)));
  assert.ok(!stopRow.includes("a".repeat(4001)));

  const dayNotesIdx = md.indexOf("#### Notas del día");
  assert.ok(dayNotesIdx >= 0);
  const after = md.slice(dayNotesIdx);
  assert.ok(after.includes("a".repeat(4000)));
  assert.ok(!after.includes("a".repeat(4001)));
});

test("export vía itineraryToCanonical conserva tokens de ubicación", () => {
  const db = tmpDb();
  replaceItinerary(db, {
    title: "Round",
    days: [
      {
        day_number: 1,
        title: "Día",
        base: "Tokyo",
        stay_label: "Hotel",
        hub: "Hotel",
        notes: "",
        stops: [
          { kind: "stop", name: "A", detail: "", how_to_get: "", est_duration: "", notes: "a|b", done: true },
          { kind: "hub_back", name: "Vuelta", detail: "", how_to_get: "", est_duration: "", notes: "" },
        ],
      },
    ],
  });
  const dayId = db.prepare("SELECT id FROM itinerary_days LIMIT 1").get().id;
  db.prepare(
    `UPDATE itinerary_days SET stay_lat = 35.0, stay_lng = 139.0, stay_precision = 'view' WHERE id = ?`,
  ).run(dayId);
  db.prepare(
    `UPDATE itinerary_stops SET lat = 35.1, lng = 139.2, location_mode = 'coords', location_precision = 'place', done = 1
     WHERE day_id = ? AND name = 'A'`,
  ).run(dayId);

  const md = itineraryToMarkdown(itineraryToCanonical(db));
  assert.match(md, /\*\*Ubicación alojamiento:\*\* ~35\.000000,139\.000000/);
  assert.ok(md.includes("a\\|b"), "nota con | debe escaparse como \\|");
  assert.match(md, /\|\s*x\s*\|\s*35\.100000,139\.200000\s*\|/);
  assert.match(md, /hub_back.*\|\s*stay\s*\|/);
});
