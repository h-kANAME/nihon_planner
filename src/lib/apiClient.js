/**
 * Cliente HTTP hacia /api/v1. Credentials (cookie) siempre incluidas.
 */
const BASE = "/api/v1";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.error?.code;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request("/auth/me"),
  loginGoogle: (credential) =>
    request("/auth/google", { method: "POST", body: JSON.stringify({ credential }) }),
  logout: () => request("/auth/logout", { method: "POST", body: "{}" }),

  getExpenses: (qs = "") => request(`/expenses${qs}`),
  getExpensesFront: () => request("/expenses?format=front"),
  syncExpenses: (list) =>
    request("/expenses/sync", { method: "PUT", body: JSON.stringify(list) }),
  createExpense: (body) => request("/expenses", { method: "POST", body: JSON.stringify(body) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),
  totals: () => request("/expenses/totals"),

  getLogistics: () => request("/plan-items?format=logistics"),
  syncLogistics: (logistics) =>
    request("/plan-items/sync-logistics", { method: "PUT", body: JSON.stringify(logistics) }),

  getRates: () => request("/rates"),
  putRates: (body) => request("/rates", { method: "PUT", body: JSON.stringify(body) }),
  refreshRates: (force = false) =>
    request(`/rates/refresh${force ? "?force=true" : ""}`, { method: "POST", body: "{}" }),

  listSessions: () => request("/sessions"),
  createSession: (body) => request("/sessions", { method: "POST", body: JSON.stringify(body) }),
  deleteSession: (id) => request(`/sessions/${id}`, { method: "DELETE" }),
  getMessages: (id) => request(`/sessions/${id}/messages`),
  chat: (id, content) =>
    request(`/sessions/${id}/chat`, { method: "POST", body: JSON.stringify({ content }) }),
  resetSession: (id) => request(`/sessions/${id}/reset`, { method: "POST", body: "{}" }),
  exportSession: (id) => request(`/sessions/${id}/export`),

  importData: (body) => request("/import", { method: "POST", body: JSON.stringify(body) }),
  exportDump: () => request("/export/dump"),
};
