import { updateReturning } from "@/db/mutations";
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, like, lt, lte, or } from "drizzle-orm";

import { db } from "@/db";
import {
  assets,
  integrations,
  posts,
  socialAccounts,
  type Post,
  type SocialAccount,
} from "@/db/schema";
import { withLease } from "@/lib/lease";
import { assetOriginal } from "@/lib/media/originals";
import { publishCopy } from "@/lib/media/public";
import { GraphClient, graphFetch, MetaGraphError, type GraphFetch } from "@/lib/meta/graph";
import { setIntegrationStatus, usableToken } from "@/lib/meta/integration";
import { pageToken } from "@/lib/meta/pages";
import { validatePostDraft, type PostDraft } from "@/lib/posts/contract";
import { captionText } from "@/lib/posts/export";
import type { StorageDriver } from "@/lib/storage/driver";

import { approvalProblem, publicationBlock, sameTarget, type SendAsset } from "./safety";
import { sendSnapshot, SendRefusal, verifyOwner } from "./preflight";

import { GraphWriter, isTransient } from "./graph";
import { setConnectionStatus } from "./connections";
import {
  fetchPermalink,
  finishInstagram,
  postComment,
  publishFacebook,
  publishInstagram,
  PublishFailure,
  type PollOptions,
  type PublishContext,
} from "./meta";
import {
  MAX_ATTEMPTS,
  planAssets,
  planPublish,
  retryDue,
  TEMPORARY_PREFIX,
  type PlanAsset,
} from "./plan";
import { PROVIDER_NAME, ProviderApiError, type VideoProvider } from "./provider-error";
import { publishVideoPost, VideoRefusal, type VideoDone } from "./video";

/**
 * Publishing (PLAN.md §5.O13). An external, irreversible action, so it runs
 * only for a `scheduled` post whose time has come (`publishDue`, from
 * `npm run publish:due` and `/api/cron/publish`) or on the owner's "Publish
 * now" click (`publishPost` with `trigger: "manual"`).
 *
 * Two leases (§1.19): `publish` keeps two due runs from overlapping, and
 * `publish:post:<id>` — taken by the due run and the button alike — keeps two
 * callers from ever publishing the same post. The status claim
 * (`… → publishing` only from the status just read) is a third guard.
 *
 * Files come from `publishCopy()` (§1.41): Meta fetches them from the public
 * Hostinger URL. A temporary failure (Meta unreachable, 5xx, rate limit) before
 * the post went public is retried by the due run with backoff, at most
 * `MAX_ATTEMPTS` times; anything else stays `failed` with the reason.
 */

export const PUBLISH_LEASE = "publish";
export const PUBLISH_LEASE_TTL_MS = 15 * 60 * 1000;
const POST_LEASE_TTL_MS = 10 * 60 * 1000;
/** A `publishing` post with no container and no lease for this long was interrupted. */
export const STUCK_AFTER_MS = POST_LEASE_TTL_MS;

export const postLeaseName = (postId: number) => `publish:post:${postId}`;

export type PublishOptions = {
  now?: Date;
  /** Verified owner identity for an explicit manual send. Due sends require a stored approval. */
  ownerId?: number;
  expectedRevision?: number;
  fetch?: GraphFetch;
  poll?: Partial<PollOptions>;
  /** Injected storage drivers for `publishCopy` (tests). */
  drivers?: { local?: StorageDriver; public?: StorageDriver };
  /** Upload chunk size for YouTube / TikTok (tests use small ones). */
  chunkBytes?: number;
};

export type PublishOutcome = {
  postId: number;
  result: "published" | "pending" | "failed" | "skipped";
  message?: string;
  permalink?: string | null;
};

const DEFAULT_POLL: PollOptions = { tries: 6, delayMs: 5000 };

type Trigger = "due" | "manual";

class Refusal extends Error {}

