/**
 * Snapshot fail-closed §9.3: VACUUM INTO (o db.backup) antes de imports destructivos.
 * Fuera de transacción; retención de las últimas KEEP copias en dirname(dbPath)/backups.
 */
import fs from "node:fs";
import path from "node:path";

export const SNAPSHOT_KEEP = 5;

export function backupsDir(dbPath) {
  return path.join(path.dirname(dbPath), "backups");
}

/** Nombre con timestamp ISO apto para filesystem (sin `:`). */
export function snapshotFilename(now = new Date()) {
  const ts = now.toISOString().replace(/[:.]/g, "-");
  return `import-${ts}.db`;
}

function listSnapshotFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { name, path: full, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

/** Conserva las `keep` más recientes; borra el resto. */
export function pruneSnapshots(dir, keep = SNAPSHOT_KEEP) {
  const files = listSnapshotFiles(dir);
  for (const old of files.slice(keep)) {
    try {
      fs.unlinkSync(old.path);
    } catch {
      /* ignore */
    }
  }
  return listSnapshotFiles(dir);
}

function snapshotFailed(cause) {
  const err = new Error(
    cause?.message || "No se pudo crear snapshot antes del import",
  );
  err.code = "SNAPSHOT_FAILED";
  err.status = 500;
  if (cause) err.cause = cause;
  return err;
}

/**
 * Crea snapshot en backups/ y poda a las últimas 5.
 * Fail-closed: cualquier error → SNAPSHOT_FAILED (el caller no debe tocar datos).
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} dbPath ruta de la DB (config.dbPath)
 * @returns {Promise<string>} ruta del snapshot creado
 */
export async function createImportSnapshot(db, dbPath) {
  if (!dbPath || typeof dbPath !== "string") {
    throw snapshotFailed(new Error("dbPath requerido para snapshot"));
  }

  let dir;
  let dest;
  try {
    dir = backupsDir(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    dest = path.join(dir, snapshotFilename());
  } catch (e) {
    throw snapshotFailed(e);
  }

  try {
    try {
      db.prepare("VACUUM INTO ?").run(dest);
    } catch (vacuumErr) {
      // SQLite/imagen puede rechazar el parámetro de VACUUM INTO → backup async
      if (typeof db.backup !== "function") throw vacuumErr;
      await db.backup(dest);
    }
  } catch (e) {
    try {
      if (dest && fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    throw snapshotFailed(e);
  }

  pruneSnapshots(dir, SNAPSHOT_KEEP);
  return dest;
}
