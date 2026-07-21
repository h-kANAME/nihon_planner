import { useMemo, useState } from "react";
import { C, S } from "../theme";

/**
 * Preview híbrida: corredor de ciudades + chips de días.
 * @param {{ days: Array<{ day_number: number, title?: string, base?: string, stay_label?: string }>, onOpenDay: (n: number) => void }} props
 */
export default function PlanPreview({ days = [], onOpenDay }) {
  const [cityFilter, setCityFilter] = useState(null);

  const corridor = useMemo(() => buildCorridor(days), [days]);
  const chips = useMemo(() => {
    if (!cityFilter) return days;
    const set = new Set(cityFilter.dayNumbers);
    return days.filter((d) => set.has(d.day_number));
  }, [days, cityFilter]);

  if (!days.length) {
    return (
      <div style={{ fontSize: 13, color: C.onSurfaceVariant, lineHeight: 1.45 }}>
        Todavía no hay itinerario. Importá o armá días en la solapa Plan.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 10 }}>
        Corredor del viaje · tocá una ciudad para filtrar días
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          overflowX: "auto",
          paddingBottom: 8,
          marginBottom: 12,
        }}
      >
        {corridor.map((seg, i) => {
          const active = cityFilter?.city === seg.city;
          return (
            <div key={`${seg.city}-${i}`} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {i > 0 && (
                <span style={{ color: C.line, padding: "0 6px", fontSize: 14 }} aria-hidden>
                  →
                </span>
              )}
              <button
                type="button"
                onClick={() => setCityFilter(active ? null : seg)}
                style={{
                  ...S.chip,
                  ...(active ? S.chipOn : {}),
                  whiteSpace: "nowrap",
                }}
              >
                {seg.city}
                <span style={{ opacity: 0.7, marginLeft: 4, fontSize: 11 }}>
                  D{seg.dayNumbers[0]}
                  {seg.dayNumbers.length > 1 ? `–${seg.dayNumbers[seg.dayNumbers.length - 1]}` : ""}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {cityFilter && (
        <button
          type="button"
          onClick={() => setCityFilter(null)}
          style={{ ...S.ghost, fontSize: 12, marginBottom: 8, padding: "4px 8px" }}
        >
          Ver todos los días
        </button>
      )}

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
        {chips.map((d) => (
          <button
            key={d.day_number}
            type="button"
            onClick={() => onOpenDay?.(d.day_number)}
            style={{
              flexShrink: 0,
              minWidth: 88,
              maxWidth: 140,
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${C.line}`,
              background: C.surface,
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 11, color: C.hanko, fontWeight: 700 }}>Día {d.day_number}</div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.ink,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {d.title || `Día ${d.day_number}`}
            </div>
            {(d.base || d.stay_label) && (
              <div style={{ fontSize: 11, color: C.soft, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.base || d.stay_label}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function cityKey(day) {
  const raw = (day.base || day.stay_label || "").trim();
  if (!raw) return null;
  const first = raw.split(/[—(–,\-/]/)[0].trim();
  const cleaned = first.replace(/\(.*?\)/g, "").trim();
  if (!cleaned || /^d[ií]a\s*\d+/i.test(cleaned)) return null;
  return cleaned;
}

function buildCorridor(days) {
  const out = [];
  for (const d of days) {
    const city = cityKey(d);
    if (!city) continue;
    const last = out[out.length - 1];
    if (last && last.city.toLowerCase() === city.toLowerCase()) {
      last.dayNumbers.push(d.day_number);
    } else {
      out.push({ city, dayNumbers: [d.day_number] });
    }
  }
  return out;
}
