import type { Asset, BrandKit, PostAssetRole, PostFormat } from "@/db/schema";
import { assetFileName, postFolder } from "@/lib/storage/paths";

import type { PostDraft } from "./contract";

/**
 * The two ways a post leaves the app before O13 publishes it (PLAN.md §1.45,
 * §1.49), as pure functions of rows already read:
 *
 * - **brief** — every visual the post needs, with its prompt, the file it must
 *   be saved as (§1.41 layout) and the brand kit's Higgsfield references, for
 *   `.claude/commands/higgsfield-post.md` (S14);
 * - **pack** — what goes out, in order: caption, first comment and the files,
 *   for the phone "post pack" (S15).
 *
 * Each comes as Markdown for a person and JSON for a command.
 */

export const POST_EXPORT_FORMATS = ["brief", "pack"] as const;
export type PostExportFormat = (typeof POST_EXPORT_FORMATS)[number];

/** The caption as posted: the copy, a blank line, then the hashtags. */
export function captionText(draft: Pick<PostDraft, "caption" | "hashtags">): string {
  const tags = draft.hashtags.map((t) => `#${t}`).join(" ");
  return tags ? `${draft.caption.trim()}\n\n${tags}` : draft.caption.trim();
}

/** The aspect ratio a format's visuals are made in (Instagram's feed is 4:5, everything vertical 9:16). */
export function aspectRatioFor(format: PostFormat, platform: string | null): string {
  if (format === "reel" || format === "story") return "9:16";
  if (format === "video") return platform === "youtube" ? "16:9" : "9:16";
  if (platform === "facebook" && format === "image_post") return "1:1";
  return "4:5";
}

export type BriefVisual = {
  /** 1-based, the file's position in the post folder. */
  n: number;
  kind: "slide" | "shot" | "story_frame";
  role: PostAssetRole;
  /** What the visual shows, for the person reviewing the brief. */
  label: string;
  prompt: string;
  /** Set for a reel/video shot: how the still moves. */
  videoPrompt?: string;
  textOverlay?: string;
  aspectRatio: string;
  /** Relative to `MEDIA_ROOT`: where the finished file is saved. */
  targetFile: string;
  /** Set for a shot: where the animated clip is saved. */
  targetVideoFile?: string;
};

export type PostBrief = {
  postId: number;
  brandId: string;
  handle: string | null;
  platform: string | null;
  format: PostFormat;
  language: string;
  title: string;
  /** The post's folder under `MEDIA_ROOT`; the manifest goes here too. */
  folder: string;
  kit: {
    higgsfieldElementIds: string[];
    higgsfieldCharacterIds: string[];
    styleNotes: string;
    colors: { name: string; hex: string }[];
    logoAssetId: number | null;
  } | null;
  visuals: BriefVisual[];
};

export type BriefPost = {
  id: number;
  brandId: string;
  handle: string | null;
  platform: string | null;
  title: string;
  scheduledFor: Date | null;
  createdAt: Date;
};

/** Every visual in the post with its prompt, target file and the kit's references (§1.45). */
export function buildBrief(post: BriefPost, draft: PostDraft, kit: BrandKit | null): PostBrief {
  const folderInput = {
    brandId: post.brandId,
    accountHandle: post.handle,
    postId: post.id,
    title: post.title || draft.hook,
    date: post.scheduledFor ?? post.createdAt,
  };
  const folder = postFolder(folderInput);
  const aspectRatio = aspectRatioFor(draft.format, post.platform);
  const file = (n: number, label: string, ext: string) =>
    `${folder}/${assetFileName(n, label, ext)}`;

  const visuals: BriefVisual[] = [];
  for (const s of draft.slides ?? []) {
    visuals.push({
      n: s.n,
      kind: "slide",
      role: s.n === 1 && draft.format === "carousel" ? "cover" : "slide",
      label: s.headline,
      prompt: s.visual.prompt,
      textOverlay: s.visual.textOverlay,
      aspectRatio,
      targetFile: file(s.n, s.headline, "png"),
    });
  }
  for (const s of draft.shots ?? []) {
    const label = s.onScreenText || s.voiceover || `shot ${s.n}`;
    visuals.push({
      n: s.n,
      kind: "shot",
      role: "clip",
      label,
      prompt: s.visual.imagePrompt,
      videoPrompt: s.visual.videoPrompt,
      textOverlay: s.onScreenText,
      aspectRatio,
      targetFile: file(s.n, label, "png"),
      targetVideoFile: file(s.n, label, "mp4"),
    });
  }
  for (const f of draft.storyFrames ?? []) {
    const label = f.text || `frame ${f.n}`;
    visuals.push({
      n: f.n,
      kind: "story_frame",
      role: "slide",
      label,
      prompt: f.visual.prompt,
      textOverlay: f.text,
      aspectRatio,
      targetFile: file(f.n, label, "png"),
    });
  }

  return {
    postId: post.id,
    brandId: post.brandId,
    handle: post.handle,
    platform: post.platform,
    format: draft.format,
    language: draft.language,
    title: post.title,
    folder,
    kit: kit
      ? {
          higgsfieldElementIds: kit.higgsfield?.elementIds ?? [],
          higgsfieldCharacterIds: kit.higgsfield?.characterIds ?? [],
          styleNotes: kit.higgsfield?.styleNotes ?? "",
          colors: kit.colors,
          logoAssetId: kit.logoAssetId,
        }
      : null,
    visuals,
  };
}

