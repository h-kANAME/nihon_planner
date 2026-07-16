import fs from "node:fs";
import { sendError } from "../helpers.mjs";

export async function adminRoutes(app, { config, db }) {
  app.get("/api/v1/admin/backup", async (_request, reply) => {
    const dbPath = config.dbPath;
    if (!fs.existsSync(dbPath)) {
      return sendError(reply, 404, "NOT_FOUND", "Base de datos no encontrada");
    }
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
    const buf = fs.readFileSync(dbPath);
    reply.header("Content-Type", "application/octet-stream");
    reply.header(
      "Content-Disposition",
      `attachment; filename="nihon-backup-${new Date().toISOString().slice(0, 10)}.db"`,
    );
    return reply.send(buf);
  });
}
