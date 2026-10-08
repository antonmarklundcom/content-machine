/**
 * [PR-35] Tests for the three pure halves of the gallring: what a score is
 * allowed to be, where the bar sits, and what the model is actually shown.
 *
 * The half that is not tested here is the one that spends money, and the
 * property these three protect is the one that matters most about it — the
 * gallring may only ever remove a video from a queue on the strength of a
 * judgement that actually came back and was actually readable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScreeningResponse } from "./parse";
import { DEFAULT_MIN_SCORE, isCulled, screenMinScore, screeningEnabled } from "./policy";
import { buildScreeningPrompt, MAX_DESCRIPTION_CHARS } from "./prompt";

const SUBJECT = {
  title: "How we cut our build time in half",
  channelTitle: "Some Channel",
  description: "Chapters:\n00:00 intro\n02:10 the profiler",
  publishedAt: new Date("2026-03-04T10:00:00Z"),
  durationSeconds: 2_460,
  viewCount: 40_000,
  likeCount: 3_100,
  commentCount: 210,
};

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

test("parses a well-formed screening", () => {
  const r = parseScreeningResponse(JSON.stringify({ score: 72, reason: "40 minutes on one fix" }));
  assert.ok(r.ok);
  assert.equal(r.payload.score, 72);
  assert.equal(r.payload.reason, "40 minutes on one fix");
});

test("strips fences and salvages an object wrapped in prose", () => {
  const fenced = parseScreeningResponse('```json\n{"score":10,"reason":"reaction video"}\n```');
  assert.ok(fenced.ok);
  assert.equal(fenced.payload.score, 10);

  const wrapped = parseScreeningResponse(
    'Sure!\n{"score":80,"reason":"named method"}\nHope that helps.',
  );
  assert.ok(wrapped.ok);
  assert.equal(wrapped.payload.score, 80);
});

test("accepts a numeric string and rounds a float", () => {
  const asString = parseScreeningResponse('{"score":"55","reason":"x"}');
  assert.ok(asString.ok);
  assert.equal(asString.payload.score, 55);

  const asFloat = parseScreeningResponse('{"score":72.5,"reason":"x"}');
  assert.ok(asFloat.ok);
  assert.equal(asFloat.payload.score, 73);
});

test("clamps a score outside 0-100 rather than rejecting it", () => {
  const high = parseScreeningResponse('{"score":120,"reason":"x"}');
  assert.ok(high.ok);
  assert.equal(high.payload.score, 100);

  const low = parseScreeningResponse('{"score":-40,"reason":"x"}');
  assert.ok(low.ok);
  assert.equal(low.payload.score, 0);
});

test("refuses a response with no usable score", () => {
  // The one case the analysis parser would have coerced. A guessed score culls
  // a video with a reason nobody wrote; no screening at all leaves it queued.
  for (const raw of ['{"reason":"looks good"}', '{"score":"high","reason":"x"}', "", "not json"]) {
    assert.equal(parseScreeningResponse(raw).ok, false, `expected refusal for: ${raw}`);
  }
});

test("survives a missing reason without losing the score", () => {
  const r = parseScreeningResponse('{"score":30}');
  assert.ok(r.ok);
  assert.equal(r.payload.score, 30);
  assert.equal(r.payload.reason, "");
});

test("truncates a reason to what the column holds", () => {
  const r = parseScreeningResponse(JSON.stringify({ score: 50, reason: "x".repeat(900) }));
  assert.ok(r.ok);
  assert.equal(r.payload.reason.length, 512);
});

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------

test("isCulled fails open on everything that is not a judgement", () => {
  assert.equal(isCulled(null, 50), false);
  assert.equal(isCulled(undefined, 50), false);
  assert.equal(isCulled({ status: "failed", score: null }, 50), false);
  // A failed row that somehow carries a score is still not a judgement.
  assert.equal(isCulled({ status: "failed", score: 3 }, 50), false);
  assert.equal(isCulled({ status: "ok", score: null }, 50), false);
});

test("the bar is exclusive — a score equal to it is kept", () => {
  assert.equal(isCulled({ status: "ok", score: 50 }, 50), false);
  assert.equal(isCulled({ status: "ok", score: 49 }, 50), true);
});

test("a bar of 0 culls nothing, which is what SCREEN_MIN_SCORE=0 promises", () => {
  assert.equal(isCulled({ status: "ok", score: 0 }, 0), false);
});

test("screenMinScore reads the env and refuses nonsense", () => {
  const original = process.env.SCREEN_MIN_SCORE;
  try {
    delete process.env.SCREEN_MIN_SCORE;
    assert.equal(screenMinScore(), DEFAULT_MIN_SCORE);

    process.env.SCREEN_MIN_SCORE = "70";
    assert.equal(screenMinScore(), 70);

    process.env.SCREEN_MIN_SCORE = "0";
    assert.equal(screenMinScore(), 0);

    for (const bad of ["-1", "101", "half", "NaN"]) {
      process.env.SCREEN_MIN_SCORE = bad;
      assert.throws(() => screenMinScore(), /SCREEN_MIN_SCORE/, `expected a throw for "${bad}"`);
    }
  } finally {
    if (original === undefined) delete process.env.SCREEN_MIN_SCORE;
    else process.env.SCREEN_MIN_SCORE = original;
  }
});

test("screening is on unless the env turns it off", () => {
  const original = process.env.SCREENING_ENABLED;
  try {
    delete process.env.SCREENING_ENABLED;
    assert.equal(screeningEnabled(), true);
    for (const off of ["0", "false", "off", "no", "OFF"]) {
      process.env.SCREENING_ENABLED = off;
      assert.equal(screeningEnabled(), false, `expected off for "${off}"`);
    }
    process.env.SCREENING_ENABLED = "1";
    assert.equal(screeningEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.SCREENING_ENABLED;
    else process.env.SCREENING_ENABLED = original;
  }
});

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

test("the prompt carries the metadata the screen is allowed to judge on", () => {
  const prompt = buildScreeningPrompt(SUBJECT);
  assert.match(prompt, /Title: How we cut our build time in half/);
  assert.match(prompt, /Channel: Some Channel/);
  assert.match(prompt, /Published: 2026-03-04/);
  assert.match(prompt, /Duration: 41:00/);
  assert.match(prompt, /Views: 40000/);
  assert.match(prompt, /02:10 the profiler/);
});

test("a hidden counter says so rather than reading as zero", () => {
  const prompt = buildScreeningPrompt({ ...SUBJECT, likeCount: null, commentCount: null });
  assert.match(prompt, /Likes: not published by the uploader/);
  assert.match(prompt, /Comments: not published by the uploader/);
  assert.doesNotMatch(prompt, /Likes: 0/);
});

test("an empty description is stated, not omitted", () => {
  const prompt = buildScreeningPrompt({ ...SUBJECT, description: null });
  assert.match(prompt, /the uploader wrote none/);
});

test("a link-farm description is truncated to a bounded cost", () => {
  const prompt = buildScreeningPrompt({ ...SUBJECT, description: "link ".repeat(20_000) });
  assert.ok(prompt.length < MAX_DESCRIPTION_CHARS + 1_000, `prompt was ${prompt.length} chars`);
  assert.match(prompt, /description truncated/);
});

test("interests are appended only when there are some", () => {
  assert.doesNotMatch(buildScreeningPrompt(SUBJECT), /The researcher describes/);
  assert.doesNotMatch(
    buildScreeningPrompt(SUBJECT, { interests: "   " }),
    /The researcher describes/,
  );
  const withInterests = buildScreeningPrompt(SUBJECT, { interests: "local SEO in Sweden" });
  assert.match(withInterests, /local SEO in Sweden/);
  // The statement goes last, where a model weights it most — same reasoning as
  // the language instruction in the analysis prompt (PR-22b).
  assert.ok(withInterests.indexOf("local SEO in Sweden") > withInterests.indexOf("Title:"));
});
