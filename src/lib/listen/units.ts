/**
 * [PR-36] The addressable content unit.
 *
 * Listen mode does not play an audio file, so there is no timestamp to seek to.
 * What it plays is a list of *units* — one takeaway, one timeline beat, one
 * idea — spoken one after another. Position is therefore "which unit", not
 * "how many seconds in", and that is the right granularity anyway: the thing a
 * listener wants to come back to is a takeaway, not a moment.
 *
 * This module is the single definition of that list, deliberately pure and
 * database-free: the player (client) walks it to speak, the reading view
 * (server) walks it to hang a star off each section, and PR-37's marks point
 * at `(type, index)` from it. If the two ever disagreed about what unit 3 is,
 * a mark made while listening would land on different text when read back.
 *
 * The order is PLAN.md §4's contract order, which is also the order the
 * reading view renders: summary → takeaways → hook → timeline → gaps → ideas.
 */

import type {
  AnalysisGap,
  AnalysisHook,
  AnalysisIdea,
  AnalysisTimelineEntry,
} from "@/lib/analysis/contract";

/**
 * Singletons (`summary`, `hook`) still carry an index — always 0. A uniform
 * (type, index) address keeps the mark table's primary key one shape instead
 * of two, and costs one always-zero column.
 */
export type UnitType = "summary" | "takeaway" | "hook" | "timeline" | "gap" | "idea";

export const UNIT_TYPES: UnitType[] = ["summary", "takeaway", "hook", "timeline", "gap", "idea"];

export function isUnitType(value: string | undefined): value is UnitType {
  return UNIT_TYPES.some((t) => t === value);
}

export type ContentUnit = {
  type: UnitType;
  index: number;
  /** Stable address, for React keys and for the marks lookup. */
  key: string;
  /**
   * What gets spoken. Multi-field units (the hook, a gap, an idea) are joined
   * into one utterance rather than split, because the fields are one thought:
   * a gap read without its counter-angle is half a sentence.
   */
  text: string;
};

export function unitKey(type: UnitType, index: number): string {
  return `${type}:${index}`;
}

/** Empty strings are not units. A section the model left blank is skipped, not spoken as silence. */
function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Joins the parts of a multi-field unit with a full stop, so a speech engine
 * pauses between them instead of running "technique" into "first 30 seconds".
 */
function sentence(...parts: (string | null | undefined)[]): string {
  return parts
    .map(clean)
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

/**
 * Every field this reads, all optional and all nullable — which is what the
 * database actually hands back. Each JSON column on `analyses` is nullable, and
 * a version-1 row predates three of the contract's fields entirely
 * (contract.ts, ANALYSIS_PROMPT_VERSION). Anything missing produces no units.
 *
 * Written structurally rather than as `Partial<AnalysisPayload>` so this module
 * stays importable from a client component without dragging the schema in.
 */
export type AnalysisUnitSource = {
  summary?: string | null;
  takeaways?: string[] | null;
  hook?: AnalysisHook | null;
  timeline?: AnalysisTimelineEntry[] | null;
  gaps?: AnalysisGap[] | null;
  ideas?: AnalysisIdea[] | null;
};

/** The analysis, flattened into the list to read. */
export function analysisUnits(analysis: AnalysisUnitSource | null | undefined): ContentUnit[] {
  if (!analysis) return [];
  const units: ContentUnit[] = [];

  const push = (type: UnitType, index: number, text: string) => {
    if (!text) return;
    units.push({ type, index, key: unitKey(type, index), text });
  };

  push("summary", 0, clean(analysis.summary));

  // Indexes come from the source array, not from the output list, so skipping
  // an empty takeaway does not renumber the ones after it — a mark stored
  // yesterday has to still point at the same sentence today.
  analysis.takeaways?.forEach((takeaway, i) => push("takeaway", i, clean(takeaway)));

  if (analysis.hook) {
    push(
      "hook",
      0,
      sentence(analysis.hook.technique, analysis.hook.first_30s, analysis.hook.why_it_works),
    );
  }

  analysis.timeline?.forEach((entry, i) =>
    // The timestamp is not spoken. It is a label for the eye, and "zero zero
    // colon four five" in the middle of a sentence is noise in the ear.
    push("timeline", i, sentence(entry?.topic, entry?.beat)),
  );

  analysis.gaps?.forEach((gap, i) => push("gap", i, sentence(gap?.gap, gap?.counter_angle)));

  analysis.ideas?.forEach((idea, i) =>
    push("idea", i, sentence(idea?.title, idea?.premise, idea?.why_now)),
  );

  return units;
}

/** Where a given unit sits in the spoken order, or -1. */
export function indexOfUnit(units: ContentUnit[], type: UnitType, index: number): number {
  return units.findIndex((u) => u.type === type && u.index === index);
}

/**
 * The same thing from an `analyses` row.
 *
 * The row calls the hook column `hook_breakdown` (schema.ts) while the contract
 * calls the field `hook`. One rename in one place, so no caller has to remember
 * which of the two names it is holding.
 */
export function analysisRowUnits(
  row: (AnalysisUnitSource & { hookBreakdown?: AnalysisHook | null }) | null | undefined,
): ContentUnit[] {
  if (!row) return [];
  return analysisUnits({ ...row, hook: row.hook ?? row.hookBreakdown ?? null });
}
