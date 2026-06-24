/** Single-admin local auth (the fallback for standalone use, and what an
 *  OpenMasjidOS SSO sign-in is minted into). The admin account is created in-app on
 *  first run (no install-time password). The password is stored as a scrypt hash in
 *  the data volume (see store.ts); the session is a signed, HTTP-only cookie whose
 *  payload carries an expiry + an audience claim. No external crypto dependency. */
import crypto from 'node:crypto';

export const COOKIE = 'omdon_session';
/** A password login lasts 30 days; an SSO-minted session is capped short (1h) so a
 *  stale platform session can't linger here after a dashboard logout. */
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const SSO_SESSION_MS = 60 * 60 * 1000;

export interface Cred {
  hash: string;
  salt: string;
}

export function hashPassword(password: string): Cred {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, 32);
  return { hash: dk.toString('hex'), salt: salt.toString('hex') };
}

export function verifyPassword(password: string, cred: Cred): boolean {
  try {
    const dk = crypto.scryptSync(password, Buffer.from(cred.salt, 'hex'), 32);
    const stored = Buffer.from(cred.hash, 'hex');
    return stored.length === dk.length && crypto.timingSafeEqual(stored, dk);
  } catch {
    return false;
  }
}

function hmac(secret: Buffer, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

type Audience = 'admin';

export function makeToken(secret: Buffer, maxAgeMs = MAX_AGE_MS, aud: Audience = 'admin'): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + maxAgeMs, aud })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

/** Verify signature, expiry AND audience (constant-time on the signature). */
export function verifyToken(secret: Buffer, token: string | undefined, aud: Audience = 'admin'): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(secret, payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number; aud?: string };
    return typeof obj.exp === 'number' && obj.exp > Date.now() && obj.aud === aud;
  } catch {
    return false;
  }
}

/** Cookie options for @fastify/cookie's setCookie. HTTP-only + SameSite=Lax + Path=/.
 *  Not `Secure` — the masjid LAN is usually plain HTTP; the platform note says to
 *  flip this on (and require HTTPS) only if ever run cross-host. */
export function cookieOptions(maxAgeMs = MAX_AGE_MS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}
