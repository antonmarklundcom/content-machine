"use server";

/**
 * Lead links from the UI (build 4 §3.G). Free edits, so any signed-in user.
 * Each action returns `{ ok, … } | { ok: false, error }` rather than throwing,
 * so the refusal text reaches the person in production.
 */

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { fillPostLeadUrl, setKitLeadBase, setPostLeadUrl } from "@/lib/leads/store";
import { LeadUrlError } from "@/lib/leads/url";

export type LeadActionResult = { ok: true; url: string | null } | { ok: false; error: string };

function refusal(error: unknown): { ok: false; error: string } {
  if (error instanceof LeadUrlError) return { ok: false, error: error.message };
  throw error;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export async function setKitLeadBaseAction(
  brandId: string,
  value: string,
): Promise<LeadActionResult> {
  await requireUser();
  if (typeof brandId !== "string" || !brandId) return { ok: false, error: "Pick a brand." };
  if (typeof value !== "string") return { ok: false, error: "The URL must be text." };
  try {
    const url = await setKitLeadBase(brandId, value);
    revalidatePath(`/brand/${brandId}/kit`);
    return { ok: true, url };
  } catch (error) {
    return refusal(error);
  }
}

export async function setPostLeadUrlAction(
  postId: number,
  value: string,
): Promise<LeadActionResult> {
  await requireUser();
  if (!isId(postId)) return { ok: false, error: "That is not a post id." };
  if (typeof value !== "string") return { ok: false, error: "The URL must be text." };
  try {
    const url = await setPostLeadUrl(postId, value);
    revalidatePath(`/posts/${postId}`);
    return { ok: true, url };
  } catch (error) {
    return refusal(error);
  }
}

export async function fillPostLeadUrlAction(
  postId: number,
  campaign?: string,
): Promise<LeadActionResult> {
  await requireUser();
  if (!isId(postId)) return { ok: false, error: "That is not a post id." };
  try {
    const url = await fillPostLeadUrl(postId, typeof campaign === "string" ? campaign : null);
    revalidatePath(`/posts/${postId}`);
    return { ok: true, url };
  } catch (error) {
    return refusal(error);
  }
}
