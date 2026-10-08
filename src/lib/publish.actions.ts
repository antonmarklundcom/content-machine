"use server";

/**
 * Writes for the studio's after-recording pages (build 2b, ideas 6 and 7):
 * the YouTube URL, the publish pack, shorts, blog post and newsletter blurb.
 *
 * Saving a URL or an edited pack spends nothing, so any signed-in user may
 * (the same rule as editing a script). Generating anything calls the model —
 * Gemini under the spend cap, or the local CLI in subscription mode (§1.38) —
 * and is the owner's, like writing a script (§1.20).
 */

import { revalidatePath } from "next/cache";
import type { Script, ScriptDerivativeKind } from "@/db/schema";
import { SCRIPT_DERIVATIVE_KINDS } from "@/db/schema";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { getBrand } from "@/lib/bridge/brands";
import { addScriptDerivative } from "@/lib/bridge/derivatives";
import {
  createScript,
  getScript,
  setScriptParent,
  setScriptPublishPack,
  setScriptStatus,
  setScriptYoutubeUrl,
} from "@/lib/bridge/scripts";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import { generatePublishPack, normalizeYoutubeUrl, validatePublishPack } from "@/lib/studio/pack";
import { generateProse, generateShorts, type RepurposeInput } from "@/lib/studio/repurpose";
import type { PublishPack } from "@/lib/studio/types";

// A "use server" file may export only async functions (and types); failures
// the page should show come back as `{ ok: false, error }`.

export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string; errors?: string[] };

function assertId(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new Error("That is not a script id.");
}

function revalidateFor(id: number) {
  revalidatePath("/studio");
  revalidatePath(`/studio/${id}`);
  revalidatePath(`/studio/${id}/publish`);
  revalidatePath(`/studio/${id}/repurpose`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The script, its valid body and its brand — or the reason there is none. */
async function load(
  id: number,
): Promise<{ row: Script; input: RepurposeInput } | { error: string }> {
  const row = await getScript(id);
  if (!row) return { error: "That script no longer exists." };
  if (!validateScriptBody(row.body).ok)
    return { error: "This script's body does not match the contract; fix it in the editor first." };
  const brand = await getBrand(row.brandId);
  if (!brand) return { error: `The brand "${row.brandId}" no longer exists.` };
  return {
    row,
    input: { brand, title: row.title, youtubeUrl: row.youtubeUrl, body: row.body as ScriptBodyV1 },
  };
}

/**
 * Save the published video's URL. A URL moves the script to `posted` (idea 6);
 * an empty one clears the URL and leaves the status alone.
 */
export async function savePublishUrl(
  id: number,
  url: string,
): Promise<ActionResult<{ script: Script }>> {
  await requireUser();
  assertId(id);
  const trimmed = String(url ?? "").trim();
  const normalized = normalizeYoutubeUrl(trimmed);
  if (trimmed && !normalized) return { ok: false, error: "That is not a YouTube video URL." };
  const saved = await setScriptYoutubeUrl(id, normalized);
  if (!saved) return { ok: false, error: "That script no longer exists." };
  const row = normalized ? await setScriptStatus(id, "posted") : saved;
  revalidateFor(id);
  return { ok: true, script: row ?? saved };
}

/** Generate the post-recording pack and store it (replacing any earlier one). */
export async function generatePack(
  id: number,
): Promise<ActionResult<{ pack: PublishPack; costUsd: number }>> {
  await requireOwner("generate a publish pack");
  assertId(id);
  const loaded = await load(id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  try {
    const { pack, costUsd } = await generatePublishPack(loaded.input);
    await setScriptPublishPack(id, pack);
    revalidateFor(id);
    return { ok: true, pack, costUsd };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

/** Save a pack edited on the page. Checked field by field; nothing is saved if any is wrong. */
export async function savePublishPack(
  id: number,
  pack: unknown,
): Promise<ActionResult<{ pack: PublishPack }>> {
  await requireUser();
  assertId(id);
  const verdict = validatePublishPack(pack);
  if (!verdict.ok) return { ok: false, error: "The pack was not saved.", errors: verdict.errors };
  const row = await setScriptPublishPack(id, verdict.pack);
  if (!row) return { ok: false, error: "That script no longer exists." };
  revalidateFor(id);
  return { ok: true, pack: verdict.pack };
}

/**
 * Cut 3–5 shorts from a script. Each is saved as a new draft script linked by
 * `parent_script_id`; shorts the contract rejected are counted, not saved.
 */
export async function makeShorts(
  id: number,
): Promise<ActionResult<{ ids: number[]; rejected: number; costUsd: number }>> {
  await requireOwner("make shorts");
  assertId(id);
  const loaded = await load(id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  try {
    const { shorts, rejected, costUsd } = await generateShorts(loaded.input);
    const ids: number[] = [];
    for (const body of shorts) {
      const created = await createScript(
        {
          brandId: loaded.row.brandId,
          ideaId: loaded.row.ideaId,
          title: body.chosenTitle,
          language: body.language,
          body,
        },
        validateScriptBody,
      );
      await setScriptParent(created.id, id);
      ids.push(created.id);
    }
    revalidateFor(id);
    return { ok: true, ids, rejected: rejected.length, costUsd };
  } catch (error) {
    const errors =
      error && typeof error === "object" && "errors" in error
        ? (error as { errors: string[] }).errors
        : undefined;
    return { ok: false, error: message(error), ...(errors?.length ? { errors } : {}) };
  }
}

/** Write a blog post or newsletter blurb from a script and store it as a new derivative. */
export async function makeProse(
  id: number,
  kind: ScriptDerivativeKind,
): Promise<ActionResult<{ derivativeId: number; content: string; costUsd: number }>> {
  await requireOwner(kind === "blog" ? "write a blog post" : "write a newsletter blurb");
  assertId(id);
  if (!(SCRIPT_DERIVATIVE_KINDS as readonly string[]).includes(kind))
    return { ok: false, error: `Unknown kind "${String(kind)}".` };
  const loaded = await load(id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  try {
    const { markdown, costUsd } = await generateProse(kind, loaded.input);
    const row = await addScriptDerivative(id, kind, markdown);
    revalidateFor(id);
    return { ok: true, derivativeId: row.id, content: row.content, costUsd };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
