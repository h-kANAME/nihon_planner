/**
 * Adapter con la misma interfaz que window.storage de artifacts.
 * Fase 1: get/set de claves jp:* → API REST (cookie de sesión).
 * Fallback a localStorage si la API no está disponible (offline / sin login).
 */
import { api } from "./apiClient";

const PREFIX = "nihon-planner:";
const FALLBACK_KEYS = new Set(["jp:expenses", "jp:rates", "jp:sessions"]);

let useApi = true;

export function setStorageMode(apiEnabled) {
  useApi = !!apiEnabled;
}

async function apiGet(key) {
  switch (key) {
    case "jp:expenses":
      return JSON.stringify(await api.getExpensesFront());
    case "jp:rates":
      return JSON.stringify(await api.getRates());
    case "jp:sessions": {
      const list = await api.listSessions();
      const full = [];
      for (const s of list) {
        const { messages } = await api.getMessages(s.id);
        full.push({
          id: s.id,
          name: s.name,
          mode: s.mode,
          messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
        });
      }
      return JSON.stringify(full);
    }
    default:
      throw new Error(`Key not found: ${key}`);
  }
}

async function apiSet(key, value) {
  const parsed = JSON.parse(value);
  switch (key) {
    case "jp:expenses":
      await api.syncExpenses(parsed);
      return;
    case "jp:rates":
      await api.putRates(parsed);
      return;
    case "jp:sessions":
      // Las sesiones AI se mutan vía endpoints tipados (Fase 2).
      // Sync best-effort: import upsert.
      await api.importData({ "jp:sessions": parsed });
      return;
    default:
      throw new Error(`Key not found: ${key}`);
  }
}

function localGet(key) {
  const value = localStorage.getItem(PREFIX + key);
  if (value === null) throw new Error(`Key not found: ${key}`);
  return { key, value, shared: false };
}

function localSet(key, value) {
  localStorage.setItem(PREFIX + key, value);
  return { key, value, shared: false };
}

export const storage = {
  async get(key) {
    if (useApi && FALLBACK_KEYS.has(key)) {
      try {
        const value = await apiGet(key);
        return { key, value, shared: true };
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        // key vacía / no datos → fallback
        try {
          return localGet(key);
        } catch {
          throw new Error(`Key not found: ${key}`);
        }
      }
    }
    return localGet(key);
  },

  async set(key, value) {
    if (useApi && FALLBACK_KEYS.has(key)) {
      try {
        await apiSet(key, value);
        localSet(key, value); // mirror local para offline
        return { key, value, shared: true };
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        console.warn("API set failed, localStorage fallback", key, e);
        return localSet(key, value);
      }
    }
    return localSet(key, value);
  },

  async delete(key) {
    localStorage.removeItem(PREFIX + key);
    return { key, deleted: true, shared: false };
  },

  async list(prefix = "") {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX + prefix)) keys.push(k.slice(PREFIX.length));
    }
    return { keys, prefix, shared: false };
  },
};
