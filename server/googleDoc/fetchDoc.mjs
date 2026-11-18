/**
 * Fetch de Google Doc compartido "anyone with the link" vía export TXT.
 * Sin API key ni service account (v1). Si Google exige auth, falla con error claro.
 */

const DEFAULT_EXPORT =
  "https://docs.google.com/document/d/{id}/export?format=txt";

/**
 * @param {string} docId
 * @param {{ exportUrlTemplate?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchGoogleDocText(docId, opts = {}) {
  const id = String(docId || "").trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    const err = new Error("GOOGLE_DOC_ID inválido");
    err.code = "INVALID_DOC_ID";
    throw err;
  }
  const template = opts.exportUrlTemplate || DEFAULT_EXPORT;
  const url = template.replace("{id}", encodeURIComponent(id));
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "nihon-planner/1.0 (google-doc-import)",
        Accept: "text/plain,*/*",
      },
    });
    if (!res.ok) {
      const err = new Error(
        res.status === 401 || res.status === 403
          ? "El Google Doc no es público o requiere login. Compartilo como «Cualquiera con el enlace → Lector»."
          : `No se pudo descargar el Google Doc (HTTP ${res.status})`,
      );
      err.code = "DOC_FETCH_FAILED";
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    if (!text || text.length < 40) {
      const err = new Error("El Google Doc vino vacío");
      err.code = "DOC_EMPTY";
      throw err;
    }
    // BOM
    return text.replace(/^\uFEFF/, "");
  } catch (e) {
    if (e.code) throw e;
    const err = new Error(e.name === "AbortError" ? "Timeout al bajar el Google Doc" : e.message || "Error de red");
    err.code = e.name === "AbortError" ? "DOC_TIMEOUT" : "DOC_FETCH_FAILED";
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
