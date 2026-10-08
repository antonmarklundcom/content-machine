"use server";

/**
 * The script studio's writes (PLAN.md §6.S12). Generation goes through O8's
 * routes (`/api/scripts/titles`, `/api/scripts`); these two only edit a saved
 * script, which spends nothing, so any signed-in user may — the same rule as
 * editing an idea (§1.20).
 */

import { revalidatePath } from "next/cache";
import { SCRIPT_STATUSES, type Script, type ScriptStatus } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { InvalidScriptError, setScriptStatus, updateScriptBody } from "@/lib/bridge/scripts";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";

// A "use server" file may export only async functions (and types), so errors
// here are plain Errors whose messages the UI shows.

function assertId(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new Error("That is not a script id.");
}

function revalidateFor(id: number) {
  revalidatePath("/studio");
  revalidatePath(`/studio/${id}`);
}

export type SaveScriptResult = { ok: true; script: Script } | { ok: false; errors: string[] };

/**
 * Replace a script's body. An invalid body is never saved: the validator's
 * errors come back as data (not a throw) so the editor can show each one next
 * to the part it is about. The `title` and `language` columns follow the body.
 */
export async function saveScript(
  id: number,
  body: unknown,
  expectedBody?: unknown,
): Promise<SaveScriptResult> {
  await requireUser();
  assertId(id);
  // A server action is a public endpoint: the body is checked here, not trusted
  // because the editor already checked it.
  const verdict = validateScriptBody(body);
  if (!verdict.ok) return { ok: false, errors: verdict.errors };
  const b = body as ScriptBodyV1;
  try {
    const row = await updateScriptBody(id, b, validateScriptBody, {
      title: b.chosenTitle,
      language: b.language,
      expectedBody,
    });
    if (!row)
      return {
        ok: false,
        errors: ["The saved script changed. Reload, review your recovered draft, and try again."],
      };
    revalidateFor(id);
    return { ok: true, script: row };
  } catch (error) {
    if (error instanceof InvalidScriptError) {
      return { ok: false, errors: error.errors.length ? error.errors : [error.message] };
    }
    throw error;
  }
}

/** Move a script along draft → ready → recorded → posted (or back). */
export async function setStudioScriptStatus(id: number, status: ScriptStatus): Promise<Script> {
  await requireUser();
  assertId(id);
  if (!(SCRIPT_STATUSES as readonly string[]).includes(status))
    throw new Error(`Unknown status "${String(status)}".`);
  const row = await setScriptStatus(id, status);
  if (!row) throw new Error("That script no longer exists.");
  revalidateFor(id);
  return row;
}
