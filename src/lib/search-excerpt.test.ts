import assert from "node:assert/strict";
import { test } from "node:test";
import { describeMatch, excerptAround } from "./search-excerpt";

test("excerpt centres on the needle and marks both cuts", () => {
  const text = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
  const excerpt = excerptAround(text, "needle", 10);
  assert.ok(excerpt);
  assert.ok(excerpt.includes("needle"));
  assert.ok(excerpt.startsWith("…"), "left cut is marked");
  assert.ok(excerpt.endsWith("…"), "right cut is marked");
  assert.ok(excerpt.length < 60, `should be a window, got ${excerpt.length} chars`);
});

test("no ellipsis when nothing was cut", () => {
  assert.equal(excerptAround("short and sweet", "and", 40), "short and sweet");
});

test("case-insensitive, like the LIKE that selected the row", () => {
  // MySQL's default collation is case-insensitive, so a row can match in SQL
  // and then find no excerpt here — which would look like a bug in search.
  assert.ok(excerptAround("The Algorithm changed", "algorithm")?.includes("Algorithm"));
});

test("newlines are collapsed so the window reads as one line", () => {
  assert.equal(
    excerptAround("first line\n\n  second line", "second", 40),
    "first line second line",
  );
});

test("nothing to show returns null rather than an empty string", () => {
  assert.equal(excerptAround(null, "x"), null);
  assert.equal(excerptAround("text", ""), null);
  assert.equal(excerptAround("text", "absent"), null);
});

test("title matches win, and carry no excerpt", () => {
  const match = describeMatch("hook", "Writing a better Hook", "the summary mentions hook too");
  assert.deepEqual(match, { field: "title", excerpt: null });
});

test("a match the title cannot explain is attributed to the analysis", () => {
  const match = describeMatch("retention", "Some video", "It is really about retention curves.");
  assert.equal(match?.field, "analysis");
  assert.ok(match?.excerpt?.includes("retention"));
});

test("a hit in takeaways or ideas still reports the analysis, with no excerpt", () => {
  // The row matched in SQL against JSON columns the feed does not load, so the
  // badge has to stand alone rather than claiming the title matched.
  const match = describeMatch("thumbnail", "Some video", "A summary that never says it.");
  assert.deepEqual(match, { field: "analysis", excerpt: null });
});

test("no query means no match line at all", () => {
  assert.equal(describeMatch(undefined, "Some video", "text"), null);
  assert.equal(describeMatch("   ", "Some video", "text"), null);
});
