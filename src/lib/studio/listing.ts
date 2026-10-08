import type {
  AspectRatio,
  BrollShot,
  ScriptBodyV1,
  ScriptLanguage,
  ScriptSource,
} from "@/lib/scripts/contract";

/**
 * A property listing → an on-camera script (build 2b, idea 8).
 *
 * Pure: the page fetch takes its `fetch` as an argument and nothing here
 * touches the database or the model, so the parser and the post-processing
 * are unit-tested against fixtures. The paid call is in `listing.actions.ts`.
 *
 * No HTML parser dependency: a listing page gives up what a script needs in
 * two places a regex reads reliably — its `<meta property="og:…">` tags and its
 * `<script type="application/ld+json">` blocks.
 */

/** Everything the form shows and the prompt uses. All text, so the form edits it as is. */
export type ListingFields = {
  /** The page the listing came from; empty when typed by hand. */
  url: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  address: string;
  rooms: string;
  bathrooms: string;
  /** Floor area with its unit, e.g. "120 m²". */
  area: string;
  /** Absolute http(s) photo URLs, in the listing's order. */
  images: string[];
  /** Anything else Anton wants said: HOA fees, what is nearby, who it suits. */
  notes: string;
};

export function emptyListing(): ListingFields {
  return {
    url: "",
    title: "",
    description: "",
    price: "",
    currency: "",
    address: "",
    rooms: "",
    bathrooms: "",
    area: "",
    images: [],
    notes: "",
  };
}

/** More photos than this is a gallery, not b-roll — and a longer prompt for nothing. */
export const MAX_LISTING_IMAGES = 12;

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function clean(text: unknown): string {
  if (typeof text !== "string" && typeof text !== "number") return "";
  return decodeEntities(String(text)).replace(/\s+/g, " ").trim();
}

/** `name="value"` pairs of one tag, attribute names lowercased. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
  )) {
    out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return out;
}

/** Every `<meta>` keyed by property/name (lowercased); repeated keys keep every value. */
function metaTags(html: string): Map<string, string[]> {
  const meta = new Map<string, string[]>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
    if (!key || a.content === undefined) continue;
    meta.set(key, [...(meta.get(key) ?? []), decodeEntities(a.content).trim()]);
  }
  return meta;
}

/** Parsed JSON-LD blocks; a block that is not valid JSON is skipped, not fatal. */
function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Sites ship broken JSON-LD often enough; the og: tags still carry.
    }
  }
  return blocks;
}

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function types(node: Node): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

/** Types whose fields describe the property itself. */
const LISTING_TYPES = new Set([
  "RealEstateListing",
  "Offer",
  "AggregateOffer",
  "Product",
  "Accommodation",
  "Apartment",
  "House",
  "SingleFamilyResidence",
  "Residence",
  "ApartmentComplex",
  "Room",
  "Suite",
  "Place",
  "LandmarksOrHistoricalBuildings",
]);

/** Types that are about someone else — the agency's office address is not the property's. */
const FOREIGN_TYPES = new Set([
  "Organization",
  "RealEstateAgent",
  "LocalBusiness",
  "Person",
  "Brand",
  "WebSite",
  "WebPage",
  "BreadcrumbList",
  "SearchAction",
]);

/** The top-level nodes of every block: arrays and `@graph`s flattened. */
function topNodes(blocks: unknown[]): Node[] {
  const out: Node[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isNode(v)) return;
    if (Array.isArray(v["@graph"])) (v["@graph"] as unknown[]).forEach(visit);
    if (types(v).length) out.push(v);
  };
  blocks.forEach(visit);
  return out;
}

/**
 * Nodes that describe the listing, depth first: each listing-typed top node,
 * then what it nests (`offers`, `itemOffered`, `mainEntity`, …) — never into a
 * seller, agent or publisher.
 */
function listingNodes(blocks: unknown[]): Node[] {
  const out: Node[] = [];
  const seen = new Set<Node>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth));
    if (!isNode(v) || seen.has(v)) return;
    const t = types(v);
    if (t.some((x) => FOREIGN_TYPES.has(x))) return;
    seen.add(v);
    out.push(v);
    for (const [key, child] of Object.entries(v)) {
      if (key === "@context" || key === "address" || key === "image") continue;
      if (typeof child === "object" && child !== null) walk(child, depth + 1);
    }
  };
  for (const node of topNodes(blocks)) {
    if (types(node).some((t) => LISTING_TYPES.has(t))) walk(node, 0);
  }
  return out;
}

