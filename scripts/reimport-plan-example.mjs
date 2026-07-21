/**
 * Re-importa docs/plan.example.md vía API (con cookie de sesión de desarrollo).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../server/config.mjs";
import { createSessionToken, COOKIE_NAME } from "../server/auth/session.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = fs.readFileSync(path.join(root, "docs", "plan.example.md"), "utf8");
const config = loadConfig();
const email = config.allowedEmails[0];
if (!email) {
  console.error("ALLOWED_EMAILS vacío; no se puede firmar sesión");
  process.exit(1);
}
const token = createSessionToken({ email, name: "reimport-script" }, config.sessionSecret);
const url = process.env.IMPORT_URL || "http://127.0.0.1:8787/api/v1/itinerary/import-md";

console.log(`Importando ${md.length} chars → ${url} (user ${email})`);
const t0 = Date.now();
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: `${COOKIE_NAME}=${token}`,
  },
  body: JSON.stringify({
    markdown: md,
    filename: "plan.example.md",
    stream: false,
  }),
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  console.error("Respuesta no JSON", res.status, text.slice(0, 800));
  process.exit(1);
}

if (!res.ok) {
  console.error("Import falló", res.status, JSON.stringify(body, null, 2));
  process.exit(1);
}

const days = body.itinerary?.days || [];
const stops = days.reduce((n, d) => n + (d.stops?.length || 0), 0);
const out = {
  ok: true,
  ms: Date.now() - t0,
  days: days.length,
  dayNumbers: days.map((d) => d.day_number),
  stops,
  title: body.itinerary?.meta?.title,
  anchor_date: body.itinerary?.meta?.anchor_date ?? null,
  warnings: body.warnings,
  meta: body.meta,
};
fs.writeFileSync(
  path.join(root, "docs", "plan.app-reimport.json"),
  JSON.stringify(
    {
      title: out.title,
      anchor_date: out.anchor_date,
      days: days.map((d) => ({
        day_number: d.day_number,
        title: d.title,
        stay_label: d.stay_label,
        hub: d.hub,
        notes: d.notes,
        stops: d.stops,
      })),
      _import: out,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(out, null, 2));
