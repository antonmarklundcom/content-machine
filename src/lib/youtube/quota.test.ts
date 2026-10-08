import assert from "node:assert/strict";
import { test } from "node:test";
import { QuotaExhaustedError, QuotaTracker } from "./quota";

/**
 * The regression these guard: the poller built a YouTubeDataClient — and so a
 * QuotaTracker — per source. Each one started at zero, so the per-run guard
 * only ever saw a single source's usage. A run across many sources could burn
 * the whole daily allowance without the budget ever tripping.
 */

test("one tracker across many sources trips the budget", () => {
  const shared = new QuotaTracker(5);
  for (let i = 0; i < 5; i++) shared.charge("playlistItems.list");
  assert.throws(() => shared.charge("playlistItems.list"), QuotaExhaustedError);
  assert.equal(shared.unitsSpent, 5);
  assert.equal(shared.unitsRemaining, 0);
});

test("a fresh tracker per source never trips it — the bug, made explicit", () => {
  let spent = 0;
  for (let i = 0; i < 50; i++) {
    const perSource = new QuotaTracker(5);
    perSource.charge("playlistItems.list");
    perSource.charge("videos.list");
    spent += perSource.unitsSpent;
  }
  // 100 units really spent against Google's counter, and not one call refused.
  assert.equal(spent, 100);
});

test("charging is refused before the units are spent, not after", () => {
  const t = new QuotaTracker(50);
  assert.throws(() => t.charge("search.list"), QuotaExhaustedError);
  assert.equal(t.unitsSpent, 0, "a refused call must not be billed to the run");
});

test("summary reports the run total, so a shared tracker is auditable", () => {
  const t = new QuotaTracker(100);
  t.charge("channels.list");
  t.charge("playlistItems.list");
  t.charge("videos.list");
  const summary = t.summary();
  assert.match(summary, /^3u spent of 100u/);
  assert.match(summary, /channels\.list x1 = 1u/);
});
