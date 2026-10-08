"use server";

/** Training dataset export (build 5 §3.C, docs/DATASET.md). Owner only, PC only. */

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import type { TranslationKey } from "@/lib/i18n";
import { exportDataset, type DatasetExportSummary } from "@/lib/voice/dataset/export";
import { DatasetConsentError } from "@/lib/voice/dataset/select";

export type DatasetActionResult =
  | { ok: true; summary: DatasetExportSummary }
  | { ok: false; error: TranslationKey; detail?: string };

export async function exportDatasetAction(
  profileKey: string,
  language: string,
): Promise<DatasetActionResult> {
  try {
    await requireOwner("Exporting a voice dataset");
    if (typeof profileKey !== "string" || typeof language !== "string" || !profileKey) {
      return { ok: false, error: "dataset.error.failed", detail: "Missing profile or language." };
    }
    const summary = await exportDataset({ profileKey, language });
    revalidatePath("/voice/dataset");
    return { ok: true, summary };
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    if (err instanceof ForbiddenError) return { ok: false, error: "dataset.error.owner" };
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    if (err instanceof DatasetConsentError) {
      return { ok: false, error: "dataset.error.consent", detail };
    }
    return { ok: false, error: "dataset.error.failed", detail };
  }
}
