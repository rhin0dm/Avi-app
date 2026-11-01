// Single-owner authentication: one password from the server environment,
// a signed httpOnly session cookie. No user table to leak or manage.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "avi_session";
export const SESSION_DAYS = 14;

function secret(): string | null {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 32 ? s : null;
}

export function authConfigError(): string | null {
  if (!secret()) return "AUTH_SECRET must be set to a random string of at least 32 characters.";
  const p = process.env.AVI_OWNER_PASSWORD;
  if (!p || p.length < 12) return "AVI_OWNER_PASSWORD must be set (12+ characters).";
  return null;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (data: string, key: string) => createHmac("sha256", key).update(data).digest("base64url");

export function createSessionToken(now = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("AUTH_SECRET not configured");
  const payload = b64(JSON.stringify({ sub: "owner", exp: now + SESSION_DAYS * 86400_000 }));
  return `${payload}.${sign(payload, key)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp, sub } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return sub === "owner" && typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function checkPassword(candidate: string): boolean {
  const real = process.env.AVI_OWNER_PASSWORD;
  if (!real || typeof candidate !== "string") return false;
  const a = createHmac("sha256", "avi-pw").update(candidate).digest();
  const b = createHmac("sha256", "avi-pw").update(real).digest();
  return timingSafeEqual(a, b);
}
