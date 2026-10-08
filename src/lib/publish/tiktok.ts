import { tiktokPost } from "@/lib/tiktok/http";

import { PublishFailure } from "./meta";
import type { TikTokOptions } from "./options";
import { ProviderApiError, send, sleep, type HttpFetch } from "./provider-error";
import type { MediaFile } from "./video-file";

/**
 * TikTok Content Posting API (build 4 §3.F), two modes:
 *
 * - `inbox` (default): `POST /v2/post/publish/inbox/video/init/` with
 *   `FILE_UPLOAD`, then the bytes in chunks. The video lands in the creator's
 *   TikTok drafts (inbox) to finish in the app. Works without an app audit.
 * - `direct`: `POST /v2/post/publish/creator_info/query/` (what this creator
 *   may do now), then `/v2/post/publish/video/init/` with `post_info`. An
 *   unaudited app may only post `SELF_ONLY`.
 *
 * Either way `/v2/post/publish/status/fetch/` is polled until TikTok says
 * where the video went; a video still processing is resumed by the next run
 * from its `publish_id` (kept in `external_container_id`), like an IG reel.
 * Live path UNVERIFIED (§1.12).
 */

const MB = 1024 * 1024;
/** TikTok: chunks of 5–64 MB; the last may hold the remainder (≤ 128 MB); a file under 5 MB is one chunk. */
export const TIKTOK_CHUNK_BYTES = 10 * MB;
export const TIKTOK_MAX_CHUNKS = 1000;

export type ChunkPlan = { chunkSize: number; count: number; ranges: Array<[number, number]> };

/** `[start, endExclusive)` per chunk; the last chunk absorbs the remainder. Pure. */
export function tiktokChunks(size: number, chunkBytes = TIKTOK_CHUNK_BYTES): ChunkPlan {
  if (size <= chunkBytes) return { chunkSize: size, count: 1, ranges: [[0, size]] };
  const count = Math.floor(size / chunkBytes);
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    ranges.push([i * chunkBytes, i === count - 1 ? size : (i + 1) * chunkBytes]);
  }
  return { chunkSize: chunkBytes, count, ranges };
}

