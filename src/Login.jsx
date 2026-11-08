import { useEffect, useRef, useState } from "react";
import { C, radii } from "./theme";
import { api } from "./lib/apiClient";

/**
 * Login con Google Identity Services (ID token only, sin client secret).
 */
export default function Login({ onSuccess, themeMode = "light", onToggleTheme }) {
  const btnRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !btnRef.current) return;
    btnRef.current.innerHTML = "";

    const handleCredential = async (response) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.loginGoogle(response.credential);
        onSuccess(data.user);
      } catch (e) {
        setError(
          e.code === "EMAIL_NOT_ALLOWED"
            ? "Ese mail no está en la whitelist. Pedile a Emma que lo agregue en ALLOWED_EMAILS."
            : e.message || "No se pudo iniciar sesión",
        );
      } finally {
        setLoading(false);
      }
    };

    const init = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential,
        auto_select: false,
        ux_mode: "popup",
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: themeMode === "light" ? "outline" : "filled_black",
        size: "large",
        shape: "rectangular",
        text: "signin_with",
        width: 280,
      });
    };

    if (window.google?.accounts?.id) {
      init();
      return;
    }

    const existing = document.querySelector("script[data-gis]");
    if (existing) {
      existing.addEventListener("load", init);
      return () => existing.removeEventListener("load", init);
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.gis = "1";
    script.onload = init;
    document.head.appendChild(script);
  }, [clientId, onSuccess, themeMode]);

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-bg-sunken p-6 font-sans text-fg"
      style={{
        background: `radial-gradient(ellipse at 20% 0%, ${C.primaryContainer} 0%, transparent 50%), ${C.surfaceDim}`,
      }}
    >
      {onToggleTheme && (
        <button
          type="button"
          onClick={onToggleTheme}
          className="np-icon-btn absolute top-3 right-3"
          aria-label={themeMode === "light" ? "Tema oscuro" : "Tema claro"}
        >
          {themeMode === "light" ? "暗" : "明"}
        </button>
      )}
      <div className="w-full max-w-[360px] text-center">
        <div
          className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full border border-border bg-bg-elev shadow-np"
          aria-hidden
        >
          <div className="block h-[43px] w-[43px] rounded-full bg-accent" />
        </div>
        <h1 className="np-display mb-2 text-[28px] font-semibold tracking-tight">
          Nihon Planner
        </h1>
        <p className="mb-7 text-sm leading-relaxed text-fg-muted">
          Planificá el viaje a Japón. Entrá con Google — solo mails autorizados.
        </p>

        {!clientId && (
          <div
            style={{
              background: C.errorContainer,
              color: C.error,
              padding: 12,
              borderRadius: radii.md,
              fontSize: 13,
              marginBottom: 16,
              textAlign: "left",
            }}
          >
            Falta <code>VITE_GOOGLE_CLIENT_ID</code> en el entorno.
          </div>
        )}

        <div ref={btnRef} style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />

        {loading && (
          <p style={{ color: C.onSurfaceVariant, fontSize: 13, marginTop: 16 }}>Verificando…</p>
        )}
        {error && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                background: C.errorContainer,
                color: C.error,
                padding: 12,
                borderRadius: radii.md,
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
            <AngryKitty />
          </div>
        )}
      </div>
    </div>
  );
}

/** Gatito enojado kawaii — tonos muted al fondo dark/error */
function AngryKitty() {
  return (
    <div
      role="img"
      aria-label="Gatito enojado"
      style={{
        marginTop: 14,
        display: "flex",
        justifyContent: "center",
        opacity: 0.92,
      }}
    >
      <svg width="88" height="88" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* orejas */}
        <path d="M18 38 L28 8 L42 34 Z" fill="#3a3b40" stroke="#4a4b52" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M70 38 L60 8 L46 34 Z" fill="#3a3b40" stroke="#4a4b52" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M22 34 L28 16 L36 32 Z" fill="#5c3a3a" opacity="0.7" />
        <path d="M66 34 L60 16 L52 32 Z" fill="#5c3a3a" opacity="0.7" />
        {/* cabeza */}
        <ellipse cx="44" cy="52" rx="30" ry="26" fill="#3a3b40" stroke="#4a4b52" strokeWidth="1.5" />
        {/* mejillas enojadas */}
        <ellipse cx="26" cy="56" rx="6" ry="4" fill="#7a3f45" opacity="0.55" />
        <ellipse cx="62" cy="56" rx="6" ry="4" fill="#7a3f45" opacity="0.55" />
        {/* cejas enojadas */}
        <path d="M28 42 L40 46" stroke="#c45c5c" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M60 42 L48 46" stroke="#c45c5c" strokeWidth="2.2" strokeLinecap="round" />
        {/* ojos (＞＜) */}
        <path d="M30 50 L36 54 L30 58" stroke="#e8e6e3" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M58 50 L52 54 L58 58" stroke="#e8e6e3" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {/* hocico */}
        <ellipse cx="44" cy="60" rx="3" ry="2.2" fill="#6e4a4e" />
        {/* boca enfurruñada */}
        <path d="M38 66 Q44 62 50 66" stroke="#c45c5c" strokeWidth="2" strokeLinecap="round" fill="none" />
        {/* bigotes */}
        <path d="M14 54 H28" stroke="#5a5b62" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M12 58 H28" stroke="#5a5b62" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M60 54 H74" stroke="#5a5b62" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M60 58 H76" stroke="#5a5b62" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
