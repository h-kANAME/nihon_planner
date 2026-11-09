/**
 * GET /expenses/dashboard → itinerary.locations (§6.2 / §8.3).
 * El agregado del servidor debe coincidir con sumar locationProgress por día.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate } from "../db.mjs";
import { replaceItinerary, loadItinerary } from "../itinerary/store.mjs";
import { expensesRoutes, aggregateLocationProgress } from "../routes/expenses.mjs";
import { locationProgress } from "../../src/lib/locations.js";

async function setupApp(t, itineraryData) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-dash-loc-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);
  replaceItinerary(db, itineraryData);

  const app = Fastify({ logger: false });
  await expensesRoutes(app, { db });
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { app, db };
}

const FIXTURE = {
  title: "Locations progress",
  anchor_date: "2026-04-01",
  days: [
    {
      day_number: 1,
      title: "Tokyo",
      base: "Tokyo",
      stay_label: "Hotel A",
      hub: "",
      notes: "",
      stay_lat: 35.73,
      stay_lng: 139.71,
      stay_precision: "place",
      stops: [
        { kind: "hub_out", name: "Salida", location_mode: "inherit_stay" },
        {
          kind: "stop",
          name: "Senso-ji",
          location_mode: "coords",
          lat: 35.714765,
          lng: 139.796655,
          location_precision: "place",
        },
        { kind: "stop", name: "Almuerzo", location_mode: "not_applicable" },
        { kind: "stop", name: "Pendiente", location_mode: "pending" },
        { kind: "hub_back", name: "Retorno", location_mode: "inherit_stay" },
      ],
    },
    {
      day_number: 2,
      title: "Kyoto",
      base: "Kyoto",
      stay_label: "Ryokan",
      hub: "",
      notes: "",
      // sin stay → inherit_stay no resuelve
      stops: [
        { kind: "hub_out", name: "Salida", location_mode: "inherit_stay" },
        { kind: "stop", name: "Fushimi", location_mode: "pending" },
        { kind: "hub_back", name: "Retorno", location_mode: "inherit_stay" },
      ],
    },
  ],
};

test("aggregateLocationProgress: na resuelta; inherit_stay sin stay no cuenta", () => {
  const days = FIXTURE.days;
  const fromHelper = aggregateLocationProgress(days);
  const fromClient = days.reduce(
    (acc, d) => {
      const p = locationProgress(d);
      acc.total += p.total;
      acc.resolved += p.resolved;
      return acc;
    },
    { total: 0, resolved: 0 },
  );
  fromClient.pending = fromClient.total - fromClient.resolved;

  // D1: hub_out+coords+na+pending+hub_back → resolved 4/5 (pending)
  // D2: 2 inherit sin stay + 1 pending → resolved 0/3
  assert.deepEqual(fromHelper, { total: 8, resolved: 4, pending: 4 });
  assert.deepEqual(fromHelper, fromClient);
});

test("GET /expenses/dashboard itinerary.locations == sum(locationProgress)", async (t) => {
  const { app, db } = await setupApp(t, FIXTURE);

  const res = await app.inject({ method: "GET", url: "/api/v1/expenses/dashboard" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.itinerary?.locations);

  const { days } = loadItinerary(db);
  const expected = days.reduce(
    (acc, d) => {
      const p = locationProgress(d);
      acc.total += p.total;
      acc.resolved += p.resolved;
      return acc;
    },
    { total: 0, resolved: 0 },
  );
  expected.pending = expected.total - expected.resolved;

  assert.deepEqual(body.itinerary.locations, expected);
  assert.deepEqual(body.itinerary.locations, { total: 8, resolved: 4, pending: 4 });
});

test("GET /expenses/dashboard sin itinerario → locations en cero", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-dash-empty-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);
  const app = Fastify({ logger: false });
  await expensesRoutes(app, { db });
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await app.inject({ method: "GET", url: "/api/v1/expenses/dashboard" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().itinerary.locations, { total: 0, resolved: 0, pending: 0 });
});
