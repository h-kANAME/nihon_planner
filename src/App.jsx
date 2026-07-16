import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { storage, setStorageMode } from "./lib/storage";
import { api } from "./lib/apiClient";
import { C, fonts } from "./theme";
import Login from "./Login.jsx";

/* ============================================================
   NIHON PLANNER — Viaje a Japón (20 días, pareja, ARS/USD/JPY)
   Tokens visuales: kyz.com.ar (dark + accent) + hinomaru.
   ============================================================ */

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
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState("resumen");
  const [ready, setReady] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [logistics, setLogistics] = useState({ flights: [], stays: [], bookings: [], docs: DEFAULT_DOCS });
  const [rates, setRates] = useState({ usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null });
  const [sessions, setSessions] = useState([]);

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
        <div style={{ color: C.soft, fontSize: 14, letterSpacing: 2 }}>準備中 · cargando…</div>
      </div>
    );
  }

  if (!user) {
    return <Login onSuccess={(u) => { setStorageMode(true); setUser(u); }} />;
  }

  if (!ready) {
    return (
      <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: C.soft, fontSize: 14, letterSpacing: 2 }}>準備中 · cargando…</div>
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={S.ghost} onClick={logout} title={user.email}>salir</button>
          <div style={S.stamp} title="Hinomaru">
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

      <nav style={S.nav}>
        {[
          ["resumen", "概", "Resumen"],
          ["gastos", "費", "Gastos"],
          ["conversor", "両", "Conversor"],
          ["plan", "旅", "Plan"],
          ["ai", "助", "AI"],
        ].map(([id, kanji, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ ...S.navBtn, color: tab === id ? C.accent : C.soft }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{kanji}</span>
            <span style={{ fontSize: 10, letterSpacing: 0.5 }}>{label}</span>
          </button>
        ))}
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

/* ================= PLAN / LOGÍSTICA ================= */
const fmtDT = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function Plan({ logistics, setLogistics }) {
  const [section, setSection] = useState("docs");
  const upd = (patch) => setLogistics({ ...logistics, ...patch });
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["docs", "Documentación"], ["flights", "Vuelos"], ["stays", "Alojamiento"], ["bookings", "Reservas"]].map(([id, l]) => (
          <button key={id} onClick={() => setSection(id)} style={{ ...S.chip, ...(section === id ? S.chipOn : {}) }}>{l}</button>
        ))}
      </div>

      {section === "docs" && (
        <Card>
          <div style={S.label}>Checklist de documentación</div>
          {logistics.docs.map((d) => (
            <DocItem key={d.id} doc={d}
              onToggle={() => upd({ docs: logistics.docs.map((x) => (x.id === d.id ? { ...x, done: !x.done } : x)) })}
              onEdit={(label) => upd({ docs: logistics.docs.map((x) => (x.id === d.id ? { ...x, label } : x)) })}
              onDelete={() => upd({ docs: logistics.docs.filter((x) => x.id !== d.id) })} />
          ))}
          <AddInline placeholder="Agregar ítem…" onAdd={(t) => upd({ docs: [...logistics.docs, { id: uid(), label: t, done: false }] })} />
        </Card>
      )}

      {section === "flights" && (
        <ListSection title="Vuelos y traslados internos" items={logistics.flights}
          fields={[["route", "Ruta (EZE → NRT)", "text"], ["datetime", "Fecha y hora de salida", "datetime"], ["code", "Aerolínea / código", "text"]]}
          onChange={(items) => upd({ flights: items })} />
      )}

      {section === "stays" && (
        <ListSection title="Alojamiento por ciudad" items={logistics.stays}
          fields={[["city", "Ciudad (Tokyo, Kyoto…)", "text"], ["name", "Hotel / Airbnb", "text"], ["checkin", "Check-in", "datetime"], ["checkout", "Check-out", "datetime"]]}
          onChange={(items) => upd({ stays: items })} />
      )}

      {section === "bookings" && (
        <ListSection title="Actividades y reservas" items={logistics.bookings}
          fields={[["name", "Actividad (Ghibli, TeamLab, Daikoku tour…)", "text"], ["datetime", "Fecha y hora", "datetime"]]}
          onChange={(items) => upd({ bookings: items })} />
      )}
    </div>
  );
}

