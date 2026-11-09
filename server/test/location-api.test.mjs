import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate, uid } from "../db.mjs";
import { itineraryRoutes } from "../routes/itinerary.mjs";

async function setupApp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-loc-api-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);

  const dayId = uid();
  const stopId = uid();
  db.prepare(
    `INSERT INTO itinerary_days (id, day_number, title, base, stay_label, hub, notes, sort)
     VALUES (?, 1, 'D1', 'Tokyo', 'Hotel', '', '', 1)`,
  ).run(dayId);
  db.prepare(
    `INSERT INTO itinerary_stops
       (id, day_id, sort_order, name, detail, how_to_get, est_duration, notes, kind, done, location_mode)
     VALUES (?, ?, 0, 'Senso-ji', '', '', '', '', 'stop', 0, 'pending')`,
  ).run(stopId, dayId);

  const app = Fastify({ logger: false });
  await itineraryRoutes(app, { db, ai: {}, config: { aiProvider: "test", aiModel: "test" } });
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return { app, db, dayId, stopId };
}

test("PUT stop location: mode=coords sin raw_input → 400 RAW_INPUT_REQUIRED", async (t) => {
  const { app, stopId } = await setupApp(t);
  const res = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/stops/${stopId}/location`,
    payload: { version: 1, mode: "coords" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "RAW_INPUT_REQUIRED");
});

test("PUT stop location: coords parsea raw_input; ignora lat/lng del cliente", async (t) => {
  const { app, db, stopId } = await setupApp(t);
  const res = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/stops/${stopId}/location`,
    payload: {
      version: 1,
      mode: "coords",
      raw_input: "35.714765, 139.796655",
      lat: 1,
      lng: 2,
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.location_mode, "coords");
  assert.equal(body.lat, 35.714765);
  assert.equal(body.lng, 139.796655);
  assert.equal(body.location_precision, "place");
  assert.equal(body.version, 2);
  assert.ok(!("raw_input" in body));

  const row = db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(stopId);
  assert.equal(row.lat, 35.714765);
  assert.equal(row.lng, 139.796655);
  assert.equal(row.raw_input, "35.714765, 139.796655");
  assert.equal(row.version, 2);
});

test("PUT stop location: not_applicable/pending/inherit_stay limpian coordenadas", async (t) => {
  const { app, db, stopId } = await setupApp(t);

  const set = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/stops/${stopId}/location`,
    payload: { version: 1, mode: "coords", raw_input: "35.714765, 139.796655" },
  });
  assert.equal(set.statusCode, 200);
  assert.equal(set.json().version, 2);

  for (const mode of ["not_applicable", "pending", "inherit_stay"]) {
    const before = db.prepare("SELECT version FROM itinerary_stops WHERE id = ?").get(stopId);
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/itinerary/stops/${stopId}/location`,
      payload: { version: before.version, mode, raw_input: "should-be-ignored" },
    });
    assert.equal(res.statusCode, 200, mode);
    const body = res.json();
    assert.equal(body.location_mode, mode);
    assert.equal(body.lat, null);
    assert.equal(body.lng, null);
    assert.equal(body.location_precision, null);
    assert.equal(body.version, before.version + 1);

    const row = db.prepare("SELECT * FROM itinerary_stops WHERE id = ?").get(stopId);
    assert.equal(row.lat, null);
    assert.equal(row.lng, null);
    assert.equal(row.raw_input, null);

    // Reponer coords para el siguiente modo
    const again = await app.inject({
      method: "PUT",
      url: `/api/v1/itinerary/stops/${stopId}/location`,
      payload: {
        version: row.version,
        mode: "coords",
        raw_input: "35.714765, 139.796655",
      },
    });
    assert.equal(again.statusCode, 200);
  }
});

test("PUT stop location: dos PUT misma version → segundo 409 con current", async (t) => {
  const { app, stopId } = await setupApp(t);
  const first = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/stops/${stopId}/location`,
    payload: { version: 1, mode: "coords", raw_input: "35.714765, 139.796655" },
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/stops/${stopId}/location`,
    payload: { version: 1, mode: "not_applicable" },
  });
  assert.equal(second.statusCode, 409);
  const err = second.json().error;
  assert.equal(err.code, "VERSION_CONFLICT");
  assert.ok(err.current);
  assert.equal(err.current.id, stopId);
  assert.equal(err.current.version, 2);
  assert.equal(err.current.location_mode, "coords");
  assert.equal(err.current.lat, 35.714765);
});

test("PUT stop location: raw_input > 2000 → 400", async (t) => {
  const { app, stopId } = await setupApp(t);
  const res = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/stops/${stopId}/location`,
    payload: { version: 1, mode: "coords", raw_input: "x".repeat(2001) },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "VALIDATION");
});

test("PUT stay-location: set y clear; 409 con current", async (t) => {
  const { app, db, dayId } = await setupApp(t);

  const set = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/days/${dayId}/stay-location`,
    payload: { version: 1, raw_input: "35.7295, 139.7109" },
  });
  assert.equal(set.statusCode, 200);
  const day = set.json();
  assert.equal(day.stay_lat, 35.7295);
  assert.equal(day.stay_lng, 139.7109);
  assert.equal(day.stay_precision, "place");
  assert.equal(day.version, 2);
  assert.ok(!("stay_raw_input" in day));
  assert.ok(!("raw_input" in day));

  const conflict = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/days/${dayId}/stay-location`,
    payload: { version: 1, clear: true },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, "VERSION_CONFLICT");
  assert.equal(conflict.json().error.current.version, 2);
  assert.equal(conflict.json().error.current.stay_lat, 35.7295);

  const clear = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/days/${dayId}/stay-location`,
    payload: { version: 2, clear: true },
  });
  assert.equal(clear.statusCode, 200);
  assert.equal(clear.json().stay_lat, null);
  assert.equal(clear.json().stay_lng, null);
  assert.equal(clear.json().stay_precision, null);
  assert.equal(clear.json().version, 3);

  const row = db.prepare("SELECT * FROM itinerary_days WHERE id = ?").get(dayId);
  assert.equal(row.stay_raw_input, null);
  assert.equal(row.version, 3);
});

test("PUT stay-location: raw_input > 2000 → 400", async (t) => {
  const { app, dayId } = await setupApp(t);
  const res = await app.inject({
    method: "PUT",
    url: `/api/v1/itinerary/days/${dayId}/stay-location`,
    payload: { version: 1, raw_input: "y".repeat(2001) },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "VALIDATION");
});
