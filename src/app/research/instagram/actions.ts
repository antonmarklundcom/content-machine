"use server";

/**
 * Research → Instagram writes (PLAN.md §6.S21). Owner only: adding, removing
 * and looking up competitors. Plain form actions; the page re-renders.
 */

import { revalidatePath } from "next/cache";

import { SOCIAL_COMPETITOR_ROLES, type SocialCompetitorRole } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { addIgCompetitor, removeIgCompetitor, syncIgCompetitors } from "@/lib/meta/discovery";

const str = (form: FormData, k: string) =>
  typeof form.get(k) === "string" ? (form.get(k) as string).trim() : "";

export async function addIgCompetitorAction(form: FormData): Promise<void> {
  await requireOwner("add an Instagram competitor");
  const role = str(form, "role") as SocialCompetitorRole;
  await addIgCompetitor(
    str(form, "brandId"),
    str(form, "handle"),
    SOCIAL_COMPETITOR_ROLES.includes(role) ? role : "competitor",
  );
  revalidatePath("/research/instagram");
}

export async function removeIgCompetitorAction(form: FormData): Promise<void> {
  await requireOwner("remove an Instagram competitor");
  const id = Number(str(form, "id"));
  if (Number.isInteger(id) && id > 0) await removeIgCompetitor(id);
  revalidatePath("/research/instagram");
}

export async function syncIgCompetitorsAction(form: FormData): Promise<void> {
  await requireOwner("look up Instagram competitors");
  await syncIgCompetitors({ brandId: str(form, "brandId") || undefined });
  revalidatePath("/research/instagram");
}
