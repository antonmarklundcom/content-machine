/**
 * What a saved link is, and what counts as the *same* saved link.
 *
 * Pure: no Node APIs, no database. The Telegram capture Worker (PLAN.md §1.43)
 * bundles this file so it dedupes exactly like the app does.
 *
 * Both questions are answered here, with no database and no network, because
 * both are pure string work and because the save route, the dedupe lookup and
 * the tests all have to agree on the answer. A share sheet sends whatever the
 * host app felt like appending; the inbox has to see one clip, not four.
 */

/**
 * `ClipPlatform` from src/db/schema.ts, restated so the Worker compiles this
 * file without the schema. url.test.ts fails typecheck if the two drift.
 */
export type UrlPlatform = "youtube" | "instagram" | "facebook" | "other";
type ClipPlatform = UrlPlatform;

const HOSTS: { platform: ClipPlatform; hosts: string[] }[] = [
  {
    platform: "youtube",
    hosts: [
      "youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtube-nocookie.com",
      "youtu.be",
    ],
  },
  {
    platform: "instagram",
    hosts: ["instagram.com", "m.instagram.com", "instagr.am", "ig.me"],
  },
  {
    platform: "facebook",
    hosts: ["facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "fb.watch", "fb.me"],
  },
];

/**
 * Query parameters that identify the *sharer*, not the content. Stripped
 * before dedupe so the same reel saved twice from two apps is one row.
 *
 * An allowlist of junk rather than a denylist of keepers: `v`, `list` and `t`
 * are load-bearing on YouTube, and a blanket "drop the query string" would
 * turn every watch URL into youtube.com.
 */
const TRACKING_PARAMS = [
  "si", // YouTube's share-sheet fingerprint
  "feature",
  "igshid", // Instagram's
  "igsh",
  "fbclid", // Facebook's
  "mibextid",
  "rdid",
  "share_url",
  "pnref",
  "ref",
  "ref_src",
  "ref_url",
  "source",
  "s", // X/Twitter-style share marker, harmless to drop elsewhere
];

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

/**
 * Which platform a URL belongs to. `other` is a real answer, not a failure —
 * a saved TikTok or a blog post is still worth keeping (§1.7).
 */
export function platformForUrl(input: string): ClipPlatform {
  const url = parseUrl(input);
  if (!url) return "other";
  const host = hostOf(url);
  for (const entry of HOSTS) {
    if (entry.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return entry.platform;
  }
  return "other";
}

/** Any RFC-shaped scheme prefix — `https:`, `mailto:`, `javascript:`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function parseUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  // Bare "youtu.be/x" is a link someone typed; anything carrying its own
  // scheme is taken as-is and then checked. Testing for "://" instead would
  // read `mailto:a@b.c` as scheme-less and prepend https:// to it, parsing
  // "mailto" as a username and "b.c" as the host — a non-link accepted as one.
  const candidate = HAS_SCHEME.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The dedupe key: the same link, in one canonical spelling.
 *
 * Deliberately conservative. It normalises what is provably noise — scheme,
 * `www.`, a trailing slash, the fragment, the tracking params above, `utm_*`,
 * and parameter order — and touches nothing else. Two URLs that differ in any
 * remaining way are treated as two clips, which is the safe way to be wrong:
 * a duplicate row is a nuisance, a collision silently overwrites the note on
 * something else.
 *
 * Returns null for anything that is not an http(s) URL, which is the save
 * route's validation as well.
 */
export function canonicalClipUrl(input: string): string | null {
  const url = parseUrl(input);
  if (!url) return null;

  url.protocol = "https:";
  url.hostname = hostOf(url);
  url.hash = "";
  url.username = "";
  url.password = "";

  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  // Campaign tags (`utm_source`, `utm_medium`, …) say who shared, never what.
  for (const param of [...url.searchParams.keys()]) {
    if (param.toLowerCase().startsWith("utm_")) url.searchParams.delete(param);
  }
  // Sort so ?a=1&b=2 and ?b=2&a=1 are one clip.
  url.searchParams.sort();

  // A bare host keeps its slash ("https://youtube.com/"); a path does not.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/** `clips.url` is varchar(1024); a link longer than that is not a link worth chasing. */
export const CLIP_URL_LIMIT = 1024;
