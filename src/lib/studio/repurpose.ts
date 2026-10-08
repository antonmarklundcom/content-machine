import type { Brand, ScriptDerivativeKind } from "@/db/schema";
import { structuredJson } from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import {
  SCRIPT_BODY_VERSION,
  THUMBNAIL_CONCEPT_COUNT,
  TITLE_OPTION_COUNT,
  validateScriptBody,
  type BrollShot,
  type ScriptBodyV1,
  type ScriptLanguage,
} from "@/lib/scripts/contract";
import { spokenText } from "./pack";

/**
 * Repurposing (build 2b, idea 7): one recorded long video becomes 3–5 shorts
 * (each a full `ScriptBodyV1`, so the studio, the teleprompter and the shot
 * list work on them unchanged), a blog post and a newsletter blurb. Every
 * model call goes through `structuredJson`, so subscription mode (§1.38)
 * works here too.
 */

export const SHORTS_MIN = 3;
export const SHORTS_MAX = 5;
/** A short is read in about a minute: 150 wpm. */
export const SHORT_TARGET_MINUTES = 1;
export const SHORT_MAX_WORDS = 170;

const SHORTS_MAX_OUTPUT_TOKENS = 8_000;
const PROSE_MAX_OUTPUT_TOKENS = 6_000;
const THINKING_TOKENS = 2_000;
const PROMPT_OVERHEAD_TOKENS = 6_000;

function estimateUsd(outputTokens: number): number {
  return costUsdAtRates(ideationRates(process.env.GEMINI_MODEL ?? "gemini-3.7-flash"), {
    inputTokens: PROMPT_OVERHEAD_TOKENS,
    outputTokens: outputTokens + THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export class RepurposeError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "RepurposeError";
  }
}

const LANGUAGE_NAMES: Record<ScriptLanguage, string> = {
  en: "English",
  "es-PY": "Paraguayan Spanish (castellano paraguayo, voseo)",
  jopara: "Jopara (Paraguayan Spanish with common Guaraní words mixed in)",
};

export type RepurposeInput = {
  brand: Pick<Brand, "name" | "niche" | "market" | "voice">;
  title: string;
  youtubeUrl: string | null;
  body: ScriptBodyV1;
};

function brandLines(input: RepurposeInput): string {
  const { brand } = input;
  return `Brand: ${brand.name} (${brand.niche}), market: ${brand.market}
Voice: ${brand.voice ?? "plain, concrete, no hype"}
Language: ${LANGUAGE_NAMES[input.body.language] ?? input.body.language}
Long video title: ${input.title}${input.youtubeUrl ? `\nLong video URL: ${input.youtubeUrl}` : ""}`;
}

function sourcesBlock(body: ScriptBodyV1): string {
  if (!body.sources.length) return "SOURCES: none.";
  return `SOURCES (cite by id; never add new ones):\n${body.sources.map((s) => `- ${s.id}: ${s.claim}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// shorts
// ---------------------------------------------------------------------------

const SHORT_BROLL_SCHEMA = {
  type: "object",
  properties: {
    spokenLine: {
      type: "string",
      description: "The exact spoken line (copied from spokenLines) this shot plays under.",
    },
    description: {
      type: "string",
      description: "What the shot shows, in a few words, in English.",
    },
    imagePrompt: {
      type: "string",
      description:
        "English prompt for a vertical 9:16 image: subject, setting, light, camera. Photographic, no text, no real people's likenesses.",
    },
    videoPrompt: {
      type: "string",
      description: "English image-to-video motion prompt, or an empty string for a still.",
    },
  },
  required: ["spokenLine", "description", "imagePrompt", "videoPrompt"],
} as const;

const LINES = { type: "array", items: { type: "string" } } as const;

export const SHORTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    shorts: {
      type: "array",
      minItems: SHORTS_MIN,
      maxItems: SHORTS_MAX,
      items: {
        type: "object",
        properties: {
          titleOptions: {
            type: "array",
            minItems: TITLE_OPTION_COUNT,
            maxItems: TITLE_OPTION_COUNT,
            description: "The short's title first, then two alternatives.",
            items: {
              type: "object",
              properties: { title: { type: "string" }, angle: { type: "string" } },
              required: ["title", "angle"],
            },
          },
          thumbnailConcepts: {
            type: "array",
            minItems: THUMBNAIL_CONCEPT_COUNT,
            maxItems: THUMBNAIL_CONCEPT_COUNT,
            description: "Cover-frame ideas for the short.",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                textOverlay: { type: "string" },
                imagePrompt: {
                  type: "string",
                  description: "English, vertical 9:16, no text in the image.",
                },
              },
              required: ["description", "textOverlay", "imagePrompt"],
            },
          },
          hookLines: {
            ...LINES,
            description: "1-2 spoken lines that stop the scroll in the first 2 seconds.",
          },
          hookOnScreenText: LINES,
          heading: { type: "string", description: "What this short is about, a few words." },
          spokenLines: { ...LINES, description: "The body: short spoken lines, one idea each." },
          talkingPoints: LINES,
          onScreenText: LINES,
          broll: { type: "array", items: SHORT_BROLL_SCHEMA, description: "2-4 vertical shots." },
          sourceIds: {
            ...LINES,
            description: "Ids from SOURCES backing a claim made in this short.",
          },
          ctaLines: { ...LINES, description: "One spoken line pointing to the long video." },
        },
        required: [
          "titleOptions",
          "thumbnailConcepts",
          "hookLines",
          "hookOnScreenText",
          "heading",
          "spokenLines",
          "talkingPoints",
          "onScreenText",
          "broll",
          "sourceIds",
          "ctaLines",
        ],
      },
    },
  },
  required: ["shorts"],
} as const;

