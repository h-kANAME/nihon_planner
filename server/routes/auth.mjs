import {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  isEmailAllowed,
  obfuscateEmail,
  readSession,
} from "../auth/session.mjs";
import { verifyGoogleIdToken } from "../auth/google.mjs";
import { sendError } from "../helpers.mjs";

export async function authRoutes(app, { config }) {
  app.post("/api/v1/auth/google", async (request, reply) => {
    const { credential } = request.body || {};
    if (!credential) {
      return sendError(reply, 400, "VALIDATION", "Falta credential");
    }
    let profile;
    try {
      profile = await verifyGoogleIdToken(credential, config.googleClientId);
    } catch (e) {
      request.log.warn({ err: e.message }, "Google token inválido");
      return sendError(reply, 401, "INVALID_TOKEN", "Token de Google inválido");
    }

    if (!isEmailAllowed(profile.email, config.allowedEmails)) {
      request.log.info(
        { email: obfuscateEmail(profile.email) },
        "Login rechazado: email fuera de whitelist",
      );
      return sendError(reply, 403, "EMAIL_NOT_ALLOWED", "Email no autorizado");
    }

    const token = createSessionToken(profile, config.sessionSecret, config.sessionDays);
    setSessionCookie(reply, token, { secure: config.cookieSecure, days: config.sessionDays });
    return {
      user: {
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      },
    };
  });

  app.post("/api/v1/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply, { secure: config.cookieSecure });
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const session = readSession(request, config.sessionSecret);
    if (!session || !isEmailAllowed(session.email, config.allowedEmails)) {
      return sendError(reply, 401, "UNAUTHORIZED", "Sin sesión");
    }
    return {
      user: {
        email: session.email,
        name: session.name,
        picture: session.picture,
      },
    };
  });
}
