/**
 * The script body contract, version 1 (PLAN.md §1.32).
 *
 * This is the JSON stored in `scripts.body`, and the shape videoPY will read
 * later — so field names are plain English, and a change to any of them is a
 * new `version`, never an edit to this one. No zod: the app has no schema
 * library, and a hand-written validator can say exactly which field is wrong in
 * words the person editing the script understands.
 *
 * Unknown fields are rejected at every level. A reader in another repo can
 * then trust that what it sees is all there is, and a typo'd field name fails
 * loudly instead of being silently dropped on the next save.
 */

export const SCRIPT_BODY_VERSION = 1;

/** The three style guides in `content/style/` (§1.33). */
export const SCRIPT_LANGUAGES = ["en", "es-PY", "jopara"] as const;
export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

/** What Higgsfield is asked to render at. 16:9 for the main video, 9:16 for shorts. */
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const TITLE_OPTION_COUNT = 3;
export const THUMBNAIL_CONCEPT_COUNT = 3;

export type TitleOption = {
  title: string;
  /** Why this title would get the click, one sentence. */
  angle: string;
};

export type ThumbnailConcept = {
  /** What the thumbnail shows, for a person. */
  description: string;
  /** The words on the thumbnail — short, or empty for none. */
  textOverlay: string;
  /** A Higgsfield image prompt for the background. */
  imagePrompt: string;
};

/** One b-roll shot: a still, and a video made from it when `videoPrompt` is set. */
export type BrollShot = {
  /** The spoken line this shot plays under, copied from the block it belongs to. */
  spokenLine: string;
  /** What the shot shows, for a person. */
  description: string;
  /** Higgsfield image prompt. */
  imagePrompt: string;
  /** Higgsfield image-to-video prompt, or null for a still. */
  videoPrompt: string | null;
  aspectRatio: AspectRatio;
};

export type ScriptHook = {
  /** Teleprompter lines, one idea each. */
  spokenLines: string[];
  onScreenText: string[];
  broll: BrollShot[];
};

export type ScriptSection = {
  heading: string;
  spokenLines: string[];
  /** Notes for Anton, not read aloud. */
  talkingPoints: string[];
  onScreenText: string[];
  broll: BrollShot[];
  /** Ids from `sources` backing a claim made in this section. */
  sourceIds: string[];
};

export type ScriptCta = {
  spokenLines: string[];
  onScreenText: string[];
};

export type ScriptSource = {
  /** Short id sections refer to, e.g. "s1". Unique within the script. */
  id: string;
  /** The factual claim this source backs, in the script's language. */
  claim: string;
  url: string;
  /** Page or publisher name, for the sources list. */
  title: string;
  /** Legal, residency, tax or price facts: check against the source before filming. */
  verifyBeforeRecording: boolean;
};

export type ScriptBodyV1 = {
  version: 1;
  language: ScriptLanguage;
  topic: string;
  /** The title the script was written for; also the `scripts.title` column. */
  chosenTitle: string;
  targetMinutes: number;
  titleOptions: TitleOption[];
  thumbnailConcepts: ThumbnailConcept[];
  hook: ScriptHook;
  sections: ScriptSection[];
  cta: ScriptCta;
  sources: ScriptSource[];
};

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

  /** An object with exactly `fields` allowed; returns it, or null after recording why not. */
  object(value: unknown, path: string, fields: readonly string[]): Obj | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.fail(path, `must be an object, got ${describe(value)}`);
      return null;
    }
    const obj = value as Obj;
    for (const name of fields) {
      if (!(name in obj)) this.fail(`${path}.${name}`, "is missing");
    }
    for (const name of Object.keys(obj)) {
      if (!fields.includes(name)) this.fail(`${path}.${name}`, "is not a field of this contract");
    }
    return obj;
  }

  text(value: unknown, path: string, options: { allowEmpty?: boolean } = {}): void {
    if (value === undefined) return; // reported as missing by object()
    if (typeof value !== "string") return this.fail(path, `must be text, got ${describe(value)}`);
    if (!options.allowEmpty && !value.trim()) this.fail(path, "must not be empty");
  }

  /** An array; each element handed to `each`. Undefined is left to object(). */
  array(
    value: unknown,
    path: string,
    each: (item: unknown, itemPath: string) => void,
    bounds: { min?: number; max?: number } = {},
  ): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      this.fail(path, `must be a list, got ${describe(value)}`);
      return [];
    }
    const { min, max } = bounds;
    if (min !== undefined && max !== undefined && min === max && value.length !== min) {
      this.fail(path, `must have exactly ${min} items, has ${value.length}`);
    } else {
      if (min !== undefined && value.length < min)
        this.fail(path, `must have at least ${min} items, has ${value.length}`);
      if (max !== undefined && value.length > max)
        this.fail(path, `must have at most ${max} items, has ${value.length}`);
    }
    value.forEach((item, i) => each(item, `${path}[${i}]`));
    return value;
  }

  texts(value: unknown, path: string, bounds: { min?: number } = {}): void {
    this.array(value, path, (item, p) => this.text(item, p), bounds);
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
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string")
    return value.length > 40 ? `"${value.slice(0, 37)}..."` : `"${value}"`;
  if (typeof value === "object") return "an object";
  return `${typeof value} ${String(value)}`;
}

const BROLL_FIELDS = [
  "spokenLine",
  "description",
  "imagePrompt",
  "videoPrompt",
  "aspectRatio",
] as const;

