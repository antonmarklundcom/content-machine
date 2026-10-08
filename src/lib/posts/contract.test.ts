import assert from "node:assert/strict";
import { test } from "node:test";

import { validatePostDraft } from "./contract";
import { sampleCarouselDraft, sampleReelDraft } from "./fixture";

/** The post contract (PLAN.md §1.46): strict, and says which field is wrong. */

function errorsOf(body: unknown): string[] {
  const verdict = validatePostDraft(body);
  return verdict.ok ? [] : verdict.errors;
}

test("complete v1 drafts are valid", () => {
  assert.deepEqual(validatePostDraft(sampleCarouselDraft()), { ok: true });
  assert.deepEqual(validatePostDraft(sampleReelDraft()), { ok: true });
});

test("a body that is not an object is refused with one readable error", () => {
  assert.deepEqual(errorsOf(null), ["body must be an object, got null"]);
});

test("a missing hook is named", () => {
  const body = sampleCarouselDraft() as Record<string, unknown>;
  delete body.hook;
  assert.deepEqual(errorsOf(body), ["body.hook is missing"]);
});

test("a carousel without slides is refused", () => {
  const body = sampleCarouselDraft();
  delete body.slides;
  assert.deepEqual(errorsOf(body), ["body.slides is required for a carousel"]);

  const one = sampleCarouselDraft();
  one.slides = one.slides!.slice(0, 1);
  assert.deepEqual(errorsOf(one), ["body.slides must have at least 2 items, has 1"]);
});

test("a reel without shots is refused", () => {
  const body = sampleReelDraft();
  body.shots = [];
  assert.deepEqual(errorsOf(body), ["body.shots is required for a reel"]);
});

test("an unknown engagement mechanic is refused", () => {
  const body = sampleCarouselDraft() as unknown as { engagement: Record<string, unknown> };
  body.engagement.mechanic = "giveaway";
  const errors = errorsOf(body);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /^body\.engagement\.mechanic must be one of "question", .* got "giveaway"$/,
  );
});

test("unknown fields, wrong positions, bad hashtags and bad URLs are each reported", () => {
  const body = sampleCarouselDraft() as unknown as Record<string, unknown>;
  body.extra = true;
  body.hashtags = ["#paraguay", "two words"];
  (body.slides as Array<Record<string, unknown>>)[1].n = 3;
  (body.sources as Array<Record<string, unknown>>)[0].url = "not a url";
  assert.deepEqual(errorsOf(body).sort(), [
    "body.extra is not a field of this contract",
    'body.hashtags[0] must be one word without "#", got "#paraguay"',
    'body.hashtags[1] must be one word without "#", got "two words"',
    "body.slides[1].n must be 2, got number 3",
    'body.sources[0].url must be an http(s) URL, got "not a url"',
  ]);
});

test("story frames take an optional sticker from the allowed set", () => {
  const story = {
    ...sampleReelDraft(),
    format: "story",
    shots: undefined,
    storyFrames: [{ n: 1, text: "Vote", sticker: "poll", visual: { prompt: "A map" } }],
  };
  delete (story as Record<string, unknown>).shots;
  assert.deepEqual(validatePostDraft(story), { ok: true });
  story.storyFrames[0].sticker = "countdown";
  assert.equal(errorsOf(story).length, 1);
});
