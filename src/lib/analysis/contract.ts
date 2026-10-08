/**
 * PLAN.md §4 — the analysis contract.
 *
 * UNFROZEN ONCE, BY PR-34, AND RE-FROZEN HERE. Read this before adding a field.
 *
 * The freeze was never about the shape being perfect. It was about the fact
 * that changing it costs money: every analysis already stored was paid for
 * under the old prompt, and a new field means either re-analysing the corpus to
 * fill it or living with a column that is null for everything older than the
 * change. PR-34 is the one moment that cost is zero — no analysis has ever been
 * run against the real API, so the corpus to re-analyse is empty.
 *
 * That window closes the first time the live app pays for a batch. After that,
 * adding a field here is a spend decision, not a code decision, and it belongs
 * in a plan rather than in a pull request.
 *
 * This is the interface the Opus track (PR-06 produces it) and the Sonnet track
 * (PR-10 renders it) share. Types live here rather than in the schema or the
 * prompt module because both of those depend on them, and because the UI track
 * needs to import them without pulling in a database connection.
 *
 * The model returns strict JSON in exactly this shape — no prose, no markdown
 * fences. PR-06 parses defensively and stores the raw response on failure
 * rather than crashing the batch.
 */

export type AnalysisHook = {
  technique: string;
  first_30s: string;
  why_it_works: string;
};

export type AnalysisTimelineEntry = {
  /** "MM:SS" or "HH:MM:SS". Kept as a string — it is a display label, not a duration. */
  ts: string;
  topic: string;
  beat: string;
};

export type AnalysisGap = {
  gap: string;
  counter_angle: string;
};

export type AnalysisIdea = {
  title: string;
  premise: string;
  why_now: string;
};

/** Exactly the JSON object the model returns. */
export type AnalysisPayload = {
  summary: string;
  takeaways: string[];
  hook: AnalysisHook;
  timeline: AnalysisTimelineEntry[];
  gaps: AnalysisGap[];
  ideas: AnalysisIdea[];

  /**
   * [PR-34] Open-ended subject tags — what the video is *about*, at the level
   * you would use to shelve it.
   *
   * PLAN.md §7 sized topic intelligence as a query over stored analyses rather
   * than a re-ingest, and reserved the `topics` / `video_topics` tables for it.
   * What §7 never noticed — and docs/HANDOFF-ROUND-3.md §3 eventually caught —
   * is that nothing produced topics in the first place: the contract had no
   * field, so the tables could only ever have stayed empty. This is that field.
   *
   * No topic is hardcoded anywhere (§7), and none ever should be. The whole
   * value is that the corpus tells you what it is about instead of being sorted
   * into categories chosen before the first video was read.
   *
   * Distinct from `timeline[].topic`, which labels a passage within one video
   * and is far too granular to group across the corpus.
   */
  topics: string[];

  /**
   * [PR-34] Named things the video actually discusses — tools, products,
   * companies, people.
   *
   * Kept separate from `topics` because they answer different questions. A
   * topic is what to read next; an entity is what the market is talking about.
   * "When did people start mentioning this tool, and who mentioned it first"
   * is not a question topics can answer, and it is the question most likely to
   * change what its reader does next.
   *
   * Flat strings rather than {name, kind} pairs. A kind field would have to be
   * either a hardcoded vocabulary — the thing §7 forbids — or a free string
   * nobody groups on, and the query that matters ("which videos mention X")
   * needs neither.
   */
  entities: string[];

  /**
   * [PR-34] The shape of the video: tutorial, case study, news, opinion,
   * interview, review, and so on.
   *
   * Grouping by topic alone produces shelves too wide to act on — "everything
   * about SEO" is not a reading list. Crossed with content_type it becomes one:
   * "case studies about SEO" is six videos and an afternoon.
   *
   * A plain string, not an enum. The prompt suggests a vocabulary and the model
   * follows it closely, but a schema enum would hard-fail a video that is
   * genuinely something else, and losing a whole analysis to a taxonomy quibble
   * is a worse outcome than an occasional one-off label.
   */
  content_type: string;
};

/**
 * Bump when the prompt changes in a way that alters the meaning of stored
 * output, so old analyses stay interpretable rather than silently mixing
 * conventions. Stored per row as `analyses.prompt_version`.
 *
 * 1 — PR-06 through PR-32. summary/takeaways/hook/timeline/gaps/ideas.
 * 2 — PR-34 adds topics, entities and content_type. A version-1 row is not
 *     wrong, it is merely untagged: readers must treat those three fields as
 *     absent rather than empty, or a pre-PR-34 analysis looks like a video
 *     about nothing.
 */
export const ANALYSIS_PROMPT_VERSION = 2;

/**
 * Output language (PLAN.md §9 PR-22b) — preparation, not a feature.
 *
 * English is the only language the owner needs today, so there is no UI and no
 * setting. What this buys is that adding one later is a one-line change rather
 * than a change to every prompt builder and their stored-version accounting.
 *
 * The value is a plain language name ("Swedish", "Spanish"), not a BCP-47 tag:
 * it is interpolated into an instruction a model reads, and "sv-SE" is a worse
 * instruction than "Swedish".
 */
export const DEFAULT_PROMPT_LANGUAGE = "en";

export function isDefaultLanguage(language: string | undefined): boolean {
  return language === undefined || language === DEFAULT_PROMPT_LANGUAGE;
}

/**
 * Version 1 is English, and stays byte-identical to everything already stored.
 * Anything else is version 2 — a prompt carrying a language instruction.
 *
 * Which language is not recorded. `analyses` has no column for it, and adding
 * one is a schema change this PR is not approved to make; the version at least
 * marks the row as not-the-English-prompt so it is never silently compared
 * against version 1 output. Whoever adds the UI adds the column.
 */
export function analysisPromptVersion(language?: string): number {
  return isDefaultLanguage(language) ? ANALYSIS_PROMPT_VERSION : ANALYSIS_PROMPT_VERSION + 1;
}

/**
 * The five-part outline structure (PLAN.md §4). Generated per idea, on demand —
 * separate call, separate table, so it never inflates the per-video analysis cost.
 */
export type OutlinePayload = {
  hook: string;
  rehook: string;
  teaching_points: string[];
  twist: string;
  cta: string;
};

export const OUTLINE_PROMPT_VERSION = 1;

/**
 * `outlines` has no prompt_version column, so this is currently informational —
 * it exists so the two prompt families answer the same question the same way,
 * and so the column, when it arrives, has something to store.
 */
export function outlinePromptVersion(language?: string): number {
  return isDefaultLanguage(language) ? OUTLINE_PROMPT_VERSION : OUTLINE_PROMPT_VERSION + 1;
}
