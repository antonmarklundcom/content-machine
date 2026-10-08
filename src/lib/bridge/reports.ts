import { insertReturning, queryRows } from "@/db/mutations";
import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";

import { competitorReports, type CompetitorReportRow } from "@/db/schema";
import type { CompetitorReport } from "@/lib/studio/types";

/**
 * Weekly competitor reports (build 2b, idea 1). Writes as well as reads, like
 * `research.ts` and `lessons.ts`: saving a report is this feature's write, and
 * lane 2 reaches data only through `src/lib/bridge/`.
 */

export type SavedReport = Omit<CompetitorReportRow, "body" | "costUsd"> & {
  body: CompetitorReport;
  costUsd: number;
};

function toSaved(row: CompetitorReportRow): SavedReport {
  return { ...row, body: row.body as CompetitorReport, costUsd: Number(row.costUsd) };
}

export async function saveCompetitorReport(input: {
  brandId: string;
  periodDays: number;
  body: CompetitorReport;
  costUsd: number;
}): Promise<SavedReport> {
  const [row] = await insertReturning(db, competitorReports, {
    brandId: input.brandId,
    periodDays: input.periodDays,
    body: input.body,
    costUsd: input.costUsd.toFixed(6),
  });
  if (!row) throw new Error("Insert into competitor_reports returned no row");
  return toSaved(row);
}

/** A brand's reports, newest first. */
export async function listCompetitorReports(brandId: string, limit = 20): Promise<SavedReport[]> {
  const rows = await db
    .select()
    .from(competitorReports)
    .where(eq(competitorReports.brandId, brandId))
    .orderBy(desc(competitorReports.createdAt), desc(competitorReports.id))
    .limit(Math.min(100, Math.max(1, limit)));
  return rows.map(toSaved);
}

export async function getCompetitorReport(id: number): Promise<SavedReport | null> {
  const [row] = await db
    .select()
    .from(competitorReports)
    .where(eq(competitorReports.id, id))
    .limit(1);
  return row ? toSaved(row) : null;
}

/** Ids of active brands that have at least one linked competitor/inspiration channel. */
export async function brandIdsWithCompetitors(): Promise<string[]> {
  const result = await queryRows<{ brand_id: string }>(
    db,
    sql`
    select distinct bs.brand_id
    from brand_sources bs
    join brands b on b.id = bs.brand_id and b.active
    order by bs.brand_id
  `,
  );
  return result.map((r) => String(r.brand_id));
}
