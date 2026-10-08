import { deleteReturning, insertReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { brands, lessons, type Lesson } from "@/db/schema";
import { InvalidLessonError } from "./lessons";

/**
 * The hooks library (PLAN.md §6.S18): the `hook`, `cta` and `caption_pattern`
 * lessons, which post generation reads (§1.46). It reuses `lessons` — no new
 * table — and adds what `bridge/lessons.ts` does not have: family scope.
 * Added by S18 as its own file (lane 2 reaches data only through here).
 */

export const HOOK_KINDS = ["hook", "cta", "caption_pattern"] as const;
export type HookKind = (typeof HOOK_KINDS)[number];

export function isHookKind(value: unknown): value is HookKind {
  return (HOOK_KINDS as readonly unknown[]).includes(value);
}

export type HooksQuery = {
  /** The brand's own hooks plus its family's shared ones. */
  brandId?: string;
  /** The family's shared hooks plus every member brand's own. */
  familyId?: string;
  kind?: HookKind;
  /** Default 300, max 1000. */
  limit?: number;
};

async function scope(query: HooksQuery): Promise<SQL | undefined> {
  if (query.brandId) {
    const [brand] = await db
      .select({ familyId: brands.familyId })
      .from(brands)
      .where(eq(brands.id, query.brandId))
      .limit(1);
    return brand?.familyId
      ? or(eq(lessons.brandId, query.brandId), eq(lessons.familyId, brand.familyId))
      : eq(lessons.brandId, query.brandId);
  }
  if (query.familyId) {
    const members = db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.familyId, query.familyId));
    return or(eq(lessons.familyId, query.familyId), inArray(lessons.brandId, members));
  }
  return undefined;
}

/** Hook-kind lessons, newest first, filtered by brand or family and kind. */
export async function listHooks(query: HooksQuery = {}): Promise<Lesson[]> {
  const limit = Math.min(1000, Math.max(1, Math.floor(query.limit ?? 300)));
  return db
    .select()
    .from(lessons)
    .where(
      and(
        query.kind ? eq(lessons.kind, query.kind) : inArray(lessons.kind, [...HOOK_KINDS]),
        await scope(query),
      ),
    )
    .orderBy(desc(lessons.createdAt), desc(lessons.id))
    .limit(limit);
}

export type NewHookInput = {
  text: string;
  kind: HookKind;
  /** At most one of brand and family; neither is portfolio-wide. */
  brandId?: string | null;
  familyId?: string | null;
  sourceUrl?: string | null;
};

/** Save one hook, CTA or caption pattern for a brand, a family, or everyone. */
export async function createHook(input: NewHookInput): Promise<Lesson> {
  const text = input.text.trim();
  if (!text) throw new InvalidLessonError("A hook needs some text.");
  if (!isHookKind(input.kind))
    throw new InvalidLessonError(`Unknown kind "${String(input.kind)}".`);
  const brandId = input.brandId?.trim() || null;
  const familyId = input.familyId?.trim() || null;
  if (brandId && familyId)
    throw new InvalidLessonError("A hook belongs to a brand or a family, not both.");
  const sourceUrl = input.sourceUrl?.trim() || null;
  if (sourceUrl && sourceUrl.length > 1024)
    throw new InvalidLessonError("The source URL is longer than 1024 characters.");
  const [row] = await insertReturning(db, lessons, {
    text,
    kind: input.kind,
    brandId,
    familyId,
    sourceUrl,
  });
  if (!row) throw new Error("Insert into lessons returned no row");
  return row;
}

/** Delete one hook-kind lesson; false when it is not one (other lessons stay on /lessons). */
export async function deleteHook(id: number): Promise<boolean> {
  const rows = await deleteReturning(
    db,
    lessons,
    and(eq(lessons.id, id), inArray(lessons.kind, [...HOOK_KINDS])),
    { id: lessons.id },
  );
  return rows.length > 0;
}
