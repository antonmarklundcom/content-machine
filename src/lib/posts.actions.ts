"use server";
import { updateReturning } from "@/db/mutations";

/**
 * Posts, the calendar and the post pack, from the UI (PLAN.md §6.S15).
 *
 * Thin wrappers over O11's engine (`src/lib/posts/engine.ts`): every status
 * move goes through its `setStatus`/`updatePost`, so the legal-transition
 * table is the one in `status.ts` and never re-implemented here. The one
 * thing the engine has no writer for is `post_assets` (attach, reorder,
 * detach), which lives here.
 *
 * Every action returns `{ ok, … } | { ok: false, error }` rather than
 * throwing: production strips a thrown action's message, and the engine's
 * refusals ("A drafting post cannot become published…") are exactly the text
 * the person needs to see. Drafting and adapting spend, so they are owner-only
 * (§1.20); everything else is a free edit for any signed-in user.
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  assets,
  posts,
  POST_ASSET_ROLES,
  postAssets,
  type Post,
  type PostAssetRole,
  type PostStatus,
} from "@/db/schema";
import { PostGenerationError } from "@/lib/ai";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { getPost } from "@/lib/bridge";
import {
  assertPostEditable,
  adaptToFamily,
  createPostFromIdea,
  PostEngineError,
  setStatus,
  updatePost,
  type PostPatch,
} from "@/lib/posts/engine";
import { isPostStatus } from "@/lib/posts/status";
import { GuaraniGenerationRefusedError } from "@/lib/glossary/prompt";
import { formatUsd, SpendCapExceededError } from "@/lib/spend";

export type PostActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; errors?: string[] };

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** The refusals a person can act on, as a result; anything else is a bug and rethrown. */
function refusal(error: unknown): { ok: false; error: string; errors?: string[] } {
  if (error instanceof PostEngineError) {
    return {
      ok: false,
      error: error.message,
      ...(error.errors.length ? { errors: error.errors } : {}),
    };
  }
  if (error instanceof PostGenerationError) {
    return { ok: false, error: error.message, errors: error.errors };
  }
  if (
    error instanceof SpendCapExceededError ||
    error instanceof ForbiddenError ||
    error instanceof GuaraniGenerationRefusedError
  ) {
    return { ok: false, error: error.message };
  }
  throw error;
}

function revalidatePost(postId: number) {
  revalidatePath("/posts");
  revalidatePath("/calendar");
  revalidatePath(`/posts/${postId}`);
  revalidatePath(`/posts/${postId}/pack`);
}

// ---------------------------------------------------------------------------
// drafting (spends — owner only)
// ---------------------------------------------------------------------------

export type CreatePostActionInput = {
  accountId: number;
  ideaId?: number | null;
  topic?: string | null;
  format?: string | null;
  title?: string | null;
};

/** `/posts/new`: draft a post from an idea or a topic for one account (§5.O11.2). */
export async function createPostAction(
  input: CreatePostActionInput,
): Promise<PostActionResult<{ id: number; cost: string }>> {
  try {
    await requireOwner("write a post");
    if (!isPositiveId(input?.accountId)) return { ok: false, error: "Pick an account." };
    const ideaId = input.ideaId ?? null;
    if (ideaId !== null && !isPositiveId(ideaId)) {
      return { ok: false, error: "That is not an idea id." };
    }
    for (const field of ["topic", "format", "title"] as const) {
      const value = input[field];
      if (value != null && typeof value !== "string") {
        return { ok: false, error: `${field} must be text.` };
      }
    }
    const { post, costUsd } = await createPostFromIdea({
      accountId: input.accountId,
      ideaId,
      topic: input.topic || null,
      format: input.format || null,
      title: input.title || null,
    });
    revalidatePath("/posts");
    return { ok: true, id: post.id, cost: formatUsd(costUsd) };
  } catch (error) {
    return refusal(error);
  }
}

/** "Adapt to family" (§1.47): one sibling per other active account in the family. */
export async function adaptPostAction(postId: number): Promise<
  PostActionResult<{
    created: { id: number; accountId: number }[];
    skipped: { handle: string; reason: string }[];
    cost: string;
  }>
> {
  try {
    await requireOwner("adapt a post to its family");
    if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
    const result = await adaptToFamily(postId);
    revalidatePost(postId);
    return {
      ok: true,
      created: result.created.map((p) => ({ id: p.id, accountId: p.accountId })),
      skipped: result.skipped.map((s) => ({ handle: s.handle, reason: s.reason })),
      cost: formatUsd(result.costUsd),
    };
  } catch (error) {
    return refusal(error);
  }
}

// ---------------------------------------------------------------------------
// free edits
// ---------------------------------------------------------------------------

export type SavePostInput = {
  expectedRevision?: number;
  title?: string;
  /** A whole `PostDraft`; validated by the engine against the contract. */
  body?: unknown;
  notes?: string | null;
};

