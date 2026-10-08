"use server";

import { revalidatePath } from "next/cache";
import { BRAND_SOURCE_ROLES, type BrandSourceRole } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { getBrand } from "@/lib/bridge/brands";
import { linkSourceToBrand, unlinkSourceFromBrand } from "@/lib/bridge/research";
import type { TranslationKey } from "@/lib/i18n";
import { upsertChannelSource } from "@/lib/ingest/store";
import { YouTubeDataClient } from "@/lib/youtube/data-api";
import { parseYouTubeUrl } from "@/lib/youtube/url";

/**
 * The research page's writes (PLAN.md §6.S10). All free, so any signed-in user
 * may make them — the same line `sources.actions.ts` draws: adding and pausing
 * sources is open to an employee, only spending or destroying paid work is not.
 *
 * Errors come back as dictionary keys so the form can show them in the
 * viewer's language; `detail` carries a thrown message verbatim (YouTube's own
 * wording), which has no translation.
 */

export type ResearchActionResult =
  { ok: true } | { ok: false; error: TranslationKey; detail?: string };

function isRole(value: unknown): value is BrandSourceRole {
  return typeof value === "string" && (BRAND_SOURCE_ROLES as readonly string[]).includes(value);
}

function revalidate() {
  revalidatePath("/research");
}

/**
 * Track a channel and link it to a brand in one step.
 *
 * The ingest half is the source action's own path (`parseYouTubeUrl` →
 * `resolve` → `upsertChannelSource`), called directly rather than through
 * `addSource` because that action does not hand back the row it wrote, and the
 * link needs its id. Upsert on both sides, so pasting a channel that is already
 * tracked — or already linked — is harmless: it only (re)sets the role.
 */
export async function addCompetitorChannel(
  brandId: string,
  _prev: ResearchActionResult | null,
  formData: FormData,
): Promise<ResearchActionResult> {
  await requireUser();
  const role = formData.get("role") ?? "competitor";
  if (!isRole(role)) return { ok: false, error: "research.error.role" };
  if (!(await getBrand(brandId))) return { ok: false, error: "research.error.brand" };

  const ref = parseYouTubeUrl(String(formData.get("url") ?? "").trim());
  if (!ref) return { ok: false, error: "research.error.url" };
  if (ref.kind !== "channel" && ref.kind !== "channel_handle") {
    return { ok: false, error: "research.error.notChannel" };
  }

  try {
    const resolved = await new YouTubeDataClient().resolve(ref);
    if (!resolved || resolved.kind !== "channel")
      return { ok: false, error: "research.error.notFound" };
    const source = await upsertChannelSource(resolved.channel);
    await linkSourceToBrand(brandId, source.id, role);
  } catch (err) {
    return {
      ok: false,
      error: "research.error.failed",
      detail: err instanceof Error ? err.message : undefined,
    };
  }

  revalidate();
  revalidatePath("/youtube/sources");
  return { ok: true };
}

/** Flip a linked channel between competitor and inspiration. */
export async function setCompetitorRole(
  brandId: string,
  sourceId: number,
  role: string,
): Promise<ResearchActionResult> {
  await requireUser();
  if (!isRole(role)) return { ok: false, error: "research.error.role" };
  await linkSourceToBrand(brandId, sourceId, role);
  revalidate();
  return { ok: true };
}

/** Unlink a channel from a brand. The source and its videos stay tracked. */
export async function removeCompetitor(brandId: string, sourceId: number): Promise<void> {
  await requireUser();
  await unlinkSourceFromBrand(brandId, sourceId);
  revalidate();
}