type RawShot = {
  spokenLine?: string;
  description?: string;
  imagePrompt?: string;
  videoPrompt?: string | null;
};
export type RawShort = {
  titleOptions?: { title: string; angle: string }[];
  thumbnailConcepts?: { description: string; textOverlay: string; imagePrompt: string }[];
  hookLines?: string[];
  hookOnScreenText?: string[];
  heading?: string;
  spokenLines?: string[];
  talkingPoints?: string[];
  onScreenText?: string[];
  broll?: RawShot[];
  sourceIds?: string[];
  ctaLines?: string[];
};

function clean(lines: unknown): string[] {
  return Array.isArray(lines)
    ? lines
        .filter((l): l is string => typeof l === "string")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
}

function shots(list: RawShot[] | undefined): BrollShot[] {
  return (list ?? []).map((b) => ({
    spokenLine: String(b.spokenLine ?? "").trim(),
    description: String(b.description ?? "").trim(),
    imagePrompt: String(b.imagePrompt ?? "").trim(),
    videoPrompt: b.videoPrompt?.trim() ? b.videoPrompt.trim() : null,
    // Shorts are vertical whatever the model says (it is not asked).
    aspectRatio: "9:16",
  }));
}

/**
 * One short from the model → a contract body. Sources are the parent's, only
 * the ones this short cites (an unknown id is dropped, never invented).
 */
export function assembleShortBody(raw: RawShort, parent: ScriptBodyV1): ScriptBodyV1 {
  const parentSources = new Map(parent.sources.map((s) => [s.id, s]));
  const sourceIds = [...new Set(clean(raw.sourceIds).filter((id) => parentSources.has(id)))];
  const titleOptions = (raw.titleOptions ?? []).map((o) => ({
    title: String(o?.title ?? "").trim(),
    angle: String(o?.angle ?? "").trim(),
  }));
  const chosenTitle = titleOptions[0]?.title ?? "";
  return {
    version: SCRIPT_BODY_VERSION,
    language: parent.language,
    topic: `${parent.topic} — ${String(raw.heading ?? chosenTitle).trim()}`,
    chosenTitle,
    targetMinutes: SHORT_TARGET_MINUTES,
    titleOptions,
    thumbnailConcepts: (raw.thumbnailConcepts ?? []).map((t) => ({
      description: String(t?.description ?? "").trim(),
      textOverlay: String(t?.textOverlay ?? "").trim(),
      imagePrompt: String(t?.imagePrompt ?? "").trim(),
    })),
    hook: {
      spokenLines: clean(raw.hookLines),
      onScreenText: clean(raw.hookOnScreenText),
      broll: [],
    },
    sections: [
      {
        heading: String(raw.heading ?? "").trim() || chosenTitle,
        spokenLines: clean(raw.spokenLines),
        talkingPoints: clean(raw.talkingPoints),
        onScreenText: clean(raw.onScreenText),
        broll: shots(raw.broll),
        sourceIds,
      },
    ],
    cta: { spokenLines: clean(raw.ctaLines), onScreenText: [] },
    sources: sourceIds.map((id) => parentSources.get(id)!),
  };
}

export function shortsPrompt(input: RepurposeInput): { system: string; prompt: string } {
  const system = `You cut a recorded long YouTube video into vertical shorts (YouTube Shorts, Reels, TikTok). Each short stands alone: one idea from the long video, a hook in the first two seconds, about ${SHORT_TARGET_MINUTES} minute spoken (at most ${SHORT_MAX_WORDS} words in total), and one closing line pointing to the long video. Re-use the script's facts and wording where it is strong; never add a fact that is not in the script, and cite the script's own source ids for any factual claim. Spoken lines are short, one idea per line. B-roll is vertical 9:16, English prompts, photographic, no text in the image. Answer with JSON matching the required schema and nothing else.`;
  const prompt = `${brandLines(input)}

THE LONG SCRIPT AS SPOKEN:
${spokenText(input.body)}

${sourcesBlock(input.body)}

Write ${SHORTS_MIN}-${SHORTS_MAX} shorts, each on a different idea from the script, in the script's language (image and video prompts in English).`;
  return { system, prompt };
}

