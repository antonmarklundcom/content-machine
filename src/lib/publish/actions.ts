"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";

import { publishPost, type PublishOutcome } from "./index";

/**
 * "Publish now" (PLAN.md §5.O13): the owner's explicit click. Publishing is
 * external and irreversible, so it is owner-only (§1.20) and goes through the
 * same per-post lease as the due run.
 */
export async function publishNowAction(
  postId: number,
  expectedRevision?: number,
): Promise<{ ok: true; outcome: PublishOutcome } | { ok: false; error: string }> {
  if (!Number.isInteger(postId) || postId <= 0)
    return { ok: false, error: "That is not a post id." };
  let ownerId: number;
  try {
    ownerId = (await requireOwner("publish a post")).id;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "Only the owner can publish." };
    throw err;
  }
  const outcome = await publishPost(postId, { trigger: "manual", ownerId, expectedRevision });
  revalidatePath("/posts");
  revalidatePath("/calendar");
  revalidatePath(`/posts/${postId}`);
  return { ok: true, outcome };
}

/** Stop local processing only; the retained provider/session IDs still require verification. */
export async function stopPublishingAction(
  postId: number,
  expectedRevision?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner("stop an upload");
    if (!Number.isInteger(postId) || postId <= 0)
      return { ok: false, error: "That is not a post id." };
    const result = await db.transaction(async (tx) => {
      const [post] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1)
        .for("update");
      if (!post) return { ok: false as const, error: "The post no longer exists." };
      if (expectedRevision !== undefined && post.revision !== expectedRevision)
        return {
          ok: false as const,
          error: "The post changed; reload before stopping its upload.",
        };
      if (post.externalMediaId || post.publishState === "confirmed" || post.publishedAt)
        return {
          ok: false as const,
          error:
            "The provider has already accepted this post. Verify its visibility on the provider.",
        };
      if (!post.publishAttemptId || !["publishing", "failed"].includes(post.status))
        return { ok: false as const, error: "This post has no active upload to stop." };
      await tx
        .update(posts)
        .set({
          status: "failed",
          publishState: "ambiguous",
          revision: post.revision + 1,
          publishApprovedRevision: null,
          publishApprovedBy: null,
          publishApprovedAt: null,
          publishError:
            "Stopped locally; the provider may already have accepted the upload. Verify it on the provider before creating a new post.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posts.id, postId),
            eq(posts.revision, post.revision),
            eq(posts.publishAttemptId, post.publishAttemptId),
          ),
        );
      return { ok: true as const };
    });
    revalidatePath("/posts");
    revalidatePath("/calendar");
    revalidatePath(`/posts/${postId}`);
    return result;
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: "Only the owner can stop an upload." };
    throw error;
  }
}
