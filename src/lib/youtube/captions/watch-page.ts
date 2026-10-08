import { assertOkResponse, fetchWithTimeout } from "./http";
import { extractTracks } from "./innertube";
import { BROWSER_UA } from "./track";
import { CaptionError, type CaptionTrack, type ListTracksOptions } from "./types";

/**
 * Scrape ytInitialPlayerResponse out of the HTML watch page.
 *
 * Kept as a fallback rather than the primary path: it is the approach most
 * exposed to consent interstitials and bot walls, but it occasionally succeeds
 * when the innertube clients are all being refused, so it earns its place.
 */
export async function listTracksViaWatchPage(
  videoId: string,
  opts: ListTracksOptions = {},
): Promise<CaptionTrack[]> {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&has_verified=1&bpctr=9999999999`,
    {
      timeoutMs: opts.timeoutMs,
      headers: {
        "user-agent": BROWSER_UA,
        "accept-language": "en-US,en;q=0.9",
        // Pre-consented cookie — without it EU-routed requests land on the
        // consent interstitial, which contains no player response at all.
        cookie: "CONSENT=YES+cb; SOCS=CAI",
      },
    },
    "list",
  );
  assertOkResponse(res, "list");

  const html = await res.text();

  if (html.includes("consent.youtube.com") || html.includes("action-consent")) {
    throw new CaptionError("redirected to the consent interstitial", "blocked", "list");
  }
  if (/Sign in to confirm|not a bot/i.test(html)) {
    throw new CaptionError("watch page returned the bot wall", "blocked", "list");
  }

  const json = extractJsonAssignment(html, "ytInitialPlayerResponse");
  if (!json) {
    throw new CaptionError("no ytInitialPlayerResponse in the watch page HTML", "parse", "list");
  }

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new CaptionError("ytInitialPlayerResponse was not valid JSON", "parse", "list");
  }

  return extractTracks(data as Parameters<typeof extractTracks>[0]);
}

/**
 * Pull `var NAME = {...};` out of a script blob by brace matching.
 *
 * A regex cannot do this correctly — the payload contains braces inside string
 * literals — so walk the characters and track string/escape state.
 */
export function extractJsonAssignment(html: string, varName: string): string | null {
  const marker = new RegExp(`${varName}\\s*=\\s*\\{`);
  const match = marker.exec(html);
  if (!match) return null;

  const start = match.index + match[0].length - 1; // index of the opening brace
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}
