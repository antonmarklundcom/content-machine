/**
 * Errors from the video platforms' APIs (build 4 §3.F), shaped so the
 * publisher can decide the same three things it decides for Meta (O13): is
 * the login gone (reconnect), is it worth trying again later (temporary), or
 * is it a refusal the owner must read. Messages never carry a token.
 */

export type VideoProvider = "youtube" | "tiktok";

export const PROVIDER_NAME: Record<VideoProvider, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
};

export class ProviderApiError extends Error {
  constructor(
    message: string,
    readonly provider: VideoProvider,
    /** HTTP status; 0 when the service could not be reached. */
    readonly status: number,
    /** The provider's own reason / error code, when it gave one. */
    readonly code: string | null,
    /** The login no longer works: reconnect. */
    readonly isAuthError: boolean,
    /** Unreachable, 5xx or rate limited: try again later. */
    readonly isTransient: boolean,
  ) {
    super(redactTokens(message));
    this.name = "ProviderApiError";
  }
}

/** Google (`ya29.`, `1//`) and TikTok (`act.`, `rft.`) tokens, bearer headers and secret params. */
export function redactTokens(text: string): string {
  return text
    .replace(
      /(access_token|refresh_token|client_secret|client_key|code)=[^&\s"']+/g,
      (_m, k: string) => `${k}=***`,
    )
    .replace(/"(access_token|refresh_token|client_secret)"\s*:\s*"[^"]*"/g, '"$1":"***"')
    .replace(/Bearer\s+[^\s"']+/g, "Bearer ***")
    .replace(/\bya29\.[\w.-]+/g, "***")
    .replace(/\b1\/\/[\w.-]+/g, "***")
    .replace(/\b(act|rft)\.[\w.!*-]{10,}/g, "***");
}

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const realFetch: HttpFetch = (url, init) => fetch(url, init);

/** `fetch` that turns "could not connect" into a transient `ProviderApiError`. */
export async function send(
  provider: VideoProvider,
  fetchImpl: HttpFetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderApiError(
      `Could not reach ${PROVIDER_NAME[provider]}: ${msg}`,
      provider,
      0,
      null,
      false,
      true,
    );
  }
}

/** A JSON body, or `{}` for an empty one; a non-JSON body is an error with the status. */
export async function readJson(provider: VideoProvider, res: Response): Promise<unknown> {
  return parseJsonText(provider, res.status, await res.text());
}

export function parseJsonText(provider: VideoProvider, status: number, text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderApiError(
      `${PROVIDER_NAME[provider]} answered ${status} with a non-JSON body.`,
      provider,
      status,
      null,
      false,
      status >= 500,
    );
  }
}

export const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();
