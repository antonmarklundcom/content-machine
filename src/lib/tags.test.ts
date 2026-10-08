import assert from "node:assert/strict";
import { test } from "node:test";
import { slugifyTag } from "./tags";

/**
 * [PR-34] The slug is the match key, so this function decides how coarse the
 * grouping is. Every case below is a way a corpus of open-ended tags fragments
 * into shelves of one.
 */

test("case and surrounding whitespace never split a shelf", () => {
  assert.equal(slugifyTag("Local SEO"), slugifyTag("  local seo  "));
});

test("punctuation is dropped, so a tool's dotted name matches its plain one", () => {
  // The single most common fragmenter: half the corpus writes "Next.js" and
  // half writes "nextjs".
  assert.equal(slugifyTag("Next.js"), "next-js");
  assert.equal(slugifyTag("next js"), "next-js");
  assert.equal(slugifyTag("Node.js!"), "node-js");
});

test("accents fold, so Swedish and Spanish tags match their unaccented spelling", () => {
  assert.equal(slugifyTag("café"), "cafe");
  assert.equal(slugifyTag("Söderberg"), "soderberg");
});

test("distinct subjects stay distinct", () => {
  // Under-merging is recoverable by hand; over-merging silently destroys the
  // distinction and nobody notices.
  assert.notEqual(slugifyTag("local seo"), slugifyTag("technical seo"));
  assert.notEqual(slugifyTag("AI video"), slugifyTag("AI voice"));
});

test("leading and trailing separators never survive into the key", () => {
  // "-local-seo-" and "local-seo" would be two rows in a table whose whole job
  // is to be one.
  assert.equal(slugifyTag("...Local SEO!!!"), "local-seo");
  assert.equal(slugifyTag("— AI —"), "ai");
});

test("a tag with nothing sluggable yields an empty key rather than a junk row", () => {
  // syncVideoTags drops these instead of inserting an unnamed shelf.
  assert.equal(slugifyTag("!!!"), "");
  assert.equal(slugifyTag("   "), "");
});

test("the key is bounded by the column it has to fit in", () => {
  // varchar(128); an over-long slug would be truncated by MySQL on insert and
  // two different long tags could then collide on the unique index.
  assert.ok(slugifyTag("a".repeat(400)).length <= 128);
});
