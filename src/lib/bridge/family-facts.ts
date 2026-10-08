import { insertIfAbsent } from "@/db/mutations";
import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { facts } from "@/db/schema";

/**
 * The facts import's one write (PLAN.md §1.48, §6.S18): upsert a family's
 * imported facts by (family_id, external_key, language). Added by S18 as its
 * own file so lane 2 keeps reaching data only through this directory.
 *
 * Same `updatedAt` rule as `bridge/facts.ts`: only a new claim or a new source
 * bumps it, because that is what flags a posted script as out of date. A row
 * that would not change is not written at all, so a re-run is a no-op.
 */

export type FamilyFactRow = {
  externalKey: string;
  language: string;
  topic: string;
  claim: string;
  verified: boolean;
  sourceUrl: string | null;
  notes: string | null;
  /** When the source says it was last checked; null keeps the row's own date (or now, on insert). */
  lastCheckedAt: Date | null;
};

export type FactUpsertResult = { inserted: number; updated: number; unchanged: number };

export async function upsertFamilyFacts(
  familyId: string,
  rows: FamilyFactRow[],
): Promise<FactUpsertResult> {
  const result: FactUpsertResult = { inserted: 0, updated: 0, unchanged: 0 };
  if (rows.length === 0) return result;

  // No transaction: neon-http has none, and every write below is idempotent on re-run.
  const existing = await db
    .select()
    .from(facts)
    .where(and(eq(facts.familyId, familyId), isNotNull(facts.externalKey)));
  const byKey = new Map(existing.map((f) => [`${f.externalKey}\u0000${f.language}`, f]));

  for (const row of rows) {
    const current = byKey.get(`${row.externalKey}\u0000${row.language}`);
    if (!current) {
      const inserted = await insertIfAbsent(
        db,
        facts,
        {
          familyId,
          brandId: null,
          externalKey: row.externalKey,
          language: row.language,
          topic: row.topic,
          claim: row.claim,
          verified: row.verified,
          sourceUrl: row.sourceUrl,
          notes: row.notes,
          ...(row.lastCheckedAt ? { lastCheckedAt: row.lastCheckedAt } : {}),
        },
        {},
        { id: facts.id },
      );
      if (inserted.length) result.inserted++;
      else result.unchanged++;
      continue;
    }
    const contentChanged =
      current.claim !== row.claim || (current.sourceUrl ?? null) !== row.sourceUrl;
    const checkedChanged =
      row.lastCheckedAt !== null && current.lastCheckedAt.getTime() !== row.lastCheckedAt.getTime();
    const changed =
      contentChanged ||
      checkedChanged ||
      current.topic !== row.topic ||
      current.verified !== row.verified ||
      (current.notes ?? null) !== row.notes;
    if (!changed) {
      result.unchanged++;
      continue;
    }
    await db
      .update(facts)
      .set({
        topic: row.topic,
        claim: row.claim,
        verified: row.verified,
        sourceUrl: row.sourceUrl,
        notes: row.notes,
        ...(row.lastCheckedAt ? { lastCheckedAt: row.lastCheckedAt } : {}),
        ...(contentChanged ? { updatedAt: sql`now()` } : {}),
      })
      .where(eq(facts.id, current.id));
    result.updated++;
  }
  return result;
}