/** Publish one post now, if it may be. Never throws for an expected failure. */
export async function publishPost(
  postId: number,
  options: PublishOptions & { trigger?: Trigger } = {},
): Promise<PublishOutcome> {
  const run = await withLease(postLeaseName(postId), POST_LEASE_TTL_MS, () =>
    publishLocked(postId, options.trigger ?? "manual", options),
  );
  if (!run.acquired) {
    return { postId, result: "skipped", message: "This post is already being published." };
  }
  return run.value;
}

function eligible(post: Post, trigger: Trigger, now: Date): string | null {
  const blocked = publicationBlock(post);
  if (blocked) return blocked;
  if (post.publishState === "sending" && !post.externalContainerId)
    return "The previous send has not been confirmed; reconcile it before trying again.";
  if (post.status === "published") return "It is already published.";
  if (post.status === "publishing") {
    return post.externalContainerId ? null : "It is being published right now.";
  }
  if (trigger === "manual") {
    return ["ready", "scheduled", "failed"].includes(post.status)
      ? null
      : `A ${post.status} post cannot be published; make it ready first.`;
  }
  const due = post.scheduledFor !== null && post.scheduledFor.getTime() <= now.getTime();
  if (post.status === "scheduled") return due ? null : "Its time has not come.";
  if (post.status === "failed" && due && retryDue(post, now)) return null;
  return "It is not due.";
}

