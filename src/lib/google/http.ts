import {
  ProviderApiError,
  readJson,
  realFetch,
  send,
  type HttpFetch,
} from "@/lib/publish/provider-error";

/**
 * The one door to Google's APIs (build 4 §3.F). Tests replay recorded
 * fixtures through `setGoogleFetch`; nothing here logs a token.
 */

let defaultFetch: HttpFetch = realFetch;

/** Tests replay recorded fixtures through this; null restores the real `fetch`. */
export function setGoogleFetch(f: HttpFetch | null): void {
  defaultFetch = f ?? realFetch;
}

export function googleFetch(): HttpFetch {
  return defaultFetch;
}

type GoogleErrorBody = {
  error?:
    | string
    | {
        code?: number;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
  error_description?: string;
};

const TRANSIENT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "backendError",
  "internalError",
]);
const AUTH_REASONS = new Set(["authError", "invalid_grant", "unauthorized_client"]);

/** Google's error body (API or token endpoint) as a `ProviderApiError`. */
export function googleError(status: number, body: unknown): ProviderApiError {
  const b = (body ?? {}) as GoogleErrorBody;
  let message: string;
  let reason: string | null;
  if (typeof b.error === "string") {
    // The token endpoint: { error: "invalid_grant", error_description: "…" }
    reason = b.error;
    message = b.error_description ? `${b.error}: ${b.error_description}` : b.error;
  } else {
    reason = b.error?.errors?.[0]?.reason ?? b.error?.status ?? null;
    message = b.error?.message ?? `Google answered ${status}.`;
  }
  const auth = status === 401 || (reason !== null && AUTH_REASONS.has(reason));
  const transient =
    status === 0 ||
    status >= 500 ||
    status === 429 ||
    (reason !== null && TRANSIENT_REASONS.has(reason));
  return new ProviderApiError(message.slice(0, 500), "youtube", status, reason, auth, transient);
}

/** A JSON call that must answer 2xx. */
export async function googleJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: HttpFetch = defaultFetch,
): Promise<T> {
  const res = await send("youtube", fetchImpl, url, init);
  const body = await readJson("youtube", res);
  if (!res.ok) throw googleError(res.status, body);
  return body as T;
}
