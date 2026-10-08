"use server";

/**
 * The clip detail page's actions (PLAN.md §6.S17). "Fetch + transcribe" is the
 * owner's click (§1.44) — it spends, so owner-only, and it works for any
 * purpose, `inspo` included, because a click is the explicit ask. Saving a
 * claim as a fact is owner-only like the fact sheet itself; saving a hook is a
 * lesson, which any signed-in user may write (§1.20).
 *
 * Results, not throws: production strips a thrown action's message, and the
 * refusals (no yt-dlp, drive unplugged, the cap) are what the owner must read.
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { facts } from "@/db/schema";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { getBrand, getClip } from "@/lib/bridge";
import { createFact, InvalidFactError } from "@/lib/bridge/facts";
import { createLesson, InvalidLessonError } from "@/lib/bridge/lessons";
import { fetchClip } from "@/lib/clips/fetch";
import { formatUsd } from "@/lib/spend";

export type ClipFetchActionResult = { ok: true; message?: string } | { ok: false; error: string };

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function fetchClipAction(clipId: number): Promise<ClipFetchActionResult> {
  try {
    await requireOwner("fetch and transcribe a clip");
  } catch (err) {
    if (err instanceof ForbiddenError)
      return { ok: false, error: "Only the owner can fetch clips." };
    throw err;
  }
  if (!isPositiveId(clipId) || !(await getClip(clipId)))
    return { ok: false, error: "No such clip." };

  const outcome = await fetchClip(clipId);
  revalidatePath(`/clips/${clipId}`);
  revalidatePath("/inbox");
  if (outcome.status === "done") {
    return { ok: true, message: `Transcribed (${formatUsd(outcome.costUsd)}).` };
  }
  return { ok: false, error: outcome.status === "failed" ? outcome.error : outcome.message };
}

export type SaveFromClipInput = {
  clipId: number;
  text: string;
  brandId: string;
  /** Facts only: the fact sheet's grouping. */
  topic?: string;
};

export async function saveClaimAsFactAction(
  input: SaveFromClipInput,
): Promise<ClipFetchActionResult> {
  try {
    await requireOwner("edit the fact sheet");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "Only the owner can add facts." };
    throw err;
  }
  const clip = isPositiveId(input?.clipId) ? await getClip(input.clipId) : null;
  if (!clip) return { ok: false, error: "No such clip." };
  const brandId = text(input.brandId);
  if (!brandId || !(await getBrand(brandId))) return { ok: false, error: "Pick a brand." };
  try {
    // Unverified (§1.48): a claim heard in someone else's reel is what needs
    // checking, not a checked fact, so generation may cite it only hedged.
    // `createFact` marks hand-typed facts verified (the owner's word); the
    // bridge only reads and creates, so the flag is cleared here, in the
    // action that owns this write. The clip is the source.
    const fact = await createFact(brandId, {
      topic: text(input.topic) || "from clips",
      claim: text(input.text),
      sourceUrl: clip.url,
      notes: `Claim from clip ${clip.id}; check it before saying it as fact.`,
    });
    await db.update(facts).set({ verified: false }).where(eq(facts.id, fact.id));
  } catch (err) {
    if (err instanceof InvalidFactError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/facts");
  return { ok: true, message: "Saved to the fact sheet (unverified)." };
}

export async function saveHookFromClipAction(
  input: SaveFromClipInput,
): Promise<ClipFetchActionResult> {
  await requireUser();
  const clip = isPositiveId(input?.clipId) ? await getClip(input.clipId) : null;
  if (!clip) return { ok: false, error: "No such clip." };
  const brandId = text(input.brandId) || null;
  if (brandId && !(await getBrand(brandId))) return { ok: false, error: `No brand "${brandId}".` };
  try {
    await createLesson({ text: text(input.text), kind: "hook", brandId, sourceUrl: clip.url });
  } catch (err) {
    if (err instanceof InvalidLessonError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/lessons");
  return { ok: true, message: "Saved as a hook." };
}
