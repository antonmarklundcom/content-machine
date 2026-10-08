import { upsertReturning } from "@/db/mutations";
import "server-only";

import { db } from "@/db";
import { brandKits } from "@/db/schema";
import { getBrand, getBrandKit, getPost } from "@/lib/bridge";

import { updatePost, PostEngineError } from "@/lib/posts/engine";

import { buildLeadUrl, leadBaseProblem, LeadUrlError } from "./url";

/**
 * Writes for lead links (build 4 §3.G): the brand kit's `lead_base_url` and a
 * post's `lead_url`. Nothing checks who is asking; the actions do.
 */

/** Set (or clear, with an empty value) a brand's lead base URL; creates the kit row if needed. */
export async function setKitLeadBase(
  brandId: string,
  value: string | null,
): Promise<string | null> {
  const brand = await getBrand(brandId);
  if (!brand) throw new LeadUrlError("No such brand.");
  const url = value?.trim() ? value.trim() : null;
  if (url) {
    const problem = leadBaseProblem(url);
    if (problem) throw new LeadUrlError(problem);
  }
  await upsertReturning(
    db,
    brandKits,
    { brandId, leadBaseUrl: url },
    {
      target: brandKits.brandId,
      set: { leadBaseUrl: url, updatedAt: new Date() },
    },
  );
  return url;
}

/** Set (or clear) a post's lead URL by hand. Any http(s) URL is accepted as typed. */
export async function setPostLeadUrl(postId: number, value: string | null): Promise<string | null> {
  const url = value?.trim() ? value.trim() : null;
  if (url) {
    const problem = leadBaseProblem(url);
    if (problem) throw new LeadUrlError(problem.replace("lead base URL", "lead URL"));
  }
  try {
    await updatePost(postId, { leadUrl: url });
  } catch (error) {
    if (error instanceof PostEngineError) throw new LeadUrlError(error.message);
    throw error;
  }
  return url;
}

/** Build the post's lead URL from its brand kit's base and its account, and store it. */
export async function fillPostLeadUrl(postId: number, campaign?: string | null): Promise<string> {
  const post = await getPost(postId);
  if (!post) throw new LeadUrlError("No such post.");
  const kit = await getBrandKit(post.brandId);
  if (!kit?.leadBaseUrl) {
    throw new LeadUrlError("This brand has no lead base URL yet. Set it in the brand kit.");
  }
  const url = buildLeadUrl(kit.leadBaseUrl, {
    platform: post.platform ?? "social",
    accountHandle: post.handle ?? post.brandId,
    postId: post.id,
    campaign,
  });
  try {
    await updatePost(postId, { leadUrl: url }, { expectedRevision: post.revision });
  } catch (error) {
    if (error instanceof PostEngineError) throw new LeadUrlError(error.message);
    throw error;
  }
  return url;
}