function first<T>(nodes: Node[], read: (n: Node) => T | undefined): T | undefined {
  for (const n of nodes) {
    const v = read(n);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** A number or `{ value }` / `{ value, unitCode }` QuantitativeValue, as text. */
function quantity(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return clean(value);
  if (isNode(value)) return quantity(value.value ?? value.maxValue ?? value.minValue);
  return undefined;
}

const AREA_UNITS: Record<string, string> = {
  MTK: "m²",
  FTK: "ft²",
  MTR: "m",
  HAR: "ha",
  ACR: "acres",
};

function area(value: unknown): string | undefined {
  if (!isNode(value)) return quantity(value);
  const amount = quantity(value.value ?? value.maxValue ?? value.minValue);
  if (!amount) return undefined;
  const code = typeof value.unitCode === "string" ? value.unitCode.toUpperCase() : "";
  const unit = AREA_UNITS[code] ?? clean(value.unitText);
  return unit ? `${amount} ${unit}` : amount;
}

function addressText(value: unknown): string | undefined {
  if (typeof value === "string") return clean(value) || undefined;
  if (!isNode(value)) return undefined;
  const country = isNode(value.addressCountry) ? value.addressCountry.name : value.addressCountry;
  const parts = [value.streetAddress, value.addressLocality, value.addressRegion, country]
    .map(clean)
    .filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.length ? unique.join(", ") : undefined;
}

function imageUrls(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(imageUrls);
  if (isNode(value)) {
    const u = value.contentUrl ?? value.url;
    return typeof u === "string" ? [u] : [];
  }
  return [];
}

/** An absolute http(s) URL, resolved against the page; null for anything else (data:, javascript:, junk). */
export function absoluteUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(raw.trim()), base || undefined);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function price(nodes: Node[]): { price?: string; currency?: string } {
  const node = nodes.find(
    (n) => n.price !== undefined || n.lowPrice !== undefined || isNode(n.priceSpecification),
  );
  if (!node) return {};
  const spec = isNode(node.priceSpecification) ? node.priceSpecification : undefined;
  const amount = quantity(node.price ?? node.lowPrice ?? spec?.price);
  const currency = clean(node.priceCurrency ?? spec?.priceCurrency) || undefined;
  return { price: amount, currency };
}

/**
 * Read a listing page: og:/twitter: tags and JSON-LD (`RealEstateListing`,
 * `Offer`, `Product` and the accommodation types they nest). JSON-LD wins for
 * the structured fields; og: wins for title and description, which sites write
 * for sharing and so keep human. Every field it cannot find stays empty for
 * the form to fill.
 */
export function parseListingHtml(html: string, pageUrl: string): ListingFields {
  const meta = metaTags(html);
  const m = (...keys: string[]) => keys.map((k) => meta.get(k)?.[0]).find((v) => v) ?? "";
  const blocks = jsonLdBlocks(html);
  const nodes = listingNodes(blocks);

  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const ldName = first(nodes, (n) => clean(n.name) || undefined) ?? "";
  const ldDescription = first(nodes, (n) => clean(n.description) || undefined) ?? "";
  const { price: amount, currency } = price(nodes);

  const ogPrice = m("product:price:amount", "og:price:amount");
  const ogCurrency = m("product:price:currency", "og:price:currency");

  const candidates = [
    ...(meta.get("og:image") ?? []),
    ...(meta.get("og:image:url") ?? []),
    ...(meta.get("og:image:secure_url") ?? []),
    ...(meta.get("twitter:image") ?? []),
    ...nodes.flatMap((n) => imageUrls(n.image ?? n.photo)),
  ];
  const images: string[] = [];
  for (const raw of candidates) {
    const url = absoluteUrl(raw, pageUrl);
    if (url && !images.includes(url)) images.push(url);
    if (images.length >= MAX_LISTING_IMAGES) break;
  }

  return {
    url: pageUrl,
    title: clean(m("og:title", "twitter:title")) || ldName || clean(titleTag),
    description:
      clean(m("og:description", "twitter:description")) || ldDescription || clean(m("description")),
    price: amount ?? clean(ogPrice),
    currency: currency ?? clean(ogCurrency),
    address:
      first(nodes, (n) => addressText(n.address)) ??
      clean(m("og:street-address", "place:location:address")),
    rooms: first(nodes, (n) => quantity(n.numberOfRooms ?? n.numberOfBedrooms)) ?? "",
    bathrooms:
      first(nodes, (n) => quantity(n.numberOfBathroomsTotal ?? n.numberOfFullBathrooms)) ?? "",
    area: first(nodes, (n) => area(n.floorSize ?? n.lotSize)) ?? "",
    images,
    notes: "",
  };
}

// ---------------------------------------------------------------------------
// fetching
// ---------------------------------------------------------------------------

export const LISTING_FETCH_TIMEOUT_MS = 10_000;
/** A listing page is well under this; anything bigger is not one. */
const MAX_PAGE_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;

export class ListingFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingFetchError";
  }
}

