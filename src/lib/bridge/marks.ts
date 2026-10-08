import "server-only";
import { listMarks, type MarksPage, type MarksQuery } from "@/lib/marks";

/**
 * A user's marked units with their video context (PLAN.md §5.O1.4).
 *
 * This is a re-export, not a reimplementation: `lib/marks.ts` already answers
 * exactly this question for the `/youtube/marks` page, and a second query with
 * the same job would drift from it. What the bridge adds is the promise that
 * the shape stays available under this name — if the marks page's own needs
 * ever change, this is where the compatible version lives.
 */
export async function listMarkedUnits(query: MarksQuery): Promise<MarksPage> {
  return listMarks(query);
}

export type { MarksPage, MarksQuery, MarkedUnit } from "@/lib/marks";
export { MARKS_PAGE_SIZE } from "@/lib/marks";