/** The editor's "Save": title, notes and the draft (which refreshes the caption and first comment). */
export async function savePostAction(
  postId: number,
  input: SavePostInput,
): Promise<PostActionResult> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  const patch: PostPatch = {};
  if (input?.title !== undefined) {
    if (typeof input.title !== "string") return { ok: false, error: "The title must be text." };
    patch.title = input.title;
  }
  if (input?.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== "string") {
      return { ok: false, error: "Notes must be text." };
    }
    patch.notes = input.notes?.trim() ? input.notes : null;
  }
  if (input?.body !== undefined) patch.body = input.body;
  try {
    await updatePost(postId, patch, { expectedRevision: input.expectedRevision });
    revalidatePost(postId);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

/** A status button: the engine refuses illegal moves with the reason (`status.ts`). */
export async function setPostStatusAction(
  postId: number,
  status: PostStatus,
  expectedRevision?: number,
): Promise<PostActionResult<{ status: PostStatus }>> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  if (!isPostStatus(status)) return { ok: false, error: `Unknown status "${String(status)}".` };
  try {
    const user = status === "scheduled" ? await requireOwner("schedule a post") : null;
    const post = await setStatus(postId, status, {
      expectedRevision,
      ...(user ? { authorizeSend: { ownerId: user.id } } : {}),
    });
    revalidatePost(postId);
    return { ok: true, status: post.status };
  } catch (error) {
    return refusal(error);
  }
}

function parseWhen(value: unknown): Date | null | "invalid" {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) return "invalid";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

/**
 * Set (or clear) when a post goes out. `schedule: true` also moves it to
 * `scheduled` in the same request — the engine judges the move on the new
 * date. The calendar's drag-to-reschedule sends only the date: a scheduled
 * post stays scheduled, a draft just gets a date.
 */
export async function schedulePostAction(
  postId: number,
  when: string | null,
  options: { schedule?: boolean; expectedRevision?: number } = {},
): Promise<PostActionResult<{ scheduledFor: string | null; status: PostStatus }>> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  const scheduledFor = parseWhen(when);
  if (scheduledFor === "invalid") return { ok: false, error: "That is not a date and time." };
  const current = await getPost(postId);
  if (!current) return { ok: false, error: `No post ${postId}.` };
  if (["published", "publishing"].includes(current.status)) {
    return { ok: false, error: `A ${current.status} post cannot be rescheduled.` };
  }
  if (scheduledFor === null && current.status === "scheduled") {
    return { ok: false, error: "Move the post back to ready before clearing its date." };
  }
  try {
    const user = await requireOwner("schedule a post");
    const post = await updatePost(
      postId,
      {
        scheduledFor,
        ...(options.schedule ? { status: "scheduled" as const } : {}),
      },
      {
        expectedRevision: options.expectedRevision ?? current.revision,
        authorizeSend: { ownerId: user.id },
      },
    );
    revalidatePost(postId);
    return {
      ok: true,
      scheduledFor: post.scheduledFor?.toISOString() ?? null,
      status: post.status,
    };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * The post pack's "Mark posted" (§1.49): the permalink, if pasted, and the
 * move to `published` in one request. Calling it again on a published post
 * only updates the permalink.
 */
export async function markPostedAction(
  postId: number,
  permalink: string | null,
): Promise<PostActionResult<{ permalink: string | null }>> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  const link = typeof permalink === "string" && permalink.trim() ? permalink.trim() : null;
  if (permalink !== null && typeof permalink !== "string") {
    return { ok: false, error: "The permalink must be text." };
  }
  if (link) {
    try {
      const { protocol } = new URL(link);
      if (protocol !== "https:" && protocol !== "http:") throw new Error();
    } catch {
      return { ok: false, error: "The permalink must be an http(s) link." };
    }
  }
  try {
    const post = await updatePost(postId, {
      ...(link ? { permalink: link } : {}),
      status: "published",
    });
    revalidatePost(postId);
    return { ok: true, permalink: post.permalink };
  } catch (error) {
    return refusal(error);
  }
}

// ---------------------------------------------------------------------------
// attachments (post_assets)
// ---------------------------------------------------------------------------

type PostTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function orderedAssetIds(tx: PostTx, postId: number) {
  return tx
    .select({ assetId: postAssets.assetId, role: postAssets.role })
    .from(postAssets)
    .where(eq(postAssets.postId, postId))
    .orderBy(asc(postAssets.position));
}

