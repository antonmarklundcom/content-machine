import type { Brand } from "@/db/schema";
import { structuredJson } from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import type { ScriptBodyV1 } from "@/lib/scripts/contract";
import { PLAN_WORDS_PER_MINUTE, countWords } from "./plan";
import type { PublishPack } from "./types";

/**
 * The post-recording pack (build 2b, idea 6): everything to paste into YouTube
 * and the social apps once the video is up. The model writes the words; the
 * chapters and the sources list are built here from the script, so a timestamp
 * or a URL is never invented.
 */

export const PACK_TAGS_MIN = 10;
export const PACK_TAGS_MAX = 15;

const PACK_MAX_OUTPUT_TOKENS = 4_000;
const PACK_THINKING_TOKENS = 2_000;
/** The script's spoken text (~3k words for 20 minutes) plus brand and instructions. */
const PACK_PROMPT_OVERHEAD_TOKENS = 6_000;

export function estimatePackCostUsd(
  model: string = process.env.GEMINI_MODEL ?? "gemini-3.7-flash",
): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: PACK_PROMPT_OVERHEAD_TOKENS,
    outputTokens: PACK_MAX_OUTPUT_TOKENS + PACK_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

/** "0:00", "4:05", "1:02:09" — the form YouTube turns into chapters. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function linesWords(lines: string[]): number {
  return lines.reduce((sum, l) => sum + countWords(l), 0);
}

/**
 * One chapter per section, at the time its first word is reached when the
 * spoken lines before it are read at `wpm`. The hook is the "Intro" chapter at
 * 0:00 (YouTube requires the first chapter there). An estimate until edited.
 */
export function chaptersFromBody(
  body: ScriptBodyV1,
  options: { wpm?: number; introTitle?: string } = {},
): PublishPack["chapters"] {
  const wpm = options.wpm ?? PLAN_WORDS_PER_MINUTE;
  const chapters: PublishPack["chapters"] = [
    { time: "0:00", title: options.introTitle ?? "Intro" },
  ];
  let words = linesWords(body.hook.spokenLines);
  for (const section of body.sections) {
    chapters.push({ time: formatTimestamp((words / wpm) * 60), title: section.heading });
    words += linesWords(section.spokenLines);
  }
  return chapters;
}

const INTRO_TITLE: Record<string, string> = {
  en: "Intro",
  "es-PY": "Introducción",
  jopara: "Introducción",
};

// ---------------------------------------------------------------------------
// the model's part
// ---------------------------------------------------------------------------

export const PACK_JSON_SCHEMA = {
  type: "object",
  properties: {
    description: {
      type: "string",
      description:
        "The YouTube description body: two short paragraphs on what the viewer learns, then one call-to-action line. No chapters, no sources list, no hashtags — those are added separately.",
    },
    tags: {
      type: "array",
      minItems: PACK_TAGS_MIN,
      maxItems: PACK_TAGS_MAX,
      items: { type: "string" },
      description: "YouTube tags: search phrases viewers type, no # sign.",
    },
    pinnedComment: {
      type: "string",
      description:
        "A comment the creator pins: a question that invites replies, or the one key link/next step.",
    },
    instagram: {
      type: "string",
      description: "Instagram caption: hook line, 2-3 short lines, 3-5 hashtags at the end.",
    },
    facebook: {
      type: "string",
      description: "Facebook post: 2-4 conversational sentences, no hashtag wall.",
    },
    tiktok: {
      type: "string",
      description: "TikTok caption: one punchy line plus 3-5 hashtags, under 150 characters.",
    },
  },
  required: ["description", "tags", "pinnedComment", "instagram", "facebook", "tiktok"],
} as const;

type RawPack = {
  description?: unknown;
  tags?: unknown;
  pinnedComment?: unknown;
  instagram?: unknown;
  facebook?: unknown;
  tiktok?: unknown;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  "es-PY": "Paraguayan Spanish (voseo)",
  jopara: "Paraguayan Spanish with a few common Guaraní words (Jopara), as the script does",
};

