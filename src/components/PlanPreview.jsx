import { useMemo, useState } from "react";
import { C, S } from "../theme";
import { useIsDesktop } from "../lib/viewport";

/**
 * Preview híbrida: corredor de ciudades + chips de días.
 * @param {{ days: Array<{ day_number: number, title?: string, base?: string, stay_label?: string }>, onOpenDay: (n: number) => void }} props
 */
export default function PlanPreview({ days = [], onOpenDay }) {
  const isDesktop = useIsDesktop();
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
    <div className="np-plan-preview" style={{ width: "100%", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 10 }}>
        Corredor del viaje · tocá una ciudad para filtrar días
      </div>
      <div className="np-plan-preview-corridor" role="list">
        {corridor.map((seg, i) => {
          const active = cityFilter?.city === seg.city;
          return (
            <div key={`${seg.city}-${i}`} className="np-plan-preview-corridor-item" role="listitem">
              {i > 0 && (
                <span className="np-plan-preview-arrow" aria-hidden>
                  →
                </span>
              )}
              <button
                type="button"
                title={seg.city}
                onClick={() => setCityFilter(active ? null : seg)}
                className={active ? "np-plan-preview-chip is-active" : "np-plan-preview-chip"}
                style={{
                  ...S.chip,
                  ...(active ? S.chipOn : {}),
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

      <div
        className={isDesktop ? "np-plan-preview-days" : "np-plan-preview-days is-mobile"}
        role="list"
      >
        {chips.map((d) => (
          <button
            key={d.day_number}
            type="button"
            role="listitem"
            onClick={() => onOpenDay?.(d.day_number)}
            className="np-plan-preview-day"
          >
            <div className="np-plan-preview-day-label">Día {d.day_number}</div>
            <div className="np-plan-preview-day-title">{d.title || `Día ${d.day_number}`}</div>
            {(d.base || d.stay_label) && (
              <div className="np-plan-preview-day-meta">{d.base || d.stay_label}</div>
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