async function mutateAttachments<T>(
  postId: number,
  run: (tx: PostTx, post: Post) => Promise<T>,
  expectedRevision?: number,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1).for("update");
    if (!post) throw new PostEngineError(`No post ${postId}.`, 404);
    if (expectedRevision !== undefined && post.revision !== expectedRevision)
      throw new PostEngineError("The post changed; reload before editing attachments.", 409);
    assertPostEditable(post);
    const result = await run(tx, post);
    const [saved] = await updateReturning(
      tx,
      posts,
      {
        status: post.status === "scheduled" ? "ready" : post.status,
        revision: post.revision + 1,
        publishApprovedRevision: null,
        publishApprovedBy: null,
        publishApprovedAt: null,
        publishTarget: post.publishAttemptId ? post.publishTarget : null,
        updatedAt: new Date(),
      },
      and(eq(posts.id, postId), eq(posts.revision, post.revision), eq(posts.status, post.status)),
      { id: posts.id },
    );
    if (!saved)
      throw new PostEngineError("The post changed; reload before editing attachments.", 409);
    return result;
  });
}

async function writeOrder(
  tx: PostTx,
  postId: number,
  rows: { assetId: number; role: PostAssetRole }[],
) {
  await tx.delete(postAssets).where(eq(postAssets.postId, postId));
  if (rows.length)
    await tx.insert(postAssets).values(rows.map((r, i) => ({ postId, ...r, position: i + 1 })));
}

export async function attachAssetAction(
  postId: number,
  assetId: number,
  role: PostAssetRole = "slide",
  expectedRevision?: number,
): Promise<PostActionResult<{ position: number }>> {
  await requireUser();
  if (!isPositiveId(postId) || !isPositiveId(assetId))
    return { ok: false, error: "That is not a post or asset id." };
  if (!(POST_ASSET_ROLES as readonly string[]).includes(role))
    return { ok: false, error: "Unknown attachment role." };
  try {
    const position = await mutateAttachments(
      postId,
      async (tx, post) => {
        const [asset] = await tx.select().from(assets).where(eq(assets.id, assetId)).limit(1);
        if (!asset) throw new PostEngineError(`No asset ${assetId}.`, 404);
        if (asset.brandId && asset.brandId !== post.brandId)
          throw new PostEngineError("That file belongs to another brand.");
        if (asset.accountId !== null && asset.accountId !== post.accountId)
          throw new PostEngineError("That file belongs to another account.");
        const list = await orderedAssetIds(tx, postId);
        if (list.some((a) => a.assetId === assetId))
          throw new PostEngineError("That file is already attached.");
        const position = list.length + 1;
        await tx.insert(postAssets).values({ postId, assetId, position, role });
        return position;
      },
      expectedRevision,
    );
    revalidatePost(postId);
    return { ok: true, position };
  } catch (error) {
    return refusal(error);
  }
}

export async function reorderAssetsAction(
  postId: number,
  assetIds: number[],
  expectedRevision?: number,
): Promise<PostActionResult> {
  await requireUser();
  if (!isPositiveId(postId) || !Array.isArray(assetIds) || !assetIds.every(isPositiveId))
    return { ok: false, error: "Send the attached file ids in their new order." };
  try {
    await mutateAttachments(
      postId,
      async (tx) => {
        const current = await orderedAssetIds(tx, postId);
        const roles = new Map(current.map((a) => [a.assetId, a.role]));
        if (
          current.length !== assetIds.length ||
          new Set(assetIds).size !== assetIds.length ||
          assetIds.some((id) => !roles.has(id))
        )
          throw new PostEngineError("The attachments changed; reload and retry.", 409);
        await writeOrder(
          tx,
          postId,
          assetIds.map((assetId) => ({ assetId, role: roles.get(assetId)! })),
        );
      },
      expectedRevision,
    );
    revalidatePost(postId);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

export async function setAssetRoleAction(
  postId: number,
  assetId: number,
  role: PostAssetRole,
  expectedRevision?: number,
): Promise<PostActionResult> {
  await requireUser();
  if (
    !isPositiveId(postId) ||
    !isPositiveId(assetId) ||
    !(POST_ASSET_ROLES as readonly string[]).includes(role)
  )
    return { ok: false, error: "Invalid post, asset or role." };
  try {
    await mutateAttachments(
      postId,
      async (tx) => {
        const [saved] = await updateReturning(
          tx,
          postAssets,
          { role },
          and(eq(postAssets.postId, postId), eq(postAssets.assetId, assetId)),
        );
        if (!saved) throw new PostEngineError("That file is not attached.");
      },
      expectedRevision,
    );
    revalidatePost(postId);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

export async function detachAssetAction(
  postId: number,
  assetId: number,
  expectedRevision?: number,
): Promise<PostActionResult> {
  await requireUser();
  if (!isPositiveId(postId) || !isPositiveId(assetId))
    return { ok: false, error: "Invalid post or asset id." };
  try {
    await mutateAttachments(
      postId,
      async (tx) => {
        const current = await orderedAssetIds(tx, postId);
        if (!current.some((a) => a.assetId === assetId))
          throw new PostEngineError("That file is not attached.");
        await writeOrder(
          tx,
          postId,
          current.filter((a) => a.assetId !== assetId),
        );
      },
      expectedRevision,
    );
    revalidatePost(postId);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}