async function publishLocked(
  postId: number,
  trigger: Trigger,
  options: PublishOptions & { ownerId?: number },
): Promise<PublishOutcome> {
  const now = options.now ?? new Date();
  let claimed: Post;
  let snapshot: Awaited<ReturnType<typeof sendSnapshot>>;
  let resume: boolean;
  try {
    const claim = await db.transaction(async (tx) => {
      const [post] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1)
        .for("update");
      if (!post) throw new Refusal(`No post ${postId}.`);
      if (options.expectedRevision !== undefined && options.expectedRevision !== post.revision)
        throw new Refusal("This post changed since you loaded it; reload before sending.");
      const refused = eligible(post, trigger, now);
      if (refused) throw new Refusal(refused);
      const resume =
        post.externalContainerId !== null && ["publishing", "failed"].includes(post.status);
      if (
        resume &&
        now.getTime() - (post.publishStartedAt?.getTime() ?? 0) >= 24 * 60 * 60 * 1000
      ) {
        await tx
          .update(posts)
          .set({
            status: "failed",
            publishState: "ambiguous",
            publishError:
              "The upload recovery window expired. Verify the provider before creating a new post.",
            updatedAt: now,
          })
          .where(
            and(
              eq(posts.id, post.id),
              eq(posts.revision, post.revision),
              eq(posts.publishAttemptId, post.publishAttemptId!),
            ),
          );
        return { expired: true as const };
      }
      const snapshot = await sendSnapshot(post, tx);
      const authorized = trigger === "manual" && options.ownerId !== undefined && !resume;
      if (authorized) await verifyOwner(options.ownerId!, tx);
      else {
        const problem = approvalProblem(post, snapshot.target);
        if (problem) throw new Refusal(problem);
        await verifyOwner(post.publishApprovedBy!, tx);
      }
      if (resume && !sameTarget(post.publishTarget, snapshot.target))
        throw new Refusal(
          "The upload destination or media changed. Verify the provider before creating a new post.",
        );
      const attemptId = resume ? post.publishAttemptId : randomUUID();
      if (!attemptId)
        throw new Refusal(
          "This legacy upload has no durable attempt identity. Verify it on the provider.",
        );
      const [claimed] = await updateReturning(
        tx,
        posts,
        {
          status: "publishing",
          publishError: null,
          lastPublishAttemptAt: now,
          publishStartedAt: resume ? post.publishStartedAt : now,
          publishAttempts: resume ? post.publishAttempts : post.publishAttempts + 1,
          publishAttemptId: attemptId,
          publishState: resume ? post.publishState : "idle",
          publishUpload: resume ? post.publishUpload : null,
          revision: post.revision + 1,
          publishTarget: snapshot.target,
          publishApprovedBy: authorized ? options.ownerId! : post.publishApprovedBy,
          publishApprovedAt: authorized ? now : post.publishApprovedAt,
          publishApprovedRevision: post.revision + 1,
          updatedAt: now,
        },
        and(
          eq(posts.id, postId),
          eq(posts.status, post.status),
          eq(posts.revision, post.revision),
          isNull(posts.externalMediaId),
          trigger === "due" && !resume ? lte(posts.scheduledFor, now) : undefined,
        ),
      );
      if (!claimed) throw new Refusal("The post changed before it could be claimed; reload.");
      return { claimed, snapshot, resume };
    });
    if ("expired" in claim)
      return {
        postId,
        result: "failed",
        message:
          "The upload recovery window expired. Verify the provider before creating a new post.",
      };
    ({ claimed, snapshot, resume } = claim);
  } catch (error) {
    if (error instanceof Refusal || error instanceof SendRefusal)
      return { postId, result: "skipped", message: error.message };
    throw error;
  }

  let integrationId: number | null = null;
  let credentialVersion: number | undefined;
  const fence = () =>
    and(
      eq(posts.id, postId),
      eq(posts.publishAttemptId, claimed.publishAttemptId!),
      eq(posts.status, "publishing"),
    );
  const saveContainer = async (containerId: string | null) => {
    // Retain the last known identity if the separate persistence callback fails.
    claimed.externalContainerId = containerId;
    const [saved] = await updateReturning(
      db,
      posts,
      { externalContainerId: containerId },
      fence(),
      { id: posts.id },
    );
    if (!saved)
      throw new PublishFailure(
        "The publishing attempt changed before its upload identity was saved.",
        false,
        true,
      );
  };
  const beforeCommit = async () => {
    const [saved] = await updateReturning(
      db,
      posts,
      { publishState: "sending" },
      and(fence(), eq(posts.revision, claimed.revision), isNull(posts.externalMediaId)),
      { id: posts.id },
    );
    if (!saved)
      throw new Refusal("The post changed before the provider send; no send was authorized.");
    claimed.publishState = "sending";
  };
  /** Locks serialize approval/status/reassignment and relinking against the actual provider send. */
  const lockedSend = async <
    T extends { status: "pending" | "published"; mediaId?: string; permalink?: string | null },
  >(
    run: (
      account: SocialAccount,
      media: SendAsset[],
      writer: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ) => Promise<T>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      const current = await sendSnapshot(claimed, tx, true);
      const [active] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
      if (
        !active ||
        active.publishAttemptId !== claimed.publishAttemptId ||
        active.revision !== claimed.revision ||
        active.status !== "publishing" ||
        active.externalMediaId ||
        active.publishState === "confirmed" ||
        active.publishState === "ambiguous"
      )
        throw new Refusal("The publishing attempt changed or completed before the provider call.");
      const problem = approvalProblem(active, current.target);
      if (problem) throw new Refusal(problem);
      for (const asset of current.assets) {
        const original = await assetOriginal({ localPath: asset.localPath, sha256: asset.sha256 });
        if (!original)
          throw new Refusal(
            `Asset ${asset.assetId} no longer has intact approved bytes. Restore and review it before sending.`,
          );
      }
      const done = await run(current.account, current.assets, tx);
      // Confirmation commits while account/assets are still locked, fencing an expired-lease resume.
      if (done.status === "published" && done.mediaId) {
        try {
          await confirm(
            claimed,
            done.mediaId,
            now,
            done.permalink !== undefined ? { permalink: done.permalink ?? claimed.permalink } : {},
          );
        } catch (error) {
          throw new PublishFailure(
            `The provider accepted the post but its result could not be recorded (${message(error)}).`,
            false,
            true,
          );
        }
      }
      return done;
    });

  try {
    const account = await accountFor(claimed);
    integrationId = account.integrationId;
    if (account.platform === "youtube" || account.platform === "tiktok") {
      const done = await lockedSend((account, media) =>
        publishVideoPost({
          post: claimed,
          account,
          caption: captionOf(claimed),
          assets: media,
          resume,
          saveContainer,
          beforeCommit,
          saveUpload: async (session) => {
            claimed.publishUpload = session;
            const [saved] = await updateReturning(db, posts, { publishUpload: session }, fence(), {
              id: posts.id,
            });
            if (!saved)
              throw new Refusal("The upload attempt changed before its session was saved.");
          },
          options: {
            now,
            fetch: options.fetch,
            poll: { ...DEFAULT_POLL, ...options.poll },
            chunkBytes: options.chunkBytes,
            onCredential: (version) => {
              credentialVersion = version;
            },
          },
        }),
      );
      if (done.status === "pending")
        return {
          postId,
          result: "pending",
          message: "TikTok is processing the video; the next run checks it again.",
        };
      return await markVideoPublished(claimed, done, now);
    }
    const ctx = await contextFor(claimed, account, options, (version) => {
      credentialVersion = version;
    });
    ctx.onContainer = saveContainer;
    ctx.beforeCommit = beforeCommit;
    let used: PlanAsset[] = [];
    let done;
    if (resume && account.platform === "instagram") {
      done = await lockedSend(() => finishInstagram(ctx, claimed.externalContainerId!));
    } else {
      const plan = planPublish({
        platform: account.platform,
        format: claimed.format,
        caption: ctx.caption,
        assets: snapshot.assets,
      });
      if (!plan.ok) throw new Refusal(plan.error);
      used = planAssets(plan.plan);
      done = await lockedSend(async (_account, _media, writer) => {
        for (const a of used) {
          const copy = await publishCopy(a.assetId, { now, drivers: options.drivers, writer });
          if (!("url" in copy))
            throw new Refusal(`${a.name} (asset ${a.assetId}) has no public URL: ${copy.message}`);
          ctx.urls.set(a.assetId, copy.url);
        }
        if (plan.plan.platform === "instagram") return publishInstagram(ctx, plan.plan);
        if (plan.plan.platform === "facebook") return publishFacebook(ctx, plan.plan);
        throw new Refusal("Internal: a Meta account got a video platform plan.");
      });
    }
    if (done.status === "pending")
      return {
        postId,
        result: "pending",
        message: "Instagram is processing the media; the next run checks it again.",
      };
    return await markPublished(claimed, account, ctx, done.mediaId, used, now);
  } catch (error) {
    return failed(claimed, error, integrationId, now, credentialVersion);
  }
}

