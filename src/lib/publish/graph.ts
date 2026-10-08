import { graphFetch, graphUrl, MetaGraphError, redact, type GraphFetch } from "@/lib/meta/graph";

/**
 * The write half of the Graph client for publishing (PLAN.md §5.O13). O12's
 * `GraphClient` only reads; publishing POSTs form bodies. The token travels in
 * the body, never the URL, and never in an error message.
 */

type Params = Record<string, string | number | boolean | undefined>;

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number };
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

export class GraphWriter {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: GraphFetch = graphFetch(),
  ) {}

  async get<T>(path: string, params: Params = {}): Promise<T> {
    const url = graphUrl(path, { ...stringify(params), access_token: this.token });
    return parse<T>(await this.send(url));
  }

  async post<T>(path: string, params: Params = {}): Promise<T> {
    const body = new URLSearchParams({ ...stringify(params), access_token: this.token });
    return parse<T>(
      await this.send(graphUrl(path), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    );
  }

  private async send(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new MetaGraphError(`Could not reach Meta: ${redact(msg)}`, 0, null, null);
    }
  }
}

function stringify(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = String(v);
  return out;
}

/**
 * Worth trying again later: Meta unreachable, a 5xx, or a rate limit
 * (codes 1, 2, 4, 17, 32, 341, 613, and IG's 9004/2207051-style throttles).
 */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export function isTransient(err: MetaGraphError): boolean {
  return (
    err.status === 0 || err.status >= 500 || (err.code !== null && TRANSIENT_CODES.has(err.code))
  );
}
