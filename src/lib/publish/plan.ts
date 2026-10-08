import type { AssetKind, PostAssetRole, PostFormat, SocialPlatform } from "@/db/schema";

/**
 * What one post becomes on one platform (PLAN.md §5.O13), decided before any
 * file is copied or any Graph call made. Pure, so every format × platform rule
 * is unit-tested and a post that cannot be published fails with a sentence
 * the owner can act on, not with Meta's error code.
 */

export type PlanAsset = {
  assetId: number;
  kind: AssetKind;
  role: PostAssetRole;
  position: number;
  name: string;
  altText: string | null;
  /** For uploads (YouTube, TikTok): the file under MEDIA_ROOT and what it measures. */
  localPath?: string | null;
  sha256?: string;
  mime?: string;
  bytes?: number;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
};

export type PublishPlan =
  | { platform: "instagram"; kind: "image"; media: [PlanAsset] }
  | { platform: "instagram"; kind: "carousel"; media: PlanAsset[] }
  | { platform: "instagram"; kind: "reel"; media: [PlanAsset]; cover: PlanAsset | null }
  | { platform: "facebook"; kind: "photo"; media: [PlanAsset] }
  | { platform: "facebook"; kind: "album"; media: PlanAsset[] }
  | { platform: "facebook"; kind: "video"; media: [PlanAsset] }
  | { platform: "facebook"; kind: "text"; media: [] }
  | {
      platform: "youtube";
      kind: "video";
      media: [PlanAsset];
      thumbnail: PlanAsset | null;
      /** Vertical and at most 3 minutes: tagged #Shorts (build 4 §3.F). */
      short: boolean;
    }
  | { platform: "tiktok"; kind: "video"; media: [PlanAsset] };

export type PlanResult = { ok: true; plan: PublishPlan } | { ok: false; error: string };

/** Instagram's caption ceiling. */
export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAG_MAX = 30;
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;

/** TikTok's caption ceiling (direct posts). */
export const TIKTOK_CAPTION_MAX = 2200;
/** A YouTube Short is vertical and at most this long. */
export const SHORTS_MAX_SEC = 180;

export const PUBLISHABLE_PLATFORMS: readonly SocialPlatform[] = [
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
];

/** Vertical (taller than wide) and at most 3 minutes; unknown size or length is not a Short. */
export function isShort(video: Pick<PlanAsset, "width" | "height" | "durationSec">): boolean {
  const { width, height, durationSec } = video;
  if (!width || !height || durationSec === null || durationSec === undefined) return false;
  return height > width && durationSec <= SHORTS_MAX_SEC;
}

const fail = (error: string): PlanResult => ({ ok: false, error });

