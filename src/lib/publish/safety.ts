import type { Post, SocialAccount } from "@/db/schema";
import type { PlanAsset } from "./plan";

export type TargetSnapshot = {
  accountId: number;
  brandId: string;
  platform: string;
  integrationId: number | null;
  externalId: string | null;
  assets: AssetSnapshot[];
};

export type AssetSnapshot = {
  assetId: number;
  sha256: string;
  localPath: string | null;
  bytes: number;
  role: string;
  position: number;
  kind: string;
  mime: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  brandId: string | null;
  accountId: number | null;
};

export type SendAsset = PlanAsset & AssetSnapshot & { status: string };

/** Confirmation and uncertainty survive editorial status changes and process restarts. */
export function publicationBlock(
  post: Pick<Post, "externalMediaId" | "publishedAt" | "publishState">,
): string | null {
  if (post.externalMediaId || post.publishedAt || post.publishState === "confirmed")
    return "This post already has a provider result; it cannot be sent again.";
  if (post.publishState === "ambiguous")
    return "The previous send may be live. Reconcile it on the provider before making a new post.";
  return null;
}

export function assetProblem(
  post: Pick<Post, "brandId" | "accountId">,
  asset: SendAsset,
): string | null {
  if (asset.brandId !== post.brandId) return "The attached file must belong to this post's brand.";
  if (asset.accountId !== null && asset.accountId !== post.accountId)
    return "The attached file is assigned to a different account.";
  if (asset.status !== "approved" && asset.status !== "used")
    return "The attached file must be approved (or previously used) before sending.";
  if (!asset.sha256 || !asset.localPath)
    return "The attached file has no intact local media identity.";
  return null;
}

export function targetSnapshot(account: SocialAccount, list: SendAsset[]): TargetSnapshot {
  return {
    accountId: account.id,
    brandId: account.brandId,
    platform: account.platform,
    integrationId: account.integrationId,
    externalId: account.externalId,
    assets: list.map((a) => ({
      assetId: a.assetId,
      sha256: a.sha256,
      localPath: a.localPath,
      bytes: a.bytes,
      role: a.role,
      position: a.position,
      kind: a.kind,
      mime: a.mime,
      altText: a.altText,
      width: a.width,
      height: a.height,
      durationSec: a.durationSec,
      brandId: a.brandId,
      accountId: a.accountId,
    })),
  };
}

/** Compare named fields in canonical order; JSONB key order is not an identity. */
export function sameTarget(a: TargetSnapshot | null, b: TargetSnapshot): boolean {
  if (!a) return false;
  const normalize = (t: TargetSnapshot) => ({
    accountId: t.accountId,
    brandId: t.brandId,
    platform: t.platform,
    integrationId: t.integrationId,
    externalId: t.externalId,
    assets: t.assets.map((v) => ({
      assetId: v.assetId,
      sha256: v.sha256,
      localPath: v.localPath,
      bytes: v.bytes,
      role: v.role,
      position: v.position,
      kind: v.kind,
      mime: v.mime,
      altText: v.altText,
      width: v.width,
      height: v.height,
      durationSec: v.durationSec,
      brandId: v.brandId,
      accountId: v.accountId,
    })),
  });
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function approvalProblem(
  post: Pick<Post, "revision" | "publishApprovedRevision" | "publishApprovedBy" | "publishTarget">,
  target: TargetSnapshot,
): string | null {
  if (!post.publishApprovedBy || post.publishApprovedRevision !== post.revision)
    return "The owner must approve this revision before sending.";
  if (!sameTarget(post.publishTarget, target))
    return "The approved account or attachments changed. Ask the owner to approve the post again.";
  return null;
}
