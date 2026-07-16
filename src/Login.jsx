import { useEffect, useRef, useState } from "react";
import { C, fonts, radii } from "./theme";
import { api } from "./lib/apiClient";

/**
 * Login con Google Identity Services (ID token only, sin client secret).
 */
export default function Login({ onSuccess }) {
  const btnRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !btnRef.current) return;

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
        theme: "outline",
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
  }, [clientId, onSuccess]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at 20% 0%, ${C.accentSoft} 0%, transparent 50%), ${C.bgDeep}`,
        color: C.ink,
        fontFamily: fonts.body,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
        <div
          style={{
            width: 72,
            height: 72,
            margin: "0 auto 20px",
            borderRadius: "50%",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `2px solid ${C.line}`,
          }}
          aria-hidden
        >
          <div
            style={{
              width: 43,
              height: 43,
              borderRadius: "50%",
              background: C.hanko,
            }}
          />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, margin: "0 0 8px" }}>
          Nihon Planner
        </h1>
        <p style={{ color: C.soft, fontSize: 14, lineHeight: 1.5, marginBottom: 28 }}>
          Planificá el viaje a Japón. Entrá con Google — solo mails autorizados.
        </p>

        {!clientId && (
          <div
            style={{
              background: C.warnBg,
              color: C.danger,
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
          <p style={{ color: C.soft, fontSize: 13, marginTop: 16 }}>Verificando…</p>
        )}
        {error && (
          <div
            style={{
              background: C.warnBg,
              color: C.danger,
              padding: 12,
              borderRadius: radii.md,
              fontSize: 13,
              marginTop: 16,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
