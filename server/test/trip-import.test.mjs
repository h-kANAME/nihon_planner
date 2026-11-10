/**
 * Archivo de viaje (§9.4): export/dump v2 e import destructivo (restore).
 * Cubre: marcador, reemplazo de gastos, snapshot fail-closed, compatibilidad v1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate } from "../db.mjs";
import { getRates } from "../helpers.mjs";
import { replaceItinerary, loadItinerary } from "../itinerary/store.mjs";
import { backupsDir } from "../itinerary/snapshot.mjs";
import { importRoutes } from "../routes/import.mjs";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-trip-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  migrate(db);
  return { db, dir, dbPath };
}

function seedExpense(db, e) {
  db.prepare(
    `INSERT INTO expenses (id, description, amount, currency, category, spent_at, done, kind, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.id,
    e.description,
    e.amount ?? null,
    e.currency ?? null,
    e.category || "otros",
    e.spent_at || "2026-04-01T10:00:00.000Z",
    e.done ? 1 : 0,
    e.kind || "expense",
    JSON.stringify(e.meta || {}),
  );
}

function expenseIds(db) {
  return db.prepare("SELECT id FROM expenses ORDER BY id").all().map((r) => r.id);
}

async function withApp(dbPath, db) {
  const app = Fastify({ logger: false });
  await importRoutes(app, { db, config: { dbPath } });
  return app;
}

function seedItinerary(db) {
  replaceItinerary(db, {
    title: "Viaje",
    anchor_date: "2026-04-05",
    days: [
      {
        day_number: 1,
        title: "Tokyo",
        base: "Tokyo",
        stay_label: "Ikebukuro",
        hub: "Ikebukuro",
        notes: "",
        stay_lat: 35.7295,
        stay_lng: 139.7109,
        stay_precision: "place",
        stops: [
          {
            kind: "stop",
            name: "Sensō-ji",
            detail: "",
            how_to_get: "",
            est_duration: "",
            notes: "",
            done: true,
            lat: 35.714765,
            lng: 139.796655,
            location_mode: "coords",
            location_precision: "place",
          },
        ],
      },
    ],
  });
}

test("export/dump v2: marcador y claves del viaje", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await app.inject({ method: "GET", url: "/api/v1/export/dump" });
  assert.equal(res.statusCode, 200);
  const dump = res.json();
  assert.equal(dump.herramienta, "nihon-planner");
  assert.equal(dump.version, 2);
  assert.ok(dump.exportado);
  for (const key of ["jp:expenses", "jp:logistics", "jp:rates", "jp:sessions", "jp:itinerary"]) {
    assert.ok(key in dump, `falta ${key}`);
  }
});

test("restore: import reemplaza gastos y restaura el itinerario en una transacción", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedExpense(db, { id: "e1", description: "Ramen", amount: 1200, currency: "JPY" });
  seedExpense(db, { id: "e2", description: "Metro", amount: 200, currency: "JPY" });
  seedItinerary(db);

  const dump = (await app.inject({ method: "GET", url: "/api/v1/export/dump" })).json();

  // Estado posterior: gasto nuevo que no está en el archivo + itinerario distinto
  seedExpense(db, { id: "e3", description: "Posterior al backup", amount: 900, currency: "JPY" });
  replaceItinerary(db, {
    title: "Otro",
    anchor_date: null,
    days: [{ day_number: 99, title: "X", base: "", stay_label: "", hub: "", notes: "", stops: [] }],
  });

  const res = await app.inject({ method: "POST", url: "/api/v1/import", payload: dump });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.imported.expenses, 2);
  assert.equal(body.imported.itinerary, true);
  assert.equal(body.imported.days, 1);
  assert.equal(body.imported.plan_items, 0, "jp:logistics no debe reprocesarse");

  assert.deepEqual(expenseIds(db), ["e1", "e2"]);
  const it = loadItinerary(db);
  assert.equal(it.meta.title, "Viaje");
  assert.equal(it.days.length, 1);
  assert.equal(it.days[0].day_number, 1);
  assert.equal(it.days[0].stops[0].done, true);
  assert.equal(it.days[0].stops[0].lat, 35.714765);

  const snaps = fs.readdirSync(backupsDir(dbPath)).filter((f) => f.endsWith(".db"));
  assert.equal(snaps.length, 1, "un snapshot por import destructivo");
});

test("restore: jp:expenses vacío borra la colección (el archivo manda)", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedExpense(db, { id: "e1", description: "Ramen" });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:expenses": [] },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(expenseIds(db), []);
});

test("v1: archivo sin jp:expenses aplica jp:logistics sin borrar gastos", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Obtener la forma canónica de logística desde un dump real
  seedExpense(db, { id: "f1", description: "NRT → HND", amount: 100, currency: "USD", kind: "flight" });
  const logistics = (await app.inject({ method: "GET", url: "/api/v1/export/dump" })).json()["jp:logistics"];
  assert.equal(logistics.flights.length, 1);

  // DB destino con un gasto propio; el archivo v1 solo trae logística
  seedExpense(db, { id: "e1", description: "Ramen" });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:logistics": logistics },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.imported.plan_items, 1);
  assert.equal(body.imported.expenses, 0);

  const ids = expenseIds(db);
  assert.ok(ids.includes("e1"), "el gasto existente sobrevive");
  assert.ok(ids.includes("f1"), "el vuelo se inserta");
});

test("validación: un gasto malformado aborta antes de borrar", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedExpense(db, { id: "e1", description: "Ramen" });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:expenses": [{ id: "x", desc: "" }] },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(expenseIds(db), ["e1"]);
  assert.equal(fs.existsSync(backupsDir(dbPath)), false, "no debe snapshotear si falla la validación");
});

test("snapshot falla → 500 y no toca datos", async (t) => {
  const { db, dir } = tmpDb();
  const app = Fastify({ logger: false });
  await importRoutes(app, { db, config: {} });
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedExpense(db, { id: "e1", description: "Ramen" });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:expenses": [] },
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, "SNAPSHOT_FAILED");
  assert.deepEqual(expenseIds(db), ["e1"]);
});

test("restore: dump de un viaje sin días se importa (instalación nueva)", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedExpense(db, { id: "e1", description: "Ramen", amount: 1200, currency: "JPY" });
  const dump = (await app.inject({ method: "GET", url: "/api/v1/export/dump" })).json();
  assert.deepEqual(dump["jp:itinerary"].days, []);

  seedExpense(db, { id: "e2", description: "Metro", amount: 200, currency: "JPY" });
  const res = await app.inject({ method: "POST", url: "/api/v1/import", payload: dump });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.imported.expenses, 1);
  assert.equal(body.imported.itinerary, true);
  assert.equal(body.imported.days, 0);
  assert.deepEqual(expenseIds(db), ["e1"]);
  assert.equal(loadItinerary(db).days.length, 0);
});

test("restore: dump sin días vacía un itinerario existente", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedItinerary(db);
  assert.equal(loadItinerary(db).days.length, 1);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:itinerary": { title: "", anchor_date: null, days: [] } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().imported.itinerary, true);
  assert.equal(loadItinerary(db).days.length, 0);
});

test("validación: jp:rates inválido aborta sin tocar datos", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedExpense(db, { id: "e1", description: "Ramen" });
  const before = getRates(db);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:expenses": [], "jp:rates": { usdArs: 0, usdJpy: 150 } },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(expenseIds(db), ["e1"]);
  assert.equal(getRates(db).usdArs, before.usdArs);
});

test("restore: conserva ai_provider de las sesiones", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  db.prepare(
    "INSERT INTO ai_sessions (id, name, mode, ai_provider) VALUES ('s1', 'Charla', 'planificar', 'google')",
  ).run();
  db.prepare(
    "INSERT INTO ai_messages (session_id, role, content, meta) VALUES ('s1', 'user', 'hola', '{}')",
  ).run();

  const dump = (await app.inject({ method: "GET", url: "/api/v1/export/dump" })).json();
  assert.equal(dump["jp:sessions"][0].ai_provider, "google");

  db.prepare("DELETE FROM ai_messages").run();
  db.prepare("DELETE FROM ai_sessions").run();

  const res = await app.inject({ method: "POST", url: "/api/v1/import", payload: dump });
  assert.equal(res.statusCode, 200);
  const row = db.prepare("SELECT ai_provider FROM ai_sessions WHERE id = 's1'").get();
  assert.equal(row.ai_provider, "google");
});

test("restore: acepta un dump mayor al bodyLimit por defecto de Fastify (1 MiB)", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const big = "x".repeat(1_300_000);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: {
      herramienta: "nihon-planner",
      sesion: { id: "big", nombre: "Charla larga", mensajes: [{ role: "user", content: big }] },
    },
  });
  assert.equal(res.statusCode, 200);
  const row = db
    .prepare("SELECT content FROM ai_messages WHERE session_id = 'big'")
    .get();
  assert.equal(row.content.length, big.length);
});

test("validación: entrada no-objeto en jp:expenses devuelve 400, no 500", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  seedExpense(db, { id: "e1", description: "Ramen" });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { "jp:expenses": [null] },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "IMPORT_FAILED");
  assert.deepEqual(expenseIds(db), ["e1"]);
});

test("import no destructivo (sesiones) no crea snapshot", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  const app = await withApp(dbPath, db);
  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import",
    payload: { herramienta: "nihon-planner", sesion: { id: "s1", nombre: "Charla", mensajes: [] } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().imported.sessions, 1);
  assert.equal(fs.existsSync(backupsDir(dbPath)), false);
});
