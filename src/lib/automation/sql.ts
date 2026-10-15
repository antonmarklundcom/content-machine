import { sql } from "drizzle-orm";
import { sources, videos } from "@/db/schema";
/** Automatic work only considers enabled sources, or untracked captures explicitly opted in. */
export function automaticVideoCondition(includeUntracked = false) {
  return sql`(exists (select 1 from ${sources} where ${sources.id} = ${videos.sourceId} and ${sources.active} = true)
    or (${includeUntracked} = true and ${videos.sourceId} is null))`;
}
