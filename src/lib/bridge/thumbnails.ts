import { updateReturning } from "@/db/mutations";
import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { scripts, type Script } from "@/db/schema";

/**
 * The thumbnail Anton picked for a script (build 2b, idea 10): a path under
 * `media/<id>/thumbnails/`, or null to clear it. The caller checks the file
 * exists; this only writes the column. Null if the script does not exist.
 */
export async function setScriptThumbnail(id: number, file: string | null): Promise<Script | null> {
  const [row] = await updateReturning(
    db,
    scripts,
    { thumbnailFile: file, updatedAt: sql`current_timestamp(3)` },
    eq(scripts.id, id),
  );
  return row ?? null;
}
