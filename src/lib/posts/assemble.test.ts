import assert from "node:assert/strict";
import { test } from "node:test";

import { assemblePostDraft, cleanHashtags, mergeSection, type RawPostDraft } from "./assemble";
import { validatePostDraft } from "./contract";
import { sampleCarouselDraft } from "./fixture";

function raw(): RawPostDraft {
  return {
    hook: " Hook ",
    caption: "Caption",
    cta: "Save it",
    hashtags: ["#One", "two words", "one", ""],
    firstComment: "  ",
    engagement: { mechanic: "save", detail: "Save for later" },
    slides: [
      { headline: "A", visualPrompt: "p1" },
      { headline: "B", body: "b", visualPrompt: "p2", textOverlay: "t" },
    ],
    shots: [{ seconds: 3, imagePrompt: "i", videoPrompt: "v" }],
    storyFrames: [{ text: "Q?", sticker: "poll", visualPrompt: "s" }],
    sources: [
      { claim: "Good", url: "https://example.com/a" },
      { claim: "Bad", url: "see guide" },
      { claim: "Good", url: "https://example.com/a" },
    ],
  };
}

test("a carousel keeps its slides, numbered, and drops the other lists", () => {
  const draft = assemblePostDraft(raw(), { format: "carousel", language: "es" });
  assert.equal(draft.version, 1);
  assert.equal(draft.language, "es");
  assert.equal(draft.hook, "Hook");
  assert.deepEqual(
    draft.slides?.map((s) => [s.n, s.headline, s.body, s.visual.textOverlay]),
    [
      [1, "A", "", ""],
      [2, "B", "b", "t"],
    ],
  );
  assert.equal(draft.shots, undefined);
  assert.equal(draft.storyFrames, undefined);
  assert.equal(draft.firstComment, undefined, "blank optional text is left out");
  assert.ok(validatePostDraft(draft).ok);
});

test("sources without a URL become an UNSOURCED note; duplicates collapse", () => {
  const draft = assemblePostDraft(raw(), { format: "carousel", language: "en" });
  assert.deepEqual(draft.sources, [{ claim: "Good", url: "https://example.com/a" }]);
  assert.equal(draft.notes, "UNSOURCED — verify or cut: Bad");
});

test("each format keeps its own list; an image post is one slide; text has none", () => {
  assert.equal(assemblePostDraft(raw(), { format: "reel", language: "en" }).shots?.length, 1);
  assert.equal(
    assemblePostDraft(raw(), { format: "story", language: "en" }).storyFrames?.[0].sticker,
    "poll",
  );
  assert.equal(
    assemblePostDraft(raw(), { format: "image_post", language: "en" }).slides?.length,
    1,
  );
  const text = assemblePostDraft(raw(), { format: "text", language: "en" });
  assert.equal(text.slides ?? text.shots ?? text.storyFrames, undefined);
  assert.ok(validatePostDraft(text).ok);
});

test("what cannot be repaired is left for the validator", () => {
  const one = { ...raw(), slides: raw().slides!.slice(0, 1) };
  const verdict = validatePostDraft(assemblePostDraft(one, { format: "carousel", language: "en" }));
  assert.equal(verdict.ok, false);
});

test("hashtags lose # and spaces, dedupe case-insensitively, cap at 30", () => {
  assert.deepEqual(cleanHashtags(["#One", "two words", "one", ""]), ["One", "twowords"]);
  assert.equal(cleanHashtags(Array.from({ length: 40 }, (_, i) => `t${i}`)).length, 30);
});

test("mergeSection takes one section and adds new sources", () => {
  const current = sampleCarouselDraft();
  const fresh = {
    ...sampleCarouselDraft(),
    hook: "New hook",
    caption: "Other caption",
    sources: [{ claim: "New", url: "https://example.com/new" }],
  };
  const merged = mergeSection(current, fresh, "hook");
  assert.equal(merged.hook, "New hook");
  assert.equal(merged.caption, current.caption);
  assert.deepEqual(
    merged.sources.map((s) => s.claim),
    ["Residency takes months", "New"],
  );
  const noComment = mergeSection(current, { ...fresh, firstComment: undefined }, "firstComment");
  assert.equal("firstComment" in noComment, false);
});
