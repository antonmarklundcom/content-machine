/**
 * The post body contract, version 1 (PLAN.md §1.46, §2).
 *
 * The JSON stored in `posts.body`. Written for engagement: a hook, one
 * engagement mechanic, the copy that goes out, and per format the slides,
 * shots or story frames with a visual prompt each — plus a source for every
 * claim. Same rules as the script contract (src/lib/scripts/contract.ts): no
 * zod, a change to any field is a new `version`, unknown fields are rejected at
 * every level, and every problem is reported as `<path> <what is wrong>`.
 */

import { POST_FORMATS, type PostFormat } from "@/db/schema";

export const POST_DRAFT_VERSION = 1;

/** How the post asks for a reaction (§1.46). One per post. */
export const ENGAGEMENT_MECHANICS = [
  "question",
  "poll",
  "comment_keyword",
  "save",
  "share",
  "quiz",
  "series",
] as const;
export type EngagementMechanic = (typeof ENGAGEMENT_MECHANICS)[number];

export const STORY_STICKERS = ["poll", "quiz", "question", "link"] as const;
export type StorySticker = (typeof STORY_STICKERS)[number];

/** Instagram's own ceiling; more is an error on the platform, so it is one here. */
export const MAX_HASHTAGS = 30;
/** Instagram carousels hold 2–20 items. */
export const CAROUSEL_SLIDES = { min: 2, max: 20 } as const;

export type PostSlide = {
  /** 1-based position; must match the slide's place in the list. */
  n: number;
  headline: string;
  body: string;
  visual: { prompt: string; textOverlay: string };
};

export type PostShot = {
  n: number;
  seconds: number;
  onScreenText: string;
  voiceover?: string;
  visual: { imagePrompt: string; videoPrompt: string };
};

export type PostStoryFrame = {
  n: number;
  text: string;
  sticker?: StorySticker;
  visual: { prompt: string };
};

export type PostSource = { claim: string; url: string };

export type PostDraftV1 = {
  version: 1;
  format: PostFormat;
  /** BCP-47-ish tag the copy is written in, e.g. `en`, `es`, `pt-BR`. */
  language: string;
  hook: string;
  caption: string;
  cta: string;
  /** Without the `#`. */
  hashtags: string[];
  firstComment?: string;
  altText?: string;
  engagement: { mechanic: EngagementMechanic; detail: string };
  /** Required for a carousel. */
  slides?: PostSlide[];
  /** Required for a reel or a video. */
  shots?: PostShot[];
  /** Required for a story. */
  storyFrames?: PostStoryFrame[];
  sources: PostSource[];
  notes?: string;
};

export type PostDraft = PostDraftV1;

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// the validator
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

class Checker {
  readonly errors: string[] = [];

  fail(path: string, why: string): void {
    this.errors.push(`${path} ${why}`);
  }

