import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared-secret auth for `/api/cron/poll` (PLAN.md §5, PR-14).
 *
 * This is the app's only authenticated surface. Everything else sits behind
 * HTTP basic auth configured at the Hostinger level (PLAN.md §0 — no login
 * screen in v1); the cron endpoint cannot, because Hostinger's cron hits it
 * with a header, not a browser.
 */

export const CRON_SECRET_HEADER = "x-cron-secret";

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string };

/**
 * Constant-time comparison of two secrets.
 *
 * `===` on strings short-circuits at the first differing byte, which leaks the
 * length of the matching prefix to anyone who can time the response — enough to
 * recover a secret byte by byte. Hashing first gives `timingSafeEqual` two
 * equal-length inputs (it throws otherwise, and the throw would itself leak the
 * secret's length).
 */
export function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** `x-cron-secret: <secret>`, or `Authorization: Bearer <secret>`. */
export function presentedSecret(headers: Headers): string | null {
  const direct = headers.get(CRON_SECRET_HEADER);
  if (direct) return direct;

  const authorization = headers.get("authorization");
  if (authorization) {
    const [scheme, ...rest] = authorization.split(" ");
    if (scheme?.toLowerCase() === "bearer" && rest.length > 0) {
      const token = rest.join(" ").trim();
      if (token) return token;
    }
  }
  return null;
}

export function authorizeCronRequest(headers: Headers): CronAuthResult {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Misconfiguration, not a failed credential. Never fall open: an unset
    // secret must not mean "anyone may trigger a run that spends money".
    return {
      ok: false,
      status: 503,
      error: "CRON_SECRET is not set on this deployment; the poll endpoint is disabled.",
    };
  }

  const presented = presentedSecret(headers);
  // Compare even when nothing was presented, so the "no header" and "wrong
  // secret" paths cost the same.
  if (!secretsMatch(presented ?? "", expected) || presented === null) {
    return { ok: false, status: 401, error: "Invalid or missing cron secret." };
  }

  return { ok: true };
}
