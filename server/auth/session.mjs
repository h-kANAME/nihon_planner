import crypto from "node:crypto";

const COOKIE_NAME = "nihon_session";

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function obfuscateEmail(email) {
  if (!email || !email.includes("@")) return "***";
  const [user, domain] = email.split("@");
  const visible = user.slice(0, 1);
  return `${visible}***@${domain}`;
}

export function isEmailAllowed(email, allowedEmails) {
  if (!allowedEmails.length) return false;
  return allowedEmails.includes(String(email || "").trim().toLowerCase());
}

export function createSessionToken({ email, name, picture }, secret, days = 30) {
  const now = Date.now();
  return sign(
    {
      email: email.toLowerCase(),
      name: name || "",
      picture: picture || "",
      iat: now,
      exp: now + days * 24 * 60 * 60 * 1000,
    },
    secret,
  );
}

export function readSession(request, secret) {
  const raw = request.cookies?.[COOKIE_NAME];
  return verify(raw, secret);
}

export function setSessionCookie(reply, token, { secure, days = 30 }) {
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: !!secure,
    maxAge: days * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply, { secure }) {
  reply.clearCookie(COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: !!secure,
  });
}

export function authHook(config) {
  return async function requireAuth(request, reply) {
    const url = request.url.split("?")[0];
    const publicExact = new Set([
      "/health",
      "/api/v1/health",
      "/api/v1/auth/google",
      "/api/v1/auth/me",
      "/api/v1/auth/logout",
    ]);
    if (publicExact.has(url) || (request.method === "GET" && !url.startsWith("/api/"))) {
      return;
    }
    if (!url.startsWith("/api/")) return;

    const session = readSession(request, config.sessionSecret);
    if (!session) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Sesión requerida" } });
    }
    if (!isEmailAllowed(session.email, config.allowedEmails)) {
      clearSessionCookie(reply, { secure: config.cookieSecure });
      return reply.code(403).send({ error: { code: "EMAIL_NOT_ALLOWED", message: "Email no autorizado" } });
    }
    request.user = session;
  };
}

export { COOKIE_NAME };
