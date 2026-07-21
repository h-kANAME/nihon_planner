/**
 * Smoke tests básicos (sin Google / sin AI real).
 * Correr: docker compose run --rm app-dev npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, migrate, uid } from "../db.mjs";
import { seedDefaultDocs, setRates, getRates, makeConverter } from "../helpers.mjs";

test("migrate + seed docs en expenses", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  migrate(db);
  seedDefaultDocs(db, uid);
  const n = db.prepare("SELECT COUNT(*) AS n FROM expenses WHERE kind='doc'").get().n;
  assert.equal(n, 9);
  const cols = db.prepare("PRAGMA table_info(expenses)").all().map((c) => c.name);
  assert.ok(cols.includes("done"));
  assert.ok(cols.includes("kind"));
  assert.ok(cols.includes("meta_json"));
  db.close();
});

test("expenses híbridos: monto null + dashboard", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);
  seedDefaultDocs(db, uid);
  db.prepare(
    `INSERT INTO expenses (id, description, amount, currency, category, spent_at, done, kind, meta_json)
     VALUES ('f1', 'EZE-NRT', 1000, 'USD', 'vuelos', datetime('now'), 0, 'flight', '{"code":"LA"}')`,
  ).run();
  const { computeExpenseMoneyTotals } = await import("../helpers.mjs");
  const money = computeExpenseMoneyTotals(db);
  assert.equal(money.logistics.total, 10); // 9 docs + 1 flight
  assert.equal(money.logistics.done, 0);
  assert.ok(money.totals.USD >= 1000);
  db.close();
});

test("rates + converter", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);
  setRates(db, { usdArs: 1000, usdJpy: 100, source: "manual", updatedAt: new Date().toISOString() });
  const r = getRates(db);
  const c = makeConverter(r)(1000, "JPY");
  assert.equal(c.USD, 10);
  assert.equal(c.ARS, 10000);
  db.close();
});
