import { sql } from "drizzle-orm";
import { screenings, videos } from "@/db/schema";

/**
 * [PR-35] The gallring, as a SQL condition on `videos`.
 *
 * Lives here rather than in lib/analysis/run.ts so that the analysis layer can
 * depend on it without depending on the screening runtime — the Gemini
 * client, the spend gate, the prompt. It is also the one place the "fails open"
 * rule is written in SQL, and it has to match isCulled() in policy.ts exactly:
 * a row that only exists because a screening failed must not remove a video
 * from the work list.
 *
 * NOT EXISTS rather than a LEFT JOIN for the same reason as everywhere else in
 * this codebase — the callers paginate and count, and a join that can multiply
 * rows breaks both.
 */
export function notCulled(minScore: number) {
  return sql`not exists (
    select 1 from ${screenings} s
    where s.video_id = ${videos.id}
      and s.status = 'ok'
      and s.score is not null
      and s.score < ${minScore}
  )`;
}
