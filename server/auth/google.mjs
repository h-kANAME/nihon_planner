import { OAuth2Client } from "google-auth-library";

export async function verifyGoogleIdToken(credential, clientId) {
  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: clientId,
  });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("Token sin payload");
  if (!payload.email_verified) {
    const err = new Error("Email no verificado");
    err.code = "EMAIL_NOT_VERIFIED";
    throw err;
  }
  return {
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || "",
  };
}