/**
 * 3–5 short scripts from a long one. Each is validated against the contract;
 * a short that fails is left out and its errors returned, so one bad short
 * does not waste the call. None valid → RepurposeError.
 */
export async function generateShorts(
  input: RepurposeInput,
): Promise<{ shorts: ScriptBodyV1[]; rejected: string[][]; costUsd: number }> {
  const { system, prompt } = shortsPrompt(input);
  const { text, costUsd, finishReason } = await structuredJson({
    system,
    prompt,
    schema: SHORTS_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimateUsd(SHORTS_MAX_OUTPUT_TOKENS),
    maxOutputTokens: SHORTS_MAX_OUTPUT_TOKENS,
  });
  let raw: { shorts?: RawShort[] };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    throw new RepurposeError(
      `The model didn't return parseable shorts (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  const shorts: ScriptBodyV1[] = [];
  const rejected: string[][] = [];
  for (const item of (raw?.shorts ?? []).slice(0, SHORTS_MAX)) {
    let body: ScriptBodyV1;
    try {
      body = assembleShortBody(item ?? {}, input.body);
    } catch (err) {
      rejected.push([err instanceof Error ? err.message : String(err)]);
      continue;
    }
    const verdict = validateScriptBody(body);
    if (verdict.ok) shorts.push(body);
    else rejected.push(verdict.errors);
  }
  if (!shorts.length) {
    throw new RepurposeError(
      "None of the model's shorts matched the script contract. Try again.",
      rejected.flat(),
    );
  }
  return { shorts, rejected, costUsd };
}

// ---------------------------------------------------------------------------
// blog post + newsletter blurb
// ---------------------------------------------------------------------------

export const PROSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    markdown: {
      type: "string",
      description: "The whole text in Markdown. No sources section — it is added separately.",
    },
  },
  required: ["markdown"],
} as const;

const PROSE_BRIEF: Record<ScriptDerivativeKind, string> = {
  blog: `a blog post for the brand's website (600-1200 words): a "# " title (it may differ from the video title), a short intro, "## " sections following the script's order, and a closing paragraph that invites the reader to watch the video. Written to be read, not a transcript: full sentences, no teleprompter line breaks. Link claims to sources inline as [text](url) only using the URLs in SOURCES.`,
  newsletter: `a newsletter blurb (80-150 words): a bold one-line hook, two or three sentences on what the video explains and why it matters now, and a last line linking to the video. Friendly, personal, first person.`,
};

export function prosePrompt(
  kind: ScriptDerivativeKind,
  input: RepurposeInput,
): { system: string; prompt: string } {
  const system = `You turn a creator's recorded YouTube script into ${kind === "blog" ? "a blog post" : "a newsletter blurb"}. Write in the script's language. Never add a fact, price, law or date that is not in the script. Answer with JSON matching the required schema and nothing else.`;
  const urls = input.body.sources.map((s) => `- ${s.id}: ${s.claim} (${s.url})`).join("\n");
  const prompt = `${brandLines(input)}

THE SCRIPT AS SPOKEN:
${spokenText(input.body)}

SOURCES:
${urls || "none"}

Write ${PROSE_BRIEF[kind]}${input.youtubeUrl ? ` The video is at ${input.youtubeUrl}.` : " The video URL is not known yet: write [VIDEO LINK] where it goes."}`;
  return { system, prompt };
}

/**
 * The model's Markdown, then (for a blog post) a sources list built from the
 * script, so every URL shown is one the script already cites.
 */
export function composeProse(
  kind: ScriptDerivativeKind,
  markdown: string,
  body: ScriptBodyV1,
): string {
  const text = markdown.trim();
  if (kind !== "blog" || !body.sources.length) return text;
  const heading = body.language === "en" ? "Sources" : "Fuentes";
  return `${text}\n\n## ${heading}\n\n${body.sources.map((s) => `- [${s.title || s.claim}](${s.url})`).join("\n")}`;
}

export async function generateProse(
  kind: ScriptDerivativeKind,
  input: RepurposeInput,
): Promise<{ markdown: string; costUsd: number }> {
  const { system, prompt } = prosePrompt(kind, input);
  const { text, costUsd, finishReason } = await structuredJson({
    system,
    prompt,
    schema: PROSE_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimateUsd(PROSE_MAX_OUTPUT_TOKENS),
    maxOutputTokens: PROSE_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });
  let raw: { markdown?: unknown };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    throw new RepurposeError(
      `The model didn't return parseable text (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  const markdown = typeof raw?.markdown === "string" ? raw.markdown : "";
  if (!markdown.trim()) throw new RepurposeError("The model returned an empty text. Try again.");
  return { markdown: composeProse(kind, markdown, input.body), costUsd };
}
