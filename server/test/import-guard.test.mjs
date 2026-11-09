import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate } from "../db.mjs";
import { replaceItinerary } from "../itinerary/store.mjs";
import {
  countImportableLocationCells,
  countResolvedStops,
  evaluateLocationsAtRisk,
} from "../itinerary/importGuard.mjs";
import { itineraryRoutes } from "../routes/itinerary.mjs";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-guard-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  migrate(db);
  return { db, dir, dbPath };
}

/** AI stub: falla → convert usa base heurística local. */
const aiStub = {
  async chatComplete() {
    throw new Error("AI stub offline");
  },
};

const MD_EMPTY_CELLS = `# Viaje sin coords

### Día 1 — Tokyo

**Alojamiento:** Hotel

| # | Parada | Detalle | Kind | Hecho | Ubicación |
| --- | --- | --- | --- | --- | --- |
| 1 | Senso-ji | templo | stop |  |  |
| 2 | Ueno | parque | stop |  |  |
`;

const MD_WITH_LOCATIONS = `# Viaje con coords

### Día 1 — Tokyo

**Alojamiento:** Hotel
**Ubicación alojamiento:** 35.729500,139.710900

| # | Parada | Detalle | Kind | Hecho | Ubicación |
| --- | --- | --- | --- | --- | --- |
| — | **Salida** | hub | hub_out |  | stay |
| 1 | Senso-ji | templo | stop | x | 35.714765,139.796655 |
| 2 | Almuerzo | — | stop |  | — |
| — | **Retorno** | hub | hub_back |  | stay |
`;

function seedResolvedItinerary(db) {
  replaceItinerary(
    db,
    {
      title: "Existente",
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
            { kind: "stop", name: "Senso-ji", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "stop", name: "Almuerzo", detail: "", how_to_get: "", est_duration: "", notes: "" },
            { kind: "hub_back", name: "Retorno", detail: "", how_to_get: "", est_duration: "", notes: "" },
          ],
        },
      ],
    },
    {
      locationsByDay: new Map([
        [
          1,
          {
            stay_location: {
              mode: "coords",
              lat: 35.73,
              lng: 139.71,
              precision: "place",
              raw_input: "35.73,139.71",
            },
            stops: [
              { index: 0, name: "Salida", location: { mode: "inherit_stay" }, done: false },
              {
                index: 1,
                name: "Senso-ji",
                location: {
                  mode: "coords",
                  lat: 35.714765,
                  lng: 139.796655,
                  precision: "place",
                  raw_input: "35.714765,139.796655",
                },
                done: true,
              },
              { index: 2, name: "Almuerzo", location: { mode: "not_applicable" }, done: false },
              { index: 3, name: "Retorno", location: { mode: "inherit_stay" }, done: false },
            ],
          },
        ],
      ]),
    },
  );
}

test("countImportableLocationCells: vacías / válidas / basura", () => {
  assert.equal(countImportableLocationCells(MD_EMPTY_CELLS), 0);
  assert.equal(countImportableLocationCells(MD_WITH_LOCATIONS), 5); // stay + 4 celdas
  assert.equal(
    countImportableLocationCells(`
**Ubicación alojamiento:** @slug-viejo
| # | Parada | Ubicación |
| --- | --- | --- |
| 1 | X | basura |
| 2 | Y | ~35.1,139.2 |
`),
    1,
  );
});

test("countResolvedStops §4.3", () => {
  const { db, dir } = tmpDb();
  seedResolvedItinerary(db);
  // coords + not_applicable + 2 inherit_stay con stay → 4
  assert.equal(countResolvedStops(db), 4);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("evaluateLocationsAtRisk: bloquea / force / con ubicaciones", () => {
  const { db, dir } = tmpDb();
  seedResolvedItinerary(db);

  const blocked = evaluateLocationsAtRisk(MD_EMPTY_CELLS, db, { force: false });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.resolved, 4);

  const forced = evaluateLocationsAtRisk(MD_EMPTY_CELLS, db, { force: true });
  assert.equal(forced.blocked, false);
  assert.equal(forced.discardWarning, "4 ubicaciones descartadas");

  const ok = evaluateLocationsAtRisk(MD_WITH_LOCATIONS, db, { force: false });
  assert.equal(ok.blocked, false);
  assert.equal(ok.discardWarning, null);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function setupApp(t, db, dbPath) {
  const app = Fastify({ logger: false });
  await itineraryRoutes(app, {
    db,
    ai: aiStub,
    config: { aiProvider: "test", aiModel: "test", dbPath },
  });
  t.after(async () => {
    await app.close();
  });
  return app;
}

test("Guarda: MD celdas vacías + DB con ubicaciones → 409 LOCATIONS_AT_RISK", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  seedResolvedItinerary(db);
  const app = await setupApp(t, db, dbPath);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-md",
    payload: { markdown: MD_EMPTY_CELLS, stream: true },
  });
  assert.equal(res.statusCode, 409);
  const body = res.json();
  assert.equal(body.error.code, "LOCATIONS_AT_RISK");
  assert.equal(body.error.resolved, 4);
  assert.match(body.error.message, /4 ubicaciones/);
  // Antes de hijack: JSON, no NDJSON
  assert.equal(res.headers["content-type"]?.includes("json"), true);
  assert.ok(!String(res.body).includes('"type":"progress"'));
});

test("Guarda: force → importa + warning de descartadas", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  seedResolvedItinerary(db);
  const app = await setupApp(t, db, dbPath);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-md",
    payload: { markdown: MD_EMPTY_CELLS, force: true },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.itinerary?.days?.length >= 1);
  assert.ok(
    (body.warnings || []).some((w) => /4 ubicaciones descartadas/.test(w)),
    `warnings=${JSON.stringify(body.warnings)}`,
  );
});

test("Guarda: MD con ubicaciones → no 409", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  seedResolvedItinerary(db);
  const app = await setupApp(t, db, dbPath);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-md",
    payload: { markdown: MD_WITH_LOCATIONS },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(!(body.warnings || []).some((w) => /ubicaciones descartadas/.test(w)));
  const stop = body.itinerary.days[0].stops.find((s) => s.name.includes("Senso"));
  assert.equal(stop?.location_mode, "coords");
});

test("apiClient-shaped Error: 409 expone status/code/data", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  seedResolvedItinerary(db);
  const app = await setupApp(t, db, dbPath);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-md",
    payload: { markdown: MD_EMPTY_CELLS, stream: true },
  });
  // Misma lógica que importItineraryMdStream ante !res.ok
  const data = res.json();
  const err = new Error(data?.error?.message || `HTTP ${res.statusCode}`);
  err.status = res.statusCode;
  err.code = data?.error?.code;
  err.data = data;
  assert.equal(err.status, 409);
  assert.equal(err.code, "LOCATIONS_AT_RISK");
  assert.equal(err.data.error.resolved, 4);
});
