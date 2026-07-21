import { useState, useCallback, useEffect, useRef } from "react";
import { C, S } from "../theme";

/**
 * Modal de confirmación con brand Nihon (reemplaza window.confirm).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (busy) return;
      if (e.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.58)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        style={{
          width: "min(100%, 400px)",
          background: C.surfaceContainer,
          border: `1px solid ${C.outlineVariant}`,
          borderRadius: 16,
          padding: "20px 18px 16px",
          boxShadow: C.elevation2,
        }}
      >
        <div id="confirm-title" style={{ fontSize: 17, fontWeight: 800, color: C.onSurface, marginBottom: 8 }}>
          {title}
        </div>
        <div
          id="confirm-desc"
          style={{ fontSize: 14, color: C.onSurfaceVariant, lineHeight: 1.5, marginBottom: 18, whiteSpace: "pre-wrap" }}
        >
          {message}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={{ ...S.secondary, flex: 1, marginTop: 0 }}
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            style={{
              ...S.primary,
              flex: 1.2,
              marginTop: 0,
              ...(danger
                ? { background: C.error, color: C.onError || "#fff", boxShadow: "none" }
                : {}),
            }}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @returns {[askConfirm: (opts) => Promise<boolean>, confirmNode: JSX.Element|null]}
 */
export function useConfirmDialog() {
  const [cfg, setCfg] = useState(null);

  const askConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setCfg({
        title: options.title || "Confirmar",
        message: options.message || "",
        confirmLabel: options.confirmLabel || "Confirmar",
        cancelLabel: options.cancelLabel || "Cancelar",
        danger: !!options.danger,
        resolve,
      });
    });
  }, []);

  const node = cfg ? (
    <ConfirmDialog
      open
      title={cfg.title}
      message={cfg.message}
      confirmLabel={cfg.confirmLabel}
      cancelLabel={cfg.cancelLabel}
      danger={cfg.danger}
      onConfirm={() => {
        cfg.resolve(true);
        setCfg(null);
      }}
      onCancel={() => {
        cfg.resolve(false);
        setCfg(null);
      }}
    />
  ) : null;

  return [askConfirm, node];
}
