/**
 * Import one-shot de un export artifact/JSON a la DB del contenedor.
 * Uso: node scripts/import-session.mjs path/to/export.json
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, migrate, uid } from "../server/db.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/import-session.mjs <archivo.json>");
  process.exit(1);
}

const dbPath = process.env.DB_PATH || "./data/nihon.db";
const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const db = openDb(dbPath);
migrate(db);

function upsertSession(sesion, modeHint) {
  const id = sesion.id || uid();
  const name = sesion.nombre || sesion.name || `Importada · ${id.slice(0, 6)}`;
  const mode = modeHint === "consultar" ? "consultar" : "planificar";
  db.prepare(
    `INSERT INTO ai_sessions (id, name, mode)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, mode=excluded.mode, updated_at=datetime('now')`,
  ).run(id, name, mode);

  const mensajes = sesion.mensajes || sesion.messages || [];
  const existing = db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE session_id = ?").get(id).n;
  if (existing === 0 && mensajes.length) {
    const ins = db.prepare(
      `INSERT INTO ai_messages (session_id, role, content, meta) VALUES (?, ?, ?, '{}')`,
    );
    const tx = db.transaction(() => {
      for (const m of mensajes) {
        if (!m?.role || !m?.content) continue;
        if (m.role !== "user" && m.role !== "assistant") continue;
        ins.run(id, m.role, m.content);
      }
    });
    tx();
  }
  return { id, name, mode, messages: mensajes.length, skippedMessages: existing > 0 };
}

let result;
if (payload.sesion) {
  result = upsertSession(payload.sesion, payload.tipo === "consulta" ? "consultar" : "planificar");
} else if (Array.isArray(payload.sesiones)) {
  result = payload.sesiones.map((s) => upsertSession(s, "planificar"));
} else {
  console.error("No hay sesion/sesiones en el JSON");
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, result }, null, 2));
db.close();
