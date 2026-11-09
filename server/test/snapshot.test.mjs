import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate } from "../db.mjs";
import { replaceItinerary, loadItinerary } from "../itinerary/store.mjs";
import {
  backupsDir,
  createImportSnapshot,
  pruneSnapshots,
  SNAPSHOT_KEEP,
} from "../itinerary/snapshot.mjs";
import { itineraryRoutes } from "../routes/itinerary.mjs";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-snap-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  migrate(db);
  return { db, dir, dbPath };
}

const aiStub = {
  async chatComplete() {
    throw new Error("AI stub offline");
  },
};

const MD_SIMPLE = `# Viaje

### Día 1 — Tokyo

**Alojamiento:** Hotel

| # | Parada | Detalle | Kind | Hecho | Ubicación |
| --- | --- | --- | --- | --- | --- |
| 1 | Senso-ji | templo | stop |  | 35.714765,139.796655 |
`;

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

test("Snapshot: createImportSnapshot crea dir backups y archivo .db", async () => {
  const { db, dir, dbPath } = tmpDb();
  try {
    const bdir = backupsDir(dbPath);
    assert.equal(fs.existsSync(bdir), false);
    const dest = await createImportSnapshot(db, dbPath);
    assert.ok(fs.existsSync(bdir));
    assert.ok(fs.existsSync(dest));
    assert.ok(dest.endsWith(".db"));
    assert.equal(path.dirname(dest), bdir);
    assert.ok(fs.statSync(dest).size > 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Snapshot: con 6 copias se conservan 5", async () => {
  const { db, dir, dbPath } = tmpDb();
  try {
    const bdir = backupsDir(dbPath);
    fs.mkdirSync(bdir, { recursive: true });
    // Sembrar 5 snapshots previos con mtimes distintos
    for (let i = 0; i < 5; i++) {
      const p = path.join(bdir, `import-seed-${i}.db`);
      fs.writeFileSync(p, `seed-${i}`);
      const t = new Date(Date.now() - (5 - i) * 60_000);
      fs.utimesSync(p, t, t);
    }
    await createImportSnapshot(db, dbPath);
    const left = fs.readdirSync(bdir).filter((n) => n.endsWith(".db"));
    assert.equal(left.length, SNAPSHOT_KEEP);
    // El más reciente debe ser el real (VACUUM), no un seed vacío pequeño
    const files = left
      .map((name) => {
        const full = path.join(bdir, name);
        return { name, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    assert.ok(files[0].size > 100, `snapshot real demasiado chico: ${files[0].size}`);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Snapshot: pruneSnapshots deja exactamente keep", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-prune-"));
  try {
    for (let i = 0; i < 6; i++) {
      const p = path.join(dir, `import-${i}.db`);
      fs.writeFileSync(p, String(i));
      const t = new Date(Date.now() - (6 - i) * 1000);
      fs.utimesSync(p, t, t);
    }
    const kept = pruneSnapshots(dir, 5);
    assert.equal(kept.length, 5);
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith(".db")).length, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Snapshot: primer import-md crea backups/ + snapshot", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const bdir = backupsDir(dbPath);
  assert.equal(fs.existsSync(bdir), false);

  const app = await setupApp(t, db, dbPath);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-md",
    payload: { markdown: MD_SIMPLE },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(fs.existsSync(bdir));
  const snaps = fs.readdirSync(bdir).filter((n) => n.endsWith(".db"));
  assert.equal(snaps.length, 1);
  assert.ok(fs.statSync(path.join(bdir, snaps[0])).size > 0);
});

test("Snapshot: falla → import no corre + error JSON no NDJSON (stream)", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  replaceItinerary(db, {
    title: "Antes",
    anchor_date: null,
    days: [
      {
        day_number: 1,
        title: "Tokyo",
        base: "Tokyo",
        stay_label: "Hotel",
        hub: "",
        notes: "keep-me",
        stops: [{ kind: "stop", name: "Original", detail: "", how_to_get: "", est_duration: "", notes: "" }],
      },
    ],
  });
  const before = loadItinerary(db);
  assert.equal(before.meta.title, "Antes");
  assert.equal(before.days[0].notes, "keep-me");

  // Bloquear mkdir de backups: archivo en lugar de directorio
  fs.writeFileSync(backupsDir(dbPath), "not-a-directory");

  const app = await setupApp(t, db, dbPath);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-md",
    payload: { markdown: MD_SIMPLE, stream: true },
  });

  assert.equal(res.statusCode, 500);
  const body = res.json();
  assert.equal(body.error.code, "SNAPSHOT_FAILED");
  assert.equal(res.headers["content-type"]?.includes("json"), true);
  assert.ok(!String(res.body).includes('"type":"progress"'));
  assert.ok(!String(res.body).includes('"type":"error"'));

  const after = loadItinerary(db);
  assert.equal(after.meta.title, "Antes");
  assert.equal(after.days[0].notes, "keep-me");
  assert.equal(after.days[0].stops[0].name, "Original");
});

test("Snapshot: falla en import-json → no replaceItinerary", async (t) => {
  const { db, dir, dbPath } = tmpDb();
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  replaceItinerary(db, {
    title: "Keep",
    anchor_date: null,
    days: [
      {
        day_number: 3,
        title: "Kyoto",
        base: "Kyoto",
        stay_label: "",
        hub: "",
        notes: "",
        stops: [{ kind: "stop", name: "Fushimi", detail: "", how_to_get: "", est_duration: "", notes: "" }],
      },
    ],
  });

  fs.writeFileSync(backupsDir(dbPath), "blocked");

  const app = await setupApp(t, db, dbPath);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/itinerary/import-json",
    payload: {
      title: "Nuevo",
      days: [
        {
          day_number: 1,
          title: "Osaka",
          base: "Osaka",
          stay_label: "",
          hub: "",
          notes: "",
          stops: [{ kind: "stop", name: "Dotonbori", detail: "", how_to_get: "", est_duration: "", notes: "" }],
        },
      ],
    },
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, "SNAPSHOT_FAILED");
  const after = loadItinerary(db);
  assert.equal(after.meta.title, "Keep");
  assert.equal(after.days[0].day_number, 3);
});
