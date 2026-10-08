import assert from "node:assert/strict";
import { test } from "node:test";
import { clampRate, DEFAULT_RATE, formatRate, MAX_RATE, MIN_RATE } from "./rate";

test("the offered range is 1x to 3x and holds at both ends", () => {
  assert.equal(clampRate(0.1), MIN_RATE);
  assert.equal(clampRate(10), MAX_RATE);
  assert.equal(clampRate(2.5), 2.5);
});

test("values are snapped to the step, so the label never shows float noise", () => {
  assert.equal(clampRate(1.13), 1.25);
  assert.equal(clampRate(2.0000000004), 2);
});

test("a non-number falls back to the default rather than to silence", () => {
  // The value can arrive from localStorage, which holds strings written by
  // an older build or by hand.
  assert.equal(clampRate(Number("nonsense")), DEFAULT_RATE);
  assert.equal(clampRate(Infinity), DEFAULT_RATE);
});

test("the label drops trailing zeroes", () => {
  assert.equal(formatRate(2), "2x");
  assert.equal(formatRate(1.5), "1.5x");
  assert.equal(formatRate(2.25), "2.25x");
});
