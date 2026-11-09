/**
 * Cliente HTTP hacia /api/v1. Credentials (cookie) siempre incluidas.
 */
const BASE = "/api/v1";

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  // Solo forzar JSON cuando hay body: DELETE/GET vacíos rompen Fastify (FST_ERR_CTP_EMPTY_JSON_BODY).
  if (options.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
    headers,
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
  updateExpense: (id, body) =>
    request(`/expenses/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),
  totals: () => request("/expenses/totals"),
  expensesDashboard: () => request("/expenses/dashboard"),

  getItinerary: () => request("/itinerary"),
  putItineraryMeta: (body) =>
    request("/itinerary/meta", { method: "PUT", body: JSON.stringify(body) }),
  createItineraryDay: (body) =>
    request("/itinerary/days", { method: "POST", body: JSON.stringify(body) }),
  patchItineraryDay: (id, body) =>
    request(`/itinerary/days/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteItineraryDay: (id) => request(`/itinerary/days/${id}`, { method: "DELETE" }),
  createItineraryStop: (dayId, body) =>
    request(`/itinerary/days/${dayId}/stops`, { method: "POST", body: JSON.stringify(body) }),
  patchItineraryStop: (id, body) =>
    request(`/itinerary/stops/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteItineraryStop: (id) => request(`/itinerary/stops/${id}`, { method: "DELETE" }),
  /** @param {string} id @param {{ version: number, mode: string, raw_input?: string }} body */
  putStopLocation: (id, body) =>
    request(`/itinerary/stops/${id}/location`, { method: "PUT", body: JSON.stringify(body) }),
  /** @param {string} id @param {{ version: number, raw_input?: string, clear?: boolean }} body */
  putStayLocation: (id, body) =>
    request(`/itinerary/days/${id}/stay-location`, { method: "PUT", body: JSON.stringify(body) }),
  importItineraryMd: (markdown, filename, opts = {}) =>
    request("/itinerary/import-md", {
      method: "POST",
      body: JSON.stringify({ markdown, filename, force: !!opts.force }),
    }),
  /**
   * Import con progreso NDJSON.
   * Propaga status/code/data en Error (§7.4 force / LOCATIONS_AT_RISK).
   * @param {string} markdown
   * @param {string} [filename]
   * @param {(p: object) => void} [onProgress]
   * @param {{ force?: boolean }} [opts]
   */
  importItineraryMdStream: async (markdown, filename, onProgress, opts = {}) => {
    const res = await fetch(`${BASE}/itinerary/import-md`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown,
        filename,
        stream: true,
        force: !!opts.force,
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      const err = new Error(data?.error?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data?.error?.code;
      err.data = data;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let evt;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (evt.type === "progress") {
          onProgress?.(evt);
        } else if (evt.type === "done") {
          onProgress?.({
            phase: "done",
            percent: 100,
            message: evt.message || "Importación completa",
            detail: evt.detail,
          });
          finalResult = {
            itinerary: evt.itinerary,
            warnings: evt.warnings || [],
            meta: evt.meta,
            relink_report: evt.relink_report,
          };
        } else if (evt.type === "error") {
          const err = new Error(evt.message || "Error al importar");
          err.code = evt.code;
          err.status = evt.status;
          err.data = evt.data != null ? evt.data : evt;
          throw err;
        }
      }
    }

    if (buffer.trim()) {
      try {
        const evt = JSON.parse(buffer.trim());
        if (evt.type === "done") {
          finalResult = {
            itinerary: evt.itinerary,
            warnings: evt.warnings || [],
            meta: evt.meta,
            relink_report: evt.relink_report,
          };
        } else if (evt.type === "error") {
          const err = new Error(evt.message || "Error al importar");
          err.code = evt.code;
          err.status = evt.status;
          err.data = evt.data != null ? evt.data : evt;
          throw err;
        }
      } catch (e) {
        if (e.message && !e.message.includes("JSON")) throw e;
      }
    }

    if (!finalResult) throw new Error("La importación terminó sin resultado");
    return finalResult;
  },
  importItineraryJson: (body) =>
    request("/itinerary/import-json", { method: "POST", body: JSON.stringify(body) }),
  exportItineraryMd: async () => {
    const res = await fetch(`${BASE}/itinerary/export.md`, { credentials: "include" });
    const text = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        msg = JSON.parse(text)?.error?.message || msg;
      } catch {
        /* raw */
      }
      throw new Error(msg);
    }
    return text;
  },

  getRates: () => request("/rates"),
  putRates: (body) => request("/rates", { method: "PUT", body: JSON.stringify(body) }),
  refreshRates: (force = false) =>
    request(`/rates/refresh${force ? "?force=true" : ""}`, { method: "POST", body: "{}" }),

  listSessions: () => request("/sessions"),
  createSession: (body) => request("/sessions", { method: "POST", body: JSON.stringify(body) }),
  renameSession: (id, name) =>
    request(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  updateSession: (id, body) =>
    request(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSession: (id) => request(`/sessions/${id}`, { method: "DELETE" }),
  getMessages: (id) => request(`/sessions/${id}/messages`),
  chat: (id, content) =>
    request(`/sessions/${id}/chat`, { method: "POST", body: JSON.stringify({ content }) }),
  resetSession: (id) => request(`/sessions/${id}/reset`, { method: "POST", body: "{}" }),
  exportSession: (id) => request(`/sessions/${id}/export`),

  importData: (body) => request("/import", { method: "POST", body: JSON.stringify(body) }),
  exportDump: () => request("/export/dump"),
};