/**
 * Hosts this app must never fetch on a pasted URL's say-so: the PC it runs on
 * and its LAN. A cheap literal check — the page fetch is signed-in only and
 * returns parsed fields, not the raw body.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h === "::1" ||
    h === "::"
  )
    return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return /^(fc|fd|fe80:)/.test(h);
}

/** A pasted listing URL, checked: http(s), public host. Throws `ListingFetchError` with a reason to show. */
export function checkListingUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ListingFetchError(
      "That is not a URL. Paste the listing's full address, starting with https://.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ListingFetchError("Only http(s) listing pages can be read.");
  }
  if (isPrivateHost(url.hostname))
    throw new ListingFetchError("That address is on this computer or its network.");
  return url;
}

/**
 * Fetch a listing page (10 s timeout, HTML only, size-capped) and parse it.
 * `fetchImpl` is injected so tests never reach the network.
 */
export async function fetchListing(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = LISTING_FETCH_TIMEOUT_MS,
): Promise<ListingFields> {
  let url = checkListingUrl(rawUrl);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  // Redirects by hand, so every hop's host is checked before it is requested.
  for (let hop = 0; ; hop++) {
    try {
      response = await fetchImpl(url, {
        signal,
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 (compatible; content-engine listing reader)",
        },
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new ListingFetchError(
        timedOut
          ? `The page did not answer within ${Math.round(timeoutMs / 1000)} seconds. Fill the form by hand instead.`
          : "The page could not be reached. Fill the form by hand instead.",
      );
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;
    if (hop >= MAX_REDIRECTS) throw new ListingFetchError("The page redirects too many times.");
    url = checkListingUrl(new URL(location, url).toString());
  }
  if (!response.ok)
    throw new ListingFetchError(
      `The page answered ${response.status}. Fill the form by hand instead.`,
    );
  const type = response.headers.get("content-type") ?? "";
  if (type && !/html|xml/i.test(type))
    throw new ListingFetchError(`That is not a web page (${type.split(";")[0]}).`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_PAGE_BYTES)
    throw new ListingFetchError("That page is too large to be a listing.");
  const html = await response.text();
  if (html.length > MAX_PAGE_BYTES)
    throw new ListingFetchError("That page is too large to be a listing.");
  return parseListingHtml(html, url.toString());
}

/** Trim every field, keep only absolute http(s) images (deduped, capped) — for anything from a form. */
export function normalizeListing(
  input: Partial<Record<keyof ListingFields, unknown>>,
): ListingFields {
  const text = (v: unknown) =>
    typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  const images: string[] = [];
  for (const raw of Array.isArray(input.images) ? input.images : []) {
    const url = typeof raw === "string" ? absoluteUrl(raw, "") : null;
    if (url && !images.includes(url)) images.push(url);
  }
  const url = text(input.url);
  return {
    url: url && absoluteUrl(url, "") ? url : "",
    title: text(input.title),
    description: text(input.description),
    price: text(input.price),
    currency: text(input.currency),
    address: text(input.address),
    rooms: text(input.rooms),
    bathrooms: text(input.bathrooms),
    area: text(input.area),
    images: images.slice(0, MAX_LISTING_IMAGES),
    notes: text(input.notes),
  };
}

// ---------------------------------------------------------------------------
// the script request
// ---------------------------------------------------------------------------

export const LISTING_MODES = ["short", "tour"] as const;
export type ListingMode = (typeof LISTING_MODES)[number];

/** Short: 60–90 s vertical. Tour: a 3–5 minute walk-through, horizontal. */
export const MODE_SPEC: Record<
  ListingMode,
  { targetMinutes: number; aspectRatio: AspectRatio; length: string }
> = {
  short: {
    targetMinutes: 1.5,
    aspectRatio: "9:16",
    length: "60 to 90 seconds (about 150–200 spoken words)",
  },
  tour: {
    targetMinutes: 4,
    aspectRatio: "16:9",
    length: "3 to 5 minutes (about 450–650 spoken words)",
  },
};

/** The id the listing page gets in `sources`, cited by every section that states a price or fee. */
export const LISTING_SOURCE_ID = "listing";
/** How a b-roll shot points at one of the listing's photos, in `imagePrompt`. */
export const LISTING_PHOTO_PREFIX = "LISTING PHOTO (download, do not generate): ";

function factLines(listing: ListingFields): string {
  const rows: [string, string][] = [
    ["Title", listing.title],
    ["Price", [listing.price, listing.currency].filter(Boolean).join(" ")],
    ["Address / area", listing.address],
    ["Rooms", listing.rooms],
    ["Bathrooms", listing.bathrooms],
    ["Floor area", listing.area],
    ["Description", listing.description],
    ["Anton's notes", listing.notes],
    ["Listing URL", listing.url],
  ];
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function listingTopic(listing: ListingFields): string {
  return listing.title || listing.address || "Property listing";
}

/**
 * The system and user prompts for one listing script. The listing is the
 * research: no web search, and no fact that is not in it.
 */
export function listingScriptPrompt(
  listing: ListingFields,
  mode: ListingMode,
  brand: { name: string; niche: string; market: string; voice: string | null },
  language: ScriptLanguage,
  styleGuide: string,
): { system: string; prompt: string } {
  const spec = MODE_SPEC[mode];
  const photos = listing.images.map((u, i) => `P${i + 1}: ${u}`).join("\n");

  const system = `You write on-camera property videos for Anton, who films himself and reads from a teleprompter. Spoken lines are short: one sentence, one idea per line, words a person actually says out loud. No hype words ("stunning", "dream home", "must-see"), no filler, no stage directions inside spoken lines.

Facts: the listing below is your only source. Do not state anything about the property, its price, fees, taxes, the neighbourhood or the market that is not in it. Every section that states the price, a fee, a size or a number of rooms lists the source id "${LISTING_SOURCE_ID}" in sourceIds. Put exactly one source in "sources": id "${LISTING_SOURCE_ID}", the listing URL (or "https://propia.com.py" if there is none), verifyBeforeRecording true.

B-roll: use the listing's own photos first. To use photo P3, set imagePrompt to exactly "PHOTO P3" and describe what the photo shows. Only when no listing photo fits the line, write a new English photographic imagePrompt (no text in the image, no real people's likenesses). Every shot's aspectRatio is "${spec.aspectRatio}". videoPrompt is a subtle camera move (slow push-in, gentle pan) or empty for a still.

Thumbnails: three concepts for a 16:9 YouTube thumbnail, textOverlay at most four words.

Answer with JSON matching the required schema and nothing else.`;

  const prompt = `Brand: ${brand.name} (${brand.niche}), market: ${brand.market}
Voice: ${brand.voice ?? "plain, concrete, no hype"}
Write in ${language}.${styleGuide.trim() ? `\n\nSTYLE GUIDE:\n${styleGuide.trim()}` : ""}

Format: ${mode === "short" ? "a vertical short" : "a walk-through tour video"}, ${spec.length}.${
    mode === "short"
      ? " A hook in the first two seconds, two or three short sections, one call to action."
      : " A hook, then the property room by room or outside-in, what it suits and who, then a call to action."
  }

THE LISTING
${factLines(listing)}

LISTING PHOTOS
${photos || "(none — write imagePrompts for every shot)"}

Write the script: three title options, three thumbnail concepts, the hook, the sections, the call to action, b-roll for each, and the one source.`;

  return { system, prompt };
}

// ---------------------------------------------------------------------------
// after the model
// ---------------------------------------------------------------------------

const PHOTO_REF = /^\s*PHOTO\s+P(\d+)\s*$/i;
const MONEY =
  /[$€₲]|\b(usd|us\$|gs\.?|guaran[ií]es|price|precio|fee|fees|expensas|cuota|tax|impuesto|per month|por mes|\/month|\/mes)\b/i;

/** `chosen`: the model picked this photo, so its description is of the photo; otherwise it was of another shot. */
function photoShot(shot: BrollShot, url: string, n: number, chosen: boolean): BrollShot {
  return {
    ...shot,
    imagePrompt: `${LISTING_PHOTO_PREFIX}${url}`,
    description: chosen && shot.description ? shot.description : `Listing photo ${n}`,
  };
}

/**
 * Make the model's script a listing script, deterministically:
 *  - "PHOTO Pn" becomes the photo's URL behind `LISTING_PHOTO_PREFIX`; a
 *    reference to a photo that does not exist becomes the next unused one;
 *  - listing photos come first: while photos are left unused, a generated
 *    shot takes the next one (Higgsfield only for the shots beyond them);
 *  - every shot gets the mode's aspect ratio;
 *  - the listing is a source with verifyBeforeRecording, and every section
 *    whose lines mention a price or fee cites it. Without a listing URL there
 *    is no source to cite, so those sections get a talking point instead.
 */
export function finishListingScript(
  body: ScriptBodyV1,
  listing: ListingFields,
  mode: ListingMode,
): ScriptBodyV1 {
  const spec = MODE_SPEC[mode];
  const photos = listing.images;
  const used = new Set<number>();
  const nextUnused = () => {
    for (let i = 0; i < photos.length; i++) if (!used.has(i)) return i;
    return -1;
  };

  const blocks = [body.hook.broll, ...body.sections.map((s) => s.broll)];
  // Resolve explicit references first, so a later generated shot cannot take a
  // photo the model already placed.
  const resolved = blocks.map((shots) =>
    shots.map((shot) => {
      const ref = shot.imagePrompt.match(PHOTO_REF);
      if (!ref) return { shot, photo: null as number | null };
      const i = Number(ref[1]) - 1;
      if (i >= 0 && i < photos.length && !used.has(i)) {
        used.add(i);
        return { shot, photo: i };
      }
      return { shot, photo: -1 }; // a bad or repeated reference: the next free photo, or a prompt
    }),
  );
  const finished = resolved.map((shots) =>
    shots.map(({ shot, photo }) => {
      let i = photo;
      if (i === null || i === -1) {
        const free = nextUnused();
        if (free >= 0) {
          used.add(free);
          i = free;
        }
      }
      if (i !== null && i >= 0) {
        return { ...photoShot(shot, photos[i], i + 1, i === photo), aspectRatio: spec.aspectRatio };
      }
      const imagePrompt = PHOTO_REF.test(shot.imagePrompt)
        ? shot.description || "Property exterior, daylight"
        : shot.imagePrompt;
      return { ...shot, imagePrompt, aspectRatio: spec.aspectRatio };
    }),
  );

  const hasUrl = Boolean(listing.url && absoluteUrl(listing.url, ""));
  const listingSource: ScriptSource | null = hasUrl
    ? {
        id: LISTING_SOURCE_ID,
        claim: "Price, fees, size and rooms as stated in the listing",
        url: listing.url,
        title: listing.title || "Listing",
        verifyBeforeRecording: true,
      }
    : null;
  const others = body.sources.filter((s) => s.id !== LISTING_SOURCE_ID);
  const sources = listingSource ? [listingSource, ...others] : others;

  const sections = body.sections.map((s, i) => {
    const text = [...s.spokenLines, ...s.onScreenText].join(" ");
    const money = MONEY.test(text);
    const sourceIds = s.sourceIds.filter((id) => sources.some((src) => src.id === id));
    if (money && listingSource && !sourceIds.includes(LISTING_SOURCE_ID))
      sourceIds.unshift(LISTING_SOURCE_ID);
    const talkingPoints =
      money && !listingSource && !s.talkingPoints.some((t) => t.startsWith("VERIFY"))
        ? [
            ...s.talkingPoints,
            "VERIFY BEFORE RECORDING: the price and fees were typed by hand — check them.",
          ]
        : s.talkingPoints;
    return { ...s, sourceIds, talkingPoints, broll: finished[i + 1] };
  });

  return { ...body, hook: { ...body.hook, broll: finished[0] }, sections, sources };
}
