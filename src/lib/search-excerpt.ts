/**
 * Why a video matched a search (PR-30).
 *
 * A hit inside an analysis used to render identically to a title match, so the
 * reason a video was in the results was invisible — the most common confusion
 * with search over text nobody has read. Pure functions, because this is string
 * arithmetic and belongs in tests rather than in a page.
 */

/** Where the match came from. Title wins when both match: it is what is on screen. */
export type MatchField = "title" | "analysis";

export type SearchMatch = {
  field: MatchField;
  /** A window of the analysis around the needle. Null when there is nothing to show. */
  excerpt: string | null;
};

const RADIUS = 60;

/**
 * A window of `text` around the first occurrence of `needle`, with ellipses
 * where it was cut.
 *
 * Case-insensitive to match the SQL LIKE that selected the row (MySQL's default
 * collation is case-insensitive), so a row that matched in the database never
 * comes back "no excerpt" here for a reason the user can see.
 */
export function excerptAround(
  text: string | null | undefined,
  needle: string,
  radius: number = RADIUS,
): string | null {
  if (!text || !needle) return null;
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;

  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  // Collapse whitespace: summaries wrap, and a newline mid-excerpt renders as a
  // gap that looks like missing text.
  const window = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${window}${end < text.length ? "…" : ""}`;
}

/**
 * Decide what to tell the reader about a match.
 *
 * Returns null when there is no query — the feed is then a list, not results,
 * and "matched in title" under every card would be noise.
 */
export function describeMatch(
  q: string | undefined,
  title: string,
  analysisSummary: string | null | undefined,
): SearchMatch | null {
  const needle = q?.trim();
  if (!needle) return null;
  if (title.toLowerCase().includes(needle.toLowerCase())) return { field: "title", excerpt: null };
  // The row matched something — the query is what selected it — but the hit may
  // be in takeaways or ideas rather than the summary, in which case there is no
  // excerpt to show and the badge alone has to carry it.
  return { field: "analysis", excerpt: excerptAround(analysisSummary, needle) };
}
