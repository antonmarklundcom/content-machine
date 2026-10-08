/**
 * Fact sheet freshness (build 2b, idea 3). Pure, no clock of its own — the
 * caller passes `now` — so both rules are unit-tested without a database.
 *
 *  - **Stale fact:** last checked more than 90 days ago. The badge says "check
 *    this again", not "this is wrong".
 *  - **Script that may need a correction:** a *posted* script cites a URL (in
 *    its `sources`) that is also some fact's `sourceUrl`, and that fact was
 *    updated — its claim or source edited — after the script was posted. What
 *    the video says was true when it went out; the sheet has moved on since.
 *
 * URLs are compared after `normalizeUrl`, so a trailing slash, a `#fragment`
 * or the host's case do not hide a match. Path and query stay significant —
 * two pages of one site are two sources.
 */

/** A fact not checked for longer than this is flagged on the sheet. */
export const STALE_AFTER_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when `lastCheckedAt` is more than `days` before `now`. */
export function isFactStale(
  lastCheckedAt: Date,
  now: Date,
  days: number = STALE_AFTER_DAYS,
): boolean {
  return now.getTime() - lastCheckedAt.getTime() > days * DAY_MS;
}

/**
 * The comparable form of a URL: lower-case scheme and host, no fragment, no
 * trailing slash on the path. Something that does not parse as a URL is only
 * trimmed, so two identical odd strings still match each other.
 */
export function normalizeUrl(value: string): string {
  const text = value.trim();
  try {
    const url = new URL(text);
    url.hash = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return text;
  }
}

/** The fields of a fact the out-of-date check reads. */
export type StalenessFact = {
  id: number;
  claim: string;
  sourceUrl: string | null;
  updatedAt: Date;
};

/** The fields of a script the out-of-date check reads. */
export type StalenessScript = {
  id: number;
  title: string;
  status: string;
  postedAt: Date | null;
  /** Every `sources[].url` in the script body. */
  sourceUrls: readonly string[];
};

export type ScriptNeedingCorrection = {
  scriptId: number;
  title: string;
  postedAt: Date;
  /** The facts that changed after posting, oldest change first. */
  facts: Array<{ id: number; claim: string; sourceUrl: string; updatedAt: Date }>;
};

/**
 * Posted scripts that cite a fact's source which changed after posting, most
 * recently posted first. A script that is not `posted` (or has no `postedAt`)
 * is never flagged — it can still be fixed before it goes out.
 */
export function scriptsNeedingCorrection(
  scripts: readonly StalenessScript[],
  facts: readonly StalenessFact[],
): ScriptNeedingCorrection[] {
  const factsByUrl = new Map<string, StalenessFact[]>();
  for (const fact of facts) {
    if (!fact.sourceUrl?.trim()) continue;
    const key = normalizeUrl(fact.sourceUrl);
    const list = factsByUrl.get(key) ?? [];
    list.push(fact);
    factsByUrl.set(key, list);
  }

  const flagged: ScriptNeedingCorrection[] = [];
  for (const script of scripts) {
    if (script.status !== "posted" || !script.postedAt) continue;
    const postedAt = script.postedAt;
    const changed = new Map<number, StalenessFact>();
    for (const url of script.sourceUrls) {
      for (const fact of factsByUrl.get(normalizeUrl(url)) ?? []) {
        if (fact.updatedAt.getTime() > postedAt.getTime()) changed.set(fact.id, fact);
      }
    }
    if (!changed.size) continue;
    flagged.push({
      scriptId: script.id,
      title: script.title,
      postedAt,
      facts: [...changed.values()]
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id - b.id)
        .map((f) => ({
          id: f.id,
          claim: f.claim,
          sourceUrl: f.sourceUrl as string,
          updatedAt: f.updatedAt,
        })),
    });
  }
  return flagged.sort(
    (a, b) => b.postedAt.getTime() - a.postedAt.getTime() || b.scriptId - a.scriptId,
  );
}
