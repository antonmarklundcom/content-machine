import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assets, brands, type Post, type SocialAccount } from "@/db/schema";
import { googleFetch } from "@/lib/google/http";
import { youtubeAccessToken } from "@/lib/google/integration";
import { assetOriginal } from "@/lib/media/originals";
import { tiktokFetch } from "@/lib/tiktok/http";
import { tiktokAccessToken } from "@/lib/tiktok/integration";

import { getConnection } from "./connections";
import { PublishFailure } from "./meta";
import { isKidsBrand, parseTikTokOptions, parseYouTubeOptions } from "./options";
import { planPublish, type PlanAsset, type PublishPlan } from "./plan";
import { PROVIDER_NAME, type HttpFetch, type VideoProvider } from "./provider-error";
import {
  finishTikTok,
  publishTikTok,
  resumeTikTok,
  TIKTOK_CHUNK_BYTES,
  type TikTokContext,
  type TikTokUpload,
} from "./tiktok";
import { MediaFileError, openMediaFile, type MediaFile } from "./video-file";
import {
  buildYouTubeVideo,
  setYouTubeThumbnail,
  uploadYouTubeVideo,
  YOUTUBE_CHUNK_BYTES,
  youtubePermalink,
} from "./youtube";

/**
 * Publishing to YouTube and TikTok (build 4 §3.F), called by `publishPost`
 * under the same per-post lease and status claim as Meta (O13). Unlike Meta,
 * these APIs take the bytes, so files are read from `MEDIA_ROOT` and no
 * public copy is made.
 */

export class VideoRefusal extends Error {}

export type VideoPublishOptions = {
  now: Date;
  fetch?: HttpFetch;
  poll: { tries: number; delayMs: number };
  chunkBytes?: number;
  onCredential?: (version: number) => void;
};

export type VideoDone =
  | {
      status: "published";
      mediaId: string;
      permalink: string | null;
      notes: string[];
      used: PlanAsset[];
    }
  | { status: "pending"; containerId: string };

async function token(provider: VideoProvider, account: SocialAccount, opts: VideoPublishOptions) {
  const name = PROVIDER_NAME[provider];
  const row = await getConnection(provider, account.integrationId!);
  if (!row) {
    throw new VideoRefusal(
      `@${account.handle}'s ${name} connection no longer exists. Reconnect in Settings → ${name}.`,
    );
  }
  if (row.accountRef !== account.externalId)
    throw new VideoRefusal(
      "The connection identity no longer matches this account. Relink and verify the destination.",
    );
  const fetchImpl = opts.fetch ?? (provider === "youtube" ? googleFetch() : tiktokFetch());
  const t =
    provider === "youtube"
      ? await youtubeAccessToken(row, fetchImpl, opts.now)
      : await tiktokAccessToken(row, fetchImpl, opts.now);
  if (!t.ok) throw new VideoRefusal(`@${account.handle}: ${t.reason}`);
  opts.onCredential?.(t.credentialVersion);
  return { token: t.token, fetchImpl };
}

async function withFile<T>(asset: PlanAsset, run: (file: MediaFile) => Promise<T>): Promise<T> {
  let file: MediaFile;
  try {
    if (!asset.sha256)
      throw new VideoRefusal(
        "The media has no stored hash; review and register it before sending.",
      );
    const original = await assetOriginal({
      localPath: asset.localPath ?? null,
      sha256: asset.sha256,
    });
    if (!original)
      throw new VideoRefusal(
        "The media bytes no longer match the approved hash; restore and review the file before sending.",
      );
    file = await openMediaFile(original.rel, `${asset.name} (asset ${asset.assetId})`);
    if (file.size !== asset.bytes) {
      await file.close();
      throw new VideoRefusal("The media byte count no longer matches its approved identity.");
    }
  } catch (err) {
    if (err instanceof MediaFileError) throw new VideoRefusal(err.message);
    throw err;
  }
  try {
    return await run(file);
  } finally {
    await file.close();
  }
}

const mimeOf = (a: PlanAsset, fallback: string) => a.mime || fallback;

