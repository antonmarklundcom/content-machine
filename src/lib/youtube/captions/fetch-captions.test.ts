import assert from "node:assert/strict";
import { test } from "node:test";
import { STRATEGY_ORDER, fetchCaptions } from "./index";
import { StrategyHealth, resetRunHealth, runHealth } from "./health";
import type { CaptionFailureReason, StrategyName, StrategyOutcome } from "./types";

/**
 * These cover the branch where health tracking has already retired everything —
 * the one that must make no network call at all, since that is where the saving
 * on a blocked host actually lands. Everything else in fetchCaptions talks to
 * YouTube and belongs to `npm run yt:probe-captions`, not to the test suite.
 */

function fail(strategy: StrategyName, reason: CaptionFailureReason = "blocked"): StrategyOutcome {
  return { ok: false, strategy, reason, stage: "list", error: reason, ms: 1, trackCount: 0 };
}

function exhausted(reason: CaptionFailureReason, strategies: readonly StrategyName[]) {
  const health = new StrategyHealth({ threshold: 1 });
  for (const strategy of strategies) health.record(fail(strategy, reason));
  return health;
}

test("every strategy retired means no attempt is made at all", async () => {
  const health = exhausted("blocked", STRATEGY_ORDER);

  const result = await fetchCaptions("dQw4w9WgXcQ", { health });

  assert.equal(result.ok, false);
  assert.deepEqual(result.attempts, [], "a retired run must cost nothing");
  assert.deepEqual(result.skipped, STRATEGY_ORDER);
});

test("a fully blocked run keeps reporting 'blocked' after retirement", async () => {
  // The caller writes this reason into the video's error text; degrading it to a
  // generic failure would hide the datacenter-IP diagnosis behind a clean run.
  const result = await fetchCaptions("dQw4w9WgXcQ", {
    health: exhausted("blocked", STRATEGY_ORDER),
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "blocked");
});

test("retirement for non-block reasons reports 'error', not 'blocked'", async () => {
  const result = await fetchCaptions("dQw4w9WgXcQ", {
    health: exhausted("parse", STRATEGY_ORDER),
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "error");
});

test("skipped lists only the allowlisted candidates, never the full order", async () => {
  const allowlist: StrategyName[] = ["innertube-android", "watch-page"];

  const result = await fetchCaptions("dQw4w9WgXcQ", {
    strategies: allowlist,
    health: exhausted("blocked", STRATEGY_ORDER),
  });

  assert.deepEqual(result.skipped, allowlist);
});

test("the process-wide tracker is the default, so callers get it for free", async () => {
  // The poller and the CLI scripts pass no tracker. If the default were a fresh
  // one per call, nothing would ever accumulate and the saving would not exist.
  resetRunHealth();
  const health = runHealth();
  for (const strategy of STRATEGY_ORDER) {
    for (let i = 0; i < health.threshold; i++) health.record(fail(strategy));
  }

  try {
    const result = await fetchCaptions("dQw4w9WgXcQ");
    assert.deepEqual(result.attempts, []);
    assert.deepEqual(result.skipped, STRATEGY_ORDER);
  } finally {
    resetRunHealth();
  }
});