function DocItem({ doc, onToggle, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(doc.label);
  const saveEdit = () => { if (v.trim()) onEdit(v.trim()); setEditing(false); };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
      <input type="checkbox" checked={doc.done} style={{ accentColor: C.hanko, marginTop: 3, cursor: "pointer" }} onChange={onToggle} />
      {editing ? (
        <input autoFocus style={{ ...S.input, flex: 1, marginBottom: 0, padding: "6px 8px" }} value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
          onBlur={saveEdit} />
      ) : (
        <span style={{ flex: 1, fontSize: 14, textDecoration: doc.done ? "line-through" : "none", color: doc.done ? C.soft : C.ink }}>{doc.label}</span>
      )}
      <button style={S.ghost} title="Editar" onClick={() => { setV(doc.label); setEditing(true); }}>✎</button>
      <button style={S.ghost} title="Eliminar" onClick={onDelete}>✕</button>
    </div>
  );
}

function ListSection({ title, items, fields, onChange }) {
  const empty = Object.fromEntries(fields.map(([k]) => [k, ""]));
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const formRef = useRef(null);

  const submit = () => {
    if (!fields.some(([k]) => (form[k] || "").trim())) return;
    if (editId) {
      onChange(items.map((x) => (x.id === editId ? { ...x, ...form } : x)));
      setEditId(null);
    } else {
      onChange([...items, { id: uid(), ...form, done: false }]);
    }
    setForm(empty);
  };
  const startEdit = (it) => {
    setEditId(it.id);
    setForm(Object.fromEntries(fields.map(([k]) => [k, it[k] || ""])));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const cancelEdit = () => { setEditId(null); setForm(empty); };

  return (
    <Card>
      <div style={S.label}>{title}</div>
      {items.length === 0 && <Empty text="Nada cargado todavía." />}
      {items.map((it) => {
        const [pk] = fields[0];
        const metaParts = fields.slice(1)
          .map(([k, ph, type]) => (it[k] ? (type === "datetime" ? `${ph}: ${fmtDT(it[k])}` : it[k]) : null))
          .filter(Boolean);
        return (
          <div key={it.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            padding: "10px 0", borderBottom: `1px solid ${C.line}`,
            opacity: editId === it.id ? 0.5 : 1,
          }}>
            <div style={{ fontSize: 14 }}>
              <b style={{ textDecoration: it.done ? "line-through" : "none", color: it.done ? C.soft : C.ink }}>{it[pk] || "(sin título)"}</b>
              {it.done && <span style={{ marginLeft: 6, fontSize: 11, color: C.matcha, fontWeight: 700 }}>✓ realizado</span>}
              {metaParts.length > 0 && <Meta>{metaParts.join(" · ")}</Meta>}
            </div>
            <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
              <button style={{ ...S.ghost, color: it.done ? C.matcha : C.soft }} title={it.done ? "Marcar pendiente" : "Marcar realizado"}
                onClick={() => onChange(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}>
                {it.done ? "✓" : "○"}
              </button>
              <button style={S.ghost} title="Editar" onClick={() => startEdit(it)}>✎</button>
              <button style={S.ghost} title="Eliminar" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>✕</button>
            </div>
          </div>
        );
      })}

      <div style={{ marginTop: 12 }} ref={formRef}>
        {editId && <div style={{ fontSize: 12, color: C.hanko, marginBottom: 6, fontWeight: 600 }}>Editando ítem — guardá o cancelá</div>}
        {fields.map(([k, ph, type]) => (
          <div key={k}>
            {type === "datetime" && <div style={{ fontSize: 11, color: C.soft, margin: "2px 0 3px" }}>{ph}</div>}
            <input style={S.input} type={type === "datetime" ? "datetime-local" : "text"} placeholder={ph}
              value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...S.primary, flex: 1 }} onClick={submit}>{editId ? "Guardar cambios" : "Agregar"}</button>
          {editId && <button style={{ ...S.secondary, marginTop: 4 }} onClick={cancelEdit}>Cancelar</button>}
        </div>
      </div>
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
  const [importing, setImporting] = useState(false);
  const bottomRef = useRef(null);
  const importRef = useRef(null);

  const active = sessions.find((s) => s.id === activeId) || null;

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
    if (mode === "planificar" && activeId) loadMessages(activeId).catch((e) => setError(e.message));
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

  const newSession = async () => {
    const s = await api.createSession({ mode: "planificar" });
    await refreshSessions();
    setActiveId(s.id);
    setMsgs([]);
  };

  const resetSession = async () => {
    const sid = await ensureSession(mode);
    await api.resetSession(sid);
    setMsgs([]);
    await refreshSessions();
  };

  const openExport = async () => {
    const sid = activeId || (await ensureSession(mode));
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
      a.download = `nihon-planner-${(active?.name || "sesion").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
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
        {mode === "planificar" && <button style={S.secondary} onClick={newSession}>+ Sesión</button>}
        <button style={S.secondary} onClick={() => importRef.current?.click()} disabled={importing}>
          {importing ? "Importando…" : "Importar"}
        </button>
        <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onImportFile} />
        <button style={S.secondary} onClick={openExport}>Exportar</button>
        <button style={S.secondary} onClick={resetSession}>Reset</button>
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

      {mode === "planificar" && planSessions.length > 0 && (
        <select style={{ ...S.input, marginBottom: 8 }} value={activeId || ""} onChange={(e) => setActiveId(e.target.value)}>
          {planSessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.message_count || 0} msj)</option>
          ))}
        </select>
      )}

      <div style={{ flex: 1, overflowY: "auto", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 12 }}>
        {msgs.length === 0 && (
          <Empty text={mode === "planificar"
            ? "Preguntame por rutas, itinerarios, JR Pass, Daikoku PA… La memoria queda en el server."
            : "Consultá sobre lo ya cargado: gastos, reservas, documentación. Respondo solo con tus datos."} />
        )}
        {msgs.map((m, i) => (
          <div key={m.id || i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
            <div style={{
              maxWidth: "85%", padding: "10px 12px", borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap",
              background: m.role === "user" ? C.accentDim : C.bgDeep,
              color: m.role === "user" ? "#fff" : C.ink,
              border: m.role === "user" ? "none" : `1px solid ${C.line}`,
            }}>{m.content}</div>
          </div>
        ))}
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

/* ================= átomos ================= */
function Card({ children }) {
  return <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>{children}</div>;
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

/* ================= estilos ================= */
const S = {
  app: {
    minHeight: "100vh",
    background: `radial-gradient(ellipse at 80% -10%, ${C.accentSoft} 0%, transparent 45%), ${C.bg}`,
    color: C.ink,
    fontFamily: fonts.body,
    maxWidth: 520, margin: "0 auto", paddingBottom: 76,
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "18px 16px 10px",
  },
  eyebrow: { fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", color: C.matcha },
  title: { margin: "2px 0 0", fontSize: 24, fontWeight: 800, letterSpacing: -0.5 },
  stamp: {
    width: 44, height: 44, borderRadius: "50%", background: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    border: `1px solid ${C.line}`,
  },
  hinomaru: {
    width: 26, height: 26, borderRadius: "50%", background: C.hanko, display: "block",
  },
  main: { padding: "4px 16px" },
  nav: {
    position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
    width: "100%", maxWidth: 520, display: "flex",
    background: C.card, borderTop: `1px solid ${C.line}`, padding: "8px 0 12px",
  },
  navBtn: { flex: 1, background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer", padding: 4, minHeight: 44 },
  label: { fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.matcha, marginBottom: 10 },
  input: {
    width: "100%", boxSizing: "border-box", padding: "11px 12px", fontSize: 14,
    border: `1px solid ${C.line}`, borderRadius: 10, background: C.inputBg, color: C.ink, marginBottom: 8, outline: "none",
  },
  primary: {
    width: "100%", padding: "12px", background: C.accentDim, color: "#fff", border: "none",
    borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 4, minHeight: 44,
  },
  secondary: {
    padding: "8px 12px", background: "transparent", color: C.accent, border: `1px solid ${C.accent}`,
    borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 44,
  },
  ghost: { background: "none", border: "none", color: C.soft, cursor: "pointer", fontSize: 14, padding: 4, minHeight: 44, minWidth: 44 },
  chip: {
    padding: "7px 12px", borderRadius: 3, border: `1px solid ${C.line}`, background: C.card,
    fontSize: 12, cursor: "pointer", color: C.ink, minHeight: 44,
  },
  chipOn: { background: C.accentSoft, color: C.accent, borderColor: C.accent },
  warn: {
    background: C.warnBg, border: `1px solid ${C.danger}`, color: C.danger,
    fontSize: 12, padding: "8px 10px", borderRadius: 8, marginBottom: 10, lineHeight: 1.4,
  },
};
