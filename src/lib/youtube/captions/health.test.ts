import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FAILURE_THRESHOLD,
  StrategyHealth,
  configuredFailureThreshold,
  resetRunHealth,
  runHealth,
  summariseHealth,
} from "./health";
import type { CaptionFailureReason, CaptionResult, StrategyName, StrategyOutcome } from "./types";

/**
 * The behaviour under test is a cost guard: on a host YouTube refuses, the
 * difference between retiring a dead strategy and not is six timeouts per video
 * for the length of the run. These tests pin both halves — that it retires when
 * it should, and that it does NOT retire on the failures that are properties of
 * a video rather than of the network path.
 */

function fail(strategy: StrategyName, reason: CaptionFailureReason = "blocked"): StrategyOutcome {
  return { ok: false, strategy, reason, stage: "list", error: reason, ms: 1, trackCount: 0 };
}

function ok(strategy: StrategyName): StrategyOutcome {
  const result = {
    strategy,
    languageCode: "en",
    kind: "asr",
    segments: [{ start: 0, dur: 1, text: "hi" }],
    text: "hi",
    wordCount: 1,
  } satisfies CaptionResult;
  return { ok: true, strategy, result, ms: 1, trackCount: 1 };
}

const ALL: StrategyName[] = [
  "innertube-android",
  "innertube-ios",
  "innertube-tv",
  "innertube-web",
  "watch-page",
  "youtubei-lib",
];

test("a strategy survives fewer than N consecutive failures", () => {
  const health = new StrategyHealth();
  for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD - 1; i++) {
    health.record(fail("innertube-android"));
  }
  assert.equal(health.isLive("innertube-android"), true);
  assert.deepEqual(health.live(ALL), ALL);
});

test("a strategy is retired on the Nth consecutive failure and stays retired", () => {
  const health = new StrategyHealth();
  for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD; i++) health.record(fail("innertube-android"));

  assert.equal(health.isLive("innertube-android"), false);
  assert.deepEqual(health.retired(), ["innertube-android"]);
  assert.equal(health.live(ALL).includes("innertube-android"), false);

  // Nothing un-retires it: retirement is for the rest of the run.
  health.record(ok("innertube-android"));
  assert.equal(health.isLive("innertube-android"), false);
});

test("one success resets the streak, so failures must be consecutive", () => {
  const health = new StrategyHealth();
  health.record(fail("watch-page"));
  health.record(fail("watch-page"));
  health.record(ok("watch-page"));
  health.record(fail("watch-page"));
  health.record(fail("watch-page"));

  assert.equal(health.isLive("watch-page"), true, "five failures, but never three in a row");
});

test("no_captions counts as contact, not failure", () => {
  const health = new StrategyHealth();
  // A run that opens on caption-less videos must not retire a working strategy:
  // the strategy reached YouTube and got a straight answer every time.
  for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD * 2; i++) {
    health.record(fail("innertube-ios", "no_captions"));
  }
  assert.equal(health.isLive("innertube-ios"), true);
});

test("no_captions between failures breaks the streak", () => {
  const health = new StrategyHealth();
  health.record(fail("innertube-ios"));
  health.record(fail("innertube-ios"));
  health.record(fail("innertube-ios", "no_captions"));
  health.record(fail("innertube-ios"));

  assert.equal(health.isLive("innertube-ios"), true);
});

test("an 'unavailable' strategy is retired immediately", () => {
  const health = new StrategyHealth();
  // youtubei.js missing does not become present on the next video, so waiting
  // for two more failures would only buy latency.
  health.record(fail("youtubei-lib", "unavailable"));
  assert.equal(health.isLive("youtubei-lib"), false);
});

test("failures are tracked per strategy, not globally", () => {
  const health = new StrategyHealth();
  for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD; i++) health.record(fail("watch-page"));

  assert.equal(health.isLive("watch-page"), false);
  assert.equal(health.isLive("innertube-android"), true);
});

