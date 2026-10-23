import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, buildConnector, type Dispatcher } from "undici";
import { parseListingHtml, type ListingFields } from "./listing";

export const LISTING_FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;
const PRIVATE_ADDRESS =
  "That address is on this computer or its network, or is not a public web address.";

export class ListingFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingFetchError";
  }
}

// IANA special-purpose ranges are not listing servers. IPv6 is limited to
// global unicast, excluding protocol, documentation and transition ranges.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  nonPublic.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  nonPublic.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicListingAddress(address: string): boolean {
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !nonPublic.check(address, "ipv4");
  // This also rejects mapped IPv6, NAT64, ULA, link-local and scoped IPs.
  return family === 6 && globalV6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
}

function hostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

/** Syntax/literal checks only. DNS is checked immediately before connecting. */
export function checkListingUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ListingFetchError(
      "That is not a URL. Paste the listing's full address, starting with https://.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new ListingFetchError("Only http(s) listing pages can be read.");
  if (url.username || url.password)
    throw new ListingFetchError("Use a listing URL without a username or password.");
  const host = hostname(url);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) && !isPublicListingAddress(host))
  )
    throw new ListingFetchError(PRIVATE_ADDRESS);
  return url;
}

export type ListingLookup = (hostname: string) => Promise<readonly LookupAddress[]>;
type ListingFetch = (url: URL, init: RequestInit & { dispatcher: Dispatcher }) => Promise<Response>;
type ListingFetchOptions = { fetchImpl?: ListingFetch; lookup?: ListingLookup; timeoutMs?: number };

async function beforeAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

async function publicAddress(
  url: URL,
  resolve: ListingLookup,
  signal: AbortSignal,
): Promise<LookupAddress> {
  const host = hostname(url);
  const family = isIP(host);
  const addresses = family ? [{ address: host, family }] : await beforeAbort(resolve(host), signal);
  if (
    !addresses.length ||
    addresses.some(
      (result) => isIP(result.address) !== result.family || !isPublicListingAddress(result.address),
    )
  ) {
    throw new ListingFetchError(PRIVATE_ADDRESS);
  }
  // Prefer IPv4 on hosts with DNS AAAA records but no working IPv6 route.
  return addresses.find((result) => result.family === 4) ?? addresses[0];
}

/**
 * Preserve URL/Host and TLS identity, but connect to the exact approved IP.
 * A second DNS lookup cannot change the destination after validation.
 * https://github.com/nodejs/undici/blob/v6.28.0/docs/docs/api/Connector.md
 */
export function pinnedListingConnector(
  url: URL,
  address: LookupAddress,
  connect: buildConnector.connector = buildConnector({}),
): buildConnector.connector {
  const host = hostname(url);
  return (options, callback) => {
    if (
      options.hostname
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "")
        .toLowerCase() !== host ||
      options.protocol !== url.protocol ||
      !isPublicListingAddress(address.address)
    ) {
      callback(new ListingFetchError(PRIVATE_ADDRESS), null);
      return;
    }
    connect(
      {
        ...options,
        hostname: address.address,
        host: url.host,
        servername: isIP(host) ? undefined : host,
      },
      callback,
    );
  };
}

async function boundedHtml(response: Response, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_PAGE_BYTES) {
    await response.body?.cancel();
    throw new ListingFetchError("That page is too large to be a listing.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await beforeAbort(reader.read(), signal);
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new ListingFetchError("That page is too large to be a listing.");
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Every redirect gets DNS validation and its own pinned transport. */
export async function fetchListing(
  rawUrl: string,
  options: ListingFetchOptions = {},
): Promise<ListingFields> {
  let url = checkListingUrl(rawUrl);
  const timeoutMs = options.timeoutMs ?? LISTING_FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const resolve = options.lookup ?? ((host) => lookup(host, { all: true }));
  const fetchImpl: ListingFetch = options.fetchImpl ?? fetch;
  const dispatchers: Agent[] = [];
  try {
    let response: Response;
    for (let hop = 0; ; hop++) {
      const address = await publicAddress(url, resolve, signal);
      signal.throwIfAborted();
      const dispatcher = new Agent({ connect: pinnedListingConnector(url, address) });
      dispatchers.push(dispatcher);
      response = await fetchImpl(url, {
        signal,
        dispatcher,
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Content-Machine listing reader",
        },
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      await response.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new ListingFetchError("The page redirects too many times.");
      url = checkListingUrl(new URL(location, url).toString());
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ListingFetchError(
        `The page answered ${response.status}. Fill the form by hand instead.`,
      );
    }
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) {
      await response.body?.cancel();
      throw new ListingFetchError(`That is not a web page (${type.split(";")[0]}).`);
    }
    return parseListingHtml(await boundedHtml(response, signal), url.toString());
  } catch (error) {
    if (error instanceof ListingFetchError) throw error;
    const timedOut =
      signal.aborted ||
      (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));
    throw new ListingFetchError(
      timedOut
        ? `The page did not answer within ${Math.round(timeoutMs / 1000)} seconds. Fill the form by hand instead.`
        : "The page could not be reached. Fill the form by hand instead.",
    );
  } finally {
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.destroy()));
  }
}
