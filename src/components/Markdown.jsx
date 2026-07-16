/**
 * Render liviano de Markdown (sin deps) orientado a respuestas del LLM de viaje:
 * headings, bold, listas, hr, blockquotes, párrafos.
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
        /^---+$/.test(n)
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