export type CreatorInfo = {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

export type TikTokStatus = {
  status?:
    | "PROCESSING_UPLOAD"
    | "PROCESSING_DOWNLOAD"
    | "SEND_TO_USER_INBOX"
    | "PUBLISH_COMPLETE"
    | "FAILED";
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
  uploaded_bytes?: number;
};

/** Durable state for one upload; never reused with different source bytes. */
export type TikTokUpload = {
  publishId: string;
  uploadUrl: string;
  size: number;
  chunkBytes: number;
  uploadedBytes: number;
  expiresAt: string;
  sourceKey?: string;
};

export type TikTokContext = {
  token: string;
  fetch: HttpFetch;
  handle: string;
  caption: string;
  chunkBytes: number;
  poll: { tries: number; delayMs: number };
  /** Saves (or clears) the `publish_id`, so a crash resumes instead of posting twice. */
  saveContainer: (publishId: string | null) => Promise<void>;
  saveUpload?: (session: TikTokUpload | null) => Promise<void>;
  sourceKey?: string;
  beforeCommit?: () => Promise<void>;
  uploadComplete?: boolean;
};

export type TikTokDone =
  | { status: "published"; mediaId: string; permalink: string | null; inbox: boolean }
  | { status: "pending"; containerId: string };

/** The `post_info` for a direct post, checked against what the creator may do now. Pure. */
export function directPostInfo(
  options: TikTokOptions,
  creator: CreatorInfo,
  caption: string,
  durationSec: number | null | undefined,
): { ok: true; postInfo: Record<string, unknown> } | { ok: false; error: string } {
  const allowed = creator.privacy_level_options ?? [];
  if (!allowed.includes(options.privacy)) {
    return {
      ok: false,
      error:
        `TikTok does not allow privacy ${options.privacy} for @${creator.creator_username ?? "this creator"} ` +
        `(allowed: ${allowed.join(", ") || "none"}). An unaudited app may only post SELF_ONLY.`,
    };
  }
  const max = creator.max_video_post_duration_sec;
  if (max && durationSec && durationSec > max) {
    return {
      ok: false,
      error: `The video is ${Math.round(durationSec)} s; this TikTok account may post up to ${max} s.`,
    };
  }
  return {
    ok: true,
    postInfo: {
      title: caption,
      privacy_level: options.privacy,
      disable_comment: options.disableComment || creator.comment_disabled === true,
      disable_duet: options.disableDuet || creator.duet_disabled === true,
      disable_stitch: options.disableStitch || creator.stitch_disabled === true,
      video_cover_timestamp_ms: 1000,
      ...(options.isAigc ? { is_aigc: true } : {}),
    },
  };
}

async function uploadChunks(
  ctx: TikTokContext,
  session: TikTokUpload,
  file: MediaFile,
  mime: string,
) {
  const plan = tiktokChunks(file.size, session.chunkBytes);
  if (file.size !== session.size || (session.sourceKey && session.sourceKey !== ctx.sourceKey)) {
    throw new PublishFailure(
      "The source changed during the TikTok upload. Verify the existing upload before sending again.",
      false,
      true,
    );
  }
  for (const [i, [start, end]] of plan.ranges.entries()) {
    if (end <= session.uploadedBytes) continue;
    if (start !== session.uploadedBytes)
      throw new PublishFailure(
        "TikTok reported an unexpected partial chunk. Verify the existing upload before sending again.",
        false,
        true,
      );
    if (end === file.size) await ctx.beforeCommit?.();
    let attempt = 0;
    for (;;) {
      let res: Response | null = null;
      try {
        res = await send("tiktok", ctx.fetch, session.uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": mime,
            "content-range": `bytes ${start}-${end - 1}/${file.size}`,
          },
          body: await file.read(start, end - start),
        });
      } catch {
        res = null;
      }
      if (res && [200, 201, 206].includes(res.status)) {
        await res.body?.cancel();
        session = { ...session, uploadedBytes: end };
        await ctx.saveUpload?.(session);
        break;
      }
      const transient = !res || res.status >= 500 || res.status === 429;
      if (res && !transient) {
        const text = await res.text().catch(() => "");
        throw new PublishFailure(
          `TikTok refused the existing upload (${res.status}): ${text.slice(0, 200)}. Check it before sending again.`,
          false,
          true,
        );
      }
      await res?.body?.cancel();
      if (++attempt > 2)
        throw new PublishFailure(
          `TikTok did not confirm chunk ${i + 1} of ${plan.count}. The saved upload will be checked before continuing.`,
          true,
          true,
        );
      await sleep(ctx.poll.delayMs * attempt);
    }
  }
}

/** Resume the same publish_id, using the provider's acknowledged byte offset. */
export async function resumeTikTok(
  ctx: TikTokContext,
  session: TikTokUpload,
  file: MediaFile,
  mime: string,
): Promise<TikTokDone> {
  const status = await tiktokPost<TikTokStatus>(
    "/v2/post/publish/status/fetch/",
    ctx.token,
    { publish_id: session.publishId },
    ctx.fetch,
  );
  if (status.status !== "PROCESSING_UPLOAD")
    return finishTikTok(
      { ...ctx, uploadComplete: session.uploadedBytes >= session.size },
      session.publishId,
    );
  if (new Date(session.expiresAt).getTime() <= Date.now())
    throw new PublishFailure(
      "The saved TikTok upload session expired. Check the existing publish_id before creating another post.",
      false,
      true,
    );
  const offset = status.uploaded_bytes ?? session.uploadedBytes;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > session.size)
    throw new PublishFailure(
      "TikTok reported an invalid upload offset. Check the existing upload.",
      false,
      true,
    );
  session = { ...session, uploadedBytes: offset };
  await ctx.saveUpload?.(session);
  await uploadChunks(ctx, session, file, mime);
  return finishTikTok({ ...ctx, uploadComplete: true }, session.publishId);
}