async function accountFor(post: Post): Promise<SocialAccount> {
  const [account] = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, post.accountId))
    .limit(1);
  if (!account) throw new Refusal(`The post's account (${post.accountId}) no longer exists.`);
  if (account.platform === "youtube" || account.platform === "tiktok") {
    const name = PROVIDER_NAME[account.platform];
    if (account.brandId !== post.brandId)
      throw new Refusal("The post and account belong to different brands.");
    if (!account.externalId || !account.integrationId) {
      throw new Refusal(
        `@${account.handle} is not linked to ${name}. Link it in Settings → ${name}, then publish again.`,
      );
    }
    return account;
  }
  if (account.platform !== "instagram" && account.platform !== "facebook") {
    throw new Refusal(
      `Publishing to ${account.platform} is not built yet; post it by hand with the post pack.`,
    );
  }
  if (!account.externalId || !account.integrationId) {
    throw new Refusal(
      `@${account.handle} is not linked to Meta. Link it in Settings → Meta (step 6), then publish again.`,
    );
  }
  return account;
}

async function contextFor(
  post: Post,
  account: SocialAccount,
  options: PublishOptions,
  onCredential: (version: number) => void,
): Promise<PublishContext> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, account.integrationId!), eq(integrations.provider, "meta")))
    .limit(1);
  if (!row) {
    throw new Refusal(
      `@${account.handle}'s Meta connection no longer exists. Reconnect in Settings → Meta.`,
    );
  }
  onCredential(row.credentialVersion);
  const token = await usableToken(row, options.now);
  if (!token.ok) throw new Refusal(`@${account.handle}: ${token.reason}`);

  const fetchImpl = options.fetch ?? graphFetch();
  const actingToken =
    account.platform === "facebook"
      ? await pageToken(new GraphClient(token.token, fetchImpl), account.externalId!)
      : token.token;
  return {
    writer: new GraphWriter(actingToken, fetchImpl),
    targetId: account.externalId!,
    handle: account.handle,
    caption: captionOf(post),
    urls: new Map(),
    poll: { ...DEFAULT_POLL, ...options.poll },
  };
}

