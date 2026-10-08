/** Top navigation. */

export const en = {
  "nav.digest": "Digest",
  "nav.sources": "Sources",
  "nav.ingest": "Ingest",
  "nav.inbox": "Inbox",

  // [PR-34] Cross-corpus grouping (PLAN.md §7).
  "nav.topics": "Topics",

  // [PR-37] Marking. "Mark" rather than "star" or "favourite": the gesture is
  // recording that a passage was interesting, and the star is only its glyph.
  "nav.marks": "Marks",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "nav.digest": "Flöde",
  "nav.sources": "Källor",
  "nav.ingest": "Lägg till",
  "nav.inbox": "Inkorg",

  "nav.topics": "Ämnen",

  "nav.marks": "Markeringar",
};
