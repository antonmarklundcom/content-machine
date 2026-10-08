/**
 * Outlier score (PLAN.md §1.30): how far a video beat its own channel.
 *
 *   score = video views / median views of the channel's last 30 stored videos
 *
 * Pure math on rows already in `videos` — no API call, no clock. A channel with
 * fewer than 5 videos that carry a view count has no baseline worth dividing
 * by, so it scores nothing (null) rather than a noisy number.
 *
 * `bridge/research.ts` computes the same thing in one SQL statement per brand
 * (`percentile_cont(0.5)` over a `row_number()` window). This module is the
 * reference both are tested against, so the two definitions below — which
 * videos form the baseline, and what "median" means — are the contract:
 *
 *  - **Baseline sample:** the channel's videos that have a view count (a
 *    hidden counter is unknown, not zero), newest `published_at` first with
 *    unknown dates last, ties broken by the higher id, first 30 of them.
 *  - **Median:** the middle value, or the mean of the two middle values for an
 *    even count — exactly `percentile_cont(0.5)`.
 */

/** How many of a channel's most recent videos form its baseline. */
export const OUTLIER_BASELINE_SIZE = 30;

/** Fewer videos than this with a view count → no score. */
export const OUTLIER_MIN_SAMPLE = 5;

/** The columns the score needs, nothing more. */
export type OutlierRow = {
  id: number;
  sourceId: number | null;
  viewCount: number | null;
  publishedAt: Date | null;
};

/** The median of `values`; null for an empty list. Mean of the middle two for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * `views / baselineMedian`, or null when there is no fair answer: the video's
 * own count is unknown, the baseline is too small, or its median is zero (a
 * channel whose typical video has no views makes every view infinite).
 */
export function outlierScore(
  views: number | null,
  baselineViews: readonly number[],
): number | null {
  if (views === null) return null;
  if (baselineViews.length < OUTLIER_MIN_SAMPLE) return null;
  const m = median(baselineViews);
  if (m === null || m <= 0) return null;
  return views / m;
}

/** Newest first, unknown dates last, higher id first on a tie — the SQL window's order. */
function byRecency(a: OutlierRow, b: OutlierRow): number {
  const at = a.publishedAt?.getTime();
  const bt = b.publishedAt?.getTime();
  if (at !== bt) {
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    return bt - at;
  }
  return b.id - a.id;
}

/** One channel's baseline sample: its most recent videos with a known view count. */
export function baselineSample(channelRows: readonly OutlierRow[]): number[] {
  return channelRows
    .filter((row) => row.viewCount !== null)
    .sort(byRecency)
    .slice(0, OUTLIER_BASELINE_SIZE)
    .map((row) => row.viewCount as number);
}

/**
 * Score every row against its own channel's baseline. Rows with no
 * `sourceId` have no channel to compare with and score null.
 */
export function outlierScores(rows: readonly OutlierRow[]): Map<number, number | null> {
  const byChannel = new Map<number, OutlierRow[]>();
  for (const row of rows) {
    if (row.sourceId === null) continue;
    const list = byChannel.get(row.sourceId) ?? [];
    list.push(row);
    byChannel.set(row.sourceId, list);
  }
  const baselines = new Map<number, number[]>();
  for (const [sourceId, list] of byChannel) baselines.set(sourceId, baselineSample(list));

  const scores = new Map<number, number | null>();
  for (const row of rows) {
    const baseline = row.sourceId === null ? [] : (baselines.get(row.sourceId) ?? []);
    scores.set(row.id, outlierScore(row.viewCount, baseline));
  }
  return scores;
}
