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

test("migrate + seed docs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  migrate(db);
  seedDefaultDocs(db, uid);
  const n = db.prepare("SELECT COUNT(*) AS n FROM plan_items WHERE type='doc'").get().n;
  assert.equal(n, 9);
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
