/** Error API. `extras` se fusiona en `error` (p. ej. `{ current }` en 409 VERSION_CONFLICT §6.1). */
export function sendError(reply, status, code, message, extras) {
  const error = { code, message };
  if (extras && typeof extras === "object") Object.assign(error, extras);
  return reply.code(status).send({ error });
}

export function sendVersionConflict(reply, current) {
  return sendError(reply, 409, "VERSION_CONFLICT", "Otra persona actualizó esta ubicación", {
    current,
  });
}

export function parseJson(raw, fallback = {}) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return fallback;
  }
}

export function getRates(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'rates'").get();
  if (!row) {
    return { usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null };
  }
  return parseJson(row.value, { usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null });
}

export function setRates(db, rates) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('rates', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(rates));
}

export function makeConverter(rates) {
  const { usdArs, usdJpy } = rates;
  const toUSD = (a, cur) => (cur === "USD" ? a : cur === "ARS" ? a / usdArs : a / usdJpy);
  return (a, cur) => {
    const usd = toUSD(a, cur);
    return { USD: usd, ARS: usd * usdArs, JPY: usd * usdJpy };
  };
}

export function mapExpense(row) {
  return {
    id: row.id,
    description: row.description,
    amount: row.amount == null ? null : row.amount,
    currency: row.currency || null,
    category: row.category,
    spent_at: row.spent_at,
    done: !!row.done,
    kind: row.kind || "expense",
    meta: parseJson(row.meta_json, {}),
    datetime_start: row.datetime_start || null,
    datetime_end: row.datetime_end || null,
    created_at: row.created_at,
  };
}

/** Formato legacy del front (localStorage / App.jsx) */
export function expenseToFront(row) {
  const meta = parseJson(row.meta_json, {});
  return {
    id: row.id,
    desc: row.description,
    amount: row.amount == null ? null : row.amount,
    currency: row.currency || null,
    category: row.category,
    date: (row.spent_at || "").slice(0, 10),
    done: !!row.done,
    kind: row.kind || "expense",
    meta,
    datetime_start: row.datetime_start || null,
    datetime_end: row.datetime_end || null,
  };
}

export const EXPENSE_CATEGORIES = [
  "comida",
  "transporte",
  "alojamiento",
  "actividades",
  "compras",
  "otros",
  "documentacion",
  "vuelos",
  "reservas",
];

export const LOGISTICS_KINDS = new Set(["flight", "stay", "booking", "doc"]);

export function categoryForKind(kind) {
  if (kind === "flight") return "vuelos";
  if (kind === "stay") return "alojamiento";
  if (kind === "booking") return "reservas";
  if (kind === "doc") return "documentacion";
  return "otros";
}

export function kindForCategory(category, explicitKind) {
  if (explicitKind && ["expense", "flight", "stay", "booking", "doc"].includes(explicitKind)) {
    return explicitKind;
  }
  if (category === "vuelos") return "flight";
  if (category === "documentacion") return "doc";
  if (category === "reservas") return "booking";
  return "expense";
}

export function logisticsFromExpenses(rows) {
  const flights = [];
  const stays = [];
  const bookings = [];
  const docs = [];
  for (const row of rows) {
    const it = mapExpense(row);
    if (it.kind === "flight") {
      flights.push({
        id: it.id,
        route: it.description,
        datetime: it.datetime_start || it.spent_at || "",
        code: it.meta.code || "",
        done: it.done,
        amount: it.amount,
        currency: it.currency,
      });
    } else if (it.kind === "stay") {
      stays.push({
        id: it.id,
        city: it.meta.city || "",
        name: it.meta.name || it.description,
        checkin: it.datetime_start || "",
        checkout: it.datetime_end || "",
        done: it.done,
        amount: it.amount,
        currency: it.currency,
      });
    } else if (it.kind === "booking") {
      bookings.push({
        id: it.id,
        name: it.description,
        datetime: it.datetime_start || "",
        done: it.done,
        amount: it.amount,
        currency: it.currency,
      });
    } else if (it.kind === "doc") {
      docs.push({
        id: it.id,
        label: it.description,
        done: it.done,
        amount: it.amount,
        currency: it.currency,
      });
    }
  }
  return { flights, stays, bookings, docs };
}

export function normalizeExpenseInput(body, existing = null) {
  const description = String(body.description ?? body.desc ?? existing?.description ?? "").trim();
  const category = body.category ?? existing?.category ?? "otros";
  const kind = kindForCategory(category, body.kind ?? existing?.kind);
  let amount =
    body.amount !== undefined
      ? body.amount === null || body.amount === ""
        ? null
        : Number(body.amount)
      : existing?.amount ?? null;
  if (amount != null && !(amount > 0)) amount = null;
  let currency =
    body.currency !== undefined
      ? body.currency || null
      : existing?.currency ?? null;
  if (amount != null && !currency) currency = "JPY";
  if (amount == null) currency = currency || null;

  const spent_at =
    body.spent_at || body.date || existing?.spent_at || new Date().toISOString();
  const done =
    body.done != null ? (body.done ? 1 : 0) : existing?.done != null ? (existing.done ? 1 : 0) : 0;
  const meta =
    body.meta !== undefined
      ? typeof body.meta === "string"
        ? body.meta
        : JSON.stringify(body.meta || {})
      : existing?.meta_json || "{}";
  const datetime_start =
    body.datetime_start !== undefined
      ? body.datetime_start
      : existing?.datetime_start ?? null;
  const datetime_end =
    body.datetime_end !== undefined ? body.datetime_end : existing?.datetime_end ?? null;

  return {
    description,
    category,
    kind,
    amount,
    currency,
    spent_at,
    done,
    meta_json: typeof meta === "string" ? meta : JSON.stringify(meta || {}),
    datetime_start,
    datetime_end,
  };
}

