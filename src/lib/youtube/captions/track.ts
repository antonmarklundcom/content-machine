import { assertOkResponse, fetchWithTimeout } from "./http";
import { CaptionError, type CaptionSegment, type CaptionTrack } from "./types";

/**
 * Pick the track to actually download.
 *
 * Manually-authored captions beat auto-generated ones (ASR output is unpunctuated
 * and noticeably degrades the analysis), and a preferred language beats a random
 * one. Everything else is a tie broken by original track order.
 */
export function selectTrack(
  tracks: CaptionTrack[],
  preferredLanguages: string[] = ["en"],
): CaptionTrack | null {
  if (tracks.length === 0) return null;

  const score = (t: CaptionTrack): number => {
    const langIndex = preferredLanguages.findIndex(
      (l) => t.languageCode === l || t.languageCode.startsWith(`${l}-`),
    );
    const langScore = langIndex === -1 ? 0 : (preferredLanguages.length - langIndex) * 10;
    const kindScore = t.kind === "manual" ? 5 : 0;
    return langScore + kindScore;
  };

  return [...tracks].sort((a, b) => score(b) - score(a))[0] ?? null;
}

type Json3Response = {
  events?: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
};

/**
 * Download one caption track.
 *
 * json3 is requested first because it is compact and unambiguous. YouTube
 * intermittently serves an empty body for json3 on some tracks, so the legacy
 * XML format is kept as a fallback rather than treating empty as "no captions".
 */
export async function fetchTrack(
  track: CaptionTrack,
  timeoutMs?: number,
): Promise<CaptionSegment[]> {
  const attempts: Array<{ label: string; url: string }> = [
    { label: "json3", url: withParams(track.baseUrl, { fmt: "json3" }) },
    { label: "srv3", url: withParams(track.baseUrl, { fmt: "srv3" }) },
    { label: "xml", url: stripParams(track.baseUrl, ["fmt"]) },
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(
        attempt.url,
        { headers: { "user-agent": BROWSER_UA, "accept-language": "en-US,en;q=0.9" }, timeoutMs },
        "fetch",
      );
      assertOkResponse(res, "fetch");
      const body = await res.text();
      if (!body.trim()) {
        errors.push(`${attempt.label}: empty body`);
        continue;
      }
      const segments = attempt.label === "json3" ? parseJson3(body) : parseTimedTextXml(body);
      if (segments.length > 0) return segments;
      errors.push(`${attempt.label}: parsed to 0 segments`);
    } catch (err) {
      errors.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new CaptionError(
    `all track formats failed (${errors.join("; ")})`,
    errors.some((e) => e.includes("HTTP 429") || e.includes("HTTP 403")) ? "blocked" : "parse",
    "fetch",
  );
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function stripParams(base: string, keys: string[]): string {
  const url = new URL(base);
  for (const k of keys) url.searchParams.delete(k);
  return url.toString();
}

function parseJson3(body: string): CaptionSegment[] {
  let data: Json3Response;
  try {
    data = JSON.parse(body) as Json3Response;
  } catch {
    throw new CaptionError("json3 body was not valid JSON", "parse", "fetch");
  }

  const out: CaptionSegment[] = [];
  for (const event of data.events ?? []) {
    const text = (event.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    // Events with no segs are timing//formatting markers, not speech.
    if (!text || text === "\n") continue;
    out.push({
      start: (event.tStartMs ?? 0) / 1000,
      dur: (event.dDurationMs ?? 0) / 1000,
      text,
    });
  }
  return out;
}

const XML_TEXT_TAG = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
const XML_ATTR = /(\w+)="([^"]*)"/g;

function parseTimedTextXml(body: string): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const match of body.matchAll(XML_TEXT_TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of (match[1] ?? "").matchAll(XML_ATTR)) {
      if (a[1] && a[2] !== undefined) attrs[a[1]] = a[2];
    }
    const text = decodeEntities(match[2] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    out.push({
      start: Number(attrs["start"] ?? attrs["t"] ?? 0) || 0,
      dur: Number(attrs["dur"] ?? attrs["d"] ?? 0) || 0,
      text,
    });
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  // YouTube double-encodes: the XML contains &amp;#39; for an apostrophe.
  const once = input.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, entity: string) => {
    const named = ENTITIES[entity];
    if (named !== undefined) return named;
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return whole;
  });
  return once === input ? once : decodeEntities(once);
}

/** Join timed segments into flowing prose for the analysis prompt. */
export function segmentsToText(segments: CaptionSegment[]): string {
  return segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
