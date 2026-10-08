import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets, postAssets, socialAccounts, users, type Post } from "@/db/schema";
import { assetProblem, targetSnapshot, type SendAsset } from "./safety";

type Reader = Pick<typeof db, "select">;
export class SendRefusal extends Error {}

export async function verifyOwner(ownerId: number, reader: Reader = db): Promise<void> {
  const [owner] = await reader
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  if (owner?.role !== "owner") throw new SendRefusal("Only the owner can authorize a send.");
}

/** Account and asset locks are held through the provider call by the caller's transaction. */
export async function sendSnapshot(
  post: Pick<Post, "id" | "brandId" | "accountId">,
  reader: Reader = db,
  lock = false,
) {
  const accountQuery = reader
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, post.accountId))
    .limit(1);
  const [account] = await (lock ? accountQuery.for("update") : accountQuery);
  if (!account) throw new SendRefusal("This post's account no longer exists.");
  if (account.brandId !== post.brandId)
    throw new SendRefusal("The post and account belong to different brands.");
  if (account.status !== "active") throw new SendRefusal("This account is not active.");
  if (!account.externalId || !account.integrationId) {
    const provider =
      account.platform === "youtube"
        ? "YouTube"
        : account.platform === "tiktok"
          ? "TikTok"
          : "Meta";
    throw new SendRefusal(
      `@${account.handle} is not linked to ${provider}. Link it in Settings → ${provider} before approving or sending.`,
    );
  }
  const attached = await reader
    .select()
    .from(postAssets)
    .where(eq(postAssets.postId, post.id))
    .orderBy(asc(postAssets.position));
  const query = reader
    .select()
    .from(assets)
    .where(
      inArray(
        assets.id,
        attached.map((a) => a.assetId),
      ),
    )
    .orderBy(asc(assets.id));
  const media = attached.length ? await (lock ? query.for("update") : query) : [];
  const byId = new Map(media.map((a) => [a.id, a]));
  const list: SendAsset[] = attached.map((a) => {
    const m = byId.get(a.assetId);
    if (!m) throw new SendRefusal("An attached file no longer exists.");
    const item: SendAsset = {
      assetId: a.assetId,
      role: a.role,
      position: a.position,
      name: m.localPath?.split("/").pop() ?? `asset ${a.assetId}`,
      kind: m.kind,
      altText: m.altText,
      localPath: m.localPath,
      mime: m.mime,
      bytes: m.bytes,
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
      sha256: m.sha256,
      brandId: m.brandId,
      accountId: m.accountId,
      status: m.status,
    };
    const problem = assetProblem(post, item);
    if (problem) throw new SendRefusal(`Asset ${a.assetId}: ${problem}`);
    return item;
  });
  return { account, assets: list, target: targetSnapshot(account, list) };
}