function captionOf(post: Post): string {
  const draft = validatePostDraft(post.body).ok ? (post.body as PostDraft) : null;
  return post.caption ?? (draft ? captionText(draft) : "");
}

function attemptFence(post: Post) {
  return and(
    eq(posts.id, post.id),
    eq(posts.publishAttemptId, post.publishAttemptId!),
    eq(posts.status, "publishing"),
  );
}

async function confirm(
  post: Post,
  mediaId: string,
  now: Date,
  extra: Partial<typeof posts.$inferInsert> = {},
) {
  const [saved] = await updateReturning(
    db,
    posts,
    {
      ...extra,
      status: "published",
      publishedAt: now,
      externalMediaId: mediaId,
      externalContainerId: null,
      publishUpload: null,
      publishState: "confirmed",
      publishError: null,
      updatedAt: now,
    },
    and(
      eq(posts.id, post.id),
      eq(posts.publishAttemptId, post.publishAttemptId!),
      isNull(posts.externalMediaId),
    ),
    { id: posts.id },
  );
  if (!saved) {
    const [current] = await db.select().from(posts).where(eq(posts.id, post.id)).limit(1);
    if (
      current?.publishAttemptId === post.publishAttemptId &&
      current.externalMediaId === mediaId &&
      current.publishState === "confirmed"
    )
      return;
    throw new Error(
      "The provider accepted the post but completion could not be fenced. Reconcile its result.",
    );
  }
}

async function markPublished(
  post: Post,
  account: SocialAccount,
  ctx: PublishContext,
  mediaId: string,
  used: PlanAsset[],
  now: Date,
): Promise<PublishOutcome> {
  await confirm(post, mediaId, now);
  const notes: string[] = [];
  try {
    await markUsed(used, now);
  } catch (error) {
    notes.push(`media bookkeeping failed (${message(error)})`);
  }
  let permalink: string | null = null;
  try {
    permalink = await fetchPermalink(
      ctx.writer,
      account.platform as "instagram" | "facebook",
      mediaId,
    );
  } catch (error) {
    notes.push(`the permalink could not be read (${message(error)}); meta:sync fills it later`);
  }
  const draft = validatePostDraft(post.body).ok ? (post.body as PostDraft) : null;
  const comment = (post.firstComment ?? draft?.firstComment ?? "").trim();
  if (comment) {
    try {
      await postComment(ctx.writer, mediaId, comment);
    } catch (error) {
      notes.push(`the first comment failed (${message(error)}); post it by hand`);
    }
  }
  const note = notes.length ? `Published, but ${notes.join("; ")}.` : null;
  try {
    await db
      .update(posts)
      .set({ permalink: permalink ?? post.permalink, publishError: note?.slice(0, 1024) ?? null })
      .where(
        and(
          eq(posts.id, post.id),
          eq(posts.publishAttemptId, post.publishAttemptId!),
          eq(posts.publishState, "confirmed"),
        ),
      );
  } catch (error) {
    notes.push(`the publication notes could not be saved (${message(error)})`);
  }
  return {
    postId: post.id,
    result: "published",
    permalink,
    message: notes.length ? `Published, but ${notes.join("; ")}.` : undefined,
  };
}

async function markUsed(used: PlanAsset[], now: Date): Promise<void> {
  if (!used.length) return;
  await db
    .update(assets)
    .set({ status: "used", updatedAt: now })
    .where(
      and(
        inArray(
          assets.id,
          used.map((a) => a.assetId),
        ),
        eq(assets.status, "approved"),
      ),
    );
}

