import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { openDb, migrate, uid } from "../db.mjs";
import {
  replaceItinerary,
  loadItinerary,
  mapStop,
  mapDay,
  locationModeForKind,
} from "../itinerary/store.mjs";
import { itineraryRoutes } from "../routes/itinerary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../migrations");

function applyMigrationsUpTo(db, lastFile) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (file > lastFile) break;
    db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
  }
}

test("migración 005: hubs → inherit_stay, resto pending", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-loc-"));
  const db = openDb(path.join(dir, "t.db"));

  applyMigrationsUpTo(db, "004_session_ai_provider.sql");

  const dayId = uid();
  db.prepare(
    `INSERT INTO itinerary_days (id, day_number, title, base, stay_label, hub, notes, sort)
     VALUES (?, 1, 'Arribo', 'Tokyo', 'Ikebukuro', 'Ikebukuro', '', 1)`,
  ).run(dayId);
  db.prepare(
    `INSERT INTO itinerary_stops
       (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done)
     VALUES (?, ?, 0, 'Salida', '', '', '', '', 'hub_out', 0)`,
  ).run(uid(), dayId);
  db.prepare(
    `INSERT INTO itinerary_stops
       (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done)
     VALUES (?, ?, 1, 'Harajuku', '', '', '', '', 'stop', 0)`,
  ).run(uid(), dayId);
  db.prepare(
    `INSERT INTO itinerary_stops
       (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done)
     VALUES (?, ?, 2, 'Vuelta', '', '', '', '', 'hub_back', 0)`,
  ).run(uid(), dayId);

  migrate(db);

  const modes = Object.fromEntries(
    db.prepare("SELECT kind, location_mode FROM itinerary_stops ORDER BY sort_order").all()
      .map((r) => [r.kind, r.location_mode]),
  );
  assert.equal(modes.hub_out, "inherit_stay");
  assert.equal(modes.hub_back, "inherit_stay");
  assert.equal(modes.stop, "pending");

  const stopCols = db.prepare("PRAGMA table_info(itinerary_stops)").all().map((c) => c.name);
  for (const col of ["lat", "lng", "location_mode", "location_precision", "raw_input", "version"]) {
    assert.ok(stopCols.includes(col), `falta columna stops.${col}`);
  }
  const dayCols = db.prepare("PRAGMA table_info(itinerary_days)").all().map((c) => c.name);
  for (const col of ["stay_lat", "stay_lng", "stay_precision", "stay_raw_input", "version"]) {
    assert.ok(dayCols.includes(col), `falta columna days.${col}`);
  }

  const version = db.prepare("SELECT version FROM itinerary_stops LIMIT 1").get().version;
  assert.equal(version, 1);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("replaceItinerary y GET: hubs inherit_stay; sin raw_input", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-loc-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);

  replaceItinerary(db, {
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
          { kind: "stop", name: "Templo", detail: "", how_to_get: "", est_duration: "", notes: "" },
          { kind: "hub_back", name: "Vuelta", detail: "", how_to_get: "", est_duration: "", notes: "" },
        ],
      },
    ],
  });

  const loaded = loadItinerary(db);
  const [hubOut, stop, hubBack] = loaded.days[0].stops;
  assert.equal(hubOut.location_mode, "inherit_stay");
  assert.equal(stop.location_mode, "pending");
  assert.equal(hubBack.location_mode, "inherit_stay");
  assert.equal(hubOut.version, 1);
  assert.equal(loaded.days[0].version, 1);
  assert.equal(loaded.days[0].stay_lat, null);
  assert.ok(!("raw_input" in hubOut));
  assert.ok(!("stay_raw_input" in loaded.days[0]));

  const mapped = mapStop({
    id: "s",
    day_id: "d",
    sort_order: 0,
    name: "x",
    detail: "",
    how_to_get: "",
    est_duration: "",
    notes: "",
    kind: "stop",
    done: 0,
    lat: null,
    lng: null,
    location_mode: "pending",
    location_precision: null,
    raw_input: "secret",
    version: 1,
    created_at: "",
    updated_at: "",
  });
  assert.ok(!("raw_input" in mapped));
  assert.deepEqual(
    Object.keys(mapDay({
      id: "d",
      day_number: 1,
      title: "",
      base: "",
      stay_label: "",
      hub: "",
      notes: "",
      sort: 0,
      stay_lat: null,
      stay_lng: null,
      stay_precision: null,
      stay_raw_input: "secret",
      version: 1,
      created_at: "",
      updated_at: "",
    })).includes("stay_raw_input"),
    false,
  );

  assert.equal(locationModeForKind("hub_out"), "inherit_stay");
  assert.equal(locationModeForKind("stop"), "pending");

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("POST /stops: hub_out → inherit_stay", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-loc-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);

  const dayId = uid();
  db.prepare(
    `INSERT INTO itinerary_days (id, day_number, title, base, stay_label, hub, notes, sort)
     VALUES (?, 1, 'D1', 'Tokyo', 'Hotel', '', '', 1)`,
  ).run(dayId);

  const app = Fastify({ logger: false });
  await itineraryRoutes(app, { db, ai: {}, config: { aiProvider: "test", aiModel: "test" } });
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const hubRes = await app.inject({
    method: "POST",
    url: `/api/v1/itinerary/days/${dayId}/stops`,
    payload: { name: "Salida", kind: "hub_out" },
  });
  assert.equal(hubRes.statusCode, 201);
  assert.equal(hubRes.json().location_mode, "inherit_stay");
  assert.ok(!("raw_input" in hubRes.json()));

  const stopRes = await app.inject({
    method: "POST",
    url: `/api/v1/itinerary/days/${dayId}/stops`,
    payload: { name: "Parada", kind: "stop" },
  });
  assert.equal(stopRes.statusCode, 201);
  assert.equal(stopRes.json().location_mode, "pending");
  assert.equal(stopRes.json().version, 1);
});
