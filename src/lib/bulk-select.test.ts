import assert from "node:assert/strict";
import { test } from "node:test";
import { BULK_ANALYZE_LIMIT, parseVideoIds } from "./bulk-select";

test("keeps positive integers, in order, without duplicates", () => {
  assert.deepEqual(parseVideoIds(["3", "1", "3", "2"]), [3, 1, 2]);
});

test("drops everything that is not a plain positive integer", () => {
  // The list this walks comes from a form post, so each of these is something
  // an attacker can send, not something the UI can produce.
  assert.deepEqual(
    parseVideoIds(["", " ", "0", "-1", "3.5", "1e3", "abc", "12; drop table videos"]),
    [],
  );
});

test("surrounding whitespace is tolerated, since it changes nothing", () => {
  assert.deepEqual(parseVideoIds(["  7  "]), [7]);
});

test("ignores non-string form entries (a File in a videoId field)", () => {
  assert.deepEqual(parseVideoIds([{ name: "x" } as unknown as FormDataEntryValue, "5"]), [5]);
});

test("the batch limit is a real ceiling, not advice", () => {
  const ids = parseVideoIds(
    Array.from({ length: BULK_ANALYZE_LIMIT + 5 }, (_, i) => String(i + 1)),
  );
  assert.equal(ids.length, BULK_ANALYZE_LIMIT + 5, "parsing does not truncate");
  // The action refuses the whole submission rather than silently analysing the
  // first 200 — a partial submission of paid work nobody asked for is worse
  // than an error message.
  assert.ok(ids.length > BULK_ANALYZE_LIMIT);
});