  /** An object with exactly `required` (+ any of `optional`); returns it, or null after recording why not. */
  object(
    value: unknown,
    path: string,
    required: readonly string[],
    optional: readonly string[] = [],
  ): Obj | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.fail(path, `must be an object, got ${describe(value)}`);
      return null;
    }
    const obj = value as Obj;
    for (const name of required) {
      if (!(name in obj)) this.fail(`${path}.${name}`, "is missing");
    }
    for (const name of Object.keys(obj)) {
      if (!required.includes(name) && !optional.includes(name)) {
        this.fail(`${path}.${name}`, "is not a field of this contract");
      }
    }
    return obj;
  }

  text(value: unknown, path: string, options: { allowEmpty?: boolean } = {}): void {
    if (value === undefined) return; // reported as missing by object(), or optional
    if (typeof value !== "string") return this.fail(path, `must be text, got ${describe(value)}`);
    if (!options.allowEmpty && !value.trim()) this.fail(path, "must not be empty");
  }

  array(
    value: unknown,
    path: string,
    each: (item: unknown, itemPath: string, index: number) => void,
    bounds: { min?: number; max?: number } = {},
  ): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) return this.fail(path, `must be a list, got ${describe(value)}`);
    if (bounds.min !== undefined && value.length < bounds.min)
      this.fail(path, `must have at least ${bounds.min} items, has ${value.length}`);
    if (bounds.max !== undefined && value.length > bounds.max)
      this.fail(path, `must have at most ${bounds.max} items, has ${value.length}`);
    value.forEach((item, i) => each(item, `${path}[${i}]`, i));
  }

  oneOf(value: unknown, path: string, allowed: readonly string[]): void {
    if (value === undefined) return;
    if (typeof value !== "string" || !allowed.includes(value)) {
      this.fail(
        path,
        `must be one of ${allowed.map((a) => `"${a}"`).join(", ")}, got ${describe(value)}`,
      );
    }
  }

  /** The 1-based `n` of the item at `index`. */
  position(value: unknown, path: string, index: number): void {
    if (value === undefined) return;
    if (value !== index + 1) this.fail(path, `must be ${index + 1}, got ${describe(value)}`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string")
    return value.length > 40 ? `"${value.slice(0, 37)}..."` : `"${value}"`;
  if (typeof value === "object") return "an object";
  return `${typeof value} ${String(value)}`;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Which list each format cannot go out without. */
const REQUIRED_PARTS: Partial<Record<PostFormat, "slides" | "shots" | "storyFrames">> = {
  carousel: "slides",
  reel: "shots",
  video: "shots",
  story: "storyFrames",
};

/**
 * Check a post body against version 1. Every problem is reported, not just
 * the first — e.g. `body.slides[1].visual.prompt must not be empty`.
 */
export function validatePostDraft(body: unknown): ValidationResult {
  const c = new Checker();
  const root = c.object(
    body,
    "body",
    [
      "version",
      "format",
      "language",
      "hook",
      "caption",
      "cta",
      "hashtags",
      "engagement",
      "sources",
    ],
    ["firstComment", "altText", "slides", "shots", "storyFrames", "notes"],
  );
  if (!root) return { ok: false, errors: c.errors };

  if (root.version !== undefined && root.version !== POST_DRAFT_VERSION) {
    c.fail("body.version", `must be ${POST_DRAFT_VERSION}, got ${describe(root.version)}`);
  }
  c.oneOf(root.format, "body.format", POST_FORMATS);
  c.text(root.language, "body.language");
  if (typeof root.language === "string" && root.language.length > 8) {
    c.fail(
      "body.language",
      `must be a language tag of at most 8 characters, got ${describe(root.language)}`,
    );
  }
  c.text(root.hook, "body.hook");
  c.text(root.caption, "body.caption");
  c.text(root.cta, "body.cta");
  c.text(root.firstComment, "body.firstComment");
  c.text(root.altText, "body.altText");
  c.text(root.notes, "body.notes", { allowEmpty: true });

  c.array(
    root.hashtags,
    "body.hashtags",
    (tag, p) => {
      c.text(tag, p);
      if (typeof tag === "string" && /[\s#]/.test(tag)) {
        c.fail(p, `must be one word without "#", got ${describe(tag)}`);
      }
    },
    { max: MAX_HASHTAGS },
  );

  if (root.engagement !== undefined) {
    const e = c.object(root.engagement, "body.engagement", ["mechanic", "detail"]);
    if (e) {
      c.oneOf(e.mechanic, "body.engagement.mechanic", ENGAGEMENT_MECHANICS);
      c.text(e.detail, "body.engagement.detail");
    }
  }

  c.array(
    root.slides,
    "body.slides",
    (item, p, i) => {
      const s = c.object(item, p, ["n", "headline", "body", "visual"]);
      if (!s) return;
      c.position(s.n, `${p}.n`, i);
      c.text(s.headline, `${p}.headline`);
      c.text(s.body, `${p}.body`, { allowEmpty: true });
      if (s.visual === undefined) return;
      const v = c.object(s.visual, `${p}.visual`, ["prompt", "textOverlay"]);
      if (!v) return;
      c.text(v.prompt, `${p}.visual.prompt`);
      c.text(v.textOverlay, `${p}.visual.textOverlay`, { allowEmpty: true });
    },
    root.format === "carousel" ? CAROUSEL_SLIDES : {},
  );

  c.array(root.shots, "body.shots", (item, p, i) => {
    const s = c.object(item, p, ["n", "seconds", "onScreenText", "visual"], ["voiceover"]);
    if (!s) return;
    c.position(s.n, `${p}.n`, i);
    if (s.seconds !== undefined) {
      const sec = s.seconds;
      if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0 || sec > 180) {
        c.fail(
          `${p}.seconds`,
          `must be a number of seconds between 0 and 180, got ${describe(sec)}`,
        );
      }
    }
    c.text(s.onScreenText, `${p}.onScreenText`, { allowEmpty: true });
    c.text(s.voiceover, `${p}.voiceover`, { allowEmpty: true });
    if (s.visual === undefined) return;
    const v = c.object(s.visual, `${p}.visual`, ["imagePrompt", "videoPrompt"]);
    if (!v) return;
    c.text(v.imagePrompt, `${p}.visual.imagePrompt`);
    c.text(v.videoPrompt, `${p}.visual.videoPrompt`);
  });

  c.array(root.storyFrames, "body.storyFrames", (item, p, i) => {
    const f = c.object(item, p, ["n", "text", "visual"], ["sticker"]);
    if (!f) return;
    c.position(f.n, `${p}.n`, i);
    c.text(f.text, `${p}.text`, { allowEmpty: true });
    c.oneOf(f.sticker, `${p}.sticker`, STORY_STICKERS);
    if (f.visual === undefined) return;
    const v = c.object(f.visual, `${p}.visual`, ["prompt"]);
    if (v) c.text(v.prompt, `${p}.visual.prompt`);
  });

  const part = REQUIRED_PARTS[root.format as PostFormat];
  if (part) {
    const list = root[part];
    if (list === undefined || (Array.isArray(list) && list.length === 0)) {
      c.fail(`body.${part}`, `is required for a ${String(root.format)}`);
    }
  }

  c.array(root.sources, "body.sources", (item, p) => {
    const s = c.object(item, p, ["claim", "url"]);
    if (!s) return;
    c.text(s.claim, `${p}.claim`);
    if (s.url !== undefined && !isHttpUrl(s.url))
      c.fail(`${p}.url`, `must be an http(s) URL, got ${describe(s.url)}`);
  });

  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true };
}

/** Narrow after a successful validation. */
export function isPostDraft(body: unknown): body is PostDraft {
  return validatePostDraft(body).ok;
}
