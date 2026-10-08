"use server";

import { revalidatePath } from "next/cache";
import { generateOutline } from "@/lib/analysis/outline";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { SpendCapExceededError } from "@/lib/spend";

export type GenerateOutlineFormResult = { ok: true } | { ok: false; error: string };

export async function generateOutlineAction(
  analysisId: number,
  ideaIndex: number,
  videoId: number,
): Promise<GenerateOutlineFormResult> {
  try {
    await requireOwner("generate an outline");

    const result = await generateOutline(analysisId, ideaIndex);
    revalidatePath(`/youtube/video/${videoId}`);
    if (result.status === "failed") return { ok: false, error: result.error };
    return { ok: true };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    if (err instanceof SpendCapExceededError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Outline generation failed." };
  }
}
