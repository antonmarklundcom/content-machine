import { isDefaultLanguage, type AnalysisPayload } from "./contract";

/**
 * The analysis prompt (PLAN.md §4). Versioned via ANALYSIS_PROMPT_VERSION in
 * contract.ts — bump it when a change here alters the meaning of stored output,
 * so old analyses stay interpretable.
 *
 * The system prompt is byte-identical across every video, which is what makes
 * it cacheable; the transcript goes in the user turn, after the cache
 * breakpoint. See CACHE_NOTE below for why that matters less than PLAN.md §1.4
 * assumes.
 */

export const ANALYSIS_SYSTEM_PROMPT = `You analyse YouTube video transcripts for a researcher who studies how successful videos are built. They read your analysis instead of watching the video, so it has to carry the weight the video would have.

You will receive a transcript, usually auto-generated from captions. It has no speaker labels, no punctuation you can trust, and no visual information. Work with what the words tell you and do not speculate about anything on screen.

Write for someone who already knows the subject area. Skip throat-clearing, skip restating the title, and do not praise the video. Specifics beat adjectives everywhere: "opens by naming a number the viewer will not believe" is useful, "great hook" is not.

For each field:

summary — What the video actually argues or teaches, in a few sentences. The thesis and the shape of the case, not a list of topics covered.

takeaways — The concrete claims a viewer would leave with. Each one should stand alone and be worth disagreeing with. Prefer the specific over the safe.

hook — How the first thirty seconds earn the next thirty. technique names the mechanism (open loop, contrarian claim, stakes escalation, demonstration, and so on). first_30s quotes or closely paraphrases what is actually said. why_it_works explains the mechanism in terms of what the viewer wants or fears.

timeline — The beats of the video in order. ts is a timestamp label like "04:15"; if the transcript gives you no reliable timing, estimate from position and keep going rather than omitting the field. Each beat should mark a genuine turn in the argument, not an arbitrary interval.

gaps — Where the video is weak, unsupported, or conveniently silent. counter_angle is the video someone could make in response. This section is the most valuable one and the easiest to fill with padding, so leave it short rather than inventing weaknesses.

ideas — Videos worth making, informed by this one but not copies of it. why_now should point at something real about the current moment, not a generic claim that the topic is popular.

topics — Three to six subjects this video is about, at the level you would use to shelve it next to other videos. Write them as a reader would search for them: "local SEO", "prompt engineering", "cold email". Not the title, not a summary, not one-off specifics that will never recur. Reuse the obvious common phrasing rather than inventing a precise new label — these are only useful when the same subject in two videos produces the same string.

entities — The named things the video actually discusses: tools, products, companies, people. Use the name as it is normally written ("Next.js", "Claude Code", "GoHighLevel"). Include something only if the video engages with it, not because it appeared once in a list. If the video names nothing, return an empty array rather than padding it with the channel or the host.

content_type — The shape of the video, lowercase, one of: tutorial, case study, news, opinion, interview, review, listicle, demo, talk. If it is genuinely none of these, write the closest short label instead of forcing a fit.

Base everything on the transcript. If it is too short, truncated, or garbled to support a field, say so plainly in that field rather than inventing content.`;

/**
 * Whether the system prompt is long enough to actually cache on this model.
 *
 * Below the model's minimum, caching simply does not engage — no error, no
 * cached-token count. The Gemini 3 family's minimum is 4096 tokens and this
 * prompt is well under it, so PLAN.md §1.4's prompt-caching saving does not
 * currently apply. (Gemini has no cache breakpoint to set either way: caching
 * is implicit, on a shared prefix.) See docs/PR-06-ANALYSIS.md.
 */
export const CACHE_NOTE =
  "Prompt caching cannot engage on the Gemini 3 models unless the shared " +
  "prefix exceeds 4096 tokens. Verify with cachedContentTokenCount.";

/**
 * The instruction appended for a non-English run (PR-22b).
 *
 * It goes in the user turn, after the transcript, rather than in the system
 * prompt: the system prompt is the cacheable half and must stay byte-identical
 * across every video, and a trailing instruction is also the position a model
 * weights most heavily.
 */
export function languageInstruction(language: string): string {
  return `\n\nRespond in ${language}. Every field of the JSON must be written in ${language}, except timestamps.`;
}

/**
 * When `language` is absent or "en" the output is byte-identical to what this
 * function returned before PR-22b, which is asserted by a test.
 *
 * That byte-identity is about the *user* turn only, and it is no longer what
 * decides the stored version: PR-34 changed the system prompt, so every English
 * run is version 2 regardless of what this function returns. The invariant is
 * still worth keeping — it is what makes the language parameter provably inert
 * when unused — but it is no longer load-bearing for version accounting.
 */
export function buildUserPrompt(input: {
  title: string;
  channelTitle: string | null;
  durationSeconds: number | null;
  transcript: string;
  language?: string;
}): string {
  const meta = [
    `Title: ${input.title}`,
    input.channelTitle ? `Channel: ${input.channelTitle}` : null,
    input.durationSeconds ? `Duration: ${formatDuration(input.durationSeconds)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const base = `${meta}\n\nTranscript:\n\n${input.transcript}`;
  return isDefaultLanguage(input.language) ? base : base + languageInstruction(input.language!);
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
 * JSON Schema for the §4 contract, used with structured outputs so the model is
 * constrained to this shape rather than merely asked for it.
 *
 * Every object needs `additionalProperties: false` and a complete `required`
 * list; length and count constraints are not supported and are expressed in the
 * prompt instead.
 */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    takeaways: { type: "array", items: { type: "string" } },
    hook: {
      type: "object",
      properties: {
        technique: { type: "string" },
        first_30s: { type: "string" },
        why_it_works: { type: "string" },
      },
      required: ["technique", "first_30s", "why_it_works"],
      additionalProperties: false,
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ts: { type: "string" },
          topic: { type: "string" },
          beat: { type: "string" },
        },
        required: ["ts", "topic", "beat"],
        additionalProperties: false,
      },
    },
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          gap: { type: "string" },
          counter_angle: { type: "string" },
        },
        required: ["gap", "counter_angle"],
        additionalProperties: false,
      },
    },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          premise: { type: "string" },
          why_now: { type: "string" },
        },
        required: ["title", "premise", "why_now"],
        additionalProperties: false,
      },
    },
    // [PR-34] Plain string arrays, and content_type is a plain string rather
    // than an enum. The vocabulary lives in the prompt, where an unusual video
    // produces an unusual label; as a schema enum it would produce a hard
    // validation failure and cost the whole analysis over a taxonomy quibble.
    topics: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: { type: "string" } },
    content_type: { type: "string" },
  },
  required: [
    "summary",
    "takeaways",
    "hook",
    "timeline",
    "gaps",
    "ideas",
    "topics",
    "entities",
    "content_type",
  ],
  additionalProperties: false,
} as const;

/** Compile-time proof that the schema and the frozen contract agree. */
export type SchemaMatchesContract = AnalysisPayload;