/** Upload one video in the chosen mode, then wait for TikTok's verdict. */
export async function publishTikTok(
  ctx: TikTokContext,
  options: TikTokOptions,
  file: MediaFile,
  mime: string,
  durationSec: number | null | undefined,
): Promise<TikTokDone> {
  const plan = tiktokChunks(file.size, ctx.chunkBytes);
  const sourceInfo = {
    source: "FILE_UPLOAD",
    video_size: file.size,
    chunk_size: plan.chunkSize,
    total_chunk_count: plan.count,
  };

  let init: { publish_id?: string; upload_url?: string };
  if (options.mode === "direct") {
    const creator = await tiktokPost<CreatorInfo>(
      "/v2/post/publish/creator_info/query/",
      ctx.token,
      {},
      ctx.fetch,
    );
    const info = directPostInfo(options, creator, ctx.caption, durationSec);
    if (!info.ok) throw new PublishFailure(info.error, false);
    init = await tiktokPost(
      "/v2/post/publish/video/init/",
      ctx.token,
      {
        post_info: info.postInfo,
        source_info: sourceInfo,
      },
      ctx.fetch,
    );
  } else {
    init = await tiktokPost(
      "/v2/post/publish/inbox/video/init/",
      ctx.token,
      {
        source_info: sourceInfo,
      },
      ctx.fetch,
    );
  }
  if (!init.publish_id || !init.upload_url) {
    throw new PublishFailure("TikTok started no upload (no publish_id or upload_url).", true);
  }
  const session: TikTokUpload = {
    publishId: init.publish_id,
    uploadUrl: init.upload_url,
    size: file.size,
    chunkBytes: ctx.chunkBytes,
    uploadedBytes: 0,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    sourceKey: ctx.sourceKey,
  };
  await ctx.saveUpload?.(session);
  await ctx.saveContainer(init.publish_id);
  await uploadChunks(ctx, session, file, mime);
  return finishTikTok({ ...ctx, uploadComplete: true }, init.publish_id);
}

/** Poll the status of a `publish_id` — also how an interrupted upload resumes. */
export async function finishTikTok(ctx: TikTokContext, publishId: string): Promise<TikTokDone> {
  for (let i = 0; i < Math.max(1, ctx.poll.tries); i++) {
    if (i > 0) await sleep(ctx.poll.delayMs);
    let s: TikTokStatus;
    try {
      s = await tiktokPost<TikTokStatus>(
        "/v2/post/publish/status/fetch/",
        ctx.token,
        { publish_id: publishId },
        ctx.fetch,
      );
    } catch (err) {
      // The upload is done; a status hiccup is not a reason to post again.
      if (err instanceof ProviderApiError && err.isTransient) continue;
      throw err;
    }
    switch (s.status) {
      case "PROCESSING_UPLOAD":
        if (ctx.uploadComplete) break;
        throw new PublishFailure(
          "TikTok is waiting for upload bytes. Resume the saved upload session or verify this legacy attempt in TikTok before creating another post.",
          false,
          true,
        );
      case "SEND_TO_USER_INBOX":
        return { status: "published", mediaId: publishId, permalink: null, inbox: true };
      case "PUBLISH_COMPLETE": {
        const postId = s.publicaly_available_post_id?.[0];
        return {
          status: "published",
          mediaId: postId ? String(postId) : publishId,
          permalink: postId ? `https://www.tiktok.com/@${ctx.handle}/video/${postId}` : null,
          inbox: false,
        };
      }
      case "FAILED":
        await ctx.saveContainer(null);
        throw new PublishFailure(
          `TikTok could not process the video: ${s.fail_reason ?? "no reason given"}.`,
          false,
        );
    }
  }
  return { status: "pending", containerId: publishId };
}