test("live() preserves the caller's order and never adds to it", () => {
  const health = new StrategyHealth();
  for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD; i++) health.record(fail("innertube-ios"));

  // The caller's list is CAPTION_STRATEGIES: a floor health can prune but not widen.
  const allowlist: StrategyName[] = ["watch-page", "innertube-ios", "innertube-android"];
  assert.deepEqual(health.live(allowlist), ["watch-page", "innertube-android"]);
});

test("threshold 0 disables retirement entirely", () => {
  const health = new StrategyHealth({ threshold: 0 });
  for (let i = 0; i < 20; i++) health.record(fail("innertube-web"));

  assert.equal(health.isLive("innertube-web"), true);
  assert.deepEqual(health.retired(), []);
});

test("a custom threshold is honoured", () => {
  const health = new StrategyHealth({ threshold: 1 });
  health.record(fail("innertube-tv"));
  assert.equal(health.isLive("innertube-tv"), false);
});

test("a nonsense threshold falls back to the default rather than retiring nothing", () => {
  const health = new StrategyHealth({ threshold: Number.NaN });
  assert.equal(health.threshold, DEFAULT_FAILURE_THRESHOLD);
});

test("the snapshot reports attempts, successes and the retiring reason", () => {
  const health = new StrategyHealth();
  health.record(ok("innertube-android"));
  health.record(fail("innertube-android", "network"));
  health.record(fail("innertube-android", "network"));
  health.record(fail("innertube-android", "blocked"));

  const [row] = health.snapshot();
  assert.equal(row?.strategy, "innertube-android");
  assert.equal(row?.attempts, 4);
  assert.equal(row?.successes, 1);
  assert.equal(row?.consecutiveFailures, 3);
  assert.equal(row?.retired, true);
  assert.equal(row?.lastReason, "blocked");
});

test("summariseHealth is empty until something has been attempted", () => {
  assert.equal(summariseHealth([]), "");

  const health = new StrategyHealth();
  health.record(ok("watch-page"));
  assert.match(health.summary(), /watch-page: 1\/1 ok/);

  for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD; i++) health.record(fail("innertube-tv"));
  assert.match(health.summary(), /innertube-tv: retired after 3 \(blocked\)/);
});

test("configuredFailureThreshold reads the env, with the default as the floor", () => {
  const previous = process.env.CAPTION_FAILURE_THRESHOLD;
  try {
    delete process.env.CAPTION_FAILURE_THRESHOLD;
    assert.equal(configuredFailureThreshold(), DEFAULT_FAILURE_THRESHOLD);

    process.env.CAPTION_FAILURE_THRESHOLD = "5";
    assert.equal(configuredFailureThreshold(), 5);

    process.env.CAPTION_FAILURE_THRESHOLD = "0";
    assert.equal(configuredFailureThreshold(), 0, "0 is a real setting, not a missing one");

    // A typo must not silently mean "never retire anything" — that is the
    // expensive direction to be wrong in.
    process.env.CAPTION_FAILURE_THRESHOLD = "three";
    assert.equal(configuredFailureThreshold(), DEFAULT_FAILURE_THRESHOLD);

    process.env.CAPTION_FAILURE_THRESHOLD = "-2";
    assert.equal(configuredFailureThreshold(), DEFAULT_FAILURE_THRESHOLD);

    process.env.CAPTION_FAILURE_THRESHOLD = "  ";
    assert.equal(configuredFailureThreshold(), DEFAULT_FAILURE_THRESHOLD);
  } finally {
    if (previous === undefined) delete process.env.CAPTION_FAILURE_THRESHOLD;
    else process.env.CAPTION_FAILURE_THRESHOLD = previous;
  }
});

test("runHealth is one tracker per process, and resettable", () => {
  resetRunHealth();
  const first = runHealth();
  first.record(fail("watch-page"));
  assert.equal(runHealth(), first, "the run must share one tracker, or nothing accumulates");
  assert.equal(runHealth().snapshot()[0]?.attempts, 1);

  resetRunHealth();
  assert.notEqual(runHealth(), first);
  assert.deepEqual(runHealth().snapshot(), []);
});
