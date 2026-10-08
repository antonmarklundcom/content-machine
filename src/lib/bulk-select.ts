/**
 * Parsing for the feed's bulk-selection form (PR-28).
 *
 * Its own module rather than a helper inside `analyze.actions.ts` because a
 * "use server" file may only export async functions — and because this is the
 * boundary between a public form post and a batch submission that spends money,
 * which is worth testing directly.
 */

/** Refuses more than this in one submission — a slip of "select all" on a huge feed. */
export const BULK_ANALYZE_LIMIT = 200;

/**
 * Video ids from repeated `videoId` form fields: positive integers only,
 * deduped, order preserved.
 *
 * Junk is dropped rather than throwing. A form post is a public endpoint, so
 * "12; drop table videos", "3.5" and "-1" all have to become nothing at all,
 * and a duplicated id must not be able to double-submit a video into one batch.
 */
export function parseVideoIds(values: Array<FormDataEntryValue | string>): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    // Number("") is 0 and Number(" 4 ") is 4 — neither is a form field a user
    // ticked, so the shape is checked before the value is.
    if (!/^\d+$/.test(trimmed)) continue;
    const id = Number(trimmed);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}
