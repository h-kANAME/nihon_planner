import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractUsdAmount,
  parseGoogleDocLogistics,
  slugify,
  splitTramiteItems,
  extractTramitesBlock,
} from "../googleDoc/parseLogistics.mjs";
import { fetchGoogleDocText } from "../googleDoc/fetchDoc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, "fixtures/google-doc-viaje.txt"), "utf8");

test("slugify normaliza títulos", () => {
  assert.equal(slugify("SEGURO MÉDICO"), "seguro-medico");
  assert.equal(slugify("Licencia de Conducir"), "licencia-de-conducir");
});

test("extractUsdAmount lee $2.200 y $30; ignora cobertura 100.000", () => {
  assert.deepEqual(extractUsdAmount("costo aproximado de $2.200 USD c/u"), {
    amount: 2200,
    currency: "USD",
  });
  assert.deepEqual(extractUsdAmount("costo aproximado $30 USD c/u"), {
    amount: 30,
    currency: "USD",
  });
  assert.equal(extractUsdAmount("piso de USD 100.000 a USD 150.000 en gastos médicos"), null);
});

test("splitTramiteItems detecta PASAPORTE / PASAJES / ESIM", () => {
  const block = extractTramitesBlock(fixture);
  const items = splitTramiteItems(block);
  const keys = items.map((i) => i.key.toUpperCase());
  assert.ok(keys.some((k) => k.includes("PASAPORTE")));
  assert.ok(keys.some((k) => k.includes("PASAJES")));
  assert.ok(keys.some((k) => k.includes("ESIM")));
  assert.ok(keys.some((k) => k.includes("SEGURO")));
});

test("parseGoogleDocLogistics: docs + flight + stays + bookings", () => {
  const parsed = parseGoogleDocLogistics(fixture);
  assert.ok(parsed.docs.length >= 4, `docs=${parsed.docs.length}`);
  assert.ok(parsed.flights.length >= 1, `flights=${parsed.flights.length}`);
  assert.ok(parsed.stays.length >= 3, `stays=${parsed.stays.length}`);
  assert.ok(parsed.bookings.length >= 2, `bookings=${parsed.bookings.length}`);

  assert.ok(parsed.docs.every((d) => d.id.startsWith("gdoc-doc-")));
  assert.ok(parsed.flights.every((f) => f.id.startsWith("gdoc-flight-")));
  assert.ok(parsed.stays.some((s) => /Ikebukuro|Kyoto|Namba|Hakone|Nagoya|Clio/i.test(s.name)));
  assert.ok(parsed.bookings.some((b) => /Fun2Drive|USJ|Kirby|Warner|Supercars|teamLab/i.test(b.name)));

  const flight = parsed.flights[0];
  assert.equal(flight.currency, "USD");
  assert.equal(flight.amount, 2200);
});

test("fetchGoogleDocText valida id y propaga 401", async () => {
  await assert.rejects(() => fetchGoogleDocText("bad"), /GOOGLE_DOC_ID/);
  await assert.rejects(
    () =>
      fetchGoogleDocText("1NaDgQ66jdQntV6Ubju5B_1qw7RgrZy3Dfrjp8IHryq8", {
        fetchImpl: async () => ({ ok: false, status: 401, text: async () => "" }),
      }),
    /público|login/i,
  );
});

test("fetchGoogleDocText ok con mock", async () => {
  const text = await fetchGoogleDocText("1NaDgQ66jdQntV6Ubju5B_1qw7RgrZy3Dfrjp8IHryq8", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => fixture,
    }),
  });
  assert.match(text, /TRÁMITES|TRAMITES/i);
});

test("POST /import/google-doc upserta logistics (mock fetch)", async (t) => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const Fastify = (await import("fastify")).default;
  const { openDb, migrate } = await import("../db.mjs");
  const { importRoutes } = await import("../routes/import.mjs");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihon-gdoc-"));
  const db = openDb(path.join(dir, "t.db"));
  migrate(db);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => fixture,
  });

  const app = Fastify({ logger: false });
  app.decorate("config", {
    googleDocItineraryId: "1NaDgQ66jdQntV6Ubju5B_1qw7RgrZy3Dfrjp8IHryq8",
  });
  await importRoutes(app, { db });
  t.after(async () => {
    globalThis.fetch = realFetch;
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/import/google-doc",
    payload: {},
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.ok(body.imported.docs >= 4);
  assert.ok(body.imported.flights >= 1);
  assert.ok(body.imported.stays >= 1);

  const n = db.prepare("SELECT COUNT(*) AS c FROM expenses WHERE id LIKE 'gdoc-%'").get().c;
  assert.ok(n >= body.imported.docs + body.imported.flights + body.imported.stays);

  // Reimport no duplica
  const again = await app.inject({
    method: "POST",
    url: "/api/v1/import/google-doc",
    payload: {},
  });
  assert.equal(again.statusCode, 200);
  const n2 = db.prepare("SELECT COUNT(*) AS c FROM expenses WHERE id LIKE 'gdoc-%'").get().c;
  assert.equal(n2, n);
});
