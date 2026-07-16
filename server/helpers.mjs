export function sendError(reply, status, code, message) {
  return reply.code(status).send({ error: { code, message } });
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
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    spent_at: row.spent_at,
    created_at: row.created_at,
  };
}

/** Formato legacy del front (localStorage / App.jsx) */
export function expenseToFront(row) {
  return {
    id: row.id,
    desc: row.description,
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    date: (row.spent_at || "").slice(0, 10),
  };
}

export function mapPlanItem(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    done: !!row.done,
    datetime_start: row.datetime_start,
    datetime_end: row.datetime_end,
    meta: parseJson(row.meta),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function logisticsFromItems(items) {
  const flights = [];
  const stays = [];
  const bookings = [];
  const docs = [];
  for (const row of items) {
    const it = mapPlanItem(row);
    if (it.type === "flight") {
      flights.push({
        id: it.id,
        route: it.title,
        datetime: it.datetime_start || "",
        code: it.meta.code || "",
        done: it.done,
      });
    } else if (it.type === "stay") {
      stays.push({
        id: it.id,
        city: it.meta.city || "",
        name: it.meta.name || it.title,
        checkin: it.datetime_start || "",
        checkout: it.datetime_end || "",
        done: it.done,
      });
    } else if (it.type === "booking") {
      bookings.push({
        id: it.id,
        name: it.title,
        datetime: it.datetime_start || "",
        done: it.done,
      });
    } else if (it.type === "doc") {
      docs.push({
        id: it.id,
        label: it.title,
        done: it.done,
      });
    }
  }
  return { flights, stays, bookings, docs };
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

export function seedDefaultDocs(db, uid) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM plan_items WHERE type = 'doc'").get().n;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT INTO plan_items (id, type, title, done, datetime_start, datetime_end, meta)
     VALUES (?, 'doc', ?, 0, NULL, NULL, '{}')`,
  );
  const tx = db.transaction(() => {
    for (const d of DEFAULT_DOCS) {
      insert.run(d.id, d.label);
    }
  });
  tx();
}