async function markVideoPublished(
  post: Post,
  done: Extract<VideoDone, { status: "published" }>,
  now: Date,
): Promise<PublishOutcome> {
  const notes = [...done.notes];
  await confirm(post, done.mediaId, now, { permalink: done.permalink ?? post.permalink });
  try {
    await markUsed(done.used, now);
  } catch (error) {
    notes.push(`media bookkeeping failed (${message(error)})`);
  }
  const note = notes.length ? `Published, but ${notes.join("; ")}.` : null;
  try {
    await db
      .update(posts)
      .set({ publishError: note?.slice(0, 1024) ?? null })
      .where(
        and(
          eq(posts.id, post.id),
          eq(posts.publishAttemptId, post.publishAttemptId!),
          eq(posts.publishState, "confirmed"),
        ),
      );
  } catch (error) {
    notes.push(`the publication notes could not be saved (${message(error)})`);
  }
  return {
    postId: post.id,
    result: "published",
    permalink: done.permalink,
    message: notes.length ? `Published, but ${notes.join("; ")}.` : undefined,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function failed(
  post: Post,
  err: unknown,
  integrationId: number | null,
  now: Date,
  credentialVersion?: number,
): Promise<PublishOutcome> {
  // A late bookkeeping exception cannot undo a provider result, even if its caller still holds an old snapshot.
  const [current] = await db.select().from(posts).where(eq(posts.id, post.id)).limit(1);
  if (!current || current.publishAttemptId !== post.publishAttemptId)
    return {
      postId: post.id,
      result: "skipped",
      message: "The publishing attempt changed; reconcile its result.",
    };
  if (current.externalMediaId || current.publishedAt || current.publishState === "confirmed")
    return {
      postId: post.id,
      result: "published",
      permalink: current.permalink,
      message: `Published; bookkeeping needs attention (${message(err)}).`,
    };

  let text = message(err),
    temporary = false,
    keepContainer = false;
  if (err instanceof PublishFailure) {
    temporary = err.temporary;
    keepContainer = err.keepContainer;
  } else if (err instanceof MetaGraphError) {
    if (err.isTokenError) {
      text = `Meta rejected the login (${err.message}). Reconnect in Settings → Meta.`;
      if (integrationId && credentialVersion !== undefined)
        await setIntegrationStatus(integrationId, "expired", text, credentialVersion);
    } else if (isTransient(err)) temporary = true;
    else text = `Meta refused: ${err.message}`;
  } else if (err instanceof ProviderApiError) {
    const name = PROVIDER_NAME[err.provider as VideoProvider];
    if (err.isAuthError) {
      text = `${name} rejected the login (${err.message}). Reconnect in Settings → ${name}.`;
      if (integrationId && credentialVersion !== undefined)
        await setConnectionStatus(integrationId, "expired", text, credentialVersion);
    } else if (err.isTransient) temporary = true;
    else text = `${name} refused: ${err.message}`;
  } else if (
    !(err instanceof Refusal) &&
    !(err instanceof SendRefusal) &&
    !(err instanceof VideoRefusal)
  ) {
    text = `Unexpected error: ${text}`;
  }
  const containerId = current.externalContainerId ?? post.externalContainerId;
  const upload = current.publishUpload ?? post.publishUpload;
  const state = current.publishState === "idle" ? post.publishState : current.publishState;
  const knownRefusal =
    err instanceof Refusal ||
    err instanceof SendRefusal ||
    err instanceof VideoRefusal ||
    (err instanceof MetaGraphError && !isTransient(err)) ||
    (err instanceof ProviderApiError && !err.isTransient) ||
    (err instanceof PublishFailure && !err.temporary && !err.keepContainer);
  const ambiguous =
    current.publishState === "ambiguous" ||
    (err instanceof PublishFailure && !err.temporary && err.keepContainer) ||
    (state === "sending" && !knownRefusal && !(temporary && containerId));
  const keep = ambiguous || keepContainer || (temporary && containerId !== null);
  const retries =
    !ambiguous && temporary && post.publishAttempts < MAX_ATTEMPTS && post.scheduledFor !== null;
  const stored = ambiguous
    ? `${text} The provider result is uncertain; verify it before creating a new post.`
    : retries
      ? `${TEMPORARY_PREFIX}${text}`
      : temporary
        ? `${text} ${post.scheduledFor === null ? "Try again in a few minutes." : `Gave up after ${post.publishAttempts} attempt(s).`}`
        : text;
  await db
    .update(posts)
    .set({
      status: "failed",
      publishError: stored.slice(0, 1024),
      publishState: ambiguous ? "ambiguous" : keep && state === "sending" ? "sending" : "idle",
      externalContainerId: keep ? containerId : null,
      publishUpload: keep ? upload : null,
      updatedAt: now,
    })
    .where(and(attemptFence(post), isNull(posts.externalMediaId)));
  return { postId: post.id, result: "failed", message: stored };
}

// --- the due run ---------------------------------------------------------------

export type DueReport = {
  busy: boolean;
  considered: number;
  outcomes: PublishOutcome[];
  interrupted: number[];
};

/**
 * Publish every post whose time has come, resume reels Meta was still
 * processing, retry temporary failures after their backoff, and mark posts a
 * crashed run left in `publishing` as failed (never re-publish them: they may
 * already be live).
 */
export async function publishDue(
  options: PublishOptions & { limit?: number } = {},
): Promise<DueReport> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 10;
  const run = await withLease(PUBLISH_LEASE, PUBLISH_LEASE_TTL_MS, async () => {
    const candidates = await db
      .select()
      .from(posts)
      .where(
        or(
          and(eq(posts.status, "scheduled"), lte(posts.scheduledFor, now)),
          eq(posts.status, "publishing"),
          and(
            eq(posts.status, "failed"),
            lte(posts.scheduledFor, now),
            like(posts.publishError, `${TEMPORARY_PREFIX}%`),
            lt(posts.publishAttempts, MAX_ATTEMPTS),
          ),
        ),
      )
      .orderBy(asc(posts.lastPublishAttemptAt), asc(posts.scheduledFor), asc(posts.id));

    const report: DueReport = { busy: false, considered: 0, outcomes: [], interrupted: [] };
    let attempted = 0;
    for (const post of candidates) {
      if (attempted >= limit) break;
      if (post.status === "publishing" && !post.externalContainerId) {
        if (await markInterrupted(post, now)) report.interrupted.push(post.id);
        continue;
      }
      if (post.status === "failed" && !retryDue(post, now)) continue;
      report.considered++;
      const outcome = await publishPost(post.id, { ...options, now, trigger: "due" });
      report.outcomes.push(outcome);
      if (outcome.result !== "skipped") attempted++;
    }
    return report;
  });
  return run.acquired ? run.value : { busy: true, considered: 0, outcomes: [], interrupted: [] };
}

async function markInterrupted(post: Post, now: Date): Promise<boolean> {
  const started = post.lastPublishAttemptAt?.getTime() ?? 0;
  if (now.getTime() - started < STUCK_AFTER_MS) return false;
  const [account] = await db
    .select({ platform: socialAccounts.platform })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, post.accountId))
    .limit(1);
  const platform = account?.platform;
  const service =
    platform === "youtube" || platform === "tiktok" ? PROVIDER_NAME[platform] : "Meta";
  const run = await withLease(postLeaseName(post.id), POST_LEASE_TTL_MS, async () => {
    const [row] = await updateReturning(
      db,
      posts,
      {
        status: "failed",
        publishState: "ambiguous",
        publishError: `Publishing was interrupted before ${service} confirmed it. Verify the provider before creating a new post.`,
        updatedAt: now,
      },
      and(
        eq(posts.id, post.id),
        eq(posts.status, "publishing"),
        eq(posts.publishAttemptId, post.publishAttemptId!),
        eq(posts.revision, post.revision),
      ),
      { id: posts.id },
    );
    return Boolean(row);
  });
  return run.acquired && run.value;
}

/** One line for a cron log. */
export function summarizeDue(report: DueReport): string {
  if (report.busy) return "Another publish run holds the lease; skipped.";
  const count = (r: PublishOutcome["result"]) =>
    report.outcomes.filter((o) => o.result === r).length;
  return (
    `${count("published")} published, ${count("pending")} processing, ${count("failed")} failed, ` +
    `${count("skipped")} skipped, ${report.interrupted.length} interrupted`
  );
}
