import { secretsMatch } from "@/lib/cron-auth";

/**
 * Auth for `POST /api/clips` (PLAN.md §5.O2.1).
 *
 * Two ways in, because the route has two callers with nothing in common:
 * the app itself (a signed-in browser, session cookie) and a phone share
 * sheet or iOS Shortcut, which has no cookie and never will —
 * `Authorization: Bearer <CLIP_TOKEN>`.
 *
 * The token is a bearer credential for capture only: it can save a link and
 * nothing else. It is still the owner's secret, so treat a token request as
 * the owner acting — capture is the one thing that must work in three seconds
 * on a lock screen, and a second factor there means the clip is not saved.
 */

export const CLIP_TOKEN_ENV = "CLIP_TOKEN";

export type ClipAuthResult =
  { ok: true; via: "token" } | { ok: false; status: 401 | 503; error: string };

/** The Bearer token presented, if any. */
export function presentedClipToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const [scheme, ...rest] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token || null;
}

/**
 * Check a Bearer credential. Returns `ok: false` with no verdict on the
 * cookie path — the route falls back to `getSession()` when this says 401 and
 * no token was presented at all.
 *
 * An unset `CLIP_TOKEN` is 503, not 401: it is a misconfiguration, and
 * answering "unauthorized" would send someone hunting for a wrong token when
 * the deployment simply has none (§4.5 — degrade with a clear message).
 */
export function authorizeClipToken(headers: Headers): ClipAuthResult {
  const expected = process.env[CLIP_TOKEN_ENV];
  const presented = presentedClipToken(headers);

  if (!expected) {
    return {
      ok: false,
      status: 503,
      error:
        `${CLIP_TOKEN_ENV} is not set on this deployment, so the share-sheet path is disabled. ` +
        "Saving from a signed-in browser still works.",
    };
  }

  // Compared even when nothing was presented, so "no header" and "wrong token"
  // cost the same — the same reasoning as cron-auth's constant-time check.
  if (!secretsMatch(presented ?? "", expected) || presented === null) {
    return { ok: false, status: 401, error: "Invalid or missing clip token." };
  }

  return { ok: true, via: "token" };
}
