import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLikeRate, likesPerThousandViews, slugify } from "./format";

/**
 * [PR-33] The engagement ratio.
 *
 * The interesting cases are all absence, not arithmetic: YouTube omits a
 * counter the uploader hides, and treating that as zero would rank a private
 * channel below a dead one.
 */

test("likes per thousand views is the like count scaled against reach", () => {
  assert.equal(likesPerThousandViews(500, 10_000), 50);
  assert.equal(likesPerThousandViews(1, 1000), 1);
});

test("a hidden like count is not a zero like count", () => {
  // Null in, null out — the UI omits the figure rather than claiming nobody
  // liked the video. A zero *is* meaningful and must survive.
  assert.equal(likesPerThousandViews(null, 10_000), null);
  assert.equal(likesPerThousandViews(500, null), null);
  assert.equal(likesPerThousandViews(0, 10_000), 0);
});

test("a video nobody has watched has no ratio rather than an infinite one", () => {
  // Guarding this is the whole reason the helper exists: x / 0 is Infinity in
  // JavaScript, and Intl renders Infinity as "∞" without complaint.
  assert.equal(likesPerThousandViews(5, 0), null);
  assert.equal(formatLikeRate(5, 0), "—");
});

test("precision follows magnitude, so small rates stay distinguishable", () => {
  // Real values cluster between 10 and 60 per thousand. Below 10 the first
  // decimal is the only thing separating two videos.
  assert.equal(formatLikeRate(38, 10_000, "en"), "3.8");
  assert.equal(formatLikeRate(500, 10_000, "en"), "50");
});

test("formatting follows the UI locale", () => {
  // Swedish uses a decimal comma; the point of PR-22 was that numbers leak the
  // original language even when every string is translated.
  assert.equal(formatLikeRate(38, 10_000, "sv"), "3,8");
});

test("slugify makes a safe, bounded name and never an empty one", () => {
  assert.equal(slugify("Residência Permanente: ¿cómo?"), "residencia-permanente-como");
  assert.equal(slugify("a".repeat(80)).length, 60);
  assert.equal(slugify("word ".repeat(20), { max: 12 }), "word-word-wo");
  assert.equal(slugify("hello-world--", { max: 6 }), "hello");
  assert.equal(slugify("!!!"), "untitled");
  assert.equal(slugify("", { fallback: "file" }), "file");
});
