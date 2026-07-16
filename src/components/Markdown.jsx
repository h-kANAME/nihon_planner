/**
 * Render liviano de Markdown (sin deps) orientado a respuestas del LLM de viaje:
 * headings, bold, listas, hr, blockquotes, tablas GFM (también colapsadas en 1 línea), párrafos.
 */

/** Inline: **bold**, `code`, resto escapado */
function Inline({ text, color, muted, primary }) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  const src = String(text);
  while ((m = re.exec(src))) {
    if (m.index > last) {
      parts.push(<span key={`t${last}`}>{src.slice(last, m.index)}</span>);
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <strong key={`b${m.index}`} style={{ fontWeight: 700, color }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={`c${m.index}`}
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: "0.9em",
            background: muted,
            padding: "1px 5px",
            borderRadius: 4,
            color: primary,
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < src.length) parts.push(<span key={`t${last}`}>{src.slice(last)}</span>);
  return <>{parts}</>;
}

function isSepCell(c) {
  return /^:?-{3,}:?$/.test(String(c).trim());
}

/** Línea que parece fila de tabla GFM */
function isTableLine(t) {
  const s = String(t).trim();
  if (!s.includes("|")) return false;
  if (/^\|/.test(s) || /\|$/.test(s)) return true;
  return (s.match(/\|/g) || []).length >= 2;
}

function splitCells(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/**
 * Parsea filas multilínea o una sola línea colapsada
 * (cuando el join de párrafos convirtió `\n` en espacios: `| a | b | | --- | --- | | 1 | 2 |`).
 */
function parseTableRows(rawLines) {
  const joined = rawLines.map((l) => l.trim()).filter(Boolean);
  if (!joined.length) return null;

  const multi = joined.length > 1;
  let rows = [];

  if (multi) {
    rows = joined.map(splitCells);
  } else {
    let parts = joined[0].split("|").map((c) => c.trim());
    if (parts[0] === "") parts = parts.slice(1);
    if (parts[parts.length - 1] === "") parts = parts.slice(0, -1);
    // "" internos suelen ser frontera de fila al colapsar `| |`
    const sepIdx = parts.findIndex(isSepCell);
    if (sepIdx < 0) {
      // sin separador: intentar como filas multilínea fallidas → una sola fila
      const cells = parts.filter((c) => c !== "");
      if (cells.length < 2) return null;
      rows = [cells];
    } else {
      // header = celdas no vacías antes del primer separador
      const header = [];
      for (let i = 0; i < sepIdx; i++) {
        if (parts[i] !== "") header.push(parts[i]);
      }
      if (header.length < 1) return null;
      const ncol = header.length;
      rows.push(header);

      // consumir fila separadora
      let i = sepIdx;
      while (i < parts.length && (isSepCell(parts[i]) || parts[i] === "")) i += 1;

      // body: chunk por ncol, saltando vacíos de frontera de fila
      const body = [];
      while (i < parts.length) {
        if (parts[i] === "" && body.length === 0) {
          i += 1;
          continue;
        }
        if (parts[i] === "" && body.length === ncol) {
          rows.push(body.splice(0, ncol));
          i += 1;
          continue;
        }
        if (parts[i] === "" && body.length > 0 && body.length < ncol) {
          // celda vacía legítima
          body.push("");
          i += 1;
          continue;
        }
        if (parts[i] === "") {
          i += 1;
          continue;
        }
        body.push(parts[i]);
        i += 1;
        if (body.length === ncol) {
          rows.push(body.splice(0, ncol));
        }
      }
      if (body.length) rows.push(body);
    }
  }

  // filtrar filas que son solo separadores
  rows = rows.filter((r) => r.length && !r.every(isSepCell));
  if (rows.length < 1) return null;

  const ncol = Math.max(...rows.map((r) => r.length));
  if (ncol < 2 && rows.length < 2) return null;

  return rows.map((r) => {
    const padded = [...r];
    while (padded.length < ncol) padded.push("");
    return padded;
  });
}

function MdTable({ rows, C }) {
  const [header, ...body] = rows;
  const cellPad = "8px 10px";
  const border = `1px solid ${C.outlineVariant}`;

  return (
    <div
      style={{
        margin: "8px 0 14px",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        borderRadius: 10,
        border,
        background: C.surfaceContainer,
        maxWidth: "100%",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          minWidth: Math.min(header.length * 88, 520),
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left",
                  padding: cellPad,
                  fontWeight: 700,
                  color: C.onSurface,
                  background: C.surfaceContainerHigh,
                  borderBottom: border,
                  whiteSpace: "nowrap",
                  position: "sticky",
                  top: 0,
                }}
              >
                <Inline text={cell} color={C.onSurface} muted={C.surfaceDim} primary={C.primary} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr
              key={ri}
              style={{
                background: ri % 2 === 1 ? C.surfaceContainerHigh : "transparent",
              }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: cellPad,
                    color: C.onSurface,
                    borderBottom: ri < body.length - 1 ? border : "none",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Inline text={cell} color={C.onSurface} muted={C.surfaceContainerHigh} primary={C.primary} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * @param {{ content: string, C: object }} props
 */
export default function Markdown({ content, C }) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  let key = 0;

  const pushPara = (buf) => {
    const t = buf.join(" ").trim();
    if (!t) return;
    // tabla colapsada en un solo "párrafo"
    if (isTableLine(t) && (t.includes("---") || (t.match(/\|/g) || []).length >= 4)) {
      const rows = parseTableRows([t]);
      if (rows && rows.length >= 2) {
        blocks.push(<MdTable key={key++} rows={rows} C={C} />);
        return;
      }
    }
    blocks.push(
      <p key={key++} style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        <Inline text={t} color={C.onSurface} muted={C.surfaceContainerHigh} primary={C.primary} />
      </p>,
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push(
        <hr
          key={key++}
          style={{
            border: "none",
            borderTop: `1px solid ${C.outlineVariant}`,
            margin: "12px 0",
          }}
        />,
      );
      i += 1;
      continue;
    }

    // Tabla GFM (filas consecutivas con |)
    if (isTableLine(trimmed)) {
      const raw = [];
      while (i < lines.length && isTableLine(lines[i].trim())) {
        raw.push(lines[i].trim());
        i += 1;
      }
      // permitir línea en blanco entre filas? no en GFM estricto
      const rows = parseTableRows(raw);
      if (rows && rows.length >= 1) {
        blocks.push(<MdTable key={key++} rows={rows} C={C} />);
        continue;
      }
      // fallback: no era tabla
      pushPara(raw);
      continue;
    }

    const h = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 18 : level === 2 ? 16 : 15;
      blocks.push(
        <div
          key={key++}
          style={{
            fontSize: size,
            fontWeight: 700,
            margin: "14px 0 8px",
            color: C.onSurface,
            letterSpacing: -0.2,
            lineHeight: 1.3,
          }}
        >
          <Inline text={h[2]} color={C.onSurface} muted={C.surfaceContainerHigh} primary={C.primary} />
        </div>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const q = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        q.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={key++}
          style={{
            margin: "8px 0 12px",
            padding: "8px 12px",
            borderLeft: `3px solid ${C.primary}`,
            background: C.primaryContainer,
            color: C.onPrimaryContainer,
            borderRadius: "0 8px 8px 0",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <Inline text={q.join(" ")} color={C.onPrimaryContainer} muted={C.surfaceDim} primary={C.primary} />
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const items = [];
      const ordered = /^\d+\./.test(trimmed);
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = ordered ? /^(\d+)\.\s+(.+)$/.exec(t) : /^[-*]\s+(.+)$/.exec(t);
        if (!m) break;
        items.push(ordered ? m[2] : m[1]);
        i += 1;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag
          key={key++}
          style={{
            margin: "4px 0 12px",
            paddingLeft: 22,
            lineHeight: 1.55,
          }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>
              <Inline text={it} color={C.onSurface} muted={C.surfaceContainerHigh} primary={C.primary} />
            </li>
          ))}
        </Tag>,
      );
      continue;
    }

    const buf = [trimmed];
    i += 1;
    while (i < lines.length) {
      const n = lines[i].trim();
      if (
        !n ||
        /^#{1,3}\s/.test(n) ||
        /^[-*]\s+/.test(n) ||
        /^\d+\.\s+/.test(n) ||
        n.startsWith("> ") ||
        /^---+$/.test(n) ||
        isTableLine(n)
      ) {
        break;
      }
      buf.push(n);
      i += 1;
    }
    pushPara(buf);
  }

  if (!blocks.length) {
    return <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>;
  }

  return <div style={{ fontSize: 14 }}>{blocks}</div>;
}
