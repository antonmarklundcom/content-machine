import "server-only";
import { notFound } from "next/navigation";
import { getScript } from "@/lib/bridge/scripts";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import type { Script } from "@/db/schema";

/** The script for `/studio/[id]` and its teleprompter; 404 for a bad id or a missing row. */
export async function loadScript(
  rawId: string,
): Promise<{ row: Script; body: ScriptBodyV1; valid: boolean }> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const row = await getScript(id);
  if (!row) notFound();
  return { row, body: row.body as ScriptBodyV1, valid: validateScriptBody(row.body).ok };
}
