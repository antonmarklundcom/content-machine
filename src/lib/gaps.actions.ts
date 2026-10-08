"use server";

/**
 * `/research/gaps` from the UI (build 4 §3.G). Finding gaps spends, so it is
 * owner only; "Make idea" and "Dismiss" are free for any signed-in user.
 */

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { findGaps, GapError, makeIdeaFromGap, setGapStatus } from "@/lib/gaps/find";
import { formatUsd, SpendCapExceededError } from "@/lib/spend";

export type GapActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function refusal(error: unknown): { ok: false; error: string } {
  if (
    error instanceof GapError ||
    error instanceof SpendCapExceededError ||
    error instanceof ForbiddenError
  ) {
    return { ok: false, error: error.message };
  }
  throw error;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export async function findGapsAction(
  brandId: string,
): Promise<GapActionResult<{ found: number; dropped: number; cost: string }>> {
  try {
    await requireOwner("look for content gaps");
    if (typeof brandId !== "string" || !brandId) return { ok: false, error: "Pick a brand." };
    const r = await findGaps(brandId);
    revalidatePath("/research/gaps");
    return {
      ok: true,
      found: r.gaps.length,
      dropped: r.dropped.length,
      cost: formatUsd(r.costUsd),
    };
  } catch (error) {
    return refusal(error);
  }
}

export async function makeIdeaFromGapAction(
  gapId: number,
): Promise<GapActionResult<{ ideaId: number }>> {
  try {
    await requireUser();
    if (!isId(gapId)) return { ok: false, error: "That is not a gap id." };
    const r = await makeIdeaFromGap(gapId);
    revalidatePath("/research/gaps");
    return { ok: true, ideaId: r.ideaId };
  } catch (error) {
    return refusal(error);
  }
}

export async function dismissGapAction(gapId: number): Promise<GapActionResult> {
  try {
    await requireUser();
    if (!isId(gapId)) return { ok: false, error: "That is not a gap id." };
    await setGapStatus(gapId, "dismissed");
    revalidatePath("/research/gaps");
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}
