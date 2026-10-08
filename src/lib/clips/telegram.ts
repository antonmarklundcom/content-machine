/**
 * The Telegram capture grammar (PLAN.md §1.43): one message to the bot is one
 * clip.
 *
 *   https://instagram.com/reel/abc #guide #factcheck #visa says 90 days?
 *
 * - the first http(s) URL is the clip (canonicalised like every other save);
 * - `#<brand id or alias>` sets the brand (the first one wins);
 * - `#inspo #competitor #factcheck #own #learn` (`#ai` = `#learn`) set the purpose (the first one wins);
 * - any other `#tag` goes to `tags`, lower-case, without the `#`;
 * - whatever text is left is the note.
 *
 * Pure, and imported by the Cloudflare Worker (S16): no Node APIs, no database,
 * no `server-only`, and no imports from outside this folder.
 */

import { canonicalClipUrl } from "./url";

/**
 * `ClipPurpose` from src/db/schema.ts, restated so the Worker compiles this
 * file without the schema. telegram.test.ts fails typecheck if the two drift.
 */
export type CapturePurpose = "inspo" | "competitor" | "fact_check" | "own" | "learn" | "other";
type ClipPurpose = CapturePurpose;

/** Hashtag (lower-case) → purpose. `fact_check`/`fact-check` are spellings people type too. */
const PURPOSE_TAGS: Readonly<Record<string, ClipPurpose>> = {
  inspo: "inspo",
  competitor: "competitor",
  factcheck: "fact_check",
  fact_check: "fact_check",
  "fact-check": "fact_check",
  own: "own",
  // Build 4 (§3.E, the aiinsights merge): an AI tool or lesson to try.
  learn: "learn",
  ai: "learn",
};

export type CaptureMessage = {
  /** Canonical URL of the first link, or null when the message has none (or it is not http(s)). */
  url: string | null;
  /** The first link exactly as written, for replies and debugging. */
  rawUrl: string | null;
  /** A brand id from `brandAliases`, or null when no hashtag named one. */
  brandId: string | null;
  /** Null when no purpose hashtag was given — the caller decides the default. */
  purpose: ClipPurpose | null;
  tags: string[];
  /** The remaining text, or null when nothing is left. */
  note: string | null;
};

const URL_PATTERN = /https?:\/\/[^\s<>"]+/i;
/** Punctuation a sentence puts after a link, which is not part of it. */
const TRAILING_PUNCTUATION = /[).,!?;:'"\]]+$/;
const HASHTAG_PATTERN = /(^|\s)#([\p{L}\p{N}_-]+)/gu;

/**
 * Parse one capture message.
 *
 * `brandAliases` maps a lower-case alias to a brand id. A brand id is matched
 * by itself too: every value of the map counts as its own alias, so the
 * caller passes `{ guia: "guide" }` and `#guide` works as well. A brand with
 * no aliases is passed as `{ pozo: "pozo" }`.
 */
export function parseCaptureMessage(
  text: string,
  brandAliases: Readonly<Record<string, string>>,
): CaptureMessage {
  const aliases = new Map<string, string>();
  for (const [alias, brandId] of Object.entries(brandAliases)) {
    aliases.set(brandId.toLowerCase(), brandId);
    aliases.set(alias.toLowerCase(), brandId);
  }

  let rest = text ?? "";
  let rawUrl: string | null = null;
  const match = URL_PATTERN.exec(rest);
  if (match) {
    rawUrl = match[0].replace(TRAILING_PUNCTUATION, "");
    rest = rest.slice(0, match.index) + rest.slice(match.index + rawUrl.length);
  }

  let brandId: string | null = null;
  let purpose: ClipPurpose | null = null;
  const tags: string[] = [];

  rest = rest.replace(HASHTAG_PATTERN, (_whole, lead: string, name: string) => {
    const key = name.toLowerCase();
    const asPurpose = PURPOSE_TAGS[key];
    const asBrand = aliases.get(key);
    if (asPurpose) {
      purpose ??= asPurpose;
    } else if (asBrand && brandId === null) {
      brandId = asBrand;
    } else if (!tags.includes(key)) {
      tags.push(key);
    }
    return lead;
  });

  const note = rest
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return {
    url: rawUrl ? canonicalClipUrl(rawUrl) : null,
    rawUrl,
    brandId,
    purpose,
    tags,
    note: note || null,
  };
}
