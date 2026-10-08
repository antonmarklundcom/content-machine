import assert from "node:assert/strict";
import { test } from "node:test";

import {
  baselineSample,
  median,
  OUTLIER_BASELINE_SIZE,
  outlierScore,
  outlierScores,
  type OutlierRow,
} from "./outlier";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

function row(
  id: number,
  viewCount: number | null,
  publishedDay: number | null,
  sourceId = 1,
): OutlierRow {
  return { id, sourceId, viewCount, publishedAt: publishedDay === null ? null : day(publishedDay) };
}

test("median: odd, even, empty, unsorted input left untouched", () => {
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5, "mean of the two middle values, like percentile_cont");
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test("fewer than 5 baseline videos → null", () => {
  assert.equal(outlierScore(1000, [100, 100, 100, 100]), null);
  assert.equal(outlierScore(1000, [100, 100, 100, 100, 100]), 10);
});

test("zero-view median → null, not Infinity", () => {
  assert.equal(outlierScore(500, [0, 0, 0, 10, 20]), null);
  assert.equal(outlierScore(0, [0, 0, 0, 0, 0]), null);
});

test("unknown view count → null; zero views against a real baseline → 0", () => {
  assert.equal(outlierScore(null, [10, 10, 10, 10, 10]), null);
  assert.equal(outlierScore(0, [10, 10, 10, 10, 10]), 0);
});

test("ties: equal view counts give an exact median", () => {
  assert.equal(outlierScore(300, [100, 100, 100, 100, 100, 100]), 3);
  assert.equal(outlierScore(300, [50, 100, 100, 100, 100, 200]), 3);
});

test("ties: equal publish dates break by the higher id, so the 30-video cut is stable", () => {
  // 31 videos on the same day: the lowest id is the one left out.
  const rows = Array.from({ length: OUTLIER_BASELINE_SIZE + 1 }, (_, i) =>
    row(i + 1, i === 0 ? 1_000_000 : 10, 5),
  );
  const sample = baselineSample(rows);
  assert.equal(sample.length, OUTLIER_BASELINE_SIZE);
  assert.ok(!sample.includes(1_000_000), "id 1 is the oldest by tiebreak and falls outside");
  // Same result whatever order the rows arrive in.
  assert.deepEqual(baselineSample([...rows].reverse()), sample);
});

test("baseline is the last 30 by publish date; hidden counters and unknown dates handled", () => {
  const rows: OutlierRow[] = [
    // 30 recent videos at 100 views…
    ...Array.from({ length: 30 }, (_, i) => row(i + 1, 100, 100 + i)),
    // …an old viral one that must not move the baseline…
    row(100, 5_000_000, 1),
    // …one with no date, sorted after every dated one…
    row(101, 9_999_999, null),
    // …and one with a hidden counter, never part of the sample.
    row(102, null, 200),
  ];
  const sample = baselineSample(rows);
  assert.equal(sample.length, 30);
  assert.ok(sample.every((v) => v === 100));

  const scores = outlierScores(rows);
  assert.equal(scores.get(100), 50_000);
  assert.equal(scores.get(1), 1);
  assert.equal(scores.get(102), null);
});

test("each channel is scored against its own baseline; no source → null", () => {
  const rows: OutlierRow[] = [
    ...[10, 10, 10, 10, 50].map((v, i) => row(i + 1, v, i, 1)),
    ...[1000, 1000, 1000, 1000, 1000].map((v, i) => row(i + 11, v, i, 2)),
    { id: 99, sourceId: null, viewCount: 1_000_000, publishedAt: day(0) },
  ];
  const scores = outlierScores(rows);
  assert.equal(scores.get(5), 5);
  assert.equal(scores.get(11), 1);
  assert.equal(scores.get(99), null);
});
