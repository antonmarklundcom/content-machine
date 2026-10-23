import { createHash } from "node:crypto";
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_ACCOUNT_LIMIT = 8;
export const LOGIN_GLOBAL_LIMIT = 120;
export const LOGIN_ATTEMPT_PREFIX = "auth:attempt:";
export function loginAttemptKey(email: string): string {
  return (
    LOGIN_ATTEMPT_PREFIX +
    createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 51)
  );
}
type Attempt = { started: number; count: number };
export function nextLoginAttempt(value: unknown, now: number): Attempt {
  const row = value as Partial<Attempt> | null;
  if (
    !row ||
    !Number.isFinite(row.started) ||
    !Number.isInteger(row.count) ||
    row.count! < 0 ||
    now - row.started! >= LOGIN_WINDOW_MS ||
    row.started! > now
  )
    return { started: now, count: 1 };
  return { started: row.started!, count: row.count! + 1 };
}
