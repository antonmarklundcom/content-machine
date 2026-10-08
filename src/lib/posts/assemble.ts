import type { PostFormat } from "@/db/schema";

import {
  MAX_HASHTAGS,
  POST_DRAFT_VERSION,
  type EngagementMechanic,
  type PostDraft,
  type PostShot,
  type PostSlide,
  type PostSource,
  type PostStoryFrame,
  type StorySticker,
} from "./contract";

/**
 * What the post model answers with (src/lib/ai.ts `POST_DRAFT_JSON_SCHEMA`):
 * the draft minus the fields this app decides itself (version, format,
 * language). Every list is optional in the schema, because a JSON schema
 * cannot say "slides only for a carousel"; `assemblePostDraft` keeps the one
 * list the format uses.
 */
export type RawPostDraft = {
  hook: string;
  caption: string;
  cta: string;
  hashtags?: string[];
  firstComment?: string | null;
  altText?: string | null;
  engagement: { mechanic: EngagementMechanic; detail: string };
  slides?: { headline: string; body?: string; visualPrompt: string; textOverlay?: string }[];
  shots?: {
    seconds: number;
    onScreenText?: string;
    voiceover?: string | null;
    imagePrompt: string;
    videoPrompt: string;
  }[];
  storyFrames?: { text?: string; sticker?: StorySticker | "" | null; visualPrompt: string }[];
  sources?: { claim: string; url: string }[];
  notes?: string | null;
};

/** Which list a format is made of. `image_post` is one slide: the image and its overlay. */
export function partForFormat(format: PostFormat): "slides" | "shots" | "storyFrames" | null {
  switch (format) {
    case "carousel":
    case "image_post":
      return "slides";
    case "reel":
    case "video":
      return "shots";
    case "story":
      return "storyFrames";
    default:
      return null;
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function optionalText(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/** `#Paraguay Life` → `ParaguayLife`; empty and duplicate tags dropped; capped at Instagram's 30. */
export function cleanHashtags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const clean = String(tag ?? "").replace(/[#\s]/g, "");
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out.slice(0, MAX_HASHTAGS);
}

/**
 * Turn the model's answer into a contract body. Pure, so it is unit-tested.
 *
 * Repairs rather than rejects what a model gets wrong that is cheaper to fix
 * than to pay for again, and never hides it — the same rule as
 * `assembleScriptBody`:
 *  - a source without a usable URL is dropped and its claim is listed in
 *    `notes` as "UNSOURCED — verify or cut";
 *  - hashtags lose `#` and spaces, and are capped at 30;
 *  - lists the format does not use are dropped, and `n` is renumbered.
 * What it cannot repair (too few slides, an empty hook) is left for
 * `validatePostDraft` to report.
 */
export function assemblePostDraft(
  raw: RawPostDraft,
  target: { format: PostFormat; language: string },
): PostDraft {
  const sources: PostSource[] = [];
  const unsourced: string[] = [];
  const seenUrls = new Set<string>();
  for (const s of raw.sources ?? []) {
    const claim = String(s?.claim ?? "").trim();
    if (!claim) continue;
    if (!isHttpUrl(s.url)) {
      unsourced.push(claim);
      continue;
    }
    const key = `${claim}\n${s.url}`;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    sources.push({ claim, url: s.url });
  }

  const notes = [
    optionalText(raw.notes),
    ...unsourced.map((claim) => `UNSOURCED — verify or cut: ${claim}`),
  ]
    .filter(Boolean)
    .join("\n");

  const draft: PostDraft = {
    version: POST_DRAFT_VERSION,
    format: target.format,
    language: target.language,
    hook: String(raw.hook ?? "").trim(),
    caption: String(raw.caption ?? "").trim(),
    cta: String(raw.cta ?? "").trim(),
    hashtags: cleanHashtags(raw.hashtags),
    engagement: {
      mechanic: raw.engagement?.mechanic,
      detail: String(raw.engagement?.detail ?? "").trim(),
    },
    sources,
  };
  const firstComment = optionalText(raw.firstComment);
  if (firstComment) draft.firstComment = firstComment;
  const altText = optionalText(raw.altText);
  if (altText) draft.altText = altText;

  const part = partForFormat(target.format);
  if (part === "slides") {
    const slides: PostSlide[] = (raw.slides ?? []).map((s, i) => ({
      n: i + 1,
      headline: String(s.headline ?? "").trim(),
      body: String(s.body ?? "").trim(),
      visual: {
        prompt: String(s.visualPrompt ?? "").trim(),
        textOverlay: String(s.textOverlay ?? "").trim(),
      },
    }));
    // An image post is one image; extra slides the model wrote are not a post.
    draft.slides = target.format === "image_post" ? slides.slice(0, 1) : slides;
  } else if (part === "shots") {
    draft.shots = (raw.shots ?? []).map((s, i): PostShot => ({
      n: i + 1,
      seconds: Number(s.seconds),
      onScreenText: String(s.onScreenText ?? "").trim(),
      ...(optionalText(s.voiceover) ? { voiceover: optionalText(s.voiceover) } : {}),
      visual: {
        imagePrompt: String(s.imagePrompt ?? "").trim(),
        videoPrompt: String(s.videoPrompt ?? "").trim(),
      },
    }));
  } else if (part === "storyFrames") {
    draft.storyFrames = (raw.storyFrames ?? []).map((f, i): PostStoryFrame => ({
      n: i + 1,
      text: String(f.text ?? "").trim(),
      ...(f.sticker ? { sticker: f.sticker } : {}),
      visual: { prompt: String(f.visualPrompt ?? "").trim() },
    }));
  }
  if (notes) draft.notes = notes;
  return draft;
}

/** The parts of a draft `regenerateSection` can rewrite on their own. */
export const POST_SECTIONS = [
  "hook",
  "caption",
  "cta",
  "hashtags",
  "firstComment",
  "altText",
  "engagement",
  "slides",
  "shots",
  "storyFrames",
] as const;
export type PostSection = (typeof POST_SECTIONS)[number];

export function isPostSection(value: unknown): value is PostSection {
  return typeof value === "string" && (POST_SECTIONS as readonly string[]).includes(value);
}

/**
 * Take `section` from `fresh` into `current`, and nothing else. Sources the
 * fresh draft cites are added (a rewritten caption may cite a new page);
 * the current ones stay, since the rest of the post still leans on them.
 */
export function mergeSection(
  current: PostDraft,
  fresh: PostDraft,
  section: PostSection,
): PostDraft {
  const next: PostDraft = { ...current };
  const value = fresh[section];
  if (value === undefined) delete next[section];
  else (next as Record<string, unknown>)[section] = value;

  const known = new Set(current.sources.map((s) => `${s.claim}\n${s.url}`));
  const added = fresh.sources.filter((s) => !known.has(`${s.claim}\n${s.url}`));
  if (added.length) next.sources = [...current.sources, ...added];
  return next;
}
