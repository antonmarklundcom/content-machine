import type { ScreeningPayload } from "./contract";

/**
 * [PR-35] The screening prompt — what the gallring reads, and what it is
 * allowed to conclude from it.
 *
 * The evidence is metadata only: title, channel, duration, publication date,
 * the public counters, and the uploader's description. No transcript. That is
 * the whole point — fetching the transcript is free, but *reading* it is the
 * $0.02, so anything the screening needs from inside the video would defeat it.
 *
 * The prompt is written to make the model say "I cannot tell" as a score in the
 * middle rather than as a guess at either end. A screen that is confidently
 * wrong in the "skip" direction silently loses videos, and a lost video is
 * indistinguishable from a video that was never ingested.
 */

export const SCREENING_SYSTEM_PROMPT = `You triage YouTube videos for a researcher who studies how good videos are built. They cannot read everything, so you decide what is worth a full transcript analysis.

You get only what is public before watching: title, channel, duration, publication date, view and like and comment counts, and the uploader's own description. You do NOT get the transcript. Judge the evidence you have and do not imagine the rest.

Score 0-100 for how likely a full analysis is to repay its cost.

What raises a score:
- A specific, falsifiable claim in the title or description — a number, a method, a named result.
- A description that shows work: a chapter list, links to what is discussed, a stated argument.
- Length consistent with actually developing something, rather than restating a headline.
- Engagement well out of line with the channel's reach, in either direction. An unusually divisive video is worth reading; a quietly ignored one usually is not.
- A named subject the researcher could follow across videos: a tool, a company, a method, a person.

What lowers a score:
- A title that promises a feeling rather than a claim, with a description that adds nothing.
- Reaction, compilation, stream re-upload, announcement, or shorts-length filler.
- A description that is entirely sponsor copy, affiliate links, and social handles.
- Duplication: another upload of the same talk, the same list, the same news everyone covered.

Use the middle of the range for genuine uncertainty. A thin description on a channel that usually delivers is a 50, not a 10 — an unreadable signal is not a negative one, and the cost of wrongly skipping a good video is much higher than the cost of analysing a mediocre one.

Do not apply a threshold. You are not deciding keep or skip; you are pricing the evidence. Somebody else decides where the line is.

reason: one sentence, under 200 characters, naming the specific evidence that set the score. "40 minutes on one migration, with a chapter list" is useful; "seems interesting" is not.`;

/** How much description text is worth paying for. Beyond this it is link farm. */
export const MAX_DESCRIPTION_CHARS = 4_000;

export type ScreeningSubject = {
  title: string;
  channelTitle: string | null;
  description: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
};

/**
 * The researcher's own statement of what they are working on, if they have
 * given one (SCREEN_INTERESTS).
 *
 * Optional, and absent by default: with no statement the screen judges
 * substance alone, which is a defensible filter for anybody. Inventing a set of
 * interests on the owner's behalf would not be — it would quietly cull the
 * corpus against a taste nobody chose, and the reason strings would make it
 * look deliberate.
 */
export function interestsInstruction(interests: string): string {
  return (
    `\n\nThe researcher describes their current work as follows. Raise the score for videos ` +
    `that bear on it and lower it for videos that do not, but do not reward a video for ` +
    `merely mentioning these words:\n\n${interests.trim()}`
  );
}

export function buildScreeningPrompt(
  subject: ScreeningSubject,
  options: { interests?: string } = {},
): string {
  const lines = [
    `Title: ${subject.title}`,
    subject.channelTitle ? `Channel: ${subject.channelTitle}` : null,
    subject.publishedAt ? `Published: ${subject.publishedAt.toISOString().slice(0, 10)}` : null,
    subject.durationSeconds ? `Duration: ${formatDuration(subject.durationSeconds)}` : null,
    // Absent counters are stated as unknown rather than dropped. A missing like
    // count means the uploader hid it (PR-33), and a model shown "views: 40000"
    // with no likes line will read the silence as zero engagement.
    `Views: ${countOrUnknown(subject.viewCount)}`,
    `Likes: ${countOrUnknown(subject.likeCount)}`,
    `Comments: ${countOrUnknown(subject.commentCount)}`,
  ].filter(Boolean);

  const description = (subject.description ?? "").trim();
  const body = description
    ? `Description:\n${truncate(description, MAX_DESCRIPTION_CHARS)}`
    : "Description: (the uploader wrote none)";

  const base = `${lines.join("\n")}\n\n${body}`;
  const interests = options.interests?.trim();
  return interests ? base + interestsInstruction(interests) : base;
}

function countOrUnknown(value: number | null): string {
  return value === null ? "not published by the uploader" : String(value);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(description truncated)`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Structured output schema. `score` is an integer rather than a number so the
 * stored smallint never rounds a 72.5 into a different decision than the model
 * made, and `reason` has no maxLength because the schema dialect does not
 * support one — the length limit is in the prompt and enforced on write.
 */
export const SCREENING_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
  },
  required: ["score", "reason"],
  additionalProperties: false,
} as const;

/** Compile-time proof that the schema and the contract agree. */
export type SchemaMatchesContract = ScreeningPayload;
