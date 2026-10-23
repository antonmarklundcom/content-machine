import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clips } from "@/db/schema";
import { updateReturning } from "@/db/mutations";
import { withLease, withLeaseCommit } from "@/lib/lease";
import { clipWorkLease, CLIP_WORK_LEASE_TTL_MS } from "./work";

export const CLIP_INGEST_TIMEOUT_MINUTES = 15;
export const CLIP_INGEST_TIMEOUT_ERROR = "Ingest timed out — retry";

const staleClip = () =>
  and(
    eq(clips.status, "ingesting"),
    sql`coalesce(${clips.ingestStartedAt}, ${clips.savedAt}) < date_sub(current_timestamp(3), interval ${CLIP_INGEST_TIMEOUT_MINUTES} minute)`,
  );

/** Recover abandoned state without requiring monitoring or dispatching any work. */
export async function reapStuckClips(): Promise<number> {
  const candidates = await db
    .select({ id: clips.id })
    .from(clips)
    .where(staleClip())
    .orderBy(asc(clips.id))
    .limit(100);
  let recovered = 0;
  for (const { id } of candidates) {
    // A slow live worker renews this same lease, so age alone cannot steal it.
    const held = await withLease(clipWorkLease(id), CLIP_WORK_LEASE_TTL_MS, (lease) =>
      withLeaseCommit(lease, async (tx) => {
        const rows = await updateReturning(
          tx,
          clips,
          { status: "failed", error: CLIP_INGEST_TIMEOUT_ERROR },
          and(eq(clips.id, id), staleClip()),
          { id: clips.id },
        );
        return rows.length;
      }),
    );
    if (held.acquired) recovered += held.value;
  }
  return recovered;
}
