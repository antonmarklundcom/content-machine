import { updateReturning } from "@/db/mutations";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Post } from "@/db/schema";
import { targetSnapshot, type SendAsset } from "@/lib/publish/safety";

/** Synthetic fixtures model a prior owner approval; never used by application code. */
export async function approvedPublishFixture(
  post: Post,
  ownerId: number,
  now: Date,
): Promise<Post> {
  const [account] = await db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, post.accountId));
  if (!account) return post;
  const attached = await db
    .select({ asset: schema.assets, attachment: schema.postAssets })
    .from(schema.postAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.postAssets.assetId))
    .where(eq(schema.postAssets.postId, post.id))
    .orderBy(asc(schema.postAssets.position));
  const media: SendAsset[] = attached.map(({ asset, attachment }) => ({
    ...asset,
    assetId: asset.id,
    role: attachment.role,
    position: attachment.position,
    name: asset.localPath?.split("/").pop() ?? "synthetic media",
  }));
  const [saved] = await updateReturning(
    db,
    schema.posts,
    {
      publishTarget: targetSnapshot(account, media),
      publishApprovedBy: ownerId,
      publishApprovedRevision: post.revision,
      publishApprovedAt: now,
      ...(["publishing", "failed"].includes(post.status)
        ? {
            publishAttemptId: post.publishAttemptId ?? randomUUID(),
            publishStartedAt: post.publishStartedAt ?? now,
          }
        : {}),
    },
    eq(schema.posts.id, post.id),
  );
  return saved;
}