export async function publishVideoPost(input: {
  post: Post;
  account: SocialAccount;
  caption: string;
  assets: PlanAsset[];
  resume: boolean;
  saveContainer: (id: string | null) => Promise<void>;
  saveUpload: (session: TikTokUpload | null) => Promise<void>;
  beforeCommit: () => Promise<void>;
  options: VideoPublishOptions;
}): Promise<VideoDone> {
  const { post, account, options } = input;
  const provider = account.platform as VideoProvider;
  const { token: accessToken, fetchImpl } = await token(provider, account, options);

  if (provider === "tiktok") {
    const plan = mustPlan(post, account, input);
    const video = plan.media[0];
    const ctx: TikTokContext = {
      token: accessToken,
      fetch: fetchImpl,
      handle: account.handle,
      caption: input.caption,
      chunkBytes: options.chunkBytes ?? TIKTOK_CHUNK_BYTES,
      poll: options.poll,
      saveContainer: input.saveContainer,
      saveUpload: input.saveUpload,
      beforeCommit: input.beforeCommit,
      sourceKey: `${video.assetId}:${video.sha256}`,
    };
    if (input.resume && post.externalContainerId) {
      const saved = post.publishUpload;
      if (saved && saved.publishId !== post.externalContainerId)
        throw new PublishFailure(
          "The stored TikTok upload identity does not match its container. Verify the existing upload.",
          false,
          true,
        );
      const done = saved
        ? await withFile(video, (file) =>
            resumeTikTok(ctx, saved, file, mimeOf(video, "video/mp4")),
          )
        : await finishTikTok(ctx, post.externalContainerId);
      return tiktokDone(done, plan.media);
    }
    const parsed = parseTikTokOptions(post.publishOptions);
    if (!parsed.ok) throw new VideoRefusal(parsed.error);
    const done = await withFile(video, (file) =>
      publishTikTok(ctx, parsed.value, file, mimeOf(video, "video/mp4"), video.durationSec),
    );
    return tiktokDone(done, plan.media);
  }

  // YouTube: one synchronous resumable upload; nothing to resume across runs.
  const plan = mustPlan(post, account, input) as Extract<PublishPlan, { platform: "youtube" }>;
  const parsed = parseYouTubeOptions(post.publishOptions);
  if (!parsed.ok) throw new VideoRefusal(parsed.error);
  const [brand] = await db.select().from(brands).where(eq(brands.id, post.brandId)).limit(1);
  const built = buildYouTubeVideo({
    title: post.title,
    caption: input.caption,
    leadUrl: post.leadUrl,
    options: parsed.value,
    kidsBrand: brand ? isKidsBrand(brand) : isKidsBrand({ id: post.brandId }),
    language: account.language ?? brand?.language ?? null,
    short: plan.short,
    now: options.now,
  });
  if (!built.ok) throw new VideoRefusal(built.error);
  const uploader = {
    token: accessToken,
    fetch: fetchImpl,
    chunkBytes: options.chunkBytes ?? YOUTUBE_CHUNK_BYTES,
    retries: 4,
    retryDelayMs: options.poll.delayMs,
  };
  const video = plan.media[0];
  const videoId = await withFile(video, async (file) => {
    return uploadYouTubeVideo(uploader, built.resource, file, mimeOf(video, "video/mp4"), {
      notifySubscribers: parsed.value.notifySubscribers,
      beforeCommit: input.beforeCommit,
    });
  });

  // The video exists; nothing below may turn this into a failure.
  const notes = [...built.notes];
  if (plan.thumbnail) {
    const thumb = plan.thumbnail;
    try {
      await withFile(thumb, (file) =>
        setYouTubeThumbnail(uploader, videoId, file, mimeOf(thumb, "image/jpeg")),
      );
    } catch (err) {
      notes.push(
        `the thumbnail was not set (${err instanceof Error ? err.message : String(err)}); set it in YouTube Studio`,
      );
    }
  }
  if (built.resource.status.privacyStatus !== "public" && !built.resource.status.publishAt) {
    notes.push(`it is ${built.resource.status.privacyStatus} on YouTube until you change it`);
  }
  return {
    status: "published",
    mediaId: videoId,
    permalink: youtubePermalink(videoId, plan.short),
    notes,
    used: plan.thumbnail ? [video, plan.thumbnail] : [video],
  };
}

function tiktokDone(done: Awaited<ReturnType<typeof finishTikTok>>, used: PlanAsset[]): VideoDone {
  if (done.status === "pending") return done;
  return {
    status: "published",
    mediaId: done.mediaId,
    permalink: done.permalink,
    notes: done.inbox
      ? ["it is in the TikTok inbox (drafts): open TikTok, paste the caption and post it"]
      : [],
    used,
  };
}

function mustPlan(
  post: Post,
  account: SocialAccount,
  input: { caption: string; assets: PlanAsset[] },
): Extract<PublishPlan, { platform: "youtube" | "tiktok" }> {
  const plan = planPublish({
    platform: account.platform,
    format: post.format,
    caption: input.caption,
    assets: input.assets,
  });
  if (!plan.ok) throw new VideoRefusal(plan.error);
  if (plan.plan.platform !== "youtube" && plan.plan.platform !== "tiktok") {
    throw new PublishFailure("Internal: a video platform got a Meta plan.", false);
  }
  return plan.plan;
}

/** Asset fields an upload needs, by id (for `attached()` in index.ts). */
export const UPLOAD_FIELDS = {
  localPath: assets.localPath,
  mime: assets.mime,
  bytes: assets.bytes,
  width: assets.width,
  height: assets.height,
  durationSec: assets.durationSec,
};
