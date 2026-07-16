import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { storage, setStorageMode } from "./lib/storage";
import { api } from "./lib/apiClient";
import { C, S, applyTheme, resolveInitialMode, persistMode } from "./theme";
import Login from "./Login.jsx";
import Markdown from "./components/Markdown.jsx";

/* ============================================================
   NIHON PLANNER — Viaje a Japón (20 días, pareja, ARS/USD/JPY)
   Tokens: kyz + Material (light/dark) + hinomaru.
   ============================================================ */

function PowerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2v10"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M6.5 5.2a8 8 0 1 0 11 0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const CATS = [
  { id: "comida", label: "Comida", kanji: "食" },
  { id: "transporte", label: "Transporte", kanji: "交" },
  { id: "alojamiento", label: "Alojamiento", kanji: "宿" },
  { id: "actividades", label: "Actividades", kanji: "遊" },
  { id: "compras", label: "Compras", kanji: "買" },
  { id: "otros", label: "Otros", kanji: "他" },
];

const DEFAULT_DOCS = [
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

const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n, cur) => {
  if (n == null || isNaN(n)) return "—";
  const opts = cur === "JPY" ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 2, minimumFractionDigits: 2 };
  const s = Number(n).toLocaleString("es-AR", opts);
  return cur === "JPY" ? `¥${s}` : cur === "USD" ? `US$${s}` : `$${s}`;
};

