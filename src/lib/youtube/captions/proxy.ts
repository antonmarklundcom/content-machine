import { CaptionError } from "./types";

/**
 * Optional outbound HTTP(S) proxy for caption fetches.
 *
 * Why this exists: every cost figure for the YouTube tool assumes caption text
 * is free, which assumes YouTube will answer requests from wherever this app is
 * deployed. Vercel's functions run on datacenter IPs, and datacenter IPs are
 * exactly what YouTube refuses first. If that turns out to be the case, the
 * cheapest fix is to send *only* the caption requests through a residential
 * proxy — a few dollars a month against a ~20x bill for transcribing audio
 * instead (docs/CAPTION-FETCH-RESILIENCE.md).
 *
 * This module is the wiring for that decision, so it stays a config change.
 * Unset, it costs one env lookup per request and changes nothing: no dispatcher
 * is built, no proxy module is loaded, and every fetch goes out exactly as it
 * did before.
 *
 * Deliberately NOT read: HTTPS_PROXY / HTTP_PROXY. Those are ambient in many
 * build and CI environments (including the sandboxes this repo is developed
 * in), and honouring them would silently reroute production traffic through
 * whatever a host happened to set. Routing captions through a proxy is a
 * decision with a bill attached; it takes an explicit variable.
 */

/** Only these reach a proxy. A SOCKS URL needs a different dispatcher entirely. */
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * `CAPTION_PROXY_URL`, falling back to `PROXY_URL`.
 *
 * The caption-scoped name wins so that a general-purpose `PROXY_URL` can be set
 * for the whole project and still be overridden — or disabled, with an empty
 * value — for captions alone.
 */
export function configuredProxyUrl(): string | undefined {
  const raw = process.env.CAPTION_PROXY_URL ?? process.env.PROXY_URL;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * A proxy URL safe to print.
 *
 * Residential proxies authenticate with credentials embedded in the URL, and
 * this string ends up in probe output and run logs. Returns the input unchanged
 * when there is nothing to hide, and a clearly-marked placeholder when the
 * value does not parse — never the raw value, since an unparseable string is
 * the one most likely to be a mistyped password.
 */
export function redactProxyUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "<unparseable proxy url>";
  }
  if (!parsed.username && !parsed.password) return parsed.toString();
  parsed.username = parsed.username ? "***" : "";
  parsed.password = parsed.password ? "***" : "";
  return parsed.toString();
}

export type ParsedProxy = {
  /** The proxy origin, with any credentials stripped out of the URI itself. */
  uri: string;
  /** Pre-built `Proxy-Authorization` header value, or undefined when anonymous. */
  token?: string;
};

/**
 * Split a proxy URL into the pieces undici's ProxyAgent wants.
 *
 * Credentials are moved out of the URI and into an explicit Basic token rather
 * than left inline: the inline form has been handled differently across
 * dispatcher versions, and an auth failure here looks exactly like a block from
 * YouTube, which is the one diagnosis this whole pipeline must not get wrong.
 */
export function parseProxyUrl(url: string): ParsedProxy {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CaptionError(
      `CAPTION_PROXY_URL is not a valid URL (got ${JSON.stringify(url.slice(0, 40))})`,
      "unavailable",
      "list",
    );
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new CaptionError(
      `CAPTION_PROXY_URL must be http: or https: (got ${parsed.protocol})`,
      "unavailable",
      "list",
    );
  }

  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  parsed.username = "";
  parsed.password = "";

  const token =
    username || password
      ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
      : undefined;

  return { uri: parsed.toString(), token };
}

/**
 * undici's Dispatcher, kept structural so nothing here depends on the package
 * being resolvable at type-check time in a caller that never uses a proxy.
 */
export type ProxyDispatcher = object;

let cache: { url: string; dispatcher: ProxyDispatcher } | null = null;

/**
 * The dispatcher to attach to caption fetches, or undefined when no proxy is
 * configured. Built once per process per URL.
 *
 * undici is loaded lazily for the same reason youtubei-lib.ts loads its library
 * lazily: an unset proxy must not pay for, or be broken by, a module it never
 * uses. Node has no built-in proxy support for `fetch` before v24, so this is
 * the smallest available way to do it — undici is the client `fetch` is already
 * built on, maintained by the Node team.
 */
export async function captionDispatcher(): Promise<ProxyDispatcher | undefined> {
  const url = configuredProxyUrl();
  if (!url) return undefined;
  if (cache?.url === url) return cache.dispatcher;

  const { uri, token } = parseProxyUrl(url);

  let mod: { ProxyAgent?: new (opts: { uri: string; token?: string }) => ProxyDispatcher };
  try {
    mod = (await import("undici")) as typeof mod;
  } catch (err) {
    throw new CaptionError(
      `CAPTION_PROXY_URL is set but undici could not be loaded (${
        err instanceof Error ? err.message : String(err)
      }) — run \`npm install\``,
      "unavailable",
      "list",
    );
  }

  const ProxyAgent = mod.ProxyAgent;
  if (!ProxyAgent) {
    throw new CaptionError("undici exported no ProxyAgent", "unavailable", "list");
  }

  const dispatcher = new ProxyAgent(token ? { uri, token } : { uri });
  cache = { url, dispatcher };
  return dispatcher;
}

/** Drop the memoised dispatcher. For tests, and after an env change mid-process. */
export function resetProxyCache(): void {
  cache = null;
}

/**
 * `fetch`, routed through the proxy when one is configured.
 *
 * Handed to youtubei.js so the library strategy uses the same egress path as
 * the hand-rolled ones — a proxy that only covers four of six strategies would
 * make the probe's evidence table unreadable.
 */
export async function proxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const dispatcher = await captionDispatcher();
  if (!dispatcher) return fetch(input, init);
  return fetch(input, { ...init, dispatcher } as RequestInit);
}