export function computeExpenseMoneyTotals(db) {
  const rates = getRates(db);
  const convert = makeConverter(rates);
  const rows = db.prepare("SELECT * FROM expenses").all();
  const t = { USD: 0, ARS: 0, JPY: 0 };
  const byCat = {};
  let logisticsTotal = 0;
  let logisticsDone = 0;
  let pendingWithAmountUSD = 0;
  let loadedUSD = 0;
  let pendingLogisticsUSD = 0;
  const pendingItems = [];

  for (const e of rows) {
    const isLogistics = LOGISTICS_KINDS.has(e.kind);
    if (isLogistics) {
      logisticsTotal += 1;
      if (e.done) logisticsDone += 1;
    }
    if (e.amount != null && e.currency) {
      const c = convert(e.amount, e.currency);
      t.USD += c.USD;
      t.ARS += c.ARS;
      t.JPY += c.JPY;
      byCat[e.category] = (byCat[e.category] || 0) + c.USD;
      loadedUSD += c.USD;
      if (!e.done && isLogistics) pendingLogisticsUSD += c.USD;
      if (!e.done) {
        pendingWithAmountUSD += c.USD;
        pendingItems.push({
          id: e.id,
          desc: e.description,
          category: e.category,
          amountUSD: c.USD,
          kind: e.kind,
        });
      }
    }
  }

  return {
    totals: { ...t, byCat, rates },
    logistics: {
      total: logisticsTotal,
      done: logisticsDone,
      percent: logisticsTotal ? Math.round((logisticsDone / logisticsTotal) * 100) : 0,
    },
    pendingWithAmountUSD,
    pendingItems: pendingItems.sort((a, b) => b.amountUSD - a.amountUSD).slice(0, 8),
    estimatedVsLoaded: {
      loadedUSD,
      pendingLogisticsUSD,
    },
  };
}

export function planItemFromFront(type, item) {
  if (type === "flight") {
    return {
      type: "flight",
      title: item.route || item.title || "(sin ruta)",
      done: !!item.done,
      datetime_start: item.datetime || item.date || null,
      datetime_end: null,
      meta: { code: item.code || "" },
    };
  }
  if (type === "stay") {
    return {
      type: "stay",
      title: item.name || item.city || "(sin nombre)",
      done: !!item.done,
      datetime_start: item.checkin || null,
      datetime_end: item.checkout || item.dates || null,
      meta: { city: item.city || "", name: item.name || "" },
    };
  }
  if (type === "booking") {
    return {
      type: "booking",
      title: item.name || item.title || "(sin actividad)",
      done: !!item.done || item.status === "confirmado",
      datetime_start: item.datetime || item.date || null,
      datetime_end: null,
      meta: {},
    };
  }
  return {
    type: "doc",
    title: item.label || item.title || "(sin ítem)",
    done: !!item.done,
    datetime_start: null,
    datetime_end: null,
    meta: {},
  };
}

export const DEFAULT_DOCS = [
  { id: "d1", label: "Pasaporte vigente (+6 meses desde el regreso)", done: false },
  { id: "d2", label: "Visa: argentinos NO necesitan para turismo (hasta 90 días) — verificar vigencia de la exención", done: false },
  { id: "d3", label: "Visit Japan Web (registro de inmigración y aduana)", done: false },
  { id: "d4", label: "Seguro médico de viaje", done: false },
  { id: "d5", label: "Decidir: JR Pass vs pasajes sueltos (comparar con itinerario)", done: false },
  { id: "d6", label: "Suica/Pasmo digital (Apple/Google Wallet) o física", done: false },
  { id: "d7", label: "Efectivo en yenes (Japón sigue usando mucho cash)", done: false },
  { id: "d8", label: "Entradas Ghibli Museum (salen el día 10 del mes anterior, se agotan)", done: false },
  { id: "d9", label: "Reserva TeamLab (anticipada)", done: false },
];

export function seedDefaultDocs(db, uidFn) {
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM expenses WHERE kind = 'doc'")
    .get().n;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT INTO expenses (
       id, description, amount, currency, category, spent_at, done, kind, meta_json, datetime_start, datetime_end
     ) VALUES (?, ?, NULL, NULL, 'documentacion', datetime('now'), 0, 'doc', '{}', NULL, NULL)`,
  );
  const tx = db.transaction(() => {
    for (const d of DEFAULT_DOCS) {
      insert.run(d.id || uidFn(), d.label);
    }
  });
  tx();
}
