import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calendarGrid,
  fetchRange,
  isDay,
  localDay,
  moveToDay,
  parseCalendarParams,
  weekStart,
} from "./model";

test("weekStart is the Monday of the week", () => {
  assert.equal(weekStart("2026-09-27"), "2026-09-21"); // a Sunday
  assert.equal(weekStart("2026-09-21"), "2026-09-21"); // a Monday
  assert.equal(weekStart("2026-01-01"), "2025-12-29");
});

test("isDay rejects impossible dates", () => {
  assert.equal(isDay("2026-02-28"), true);
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isDay("2026-9-1"), false);
  assert.equal(isDay(undefined), false);
});

test("the week view is 7 days from Monday with ±7 day arrows", () => {
  const grid = calendarGrid("week", "2026-09-24");
  assert.deepEqual(grid.days, [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
  ]);
  assert.equal(grid.month, null);
  assert.equal(grid.prev, "2026-09-14");
  assert.equal(grid.next, "2026-09-28");
});

test("the month view covers whole weeks around the month", () => {
  const grid = calendarGrid("month", "2026-09-15");
  assert.equal(grid.month, "2026-09");
  assert.equal(grid.days[0], "2026-08-31"); // Monday before Sep 1 (a Tuesday)
  assert.equal(grid.days.at(-1), "2026-10-04"); // Sunday after Sep 30
  assert.equal(grid.days.length % 7, 0);
  assert.equal(grid.prev, "2026-08-01");
  assert.equal(grid.next, "2026-10-01");
  assert.equal(calendarGrid("month", "2026-01-10").prev, "2025-12-01");
  assert.equal(calendarGrid("month", "2026-12-10").next, "2027-01-01");
});

test("the fetch range covers every time zone's reading of the grid", () => {
  const { from, to } = fetchRange(["2026-09-21", "2026-09-27"]);
  assert.equal(from.toISOString(), "2026-09-20T10:00:00.000Z");
  assert.equal(to.toISOString(), "2026-09-28T14:00:00.000Z");
});

test("params fall back to month view and today", () => {
  assert.deepEqual(parseCalendarParams({}, "2026-09-27"), { view: "month", date: "2026-09-27" });
  assert.deepEqual(
    parseCalendarParams(
      { view: "week", date: "2026-10-02", account: "4", family: "residency" },
      "2026-09-27",
    ),
    { view: "week", date: "2026-10-02", account: 4, family: "residency" },
  );
  assert.deepEqual(parseCalendarParams({ date: "nope", account: "-1" }, "2026-09-27"), {
    view: "month",
    date: "2026-09-27",
  });
});

test("moveToDay keeps the local time of day", () => {
  const iso = new Date(2026, 8, 21, 18, 30).toISOString();
  const moved = new Date(moveToDay(iso, "2026-09-24"));
  assert.equal(localDay(moved.toISOString()), "2026-09-24");
  assert.equal(moved.getHours(), 18);
  assert.equal(moved.getMinutes(), 30);
  assert.equal(new Date(moveToDay(null, "2026-09-24")).getHours(), 9);
});