export function briefMarkdown(brief: PostBrief): string {
  const lines = [
    `# Generation brief — post ${brief.postId}: ${brief.title}`,
    "",
    `- Account: ${brief.handle ? `@${brief.handle}` : "(brand level)"} on ${brief.platform ?? "?"}`,
    `- Format: ${brief.format}, language ${brief.language}`,
    `- Folder: \`${brief.folder}/\` (save \`manifest.json\` here too)`,
  ];
  if (brief.kit) {
    const k = brief.kit;
    if (k.higgsfieldElementIds.length)
      lines.push(`- Higgsfield elements: ${k.higgsfieldElementIds.join(", ")}`);
    if (k.higgsfieldCharacterIds.length)
      lines.push(`- Higgsfield characters: ${k.higgsfieldCharacterIds.join(", ")}`);
    if (k.styleNotes.trim()) lines.push(`- Style: ${k.styleNotes.trim()}`);
    if (k.colors.length)
      lines.push(`- Colors: ${k.colors.map((c) => `${c.name} ${c.hex}`).join(", ")}`);
  }
  lines.push("", "## Visuals", "");
  for (const v of brief.visuals) {
    lines.push(`### ${v.n}. ${v.label} (${v.kind}, ${v.aspectRatio})`, "");
    lines.push(`- Prompt: ${v.prompt}`);
    if (v.videoPrompt) lines.push(`- Motion: ${v.videoPrompt}`);
    if (v.textOverlay) lines.push(`- Text on it (added after, not generated): ${v.textOverlay}`);
    lines.push(`- Save as: \`${v.targetFile}\``);
    if (v.targetVideoFile) lines.push(`- Clip: \`${v.targetVideoFile}\``);
    lines.push("");
  }
  if (!brief.visuals.length) lines.push("This post has no visuals to generate.", "");
  lines.push("```json", JSON.stringify(brief, null, 2), "```", "");
  return lines.join("\n");
}

export type PackFile = {
  position: number;
  role: PostAssetRole;
  assetId: number;
  kind: Asset["kind"];
  mime: string;
  /** Owner-only download through the app. */
  url: string;
  /** The Hostinger copy, when one exists (what O13 publishes from). */
  publicUrl: string | null;
  fileName: string | null;
  altText: string | null;
};

export type PostPack = {
  postId: number;
  handle: string | null;
  platform: string | null;
  format: PostFormat;
  caption: string;
  firstComment: string | null;
  altText: string | null;
  scheduledFor: string | null;
  files: PackFile[];
};

/** What goes out, in order (§1.49): the phone post pack. */
export function buildPack(
  post: BriefPost & { caption: string | null; firstComment: string | null },
  draft: PostDraft,
  files: { position: number; role: PostAssetRole; asset: Asset }[],
): PostPack {
  return {
    postId: post.id,
    handle: post.handle,
    platform: post.platform,
    format: draft.format,
    caption: post.caption ?? captionText(draft),
    firstComment: post.firstComment ?? draft.firstComment ?? null,
    altText: draft.altText ?? null,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    files: files.map((f) => ({
      position: f.position,
      role: f.role,
      assetId: f.asset.id,
      kind: f.asset.kind,
      mime: f.asset.mime,
      url: `/api/media/asset/${f.asset.id}`,
      publicUrl: f.asset.publicUrl,
      fileName: f.asset.localPath?.split("/").pop() ?? null,
      altText: f.asset.altText,
    })),
  };
}

export function packMarkdown(pack: PostPack): string {
  const lines = [
    `# Post pack — ${pack.handle ? `@${pack.handle}` : "post"} (${pack.platform ?? "?"}, ${pack.format})`,
    "",
  ];
  if (pack.scheduledFor) lines.push(`Scheduled for ${pack.scheduledFor}`, "");
  lines.push("## Caption", "", pack.caption, "");
  if (pack.firstComment) lines.push("## First comment", "", pack.firstComment, "");
  if (pack.altText) lines.push("## Alt text", "", pack.altText, "");
  lines.push("## Files, in order", "");
  if (!pack.files.length) lines.push("No files attached yet.");
  for (const f of pack.files) {
    lines.push(`${f.position}. ${f.fileName ?? `asset ${f.assetId}`} (${f.role}) — ${f.url}`);
  }
  lines.push("");
  return lines.join("\n");
}
