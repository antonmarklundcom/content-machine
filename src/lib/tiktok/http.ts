import {
  parseJsonText,
  ProviderApiError,
  realFetch,
  send,
  type HttpFetch,
} from "@/lib/publish/provider-error";

import { TIKTOK_API } from "./config";

/**
 * The one door to TikTok's open API (build 4 §3.F). Every answer is
 * `{ data, error: { code, message, log_id } }`; `code: "ok"` is success. The
 * token endpoint answers `{ error, error_description }` instead.
 */

let defaultFetch: HttpFetch = realFetch;

export function setTikTokFetch(f: HttpFetch | null): void {
  defaultFetch = f ?? realFetch;
}

export function tiktokFetch(): HttpFetch {
  return defaultFetch;
}

const AUTH_CODES = new Set([
  "access_token_invalid",
  "invalid_grant",
  "token_expired",
  "scope_not_authorized",
  "scope_permission_missed",
]);
const TRANSIENT_CODES = new Set(["rate_limit_exceeded", "internal_error"]);

export function tiktokError(status: number, code: string | null, message: string, logId?: string) {
  const auth = status === 401 || (code !== null && AUTH_CODES.has(code));
  const transient =
    status === 0 || status >= 500 || status === 429 || (code !== null && TRANSIENT_CODES.has(code));
  const text = `${code ? `${code}: ` : ""}${message || `TikTok answered ${status}.`}${logId ? ` (log ${logId})` : ""}`;
  return new ProviderApiError(text.slice(0, 500), "tiktok", status, code, auth, transient);
}

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string } | string;
  error_description?: string;
  log_id?: string;
};

/**
 * TikTok post ids are int64 (`7301234567890123456`), past what a JS number
 * holds: quote long integers inside `publicaly_available_post_id` before
 * parsing, so the id survives digit for digit.
 */
export function quoteLongIds(text: string): string {
  return text.replace(
    /("publicaly_available_post_id"\s*:\s*\[)([^\]]*)\]/g,
    (_m, head: string, list: string) =>
      `${head}${list.replace(/(?<!")\b(\d{16,})\b(?!")/g, '"$1"')}]`,
  );
}

/** Parse an API answer; anything but `error.code = ok` (or a non-2xx) throws. */
export async function tiktokParse<T>(res: Response): Promise<T> {
  const body = parseJsonText("tiktok", res.status, quoteLongIds(await res.text())) as Envelope<T>;
  if (typeof body.error === "string") {
    throw tiktokError(res.status, body.error, body.error_description ?? "", body.log_id);
  }
  const code = body.error?.code ?? null;
  if (!res.ok || (code && code !== "ok")) {
    throw tiktokError(res.status, code, body.error?.message ?? "", body.error?.log_id);
  }
  return (body.data ?? {}) as T;
}

/** POST a JSON body to `path` with the creator's access token. */
export async function tiktokPost<T>(
  path: string,
  token: string,
  payload: unknown,
  fetchImpl: HttpFetch = defaultFetch,
): Promise<T> {
  const res = await send("tiktok", fetchImpl, `${TIKTOK_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
  return tiktokParse<T>(res);
}