/* ---------- storage helpers ---------- */
async function load(key, fallback) {
  try {
    const r = await storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}
async function save(key, value) {
  try {
    await storage.set(key, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}

/* ---------- conversión ---------- */
function makeConverter(rates) {
  const { usdArs, usdJpy } = rates;
  const toUSD = (a, cur) => (cur === "USD" ? a : cur === "ARS" ? a / usdArs : a / usdJpy);
  return (a, cur) => {
    const usd = toUSD(a, cur);
    return { USD: usd, ARS: usd * usdArs, JPY: usd * usdJpy };
  };
}

/* ============================================================ */
export default function App() {
  const [themeMode, setThemeMode] = useState(resolveInitialMode);
  applyTheme(themeMode);

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState("resumen");
  const [ready, setReady] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [logistics, setLogistics] = useState({ flights: [], stays: [], bookings: [], docs: DEFAULT_DOCS });
  const [rates, setRates] = useState({ usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null });
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    applyTheme(themeMode);
    persistMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    (async () => {
      try {
        const { user: u } = await api.me();
        setUser(u);
        setStorageMode(true);
      } catch {
        setUser(null);
        setStorageMode(false);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  const loadTrip = useCallback(async () => {
    const [e, l, r] = await Promise.all([
      load("jp:expenses", []),
      load("jp:logistics", { flights: [], stays: [], bookings: [], docs: DEFAULT_DOCS }),
      load("jp:rates", { usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null }),
    ]);
    setExpenses(e);
    const logistics = l && typeof l === "object"
      ? {
          flights: l.flights || [],
          stays: l.stays || [],
          bookings: l.bookings || [],
          docs: l.docs?.length ? l.docs : DEFAULT_DOCS,
        }
      : { flights: [], stays: [], bookings: [], docs: DEFAULT_DOCS };
    setLogistics(logistics);
    setRates(r);
    try {
      const list = await api.listSessions();
      setSessions(list);
    } catch {
      setSessions([]);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (user) loadTrip();
  }, [user, loadTrip]);

  /* persistencia (Fase 1 adapter) */
  useEffect(() => { if (ready && user) save("jp:expenses", expenses); }, [expenses, ready, user]);
  useEffect(() => { if (ready && user) save("jp:logistics", logistics); }, [logistics, ready, user]);
  useEffect(() => { if (ready && user) save("jp:rates", rates); }, [rates, ready, user]);

  const [rateStatus, setRateStatus] = useState("idle");
  async function fetchRates() {
    setRateStatus("loading");
    try {
      const next = await api.refreshRates(true);
      setRates(next);
      setRateStatus("ok");
    } catch {
      setRateStatus("offline");
    }
  }

  const convert = useMemo(() => makeConverter(rates), [rates]);

  const totals = useMemo(() => {
    const t = { USD: 0, ARS: 0, JPY: 0 };
    const byCat = {};
    expenses.forEach((e) => {
      const c = convert(Number(e.amount) || 0, e.currency);
      t.USD += c.USD; t.ARS += c.ARS; t.JPY += c.JPY;
      byCat[e.category] = (byCat[e.category] || 0) + c.USD;
    });
    return { ...t, byCat };
  }, [expenses, convert]);

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
    setReady(false);
    setStorageMode(false);
  };

  if (!authChecked) {
    return (
      <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: C.onSurfaceVariant, fontSize: 14, letterSpacing: 2 }}>準備中 · cargando…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        themeMode={themeMode}
        onToggleTheme={() => setThemeMode((m) => (m === "light" ? "dark" : "light"))}
        onSuccess={(u) => { setStorageMode(true); setUser(u); }}
      />
    );
  }

  if (!ready) {
    return (
      <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: C.onSurfaceVariant, fontSize: 14, letterSpacing: 2 }}>準備中 · cargando…</div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div>
          <div style={S.eyebrow}>日本 · 20 días · dos viajeros</div>
          <h1 style={S.title}>Nihon Planner</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            style={S.ghost}
            onClick={() => setThemeMode((m) => (m === "light" ? "dark" : "light"))}
            title={themeMode === "light" ? "Tema oscuro" : "Tema claro"}
            aria-label={themeMode === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
          >
            {themeMode === "light" ? "暗" : "明"}
          </button>
          <button
            type="button"
            style={S.ghost}
            onClick={logout}
            title={`Cerrar sesión (${user.email})`}
            aria-label="Cerrar sesión"
          >
            <PowerIcon />
          </button>
          <div style={S.stamp} title="Hinomaru" aria-hidden>
            <span style={S.hinomaru} />
          </div>
        </div>
      </header>

      <main style={S.main}>
        {tab === "resumen" && <Resumen totals={totals} expenses={expenses} logistics={logistics} rates={rates} />}
        {tab === "gastos" && <Gastos expenses={expenses} setExpenses={setExpenses} convert={convert} totals={totals} />}
        {tab === "conversor" && (
          <Conversor rates={rates} setRates={setRates} convert={convert} fetchRates={() => fetchRates()} rateStatus={rateStatus} />
        )}
        {tab === "plan" && <Plan logistics={logistics} setLogistics={setLogistics} />}
        {tab === "ai" && <Asistente sessions={sessions} setSessions={setSessions} />}
      </main>

      <nav style={S.nav} aria-label="Principal">
        {[
          ["resumen", "概", "Resumen"],
          ["gastos", "費", "Gastos"],
          ["conversor", "両", "Conversor"],
          ["plan", "旅", "Plan"],
          ["ai", "助", "AI"],
        ].map(([id, kanji, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active ? "page" : undefined}
              style={{ ...S.navBtn, ...(active ? S.navBtnActive : {}) }}
            >
              {active && <span style={S.navIndicator} aria-hidden />}
              <span style={{ fontSize: 17, lineHeight: 1, fontWeight: active ? 700 : 500 }}>{kanji}</span>
              <span style={{ fontSize: 11, letterSpacing: 0.3, fontWeight: active ? 600 : 400 }}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ================= RESUMEN ================= */
function Resumen({ totals, expenses, logistics, rates }) {
  const docsDone = logistics.docs.filter((d) => d.done).length;
  const pendingBookings = logistics.bookings.filter((b) => !b.done && b.status !== "confirmado");
  return (
    <div>
      <Card>
        <div style={S.label}>Total gastado</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 34, fontWeight: 700, color: C.ink }}>{fmt(totals.JPY, "JPY")}</span>
          <span style={{ fontSize: 15, color: C.indigo }}>{fmt(totals.USD, "USD")}</span>
          <span style={{ fontSize: 15, color: C.soft }}>{fmt(totals.ARS, "ARS")}</span>
        </div>
        <div style={{ fontSize: 12, color: C.soft, marginTop: 6 }}>
          {expenses.length} gasto{expenses.length !== 1 ? "s" : ""} · cotización {rates.source}
        </div>
      </Card>

      <Card>
        <div style={S.label}>Por categoría (en USD)</div>
        {Object.keys(totals.byCat).length === 0 && <Empty text="Todavía no hay gastos. Cargá el primero en 費 Gastos." />}
        {CATS.filter((c) => totals.byCat[c.id]).map((c) => {
          const v = totals.byCat[c.id];
          const max = Math.max(...Object.values(totals.byCat));
          return (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                <span><b style={{ color: C.hanko }}>{c.kanji}</b> {c.label}</span>
                <span style={{ color: C.indigo }}>{fmt(v, "USD")}</span>
              </div>
              <div style={{ height: 6, background: C.line, borderRadius: 3 }}>
                <div style={{ height: 6, width: `${(v / max) * 100}%`, background: C.indigo, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </Card>

      <Card>
        <div style={S.label}>Estado del plan</div>
        <Row k="Documentación" v={`${docsDone}/${logistics.docs.length} listos`} />
        <Row k="Vuelos cargados" v={logistics.flights.length} />
        <Row k="Alojamientos" v={logistics.stays.length} />
        <Row k="Reservas pendientes" v={pendingBookings.length} accent={pendingBookings.length > 0} />
      </Card>
    </div>
  );
}

/* ================= GASTOS ================= */
function Gastos({ expenses, setExpenses, convert, totals }) {
  const [form, setForm] = useState({ desc: "", amount: "", currency: "JPY", category: "comida" });
  const add = () => {
    if (!form.desc.trim() || !Number(form.amount)) return;
    setExpenses([{ id: uid(), ...form, amount: Number(form.amount), date: new Date().toISOString().slice(0, 10) }, ...expenses]);
    setForm({ ...form, desc: "", amount: "" });
  };
  return (
    <div>
      <Card>
        <div style={S.label}>Nuevo gasto</div>
        <input style={S.input} placeholder="Descripción (ej: Ramen en Ichiran)" value={form.desc}
          onChange={(e) => setForm({ ...form, desc: e.target.value })} />
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...S.input, flex: 1 }} type="number" inputMode="decimal" placeholder="Monto" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <select style={{ ...S.input, width: 90 }} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option>JPY</option><option>USD</option><option>ARS</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 10px" }}>
          {CATS.map((c) => (
            <button key={c.id} onClick={() => setForm({ ...form, category: c.id })}
              style={{ ...S.chip, ...(form.category === c.id ? S.chipOn : {}) }}>
              {c.kanji} {c.label}
            </button>
          ))}
        </div>
        <button style={S.primary} onClick={add}>Agregar gasto</button>
      </Card>

      {expenses.length === 0 ? (
        <Card><Empty text="Sin gastos aún. El primero suele ser el vuelo ✈️" /></Card>
      ) : (
        expenses.map((e) => {
          const c = convert(e.amount, e.currency);
          const cat = CATS.find((x) => x.id === e.category);
          return (
            <Card key={e.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    <span style={{ color: C.hanko, marginRight: 6 }}>{cat?.kanji}</span>{e.desc}
                  </div>
                  <div style={{ fontSize: 12, color: C.soft, marginTop: 2 }}>{e.date} · cargado en {e.currency}</div>
                  <div style={{ fontSize: 13, color: C.indigo, marginTop: 6 }}>
                    {fmt(c.JPY, "JPY")} · {fmt(c.USD, "USD")} · {fmt(c.ARS, "ARS")}
                  </div>
                </div>
                <button style={S.ghost} onClick={() => setExpenses(expenses.filter((x) => x.id !== e.id))}>✕</button>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

/* ================= CONVERSOR ================= */
function Conversor({ rates, setRates, convert, fetchRates, rateStatus }) {
  const [amount, setAmount] = useState("1000");
  const [cur, setCur] = useState("JPY");
  const c = convert(Number(amount) || 0, cur);
  return (
    <div>
      <Card>
        <div style={S.label}>Convertir</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...S.input, flex: 1, fontSize: 20 }} type="number" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
          <select style={{ ...S.input, width: 90 }} value={cur} onChange={(e) => setCur(e.target.value)}>
            <option>JPY</option><option>USD</option><option>ARS</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {["JPY", "USD", "ARS"].filter((x) => x !== cur).map((x) => (
            <div key={x} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: C.bg, borderRadius: 10 }}>
              <span style={{ color: C.soft, fontSize: 13 }}>{x}</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: C.ink }}>{fmt(c[x], x)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.label}>Cotizaciones</div>
          <button style={S.secondary} onClick={fetchRates}>
            {rateStatus === "loading" ? "Actualizando…" : "↻ Actualizar"}
          </button>
        </div>
        {rateStatus === "offline" && (
          <div style={S.warn}>No pude acceder a la API desde este entorno. Usando cotización manual — podés editarla abajo.</div>
        )}
        <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>
          Fuente: {rates.source}{rates.updatedAt ? ` · ${new Date(rates.updatedAt).toLocaleString("es-AR")}` : ""}
        </div>
        <EditableRate label="1 USD en ARS" value={rates.usdArs} onChange={(v) => setRates({ ...rates, usdArs: v, source: "manual" })}
          hint="Tip: usá blue/tarjeta, no oficial" />
        <EditableRate label="1 USD en JPY" value={rates.usdJpy} onChange={(v) => setRates({ ...rates, usdJpy: v, source: "manual" })} />
        <div style={{ fontSize: 12, color: C.soft, marginTop: 8 }}>
          Implícito: ¥1000 ≈ {fmt(convert(1000, "JPY").ARS, "ARS")}
        </div>
      </Card>
    </div>
  );
}

function EditableRate({ label, value, onChange, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 13, flex: 1 }}>{label}{hint && <span style={{ color: C.matcha, fontSize: 11 }}> · {hint}</span>}</span>
      <input style={{ ...S.input, width: 110, marginBottom: 0 }} type="number" inputMode="decimal" value={value}
        onChange={(e) => onChange(Number(e.target.value) || value)} />
    </div>
  );
}

/* ================= PLAN / LOGÍSTICA (uso intensivo: sheet + lista contenida) ================= */
const fmtDT = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const PLAN_PAGE = { docs: 8, flights: 8, stays: 6, bookings: 8 };

function Plan({ logistics, setLogistics }) {
  const [section, setSection] = useState("docs");
  const upd = (patch) => setLogistics({ ...logistics, ...patch });

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["docs", "Documentación"], ["flights", "Vuelos"], ["stays", "Alojamiento"], ["bookings", "Reservas"]].map(([id, l]) => (
          <button key={id} type="button" onClick={() => setSection(id)} style={{ ...S.chip, ...(section === id ? S.chipOn : {}) }}>{l}</button>
        ))}
      </div>

      {section === "docs" && (
        <PlanList
          title="Checklist de documentación"
          items={logistics.docs}
          fields={[["label", "Ítem de documentación", "text"]]}
          primaryKey="label"
          pageSize={PLAN_PAGE.docs}
          defaultFilter="pending"
          dateKey={null}
          searchKeys={["label"]}
          onChange={(items) => upd({ docs: items })}
        />
      )}

      {section === "flights" && (
        <PlanList
          title="Vuelos y traslados internos"
          items={logistics.flights}
          fields={[
            ["route", "Ruta (EZE → NRT)", "text"],
            ["datetime", "Fecha y hora de salida", "datetime"],
            ["code", "Aerolínea / código", "text"],
          ]}
          primaryKey="route"
          pageSize={PLAN_PAGE.flights}
          dateKey="datetime"
          searchKeys={["route", "code"]}
          onChange={(items) => upd({ flights: items })}
        />
      )}

      {section === "stays" && (
        <PlanList
          title="Alojamiento por ciudad"
          items={logistics.stays}
          fields={[
            ["city", "Ciudad (Tokyo, Kyoto…)", "text"],
            ["name", "Hotel / Airbnb", "text"],
            ["checkin", "Check-in", "datetime"],
            ["checkout", "Check-out", "datetime"],
          ]}
          primaryKey="name"
          pageSize={PLAN_PAGE.stays}
          dateKey="checkin"
          searchKeys={["city", "name"]}
          onChange={(items) => upd({ stays: items })}
          validate={(form) => {
            if (form.checkin && form.checkout && form.checkout < form.checkin) {
              return "El check-out no puede ser anterior al check-in";
            }
            return null;
          }}
        />
      )}

      {section === "bookings" && (
        <PlanList
          title="Actividades y reservas"
          items={logistics.bookings}
          fields={[
            ["name", "Actividad (Ghibli, TeamLab, Daikoku tour…)", "text"],
            ["datetime", "Fecha y hora", "datetime"],
          ]}
          primaryKey="name"
          pageSize={PLAN_PAGE.bookings}
          dateKey="datetime"
          searchKeys={["name"]}
          onChange={(items) => upd({ bookings: items })}
        />
      )}
    </div>
  );
}

function PlanEditSheet({ open, title, fields, values, error, onChange, onSave, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: C.surfaceContainer,
          borderRadius: "16px 16px 0 0",
          boxShadow: C.elevation2,
          paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: `1px solid ${C.outlineVariant}`,
        }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <button type="button" style={S.ghost} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", WebkitOverflowScrolling: "touch" }}>
          {fields.map(([k, ph, type], idx) => (
            <div key={k}>
              <div style={{ fontSize: 11, color: C.onSurfaceVariant, margin: "2px 0 4px" }}>{ph}</div>
              <input
                autoFocus={idx === 0}
                style={{ ...S.input, marginBottom: 12 }}
                type={type === "datetime" ? "datetime-local" : "text"}
                placeholder={ph}
                value={values[k] || ""}
                onChange={(e) => onChange({ ...values, [k]: e.target.value })}
              />
            </div>
          ))}
          {error && <div style={S.warn}>{error}</div>}
        </div>
        <div style={{
          display: "flex",
          gap: 8,
          padding: "10px 16px 4px",
          borderTop: `1px solid ${C.outlineVariant}`,
          background: C.surfaceContainer,
        }}>
          <button type="button" style={{ ...S.secondary, flex: 1, marginTop: 0 }} onClick={onClose}>Cancelar</button>
          <button type="button" style={{ ...S.primary, flex: 1.4, marginTop: 0 }} onClick={onSave}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function PlanList({
  title,
  items,
  fields,
  primaryKey,
  pageSize,
  dateKey,
  searchKeys,
  onChange,
  defaultFilter = "all",
  validate,
}) {
  const empty = Object.fromEntries(fields.map(([k]) => [k, ""]));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(defaultFilter);
  const [sort, setSort] = useState(dateKey ? "dateAsc" : "az");
  const [visible, setVisible] = useState(pageSize);
  const [sheet, setSheet] = useState(null); // null | { mode: 'create'|'edit', id?, values }
  const [sheetError, setSheetError] = useState(null);

  useEffect(() => {
    setVisible(pageSize);
  }, [query, filter, sort, pageSize, items.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((it) => {
      if (filter === "pending" && it.done) return false;
      if (filter === "done" && !it.done) return false;
      if (!q) return true;
      return searchKeys.some((k) => String(it[k] || "").toLowerCase().includes(q));
    });

    list = [...list].sort((a, b) => {
      if (sort === "az") {
        return String(a[primaryKey] || "").localeCompare(String(b[primaryKey] || ""), "es");
      }
      if (!dateKey) return 0;
      const da = a[dateKey] || "";
      const db = b[dateKey] || "";
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return sort === "dateAsc" ? da.localeCompare(db) : db.localeCompare(da);
    });
    return list;
  }, [items, query, filter, sort, dateKey, primaryKey, searchKeys]);

  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  const openCreate = () => {
    setSheetError(null);
    setSheet({ mode: "create", values: { ...empty } });
  };
  const openEdit = (it) => {
    setSheetError(null);
    setSheet({
      mode: "edit",
      id: it.id,
      values: Object.fromEntries(fields.map(([k]) => [k, it[k] || ""])),
    });
  };
  const closeSheet = () => {
    setSheet(null);
    setSheetError(null);
  };

  const saveSheet = () => {
    if (!sheet) return;
    const form = sheet.values;
    if (!fields.some(([k]) => (form[k] || "").trim())) {
      setSheetError("Completá al menos un campo");
      return;
    }
    if (validate) {
      const err = validate(form);
      if (err) { setSheetError(err); return; }
    }
    if (sheet.mode === "edit") {
      onChange(items.map((x) => (x.id === sheet.id ? { ...x, ...form } : x)));
    } else {
      onChange([...items, { id: uid(), ...form, done: false }]);
    }
    closeSheet();
  };

  const removeItem = (id) => {
    if (!window.confirm("¿Eliminar este ítem?")) return;
    onChange(items.filter((x) => x.id !== id));
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ ...S.label, marginBottom: 0 }}>{title}</div>
        <button type="button" style={{ ...S.secondary, minHeight: 40, padding: "6px 12px" }} onClick={openCreate}>+ Nuevo</button>
      </div>

      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: C.surfaceContainer,
        paddingBottom: 8,
        marginBottom: 4,
        borderBottom: `1px solid ${C.outlineVariant}`,
      }}>
        <input
          style={{ ...S.input, marginBottom: 8 }}
          type="search"
          inputMode="search"
          placeholder="Buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar en el plan"
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {[
            ["all", "Todos"],
            ["pending", "Pendientes"],
            ["done", "Hechos"],
          ].map(([id, l]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} style={{ ...S.chip, minHeight: 36, padding: "6px 10px", ...(filter === id ? S.chipOn : {}) }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(dateKey
            ? [["dateAsc", "Fecha ↑"], ["dateDesc", "Fecha ↓"], ["az", "A–Z"]]
            : [["az", "A–Z"]]
          ).map(([id, l]) => (
            <button key={id} type="button" onClick={() => setSort(id)} style={{ ...S.chip, minHeight: 32, padding: "4px 10px", fontSize: 11, ...(sort === id ? S.chipOn : {}) }}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: C.onSurfaceVariant, marginTop: 8 }}>
          Mostrando {shown.length} de {filtered.length}
          {filtered.length !== items.length ? ` · filtrados de ${items.length}` : ""}
        </div>
      </div>

      <div style={{
        maxHeight: "min(55vh, 420px)",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        marginTop: 4,
      }}>
        {items.length === 0 && <Empty text="Nada cargado todavía. Tocá + Nuevo." />}
        {items.length > 0 && filtered.length === 0 && <Empty text="Sin resultados para este filtro o búsqueda." />}

        {shown.map((it) => {
          const metaParts = fields
            .filter(([k]) => k !== primaryKey)
            .map(([k, ph, type]) => (it[k] ? (type === "datetime" ? `${ph}: ${fmtDT(it[k])}` : it[k]) : null))
            .filter(Boolean);
          const editing = sheet?.mode === "edit" && sheet.id === it.id;
          return (
            <div
              key={it.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "12px 8px",
                borderBottom: `1px solid ${C.outlineVariant}`,
                borderRadius: 8,
                background: editing ? C.primaryContainer : "transparent",
              }}
            >
              <div style={{ fontSize: 14, flex: 1, minWidth: 0, paddingRight: 8 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  {primaryKey === "label" && (
                    <input
                      type="checkbox"
                      checked={!!it.done}
                      style={{ accentColor: C.primary, marginTop: 3, cursor: "pointer", width: 18, height: 18, flexShrink: 0 }}
                      onChange={() => onChange(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
                      aria-label="Marcar realizado"
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <b style={{
                      textDecoration: it.done ? "line-through" : "none",
                      color: it.done ? C.onSurfaceVariant : C.onSurface,
                      wordBreak: "break-word",
                    }}>
                      {it[primaryKey] || "(sin título)"}
                    </b>
                    {it.done && primaryKey !== "label" && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: C.secondary, fontWeight: 700 }}>✓ realizado</span>
                    )}
                    {metaParts.length > 0 && <Meta>{metaParts.join(" · ")}</Meta>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 0, flexShrink: 0 }}>
                {primaryKey !== "label" && (
                  <button
                    type="button"
                    style={{ ...S.ghost, color: it.done ? C.secondary : C.onSurfaceVariant, minWidth: 40, minHeight: 40 }}
                    title={it.done ? "Marcar pendiente" : "Marcar realizado"}
                    onClick={() => onChange(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
                  >
                    {it.done ? "✓" : "○"}
                  </button>
                )}
                <button type="button" style={{ ...S.ghost, minWidth: 40, minHeight: 40 }} title="Editar" onClick={() => openEdit(it)}>✎</button>
                <button type="button" style={{ ...S.ghost, minWidth: 40, minHeight: 40 }} title="Eliminar" onClick={() => removeItem(it.id)}>✕</button>
              </div>
            </div>
          );
        })}

        {hasMore && (
          <button
            type="button"
            style={{ ...S.secondary, width: "100%", marginTop: 10, marginBottom: 4 }}
            onClick={() => setVisible((n) => n + pageSize)}
          >
            Cargar más ({filtered.length - visible} restantes)
          </button>
        )}
      </div>

      <PlanEditSheet
        open={!!sheet}
        title={sheet?.mode === "edit" ? "Editar ítem" : "Nuevo ítem"}
        fields={fields}
        values={sheet?.values || empty}
        error={sheetError}
        onChange={(values) => setSheet((s) => (s ? { ...s, values } : s))}
        onSave={saveSheet}
        onClose={closeSheet}
      />
    </Card>
  );
}

/* ================= ASISTENTE AI (Fase 2 — historial en server) ================= */
function Asistente({ sessions, setSessions }) {
  const [mode, setMode] = useState("planificar");
  const [activeId, setActiveId] = useState(sessions[0]?.id || null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [exportText, setExportText] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedMsgKey, setCopiedMsgKey] = useState(null);
  const [importing, setImporting] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [nameSheet, setNameSheet] = useState(null);
  const bottomRef = useRef(null);
  const importRef = useRef(null);

  const active = sessions.find((s) => s.id === activeId) || null;
  const currentSession =
    mode === "consultar"
      ? sessions.find((s) => s.mode === "consultar") || null
      : active?.mode === "planificar"
        ? active
        : null;

  const refreshSessions = async () => {
    const list = await api.listSessions();
    setSessions(list);
    return list;
  };

  const loadMessages = async (id) => {
    if (!id) { setMsgs([]); return; }
    const data = await api.getMessages(id);
    setMsgs((data.messages || []).map((m) => ({ role: m.role, content: m.content, id: m.id })));
  };

  useEffect(() => {
    if (mode !== "planificar") return;
    const selectedIsPlan = sessions.some((s) => s.id === activeId && s.mode === "planificar");
    if (!selectedIsPlan) {
      setActiveId(sessions.find((s) => s.mode === "planificar")?.id || null);
    }
  }, [activeId, mode, sessions]);

  useEffect(() => {
    if (mode === "planificar" && active?.mode === "planificar") {
      loadMessages(activeId).catch((e) => setError(e.message));
    }
    if (mode === "consultar") setMsgs([]);
  }, [activeId, mode]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const ensureSession = async (desiredMode) => {
    if (desiredMode === "consultar") {
      let consult = sessions.find((s) => s.mode === "consultar");
      if (!consult) {
        consult = await api.createSession({ mode: "consultar", name: "Consultar plan" });
        await refreshSessions();
      }
      setActiveId(consult.id);
      return consult.id;
    }
    if (activeId) {
      const cur = sessions.find((s) => s.id === activeId);
      if (cur && cur.mode === "planificar") return activeId;
    }
    const plan = sessions.find((s) => s.mode === "planificar");
    if (plan) {
      setActiveId(plan.id);
      return plan.id;
    }
    const created = await api.createSession({ mode: "planificar" });
    await refreshSessions();
    setActiveId(created.id);
    return created.id;
  };

  const openNewSession = () => {
    setNameSheet({ kind: "create", name: "" });
  };

  const saveSessionName = async (name) => {
    setSessionBusy(true);
    setError(null);
    try {
      if (nameSheet?.kind === "create") {
        const s = await api.createSession({ mode: "planificar", name });
        await refreshSessions();
        setMode("planificar");
        setActiveId(s.id);
        setMsgs([]);
      } else if (nameSheet?.sessionId) {
        await api.renameSession(nameSheet.sessionId, name);
        await refreshSessions();
      }
      setNameSheet(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionBusy(false);
    }
  };

  const resetSession = async () => {
    if (!currentSession) return;
    if (!window.confirm(`¿Limpiar la memoria de “${currentSession.name}”?\n\nSe borrarán todos sus mensajes y el resumen de contexto. La sesión seguirá existiendo.`)) return;
    setSessionBusy(true);
    setError(null);
    try {
      await api.resetSession(currentSession.id);
      setMsgs([]);
      await refreshSessions();
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionBusy(false);
    }
  };

  const deleteCurrentSession = async () => {
    if (mode !== "planificar" || !currentSession || currentSession.mode !== "planificar") return;
    if (!window.confirm(`¿Eliminar “${currentSession.name}”?\n\nEsta acción borra la sesión y todos sus mensajes de forma permanente.`)) return;
    setSessionBusy(true);
    setError(null);
    try {
      await api.deleteSession(currentSession.id);
      const list = await refreshSessions();
      const next = list.find((s) => s.mode === "planificar") || null;
      setActiveId(next?.id || null);
      setMsgs([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionBusy(false);
    }
  };

  const openExport = async () => {
    const sid = currentSession?.id || (await ensureSession(mode));
    const payload = await api.exportSession(sid);
    setCopied(false);
    setExportText(JSON.stringify(payload, null, 2));
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
    } catch {
      const ta = document.getElementById("export-ta");
      if (ta) { ta.focus(); ta.select(); try { document.execCommand("copy"); setCopied(true); } catch { /* */ } }
    }
  };

  const downloadExport = () => {
    try {
      const blob = new Blob([exportText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nihon-planner-${(currentSession?.name || "sesion").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* */ }
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload.herramienta && !payload.tipo && !payload.sesion && !payload["jp:sessions"]) {
        throw new Error("JSON no parece un export de Nihon Planner");
      }
      const res = await api.importData(payload);
      const list = await refreshSessions();
      const importedId = payload.sesion?.id || payload.sesiones?.[0]?.id;
      const match = list.find((s) => s.id === importedId) || list.find((s) => s.mode === "planificar");
      if (match) {
        setMode("planificar");
        setActiveId(match.id);
        await loadMessages(match.id);
      }
      const n = res?.imported?.sessions ?? 0;
      if (!n && !match) throw new Error("No se importó ninguna sesión");
    } catch (err) {
      setError(err.message || "Error al importar");
    } finally {
      setImporting(false);
    }
  };

  const copyMessage = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgKey(key);
      setTimeout(() => setCopiedMsgKey((k) => (k === key ? null : k)), 1600);
    } catch {
      setError("No se pudo copiar al portapapeles");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const sid = await ensureSession(mode);
      const res = await api.chat(sid, text);
      setMsgs((m) => [...m, { role: "assistant", content: res.message.content, id: res.message.id }]);
      await refreshSessions();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const planSessions = sessions.filter((s) => s.mode === "planificar");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 190px)" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={{ ...S.chip, ...(mode === "planificar" ? S.chipOn : {}) }} onClick={() => setMode("planificar")}>Planificar</button>
        <button style={{ ...S.chip, ...(mode === "consultar" ? S.chipOn : {}) }} onClick={() => setMode("consultar")}>Consultar plan</button>
        <div style={{ flex: 1 }} />
        {mode === "planificar" && <button style={S.secondary} onClick={openNewSession}>+ Nueva sesión</button>}
        <button style={S.secondary} onClick={() => importRef.current?.click()} disabled={importing}>
          {importing ? "Importando…" : "Importar"}
        </button>
        <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onImportFile} />
        <button style={S.secondary} onClick={openExport}>Exportar</button>
      </div>

      {exportText !== null && (
        <div style={{ background: C.card, border: `1px solid ${C.accent}`, borderRadius: 14, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ ...S.label, marginBottom: 0 }}>Exportar JSON</span>
            <button style={S.ghost} onClick={() => setExportText(null)}>✕</button>
          </div>
          <textarea id="export-ta" readOnly value={exportText}
            style={{ ...S.input, height: 140, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            onFocus={(e) => e.target.select()} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={S.secondary} onClick={copyExport}>{copied ? "✓ Copiado" : "Copiar"}</button>
            <button style={S.secondary} onClick={downloadExport}>Descargar .json</button>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          padding: 8,
          marginBottom: 8,
          background: C.surfaceContainer,
          border: `1px solid ${C.outlineVariant}`,
          borderRadius: 12,
        }}
      >
        {mode === "planificar" ? (
          planSessions.length > 0 ? (
            <select
              aria-label="Sesión activa"
              style={{ ...S.input, flex: "1 1 220px", marginBottom: 0 }}
              value={currentSession?.id || ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {planSessions.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.message_count || 0} msj)</option>
              ))}
            </select>
          ) : (
            <span style={{ flex: 1, color: C.onSurfaceVariant, fontSize: 13 }}>Todavía no hay sesiones de planificación.</span>
          )
        ) : (
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ color: C.onSurface, fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentSession?.name || "Consultar plan"}
            </div>
            <div style={{ color: C.onSurfaceVariant, fontSize: 11 }}>
              {currentSession ? `${currentSession.message_count || 0} mensajes` : "La sesión se creará con tu primera consulta"}
            </div>
          </div>
        )}
        <button
          type="button"
          style={S.secondary}
          disabled={!currentSession || sessionBusy}
          onClick={() => setNameSheet({ kind: "rename", sessionId: currentSession.id, name: currentSession.name })}
        >
          Renombrar
        </button>
        <button type="button" style={S.secondary} disabled={!currentSession || sessionBusy} onClick={resetSession}>
          Limpiar memoria
        </button>
        {mode === "planificar" && (
          <button
            type="button"
            style={{ ...S.secondary, color: C.error, borderColor: C.error }}
            disabled={!currentSession || sessionBusy}
            onClick={deleteCurrentSession}
          >
            Eliminar
          </button>
        )}
      </div>

      {nameSheet && (
        <SessionNameSheet
          key={`${nameSheet.kind}-${nameSheet.sessionId || "new"}`}
          kind={nameSheet.kind}
          initialName={nameSheet.name}
          busy={sessionBusy}
          onSave={saveSessionName}
          onClose={() => !sessionBusy && setNameSheet(null)}
        />
      )}

      <div style={{ flex: 1, overflowY: "auto", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 12 }}>
        {msgs.length === 0 && (
          <Empty text={mode === "planificar"
            ? "Preguntame por rutas, itinerarios, JR Pass, Daikoku PA… La memoria queda en el server."
            : "Consultá sobre lo ya cargado: gastos, reservas, documentación. Respondo solo con tus datos."} />
        )}
        {msgs.map((m, i) => {
          const key = m.id ?? `${m.role}-${i}`;
          const isAssistant = m.role === "assistant";
          return (
            <div key={key} style={{ display: "flex", justifyContent: isAssistant ? "flex-start" : "flex-end", marginBottom: 10 }}>
              <div style={{
                maxWidth: "92%",
                position: "relative",
                padding: isAssistant ? "10px 14px 12px" : "10px 14px",
                borderRadius: isAssistant ? "16px 16px 16px 4px" : "16px 16px 4px 16px",
                fontSize: 14, lineHeight: 1.5,
                whiteSpace: isAssistant ? "normal" : "pre-wrap",
                background: isAssistant ? C.surfaceContainer : C.primary,
                color: isAssistant ? C.onSurface : C.onPrimary,
                border: isAssistant ? `1px solid ${C.outlineVariant}` : "none",
                boxShadow: C.elevation1,
              }}>
                {isAssistant && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4, marginTop: -2 }}>
                    <button
                      type="button"
                      onClick={() => copyMessage(key, m.content)}
                      title={copiedMsgKey === key ? "Copiado" : "Copiar respuesta"}
                      aria-label="Copiar respuesta del asistente"
                      style={{
                        ...S.ghost,
                        minHeight: 32,
                        minWidth: 32,
                        padding: 4,
                        color: copiedMsgKey === key ? C.primary : C.onSurfaceVariant,
                        opacity: 0.85,
                      }}
                    >
                      {copiedMsgKey === key ? (
                        <span style={{ fontSize: 12, fontWeight: 700 }}>✓</span>
                      ) : (
                        <CopyIcon size={15} />
                      )}
                    </button>
                  </div>
                )}
                {isAssistant
                  ? <Markdown content={m.content} C={C} />
                  : m.content}
              </div>
            </div>
          );
        })}
        {busy && <div style={{ color: C.soft, fontSize: 13, padding: 8 }}>考え中… pensando</div>}
        {error && <div style={S.warn}>Error: {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder={mode === "planificar" ? "¿Cuántos días en Kyoto?" : "¿Qué reservas me faltan confirmar?"}
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()} />
        <button style={{ ...S.primary, width: "auto", padding: "0 18px", marginTop: 0, minHeight: 44 }} onClick={send} disabled={busy}>➤</button>
      </div>
    </div>
  );
}

function SessionNameSheet({ kind, initialName, busy, onSave, onClose }) {
  const [name, setName] = useState(initialName || "");
  const inputRef = useRef(null);
  const isCreate = kind === "create";

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const submit = (event) => {
    event.preventDefault();
    const clean = name.trim();
    if (clean && !busy) onSave(clean);
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.58)",
        padding: "12px 12px 0",
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-name-title"
        onSubmit={submit}
        style={{
          width: "min(100%, 480px)",
          padding: "20px 18px max(20px, env(safe-area-inset-bottom))",
          background: C.surfaceContainer,
          border: `1px solid ${C.outlineVariant}`,
          borderRadius: "20px 20px 0 0",
          boxShadow: C.elevation2,
        }}
      >
        <div id="session-name-title" style={{ color: C.onSurface, fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          {isCreate ? "Nueva sesión" : "Renombrar sesión"}
        </div>
        <div style={{ color: C.onSurfaceVariant, fontSize: 13, lineHeight: 1.45, marginBottom: 16 }}>
          Usá un nombre que te permita reconocer rápidamente el tema de esta conversación.
        </div>
        <label style={{ ...S.label, display: "block" }} htmlFor="session-name-input">Nombre</label>
        <input
          ref={inputRef}
          id="session-name-input"
          style={{ ...S.input, marginBottom: 6 }}
          value={name}
          maxLength={80}
          placeholder="Ej. Itinerario Tokio y Kyoto"
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          required
        />
        <div style={{ color: C.onSurfaceVariant, fontSize: 11, textAlign: "right", marginBottom: 16 }}>
          {name.length}/80
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{ ...S.secondary, flex: 1 }} onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" style={{ ...S.primary, flex: 1, marginTop: 0 }} disabled={!name.trim() || busy}>
            {busy ? "Guardando…" : isCreate ? "Crear sesión" : "Guardar nombre"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ================= átomos ================= */
function Card({ children }) {
  return <div style={S.card}>{children}</div>;
}
function Row({ k, v, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: C.soft }}>{k}</span>
      <span style={{ fontWeight: 600, color: accent ? C.hanko : C.ink }}>{v}</span>
    </div>
  );
}
function Empty({ text }) {
  return <div style={{ color: C.soft, fontSize: 13, padding: "10px 0", lineHeight: 1.5 }}>{text}</div>;
}
function Meta({ children }) {
  return <div style={{ fontSize: 12, color: C.soft, marginTop: 2 }}>{children}</div>;
}
function AddInline({ placeholder, onAdd }) {
  const [v, setV] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onAdd(v.trim()); setV(""); } }} />
      <button style={{ ...S.secondary }} onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(""); } }}>+</button>
    </div>
  );
}

/* estilos: ver buildStyles() en theme.js */
