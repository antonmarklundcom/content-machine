/**
 * `posts.publish_options` for the video platforms (build 4 §3.F). The column
 * is namespaced per platform, so one post's YouTube and TikTok choices never
 * collide and the Meta publisher can ignore it:
 *
 *   { "youtube": { "privacy": "private", "madeForKids": false, "categoryId": "22" },
 *     "tiktok":  { "mode": "inbox", "privacy": "SELF_ONLY" } }
 *
 * Pure: parsing never throws, a missing value takes its default, and a value
 * that is there but wrong is an error the owner can act on.
 */

export const YOUTUBE_PRIVACY = ["private", "unlisted", "public"] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY)[number];

/** YouTube's video categories that fit our brands (ids from `videoCategories.list`, region US). */
export const YOUTUBE_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "22", label: "People & Blogs" },
  { id: "27", label: "Education" },
  { id: "1", label: "Film & Animation" },
  { id: "24", label: "Entertainment" },
  { id: "19", label: "Travel & Events" },
  { id: "26", label: "Howto & Style" },
  { id: "28", label: "Science & Technology" },
  { id: "25", label: "News & Politics" },
  { id: "2", label: "Autos & Vehicles" },
  { id: "15", label: "Pets & Animals" },
  { id: "17", label: "Sports" },
  { id: "10", label: "Music" },
];
export const DEFAULT_YOUTUBE_CATEGORY = "22";

export type YouTubeOptions = {
  /** Default `private`: nothing goes public on YouTube without an explicit choice. */
  privacy: YouTubePrivacy;
  /** `null` = not chosen; the publisher then applies the kids rule (cuentos → true). */
  madeForKids: boolean | null;
  categoryId: string;
  /** ISO time: upload now as private, YouTube makes it public then. */
  publishAt: string | null;
  notifySubscribers: boolean;
};

export const TIKTOK_MODES = ["inbox", "direct"] as const;
export type TikTokMode = (typeof TIKTOK_MODES)[number];
export const TIKTOK_PRIVACY = [
  "SELF_ONLY",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "PUBLIC_TO_EVERYONE",
] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];

export type TikTokOptions = {
  /** `inbox` (default) lands in the creator's TikTok drafts; `direct` posts. */
  mode: TikTokMode;
  /** Direct mode only. Unaudited apps may only use `SELF_ONLY`. */
  privacy: TikTokPrivacy;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  /** Label the post as AI-generated content. */
  isAigc: boolean;
};

export const DEFAULT_YOUTUBE_OPTIONS: YouTubeOptions = {
  privacy: "private",
  madeForKids: null,
  categoryId: DEFAULT_YOUTUBE_CATEGORY,
  publishAt: null,
  notifySubscribers: true,
};

export const DEFAULT_TIKTOK_OPTIONS: TikTokOptions = {
  mode: "inbox",
  privacy: "SELF_ONLY",
  disableComment: false,
  disableDuet: false,
  disableStitch: false,
  isAigc: false,
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function section(raw: unknown, key: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const v = (raw as Record<string, unknown>)[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const has = (o: Record<string, unknown>, k: string) => o[k] !== undefined && o[k] !== null;

export function parseYouTubeOptions(raw: unknown): Parsed<YouTubeOptions> {
  const o = section(raw, "youtube");
  const out: YouTubeOptions = { ...DEFAULT_YOUTUBE_OPTIONS };
  if (has(o, "privacy")) {
    if (!YOUTUBE_PRIVACY.includes(o.privacy as YouTubePrivacy)) {
      return { ok: false, error: `YouTube privacy must be private, unlisted or public.` };
    }
    out.privacy = o.privacy as YouTubePrivacy;
  }
  if (has(o, "madeForKids")) {
    if (typeof o.madeForKids !== "boolean") {
      return { ok: false, error: "YouTube made-for-kids must be yes or no." };
    }
    out.madeForKids = o.madeForKids;
  }
  if (has(o, "categoryId")) {
    const id = String(o.categoryId);
    if (!/^\d{1,3}$/.test(id)) return { ok: false, error: "The YouTube category is a number." };
    out.categoryId = id;
  }
  if (has(o, "publishAt")) {
    const t = new Date(String(o.publishAt));
    if (Number.isNaN(t.getTime())) {
      return { ok: false, error: "The YouTube publish time is not a date." };
    }
    out.publishAt = t.toISOString();
  }
  if (has(o, "notifySubscribers")) out.notifySubscribers = o.notifySubscribers !== false;
  return { ok: true, value: out };
}

export function parseTikTokOptions(raw: unknown): Parsed<TikTokOptions> {
  const o = section(raw, "tiktok");
  const out: TikTokOptions = { ...DEFAULT_TIKTOK_OPTIONS };
  if (has(o, "mode")) {
    if (!TIKTOK_MODES.includes(o.mode as TikTokMode)) {
      return { ok: false, error: "The TikTok mode must be inbox or direct." };
    }
    out.mode = o.mode as TikTokMode;
  }
  if (has(o, "privacy")) {
    if (!TIKTOK_PRIVACY.includes(o.privacy as TikTokPrivacy)) {
      return { ok: false, error: `TikTok privacy must be one of ${TIKTOK_PRIVACY.join(", ")}.` };
    }
    out.privacy = o.privacy as TikTokPrivacy;
  }
  for (const k of ["disableComment", "disableDuet", "disableStitch", "isAigc"] as const) {
    if (has(o, k)) out[k] = o[k] === true;
  }
  return { ok: true, value: out };
}

/** Replace one platform's section, keep the others. */
export function withPlatformOptions(
  current: unknown,
  platform: "youtube" | "tiktok",
  value: YouTubeOptions | TikTokOptions,
): Record<string, unknown> {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  base[platform] = value;
  return base;
}

/**
 * The kids rule (docs/PUBLISH-VIDEO.md): children's content must be declared
 * made for kids on YouTube (COPPA). A cuentos brand, or one whose niche says
 * children, always is — whatever the post's options say.
 */
export function isKidsBrand(brand: { id: string; niche?: string | null; domain?: string | null }) {
  const text = `${brand.id} ${brand.domain ?? ""} ${brand.niche ?? ""}`.toLowerCase();
  return /cuento|kids|children|niñ|infantil/.test(text);
}
