import { MetaGraphError } from "@/lib/meta/graph";

import { isTransient, type GraphWriter } from "./graph";
import type { PlanAsset, PublishPlan } from "./plan";

/**
 * The Graph calls that publish one plan (PLAN.md §5.O13), against recorded
 * fixtures in tests. Instagram is two-step: create a container (child
 * containers first for a carousel), wait until Meta has fetched and processed
 * the media, then `media_publish`. A Facebook Page post is one call.
 *
 * The call that makes a post public is wrapped in `commit()`: if Meta cannot
 * be reached or answers 5xx *there*, the post may or may not be live, so the
 * failure is never retried automatically.
 */

export class PublishFailure extends Error {
  constructor(
    message: string,
    readonly temporary: boolean,
    /** Keep the IG container: publishing it again is how a retry stays safe. */
    readonly keepContainer = false,
  ) {
    super(message);
    this.name = "PublishFailure";
  }
}

export type PollOptions = {
  /** Status checks before a still-processing container is left for the next run. */
  tries: number;
  delayMs: number;
};

export type Published = { status: "published"; mediaId: string };
export type Pending = { status: "pending"; containerId: string };

export type PublishContext = {
  writer: GraphWriter;
  /** IG user id or FB Page id. */
  targetId: string;
  handle: string;
  caption: string;
  urls: Map<number, string>;
  poll: PollOptions;
  /** Called as soon as the IG container exists, so a crash can resume from it. */
  onContainer?: (containerId: string) => Promise<void>;
  /** Durably records uncertainty before a call that can make content live. */
  beforeCommit?: () => Promise<void>;
};

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function url(ctx: PublishContext, a: PlanAsset): string {
  const u = ctx.urls.get(a.assetId);
  if (!u) throw new PublishFailure(`${a.name} has no public URL.`, false);
  return u;
}

async function commit<T>(ctx: PublishContext, where: string, call: () => Promise<T>): Promise<T> {
  await ctx.beforeCommit?.();
  try {
    return await call();
  } catch (err) {
    if (err instanceof MetaGraphError && isTransient(err)) {
      throw new PublishFailure(
        `Meta did not confirm the ${where} (${err.message}). It may be live: check @${ctx.handle} ` +
          "before retrying.",
        false,
        true,
      );
    }
    throw err;
  }
}

// --- Instagram ---------------------------------------------------------------

type ContainerStatus = { status_code?: string; status?: string };

/** Wait for a container; true when FINISHED, false when still IN_PROGRESS after the budget. */
async function waitForContainer(ctx: PublishContext, containerId: string): Promise<boolean> {
  for (let i = 0; i < Math.max(1, ctx.poll.tries); i++) {
    if (i > 0) await sleep(ctx.poll.delayMs);
    const s = await ctx.writer.get<ContainerStatus>(containerId, { fields: "status_code,status" });
    switch (s.status_code) {
      case "FINISHED":
      case "PUBLISHED":
        return true;
      case "ERROR":
        throw new PublishFailure(
          `Instagram could not process the media: ${s.status ?? "no reason given"}. Check the file's format and size.`,
          false,
        );
      case "EXPIRED":
        throw new PublishFailure(
          "The Instagram upload expired before it was published (containers last 24 hours). Publish again.",
          false,
        );
    }
  }
  return false;
}

async function createContainer(
  ctx: PublishContext,
  params: Record<string, string | boolean | undefined>,
) {
  const r = await ctx.writer.post<{ id: string }>(`${ctx.targetId}/media`, params);
  return r.id;
}

function mediaParams(ctx: PublishContext, a: PlanAsset): Record<string, string | undefined> {
  return a.kind === "video"
    ? { media_type: "VIDEO", video_url: url(ctx, a) }
    : { image_url: url(ctx, a) };
}

