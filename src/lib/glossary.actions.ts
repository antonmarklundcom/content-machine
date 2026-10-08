"use server";

/**
 * /glossary writes (build 4 §3.D). Owner only: the glossary decides which
 * Guaraní words the script writer may use (§1.2).
 */

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { GlossaryCsvError } from "@/lib/glossary/csv";
import { clearApprovedTermsCache } from "@/lib/glossary/prompt";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  importGlossaryCsv,
  importSeed,
  InvalidGlossaryError,
  isRegister,
  isReviewStatus,
  reviewGlossaryTerm,
  sendToPronunciations,
  updateGlossaryTerm,
  type GlossaryInput,
} from "@/lib/glossary/store";
import type { TranslationKey } from "@/lib/i18n";

export type GlossaryActionResult =
  | { ok: true; rows?: number; inserted?: number; updated?: number }
  | { ok: false; error: TranslationKey; detail?: string };

const MAX_CSV_BYTES = 2_000_000;

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function fromForm(formData: FormData): GlossaryInput {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const register = field("register");
  return {
    term: field("term"),
    meaningEs: field("meaningEs"),
    meaningEn: field("meaningEn"),
    sayAs: field("sayAs"),
    partOfSpeech: field("partOfSpeech"),
    register: isRegister(register) ? register : undefined,
    joparaOk: formData.get("joparaOk") === "on" || formData.get("joparaOk") === "true",
    example: field("example"),
    exampleTranslation: field("exampleTranslation"),
    source: field("source"),
    notes: field("notes"),
  };
}

async function asOwner(write: () => Promise<GlossaryActionResult>): Promise<GlossaryActionResult> {
  try {
    await requireOwner("edit the glossary");
    const result = await write();
    if (result.ok) {
      clearApprovedTermsCache();
      revalidatePath("/glossary");
    }
    return result;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "glossary.error.owner" };
    if (err instanceof InvalidGlossaryError || err instanceof GlossaryCsvError)
      return { ok: false, error: "glossary.error.invalid", detail: err.message };
    throw err;
  }
}

export async function createGlossaryAction(
  _prev: GlossaryActionResult | null,
  formData: FormData,
): Promise<GlossaryActionResult> {
  return asOwner(async () => {
    await createGlossaryTerm(fromForm(formData));
    return { ok: true };
  });
}

export async function updateGlossaryAction(
  id: number,
  _prev: GlossaryActionResult | null,
  formData: FormData,
): Promise<GlossaryActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "glossary.error.missing" };
    return (await updateGlossaryTerm(id, fromForm(formData)))
      ? { ok: true }
      : { ok: false, error: "glossary.error.missing" };
  });
}

export async function reviewGlossaryAction(
  id: number,
  status: string,
  reviewer: string,
): Promise<GlossaryActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id) || !isReviewStatus(status))
      return { ok: false, error: "glossary.error.missing" };
    if (status !== "proposed" && !reviewer.trim())
      return { ok: false, error: "glossary.error.reviewer" };
    return (await reviewGlossaryTerm(id, status, reviewer))
      ? { ok: true }
      : { ok: false, error: "glossary.error.missing" };
  });
}

export async function deleteGlossaryAction(id: number): Promise<GlossaryActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "glossary.error.missing" };
    return (await deleteGlossaryTerm(id))
      ? { ok: true }
      : { ok: false, error: "glossary.error.missing" };
  });
}

export async function sendToPronunciationsAction(id: number): Promise<GlossaryActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "glossary.error.missing" };
    return (await sendToPronunciations(id))
      ? { ok: true }
      : { ok: false, error: "glossary.error.noSayAs" };
  });
}

export async function importGlossaryAction(
  _prev: GlossaryActionResult | null,
  formData: FormData,
): Promise<GlossaryActionResult> {
  return asOwner(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      return { ok: false, error: "glossary.error.file" };
    if (file.size > MAX_CSV_BYTES)
      return { ok: false, error: "glossary.error.invalid", detail: "The file is too large." };
    return { ok: true, ...(await importGlossaryCsv(await file.text())) };
  });
}

export async function importSeedAction(): Promise<GlossaryActionResult> {
  return asOwner(async () => ({ ok: true, ...(await importSeed()) }));
}
