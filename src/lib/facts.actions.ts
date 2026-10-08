"use server";

/**
 * The fact sheet's writes (build 2b, idea 3). Owner only: a fact sheet is what
 * scripts are told to say as-is, so it is the owner's word, not a shared note.
 *
 * Errors come back as dictionary keys so the form can show them in the
 * viewer's language; `detail` carries the bridge's validation message, which
 * is English only.
 */

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { getBrand } from "@/lib/bridge/brands";
import { getFamily } from "@/lib/bridge/families";
import { createHook, deleteHook, isHookKind } from "@/lib/bridge/hooks";
import { InvalidLessonError } from "@/lib/bridge/lessons";
import {
  createFact,
  deleteFact,
  InvalidFactError,
  markFactChecked,
  updateFact,
  type FactInput,
} from "@/lib/bridge/facts";
import {
  fetchFactsSource,
  FactsImportError,
  importFacts,
  MAX_SOURCE_BYTES,
} from "@/lib/facts/import";
import type { TranslationKey } from "@/lib/i18n";

export type FactActionResult = { ok: true } | { ok: false; error: TranslationKey; detail?: string };

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function fromForm(formData: FormData): FactInput {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    topic: field("topic"),
    claim: field("claim"),
    sourceUrl: field("sourceUrl"),
    notes: field("notes"),
  };
}

/** Runs `write` for the owner; turns the two expected refusals into results. */
async function asOwner(write: () => Promise<FactActionResult>): Promise<FactActionResult> {
  try {
    await requireOwner("edit the fact sheet");
    const result = await write();
    if (result.ok) revalidatePath("/facts");
    return result;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "facts.error.owner" };
    if (err instanceof InvalidFactError)
      return { ok: false, error: "facts.error.invalid", detail: err.message };
    throw err;
  }
}

/** Add a fact to a brand's sheet. `useActionState` shape: (bound brand, previous state, form). */
export async function createFactAction(
  brandId: string,
  _prev: FactActionResult | null,
  formData: FormData,
): Promise<FactActionResult> {
  return asOwner(async () => {
    if (typeof brandId !== "string" || !(await getBrand(brandId)))
      return { ok: false, error: "facts.error.brand" };
    await createFact(brandId, fromForm(formData));
    return { ok: true };
  });
}

/** Edit a fact. A new claim or source bumps `updatedAt`, which can flag posted scripts. */
export async function updateFactAction(
  id: number,
  _prev: FactActionResult | null,
  formData: FormData,
): Promise<FactActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "facts.error.missing" };
    return (await updateFact(id, fromForm(formData)))
      ? { ok: true }
      : { ok: false, error: "facts.error.missing" };
  });
}

/** "Checked today". */
export async function markFactCheckedAction(id: number): Promise<FactActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "facts.error.missing" };
    return (await markFactChecked(id)) ? { ok: true } : { ok: false, error: "facts.error.missing" };
  });
}

export async function deleteFactAction(id: number): Promise<FactActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "facts.error.missing" };
    return (await deleteFact(id)) ? { ok: true } : { ok: false, error: "facts.error.missing" };
  });
}

// ---------------------------------------------------------------------------
// Facts import (S18, §1.48)

export type FactImportActionResult =
  | { ok: true; keys: number; rows: number; inserted: number; updated: number; unchanged: number }
  | { ok: false; error: TranslationKey; detail?: string };

/**
 * Import a family's facts from an uploaded source file or an http(s) URL (the
 * raw GitHub URL of paraguayresidency's `content/shared/facts.ts`). Owner
 * only, like every fact sheet write. `useActionState` shape.
 */
export async function importFactsAction(
  _prev: FactImportActionResult | null,
  formData: FormData,
): Promise<FactImportActionResult> {
  try {
    await requireOwner("import facts");
    const familyId = formData.get("family");
    if (typeof familyId !== "string" || !familyId)
      return { ok: false, error: "facts.error.family" };
    const file = formData.get("file");
    const url = formData.get("url");
    let text: string;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_SOURCE_BYTES)
        return { ok: false, error: "facts.error.import", detail: "The file is too large." };
      text = await file.text();
    } else if (typeof url === "string" && url.trim()) {
      text = await fetchFactsSource(url.trim());
    } else {
      return { ok: false, error: "facts.error.source" };
    }
    const result = await importFacts(familyId, text);
    revalidatePath("/facts");
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "facts.error.owner" };
    if (err instanceof FactsImportError)
      return { ok: false, error: "facts.error.import", detail: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Hooks library (S18): hook / cta / caption_pattern lessons

export type HookActionResult = { ok: true } | { ok: false; error: TranslationKey; detail?: string };

/**
 * Quick-add a hook. Any signed-in user: a hook is a note, like every lesson
 * (§1.20). `scope` is `brand:<id>`, `family:<id>` or empty (portfolio-wide).
 */
export async function createHookAction(
  _prev: HookActionResult | null,
  formData: FormData,
): Promise<HookActionResult> {
  await requireUser();
  const text = formData.get("text");
  const kind = formData.get("kind");
  const scope = formData.get("scope");
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "hooks.error.text" };
  if (!isHookKind(kind)) return { ok: false, error: "hooks.error.kind" };
  let brandId: string | null = null;
  let familyId: string | null = null;
  if (typeof scope === "string" && scope.startsWith("brand:")) {
    brandId = scope.slice("brand:".length);
    if (!(await getBrand(brandId))) return { ok: false, error: "hooks.error.scope" };
  } else if (typeof scope === "string" && scope.startsWith("family:")) {
    familyId = scope.slice("family:".length);
    if (!(await getFamily(familyId))) return { ok: false, error: "hooks.error.scope" };
  } else if (scope !== null && scope !== "") {
    return { ok: false, error: "hooks.error.scope" };
  }
  try {
    await createHook({ text, kind, brandId, familyId });
  } catch (err) {
    if (err instanceof InvalidLessonError)
      return { ok: false, error: "hooks.error.text", detail: err.message };
    throw err;
  }
  revalidatePath("/hooks");
  return { ok: true };
}

/** Delete one hook. Any signed-in user, as on /lessons. */
export async function deleteHookAction(id: number): Promise<HookActionResult> {
  await requireUser();
  if (!isPositiveId(id) || !(await deleteHook(id)))
    return { ok: false, error: "hooks.error.missing" };
  revalidatePath("/hooks");
  return { ok: true };
}