/** Create the containers for a plan; returns the one to publish. */
async function instagramContainer(
  ctx: PublishContext,
  plan: Extract<PublishPlan, { platform: "instagram" }>,
): Promise<string> {
  switch (plan.kind) {
    case "image": {
      const [img] = plan.media;
      return createContainer(ctx, {
        image_url: url(ctx, img),
        caption: ctx.caption,
        alt_text: img.altText ?? undefined,
      });
    }
    case "reel": {
      const [video] = plan.media;
      return createContainer(ctx, {
        media_type: "REELS",
        video_url: url(ctx, video),
        caption: ctx.caption,
        cover_url: plan.cover ? url(ctx, plan.cover) : undefined,
        share_to_feed: true,
      });
    }
    case "carousel": {
      const children: string[] = [];
      for (const item of plan.media) {
        const id = await createContainer(ctx, {
          ...mediaParams(ctx, item),
          is_carousel_item: true,
        });
        if (item.kind === "video" && !(await waitForContainer(ctx, id))) {
          throw new PublishFailure(`Instagram is still processing the video ${item.name}.`, true);
        }
        children.push(id);
      }
      return createContainer(ctx, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: ctx.caption,
      });
    }
  }
}

/** Wait for a container and publish it — also how an interrupted reel resumes. */
export async function finishInstagram(
  ctx: PublishContext,
  containerId: string,
): Promise<Published | Pending> {
  if (!(await waitForContainer(ctx, containerId))) return { status: "pending", containerId };
  const r = await commit(ctx, "Instagram publish", () =>
    ctx.writer.post<{ id: string }>(`${ctx.targetId}/media_publish`, { creation_id: containerId }),
  );
  return { status: "published", mediaId: r.id };
}

export async function publishInstagram(
  ctx: PublishContext,
  plan: Extract<PublishPlan, { platform: "instagram" }>,
): Promise<Published | Pending> {
  const containerId = await instagramContainer(ctx, plan);
  await ctx.onContainer?.(containerId);
  return finishInstagram(ctx, containerId);
}

// --- Facebook Page -----------------------------------------------------------

export async function publishFacebook(
  ctx: PublishContext,
  plan: Extract<PublishPlan, { platform: "facebook" }>,
): Promise<Published> {
  const page = ctx.targetId;
  switch (plan.kind) {
    case "photo": {
      const r = await commit(ctx, "Facebook photo post", () =>
        ctx.writer.post<{ id: string; post_id?: string }>(`${page}/photos`, {
          url: url(ctx, plan.media[0]),
          caption: ctx.caption,
        }),
      );
      return { status: "published", mediaId: r.post_id ?? r.id };
    }
    case "album": {
      const ids: string[] = [];
      for (const item of plan.media) {
        const r = await ctx.writer.post<{ id: string }>(`${page}/photos`, {
          url: url(ctx, item),
          published: false,
        });
        ids.push(r.id);
      }
      const attached: Record<string, string> = {};
      ids.forEach(
        (id, i) => (attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })),
      );
      const r = await commit(ctx, "Facebook album post", () =>
        ctx.writer.post<{ id: string }>(`${page}/feed`, { message: ctx.caption, ...attached }),
      );
      return { status: "published", mediaId: r.id };
    }
    case "video": {
      const r = await commit(ctx, "Facebook video post", () =>
        ctx.writer.post<{ id: string }>(`${page}/videos`, {
          file_url: url(ctx, plan.media[0]),
          description: ctx.caption,
        }),
      );
      return { status: "published", mediaId: r.id };
    }
    case "text": {
      const r = await commit(ctx, "Facebook post", () =>
        ctx.writer.post<{ id: string }>(`${page}/feed`, { message: ctx.caption }),
      );
      return { status: "published", mediaId: r.id };
    }
  }
}

// --- after publishing ----------------------------------------------------------

/** The public link: IG `permalink`, FB `permalink_url` (sometimes a relative path). */
export async function fetchPermalink(
  writer: GraphWriter,
  platform: "instagram" | "facebook",
  mediaId: string,
): Promise<string | null> {
  const field = platform === "instagram" ? "permalink" : "permalink_url";
  const r = await writer.get<Record<string, string | undefined>>(mediaId, { fields: field });
  const link = r[field];
  if (!link) return null;
  return link.startsWith("/") ? `https://www.facebook.com${link}` : link;
}

export async function postComment(
  writer: GraphWriter,
  mediaId: string,
  message: string,
): Promise<void> {
  await writer.post(`${mediaId}/comments`, { message });
}
