import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { openDb, migrate, uid } from "../db.mjs";
import { sessionsRoutes } from "../routes/sessions.mjs";

test("renombrar, limpiar y eliminar una sesión", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-sessions-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);

  const app = Fastify({ logger: false });
  await sessionsRoutes(app, { db, ai: {}, config: {} });

  t.after(async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const id = uid();
  db.prepare(
    "INSERT INTO ai_sessions (id, name, mode, summary) VALUES (?, ?, 'planificar', ?)",
  ).run(id, "Sesión 1", "resumen compactado");
  db.prepare(
    "INSERT INTO ai_messages (session_id, role, content, meta) VALUES (?, 'user', 'hola', '{}')",
  ).run(id);

  const renamed = await app.inject({
    method: "PATCH",
    url: `/api/v1/sessions/${id}`,
    payload: { name: "Ruta Tokio y Kyoto" },
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().name, "Ruta Tokio y Kyoto");
  assert.equal(renamed.json().message_count, 1);
  assert.equal(renamed.json().ai_provider, "deepseek");

  const setGoogle = await app.inject({
    method: "PATCH",
    url: `/api/v1/sessions/${id}`,
    payload: { ai_provider: "google" },
  });
  assert.equal(setGoogle.statusCode, 200);
  assert.equal(setGoogle.json().ai_provider, "google");

  const invalid = await app.inject({
    method: "PATCH",
    url: `/api/v1/sessions/${id}`,
    payload: { name: "   " },
  });
  assert.equal(invalid.statusCode, 400);

  const reset = await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${id}/reset`,
    payload: {},
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE session_id = ?").get(id).n, 0);
  assert.equal(db.prepare("SELECT summary FROM ai_sessions WHERE id = ?").get(id).summary, null);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/v1/sessions/${id}`,
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_sessions WHERE id = ?").get(id).n, 0);
});