/** The script as read aloud, with section headings — what the model summarises. */
export function spokenText(body: ScriptBodyV1): string {
  return [
    body.hook.spokenLines.join(" "),
    ...body.sections.map((s) => `## ${s.heading}\n${s.spokenLines.join(" ")}`),
    body.cta.spokenLines.join(" "),
  ].join("\n\n");
}

export class PackGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackGenerationError";
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trimmed, "#" removed, case-insensitive duplicates dropped, at most PACK_TAGS_MAX. */
export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = str(raw).replace(/^#+/, "").trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, PACK_TAGS_MAX);
}

/**
 * The stored description: the model's text, then every source URL in the
 * script — from the script, never the model. Chapters are kept apart (they are
 * edited on their own) and joined on by `youtubeDescription` when copied.
 */
export function composeDescription(
  text: string,
  sources: ScriptBodyV1["sources"],
  language: string,
): string {
  const parts = [text.trim()];
  if (sources.length) {
    const heading = language === "en" ? "Sources" : "Fuentes";
    parts.push(
      `${heading}:\n${sources.map((s) => `- ${s.title || s.claim}: ${s.url}`).join("\n")}`,
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

/** What is pasted into YouTube's description box: the description, then the chapter lines. */
export function youtubeDescription(pack: Pick<PublishPack, "description" | "chapters">): string {
  const chapters = pack.chapters.map((c) => `${c.time} ${c.title}`).join("\n");
  return [pack.description.trim(), chapters].filter(Boolean).join("\n\n");
}

/** The model's answer + the script → a pack. Throws if a required part came back empty. */
export function assemblePack(
  raw: RawPack,
  body: ScriptBodyV1,
  now: Date = new Date(),
): PublishPack {
  const chapters = chaptersFromBody(body, { introTitle: INTRO_TITLE[body.language] });
  const text = str(raw.description);
  const tags = cleanTags(raw.tags);
  const pack: PublishPack = {
    description: composeDescription(text, body.sources, body.language),
    chapters,
    tags,
    pinnedComment: str(raw.pinnedComment),
    captions: {
      instagram: str(raw.instagram),
      facebook: str(raw.facebook),
      tiktok: str(raw.tiktok),
    },
    generatedAt: now.toISOString(),
  };
  const missing = [
    !text && "description",
    !tags.length && "tags",
    !pack.pinnedComment && "pinned comment",
    !pack.captions.instagram && "Instagram caption",
    !pack.captions.facebook && "Facebook caption",
    !pack.captions.tiktok && "TikTok caption",
  ].filter(Boolean);
  if (missing.length)
    throw new PackGenerationError(`The model left out: ${missing.join(", ")}. Try again.`);
  return pack;
}

export type PackInput = {
  brand: Pick<Brand, "name" | "niche" | "market" | "voice">;
  title: string;
  youtubeUrl: string | null;
  body: ScriptBodyV1;
};

export function packPrompt(input: PackInput): { system: string; prompt: string } {
  const { brand, body } = input;
  const language = LANGUAGE_NAMES[body.language] ?? body.language;
  const system = `You write the publishing copy for a YouTube video a creator has just recorded from his own script: the description, tags, a pinned comment and captions for Instagram, Facebook and TikTok. Write every field in ${language}. Be concrete about what the viewer learns; no hype, no emoji walls, no claims that are not in the script. Never invent prices, laws, deadlines or statistics. Answer with JSON matching the required schema and nothing else.`;
  const prompt = `Brand: ${brand.name} (${brand.niche}), market: ${brand.market}
Voice: ${brand.voice ?? "plain, concrete, no hype"}
Title: ${input.title}
${input.youtubeUrl ? `Video URL (for the call to action on other platforms): ${input.youtubeUrl}\n` : ""}
The call to action the video itself ends with: ${body.cta.spokenLines.join(" ")}

THE SCRIPT AS SPOKEN:
${spokenText(body)}

Write ${PACK_TAGS_MIN}-${PACK_TAGS_MAX} tags. The description's last line is a call to action that matches the video's own.`;
  return { system, prompt };
}

/** Ask the model (Gemini under the spend cap, or the local CLI — §1.38) for a pack. */
export async function generatePublishPack(
  input: PackInput,
): Promise<{ pack: PublishPack; costUsd: number }> {
  const { system, prompt } = packPrompt(input);
  const { text, costUsd, finishReason } = await structuredJson({
    system,
    prompt,
    schema: PACK_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimatePackCostUsd(),
    maxOutputTokens: PACK_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });
  let raw: RawPack;
  try {
    raw = JSON.parse(text) as RawPack;
  } catch {
    throw new PackGenerationError(
      `The model didn't return a parseable pack (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  if (typeof raw !== "object" || raw === null)
    throw new PackGenerationError("The model returned no pack. Try again.");
  return { pack: assemblePack(raw, input.body), costUsd };
}

// ---------------------------------------------------------------------------
// saving an edited pack
// ---------------------------------------------------------------------------

const TIME = /^(\d+:)?\d{1,2}:\d{2}$/;

/**
 * Check a pack edited in the browser before it is stored. A server action is a
 * public endpoint, so the shape is checked here, field by field; errors are
 * plain sentences the page shows.
 */
export function validatePublishPack(
  value: unknown,
): { ok: true; pack: PublishPack } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const v = value as Partial<PublishPack> | null;
  if (typeof v !== "object" || v === null)
    return { ok: false, errors: ["The pack must be an object."] };
  const text = (x: unknown, name: string) => {
    if (typeof x !== "string") errors.push(`${name} must be text.`);
  };
  text(v.description, "description");
  text(v.pinnedComment, "pinnedComment");
  text(v.generatedAt, "generatedAt");
  if (!Array.isArray(v.tags) || v.tags.some((t) => typeof t !== "string"))
    errors.push("tags must be a list of text.");
  else if (v.tags.length > PACK_TAGS_MAX) errors.push(`tags: at most ${PACK_TAGS_MAX}.`);
  const c = v.captions as Partial<PublishPack["captions"]> | undefined;
  if (typeof c !== "object" || c === null) errors.push("captions must be an object.");
  else {
    text(c.instagram, "captions.instagram");
    text(c.facebook, "captions.facebook");
    text(c.tiktok, "captions.tiktok");
  }
  if (!Array.isArray(v.chapters)) errors.push("chapters must be a list.");
  else
    v.chapters.forEach((ch, i) => {
      if (
        typeof ch !== "object" ||
        ch === null ||
        typeof ch.time !== "string" ||
        typeof ch.title !== "string"
      ) {
        errors.push(`chapters[${i}] must have a time and a title.`);
      } else if (!TIME.test(ch.time.trim()))
        errors.push(`chapters[${i}].time "${ch.time}" is not like 0:00 or 1:02:03.`);
    });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    pack: {
      description: v.description!,
      chapters: v
        .chapters!.map((ch) => ({ time: ch.time.trim(), title: ch.title.trim() }))
        .filter((ch) => ch.title),
      tags: cleanTags(v.tags),
      pinnedComment: v.pinnedComment!,
      captions: { instagram: c!.instagram!, facebook: c!.facebook!, tiktok: c!.tiktok! },
      generatedAt: v.generatedAt!,
    },
  };
}

/** A YouTube watch/short/share URL, or null. Only these are saved to `youtube_url`. */
export function normalizeYoutubeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host !== "youtube.com" && host !== "youtu.be") return null;
  if (host === "youtu.be" && url.pathname.length > 1) return `https://youtu.be${url.pathname}`;
  if (host === "youtube.com") {
    const id = url.searchParams.get("v");
    if (url.pathname === "/watch" && id) return `https://www.youtube.com/watch?v=${id}`;
    if (/^\/(shorts|live)\/[\w-]+/.test(url.pathname))
      return `https://www.youtube.com${url.pathname}`;
  }
  return null;
}