function checkBroll(c: Checker, value: unknown, path: string): void {
  const shot = c.object(value, path, BROLL_FIELDS);
  if (!shot) return;
  c.text(shot.spokenLine, `${path}.spokenLine`);
  c.text(shot.description, `${path}.description`);
  c.text(shot.imagePrompt, `${path}.imagePrompt`);
  if (shot.videoPrompt !== null) c.text(shot.videoPrompt, `${path}.videoPrompt`);
  c.oneOf(shot.aspectRatio, `${path}.aspectRatio`, ASPECT_RATIOS);
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

/**
 * Check a script body against version 1. Every problem is reported, not just
 * the first, each as `<path> <what is wrong>` — e.g.
 * `sections[2].broll[0].imagePrompt must not be empty`.
 *
 * Its signature is `bridge/scripts.ts`'s `ScriptBodyValidator`, so it is passed
 * straight to `createScript` / `updateScriptBody`.
 */
export function validateScriptBody(body: unknown): ValidationResult {
  const c = new Checker();
  const root = c.object(body, "body", [
    "version",
    "language",
    "topic",
    "chosenTitle",
    "targetMinutes",
    "titleOptions",
    "thumbnailConcepts",
    "hook",
    "sections",
    "cta",
    "sources",
  ]);
  if (!root) return { ok: false, errors: c.errors };

  if (root.version !== undefined && root.version !== SCRIPT_BODY_VERSION) {
    c.fail("body.version", `must be ${SCRIPT_BODY_VERSION}, got ${describe(root.version)}`);
  }
  c.oneOf(root.language, "body.language", SCRIPT_LANGUAGES);
  c.text(root.topic, "body.topic");
  c.text(root.chosenTitle, "body.chosenTitle");
  if (root.targetMinutes !== undefined) {
    const m = root.targetMinutes;
    if (typeof m !== "number" || !Number.isFinite(m) || m <= 0 || m > 60) {
      c.fail(
        "body.targetMinutes",
        `must be a number of minutes between 0 and 60, got ${describe(m)}`,
      );
    }
  }

  c.array(
    root.titleOptions,
    "body.titleOptions",
    (item, p) => {
      const o = c.object(item, p, ["title", "angle"]);
      if (!o) return;
      c.text(o.title, `${p}.title`);
      c.text(o.angle, `${p}.angle`);
    },
    { min: TITLE_OPTION_COUNT, max: TITLE_OPTION_COUNT },
  );

  c.array(
    root.thumbnailConcepts,
    "body.thumbnailConcepts",
    (item, p) => {
      const o = c.object(item, p, ["description", "textOverlay", "imagePrompt"]);
      if (!o) return;
      c.text(o.description, `${p}.description`);
      c.text(o.textOverlay, `${p}.textOverlay`, { allowEmpty: true });
      c.text(o.imagePrompt, `${p}.imagePrompt`);
    },
    { min: THUMBNAIL_CONCEPT_COUNT, max: THUMBNAIL_CONCEPT_COUNT },
  );

  if (root.hook !== undefined) {
    const hook = c.object(root.hook, "body.hook", ["spokenLines", "onScreenText", "broll"]);
    if (hook) {
      c.texts(hook.spokenLines, "body.hook.spokenLines", { min: 1 });
      c.texts(hook.onScreenText, "body.hook.onScreenText");
      c.array(hook.broll, "body.hook.broll", (item, p) => checkBroll(c, item, p));
    }
  }

  // Sources first, so sections can be checked against the ids that exist.
  const sourceIds = new Set<string>();
  c.array(root.sources, "body.sources", (item, p) => {
    const o = c.object(item, p, ["id", "claim", "url", "title", "verifyBeforeRecording"]);
    if (!o) return;
    c.text(o.id, `${p}.id`);
    if (typeof o.id === "string") {
      if (sourceIds.has(o.id)) c.fail(`${p}.id`, `"${o.id}" is used by another source`);
      sourceIds.add(o.id);
    }
    c.text(o.claim, `${p}.claim`);
    if (o.url !== undefined && !isHttpUrl(o.url))
      c.fail(`${p}.url`, `must be an http(s) URL, got ${describe(o.url)}`);
    c.text(o.title, `${p}.title`, { allowEmpty: true });
    if (o.verifyBeforeRecording !== undefined && typeof o.verifyBeforeRecording !== "boolean") {
      c.fail(
        `${p}.verifyBeforeRecording`,
        `must be true or false, got ${describe(o.verifyBeforeRecording)}`,
      );
    }
  });

  c.array(
    root.sections,
    "body.sections",
    (item, p) => {
      const s = c.object(item, p, [
        "heading",
        "spokenLines",
        "talkingPoints",
        "onScreenText",
        "broll",
        "sourceIds",
      ]);
      if (!s) return;
      c.text(s.heading, `${p}.heading`);
      c.texts(s.spokenLines, `${p}.spokenLines`, { min: 1 });
      c.texts(s.talkingPoints, `${p}.talkingPoints`);
      c.texts(s.onScreenText, `${p}.onScreenText`);
      c.array(s.broll, `${p}.broll`, (shot, sp) => checkBroll(c, shot, sp));
      c.array(s.sourceIds, `${p}.sourceIds`, (id, ip) => {
        c.text(id, ip);
        if (typeof id === "string" && id.trim() && !sourceIds.has(id)) {
          c.fail(ip, `refers to source "${id}", which is not in body.sources`);
        }
      });
    },
    { min: 1 },
  );

  if (root.cta !== undefined) {
    const cta = c.object(root.cta, "body.cta", ["spokenLines", "onScreenText"]);
    if (cta) {
      c.texts(cta.spokenLines, "body.cta.spokenLines", { min: 1 });
      c.texts(cta.onScreenText, "body.cta.onScreenText");
    }
  }

  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true };
}

/** Narrow after a successful validation. */
export function isScriptBodyV1(body: unknown): body is ScriptBodyV1 {
  return validateScriptBody(body).ok;
}
