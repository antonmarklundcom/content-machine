import { insertReturning, updateReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { SCRIPT_STATUSES, scripts, type Script, type ScriptStatus } from "@/db/schema";

/**
 * On-camera scripts (PLAN.md §1.32). The body is opaque here: its contract
 * lives in `src/lib/scripts/contract.ts` (O8), so every write takes that
 * validator as an argument instead of this file importing a shape it does not
 * own. A body no validator accepted never reaches the table.
 *
 * Writes as well as reads: lane 2 (§4.7) reaches data only through this
 * directory, and the studio (S12) edits scripts.
 */

/**
 * Accepts or rejects a script body. O8's contract validator is passed in by
 * every caller; `errors` is shown to the person who made the edit.
 */
export type ScriptBodyValidator = (body: unknown) => { ok: true } | { ok: false; errors: string[] };

export class InvalidScriptError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "InvalidScriptError";
  }
}

function checkBody(body: unknown, validate: ScriptBodyValidator): void {
  const verdict = validate(body);
  if (!verdict.ok) {
    throw new InvalidScriptError(
      `Script body rejected: ${verdict.errors.join("; ")}`,
      verdict.errors,
    );
  }
}

function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new InvalidScriptError("A script needs a title.");
  return trimmed;
}

export type NewScriptInput = {
  brandId: string;
  ideaId?: number | null;
  title: string;
  language: string;
  body: unknown;
};

/** Save a new draft script after `validate` accepts its body. */
export async function createScript(
  input: NewScriptInput,
  validate: ScriptBodyValidator,
): Promise<Script> {
  checkBody(input.body, validate);
  const [row] = await insertReturning(db, scripts, {
    brandId: input.brandId,
    ideaId: input.ideaId ?? null,
    title: checkTitle(input.title),
    language: input.language,
    body: input.body,
  });
  if (!row) throw new Error("Insert into scripts returned no row");
  return row;
}

/** One script by id, or null. */
export async function getScript(id: number): Promise<Script | null> {
  const rows = await db.select().from(scripts).where(eq(scripts.id, id)).limit(1);
  return rows[0] ?? null;
}

export type ScriptsQuery = {
  brandId?: string;
  status?: ScriptStatus;
  /** Default 100, max 500. */
  limit?: number;
};

/** Scripts filtered by brand and/or status, most recently edited first. */
export async function listScripts(query: ScriptsQuery = {}): Promise<Script[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(query.limit ?? 100)));
  const conditions = [
    query.brandId ? eq(scripts.brandId, query.brandId) : undefined,
    query.status ? eq(scripts.status, query.status) : undefined,
  ].filter((c): c is SQL => c !== undefined);
  return db
    .select()
    .from(scripts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(scripts.updatedAt), desc(scripts.id))
    .limit(limit);
}

/**
 * Replace a script's body (and optionally its title/language) after `validate`
 * accepts it; null if the script does not exist.
 */
export async function updateScriptBody(
  id: number,
  body: unknown,
  validate: ScriptBodyValidator,
  patch: { title?: string; language?: string; expectedBody?: unknown } = {},
): Promise<Script | null> {
  checkBody(body, validate);
  const [row] = await updateReturning(
    db,
    scripts,
    {
      body,
      ...(patch.title !== undefined ? { title: checkTitle(patch.title) } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      updatedAt: sql`now()`,
    },
    and(
      eq(scripts.id, id),
      patch.expectedBody === undefined ? undefined : eq(scripts.body, patch.expectedBody),
    ),
  );
  return row ?? null;
}

/**
 * Move a script to `status`, stamping `recorded_at`/`posted_at`; null if the
 * script does not exist.
 *
 * One UPDATE with CASEs, no read-then-write (the same shape as the ideas
 * `posted` PATCH): a timestamp is set on the way in, kept on a repeat, and
 * cleared on the way back out, so it always describes the current status.
 * `posted` implies recorded, so going straight to `posted` stamps both.
 */
export async function setScriptStatus(id: number, status: ScriptStatus): Promise<Script | null> {
  if (!(SCRIPT_STATUSES as readonly string[]).includes(status)) {
    throw new InvalidScriptError(
      `Unknown status "${status}". Expected one of: ${SCRIPT_STATUSES.join(", ")}.`,
    );
  }
  const recorded = status === "recorded" || status === "posted";
  const posted = status === "posted";
  const [row] = await updateReturning(
    db,
    scripts,
    {
      status,
      recordedAt: recorded ? sql`coalesce(${scripts.recordedAt}, now())` : null,
      postedAt: posted ? sql`coalesce(${scripts.postedAt}, now())` : null,
      updatedAt: sql`now()`,
    },
    eq(scripts.id, id),
  );
  return row ?? null;
}

// ---------------------------------------------------------------------------
// build 2b columns (ideas 6, 7, 10) — one setter each, no body validation:
// none of them touches the script body.
// ---------------------------------------------------------------------------

async function setColumns(
  id: number,
  values: Partial<typeof scripts.$inferInsert>,
): Promise<Script | null> {
  const [row] = await updateReturning(
    db,
    scripts,
    { ...values, updatedAt: sql`now()` },
    eq(scripts.id, id),
  );
  return row ?? null;
}

/** The published video's URL (idea 6), or null to clear it; null if the script does not exist. */
export async function setScriptYoutubeUrl(id: number, url: string | null): Promise<Script | null> {
  return setColumns(id, { youtubeUrl: url });
}

/**
 * The post-recording pack (idea 6), shape `PublishPack` in
 * src/lib/studio/types.ts — checked by its caller, opaque here like the body.
 */
export async function setScriptPublishPack(id: number, pack: unknown): Promise<Script | null> {
  return setColumns(id, { publishPack: pack });
}

/** The chosen thumbnail, a path under `media/<id>/thumbnails/` (idea 10), or null. */
export async function setScriptThumbnailFile(
  id: number,
  file: string | null,
): Promise<Script | null> {
  return setColumns(id, { thumbnailFile: file });
}

/** Link a short to the long script it was cut from (idea 7), or null to unlink. */
export async function setScriptParent(
  id: number,
  parentScriptId: number | null,
): Promise<Script | null> {
  return setColumns(id, { parentScriptId });
}

/** The shorts cut from a script, oldest first. */
export async function listChildScripts(parentScriptId: number): Promise<Script[]> {
  return db
    .select()
    .from(scripts)
    .where(eq(scripts.parentScriptId, parentScriptId))
    .orderBy(scripts.id);
}