export function planPublish(input: {
  platform: SocialPlatform;
  format: PostFormat;
  caption: string;
  assets: PlanAsset[];
}): PlanResult {
  const { format, caption } = input;
  if (!PUBLISHABLE_PLATFORMS.includes(input.platform)) {
    return fail(
      `Publishing to ${input.platform} is not built yet; post it by hand with the post pack.`,
    );
  }
  const sorted = [...input.assets].sort((a, b) => a.position - b.position);
  if (input.platform === "youtube" || input.platform === "tiktok") {
    return planVideoPlatform(input.platform, format, caption, sorted);
  }
  const platform = input.platform as "instagram" | "facebook";
  // Slides and clips are what goes out; a cover is the reel's cover, or the
  // image of a single-image post that has nothing else.
  const body = sorted.filter((a) => a.role === "slide" || a.role === "clip");
  const cover = sorted.find((a) => a.role === "cover" && a.kind === "image") ?? null;
  const media = body.filter((a) => a.kind === "image" || a.kind === "video");

  if (platform === "instagram") {
    if (caption.length > IG_CAPTION_MAX) {
      return fail(
        `The caption is ${caption.length} characters; Instagram allows ${IG_CAPTION_MAX}.`,
      );
    }
    const tags = caption.match(/(^|\s)#[^\s#]+/g)?.length ?? 0;
    if (tags > IG_HASHTAG_MAX) {
      return fail(`The caption has ${tags} hashtags; Instagram allows ${IG_HASHTAG_MAX}.`);
    }
  }

  switch (format) {
    case "image_post": {
      const images = media.length ? media : cover ? [cover] : [];
      if (images.length !== 1 || images[0].kind !== "image") {
        return fail(
          `An image post needs exactly one image attached (it has ${describe(images)}). ` +
            "Use the carousel format for several.",
        );
      }
      const image: [PlanAsset] = [images[0]];
      return platform === "instagram"
        ? { ok: true, plan: { platform, kind: "image", media: image } }
        : { ok: true, plan: { platform, kind: "photo", media: image } };
    }
    case "carousel": {
      if (media.length < CAROUSEL_MIN || media.length > CAROUSEL_MAX) {
        return fail(
          `A carousel needs ${CAROUSEL_MIN}–${CAROUSEL_MAX} slides attached (it has ${describe(media)}).`,
        );
      }
      if (platform === "facebook") {
        if (media.some((m) => m.kind !== "image")) {
          return fail(
            "A Facebook Page album takes images only; remove the video slides or post it by hand.",
          );
        }
        return { ok: true, plan: { platform, kind: "album", media } };
      }
      return { ok: true, plan: { platform, kind: "carousel", media } };
    }
    case "reel":
    case "video": {
      const videos = media.filter((m) => m.kind === "video");
      if (videos.length !== 1) {
        return fail(`A ${format} needs exactly one video attached (it has ${describe(media)}).`);
      }
      const video = videos[0];
      return platform === "instagram"
        ? { ok: true, plan: { platform, kind: "reel", media: [video], cover } }
        : { ok: true, plan: { platform, kind: "video", media: [video] } };
    }
    case "text":
      if (platform === "facebook") {
        if (!caption.trim()) return fail("A text post needs a caption.");
        return { ok: true, plan: { platform, kind: "text", media: [] } };
      }
      return fail("Instagram has no text-only posts; choose an image, carousel or reel.");
    case "story":
      return fail(
        "Stories are not published automatically yet; post it by hand with the post pack.",
      );
  }
}

const VIDEO_NAME = { youtube: "YouTube", tiktok: "TikTok" } as const;

function planVideoPlatform(
  platform: "youtube" | "tiktok",
  format: PostFormat,
  caption: string,
  sorted: PlanAsset[],
): PlanResult {
  const name = VIDEO_NAME[platform];
  if (format !== "video" && format !== "reel") {
    return fail(
      `${name} takes video and reel posts with one video attached; a ${format.replace("_", " ")} ` +
        "post cannot be uploaded there.",
    );
  }
  const body = sorted.filter((a) => a.role === "slide" || a.role === "clip");
  const videos = body.filter((a) => a.kind === "video");
  if (videos.length !== 1) {
    return fail(
      `A ${format} for ${name} needs exactly one video attached (it has ${describe(body)}).`,
    );
  }
  const video = videos[0];
  if (platform === "tiktok") {
    if (caption.length > TIKTOK_CAPTION_MAX) {
      return fail(
        `The caption is ${caption.length} characters; TikTok allows ${TIKTOK_CAPTION_MAX}.`,
      );
    }
    return { ok: true, plan: { platform, kind: "video", media: [video] } };
  }
  const thumbnail = sorted.find((a) => a.role === "thumbnail" && a.kind === "image") ?? null;
  return {
    ok: true,
    plan: { platform, kind: "video", media: [video], thumbnail, short: isShort(video) },
  };
}

function describe(list: PlanAsset[]): string {
  if (!list.length) return "none";
  const images = list.filter((a) => a.kind === "image").length;
  const videos = list.filter((a) => a.kind === "video").length;
  const parts = [images && `${images} image(s)`, videos && `${videos} video(s)`].filter(Boolean);
  return parts.join(" and ") || `${list.length} file(s) of another kind`;
}

/** Every asset the plan needs a public URL for, in order. */
export function planAssets(plan: PublishPlan): PlanAsset[] {
  if (plan.platform === "youtube" && plan.thumbnail) return [...plan.media, plan.thumbnail];
  return plan.kind === "reel" && plan.cover ? [...plan.media, plan.cover] : [...plan.media];
}

// --- retry backoff ----------------------------------------------------------

/** Automatic attempts for a scheduled post before it stays failed. */
export const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5 * 60 * 1000;

/** A temporary failure's `publish_error` starts with this; only those are retried by the due run. */
export const TEMPORARY_PREFIX = "Temporary: ";

/** 5, 10, 20 … minutes after the last attempt started. */
export function nextAttemptAt(attempts: number, lastAttemptAt: Date | null): Date | null {
  if (!lastAttemptAt || attempts <= 0) return null;
  return new Date(lastAttemptAt.getTime() + BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

export function retryDue(
  post: { publishAttempts: number; lastPublishAttemptAt: Date | null; publishError: string | null },
  now: Date,
): boolean {
  if (!post.publishError?.startsWith(TEMPORARY_PREFIX)) return false;
  if (post.publishAttempts >= MAX_ATTEMPTS) return false;
  const next = nextAttemptAt(post.publishAttempts, post.lastPublishAttemptAt);
  return !next || next.getTime() <= now.getTime();
}
