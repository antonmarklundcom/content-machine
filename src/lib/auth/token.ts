/**
 * Session tokens (PLAN.md §9 PR-23).
 *
 * Stateless and signed rather than a row in a sessions table: §9's pre-approved
 * schema changes are `password_hash` and the role enum, and a sessions table is
 * neither. A signed token also lets middleware decide on every request without
 * a database round trip, which matters on Hostinger's single MySQL user.
 *
 * The cost of statelessness is that a token cannot be revoked before it expires.
 * For a single-user private tool that is an acceptable trade; rotating
 * SESSION_SECRET invalidates every token at once, which is the escape hatch.
 *
 * Web Crypto, not node:crypto, because middleware runs on the edge runtime
 * where the node module does not exist.
 */

export const SESSION_COOKIE = "yt_session";

/** 30 days. Long enough that a private research tool never nags; short enough to expire. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionPayload = { userId: number; expiresAt: number };

function base64url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function createSessionToken(
  userId: number,
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const body = `${userId}.${now + SESSION_TTL_MS}`;
  return `${body}.${await sign(body, secret)}`;
}

/**
 * Returns null for anything that is not a currently-valid token — malformed,
 * tampered with, signed by another secret, or expired. The caller never learns
 * which, because the difference is only useful to someone probing.
 */
export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<SessionPayload | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawUserId, rawExpiry, signature] = parts as [string, string, string];

  const expected = await sign(`${rawUserId}.${rawExpiry}`, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  const userId = Number(rawUserId);
  const expiresAt = Number(rawExpiry);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return { userId, expiresAt };
}

/**
 * Constant-time comparison of two same-purpose strings.
 *
 * `a === b` on a signature leaks its prefix through timing, one byte at a time.
 * The length check leaks only the length, which is fixed for a given hash.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
