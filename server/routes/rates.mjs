import { getRates, setRates, sendError } from "../helpers.mjs";

export async function ratesRoutes(app, { db, config }) {
  app.get("/api/v1/rates", async () => getRates(db));

  app.put("/api/v1/rates", async (request, reply) => {
    const body = request.body || {};
    const current = getRates(db);
    const next = {
      ...current,
      usdArs: body.usdArs != null ? Number(body.usdArs) : current.usdArs,
      usdJpy: body.usdJpy != null ? Number(body.usdJpy) : current.usdJpy,
      source: "manual",
      updatedAt: new Date().toISOString(),
      blue: false,
    };
    if (!(next.usdArs > 0) || !(next.usdJpy > 0)) {
      return sendError(reply, 400, "VALIDATION", "Cotizaciones inválidas");
    }
    setRates(db, next);
    return next;
  });

  app.post("/api/v1/rates/refresh", async (request, reply) => {
    const force = request.query?.force === "true";
    const current = getRates(db);
    if (!force && current.updatedAt) {
      const age = Date.now() - new Date(current.updatedAt).getTime();
      if (age < config.ratesCacheMinutes * 60 * 1000) {
        return { ...current, cached: true };
      }
    }

    try {
      const next = { ...current, blue: false };
      const r1 = await fetch("https://open.er-api.com/v6/latest/USD");
      const j1 = await r1.json();
      if (j1?.rates?.JPY) next.usdJpy = j1.rates.JPY;
      if (j1?.rates?.ARS) next.usdArs = j1.rates.ARS;

      try {
        const r2 = await fetch("https://dolarapi.com/v1/dolares/blue");
        const j2 = await r2.json();
        if (j2?.venta) {
          next.usdArs = j2.venta;
          next.blue = true;
        }
      } catch {
        /* blue opcional */
      }

      next.source = next.blue ? "API (blue)" : "API (oficial)";
      next.updatedAt = new Date().toISOString();
      setRates(db, next);
      return next;
    } catch (e) {
      request.log.error({ err: e.message }, "Falló refresh de cotizaciones");
      return sendError(reply, 502, "UPSTREAM", "No se pudieron obtener cotizaciones");
    }
  });
}
