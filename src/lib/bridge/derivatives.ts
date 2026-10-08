import { insertReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  SCRIPT_DERIVATIVE_KINDS,
  scriptDerivatives,
  type ScriptDerivative,
  type ScriptDerivativeKind,
} from "@/db/schema";

/**
 * Repurposed prose made from a script (build 2b, idea 7): blog posts and
 * newsletter blurbs, Markdown. Each generation is a new row, so an earlier
 * version is never overwritten; the page shows the newest of each kind.
 */

export async function addScriptDerivative(
  scriptId: number,
  kind: ScriptDerivativeKind,
  content: string,
): Promise<ScriptDerivative> {
  if (!(SCRIPT_DERIVATIVE_KINDS as readonly string[]).includes(kind))
    throw new Error(`Unknown derivative kind "${kind}".`);
  if (!content.trim()) throw new Error("A derivative needs some text.");
  const [row] = await insertReturning(db, scriptDerivatives, { scriptId, kind, content });
  if (!row) throw new Error("Insert into script_derivatives returned no row");
  return row;
}

/** Every derivative of a script, newest first; optionally one kind only. */
export async function listScriptDerivatives(
  scriptId: number,
  kind?: ScriptDerivativeKind,
): Promise<ScriptDerivative[]> {
  return db
    .select()
    .from(scriptDerivatives)
    .where(
      kind
        ? and(eq(scriptDerivatives.scriptId, scriptId), eq(scriptDerivatives.kind, kind))
        : eq(scriptDerivatives.scriptId, scriptId),
    )
    .orderBy(desc(scriptDerivatives.createdAt), desc(scriptDerivatives.id));
}

/** The newest derivative of each kind, keyed by kind. */
export async function latestScriptDerivatives(
  scriptId: number,
): Promise<Partial<Record<ScriptDerivativeKind, ScriptDerivative>>> {
  const out: Partial<Record<ScriptDerivativeKind, ScriptDerivative>> = {};
  for (const row of await listScriptDerivatives(scriptId)) out[row.kind] ??= row;
  return out;
}
