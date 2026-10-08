import { graphVersion } from "./config";

/**
 * A thin Graph API client (PLAN.md §5.O12). `fetch` is injectable so tests
 * replay recorded fixtures and never reach Meta. Tokens travel only in the
 * request URL; error messages and thrown errors never contain them.
 */

export type GraphFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const GRAPH_HOST = "https://graph.facebook.com";

const realFetch: GraphFetch = (url, init) => fetch(url, init);
let defaultFetch: GraphFetch = realFetch;

/** Tests replay recorded fixtures through this; null restores the real `fetch`. */
export function setGraphFetch(f: GraphFetch | null): void {
  defaultFetch = f ?? realFetch;
}

/** The fetch every Graph call uses unless one is passed in. */
export function graphFetch(): GraphFetch {
  return defaultFetch;
}

/** Graph error codes that mean "the token no longer works": reconnect. */
const TOKEN_ERROR_CODES = new Set([190, 102]);

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
    this.name = "MetaGraphError";
  }

  /** The token expired or was revoked: the integration becomes `expired`. */
  get isTokenError(): boolean {
    return this.code !== null && TOKEN_ERROR_CODES.has(this.code);
  }
}

/** Replace every access token or secret in a string with `***`. */
export function redact(text: string): string {
  return text
    .replace(/(access_token|client_secret|fb_exchange_token|code|input_token)=[^&\s"']+/g, "$1=***")
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, "***");
}

type Params = Record<string, string | number | undefined>;

export function graphUrl(path: string, params: Params = {}): string {
  const url = new URL(
    path.startsWith("http") ? path : `${GRAPH_HOST}/${graphVersion()}/${path.replace(/^\//, "")}`,
  );
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
};

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new MetaGraphError(
      `Meta answered ${res.status} with a non-JSON body.`,
      res.status,
      null,
      null,
    );
  }
  const err = (body as GraphErrorBody).error;
  if (!res.ok || err) {
    throw new MetaGraphError(
      redact(err?.message ?? `Meta answered ${res.status}.`).slice(0, 500),
      res.status,
      err?.code ?? null,
      err?.error_subcode ?? null,
    );
  }
  return body as T;
}

export class GraphClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: GraphFetch = graphFetch(),
  ) {}

  async get<T>(path: string, params: Params = {}): Promise<T> {
    const url = graphUrl(path, { ...params, access_token: this.token });
    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new MetaGraphError(`Could not reach Meta: ${redact(msg)}`, 0, null, null);
    }
    return parse<T>(res);
  }

  /** Follow `paging.next` until `max` items or no next page. */
  async list<T>(path: string, params: Params = {}, max = 100): Promise<T[]> {
    const out: T[] = [];
    let page = await this.get<{ data?: T[]; paging?: { next?: string } }>(path, params);
    for (;;) {
      out.push(...(page.data ?? []));
      const next = page.paging?.next;
      if (!next || out.length >= max) break;
      const url = new URL(next);
      url.searchParams.delete("access_token");
      page = await this.get(url.toString());
    }
    return out.slice(0, max);
  }
}

/** A tokenless GET (the OAuth code exchange carries the secret, not a token). */
export async function graphGetPublic<T>(
  path: string,
  params: Params,
  fetchImpl: GraphFetch = graphFetch(),
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(graphUrl(path, params));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MetaGraphError(`Could not reach Meta: ${redact(msg)}`, 0, null, null);
  }
  return parse<T>(res);
}
