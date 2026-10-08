import { slugify } from "@/lib/format";

/**
 * The folder layout under `MEDIA_ROOT` — the contract (PLAN.md §1.41). Every
 * command and job that writes a file asks this module where; nothing else
 * builds a media path by hand. All paths are relative, forward slashes.
 *
 *   <brand>/<account-handle|_brand>/<YYYY-MM>/<post-id>-<slug>/NN-<slug>.<ext>
 *   _inbox/higgsfield/<YYYY-MM-DD>/        unsorted Higgsfield imports
 *   captures/<clip-id>/                     fetched reels (research only)
 *   _thumbs/<sha[0..2]>/<sha>.webp          thumbnails made by registerFile
 */

/** Folders the scanner treats as the app's own, never as media to register. */
export const THUMBS_DIR = "_thumbs";
export const INBOX_DIR = "_inbox";
export const CAPTURES_DIR = "captures";
/** The account segment for a post or asset that belongs to the brand, not one handle. */
export const BRAND_LEVEL = "_brand";

/**
 * A path segment from free text: lower-case `[a-z0-9-]`, never empty, never a
 * dot-name — and never starting with `_`, so no brand or title can collide
 * with the app's own `_inbox`, `_thumbs` or `_brand` folders.
 */
export function segment(value: string, fallback = "untitled"): string {
  return slugify(value, { fallback });
}

/** An account handle as a folder: `@Foo.Bar` → `foo-bar`. */
export function handleSegment(handle: string | null | undefined): string {
  if (!handle) return BRAND_LEVEL;
  return segment(handle.replace(/^@+/, ""), BRAND_LEVEL);
}

function yyyymm(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type PostFolderInput = {
  brandId: string;
  /** Null for a brand-level post. */
  accountHandle?: string | null;
  postId: number;
  /** The post's title; slugified. */
  title: string;
  /** The month folder — the post's scheduled date, else its creation date. */
  date: Date;
};

/** `<brand>/<handle|_brand>/<YYYY-MM>/<post-id>-<slug>` */
export function postFolder(input: PostFolderInput): string {
  return [
    segment(input.brandId, "_unsorted"),
    handleSegment(input.accountHandle),
    yyyymm(input.date),
    `${input.postId}-${segment(input.title, "post")}`,
  ].join("/");
}

/** `NN-<slug>.<ext>` — the position is 1-based and two digits, so a folder sorts in post order. */
export function assetFileName(position: number, label: string, ext: string): string {
  const n = String(Math.max(0, Math.trunc(position))).padStart(2, "0");
  const cleanExt =
    ext
      .replace(/^\.+/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin";
  return `${n}-${segment(label, "asset")}.${cleanExt}`;
}

/** `<post folder>/NN-<slug>.<ext>` */
export function postAssetPath(
  post: PostFolderInput,
  position: number,
  label: string,
  ext: string,
): string {
  return `${postFolder(post)}/${assetFileName(position, label, ext)}`;
}

/** `_inbox/higgsfield/<YYYY-MM-DD>` */
export function higgsfieldInboxFolder(date: Date): string {
  return `${INBOX_DIR}/higgsfield/${yyyymmdd(date)}`;
}

/** `captures/<clip-id>` */
export function captureFolder(clipId: number): string {
  return `${CAPTURES_DIR}/${Math.trunc(clipId)}`;
}

/** `_thumbs/<ab>/<sha>.webp` — content-addressed, so two paths to one file share a thumbnail. */
export function thumbnailPath(sha256: string): string {
  const sha = sha256.toLowerCase();
  return `${THUMBS_DIR}/${sha.slice(0, 2)}/${sha}.webp`;
}

// --- build 4 (docs/PLAN-build4.md §2) -----------------------------------------

export const VOICE_DIR = "voice";
export const STORIES_DIR = "stories";
export const RENDERS_DIR = "renders";

/**
 * `voice/<owner-kind>/<owner-ref>/<scene|_all>/<language>` — every take of one
 * line sits together, so the take history is a folder listing.
 */
export function narrationFolder(input: {
  ownerKind: string;
  ownerRef: string;
  sceneRef?: string | null;
  language: string;
}): string {
  return [
    VOICE_DIR,
    segment(input.ownerKind, "free"),
    segment(input.ownerRef.replace(/[:/]+/g, "-"), "owner"),
    input.sceneRef ? segment(input.sceneRef, "_all") : "_all",
    segment(input.language, "und"),
  ].join("/");
}

/** `stories/<slug>/video/<language>` — rendered story videos and their captions. */
export function storyVideoFolder(slug: string, language: string): string {
  return `${STORIES_DIR}/${segment(slug, "story")}/video/${segment(language, "und")}`;
}

/** `renders/<owner-kind>/<owner-ref>/<language>` — renders of scripts and posts. */
export function renderFolder(ownerKind: string, ownerRef: string, language: string): string {
  return [
    RENDERS_DIR,
    segment(ownerKind, "owner"),
    segment(ownerRef.replace(/[:/]+/g, "-"), "owner"),
    segment(language, "und"),
  ].join("/");
}
