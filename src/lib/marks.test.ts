import assert from "node:assert/strict";
import { test } from "node:test";
import { MARK_TEXT_LIMIT, truncateUnitText } from "./marks";
import { isUnitType, UNIT_TYPES, unitKey } from "./listen/units";
import { parseReadFilter } from "./videos";

test("a unit's text is stored trimmed, and long text is cut rather than refused", () => {
  // Refusing would turn a one-click gesture into an error message over a
  // display detail nobody chose.
  assert.equal(truncateUnitText("  a takeaway  "), "a takeaway");
  const long = "x".repeat(MARK_TEXT_LIMIT + 500);
  assert.equal(truncateUnitText(long).length, MARK_TEXT_LIMIT);
});

test("text exactly at the column width is left alone", () => {
  const exact = "y".repeat(MARK_TEXT_LIMIT);
  assert.equal(truncateUnitText(exact), exact);
});

test("the mark's unit types are exactly the listen player's", () => {
  // The enum in schema.ts mirrors this list. If they drift, a mark made in the
  // player becomes a database error rather than a row.
  assert.deepEqual(UNIT_TYPES, ["summary", "takeaway", "hook", "timeline", "gap", "idea"]);
  for (const type of UNIT_TYPES) assert.ok(isUnitType(type));
});

test("a mark's address is the same string the player uses", () => {
  assert.equal(unitKey("takeaway", 3), "takeaway:3");
});

test("the feed's read filter accepts 'marked' alongside the PR-19 pair", () => {
  assert.equal(parseReadFilter("marked"), "marked");
  assert.equal(parseReadFilter("unread"), "unread");
  assert.equal(parseReadFilter("pinned"), "pinned");
  // Anything else is no filter at all, not an error page.
  assert.equal(parseReadFilter("starred"), undefined);
  assert.equal(parseReadFilter(undefined), undefined);
});
