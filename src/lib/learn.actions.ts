"use server";
import { updateReturning } from "@/db/mutations";

/**
 * /learn's buttons (docs/PLAN-build4.md §1.13). Owner-only, every one: the
 * summary spends, and the rest change or delete Anton's own learning list.
 * Results, not throws: production strips a thrown action's message.
 */

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { clips } from "@/db/schema";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { processLearnClip } from "@/lib/learn/process";
import { formatUsd } from "@/lib/spend";

export type LearnActionResult = { ok: true; message?: string } | { ok: false; error: string };

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

async function ownerOr(action: string): Promise<LearnActionResult | null> {
  try {
    await requireOwner(action);
    return null;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "Only the owner can do this." };
    throw err;
  }
}

const learnClip = (id: number) => and(eq(clips.id, id), eq(clips.purpose, "learn"));

/** Summarise, or re-run the summary of, one learn clip. */
export async function summariseLearnAction(clipId: number): Promise<LearnActionResult> {
  const denied = await ownerOr("summarise a learn item");
  if (denied) return denied;
  if (!isPositiveId(clipId)) return { ok: false, error: "No such item." };
  try {
    const outcome = await processLearnClip(clipId, { force: true });
    revalidatePath("/learn");
    if (outcome.status === "done") {
      return { ok: true, message: `Summarised (${formatUsd(outcome.costUsd)}).` };
    }
    return { ok: false, error: outcome.status === "failed" ? outcome.error : outcome.reason };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Mark implemented, or undo it. */
export async function setLearnImplementedAction(
  clipId: number,
  implemented: boolean,
): Promise<LearnActionResult> {
  const denied = await ownerOr("mark a learn item implemented");
  if (denied) return denied;
  if (!isPositiveId(clipId)) return { ok: false, error: "No such item." };
  const rows = await updateReturning(
    db,
    clips,
    { implementedAt: implemented ? new Date() : null },
    implemented ? and(learnClip(clipId), isNull(clips.implementedAt)) : learnClip(clipId),
    { id: clips.id },
  );
  revalidatePath("/learn");
  return rows.length || implemented ? { ok: true } : { ok: false, error: "No such item." };
}

/** Commit to it this week (the nudge then asks about it), or take the commitment back. */
export async function setLearnCommittedAction(
  clipId: number,
  committed: boolean,
): Promise<LearnActionResult> {
  const denied = await ownerOr("commit to a learn item");
  if (denied) return denied;
  if (!isPositiveId(clipId)) return { ok: false, error: "No such item." };
  const rows = await updateReturning(
    db,
    clips,
    { committedAt: committed ? new Date() : null },
    learnClip(clipId),
    { id: clips.id },
  );
  revalidatePath("/learn");
  return rows.length ? { ok: true } : { ok: false, error: "No such item." };
}

export async function deleteLearnAction(clipId: number): Promise<LearnActionResult> {
  const denied = await ownerOr("delete a learn item");
  if (denied) return denied;
  if (!isPositiveId(clipId)) return { ok: false, error: "No such item." };
  await db.delete(clips).where(learnClip(clipId));
  revalidatePath("/learn");
  revalidatePath("/inbox");
  return { ok: true };
}
