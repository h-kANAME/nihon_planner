import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, migrate } from "../db.mjs";
import {
  replaceItinerary,
  loadItinerary,
  nameNorm,
  resolveDayStop,
} from "../itinerary/store.mjs";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-relink-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);
  return { db, dir };
}

function coords(lat, lng, precision = "place") {
  return {
    mode: "coords",
    lat,
    lng,
    precision,
    raw_input: precision === "view" ? `~${lat},${lng}` : `${lat},${lng}`,
  };
}

test("nameNorm: NFKC, diacríticos, markdown, paréntesis finales", () => {
  assert.equal(nameNorm("Sensō-ji"), "senso-ji");
  assert.equal(nameNorm("  **Café**  Central  "), "cafe central");
  assert.equal(nameNorm("Templo (entrada norte)"), "templo");
  assert.equal(nameNorm("`Ueno`_Park_"), "uenopark");
});

test("Merge: rename/reorder conserva coords por name_norm", () => {
  const { db, dir } = tmpDb();
  const locationsByDay = new Map([
    [
      1,
      {
        stay_location: coords(35.73, 139.71),
        stops: [
          { index: 0, name: "Salida", location: { mode: "inherit_stay" }, done: false },
          { index: 1, name: "Sensō-ji", location: coords(35.714765, 139.796655), done: true },
          { index: 2, name: "Almuerzo", location: { mode: "not_applicable" }, done: false },
          { index: 3, name: "Mirador", location: coords(35.709, 139.81, "view"), done: false },
          { index: 4, name: "Vuelta", location: { mode: "inherit_stay" }, done: false },
        ],
      },
    ],
  ]);

  // AI reordenó y renombró levemente (diacríticos / markdown)
  const { itinerary, relink_report } = replaceItinerary(
    db,
    {
      title: "t",
      anchor_date: null,
      days: [
        {
          day_number: 1,
          title: "Tokyo",
          base: "Tokyo",
          stay_label: "Hotel",
          hub: "Ikebukuro",
          notes: "",
          stops: [
            { kind: "hub_out", name: "Salida", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "stop", name: "Mirador", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "stop", name: "**Senso-ji**", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "stop", name: "Almuerzo", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "hub_back", name: "Vuelta", detail: "", how_to_get: "", est_duration: "", notes: "" },
          ],
        },
      ],
    },
    { locationsByDay },
  );

  const stops = itinerary.days[0].stops;
  assert.equal(stops[1].name, "Mirador");
  assert.equal(stops[1].location_mode, "coords");
  assert.equal(stops[1].lat, 35.709);
  assert.equal(stops[1].location_precision, "view");

  assert.equal(stops[2].location_mode, "coords");
  assert.equal(stops[2].lat, 35.714765);
  assert.equal(stops[2].lng, 139.796655);
  assert.equal(stops[2].done, true);

  assert.equal(stops[3].location_mode, "not_applicable");
  assert.equal(stops[0].location_mode, "inherit_stay");
  assert.equal(stops[4].location_mode, "inherit_stay");

  assert.equal(itinerary.days[0].stay_lat, 35.73);
  assert.equal(itinerary.days[0].stay_lng, 139.71);
  assert.equal(relink_report.located, 2);
  assert.equal(relink_report.not_applicable, 1);
  assert.equal(relink_report.inherited, 2);
  assert.equal(relink_report.pending, 0);
  assert.equal(relink_report.warnings.length, 0);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Merge: count mismatch → pending + LOCATION_UNMATCHED (sin fallback por índice)", () => {
  const { db, dir } = tmpDb();
  const locationsByDay = new Map([
    [
      1,
      {
        stay_location: null,
        stops: [
          { index: 0, name: "Alpha", location: coords(1, 1), done: false },
          { index: 1, name: "Beta", location: coords(2, 2), done: false },
          { index: 2, name: "Gamma", location: coords(3, 3), done: false },
        ],
      },
    ],
  ]);

  // Misma cantidad NO: AI agregó una parada y renombró → índice no debe aplicar
  const { itinerary, relink_report } = replaceItinerary(
    db,
    {
      title: "t",
      anchor_date: null,
      days: [
        {
          day_number: 1,
          title: "D1",
          base: "",
          stay_label: "",
          hub: "",
          notes: "",
          stops: [
            { kind: "stop", name: "Nuevo", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "stop", name: "Beta", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "stop", name: "Otro", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "stop", name: "Gamma", detail: "", how_to_get: "", est_duration: "", notes: "" },
          ],
        },
      ],
    },
    { locationsByDay },
  );

  const stops = itinerary.days[0].stops;
  // Beta y Gamma matchean por nombre unívoco pese al count mismatch
  assert.equal(stops[1].location_mode, "coords");
  assert.equal(stops[1].lat, 2);
  assert.equal(stops[3].location_mode, "coords");
  assert.equal(stops[3].lat, 3);
  // Nuevo/Otro no matchean: pending + warning (índice NO aplica coords de Alpha a Nuevo)
  assert.equal(stops[0].location_mode, "pending");
  assert.equal(stops[0].lat, null);
  assert.equal(stops[2].location_mode, "pending");
  assert.equal(stops[2].lat, null);

  assert.ok(relink_report.warnings.some((w) => w.includes("LOCATION_UNMATCHED") && w.includes("Nuevo")));
  assert.ok(relink_report.warnings.some((w) => w.includes("LOCATION_UNMATCHED") && w.includes("Otro")));
  assert.equal(relink_report.pending, 2);
  assert.equal(relink_report.located, 2);

  // Unidad: con counts distintos, índice+nombre no aplica aunque el nombre en idx coincida parcialmente
  const noIdx = resolveDayStop(
    { kind: "stop", name: "Zeta" },
    0,
    [
      { index: 0, name: "ZetaX", location: coords(9, 9), done: false },
      { index: 1, name: "Y" },
    ],
    1, // finalCount !== md.length
    1,
  );
  assert.equal(noIdx.fields.location_mode, "pending");
  assert.ok(noIdx.warning.includes("LOCATION_UNMATCHED"));

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Hubs inherit_stay tras replace (con y sin locationsByDay)", () => {
  const { db, dir } = tmpDb();

  const data = {
    title: "t",
    anchor_date: null,
    days: [
      {
        day_number: 1,
        title: "D1",
        base: "Tokyo",
        stay_label: "Hotel",
        hub: "Ikebukuro",
        notes: "",
        stops: [
          { kind: "hub_out", name: "Salida", detail: "", how_to_get: "", est_duration: "", notes: "" },
          { kind: "stop", name: "Parada", detail: "", how_to_get: "", est_duration: "", notes: "" },
          { kind: "hub_back", name: "Vuelta", detail: "", how_to_get: "", est_duration: "", notes: "" },
        ],
      },
    ],
  };

  const { itinerary: a } = replaceItinerary(db, data);
  assert.equal(a.days[0].stops[0].location_mode, "inherit_stay");
  assert.equal(a.days[0].stops[1].location_mode, "pending");
  assert.equal(a.days[0].stops[2].location_mode, "inherit_stay");

  const locationsByDay = new Map([
    [
      1,
      {
        stay_location: coords(35.7, 139.7),
        stops: [
          { index: 0, name: "Salida", location: { mode: "pending" }, done: false },
          { index: 1, name: "Parada", location: coords(1, 2), done: false },
          { index: 2, name: "Vuelta", location: { mode: "pending" }, done: false },
        ],
      },
    ],
  ]);
  const { itinerary: b, relink_report } = replaceItinerary(db, data, { locationsByDay });
  assert.equal(b.days[0].stops[0].location_mode, "inherit_stay");
  assert.equal(b.days[0].stops[2].location_mode, "inherit_stay");
  assert.equal(b.days[0].stops[1].location_mode, "coords");
  assert.equal(b.days[0].stay_lat, 35.7);
  assert.equal(relink_report.inherited, 2);
  assert.equal(relink_report.located, 1);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("precision view sobrevive al relink en replaceItinerary", () => {
  const { db, dir } = tmpDb();
  const locationsByDay = new Map([
    [
      1,
      {
        stay_location: {
          mode: "coords",
          lat: 34.98,
          lng: 135.75,
          precision: "view",
          raw_input: "~34.98,135.75",
        },
        stops: [
          {
            index: 0,
            name: "Torii",
            location: coords(34.967, 135.772, "view"),
            done: false,
          },
        ],
      },
    ],
  ]);

  replaceItinerary(
    db,
    {
      title: "t",
      anchor_date: null,
      days: [
        {
          day_number: 1,
          title: "Kyoto",
          base: "Kyoto",
          stay_label: "Ryokan",
          hub: "",
          notes: "",
          stops: [{ kind: "stop", name: "Torii", detail: "", how_to_get: "", est_duration: "", notes: "" }],
        },
      ],
    },
    { locationsByDay },
  );

  const loaded = loadItinerary(db);
  assert.equal(loaded.days[0].stay_precision, "view");
  assert.equal(loaded.days[0].stops[0].location_precision, "view");
  assert.equal(loaded.days[0].stops[0].location_mode, "coords");

  // raw_input no sale en API map
  assert.ok(!("raw_input" in loaded.days[0].stops[0]));
  const row = db.prepare("SELECT raw_input, location_precision FROM itinerary_stops").get();
  assert.equal(row.location_precision, "view");
  assert.match(row.raw_input, /^~/);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
